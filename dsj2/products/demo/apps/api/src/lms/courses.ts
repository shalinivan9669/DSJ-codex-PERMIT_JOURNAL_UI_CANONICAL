import { Prisma } from "@demo/database";
import { HttpException } from "@nestjs/common";
import {
  courseContentSchema,
  regulatoryProfileSchema,
  type CourseContent,
  type RegulatoryProfile,
} from "@demo/contracts/src/lms";
import { canAuthorPrograms, canManageLearning, z } from "@demo/contracts";
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
import { employerMemberships, isLmsStaff } from "./scope";
import {
  courseInputSchema,
  versionInputSchema,
  revisionSchema,
  pagingSchema,
  assertPublishable,
  assertQuestionPublishable,
  courseOutline,
} from "./validation";
import { normalizeCourseQuestions } from "./questions";
import { questionSemanticHash } from "./question-semantics";
import {
  assertLearningPermission,
  hasLearningPermission,
  courseActions,
  isTeachingRole,
  teachingBindingPermissionSql,
  teachingBindingPermissionWhere,
  teachingRolePermissions,
} from "./learning-permissions";
import { validatePublishedDependencies } from "./publication-validation";
import { assertMaterialForCourse } from "./material-library";
import { localAssessmentIssues, regulatoryEffectiveFromIssue } from "./course-validation";
import { enqueueRegulatoryNotification } from "./notification-events";
import { normalizeSourceReferences } from "./regulatory-sources";

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
      "titleRu" | "titleKz" | "category" | "hours" | "accessDays" | "metadata"
    >;
    profile: Pick<RegulatoryProfile, "status" | "assessmentKind" | "legalForm">;
  };
  currentReview: { status: string; note: string; updatedAt: string } | null;
};

type PublicationIssue = {
  code: string;
  messageRu: string;
  messageKz: string;
  target: "overview" | "settings" | "modules" | "exam" | "review";
  moduleId?: string;
  lessonId?: string;
  questionId?: string;
};

/** A read-only catalogue of the exact normative sources pinned to course versions. */
export async function listRegulatorySources(c: Context, query: unknown) {
  if (c.learningMode || (!canManageLearning(c.role) && c.role !== "METHODIST"))
    fail(403, "LEARNING_PERMISSION_DENIED", "Нормативная база доступна администратору и ответственному методисту");
  const { page, pageSize, search, sanitary, status } = parse(z.object({
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(25),
    search: z.string().max(300).default(""),
    sanitary: z.enum(["ALL", "ONLY"]).default("ALL"),
    status: z.enum(["ALL", "DRAFT", "PUBLISHED"]).default("ALL"),
  }).strict(), query);
  const scoped = !canManageLearning(c.role);
  // Require both grants on the same live, course-wide METHODIST binding.
  const filter = Prisma.sql`
    FROM "Course" course
    JOIN "CourseVersion" v ON v."courseId"=course.id AND v."tenantId"=course."tenantId"
    JOIN "RegulatoryProfileVersion" p ON p.id=v."regulatoryProfileVersionId" AND p."tenantId"=v."tenantId" AND p."courseId"=course.id
    LEFT JOIN "RegulatoryReview" r ON r."courseId"=course.id AND r."tenantId"=course."tenantId"
    WHERE course."tenantId"=${c.tenantId} AND course.archived=false
    AND (NOT ${scoped} OR EXISTS (SELECT 1 FROM "LmsTeachingBinding" b
      WHERE b."tenantId"=course."tenantId" AND b."courseId"=course.id AND b."userId"=${c.userId}
      AND b."revokedAt" IS NULL AND b."groupId" IS NULL AND b.role='METHODIST'
      AND ${teachingBindingPermissionSql("READ", "b")} AND ${teachingBindingPermissionSql("EDIT", "b")}))
    AND jsonb_array_length(COALESCE(p.definition->'sources', '[]'::jsonb))>0
    AND (${sanitary}='ALL' OR p.definition->>'sanitary'='true')
    AND (${status}='ALL' OR v.status=${status})
    AND (${search}='' OR POSITION(lower(${search}) IN lower(concat(v.content->>'titleRu', ' ', v.content->>'titleKz', ' ', p.definition->>'title', ' ', (p.definition->'sources')::text)))>0)`;
  type Row = {
    id: string; courseId: string; courseVersionId: string; version: number;
    titleRu: string; titleKz: string; status: string; publishedAt: Date | null;
    profile: Pick<RegulatoryProfile, "title" | "sources" | "status" | "sanitary" | "synthetic">;
    currentReview: { status: string; updatedAt: string } | null;
  };
  const [items, counts] = await Promise.all([
    db.$queryRaw<Row[]>(Prisma.sql`SELECT p.id, course.id AS "courseId", v.id AS "courseVersionId", v.version,
      v.content->>'titleRu' AS "titleRu", v.content->>'titleKz' AS "titleKz", v.status, v."publishedAt",
      jsonb_build_object('title', p.definition->>'title', 'sources', p.definition->'sources', 'status', p.status,
        'sanitary', p.definition->'sanitary', 'synthetic', p.definition->'synthetic') AS profile,
      CASE WHEN r.id IS NULL THEN NULL ELSE jsonb_build_object('status',r.status,'updatedAt',r."updatedAt") END AS "currentReview"
      ${filter} ORDER BY course."createdAt" DESC, course.id, v.version DESC LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`),
    db.$queryRaw<Array<{ total: bigint }>>(Prisma.sql`SELECT count(*) AS total ${filter}`),
  ]);
  return { items, total: Number(counts[0]?.total || 0), page, pageSize };
}

/** Author guidance uses the same publication rules; publication still validates atomically. */
function publicationIssues(content: CourseContent, profile: RegulatoryProfile) {
  const issues: PublicationIssue[] = localAssessmentIssues(content, profile);
  const periodIssue = regulatoryEffectiveFromIssue(content, profile);
  if (periodIssue) issues.push(periodIssue);
  const add = (issue: PublicationIssue) => {
    if (!issues.some((row) => row.code === issue.code && row.lessonId === issue.lessonId && row.moduleId === issue.moduleId && row.questionId === issue.questionId)) issues.push(issue);
  };
  for (const module of content.modules) {
    if (!module.titleRu.trim() || !module.titleKz.trim()) add({ code: "MODULE_TITLE_REQUIRED", target: "modules", moduleId: module.id, messageRu: "Укажите название модуля на двух языках", messageKz: "Модуль атауын екі тілде көрсетіңіз" });
    for (const lesson of module.lessons) {
      const location = { target: "modules" as const, moduleId: module.id, lessonId: lesson.id };
      if (!lesson.titleRu.trim() || !lesson.titleKz.trim()) add({ ...location, code: "LESSON_TITLE_REQUIRED", messageRu: "Укажите название урока на двух языках", messageKz: "Сабақ атауын екі тілде көрсетіңіз" });
      if (lesson.kind === "TEXT" && (!lesson.textRu.trim() || !lesson.textKz.trim())) add({ ...location, code: "LESSON_TEXT_REQUIRED", messageRu: "Добавьте текст урока на двух языках", messageKz: "Сабақ мәтінін екі тілде қосыңыз" });
      if (["PDF", "VIDEO", "FILE"].includes(lesson.kind) && !lesson.materialId) add({ ...location, code: "MATERIAL_REQUIRED", messageRu: "Загрузите материал урока", messageKz: "Сабақ материалын жүктеңіз" });
      if (lesson.kind === "VIDEO" && !lesson.durationSeconds) add({ ...location, code: "VIDEO_DURATION_REQUIRED", messageRu: "Укажите длительность видео", messageKz: "Бейне ұзақтығын көрсетіңіз" });
    }
  }
  const checks = [
    { run: () => assertPublishable(content, profile), target: "overview" as PublicationIssue["target"] },
    ...content.exam.questions.map((question) => ({ run: () => assertQuestionPublishable(question), target: "exam" as const, questionId: question.id })),
    ...content.modules.flatMap((module) => module.lessons.flatMap((lesson) => (lesson.assessment?.questions || []).map((question) => ({ run: () => assertQuestionPublishable(question), target: "modules" as const, moduleId: module.id, lessonId: lesson.id, questionId: question.id })))),
  ];
  for (const check of checks) {
    try { check.run(); } catch (error) {
      if (!(error instanceof HttpException) || error.getStatus() >= 500) throw error;
      const response = error.getResponse();
      if (typeof response === "string") throw error;
      const detail = response as { code: string; message: string; params?: { moduleId?: string; lessonId?: string; questionId?: string } };
      const target = check.target !== "overview" ? check.target : /QUESTION|SANITARY_THRESHOLD/.test(detail.code) ? "exam" : /LESSON|MODULE|MATERIAL|PREREQUISITE|ASSIGNMENT|SESSION|LINK|VIDEO/.test(detail.code) ? "modules" : "overview";
      if (!issues.some((item) => item.code === detail.code) || "questionId" in check) add({ ...("moduleId" in check ? { moduleId: check.moduleId } : {}), ...("lessonId" in check ? { lessonId: check.lessonId } : {}), ...("questionId" in check ? { questionId: check.questionId } : {}), ...detail.params, code: detail.code, messageRu: detail.code === "QUESTION_INVALID" ? "Проверьте текст, варианты и правила оценки вопроса" : detail.message, messageKz: target === "exam" ? "Қорытынды тексерудегі сұрақтарды, аудармаларды және бағалау шарттарын толтырыңыз" : target === "modules" ? "Осы оқу элементінің мазмұнын және міндетті шарттарын толтырыңыз" : "Бағдарлама мәліметтерін және құжатты рәсімдеу шарттарын толтырыңыз", target });
    }
  }
  return issues;
}

export async function versionView(
  c: Context,
  version: Awaited<ReturnType<typeof db.courseVersion.findFirstOrThrow>>,
  tx: Prisma.TransactionClient = db,
) {
  const profile = await tx.regulatoryProfileVersion.findFirstOrThrow({
    where: { id: version.regulatoryProfileVersionId, tenantId: c.tenantId },
  });
  const content = courseContentSchema.parse(version.content);
  const courseAllowedActions = await courseActions(c, version.courseId, tx);
  const review = await tx.lmsCourseReview.findFirst({
    where: {
      tenantId: c.tenantId,
      courseVersionId: version.id,
      revision: version.revision,
      contentHash: hash({
        content: version.content,
        profile: profile.definition,
      }),
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
  });
  const allowedActions = courseAllowedActions.filter((action) => {
    if (action === "clone") return version.status === "PUBLISHED";
    if (
      [
        "edit",
        "submitReview",
        "publish",
        "approveReview",
        "returnReview",
      ].includes(action) &&
      version.status !== "DRAFT"
    )
      return false;
    if (action === "publish")
      return canManageLearning(c.role) || review?.state === "APPROVED";
    if (action === "approveReview" || action === "returnReview")
      return review?.state === "PENDING";
    if (action === "submitReview") return review?.state !== "PENDING";
    return true;
  });
  return {
    ...version,
    allowedActions,
    review,
    publicationIssues: version.status === "DRAFT" && courseAllowedActions.some((action) => ["edit", "publish", "submitReview"].includes(action))
      ? publicationIssues(content, regulatoryProfileSchema.parse(profile.definition))
      : [],
    content: courseAllowedActions.some((a) => a === "edit" || a === "publish")
      ? content
      : courseOutline(content),
    profile: profile.definition,
  };
}
export async function listCourses(c: Context, query: unknown) {
  const { page, pageSize, search, status } = parse(pagingSchema, query);
  const staff = (isLmsStaff(c) || isTeachingRole(c)) && status !== "PUBLISHED";
  const scoped = isTeachingRole(c) && !isLmsStaff(c);
  const canAssign = isLmsStaff(c) || (c.role === "EMPLOYER" && (await employerMemberships(c, true)).length > 0);
  const [items, counts] = await Promise.all([
    db.$queryRaw<CourseListRow[]>`
      SELECT c.id, c."titleRu", c."titleKz", c."assignmentPaused", c."assignmentPauseReason",
        jsonb_build_object('id', v.id, 'version', v.version, 'status', v.status,
          'content', jsonb_build_object('titleRu', v.content->>'titleRu', 'titleKz', v.content->>'titleKz',
            'category', v.content->>'category', 'hours', v.content->'hours', 'accessDays', v.content->'accessDays', 'metadata', v.content->'metadata'),
          'profile', jsonb_build_object('status', p.status, 'assessmentKind', p.definition->>'assessmentKind', 'legalForm', p.definition->>'legalForm')) AS "latestVersion",
        CASE WHEN r.id IS NULL THEN NULL ELSE jsonb_build_object('status', r.status, 'note', r.note, 'updatedAt', r."updatedAt") END AS "currentReview"
      FROM "Course" c
      JOIN LATERAL (SELECT id, version, status, content, "regulatoryProfileVersionId" FROM "CourseVersion"
        WHERE "tenantId"=${c.tenantId} AND "courseId"=c.id AND (${staff} OR status='PUBLISHED')
        ORDER BY version DESC LIMIT 1) v ON true
      JOIN "RegulatoryProfileVersion" p ON p.id=v."regulatoryProfileVersionId" AND p."tenantId"=${c.tenantId}
      LEFT JOIN "RegulatoryReview" r ON r."courseId"=c.id AND r."tenantId"=${c.tenantId}
      WHERE c."tenantId"=${c.tenantId} AND c.archived=false AND (NOT ${scoped} OR EXISTS (SELECT 1 FROM "LmsTeachingBinding" b WHERE b."tenantId"=c."tenantId" AND b."courseId"=c.id AND b."userId"=${c.userId} AND b."revokedAt" IS NULL AND ${teachingBindingPermissionSql("READ", "b")})) AND
        (${search}='' OR POSITION(lower(${search}) IN lower(c."titleRu"))>0 OR POSITION(lower(${search}) IN lower(c."titleKz"))>0)
      ORDER BY c."createdAt" DESC, c.id ASC LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`,
    db.$queryRaw<Array<{ total: bigint }>>`
      SELECT count(*) AS total FROM "Course" c WHERE c."tenantId"=${c.tenantId} AND c.archived=false
      AND (NOT ${scoped} OR EXISTS (SELECT 1 FROM "LmsTeachingBinding" b WHERE b."tenantId"=c."tenantId" AND b."courseId"=c.id AND b."userId"=${c.userId} AND b."revokedAt" IS NULL AND ${teachingBindingPermissionSql("READ", "b")}))
      AND (${search}='' OR POSITION(lower(${search}) IN lower(c."titleRu"))>0 OR POSITION(lower(${search}) IN lower(c."titleKz"))>0)
      AND EXISTS (SELECT 1 FROM "CourseVersion" v WHERE v."tenantId"=${c.tenantId} AND v."courseId"=c.id AND (${staff} OR v.status='PUBLISHED'))`,
  ]);
  return {
    items: await Promise.all(
      items.map(async (item) => {
        const published = item.latestVersion.status === "PUBLISHED" ? null : await db.courseVersion.findFirst({ where: { tenantId: c.tenantId, courseId: item.id, status: "PUBLISHED" }, orderBy: { version: "desc" } });
        const publishedProfile = published ? await db.regulatoryProfileVersion.findFirstOrThrow({ where: { tenantId: c.tenantId, id: published.regulatoryProfileVersionId } }) : null;
        const publishedContent = published ? courseContentSchema.parse(published.content) : null;
        const definition = publishedProfile ? regulatoryProfileSchema.parse(publishedProfile.definition) : null;
        return {
          ...item,
          publishedVersion: item.latestVersion.status === "PUBLISHED" ? item.latestVersion : published && publishedContent && definition ? {
            id: published.id, version: published.version, status: published.status,
            content: { titleRu: publishedContent.titleRu, titleKz: publishedContent.titleKz, category: publishedContent.category, hours: publishedContent.hours, accessDays: publishedContent.accessDays, metadata: publishedContent.metadata },
            profile: { status: definition.status, assessmentKind: definition.assessmentKind, legalForm: definition.legalForm },
          } : null,
          allowedActions: [...await courseActions(c, item.id), ...(canAssign ? ["assign"] : [])],
        };
      }),
    ),
    total: Number(counts[0]?.total || 0),
    page,
    pageSize,
  };
}
export async function getCourse(c: Context, id: string) {
  const course = await db.course.findFirst({
    where: {
      id,
      tenantId: c.tenantId,
      ...(!isLmsStaff(c) && !isTeachingRole(c) ? { archived: false } : {}),
    },
  });
  if (!course) fail(404, "NOT_FOUND", "Курс не найден");
  if (
    isTeachingRole(c) &&
    !(await hasLearningPermission(c, id, null, "READ")) &&
    !(await db.lmsTeachingBinding.findFirst({
      where: {
        tenantId: c.tenantId,
        userId: c.userId,
        courseId: id,
        revokedAt: null,
        ...teachingBindingPermissionWhere("READ"),
      },
    }))
  )
    fail(404, "NOT_FOUND", "Курс не найден");
  const versions = await db.courseVersion.findMany({
    where: {
      tenantId: c.tenantId,
      courseId: id,
      ...(!isLmsStaff(c) && !isTeachingRole(c) ? { status: "PUBLISHED" } : {}),
    },
    orderBy: { version: "desc" },
  });
  if (!versions.length) fail(404, "NOT_FOUND", "Курс не найден");
  return {
    demoOnly: (await db.tenant.findUnique({ where: { id: c.tenantId }, select: { demoOnly: true } }))?.demoOnly === true,
    course: {
      ...course,
      allowedActions: [...await courseActions(c, id), ...(isLmsStaff(c) || (c.role === "EMPLOYER" && (await employerMemberships(c, true)).length > 0) ? ["assign"] : [])],
      currentReview: await db.regulatoryReview.findFirst({
        where: { tenantId: c.tenantId, courseId: id },
      }),
    },
    versions: await Promise.all(versions.map((v) => versionView(c, v))),
  };
}
export async function createCourse(c: Context, input: unknown) {
  if (c.learningMode || !canAuthorPrograms(c.role))
    fail(403, "LEARNING_PERMISSION_DENIED", "Создание программ доступно методисту и администратору");
  const data = parse(courseInputSchema, input);
  return transaction(async (tx) => {
    data.profile = await normalizeSourceReferences(tx, c, data.profile);
    const course = await tx.course.create({
      data: {
        tenantId: c.tenantId,
        titleRu: data.content.titleRu,
        titleKz: data.content.titleKz,
        createdBy: c.userId,
      },
    });
    if (c.role === "METHODIST") {
      const binding = await tx.lmsTeachingBinding.create({
        data: {
          tenantId: c.tenantId,
          userId: c.userId,
          courseId: course.id,
          groupId: null,
          role: "METHODIST",
          permissions: json(teachingRolePermissions.METHODIST),
          createdBy: c.userId,
        },
      });
      await audit(tx, c, "LMS_TEACHING_BINDING_CREATED", binding.id, {
        userId: c.userId,
        role: "METHODIST",
        courseId: course.id,
        groupId: null,
        source: "COURSE_CREATION",
      });
    }
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
  const data = parse(versionInputSchema, input);
  return transaction(async (tx) => {
    await tx.$executeRaw`SELECT id FROM "CourseVersion" WHERE id=${id} AND "tenantId"=${c.tenantId} FOR UPDATE`;
    const version = await tx.courseVersion.findFirst({
      where: { id, tenantId: c.tenantId },
    });
    if (!version) fail(404, "NOT_FOUND", "Версия не найдена");
    await assertLearningPermission(c, version.courseId, null, "EDIT", tx);
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
    data.profile = await normalizeSourceReferences(tx, c, data.profile);
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
  const value = parse(pauseInput, input);
  return transaction(async (tx) => {
    await assertLearningPermission(c, id, null, "MANAGE", tx);
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
  const value = parse(reviewInput, input);
  return transaction(async (tx) => {
    await assertLearningPermission(c, id, null, "MANAGE", tx);
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
    // An identical retry is the same fact, including its notification delivery key.
    if (before?.status === value.status && before.note === value.note) return before;
    const updatedAt = new Date(Math.max(Date.now(), (before?.updatedAt.getTime() || 0) + 1));
    const review = await tx.regulatoryReview.upsert({
      where: { tenantId_courseId: { tenantId: c.tenantId, courseId: id } },
      create: {
        tenantId: c.tenantId,
        courseId: id,
        ...value,
        updatedBy: c.userId,
        updatedAt,
      },
      update: { ...value, updatedBy: c.userId, updatedAt },
    });
    await audit(tx, c, "LMS_REGULATORY_REVIEWED", id, {
      before: before ? { status: before.status, note: before.note } : null,
      after: value,
    });
    if (review.status !== "CURRENT") await enqueueRegulatoryNotification(tx, review);
    return review;
  });
}
export async function cloneVersion(c: Context, courseId: string) {
  return transaction(async (tx) => {
    await assertLearningPermission(c, courseId, null, "EDIT", tx);
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
  const { revision } = parse(revisionSchema, input);
  return transaction(async (tx) => {
    // Serialise the tenant course graph so concurrent publications cannot each validate against an older graph.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${"lms-course-publication:" + c.tenantId}, 0))`;
    await tx.$executeRaw`SELECT id FROM "CourseVersion" WHERE id=${id} AND "tenantId"=${c.tenantId} FOR UPDATE`;
    const version = await tx.courseVersion.findFirst({
      where: { id, tenantId: c.tenantId },
    });
    if (!version) fail(404, "NOT_FOUND", "Версия не найдена");
    await assertLearningPermission(c, version.courseId, null, "PUBLISH", tx);
    if (version.status === "PUBLISHED") return versionView(c, version, tx);
    if (version.revision !== revision)
      fail(409, "REVISION_CONFLICT", "Сохраните актуальную версию курса");
    const profile = await tx.regulatoryProfileVersion.findFirstOrThrow({
      where: { tenantId: c.tenantId, id: version.regulatoryProfileVersionId },
    });
    // Review pins the canonical content. Publication must not transform the approved snapshot.
    let content = courseContentSchema.parse(version.content);
    const definition = regulatoryProfileSchema.parse(profile.definition);
    assertPublishable(content, definition);
    await validatePublishedDependencies(tx, c, version.courseId, content);
    const review = await tx.lmsCourseReview.findFirst({
      where: {
        tenantId: c.tenantId,
        courseVersionId: id,
        revision,
        contentHash: hash({
          content: version.content,
          profile: profile.definition,
        }),
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    });
    if (review?.state !== "APPROVED") {
      if (!canManageLearning(c.role))
        fail(
          409,
          "COURSE_REVIEW_REQUIRED",
          "Отправьте актуальную редакцию на проверку и получите одобрение",
        );
      // The existing administrator publication action is itself an explicit approval.
      content = await normalizeCourseQuestions(
        tx,
        c,
        version.courseId,
        content,
        content,
        true,
      );
      await tx.lmsCourseReview.create({
        data: {
          tenantId: c.tenantId,
          courseVersionId: id,
          revision,
          contentHash: hash({ content, profile: definition }),
          state: "APPROVED",
          feedback: "Утверждено администратором при публикации",
          actorId: c.userId,
        },
      });
    }
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
        const material = await assertMaterialForCourse(
          tx,
          c,
          version.courseId,
          lesson.materialId,
        );
        if (
          !material ||
          (lesson.kind === "PDF" && material.mimeType !== "application/pdf") ||
          (lesson.kind === "VIDEO" && !material.mimeType.startsWith("video/"))
        )
          fail(400, "MATERIAL_INVALID", "Проверьте файл урока");
      }
    for (const lesson of content.modules.flatMap((m) => m.lessons))
      for (const track of lesson.subtitles || []) {
        const material = await assertMaterialForCourse(
          tx,
          c,
          version.courseId,
          track.materialId,
        );
        if (material.mimeType !== "text/vtt")
          fail(400, "SUBTITLE_FORMAT", "Субтитры должны быть в формате WebVTT");
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
