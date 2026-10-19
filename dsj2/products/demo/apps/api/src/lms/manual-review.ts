import { canManageLearning, z } from "@demo/contracts";
import { Prisma } from "@demo/database";
import {
  courseContentSchema,
  type LearningAnswers,
} from "@demo/contracts/src/lms";
import {
  db,
  parse,
  fail,
  hash,
  json,
  transaction,
  audit,
  type Context,
} from "../core";
import { scopedEnrollment } from "./scope";
import {
  assertLearningPermission,
  enrollmentScopeSql,
  hasLearningPermission,
  isTeachingRole,
  teachingBindingPermissionSql,
} from "./learning-permissions";
import { recordLearningCompletion } from "./learning-eligibility";
import {
  attemptContentHash,
  completeReviewedAttempt,
  type ExamSnapshot,
} from "./exams";
import { gradeLearningAnswers, publicQuestion } from "./assessment-grading";
import { attachmentView } from "./submissions";
import { enqueueEnrollmentNotification } from "./notification-events";
import { proctorApproval } from "./proctoring";

const querySchema = z.object({
  type: z.enum(["ATTEMPT", "SUBMISSION"]).optional(),
  page: z.coerce.number().int().min(1).max(100000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  courseId: z.string().uuid().optional(),
  groupId: z.string().uuid().optional(),
});
const decisionSchema = z
  .object({
    decisionKey: z.string().uuid(),
    revision: z.number().int().min(1),
    contentHash: z.string().regex(/^[a-f0-9]{64}$/),
    decision: z.enum(["GRADE", "ACCEPTED", "RETURNED", "REJECTED"]),
    feedback: z.string().max(10000),
    questionScores: z
      .record(z.string(), z.union([z.literal(0), z.literal(1)]))
      .optional(),
  })
  .strict();
type TargetType = "ATTEMPT" | "SUBMISSION";
function targetType(value: string): TargetType {
  if (value !== "ATTEMPT" && value !== "SUBMISSION")
    fail(404, "NOT_FOUND", "Проверка не найдена");
  return value;
}
function assertReviewer(c: Context) {
  if (c.learningMode || (!canManageLearning(c.role) && !isTeachingRole(c)))
    fail(403, "LEARNING_PERMISSION_DENIED", "Проверка недоступна");
}

export async function listReviews(c: Context, input: unknown) {
  assertReviewer(c);
  const query = parse(querySchema, input);
  const permission = canManageLearning(c.role)
    ? Prisma.empty
    : Prisma.sql`AND EXISTS (SELECT 1 FROM "LmsTeachingBinding" b WHERE b."tenantId"=${c.tenantId} AND b."userId"=${c.userId} AND b."courseId"=cv."courseId" AND b."revokedAt" IS NULL AND ${teachingBindingPermissionSql("READ", "b")} AND ${teachingBindingPermissionSql("REVIEW", "b")} AND (b."groupId" IS NULL OR (b."groupId"=e."groupId" AND EXISTS (SELECT 1 FROM "LmsGroupMember" gm WHERE gm."tenantId"=e."tenantId" AND gm."enrollmentId"=e.id AND gm."groupId"=b."groupId" AND gm."excludedAt" IS NULL))))`;
  const filters = Prisma.sql`${enrollmentScopeSql(c)} ${permission} AND e.status<>'CANCELLED' AND NOT EXISTS (SELECT 1 FROM "LearnerProfile" self WHERE self."tenantId"=${c.tenantId} AND self."userId"=${c.userId} AND self."recipientId"=e."recipientId") ${query.courseId ? Prisma.sql`AND cv."courseId"=${query.courseId}` : Prisma.empty} ${query.groupId ? Prisma.sql`AND e."groupId"=${query.groupId}` : Prisma.empty}`;
  const pending = Prisma.sql`WITH pending AS (
    SELECT a.id,'ATTEMPT'::text AS "targetType",a."enrollmentId",a."assessmentId" AS "elementId",a."submittedAt" AS "submittedAt",1 AS revision FROM "ExamAttempt" a WHERE a."tenantId"=${c.tenantId} AND a.state='AWAITING_REVIEW'
    UNION ALL SELECT s.id,'SUBMISSION'::text,s."enrollmentId",s."elementId",r."submittedAt",s."currentRevision" FROM "LmsSubmission" s JOIN "LmsSubmissionRevision" r ON r."tenantId"=s."tenantId" AND r."submissionId"=s.id AND r.revision=s."currentRevision" WHERE s."tenantId"=${c.tenantId} AND s.state='SUBMITTED'
  )`;
  const from = Prisma.sql`FROM pending p JOIN "Enrollment" e ON e.id=p."enrollmentId" AND e."tenantId"=${c.tenantId} JOIN "CourseVersion" cv ON cv.id=e."courseVersionId" AND cv."tenantId"=e."tenantId" JOIN "Recipient" recipient ON recipient.id=e."recipientId" AND recipient."tenantId"=e."tenantId" WHERE ${filters} ${query.type ? Prisma.sql`AND p."targetType"=${query.type}` : Prisma.empty}`;
  const [count, rows] = await Promise.all([
    db.$queryRaw<{ count: bigint }[]>(
      Prisma.sql`${pending} SELECT count(*) AS count ${from}`,
    ),
    db.$queryRaw<
      {
        id: string;
        targetType: TargetType;
        enrollmentId: string;
        elementId: string;
        submittedAt: Date;
        revision: number;
        courseId: string;
        groupId: string | null;
        learnerName: string;
        titleRu: string;
        titleKz: string;
        elementTitleRu: string | null;
        elementTitleKz: string | null;
      }[]
    >(
      Prisma.sql`${pending} SELECT p.*,cv."courseId",e."groupId",COALESCE(recipient.data->>'fullNameRu','') AS "learnerName",cv.content->>'titleRu' AS "titleRu",cv.content->>'titleKz' AS "titleKz",
        (SELECT element->>'titleRu' FROM jsonb_array_elements(cv.content->'modules') module CROSS JOIN LATERAL jsonb_array_elements(module->'lessons') element WHERE element->>'id'=p."elementId" LIMIT 1) AS "elementTitleRu",
        (SELECT element->>'titleKz' FROM jsonb_array_elements(cv.content->'modules') module CROSS JOIN LATERAL jsonb_array_elements(module->'lessons') element WHERE element->>'id'=p."elementId" LIMIT 1) AS "elementTitleKz"
        ${from} ORDER BY p."submittedAt" ASC,p.id ASC LIMIT ${query.pageSize} OFFSET ${(query.page - 1) * query.pageSize}`,
    ),
  ]);
  return {
    items: rows.map((row) => ({
      ...row,
      state: row.targetType === "ATTEMPT" ? "AWAITING_REVIEW" : "SUBMITTED",
    })),
    total: Number(count[0].count),
    page: query.page,
    pageSize: query.pageSize,
  };
}

async function reviewTarget(
  c: Context,
  kind: TargetType,
  id: string,
  tx: Prisma.TransactionClient,
  lock = false,
) {
  assertReviewer(c);
  const attempt =
    kind === "ATTEMPT"
      ? await tx.examAttempt.findFirst({ where: { tenantId: c.tenantId, id } })
      : null;
  const submission =
    kind === "SUBMISSION"
      ? await tx.lmsSubmission.findFirst({
          where: { tenantId: c.tenantId, id },
        })
      : null;
  const candidate = attempt || submission;
  if (!candidate) fail(404, "NOT_FOUND", "Работа не найдена");
  if (lock)
    await tx.$executeRaw`SELECT id FROM "Enrollment" WHERE id=${candidate.enrollmentId} AND "tenantId"=${c.tenantId} FOR UPDATE`;
  const enrollment = await scopedEnrollment(c, candidate.enrollmentId, tx);
  const version = await tx.courseVersion.findFirstOrThrow({
    where: { tenantId: c.tenantId, id: enrollment.courseVersionId },
  });
  await assertLearningPermission(
    c,
    version.courseId,
    enrollment.groupId,
    "REVIEW",
    tx,
  );
  if (
    !canManageLearning(c.role) &&
    !(await hasLearningPermission(c, version.courseId, null, "REVIEW", tx)) &&
    !(await tx.lmsGroupMember.findFirst({
      where: {
        tenantId: c.tenantId,
        enrollmentId: enrollment.id,
        groupId: enrollment.groupId || "",
        excludedAt: null,
      },
      select: { id: true },
    }))
  )
    fail(403, "LEARNING_PERMISSION_DENIED", "Слушатель больше не входит в назначенную вам группу");
  if (
    await tx.learnerProfile.findFirst({
      where: {
        tenantId: c.tenantId,
        userId: c.userId,
        recipientId: enrollment.recipientId,
      },
    })
  )
    fail(403, "SELF_REVIEW_FORBIDDEN", "Нельзя проверять собственную работу");
  // Reload after the enrollment lock; an older target object cannot carry a concurrent decision.
  const currentAttempt =
    attempt && lock
      ? await tx.examAttempt.findFirstOrThrow({
          where: { tenantId: c.tenantId, id },
        })
      : attempt;
  const currentSubmission =
    submission && lock
      ? await tx.lmsSubmission.findFirstOrThrow({
          where: { tenantId: c.tenantId, id },
        })
      : submission;
  const revision = currentSubmission
    ? await tx.lmsSubmissionRevision.findFirst({
        where: {
          tenantId: c.tenantId,
          submissionId: id,
          revision: currentSubmission.currentRevision,
        },
      })
    : null;
  if (currentSubmission && !revision)
    fail(404, "NOT_FOUND", "Работа ещё не отправлена");
  return {
    enrollment,
    version,
    attempt: currentAttempt,
    submission: currentSubmission,
    revision,
  };
}

export async function reviewDetail(
  c: Context,
  type: string,
  id: string,
  tx: Prisma.TransactionClient = db,
) {
  const kind = targetType(type);
  const target = await reviewTarget(c, kind, id, tx);
  const recipient = await tx.recipient.findFirstOrThrow({
    where: { tenantId: c.tenantId, id: target.enrollment.recipientId },
  });
  const history = await tx.lmsReviewDecision.findMany({
    where: { tenantId: c.tenantId, targetType: kind, targetId: id },
    orderBy: { revision: "desc" },
  });
  const users = await tx.user.findMany({
    where: {
      tenantId: c.tenantId,
      id: { in: history.map((item) => item.actorId) },
    },
    select: { id: true, displayName: true },
  });
  const content = courseContentSchema.parse(target.version.content);
  const common = {
    id,
    targetType: kind,
    enrollmentId: target.enrollment.id,
    courseId: target.version.courseId,
    groupId: target.enrollment.groupId,
    learnerName: (recipient.data as { fullNameRu?: string }).fullNameRu || "",
    titleRu: content.titleRu,
    titleKz: content.titleKz,
    courseTitleRu: content.titleRu,
    courseTitleKz: content.titleKz,
    history: history.map((item) => ({
      decision: item.decision,
      feedback: item.feedback,
      reviewerName:
        users.find((user) => user.id === item.actorId)?.displayName || null,
      createdAt: item.createdAt,
      revision: item.revision,
    })),
  };
  if (target.attempt) {
    const attempt = target.attempt;
    const frozen = attempt.snapshot as unknown as ExamSnapshot;
    const grading = gradeLearningAnswers(
      frozen.questions,
      attempt.answers as LearningAnswers,
      frozen.policy,
    );
    return {
      ...common,
      revision: 1,
      contentHash: attemptContentHash(attempt),
      state: attempt.state,
      submittedAt: attempt.submittedAt,
      assessmentId: attempt.assessmentId,
      questions: frozen.questions.map((question) => publicQuestion(question)),
      answers: attempt.answers,
      pendingQuestionIds: grading.pendingQuestionIds,
      proctoringPending: attempt.purpose === "FINAL" && frozen.profile.requiresProctoring && !await proctorApproval(tx, c.tenantId, attempt),
      allowedActions:
        attempt.state === "AWAITING_REVIEW" &&
        target.enrollment.status !== "CANCELLED"
          ? ["GRADE"]
          : [],
    };
  }
  const revision = target.revision!;
  const frozen = revision.snapshot as unknown as {
    lesson: CourseContentLesson;
  };
  const answer = revision.content as { text: string; attachmentIds: string[] };
  const files = await tx.lmsSubmissionAttachment.findMany({
    where: {
      tenantId: c.tenantId,
      enrollmentId: target.enrollment.id,
      elementId: target.submission!.elementId,
      id: { in: answer.attachmentIds },
    },
  });
  return {
    ...common,
    titleRu: frozen.lesson.titleRu,
    titleKz: frozen.lesson.titleKz,
    revision: revision.revision,
    contentHash: revision.hash,
    state: target.submission!.state,
    submittedAt: revision.submittedAt,
    text: answer.text,
    attachments: files.map(attachmentView),
    ...frozen.lesson.assignment,
    allowedActions:
      target.submission!.state === "SUBMITTED" &&
      target.enrollment.status !== "CANCELLED"
        ? ["ACCEPTED", "RETURNED", "REJECTED"]
        : [],
  };
}
type CourseContentLesson = ReturnType<
  typeof courseContentSchema.parse
>["modules"][number]["lessons"][number];

export async function decideReview(
  c: Context,
  type: string,
  id: string,
  input: unknown,
) {
  const kind = targetType(type);
  const data = parse(decisionSchema, input);
  if (["RETURNED", "REJECTED"].includes(data.decision) && !data.feedback.trim())
    fail(400, "REVIEW_FEEDBACK_REQUIRED", "Укажите причину решения");
  return transaction(async (tx) => {
    const target = await reviewTarget(c, kind, id, tx, true);
    const replay = await tx.lmsReviewDecision.findFirst({
      where: { tenantId: c.tenantId, decisionKey: data.decisionKey },
    });
    if (replay) {
      if (
        replay.targetType !== kind ||
        replay.targetId !== id ||
        (replay.snapshot as { requestHash?: string }).requestHash !== hash(data)
      )
        fail(409, "REVIEW_CONFLICT", "Ключ решения уже использован");
      return reviewDetail(c, kind, id, tx);
    }
    if (target.enrollment.status === "CANCELLED")
      fail(409, "ACCESS_CANCELLED", "Назначение отменено");
    const currentRevision = target.attempt ? 1 : target.revision!.revision;
    const contentHash = target.attempt
      ? attemptContentHash(target.attempt)
      : target.revision!.hash;
    if (
      data.revision !== currentRevision ||
      data.contentHash !== contentHash ||
      (target.attempt
        ? target.attempt.state !== "AWAITING_REVIEW"
        : target.submission!.state !== "SUBMITTED")
    )
      fail(
        409,
        "REVIEW_CONFLICT",
        "Работа уже проверена или появилась новая редакция",
      );
    if (target.attempt) {
      if (data.decision !== "GRADE")
        fail(400, "REVIEW_DECISION_INVALID", "Требуется оценка ответов");
      const frozen = target.attempt.snapshot as unknown as ExamSnapshot;
      const pending = gradeLearningAnswers(
        frozen.questions,
        target.attempt.answers as LearningAnswers,
        frozen.policy,
      ).pendingQuestionIds;
      if (
        !data.questionScores ||
        Object.keys(data.questionScores).length !== pending.length ||
        pending.some(
          (questionId) => !Object.hasOwn(data.questionScores!, questionId),
        )
      )
        fail(
          400,
          "MANUAL_SCORES_REQUIRED",
          "Оцените каждый ответ, ожидающий проверки",
        );
    } else if (data.decision === "GRADE" || data.questionScores)
      fail(400, "REVIEW_DECISION_INVALID", "Выберите решение по работе");
    const decision = await tx.lmsReviewDecision.create({
      data: {
        tenantId: c.tenantId,
        targetType: kind,
        targetId: id,
        revision: currentRevision,
        contentHash,
        decisionKey: data.decisionKey,
        decision: data.decision,
        questionScores: data.questionScores
          ? json(data.questionScores)
          : undefined,
        feedback: data.feedback.trim(),
        actorId: c.userId,
        snapshot: json({
          requestHash: hash(data),
          courseVersionId: target.version.id,
          groupId: target.enrollment.groupId,
        }),
        attemptId: target.attempt?.id || null,
        submissionRevisionId: target.revision?.id || null,
      },
    });
    if (target.attempt)
      await completeReviewedAttempt(
        tx,
        c,
        target.attempt,
        data.questionScores!,
      );
    else {
      await tx.lmsSubmission.update({
        where: { id },
        data: { state: data.decision },
      });
      await recordLearningCompletion(
        tx,
        c,
        target.enrollment,
        courseContentSchema.parse(target.version.content),
      );
    }
    await audit(tx, c, "LMS_REVIEW_DECIDED", id, {
      decisionId: decision.id,
      decision: data.decision,
      revision: currentRevision,
    });
    if (kind === "SUBMISSION") await enqueueEnrollmentNotification(tx, target.enrollment, "RESULT", {
      sourceType: "SUBMISSION", sourceId: id, key: `RESULT:SUBMISSION:${id}:${currentRevision}`,
      titleRu: data.decision === "ACCEPTED" ? "Преподаватель принял работу" : data.decision === "RETURNED" ? "Преподаватель вернул работу на доработку" : "Преподаватель отклонил работу",
      titleKz: data.decision === "ACCEPTED" ? "Оқытушы жұмысты қабылдады" : data.decision === "RETURNED" ? "Оқытушы жұмысты түзетуге қайтарды" : "Оқытушы жұмысты қабылдамады",
    });
    return reviewDetail(c, kind, id, tx);
  });
}
