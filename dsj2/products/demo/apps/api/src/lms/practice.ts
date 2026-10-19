import { canManageLearning, z } from "@demo/contracts";
import {
  audit,
  db,
  fail,
  hash,
  json,
  parse,
  transaction,
  type Context,
} from "../core";
import { assertLearningPermission } from "./learning-permissions";
import {
  groupVersion,
  practiceCriteriaSchema,
  scopedTeachingEvent,
  teachingAttendance,
} from "./teaching-events";
import { enqueueEnrollmentNotification } from "./notification-events";

export async function practiceRoster(c: Context, id: string, query: unknown) {
  const event = await scopedTeachingEvent(c, id);
  const { version } = await groupVersion(c, event.groupId, db);
  await assertLearningPermission(c, version.courseId, event.groupId, "REVIEW");
  const roster = await teachingAttendance(c, id, query);
  const decisions = await db.lmsReviewDecision.findMany({
    where: {
      tenantId: c.tenantId,
      targetType: "PRACTICE",
      targetId: { in: roster.items.map((row) => `${id}:${row.enrollmentId}`) },
    },
    orderBy: { revision: "desc" },
  });
  return {
    ...roster,
    criteria: practiceCriteriaSchema.parse(event.practiceCriteria || []),
    canReview:
      !c.learningMode &&
      (canManageLearning(c.role) || event.teacherUserId === c.userId),
    items: roster.items.map((row) => ({
      ...row,
      decisions: decisions
        .filter((decision) => decision.targetId === `${id}:${row.enrollmentId}`)
        .map((decision) => ({
          id: decision.id,
          revision: decision.revision,
          decision: decision.decision,
          feedback: decision.feedback,
          createdAt: decision.createdAt,
          snapshot: decision.snapshot,
        })),
    })),
  };
}
export async function recordPractice(c: Context, id: string, input: unknown) {
  const body = parse(
    z
      .object({
        commandId: z.string().uuid(),
        expectedEventRevision: z.number().int().min(1),
        enrollmentId: z.string().uuid(),
        expectedRevision: z.number().int().min(0),
        decision: z.enum(["ACCEPTED", "RETURNED"]),
        checks: z.record(z.string(), z.boolean()),
        feedback: z.string().trim().min(1).max(4000),
      })
      .strict(),
    input,
  );
  return transaction(async (tx) => {
    await tx.$executeRaw`SELECT id FROM "LmsTeachingEvent" WHERE "tenantId"=${c.tenantId} AND id=${id} FOR UPDATE`;
    const event = await scopedTeachingEvent(c, id, tx);
    const { version } = await groupVersion(c, event.groupId, tx);
    await assertLearningPermission(
      c,
      version.courseId,
      event.groupId,
      "REVIEW",
      tx,
    );
    if (!canManageLearning(c.role) && event.teacherUserId !== c.userId)
      fail(
        403,
        "PRACTICE_TEACHER_REQUIRED",
        "Практику оценивает назначенный на занятие преподаватель",
      );
    const enrollment = await tx.enrollment.findFirst({
      where: {
        tenantId: c.tenantId,
        id: body.enrollmentId,
        courseVersionId: event.courseVersionId,
        status: { not: "CANCELLED" },
        groupMemberships: {
          some: {
            tenantId: c.tenantId,
            groupId: event.groupId,
            excludedAt: null,
          },
        },
      },
    });
    if (!enrollment)
      fail(404, "NOT_FOUND", "Участник не входит в группу занятия");
    if (
      enrollment.learnerUserId === c.userId || await tx.learnerProfile.findFirst({
        where: {
          tenantId: c.tenantId,
          userId: c.userId,
          recipientId: enrollment.recipientId,
        },
      })
    )
      fail(
        403,
        "SELF_REVIEW_FORBIDDEN",
        "Нельзя оценивать собственную практику",
      );
    const payloadHash = hash({ id, ...body });
    const replay = await tx.lmsReviewDecision.findUnique({
      where: {
        tenantId_decisionKey: {
          tenantId: c.tenantId,
          decisionKey: body.commandId,
        },
      },
    });
    if (replay) {
      if (replay.contentHash !== payloadHash)
        fail(409, "COMMAND_CONFLICT", "Повтор операции содержит другие данные");
      return { id: replay.id, revision: replay.revision };
    }
    if (event.status !== "SCHEDULED" || event.endsAt > new Date())
      fail(
        409,
        "PRACTICE_EVENT_NOT_FINISHED",
        "Оценить практику можно после завершения действующего занятия",
      );
    if (event.revision !== body.expectedEventRevision)
      fail(
        409,
        "REVISION_CONFLICT",
        "Занятие изменено. Откройте актуальный список",
      );
    const criteria = practiceCriteriaSchema.parse(event.practiceCriteria || []);
    if (
      !criteria.length ||
      Object.keys(body.checks).some(
        (key) => !criteria.some((row) => row.id === key),
      ) ||
      criteria.some((row) => !Object.hasOwn(body.checks, row.id))
    )
      fail(
        400,
        "PRACTICE_CHECKLIST_REQUIRED",
        "Отметьте каждый критерий практики",
      );
    if (
      body.decision === "ACCEPTED" &&
      criteria.some((row) => !body.checks[row.id])
    )
      fail(
        400,
        "PRACTICE_CHECKLIST_INCOMPLETE",
        "Для зачёта необходимо выполнить каждый критерий",
      );
    const targetId = `${id}:${enrollment.id}`;
    const previous = await tx.lmsReviewDecision.findFirst({
      where: { tenantId: c.tenantId, targetType: "PRACTICE", targetId },
      orderBy: { revision: "desc" },
    });
    if ((previous?.revision || 0) !== body.expectedRevision)
      fail(
        409,
        "REVISION_CONFLICT",
        "Оценка изменена. Откройте сохранённое решение",
      );
    const decision = await tx.lmsReviewDecision.create({
      data: {
        tenantId: c.tenantId,
        targetType: "PRACTICE",
        targetId,
        revision: body.expectedRevision + 1,
        contentHash: payloadHash,
        decisionKey: body.commandId,
        decision: body.decision,
        feedback: body.feedback,
        actorId: c.userId,
        snapshot: json({
          eventId: id,
          enrollmentId: enrollment.id,
          requirementId: event.requirementId,
          courseVersionId: event.courseVersionId,
          eventRevision: event.revision,
          criteria,
          checks: body.checks,
          teacherUserId: event.teacherUserId,
          location: event.location,
        }),
      },
    });
    await enqueueEnrollmentNotification(tx, enrollment, "RESULT", {
      key: `PRACTICE:${decision.id}`,
      titleRu:
        body.decision === "ACCEPTED"
          ? "Практика зачтена преподавателем"
          : "Практика требует доработки: прочитайте замечания преподавателя",
      titleKz:
        body.decision === "ACCEPTED"
          ? "Оқытушы практиканы қабылдады"
          : "Практиканы толықтыру қажет: оқытушының ескертулерін оқыңыз",
    });
    await audit(tx, c, "LMS_PRACTICE_REVIEWED", decision.id, {
      eventId: id,
      enrollmentId: enrollment.id,
      decision: body.decision,
      revision: decision.revision,
    });
    return { id: decision.id, revision: decision.revision };
  });
}
