import type { Prisma } from "@demo/database";
import {
  courseContentSchema,
  regulatoryProfileSchema,
  type CourseContent,
  type RegulatoryProfile,
} from "@demo/contracts/src/lms";
import { z } from "@demo/contracts";
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
import { normalizeCourseQuestions } from "./questions";
import { questionSemanticHash } from "./question-semantics";

type CourseListRow = {
  id: string;
  titleRu: string;
  titleKz: string;
  assignmentPaused: boolean;
  assignmentPauseReason: string | null;
  latestVersion: {
    id: string;
    version: number;
    status: string;
    content: Pick<
      CourseContent,
      "titleRu" | "titleKz" | "category" | "hours" | "accessDays"
    >;
    profile: Pick<RegulatoryProfile, "status" | "assessmentKind" | "legalForm">;
  };
  currentReview: { status: string; note: string; updatedAt: string } | null;
};

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
  const { page, pageSize, search, status } = parse(pagingSchema, query);
  const staff = isLmsStaff(c) && status !== "PUBLISHED";
  const [items, counts] = await Promise.all([
    db.$queryRaw<CourseListRow[]>`
      SELECT c.id, c."titleRu", c."titleKz", c."assignmentPaused", c."assignmentPauseReason",
        jsonb_build_object('id', v.id, 'version', v.version, 'status', v.status,
          'content', jsonb_build_object('titleRu', v.content->>'titleRu', 'titleKz', v.content->>'titleKz',
            'category', v.content->>'category', 'hours', v.content->'hours', 'accessDays', v.content->'accessDays'),
          'profile', jsonb_build_object('status', p.status, 'assessmentKind', p.definition->>'assessmentKind', 'legalForm', p.definition->>'legalForm')) AS "latestVersion",
        CASE WHEN r.id IS NULL THEN NULL ELSE jsonb_build_object('status', r.status, 'note', r.note, 'updatedAt', r."updatedAt") END AS "currentReview"
      FROM "Course" c
      JOIN LATERAL (SELECT id, version, status, content, "regulatoryProfileVersionId" FROM "CourseVersion"
        WHERE "tenantId"=${c.tenantId} AND "courseId"=c.id AND (${staff} OR status='PUBLISHED')
        ORDER BY version DESC LIMIT 1) v ON true
      JOIN "RegulatoryProfileVersion" p ON p.id=v."regulatoryProfileVersionId" AND p."tenantId"=${c.tenantId}
      LEFT JOIN "RegulatoryReview" r ON r."courseId"=c.id AND r."tenantId"=${c.tenantId}
      WHERE c."tenantId"=${c.tenantId} AND c.archived=false AND
        (${search}='' OR POSITION(lower(${search}) IN lower(c."titleRu"))>0 OR POSITION(lower(${search}) IN lower(c."titleKz"))>0)
      ORDER BY c."createdAt" DESC, c.id ASC LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`,
    db.$queryRaw<Array<{ total: bigint }>>`
      SELECT count(*) AS total FROM "Course" c WHERE c."tenantId"=${c.tenantId} AND c.archived=false
      AND (${search}='' OR POSITION(lower(${search}) IN lower(c."titleRu"))>0 OR POSITION(lower(${search}) IN lower(c."titleKz"))>0)
      AND EXISTS (SELECT 1 FROM "CourseVersion" v WHERE v."tenantId"=${c.tenantId} AND v."courseId"=c.id AND (${staff} OR v.status='PUBLISHED'))`,
  ]);
  return { items, total: Number(counts[0]?.total || 0), page, pageSize };
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
    course: {
      ...course,
      currentReview: await db.regulatoryReview.findFirst({
        where: { tenantId: c.tenantId, courseId: id },
      }),
    },
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
    const content = await normalizeCourseQuestions(
      tx,
      c,
      course.id,
      data.content,
    );
    const version = await tx.courseVersion.create({
      data: {
        tenantId: c.tenantId,
        courseId: course.id,
        version: 1,
        content: json(content),
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
    const content = await normalizeCourseQuestions(
      tx,
      c,
      version.courseId,
      data.content,
      courseContentSchema.parse(version.content),
    );
    const oldProfile = await tx.regulatoryProfileVersion.findFirstOrThrow({
      where: { id: version.regulatoryProfileVersionId, tenantId: c.tenantId },
    });
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
      data: { revision: { increment: 1 }, content: json(content) },
    });
    await tx.course.update({
      where: { id: version.courseId },
      data: { titleRu: data.content.titleRu, titleKz: data.content.titleKz },
    });
    await audit(tx, c, "LMS_COURSE_SAVED", id, {
      before: {
        revision: version.revision,
        contentHash: hash(version.content),
        profileHash: oldProfile.snapshotHash,
      },
      after: {
        revision: saved.revision,
        contentHash: hash(content),
        profileHash: hash(data.profile),
      },
    });
    return versionView(c, saved, tx);
  });
}

const pauseInput = z
  .object({
    paused: z.boolean(),
    reason: z.string().trim().max(1000).default(""),
  })
  .strict();
export async function setCoursePause(c: Context, id: string, input: unknown) {
  assertLmsStaff(c);
  const value = parse(pauseInput, input);
  return transaction(async (tx) => {
    await tx.$executeRaw`SELECT id FROM "Course" WHERE id=${id} AND "tenantId"=${c.tenantId} FOR UPDATE`;
    const previous = await tx.course.findFirst({
      where: { id, tenantId: c.tenantId, archived: false },
    });
    if (!previous) fail(404, "NOT_FOUND", "Курс не найден");
    const course = await tx.course.update({
      where: { id },
      data: {
        assignmentPaused: value.paused,
        assignmentPauseReason: value.reason,
      },
    });
    await audit(
      tx,
      c,
      value.paused ? "LMS_COURSE_PAUSED" : "LMS_COURSE_RESUMED",
      id,
      {
        before: {
          paused: previous.assignmentPaused,
          reason: previous.assignmentPauseReason,
        },
        after: value,
      },
    );
    return course;
  });
}
const reviewInput = z
  .object({
    status: z.enum([
      "CURRENT",
      "CHANGES_EXPECTED",
      "CHANGED",
      "REPEALED",
      "REVIEW_REQUIRED",
    ]),
    note: z.string().trim().max(2000).default(""),
  })
  .strict();
export async function setRegulatoryReview(
  c: Context,
  id: string,
  input: unknown,
) {
  assertLmsStaff(c);
  const value = parse(reviewInput, input);
  return transaction(async (tx) => {
    await tx.$executeRaw`SELECT id FROM "Course" WHERE id=${id} AND "tenantId"=${c.tenantId} FOR UPDATE`;
    if (
      !(await tx.course.findFirst({
        where: { id, tenantId: c.tenantId, archived: false },
      }))
    )
      fail(404, "NOT_FOUND", "Курс не найден");
    const before = await tx.regulatoryReview.findFirst({
      where: { tenantId: c.tenantId, courseId: id },
    });
    const review = await tx.regulatoryReview.upsert({
      where: { tenantId_courseId: { tenantId: c.tenantId, courseId: id } },
      create: {
        tenantId: c.tenantId,
        courseId: id,
        ...value,
        updatedBy: c.userId,
      },
      update: { ...value, updatedBy: c.userId },
    });
    await audit(tx, c, "LMS_REGULATORY_REVIEWED", id, {
      before: before ? { status: before.status, note: before.note } : null,
      after: value,
    });
    return review;
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
    const content = await normalizeCourseQuestions(
      tx,
      c,
      version.courseId,
      courseContentSchema.parse(version.content),
      courseContentSchema.parse(version.content),
      true,
    );
    const definition = regulatoryProfileSchema.parse(profile.definition);
    assertPublishable(content, definition);
    const prior = await tx.courseVersion.findFirst({
      where: {
        tenantId: c.tenantId,
        courseId: version.courseId,
        status: "PUBLISHED",
      },
      orderBy: { version: "desc" },
    });
    const previousQuestions = prior
      ? courseContentSchema.parse(prior.content).exam.questions
      : [];
    for (const question of content.exam.questions) {
      const previous = previousQuestions.find(
        (item) => item.id === question.id,
      );
      if (
        !previous ||
        questionSemanticHash(previous) !== questionSemanticHash(question)
      )
        await audit(tx, c, "LMS_COURSE_QUESTION_REVISED", id, {
          questionId: question.id,
          before: previous
            ? {
                version: previous.version,
                semanticHash: questionSemanticHash(previous),
              }
            : null,
          after: {
            version: question.version,
            semanticHash: questionSemanticHash(question),
          },
          libraryRevisionId: question.libraryRevisionId || null,
        });
    }
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
        content: json(content),
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
