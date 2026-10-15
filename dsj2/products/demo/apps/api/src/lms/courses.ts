import type { Prisma } from "@demo/database";
import {
  courseContentSchema,
  regulatoryProfileSchema,
} from "@demo/contracts/src/lms";
import {
  db,
  parse,
  json,
  hash,
  transaction,
  audit,
  fail,
  type Context,
} from "../core";
import { assertLmsStaff, isLmsStaff } from "./scope";
import {
  courseInputSchema,
  versionInputSchema,
  revisionSchema,
  pagingSchema,
  assertPublishable,
  courseOutline,
} from "./validation";

export async function versionView(
  c: Context,
  version: Awaited<ReturnType<typeof db.courseVersion.findFirstOrThrow>>,
  tx: Prisma.TransactionClient = db,
) {
  const profile = await tx.regulatoryProfileVersion.findFirstOrThrow({
    where: { id: version.regulatoryProfileVersionId, tenantId: c.tenantId },
  });
  const content = courseContentSchema.parse(version.content);
  return {
    ...version,
    content: isLmsStaff(c) ? content : courseOutline(content),
    profile: profile.definition,
  };
}
export async function listCourses(c: Context, query: unknown) {
  const { page, pageSize, search } = parse(pagingSchema, query);
  const where: Prisma.CourseWhereInput = {
    tenantId: c.tenantId,
    archived: false,
    ...(search
      ? {
          OR: [
            { titleRu: { contains: search, mode: "insensitive" } },
            { titleKz: { contains: search, mode: "insensitive" } },
          ],
        }
      : {}),
  };
  const courses = await db.course.findMany({
    where,
    orderBy: { createdAt: "desc" },
    skip: (page - 1) * pageSize,
    take: pageSize,
  });
  const items = [];
  for (const course of courses) {
    const latest = await db.courseVersion.findFirst({
      where: {
        tenantId: c.tenantId,
        courseId: course.id,
        ...(!isLmsStaff(c) ? { status: "PUBLISHED" } : {}),
      },
      orderBy: { version: "desc" },
    });
    if (latest)
      items.push({ ...course, latestVersion: await versionView(c, latest) });
  }
  return { items, total: await db.course.count({ where }), page, pageSize };
}
export async function getCourse(c: Context, id: string) {
  const course = await db.course.findFirst({
    where: { id, tenantId: c.tenantId, archived: false },
  });
  if (!course) fail(404, "NOT_FOUND", "Курс не найден");
  const versions = await db.courseVersion.findMany({
    where: {
      tenantId: c.tenantId,
      courseId: id,
      ...(!isLmsStaff(c) ? { status: "PUBLISHED" } : {}),
    },
    orderBy: { version: "desc" },
  });
  if (!versions.length) fail(404, "NOT_FOUND", "Курс не найден");
  return {
    course,
    versions: await Promise.all(versions.map((v) => versionView(c, v))),
  };
}
export async function createCourse(c: Context, input: unknown) {
  assertLmsStaff(c);
  const data = parse(courseInputSchema, input);
  return transaction(async (tx) => {
    const course = await tx.course.create({
      data: {
        tenantId: c.tenantId,
        titleRu: data.content.titleRu,
        titleKz: data.content.titleKz,
        createdBy: c.userId,
      },
    });
    const profile = await tx.regulatoryProfileVersion.create({
      data: {
        tenantId: c.tenantId,
        courseId: course.id,
        version: 1,
        status: data.profile.status,
        definition: json(data.profile),
        snapshotHash: hash(data.profile),
      },
    });
    const version = await tx.courseVersion.create({
      data: {
        tenantId: c.tenantId,
        courseId: course.id,
        version: 1,
        content: json(data.content),
        regulatoryProfileVersionId: profile.id,
        createdBy: c.userId,
      },
    });
    await audit(tx, c, "LMS_COURSE_CREATED", course.id);
    return { course, version: await versionView(c, version, tx) };
  });
}
export async function updateVersion(c: Context, id: string, input: unknown) {
  assertLmsStaff(c);
  const data = parse(versionInputSchema, input);
  return transaction(async (tx) => {
    await tx.$executeRaw`SELECT id FROM "CourseVersion" WHERE id=${id} AND "tenantId"=${c.tenantId} FOR UPDATE`;
    const version = await tx.courseVersion.findFirst({
      where: { id, tenantId: c.tenantId },
    });
    if (!version) fail(404, "NOT_FOUND", "Версия не найдена");
    if (version.status !== "DRAFT")
      fail(409, "VERSION_IMMUTABLE", "Для изменений создайте новую версию");
    if (version.revision !== data.revision)
      fail(
        409,
        "REVISION_CONFLICT",
        "Курс изменён в другой вкладке. Обновите данные",
      );
    await tx.regulatoryProfileVersion.update({
      where: { id: version.regulatoryProfileVersionId },
      data: {
        definition: json(data.profile),
        status: data.profile.status,
        snapshotHash: hash(data.profile),
        reviewedBy: data.profile.status === "CONFIRMED" ? c.userId : null,
        reviewedAt: data.profile.status === "CONFIRMED" ? new Date() : null,
      },
    });
    const saved = await tx.courseVersion.update({
      where: { id },
      data: { revision: { increment: 1 }, content: json(data.content) },
    });
    await tx.course.update({
      where: { id: version.courseId },
      data: { titleRu: data.content.titleRu, titleKz: data.content.titleKz },
    });
    await audit(tx, c, "LMS_COURSE_SAVED", id, { revision: saved.revision });
    return versionView(c, saved, tx);
  });
}
export async function cloneVersion(c: Context, courseId: string) {
  assertLmsStaff(c);
  return transaction(async (tx) => {
    await tx.$executeRaw`SELECT id FROM "Course" WHERE id=${courseId} AND "tenantId"=${c.tenantId} FOR UPDATE`;
    const previous = await tx.courseVersion.findFirst({
      where: { courseId, tenantId: c.tenantId },
      orderBy: { version: "desc" },
    });
    if (!previous) fail(404, "NOT_FOUND", "Курс не найден");
    if (previous.status === "DRAFT") return versionView(c, previous, tx);
    const priorProfile = await tx.regulatoryProfileVersion.findFirstOrThrow({
      where: { id: previous.regulatoryProfileVersionId, tenantId: c.tenantId },
    });
    const definition = regulatoryProfileSchema.parse(priorProfile.definition);
    // A new content version needs its own review; no approval is silently carried across.
    const revised = { ...definition, status: "NEEDS_LEGAL_REVIEW" };
    const profile = await tx.regulatoryProfileVersion.create({
      data: {
        tenantId: c.tenantId,
        courseId,
        version: previous.version + 1,
        definition: json(revised),
        snapshotHash: hash(revised),
      },
    });
    const version = await tx.courseVersion.create({
      data: {
        tenantId: c.tenantId,
        courseId,
        version: previous.version + 1,
        content: json(previous.content),
        regulatoryProfileVersionId: profile.id,
        createdBy: c.userId,
      },
    });
    await audit(tx, c, "LMS_VERSION_CREATED", version.id, {
      previousId: previous.id,
    });
    return versionView(c, version, tx);
  });
}
export async function publishVersion(c: Context, id: string, input: unknown) {
  assertLmsStaff(c);
  const { revision } = parse(revisionSchema, input);
  return transaction(async (tx) => {
    await tx.$executeRaw`SELECT id FROM "CourseVersion" WHERE id=${id} AND "tenantId"=${c.tenantId} FOR UPDATE`;
    const version = await tx.courseVersion.findFirst({
      where: { id, tenantId: c.tenantId },
    });
    if (!version) fail(404, "NOT_FOUND", "Версия не найдена");
    if (version.status === "PUBLISHED") return versionView(c, version, tx);
    if (version.revision !== revision)
      fail(409, "REVISION_CONFLICT", "Сохраните актуальную версию курса");
    const profile = await tx.regulatoryProfileVersion.findFirstOrThrow({
      where: { tenantId: c.tenantId, id: version.regulatoryProfileVersionId },
    });
    const content = courseContentSchema.parse(version.content);
    const definition = regulatoryProfileSchema.parse(profile.definition);
    assertPublishable(content, definition);
    for (const lesson of content.modules.flatMap((m) => m.lessons))
      if (lesson.materialId) {
        const material = await tx.lmsMaterial.findFirst({
          where: {
            id: lesson.materialId,
            tenantId: c.tenantId,
            courseId: version.courseId,
          },
        });
        if (
          !material ||
          (lesson.kind === "PDF" && material.mimeType !== "application/pdf") ||
          (lesson.kind === "VIDEO" && !material.mimeType.startsWith("video/"))
        )
          fail(400, "MATERIAL_INVALID", "Проверьте файл урока");
      }
    if (definition.status === "CONFIRMED")
      await tx.regulatoryProfileVersion.update({
        where: { id: profile.id },
        data: { reviewedBy: c.userId, reviewedAt: new Date() },
      });
    const saved = await tx.courseVersion.update({
      where: { id },
      data: {
        status: "PUBLISHED",
        publishedAt: new Date(),
        snapshotHash: hash({ content, profile: definition }),
      },
    });
    await audit(tx, c, "LMS_VERSION_PUBLISHED", id, {
      version: version.version,
      snapshotHash: saved.snapshotHash,
    });
    return versionView(c, saved, tx);
  });
}
