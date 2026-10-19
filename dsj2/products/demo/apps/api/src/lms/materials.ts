import { teachingBindingPermissionSql } from "./learning-permissions";
import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, open, realpath, rename, unlink } from "node:fs/promises";
import { isAbsolute, join, relative } from "node:path";
import { ArtifactStore } from "@demo/printing";
import { courseContentSchema } from "@demo/contracts/src/lms";
import { z } from "@demo/contracts";
import { Prisma, type Enrollment } from "@demo/database";
import { db, fail, audit, parse, transaction, type Context } from "../core";
import { isLmsStaff } from "./scope";
import { parseByteRange } from "./engine";
import {
  learningFileExtensions,
  validateLearningFile,
} from "./material-validation";
import {
  assertLearningPermission,
  hasLearningPermission,
  enrollmentScopeSql,
  isTeachingRole,
} from "./learning-permissions";
import { evaluateLearningEligibility } from "./learning-eligibility";
import { recordingVisibilitySql } from "./teaching-events";
import { assertMaterialForCourse } from "./material-library";

export const lmsStore = new ArtifactStore();
export const lmsUploadDirectory = join(lmsStore.root, "lms-upload-tmp");
export const lmsMaterialMaxBytes = 512 * 1024 * 1024;

// Only successful full checks are cached. Identity includes inode and nanosecond
// change times: size alone cannot detect an in-place edit or object replacement.
const integrityCache = new Map<
  string,
  { identity: string; sha256: string; checkedAt: number }
>();
const integrityCacheTtl = 5 * 60_000;
const integrityChecks = new Map<
  string,
  { identity: string; sha256: string; check: Promise<void> }
>();
export function invalidateMaterialIntegrity(storageKey: string) {
  integrityCache.delete(storageKey);
  integrityChecks.delete(storageKey);
}

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
  try {
    await validateLearningFile(file, evidence);
  } catch (error) {
    await unlink(file.path).catch(() => {});
    throw error;
  }
  const digest = createHash("sha256");
  for await (const chunk of createReadStream(file.path)) digest.update(chunk);
  const sha256 = digest.digest("hex");
  const extension = learningFileExtensions[file.mimetype];
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
  input: unknown = {},
) {
  const metadata = parse(
    z
      .object({ supersedesMaterialId: z.string().min(1).max(100).optional() })
      .strict(),
    input,
  );
  await assertLearningPermission(c, courseId, null, "MATERIAL");
  if (
    !(await db.course.findFirst({
      where: { id: courseId, tenantId: c.tenantId },
    }))
  )
    fail(404, "NOT_FOUND", "Курс не найден");
  const stored = await savePrivateUpload(file);
  const material = await transaction(async (tx) => {
    await assertLearningPermission(c, courseId, null, "MATERIAL", tx);
    let familyId: string | undefined;
    if (metadata.supersedesMaterialId) {
      const prior = await assertMaterialForCourse(
        tx,
        c,
        courseId,
        metadata.supersedesMaterialId,
      );
      const state = await tx.lmsMaterialState.findUnique({
        where: {
          tenantId_materialId: { tenantId: c.tenantId, materialId: prior.id },
        },
      });
      familyId = state?.familyId || prior.id;
    }
    const material = await tx.lmsMaterial.create({
      data: { tenantId: c.tenantId, courseId, ...stored, createdBy: c.userId },
    });
    await tx.lmsMaterialState.create({
      data: {
        tenantId: c.tenantId,
        materialId: material.id,
        title: material.originalName,
        familyId: familyId || material.id,
        supersedesMaterialId: metadata.supersedesMaterialId,
        updatedBy: c.userId,
      },
    });
    await audit(tx, c, "LMS_MATERIAL_UPLOADED", material.id, {
      courseId,
      size: material.size,
      mimeType: material.mimeType,
      supersedesMaterialId: metadata.supersedesMaterialId,
    });
    return material;
  }).catch(async (error: unknown) => {
    await unlink(lmsStore.path(stored.storageKey)).catch(() => {});
    throw error;
  });
  const { storageKey: _storageKey, ...view } = material;
  return view;
}

export async function authorizedMaterial(c: Context, id: string) {
  const material = await db.lmsMaterial.findFirst({
    where: { id, tenantId: c.tenantId },
  });
  if (!material) fail(404, "NOT_FOUND", "Материал не найден");
  const state = await db.lmsMaterialState.findUnique({
    where: { tenantId_materialId: { tenantId: c.tenantId, materialId: id } },
  });
  if (state?.deleted) fail(404, "NOT_FOUND", "Материал не найден");
  let granted = isLmsStaff(c) && !c.learningMode;
  if (!granted && isTeachingRole(c)) {
    granted =
      (await hasLearningPermission(c, material.courseId, null, "MATERIAL")) ||
      (await hasLearningPermission(c, material.courseId, null, "EDIT")) ||
      (await hasLearningPermission(c, material.courseId, null, "PUBLISH"));
    if (!granted) {
      const bindings = await db.$queryRaw<{ id: string }[]>(
        Prisma.sql`SELECT b.id FROM "LmsTeachingBinding" b WHERE b."tenantId"=${c.tenantId} AND b."userId"=${c.userId} AND b."revokedAt" IS NULL AND ${teachingBindingPermissionSql("READ")} AND EXISTS (SELECT 1 FROM "CourseVersion" v WHERE v."tenantId"=b."tenantId" AND v."courseId"=b."courseId" AND v.status='PUBLISHED' AND (b."groupId" IS NULL OR EXISTS(SELECT 1 FROM "LmsGroup" g WHERE g."tenantId"=b."tenantId" AND g.id=b."groupId" AND g."courseVersionId"=v.id)) AND EXISTS (SELECT 1 FROM jsonb_array_elements(v.content->'modules') module CROSS JOIN jsonb_array_elements(module->'lessons') lesson WHERE lesson->>'materialId'=${id} OR EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(lesson->'subtitles','[]'::jsonb)) track WHERE track->>'materialId'=${id}))) LIMIT 1`,
      );
      granted = bindings.length > 0;
    }
  }
  if (
    !granted &&
    (c.learningMode ||
      c.role === "EMPLOYER" ||
      (c.role === "LEARNER" && !c.teachingMode))
  ) {
    const scope = enrollmentScopeSql(c, "n");
    let cursor = "";
    for (;;) {
      const candidates = await db.$queryRaw<
        (Enrollment & { content: Prisma.JsonValue })[]
      >(
        Prisma.sql`SELECT n.*,v.content FROM "Enrollment" n JOIN "CourseVersion" v ON v."tenantId"=n."tenantId" AND v.id=n."courseVersionId" WHERE (${scope}) AND n.id>${cursor} AND n.status<>'CANCELLED' AND (n."startsAt" IS NULL OR n."startsAt"<=CURRENT_TIMESTAMP) AND (n."dueAt" IS NULL OR n."dueAt">=CURRENT_TIMESTAMP) AND v.status='PUBLISHED' AND EXISTS(SELECT 1 FROM jsonb_array_elements(v.content->'modules') module CROSS JOIN jsonb_array_elements(module->'lessons') lesson WHERE lesson->>'materialId'=${id} OR EXISTS(SELECT 1 FROM jsonb_array_elements(COALESCE(lesson->'subtitles','[]'::jsonb)) track WHERE track->>'materialId'=${id})) ORDER BY n.id LIMIT 25`,
      );
      for (const enrollment of candidates) {
        const content = courseContentSchema.parse(enrollment.content),
          evaluation = await evaluateLearningEligibility(
            db,
            c,
            enrollment,
            content,
          );
        const lessons = content.modules.flatMap((module) => module.lessons);
        if (
          lessons.some(
            (lesson) =>
              (lesson.materialId === id ||
                lesson.subtitles?.some((track) => track.materialId === id)) &&
              evaluation.lessons.some(
                (row) => row.id === lesson.id && row.available,
              ),
          )
        ) {
          granted = true;
          break;
        }
      }
      if (granted || candidates.length < 25) break;
      cursor = candidates.at(-1)!.id;
    }
  }
  if (!granted) {
    const scope = await recordingVisibilitySql(c, "event");
    const events = await db.$queryRaw<{ id: string }[]>(
      Prisma.sql`SELECT event.id FROM "LmsTeachingEvent" event WHERE event."recordingMaterialId"=${id} AND (${scope}) LIMIT 1`,
    );
    granted = events.length > 0;
  }
  if (!granted) fail(404, "NOT_FOUND", "Материал не найден");
  await audit(db, c, "LMS_MATERIAL_OPENED", material.id);
  return material;
}

export async function openPrivateStream(
  record: { storageKey: string; sha256: string; size?: number },
  rangeHeader?: string,
  forceIntegrity = false,
) {
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    const actual = await realpath(lmsStore.path(record.storageKey));
    const root = await realpath(lmsStore.root);
    const path = relative(root, actual);
    if (path.startsWith("..") || isAbsolute(path)) throw new Error("PATH");
    handle = await open(actual, "r");
    const stat = await handle.stat({ bigint: true });
    if (!stat.isFile()) throw new Error("NOT_FILE");
    const size = Number(stat.size);
    if (record.size !== undefined && size !== record.size)
      throw new Error("SIZE");
    const identity = (value: typeof stat) =>
      `${actual}:${value.dev}:${value.ino}:${value.size}:${value.mtimeNs}:${value.ctimeNs}:${value.birthtimeNs}`;
    const version = identity(stat);
    const cached = integrityCache.get(record.storageKey);
    if (
      forceIntegrity ||
      !cached ||
      cached.identity !== version ||
      cached.sha256 !== record.sha256 ||
      Date.now() - cached.checkedAt > integrityCacheTtl
    ) {
      integrityCache.delete(record.storageKey);
      let checking = integrityChecks.get(record.storageKey);
      if (
        !checking ||
        checking.identity !== version ||
        checking.sha256 !== record.sha256
      ) {
        const checkedHandle = handle;
        const check = (async () => {
          const hash = createHash("sha256");
          for await (const chunk of checkedHandle.createReadStream({
            autoClose: false,
            start: 0,
          }))
            hash.update(chunk);
          if (
            hash.digest("hex") !== record.sha256 ||
            identity(await checkedHandle.stat({ bigint: true })) !== version
          )
            throw new Error("HASH_OR_IDENTITY");
        })();
        checking = { identity: version, sha256: record.sha256, check };
        integrityChecks.set(record.storageKey, checking);
      }
      try {
        // Concurrent initial Range requests share one full read of this exact
        // object version. Every response still checks its own open descriptor.
        await checking.check;
        if (identity(await handle.stat({ bigint: true })) !== version)
          throw new Error("IDENTITY_CHANGED");
        if (integrityChecks.get(record.storageKey) === checking) {
          if (integrityCache.size >= 256)
            integrityCache.delete(integrityCache.keys().next().value!);
          integrityCache.set(record.storageKey, {
            identity: version,
            sha256: record.sha256,
            checkedAt: Date.now(),
          });
        }
      } finally {
        if (integrityChecks.get(record.storageKey) === checking)
          integrityChecks.delete(record.storageKey);
      }
    }
    const range = parseByteRange(rangeHeader, size);
    if (!range) {
      await handle.close();
      return { invalid: true as const, size };
    }
    const stream = handle.createReadStream({
      autoClose: true,
      start: range.start,
      end: range.end,
    });
    handle = undefined;
    return { invalid: false as const, stream, size, ...range };
  } catch {
    integrityCache.delete(record.storageKey);
    await handle?.close().catch(() => {});
    fail(503, "MATERIAL_UNAVAILABLE", "Материал временно недоступен");
  }
}
