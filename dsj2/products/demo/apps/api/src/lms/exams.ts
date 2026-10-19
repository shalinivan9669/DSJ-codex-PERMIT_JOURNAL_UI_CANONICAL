import {
  courseContentSchema,
  regulatoryProfileSchema,
  type AssessmentKind,
  type CourseContent,
  type LearningAnswers,
} from "@demo/contracts/src/lms";
import type { ExamAttempt, Prisma } from "@demo/database";

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
import { learnerEnrollment, scopedEnrollment } from "./scope";
import { answersInputSchema } from "./validation";
import { shuffled } from "./engine";
import {
  gradeLearningAnswers,
  publicQuestion,
  validateLearningAnswers,
} from "./assessment-grading";
import { effectiveResult } from "./enrollments";
import { finalizeLmsResult } from "./result-finalization";
import {
  evaluateLearningEligibility,
  recordLearningCompletion,
} from "./learning-eligibility";
import { hasLearningPermission, isTeachingRole } from "./learning-permissions";
import { assertFinalAdmission } from "./final-admission";
import { enqueueEnrollmentNotification, enqueueReviewNotification } from "./notification-events";
import { proctorApproval } from "./proctoring";

export type ExamSnapshot = {
  questions: CourseContent["exam"]["questions"];
  policy: CourseContent["exam"];
  profile: ReturnType<typeof regulatoryProfileSchema.parse>;
};
export function attemptContentHash(attempt: ExamAttempt) {
  return hash({
    snapshot: attempt.snapshot,
    answers: attempt.answers,
    submittedAt: attempt.submittedAt,
  });
}
export async function attemptView(
  c: Context,
  attempt: ExamAttempt,
  tx: Prisma.TransactionClient = db,
) {
  const snapshot = attempt.snapshot as unknown as ExamSnapshot;
  const result =
    attempt.purpose === "FINAL"
      ? await tx.verifiedExamResult.findFirst({
          where: { tenantId: c.tenantId, attemptId: attempt.id },
          select: {
            id: true,
            verdict: true,
            score: true,
            maximum: true,
            eligible: true,
            assessmentKind: true,
          },
        })
      : null;
  const events = result
    ? await tx.lmsResultEvent.findMany({
        where: {
          tenantId: c.tenantId,
          resultId: result.id,
          kind: { in: ["VOIDED", "SUPERSEDED"] },
        },
        orderBy: { createdAt: "desc" },
      })
    : [];
  let personal = c.learningMode === true || c.role !== "EMPLOYER";
  if (isTeachingRole(c)) {
    const enrollment = await tx.enrollment.findFirstOrThrow({
      where: { tenantId: c.tenantId, id: attempt.enrollmentId },
    });
    const version = await tx.courseVersion.findFirstOrThrow({
      where: { tenantId: c.tenantId, id: attempt.courseVersionId },
    });
    personal = await hasLearningPermission(
      c,
      version.courseId,
      enrollment.groupId,
      "REVIEW",
      tx,
    );
  }
  const reveal =
    personal && attempt.state === "FINISHED" && snapshot.policy.revealAnswers;
  const [usedAttempts, reviewDecision] = await Promise.all([
    personal ? tx.examAttempt.count({ where: { tenantId: c.tenantId, enrollmentId: attempt.enrollmentId, assessmentId: attempt.assessmentId } }) : Promise.resolve(0),
    personal && attempt.state === "FINISHED" ? tx.lmsReviewDecision.findFirst({ where: { tenantId: c.tenantId, attemptId: attempt.id, decision: "GRADE" }, orderBy: { createdAt: "desc" }, select: { feedback: true, createdAt: true } }) : Promise.resolve(null),
  ]);
  const grading = attempt.grading as { questionScores?: Record<string, number | null>; algorithmVersion?: string } | null;
  return {
    id: attempt.id,
    enrollmentId: attempt.enrollmentId,
    assessmentId: attempt.assessmentId,
    purpose: attempt.purpose,
    state: attempt.state,
    sequence: attempt.sequence,
    serverNow: new Date().toISOString(),
    startedAt: attempt.startedAt,
    deadlineAt: attempt.deadlineAt,
    submittedAt: attempt.submittedAt,
    gradedAt: attempt.gradedAt,
    finishedAt: attempt.finishedAt,
    ordinal: attempt.ordinal,
    assessmentKind: attempt.assessmentKind,
    answers: personal ? attempt.answers : {},
    review: personal ? {
      thresholdPercent: snapshot.policy.thresholdPercent,
      comparison: snapshot.policy.comparison,
      remainingAttempts: Math.max(0, snapshot.policy.maxAttempts - usedAttempts),
      revealAnswers: !!reveal,
      questionScores: attempt.state === "FINISHED" ? grading?.questionScores || {} : {},
      feedback: reviewDecision?.feedback || null,
      reviewedAt: reviewDecision?.createdAt || null,
    } : null,
    questions: personal
      ? snapshot.questions.map((q) => publicQuestion(q, reveal))
      : [],
    score: attempt.state === "FINISHED" ? attempt.score : null,
    maximum: attempt.maximum,
    verdict: attempt.verdict,
    result: result
      ? effectiveResult(result, events)
      : attempt.state === "FINISHED"
        ? {
            verdict: attempt.verdict,
            score: attempt.score,
            maximum: attempt.maximum,
            eligible: false,
            assessmentKind: attempt.assessmentKind,
          }
        : null,
  };
}
async function recordFinished(
  tx: Prisma.TransactionClient,
  c: Context,
  attempt: ExamAttempt,
) {
  if (attempt.purpose === "FINAL") {
    await finalizeLmsResult(tx, c, {
      enrollmentId: attempt.enrollmentId,
      attemptId: attempt.id,
      assessmentKind: attempt.assessmentKind as AssessmentKind,
      verdict: attempt.verdict as "PASSED" | "FAILED",
      score: attempt.score,
      maximum: attempt.maximum,
      examAt: attempt.finishedAt,
    });
  }
  const enrollment = await tx.enrollment.findFirstOrThrow({
    where: { tenantId: c.tenantId, id: attempt.enrollmentId },
  });
  const version = await tx.courseVersion.findFirstOrThrow({
    where: { tenantId: c.tenantId, id: attempt.courseVersionId },
  });
  await recordLearningCompletion(
    tx,
    c,
    enrollment,
    courseContentSchema.parse(version.content),
  );
}
export async function finishAttempt(
  tx: Prisma.TransactionClient,
  c: Context,
  attempt: ExamAttempt,
  at: Date,
) {
  if (attempt.state !== "IN_PROGRESS") return attempt;
  const snapshot = attempt.snapshot as unknown as ExamSnapshot;
  const graded = gradeLearningAnswers(
    snapshot.questions,
    attempt.answers as LearningAnswers,
    snapshot.policy,
  );
  const submittedAt = at > attempt.deadlineAt ? attempt.deadlineAt : at;
  const pending = graded.verdict === "AWAITING_REVIEW" || (attempt.purpose === "FINAL" && snapshot.profile.requiresProctoring);
  const finished = await tx.examAttempt.update({
    where: { id: attempt.id },
    data: {
      state: pending ? "AWAITING_REVIEW" : "FINISHED",
      activeKey: pending ? attempt.activeKey : null,
      submittedAt,
      gradedAt: pending ? null : at,
      finishedAt: pending ? null : submittedAt,
      score: pending ? null : graded.score,
      maximum: graded.maxScore,
      verdict: pending ? "AWAITING_REVIEW" : graded.verdict,
      grading: json(graded),
    },
  });
  if (!pending) await recordFinished(tx, c, finished);
  else await enqueueReviewNotification(tx, { id: attempt.enrollmentId, tenantId: attempt.tenantId }, { type: "ATTEMPT", id: attempt.id, revision: 1 });
  await audit(
    tx,
    c,
    pending ? "LMS_EXAM_AWAITING_REVIEW" : "LMS_EXAM_FINISHED",
    attempt.id,
    {
      verdict: graded.verdict,
      purpose: attempt.purpose,
      timedOut: at >= attempt.deadlineAt,
    },
  );
  return finished;
}
/** Requires the immutable scoped decision in this same transaction. */
export async function completeReviewedAttempt(
  tx: Prisma.TransactionClient,
  c: Context,
  attempt: ExamAttempt,
  scores: Record<string, 0 | 1>,
) {
  if (attempt.state !== "AWAITING_REVIEW" || !attempt.submittedAt)
    fail(409, "REVIEW_CONFLICT", "Попытка уже проверена");
  const snapshot = attempt.snapshot as unknown as ExamSnapshot;
  if (attempt.purpose === "FINAL" && snapshot.profile.requiresProctoring && (snapshot.profile.proctoringMode !== "LOCAL_SUPERVISED" || !await proctorApproval(tx, c.tenantId, attempt))) fail(409, "PROCTORING_REVIEW_REQUIRED", "Назначенный наблюдатель должен сначала подтвердить эту попытку в журнале контроля экзамена");
  const graded = gradeLearningAnswers(
    snapshot.questions,
    attempt.answers as LearningAnswers,
    snapshot.policy,
    scores,
  );
  if (graded.verdict === "AWAITING_REVIEW")
    fail(
      400,
      "MANUAL_SCORES_REQUIRED",
      "Оцените каждый ответ, ожидающий проверки",
    );
  const decision = await tx.lmsReviewDecision.findFirst({
    where: {
      tenantId: c.tenantId,
      attemptId: attempt.id,
      decision: "GRADE",
      contentHash: attemptContentHash(attempt),
    },
  });
  if (!decision || hash(decision.questionScores) !== hash(scores))
    fail(409, "REVIEW_CONFLICT", "Решение не соответствует ответам");
  const finished = await tx.examAttempt.update({
    where: { id: attempt.id },
    data: {
      state: "FINISHED",
      activeKey: null,
      gradedAt: new Date(),
      finishedAt: attempt.submittedAt,
      score: graded.score,
      maximum: graded.maxScore,
      verdict: graded.verdict,
      grading: json(graded),
    },
  });
  await recordFinished(tx, c, finished);
  await audit(tx, c, "LMS_EXAM_REVIEWED", attempt.id, {
    decisionId: decision.id,
    verdict: graded.verdict,
  });
  return finished;
}
export async function startAttempt(
  c: Context,
  enrollmentId: string,
  assessmentId = "FINAL",
) {
  return transaction(async (tx) => {
    await tx.$executeRaw`SELECT id FROM "Enrollment" WHERE id=${enrollmentId} AND "tenantId"=${c.tenantId} FOR UPDATE`;
    const enrollment = await learnerEnrollment(c, enrollmentId, tx);
    const version = await tx.courseVersion.findFirstOrThrow({
      where: {
        tenantId: c.tenantId,
        id: enrollment.courseVersionId,
        status: "PUBLISHED",
      },
    });
    const profileVersion = await tx.regulatoryProfileVersion.findFirstOrThrow({
      where: { tenantId: c.tenantId, id: version.regulatoryProfileVersionId },
    });
    const content = courseContentSchema.parse(version.content);
    const profile = regulatoryProfileSchema.parse(profileVersion.definition);
    const intermediate = assessmentId !== "FINAL";
    const lesson = content.modules
      .flatMap((module) => module.lessons)
      .find((item) => item.id === assessmentId);
    if (intermediate && (lesson?.kind !== "ASSESSMENT" || !lesson.assessment))
      fail(404, "NOT_FOUND", "Проверка не найдена");
    const policy = intermediate ? lesson!.assessment! : content.exam;
    const active = await tx.examAttempt.findFirst({
      where: {
        tenantId: c.tenantId,
        enrollmentId,
        assessmentId,
        state: { in: ["IN_PROGRESS", "AWAITING_REVIEW"] },
      },
    });
    if (active)
      return attemptView(
        c,
        active.state === "IN_PROGRESS" && active.deadlineAt <= new Date()
          ? await finishAttempt(tx, c, active, new Date())
          : active,
        tx,
      );
    const eligibility = await evaluateLearningEligibility(
      tx,
      c,
      enrollment,
      content,
    );
    if (intermediate) {
      const availability = eligibility.lessons.find(
        (item) => item.id === assessmentId,
      );
      if (!availability?.available)
        fail(409, "LESSON_UNAVAILABLE", "Сначала выполните условия доступа", {
          reason: availability?.reason,
        });
      if (
        lesson!.assessment!.dueAt &&
        new Date(lesson!.assessment!.dueAt!) <= new Date()
      )
        fail(409, "ASSESSMENT_EXPIRED", "Срок проверки завершён");
    } else {
      await assertFinalAdmission(
        tx,
        c,
        enrollment,
        content,
        profile,
        eligibility,
      );
    }
    const attempts = await tx.examAttempt.count({
      where: { tenantId: c.tenantId, enrollmentId, assessmentId },
    });
    if (attempts >= policy.maxAttempts)
      fail(
        409,
        "ATTEMPT_LIMIT",
        "Попытки исчерпаны. Обратитесь в учебный центр",
      );
    const questions = shuffled(policy.questions)
      .slice(0, policy.questionCount)
      .map((q) => ({ ...q, options: shuffled(q.options) }));
    if (!questions.length)
      fail(409, "EXAM_NOT_CONFIGURED", "Проверка ещё не подготовлена");
    const now = new Date();
    const snapshot: ExamSnapshot = {
      questions,
      policy: { ...policy, questions: [] },
      profile,
    };
    const attempt = await tx.examAttempt.create({
      data: {
        tenantId: c.tenantId,
        enrollmentId,
        courseVersionId: version.id,
        regulatoryProfileVersionId: profileVersion.id,
        assessmentKind: profile.assessmentKind,
        assessmentId,
        purpose: intermediate
          ? "INTERMEDIATE"
          : content.learningOutcome === "LEARNING"
            ? "LEARNING_FINAL"
            : "FINAL",
        ordinal: attempts + 1,
        activeKey: `${c.tenantId}:${enrollmentId}:${assessmentId}`,
        snapshot: json(snapshot),
        startedAt: now,
        deadlineAt: new Date(now.getTime() + policy.durationMinutes * 60000),
      },
    });
    await audit(tx, c, "LMS_EXAM_STARTED", attempt.id, {
      enrollmentId,
      assessmentId,
      ordinal: attempt.ordinal,
    });
    if (
      !attempts &&
      !(await tx.lessonProgress.findFirst({
        where: { tenantId: c.tenantId, enrollmentId },
      }))
    )
      await enqueueEnrollmentNotification(tx, enrollment, "STARTED");
    return attemptView(c, attempt, tx);
  });
}
async function activeAttemptEnrollment(
  c: Context,
  enrollmentId: string,
  tx: Prisma.TransactionClient,
  learnerOnly: boolean,
) {
  const enrollment = await scopedEnrollment(
    learnerOnly ? { ...c, learningMode: true } : c,
    enrollmentId,
    tx,
  );
  if (
    learnerOnly &&
    !(await tx.learnerProfile.findFirst({
      where: {
        tenantId: c.tenantId,
        userId: c.userId,
        recipientId: enrollment.recipientId,
      },
    }))
  )
    fail(403, "LEARNER_ONLY", "Это действие доступно слушателю");
  if (enrollment.status === "CANCELLED")
    fail(409, "ACCESS_CANCELLED", "Назначение отменено");
  return enrollment;
}
export async function getAttempt(c: Context, id: string) {
  const attempt = await db.examAttempt.findFirst({
    where: { id, tenantId: c.tenantId },
  });
  if (!attempt) fail(404, "NOT_FOUND", "Попытка не найдена");
  const enrollment = await scopedEnrollment(c, attempt.enrollmentId);
  if (
    enrollment.status !== "CANCELLED" &&
    attempt.state === "IN_PROGRESS" &&
    attempt.deadlineAt <= new Date()
  )
    return submitAttempt(c, id, false);
  return attemptView(c, attempt);
}
export async function saveAnswers(c: Context, id: string, input: unknown) {
  const data = parse(answersInputSchema, input);
  return transaction(async (tx) => {
    const candidate = await tx.examAttempt.findFirst({
      where: { id, tenantId: c.tenantId },
    });
    if (!candidate) fail(404, "NOT_FOUND", "Попытка не найдена");
    await tx.$executeRaw`SELECT id FROM "Enrollment" WHERE id=${candidate.enrollmentId} AND "tenantId"=${c.tenantId} FOR UPDATE`;
    await activeAttemptEnrollment(c, candidate.enrollmentId, tx, true);
    const attempt = await tx.examAttempt.findFirstOrThrow({
      where: { id, tenantId: c.tenantId },
    });
    if (attempt.state !== "IN_PROGRESS") return attemptView(c, attempt, tx);
    if (attempt.deadlineAt <= new Date())
      return attemptView(
        c,
        await finishAttempt(tx, c, attempt, new Date()),
        tx,
      );
    if (data.sequence < attempt.sequence) return attemptView(c, attempt, tx);
    if (data.sequence === attempt.sequence) {
      if (hash(data.answers) !== hash(attempt.answers))
        fail(
          409,
          "ANSWER_CONFLICT",
          "Ответы изменены в другой вкладке. Обновите попытку",
        );
      return attemptView(c, attempt, tx);
    }
    const snapshot = attempt.snapshot as unknown as ExamSnapshot;
    if (!validateLearningAnswers(snapshot.questions, data.answers))
      fail(400, "ANSWERS_INVALID", "Проверьте выбранные ответы");
    return attemptView(
      c,
      await tx.examAttempt.update({
        where: { id },
        data: { sequence: data.sequence, answers: json(data.answers) },
      }),
      tx,
    );
  });
}
export async function submitAttempt(
  c: Context,
  id: string,
  learnerOnly = true,
) {
  return transaction(async (tx) => {
    const candidate = await tx.examAttempt.findFirst({
      where: { id, tenantId: c.tenantId },
    });
    if (!candidate) fail(404, "NOT_FOUND", "Попытка не найдена");
    await tx.$executeRaw`SELECT id FROM "Enrollment" WHERE id=${candidate.enrollmentId} AND "tenantId"=${c.tenantId} FOR UPDATE`;
    await activeAttemptEnrollment(c, candidate.enrollmentId, tx, learnerOnly);
    const attempt = await tx.examAttempt.findFirstOrThrow({
      where: { id, tenantId: c.tenantId },
    });
    if (!learnerOnly && attempt.deadlineAt > new Date())
      fail(409, "EXAM_STILL_ACTIVE", "Время экзамена ещё не истекло");
    return attemptView(c, await finishAttempt(tx, c, attempt, new Date()), tx);
  });
}
export async function expireLmsAttempts(limit = 100) {
  const due = await db.examAttempt.findMany({
    where: { state: "IN_PROGRESS", deadlineAt: { lte: new Date() } },
    orderBy: { deadlineAt: "asc" },
    take: limit,
  });
  let completed = 0;
  for (const candidate of due)
    await transaction(async (tx) => {
      await tx.$executeRaw`SELECT id FROM "Enrollment" WHERE id=${candidate.enrollmentId} AND "tenantId"=${candidate.tenantId} FOR UPDATE`;
      const attempt = await tx.examAttempt.findFirstOrThrow({
        where: { id: candidate.id, tenantId: candidate.tenantId },
      });
      if (attempt.state !== "IN_PROGRESS") return;
      const enrollment = await tx.enrollment.findFirstOrThrow({
        where: { id: attempt.enrollmentId, tenantId: attempt.tenantId },
      });
      if (enrollment.status === "CANCELLED") return;
      const c: Context = {
        tenantId: attempt.tenantId,
        userId: enrollment.learnerUserId || enrollment.assignedBy,
        role: "LEARNER",
        sessionId: "worker",
        csrfHash: "",
        correlationId: `deadline:${attempt.id}`,
      };
      await finishAttempt(tx, c, attempt, new Date());
      completed++;
    });
  return completed;
}
