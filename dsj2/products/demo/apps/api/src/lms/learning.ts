import {
  courseContentSchema,
  regulatoryProfileSchema,
} from "@demo/contracts/src/lms";
import {
  db,
  parse,
  json,
  transaction,
  audit,
  fail,
  type Context,
} from "../core";
import { learnerEnrollment, scopedEnrollment } from "./scope";
import { progressInputSchema, publicContent } from "./validation";
import { creditPlayback, type WatchedInterval } from "./engine";
import { effectiveResult, progressPercent } from "./enrollments";
import { attemptView } from "./exams";
import { examReadiness } from "./readiness";

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
      where: { tenantId: c.tenantId, enrollmentId: id },
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
  const documents = await db.lmsDocumentLink.findMany({
    where: { tenantId: c.tenantId, resultId: { in: results.map((r) => r.id) } },
  });
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
  const available =
    enrollment.status !== "CANCELLED" && enrollment.dueAt >= new Date();
  const visibleContent = {
    ...projected,
    modules: projected.modules.map((module) => ({
      ...module,
      lessons: module.lessons.map((lesson) => {
        const locked =
          !available ||
          lesson.prerequisiteLessonIds.some(
            (id) => !progress.some((p) => p.lessonId === id && p.completedAt),
          );
        return {
          ...lesson,
          locked,
          ...(locked ? { textRu: "", textKz: "", materialId: null } : {}),
        };
      }),
    })),
  };
  return {
    ...enrollment,
    content: visibleContent,
    recipient,
    courseVersion: { id: version.id, version: version.version },
    profile: {
      assessmentKind: definition.assessmentKind,
      status: definition.status,
      legalForm: definition.legalForm,
    },
    progress,
    progressPercent: progressPercent(content, progress),
    examReadiness: examReadiness(content, progress),
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
    const allProgress = await tx.lessonProgress.findMany({
      where: { tenantId: c.tenantId, enrollmentId },
    });
    if (
      lesson.prerequisiteLessonIds.some(
        (id) => !allProgress.some((p) => p.lessonId === id && p.completedAt),
      )
    )
      fail(409, "PREREQUISITE_REQUIRED", "Сначала завершите предыдущий урок");
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
    if (saved.completedAt && !existing?.completedAt)
      await audit(tx, c, "LMS_LESSON_COMPLETED", saved.id, {
        enrollmentId,
        lessonId,
        basis:
          lesson.kind === "VIDEO"
            ? "PLAYBACK_INTERVALS"
            : "LEARNER_ACKNOWLEDGEMENT",
      });
    return saved;
  });
}
