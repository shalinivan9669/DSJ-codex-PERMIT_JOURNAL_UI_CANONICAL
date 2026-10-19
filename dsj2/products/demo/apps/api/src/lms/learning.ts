import {
  courseContentSchema,
  regulatoryProfileSchema,
} from "@demo/contracts/src/lms";
import { HttpException } from "@nestjs/common";
import {
  db,
  parse,
  json,
  transaction,
  audit,
  fail,
  type Context,
} from "../core";
import { enrollmentFilter, learnerEnrollment, scopedEnrollment } from "./scope";
import { progressInputSchema, publicContent } from "./validation";
import { creditPlayback, type WatchedInterval } from "./engine";
import { effectiveResult } from "./enrollments";
import { documentViews } from "./document-views";
import { isTeachingRole } from "./learning-permissions";
import { assertFinalAdmission } from "./final-admission";
import { attemptView } from "./exams";
import {
  evaluateLearningEligibility,
  recordLearningCompletion,
} from "./learning-eligibility";
import { enqueueEnrollmentNotification } from "./notification-events";

export async function enrollmentDetail(c: Context, id: string) {
  const enrollment = await scopedEnrollment(c, id);
  const [version, progress, attempts, results, recipient] = await Promise.all([
    db.courseVersion.findFirstOrThrow({
      where: { id: enrollment.courseVersionId, tenantId: c.tenantId },
    }),
    db.lessonProgress.findMany({
      where: { tenantId: c.tenantId, enrollmentId: id },
    }),
    db.examAttempt.findMany({
      where: { tenantId: c.tenantId, enrollmentId: id, assessmentId: "FINAL" },
      orderBy: { ordinal: "desc" },
    }),
    db.verifiedExamResult.findMany({
      where: { tenantId: c.tenantId, enrollmentId: id },
      orderBy: { revision: "desc" },
      select: {
        id: true,
        revision: true,
        verdict: true,
        assessmentKind: true,
        eligible: true,
        score: true,
        maximum: true,
        examAt: true,
        confirmedAt: true,
        attemptId: true,
        externalEvidenceId: true,
      },
    }),
    db.recipient.findFirst({
      where: { tenantId: c.tenantId, id: enrollment.recipientId },
    }),
  ]);
  const profile = await db.regulatoryProfileVersion.findFirstOrThrow({
    where: { tenantId: c.tenantId, id: version.regulatoryProfileVersionId },
  });
  const content = courseContentSchema.parse(version.content);
  const definition = regulatoryProfileSchema.parse(profile.definition);
  const documents = await documentViews(
    c,
    results.map((r) => r.id),
  );
  const events = await db.lmsResultEvent.findMany({
    where: {
      tenantId: c.tenantId,
      resultId: { in: results.map((r) => r.id) },
      kind: { in: ["VOIDED", "SUPERSEDED"] },
    },
    orderBy: { createdAt: "desc" },
  });
  const currentResults = results.map((result) =>
    effectiveResult(result, events),
  );
  const projected = publicContent(content);
  const eligibility = await evaluateLearningEligibility(
    db,
    c,
    enrollment,
    content,
  );
  let admissionBlock: string | null = null;
  try {
    await assertFinalAdmission(db, c, enrollment, content, definition, eligibility);
  } catch (error) {
    if (!(error instanceof HttpException) || error.getStatus() !== 409) throw error;
    const response = error.getResponse();
    if (typeof response === "string") throw error;
    const reason = response as { code: string; params?: { reason?: string } };
    admissionBlock = reason.params?.reason || reason.code;
  }
  const submissions = await db.lmsSubmission.findMany({
    where: { tenantId: c.tenantId, enrollmentId: id },
    select: { elementId: true, state: true },
  });
  const remainingAttempts = Math.max(0, content.exam.maxAttempts - attempts.length);
  const pendingReview = attempts.some((attempt) => attempt.state === "AWAITING_REVIEW");
  const completedFinal = attempts.some((attempt) => attempt.state === "FINISHED" && attempt.verdict === "PASSED");
  const relatedScope = await enrollmentFilter(c);
  const prerequisites = await Promise.all(
    eligibility.prerequisites.map(async (requirement) => {
      const rule = content.coursePrerequisites?.find(
        (row) => row.courseId === requirement.courseId,
      );
      const [course, ownEnrollment] = await Promise.all([
        db.course.findFirst({
          where: { tenantId: c.tenantId, id: requirement.courseId },
          select: { titleRu: true, titleKz: true },
        }),
        db.enrollment.findFirst({
          where: {
            AND: [
              relatedScope,
              {
                tenantId: c.tenantId,
                recipientId: enrollment.recipientId,
                status: { not: "CANCELLED" },
                learningVersion: {
                  courseId: requirement.courseId,
                  ...(rule?.versionPolicy === "AT_LEAST"
                    ? { version: { gte: rule.minimumVersion || 1 } }
                    : {}),
                },
              },
            ],
          },
          select: { id: true },
          orderBy: [{ assignedAt: "desc" }, { id: "desc" }],
        }),
      ]);
      return {
        ...requirement,
        titleRu: course?.titleRu || "",
        titleKz: course?.titleKz || "",
        enrollmentId: ownEnrollment?.id || null,
      };
    }),
  );
  const visibleContent = {
    ...projected,
    modules: projected.modules.map((module) => ({
      ...module,
      lessons: module.lessons.map((lesson) => {
        const state = eligibility.lessons.find((row) => row.id === lesson.id)!;
        const locked = !state.available;
        return {
          ...lesson,
          locked,
          completed: state.complete,
          lockReason: state.reason,
          ...(locked
            ? {
                textRu: "",
                textKz: "",
                materialId: null,
                url: undefined,
                subtitles: [],
                assignment: undefined,
              }
            : {}),
        };
      }),
    })),
  };
  return {
    ...enrollment,
    content: visibleContent,
    recipient:
      isTeachingRole(c) && recipient
        ? {
            id: recipient.id,
            data: Object.fromEntries(
              Object.entries(recipient.data as Record<string, unknown>).filter(
                ([key]) =>
                  [
                    "fullNameRu",
                    "fullNameKz",
                    "positionRu",
                    "positionKz",
                  ].includes(key),
              ),
            ),
          }
        : recipient,
    courseVersion: { id: version.id, version: version.version },
    profile: {
      assessmentKind: definition.assessmentKind,
      status: definition.status,
      legalForm: definition.legalForm,
      requiresProctoring: definition.requiresProctoring,
      proctoringMode: definition.proctoringMode,
    },
    progress,
    progressPercent: eligibility.requiredCount
      ? Math.floor(
          (100 * eligibility.completedCount) / eligibility.requiredCount,
        )
      : 100,
    examReadiness: {
      ready: !admissionBlock && !pendingReview && !completedFinal && remainingAttempts > 0,
      requiredCount: eligibility.requiredCount,
      completedCount: eligibility.completedCount,
      missingLessonIds: content.modules
        .flatMap((m) => m.lessons)
        .filter(
          (l) =>
            l.required &&
            !eligibility.lessons.find((s) => s.id === l.id)?.complete,
        )
        .map((l) => l.id),
      reasonCode: eligibility.blockingReasons[0] || admissionBlock || (pendingReview ? "AWAITING_REVIEW" : completedFinal ? "FINAL_COMPLETED" : !remainingAttempts ? "ATTEMPT_LIMIT" : null),
      remainingAttempts,
      closesAt: content.exam.dueAt || null,
      missingSubmissionStates: Object.fromEntries(submissions.map((row) => [row.elementId, row.state])),
    },
    learningCompletion: await db.lmsLearningCompletion.findUnique({
      where: {
        tenantId_enrollmentId: { tenantId: c.tenantId, enrollmentId: id },
      },
    }),
    prerequisites,
    attempts: await Promise.all(attempts.map((a) => attemptView(c, a))),
    results: currentResults,
    documents: documents.map((document) => {
      const result = currentResults.find((r) => r.id === document.resultId);
      return {
        ...document,
        ...(["VOIDED", "SUPERSEDED"].includes(result?.state || "")
          ? { status: result!.state }
          : {}),
      };
    }),
  };
}

export async function saveLessonProgress(
  c: Context,
  enrollmentId: string,
  lessonId: string,
  input: unknown,
) {
  const data = parse(progressInputSchema, input);
  return transaction(async (tx) => {
    await tx.$executeRaw`SELECT id FROM "Enrollment" WHERE id=${enrollmentId} AND "tenantId"=${c.tenantId} FOR UPDATE`;
    const enrollment = await learnerEnrollment(c, enrollmentId, tx);
    const version = await tx.courseVersion.findFirstOrThrow({
      where: {
        id: enrollment.courseVersionId,
        tenantId: c.tenantId,
        status: "PUBLISHED",
      },
    });
    const content = courseContentSchema.parse(version.content);
    const lesson = content.modules
      .flatMap((m) => m.lessons)
      .find((l) => l.id === lessonId);
    if (!lesson) fail(404, "NOT_FOUND", "Урок не найден");
    if (
      ["ASSESSMENT", "ASSIGNMENT"].includes(lesson.kind) ||
      (lesson.kind === "SESSION" && lesson.session?.attendanceRequired)
    )
      fail(
        409,
        "VERIFIED_FACT_REQUIRED",
        "Этот элемент завершается только после проверки или подтверждения участия",
      );
    const eligibility = await evaluateLearningEligibility(
      tx,
      c,
      enrollment,
      content,
    );
    if (!eligibility.lessons.find((l) => l.id === lessonId)?.available)
      fail(
        409,
        "PREREQUISITE_REQUIRED",
        "Сначала выполните условия доступа к элементу",
      );
    const allProgress = await tx.lessonProgress.findMany({
      where: { tenantId: c.tenantId, enrollmentId },
    });
    const existing = allProgress.find((p) => p.lessonId === lessonId);
    if (existing && data.sequence <= existing.sequence) {
      if (
        data.sequence === existing.sequence &&
        Math.abs(data.positionSeconds - existing.positionSeconds) > 0.01
      )
        fail(409, "PROGRESS_CONFLICT", "Прогресс изменён в другой вкладке");
      return existing;
    }
    const now = new Date();
    // Enrollment-row serialization and a shared latest activity boundary prevent parallel lessons/tabs adding the same wall time twice.
    const lastInteraction = allProgress.reduce<Date | null>((latest, item) => item.lastInteractionAt && (!latest || item.lastInteractionAt > latest) ? item.lastInteractionAt : latest, null);
    const interactionGap = existing?.lastInteractionAt ? (now.getTime() - Math.max(existing.lastInteractionAt.getTime(), lastInteraction?.getTime() || 0)) / 1000 : 0;
    const interactionSeconds = data.interacting && existing?.lastInteractionAt && interactionGap <= 30
      ? Math.max(0, Math.floor(interactionGap)) : 0;
    const playback =
      lesson.kind === "VIDEO"
        ? creditPlayback({
            intervals: (existing?.intervals || []) as WatchedInterval[],
            previousPosition: existing?.positionSeconds || 0,
            position: data.positionSeconds,
            elapsedSeconds: existing?.lastSeenAt
              ? (now.getTime() - existing.lastSeenAt.getTime()) / 1000
              : 0,
            duration: lesson.durationSeconds || 0,
            playing: data.playing,
            playbackRate: data.playbackRate,
            minimumPercent: lesson.videoPolicy?.minimumPercent,
            allowSeekAhead: lesson.videoPolicy?.allowSeekAhead,
            allowedPlaybackRates: lesson.videoPolicy?.playbackRates,
          })
        : null;
    const completed =
      existing?.completedAt ||
      (lesson.kind === "VIDEO" ? playback?.completed : data.acknowledge);
    const values = {
      sequence: data.sequence,
      positionSeconds: playback?.position || 0,
      intervals: json(playback?.intervals || []),
      lastSeenAt: now,
      activeSeconds: (existing?.activeSeconds || 0) + interactionSeconds,
      lastInteractionAt: data.interacting ? now : null,
      acknowledgedAt:
        existing?.acknowledgedAt ||
        (lesson.kind !== "VIDEO" && data.acknowledge ? now : null),
      completedAt: existing?.completedAt || (completed ? now : null),
    };
    const saved = await tx.lessonProgress.upsert({
      where: {
        tenantId_enrollmentId_lessonId: {
          tenantId: c.tenantId,
          enrollmentId,
          lessonId,
        },
      },
      create: { tenantId: c.tenantId, enrollmentId, lessonId, ...values },
      update: values,
    });
    if (!allProgress.length)
      await enqueueEnrollmentNotification(tx, enrollment, "STARTED");
    if (saved.completedAt && !existing?.completedAt)
      await audit(tx, c, "LMS_LESSON_COMPLETED", saved.id, {
        enrollmentId,
        lessonId,
        basis:
          lesson.kind === "VIDEO"
            ? "PLAYBACK_INTERVALS"
            : "LEARNER_ACKNOWLEDGEMENT",
      });
    await recordLearningCompletion(tx, c, enrollment, content);
    return saved;
  });
}
