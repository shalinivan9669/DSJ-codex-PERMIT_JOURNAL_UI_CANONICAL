import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, open, realpath, rename, unlink } from "node:fs/promises";
import { isAbsolute, join, relative } from "node:path";
import { ArtifactStore } from "@demo/printing";
import { courseContentSchema } from "@demo/contracts/src/lms";
import { db, fail, audit, type Context } from "../core";
import { assertLmsStaff, enrollmentFilter, isLmsStaff } from "./scope";
import { parseByteRange } from "./engine";

export const lmsStore = new ArtifactStore();
export const lmsUploadDirectory = join(lmsStore.root, "lms-upload-tmp");
export const lmsMaterialMaxBytes = 512 * 1024 * 1024;

export async function uploadDestination() {
  await mkdir(lmsUploadDirectory, { recursive: true, mode: 0o700 });
  return lmsUploadDirectory;
}

/** Multipart parser writes videos to private disk; no whole-video API buffer. */
export async function savePrivateUpload(
  file: Express.Multer.File | undefined,
  evidence = false,
) {
  if (!file?.path) fail(400, "FILE_REQUIRED", "Выберите файл");
  const permitted = new Set(
    evidence
      ? ["application/pdf", "image/png", "image/jpeg"]
      : ["application/pdf", "video/mp4", "video/webm"],
  );
  if (
    !permitted.has(file.mimetype) ||
    file.size <= 0 ||
    file.size > (evidence ? 20 * 1024 * 1024 : lmsMaterialMaxBytes)
  ) {
    await unlink(file.path).catch(() => {});
    fail(
      400,
      "MATERIAL_TYPE",
      evidence
        ? "Используйте PDF, PNG или JPEG до 20 МиБ"
        : "Используйте PDF, MP4 или WebM до 512 МиБ",
    );
  }
  const handle = await open(file.path, "r");
  const signature = Buffer.alloc(16);
  await handle.read(signature, 0, 16, 0);
  await handle.close();
  const valid =
    file.mimetype === "application/pdf"
      ? signature.subarray(0, 5).toString() === "%PDF-"
      : file.mimetype === "video/mp4"
        ? signature.subarray(4, 8).toString() === "ftyp"
        : file.mimetype === "video/webm"
          ? signature
              .subarray(0, 4)
              .equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]))
          : file.mimetype === "image/png"
            ? signature
                .subarray(0, 8)
                .equals(
                  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
                )
            : signature[0] === 0xff &&
              signature[1] === 0xd8 &&
              signature[2] === 0xff;
  if (!valid) {
    await unlink(file.path).catch(() => {});
    fail(
      400,
      "MATERIAL_SIGNATURE",
      "Формат файла не соответствует содержимому",
    );
  }
  const digest = createHash("sha256");
  for await (const chunk of createReadStream(file.path)) digest.update(chunk);
  const sha256 = digest.digest("hex");
  const extension = (
    {
      "application/pdf": "pdf",
      "video/mp4": "mp4",
      "video/webm": "webm",
      "image/png": "png",
      "image/jpeg": "jpg",
    } as Record<string, string>
  )[file.mimetype];
  const storageKey = `objects/lms/${sha256}-${randomUUID()}.${extension}`;
  const destination = lmsStore.path(storageKey);
  await mkdir(join(lmsStore.root, "objects", "lms"), {
    recursive: true,
    mode: 0o700,
  });
  await rename(file.path, destination);
  return {
    storageKey,
    sha256,
    size: file.size,
    mimeType: file.mimetype,
    originalName: [...file.originalname]
      .filter((char) => char.charCodeAt(0) >= 32)
      .join("")
      .slice(0, 250),
  };
}

export async function uploadMaterial(
  c: Context,
  courseId: string,
  file: Express.Multer.File | undefined,
) {
  assertLmsStaff(c);
  if (
    !(await db.course.findFirst({
      where: { id: courseId, tenantId: c.tenantId },
    }))
  )
    fail(404, "NOT_FOUND", "Курс не найден");
  const stored = await savePrivateUpload(file);
  const material = await db.lmsMaterial.create({
    data: { tenantId: c.tenantId, courseId, ...stored, createdBy: c.userId },
  });
  await audit(db, c, "LMS_MATERIAL_UPLOADED", material.id, {
    courseId,
    size: material.size,
    mimeType: material.mimeType,
  });
  const { storageKey: _storageKey, ...view } = material;
  return view;
}

export async function authorizedMaterial(c: Context, id: string) {
  const material = await db.lmsMaterial.findFirst({
    where: { id, tenantId: c.tenantId },
  });
  if (!material) fail(404, "NOT_FOUND", "Материал не найден");
  if (!isLmsStaff(c)) {
    const enrollments = await db.enrollment.findMany({
      where: {
        ...(await enrollmentFilter(c)),
        status: { not: "CANCELLED" },
        dueAt: { gte: new Date() },
      },
    });
    const versions = await db.courseVersion.findMany({
      where: {
        tenantId: c.tenantId,
        id: { in: enrollments.map((e) => e.courseVersionId) },
        status: "PUBLISHED",
      },
    });
    let granted = false;
    for (const version of versions) {
      const lessons = courseContentSchema
        .parse(version.content)
        .modules.flatMap((m) => m.lessons);
      const target = lessons.find((l) => l.materialId === id);
      if (!target) continue;
      const enrollment = enrollments.find(
        (e) => e.courseVersionId === version.id,
      )!;
      const completed = await db.lessonProgress.findMany({
        where: {
          tenantId: c.tenantId,
          enrollmentId: enrollment.id,
          completedAt: { not: null },
        },
      });
      if (
        target.prerequisiteLessonIds.every((id) =>
          completed.some((p) => p.lessonId === id),
        )
      ) {
        granted = true;
        break;
      }
    }
    if (!granted) fail(404, "NOT_FOUND", "Материал не найден");
  }
  await audit(db, c, "LMS_MATERIAL_OPENED", material.id);
  return material;
}

export async function openPrivateStream(
  record: { storageKey: string; sha256: string; size?: number },
  rangeHeader?: string,
) {
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    const actual = await realpath(lmsStore.path(record.storageKey));
    const root = await realpath(lmsStore.root);
    const path = relative(root, actual);
    if (path.startsWith("..") || isAbsolute(path)) throw new Error("PATH");
    handle = await open(actual, "r");
    const stat = await handle.stat();
    if (record.size !== undefined && stat.size !== record.size)
      throw new Error("SIZE");
    const hash = createHash("sha256");
    for await (const chunk of handle.createReadStream({
      autoClose: false,
      start: 0,
    }))
      hash.update(chunk);
    if (hash.digest("hex") !== record.sha256) throw new Error("HASH");
    const range = parseByteRange(rangeHeader, stat.size);
    if (!range) {
      await handle.close();
      return { invalid: true as const, size: stat.size };
    }
    const stream = handle.createReadStream({
      autoClose: true,
      start: range.start,
      end: range.end,
    });
    handle = undefined;
    return { invalid: false as const, stream, size: stat.size, ...range };
  } catch {
    await handle?.close();
    fail(503, "MATERIAL_UNAVAILABLE", "Материал временно недоступен");
  }
}
