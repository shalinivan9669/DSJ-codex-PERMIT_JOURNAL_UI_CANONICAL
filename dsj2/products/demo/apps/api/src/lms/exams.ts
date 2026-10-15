import {
  courseContentSchema,
  regulatoryProfileSchema,
  type AssessmentKind,
  type CourseContent,
} from "@demo/contracts/src/lms";
import type { ExamAttempt, Prisma } from "@demo/database";
import { today } from "@demo/contracts";
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
import { gradeAnswers, shuffled, validatedAnswers } from "./engine";
import { effectiveResult, progressPercent } from "./enrollments";
import { finalizeLmsResult } from "./result-finalization";

type ExamSnapshot = {
  questions: CourseContent["exam"]["questions"];
  policy: CourseContent["exam"];
  profile: ReturnType<typeof regulatoryProfileSchema.parse>;
};

export async function attemptView(
  c: Context,
  attempt: ExamAttempt,
  tx: Prisma.TransactionClient = db,
) {
  const snapshot = attempt.snapshot as unknown as ExamSnapshot;
  const result = await tx.verifiedExamResult.findFirst({
    where: { tenantId: c.tenantId, attemptId: attempt.id },
    select: {
      id: true,
      verdict: true,
      score: true,
      maximum: true,
      eligible: true,
      assessmentKind: true,
    },
  });
  const reveal = attempt.state === "FINISHED" && snapshot.policy.revealAnswers;
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
  return {
    id: attempt.id,
    enrollmentId: attempt.enrollmentId,
    state: attempt.state,
    sequence: attempt.sequence,
    serverNow: new Date().toISOString(),
    startedAt: attempt.startedAt,
    deadlineAt: attempt.deadlineAt,
    finishedAt: attempt.finishedAt,
    ordinal: attempt.ordinal,
    assessmentKind: attempt.assessmentKind,
    answers: attempt.answers,
    questions: snapshot.questions.map(({ correctOptionIds, ...q }) => ({
      ...q,
      ...(reveal ? { correctOptionIds } : {}),
    })),
    result: result ? effectiveResult(result, events) : null,
  };
}

async function finishAttempt(
  tx: Prisma.TransactionClient,
  c: Context,
  attempt: ExamAttempt,
  at: Date,
) {
  if (attempt.state !== "IN_PROGRESS") return attempt;
  const snapshot = attempt.snapshot as unknown as ExamSnapshot;
  const graded = gradeAnswers(
    snapshot.questions,
    attempt.answers as Record<string, string[]>,
    snapshot.policy,
  );
  const finishedAt = at > attempt.deadlineAt ? attempt.deadlineAt : at;
  const finished = await tx.examAttempt.update({
    where: { id: attempt.id },
    data: {
      state: "FINISHED",
      activeKey: null,
      finishedAt,
      score: graded.score,
      maximum: graded.maxScore,
      verdict: graded.verdict,
    },
  });
  await finalizeLmsResult(tx, c, {
    enrollmentId: attempt.enrollmentId,
    attemptId: attempt.id,
    assessmentKind: attempt.assessmentKind as AssessmentKind,
    verdict: graded.verdict,
    score: graded.score,
    maximum: graded.maxScore,
    examAt: finishedAt,
  });
  await audit(tx, c, "LMS_EXAM_FINISHED", attempt.id, {
    verdict: graded.verdict,
    timedOut: at >= attempt.deadlineAt,
  });
  return finished;
}

export async function startAttempt(c: Context, enrollmentId: string) {
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
    if (profile.assessmentKind === "EXTERNAL_AUTHORIZED")
      fail(
        409,
        "WAITING_EXTERNAL",
        "Для программы требуется результат внешнего экзамена",
      );
    if (
      profile.assessmentKind === "CENTER_EXAM" &&
      (profile.status !== "CONFIRMED" || profile.competency === "GENERAL")
    )
      fail(
        409,
        "ROUTE_REVIEW_REQUIRED",
        "Маршрут экзамена требует проверки учебным центром",
      );
    if (profile.requiresProctoring || profile.requiresPractice)
      fail(
        409,
        "ASSESSMENT_REQUIREMENT",
        "Сначала подтвердите обязательную проверку по программе",
      );
    let date: string;
    try {
      new Intl.DateTimeFormat("en", { timeZone: profile.timezone });
      date = today(profile.timezone);
    } catch {
      fail(
        409,
        "ROUTE_REVIEW_REQUIRED",
        "Часовой пояс программы требует проверки",
      );
    }
    if (
      profile.assessmentKind === "CENTER_EXAM" &&
      ((profile.effectiveFrom && date < profile.effectiveFrom) ||
        (profile.effectiveUntil && date > profile.effectiveUntil))
    )
      fail(409, "ROUTE_EXPIRED", "Срок действия маршрута требует проверки");
    const progress = await tx.lessonProgress.findMany({
      where: { tenantId: c.tenantId, enrollmentId },
    });
    if (progressPercent(content, progress) !== 100)
      fail(409, "LESSONS_REQUIRED", "Завершите обязательные уроки");
    const active = await tx.examAttempt.findFirst({
      where: { tenantId: c.tenantId, enrollmentId, state: "IN_PROGRESS" },
    });
    if (active) {
      const current =
        active.deadlineAt <= new Date()
          ? await finishAttempt(tx, c, active, new Date())
          : active;
      return attemptView(c, current, tx);
    }
    const attempts = await tx.examAttempt.count({
      where: { tenantId: c.tenantId, enrollmentId },
    });
    if (attempts >= content.exam.maxAttempts)
      fail(
        409,
        "ATTEMPT_LIMIT",
        "Попытки исчерпаны. Обратитесь в учебный центр",
      );
    const questions = shuffled(content.exam.questions)
      .slice(0, content.exam.questionCount)
      .map((q) => ({ ...q, options: shuffled(q.options) }));
    if (!questions.length)
      fail(409, "EXAM_NOT_CONFIGURED", "Экзамен ещё не подготовлен");
    const now = new Date();
    const snapshot: ExamSnapshot = {
      questions,
      policy: { ...content.exam, questions: [] },
      profile,
    };
    const attempt = await tx.examAttempt.create({
      data: {
        tenantId: c.tenantId,
        enrollmentId,
        courseVersionId: version.id,
        regulatoryProfileVersionId: profileVersion.id,
        assessmentKind: profile.assessmentKind,
        ordinal: attempts + 1,
        activeKey: `${c.tenantId}:${enrollmentId}`,
        snapshot: json(snapshot),
        startedAt: now,
        deadlineAt: new Date(
          now.getTime() + content.exam.durationMinutes * 60000,
        ),
      },
    });
    await audit(tx, c, "LMS_EXAM_STARTED", attempt.id, {
      enrollmentId,
      ordinal: attempt.ordinal,
    });
    return attemptView(c, attempt, tx);
  });
}

export async function getAttempt(c: Context, id: string) {
  const attempt = await db.examAttempt.findFirst({
    where: { id, tenantId: c.tenantId },
  });
  if (!attempt) fail(404, "NOT_FOUND", "Попытка не найдена");
  await scopedEnrollment(c, attempt.enrollmentId);
  if (attempt.state === "IN_PROGRESS" && attempt.deadlineAt <= new Date())
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
    await learnerEnrollment(c, candidate.enrollmentId, tx);
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
    if (!validatedAnswers(snapshot.questions, data.answers))
      fail(400, "ANSWERS_INVALID", "Проверьте выбранные ответы");
    const saved = await tx.examAttempt.update({
      where: { id },
      data: { sequence: data.sequence, answers: json(data.answers) },
    });
    return attemptView(c, saved, tx);
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
    if (learnerOnly) await learnerEnrollment(c, candidate.enrollmentId, tx);
    else await scopedEnrollment(c, candidate.enrollmentId, tx);
    const attempt = await tx.examAttempt.findFirstOrThrow({
      where: { id, tenantId: c.tenantId },
    });
    if (!learnerOnly && attempt.deadlineAt > new Date())
      fail(409, "EXAM_STILL_ACTIVE", "Время экзамена ещё не истекло");
    return attemptView(c, await finishAttempt(tx, c, attempt, new Date()), tx);
  });
}

/** Called by the independent integration worker; closed browsers do not pause the deadline. */
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
