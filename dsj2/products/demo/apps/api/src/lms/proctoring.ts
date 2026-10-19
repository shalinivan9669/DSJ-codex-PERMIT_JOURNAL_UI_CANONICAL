import { Prisma, type ExamAttempt } from "@demo/database";
import { canManageLearning, regulatoryProfileSchema, z } from "@demo/contracts";
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
import { scopedEnrollment } from "./scope";
import {
  assertLearningPermission,
  enrollmentScopeSql,
  hasLearningPermission,
} from "./learning-permissions";
import { enqueueEnrollmentNotification } from "./notification-events";

type Session = {
  supervisorUserId: string;
  startsAt: string;
  endsAt: string;
  ordinal: number;
  identityConfirmed?: boolean;
  presenceConfirmed?: boolean;
  attemptId?: string;
  attemptHash?: string;
};
const contentHash = (attempt: ExamAttempt) =>
  hash({
    snapshot: attempt.snapshot,
    answers: attempt.answers,
    submittedAt: attempt.submittedAt,
  });
export async function proctorAdmission(
  tx: Prisma.TransactionClient,
  c: Context,
  enrollmentId: string,
) {
  const nextOrdinal =
    (await tx.examAttempt.count({
      where: { tenantId: c.tenantId, enrollmentId, assessmentId: "FINAL" },
    })) + 1;
  const latest = await tx.lmsReviewDecision.findFirst({
    where: {
      tenantId: c.tenantId,
      targetType: "PROCTORING",
      targetId: enrollmentId,
    },
    orderBy: { revision: "desc" },
  });
  const session = latest?.snapshot as Session | undefined;
  if (
    !latest ||
    latest.decision !== "ADMITTED" ||
    !session?.identityConfirmed ||
    !session.presenceConfirmed ||
    session.ordinal !== nextOrdinal ||
    new Date(session.startsAt) > new Date() ||
    new Date(session.endsAt) <= new Date()
  )
    return false;
  const supervisor = await tx.user.findFirst({
    where: { tenantId: c.tenantId, id: session.supervisorUserId, active: true },
  });
  const enrollment = await tx.enrollment.findFirstOrThrow({
    where: { tenantId: c.tenantId, id: enrollmentId },
  });
  const version = await tx.courseVersion.findFirstOrThrow({
    where: { tenantId: c.tenantId, id: enrollment.courseVersionId },
  });
  return (
    !!supervisor &&
    (await hasLearningPermission(
      {
        ...c,
        userId: supervisor.id,
        role: supervisor.role,
        learningMode: false,
      },
      version.courseId,
      enrollment.groupId,
      "REVIEW",
      tx,
    ))
  );
}
export async function proctorApproval(
  tx: Prisma.TransactionClient,
  tenantId: string,
  attempt: ExamAttempt,
) {
  const latest = await tx.lmsReviewDecision.findFirst({
    where: {
      tenantId,
      targetType: "PROCTORING",
      targetId: attempt.enrollmentId,
      snapshot: { path: ["attemptId"], equals: attempt.id },
      decision: { in: ["APPROVED", "REJECTED", "INCIDENT"] },
    },
    orderBy: { revision: "desc" },
  });
  const snapshot = latest?.snapshot as Session | undefined;
  return latest?.decision === "APPROVED" &&
    snapshot?.attemptHash === contentHash(attempt)
    ? latest
    : null;
}
export async function proctoringDetail(
  c: Context,
  id: string,
  tx: Prisma.TransactionClient = db,
) {
  const enrollment = await scopedEnrollment(c, id, tx);
  const version = await tx.courseVersion.findFirstOrThrow({
    where: { tenantId: c.tenantId, id: enrollment.courseVersionId },
  });
  const canReview =
    !c.learningMode &&
    (await hasLearningPermission(
      c,
      version.courseId,
      enrollment.groupId,
      "REVIEW",
      tx,
    ));
  const history = await tx.lmsReviewDecision.findMany({
    where: { tenantId: c.tenantId, targetType: "PROCTORING", targetId: id },
    orderBy: { revision: "desc" },
    take: 100,
  });
  const bindings = canReview
    ? await tx.lmsTeachingBinding.findMany({
        where: {
          tenantId: c.tenantId,
          courseId: version.courseId,
          revokedAt: null,
        },
        select: { userId: true },
      })
    : [];
  const supervisors = canReview
    ? await tx.user.findMany({
        where: {
          tenantId: c.tenantId,
          active: true,
          OR: [
            {
              role: {
                in: ["SUPER_ADMIN", "ADMIN", "DIRECTOR", "TEACHER", "EXPERT"],
              },
            },
            { id: { in: bindings.map((binding) => binding.userId) } },
          ],
        },
        select: { id: true, displayName: true, role: true },
      })
    : [];
  const eligible = await Promise.all(
    supervisors.map(async (user) => ({
      ...user,
      allowed: await hasLearningPermission(
        { ...c, userId: user.id, role: user.role, learningMode: false },
        version.courseId,
        enrollment.groupId,
        "REVIEW",
        tx,
      ),
      self: enrollment.learnerUserId === user.id || !!(await tx.learnerProfile.findFirst({
        where: {
          tenantId: c.tenantId,
          userId: user.id,
          recipientId: enrollment.recipientId,
        },
      })),
    })),
  );
  const activeAttempt = await tx.examAttempt.findFirst({
    where: {
      tenantId: c.tenantId,
      enrollmentId: id,
      assessmentId: "FINAL",
      state: { in: ["IN_PROGRESS", "AWAITING_REVIEW"] },
    },
    orderBy: { ordinal: "desc" },
    select: { id: true, state: true, ordinal: true, submittedAt: true },
  });
  return {
    id,
    canReview,
    canAssign:
      canReview &&
      (!history[0] ||
        canManageLearning(c.role) ||
        (history[0].snapshot as Session).supervisorUserId === c.userId),
    canAct:
      canReview &&
      (history[0]?.snapshot as Session | undefined)?.supervisorUserId ===
        c.userId,
    activeAttempt,
    supervisors: eligible
      .filter((user) => user.allowed && !user.self)
      .map(({ id: userId, displayName }) => ({ id: userId, displayName })),
    history: history.map((row) => ({
      id: row.id,
      revision: row.revision,
      decision: row.decision,
      feedback: row.feedback,
      snapshot: row.snapshot,
      createdAt: row.createdAt,
    })),
  };
}
export async function proctoringQueue(c: Context, input: unknown) {
  const query = parse(
    z
      .object({
        search: z.string().max(300).default(""),
        page: z.coerce.number().int().min(1).default(1),
      })
      .strict(),
    input,
  );
  if (
    c.learningMode ||
    (!["SUPER_ADMIN", "ADMIN", "DIRECTOR", "TEACHER", "EXPERT"].includes(
      c.role,
    ) &&
      !c.teachingMode)
  )
    fail(
      403,
      "ROLE_DENIED",
      "Контроль экзамена доступен назначенному сотруднику",
    );
  const filter = Prisma.sql`${enrollmentScopeSql(c, "e")} AND e.status<>'CANCELLED' AND p.definition->>'requiresProctoring'='true' AND (${query.search}='' OR r.data->>'fullNameRu' ILIKE ${`%${query.search}%`} OR v.content->>'titleRu' ILIKE ${`%${query.search}%`})`;
  const from = Prisma.sql`FROM "Enrollment" e JOIN "Recipient" r ON r.id=e."recipientId" AND r."tenantId"=e."tenantId" JOIN "CourseVersion" v ON v.id=e."courseVersionId" AND v."tenantId"=e."tenantId" JOIN "RegulatoryProfileVersion" p ON p.id=v."regulatoryProfileVersionId" AND p."tenantId"=e."tenantId" WHERE ${filter}`;
  const [items, counts] = await Promise.all([
    db.$queryRaw<
      Array<{
        id: string;
        learnerName: string;
        titleRu: string;
        titleKz: string;
      }>
    >(
      Prisma.sql`SELECT e.id,r.data->>'fullNameRu' AS "learnerName",v.content->>'titleRu' AS "titleRu",v.content->>'titleKz' AS "titleKz" ${from} ORDER BY e."assignedAt" DESC,e.id LIMIT 25 OFFSET ${(query.page - 1) * 25}`,
    ),
    db.$queryRaw<Array<{ count: bigint }>>(Prisma.sql`SELECT count(*) ${from}`),
  ]);
  return { items, total: Number(counts[0].count) };
}
export async function recordProctoring(c: Context, id: string, input: unknown) {
  const body = parse(
    z
      .object({
        commandId: z.string().uuid(),
        revision: z.number().int().min(0),
        decision: z.enum([
          "ASSIGNED",
          "ADMITTED",
          "INCIDENT",
          "APPROVED",
          "REJECTED",
        ]),
        supervisorUserId: z.string().uuid().optional(),
        startsAt: z.string().datetime().optional(),
        endsAt: z.string().datetime().optional(),
        identityConfirmed: z.boolean().default(false),
        presenceConfirmed: z.boolean().default(false),
        attemptId: z.string().uuid().optional(),
        feedback: z.string().trim().min(1).max(4000),
      })
      .strict(),
    input,
  );
  return transaction(async (tx) => {
    await tx.$executeRaw`SELECT id FROM "Enrollment" WHERE "tenantId"=${c.tenantId} AND id=${id} FOR UPDATE`;
    const enrollment = await scopedEnrollment(c, id, tx);
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
      enrollment.status === "CANCELLED" ||
      (enrollment.dueAt && enrollment.dueAt < new Date())
    )
      fail(409, "ACCESS_EXPIRED", "Доступ к назначению завершён");
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
        "Нельзя контролировать собственный экзамен",
      );
    const profileVersion = await tx.regulatoryProfileVersion.findFirstOrThrow({
      where: { tenantId: c.tenantId, id: version.regulatoryProfileVersionId },
    });
    const profile = regulatoryProfileSchema.parse(profileVersion.definition);
    if (
      !profile.requiresProctoring ||
      profile.proctoringMode !== "LOCAL_SUPERVISED"
    )
      fail(
        409,
        "PROCTORING_MODE_REQUIRED",
        "Программа не предусматривает местный экзамен под наблюдением",
      );
    const requestHash = hash({ id, ...body });
    const replay = await tx.lmsReviewDecision.findUnique({
      where: {
        tenantId_decisionKey: {
          tenantId: c.tenantId,
          decisionKey: body.commandId,
        },
      },
    });
    if (replay) {
      if (replay.contentHash !== requestHash)
        fail(409, "COMMAND_CONFLICT", "Повтор операции содержит другие данные");
      return proctoringDetail(c, id, tx);
    }
    const detail = await proctoringDetail(c, id, tx),
      previous = detail.history[0];
    if ((previous?.revision || 0) !== body.revision)
      fail(409, "REVISION_CONFLICT", "Журнал изменён. Обновите данные");
    let snapshot: Session = previous?.snapshot as Session;
    if (body.decision === "ASSIGNED") {
      if (!detail.canAssign || detail.activeAttempt)
        fail(
          409,
          "PROCTOR_ASSIGNMENT_LOCKED",
          "Смену наблюдателя выполняют до начала новой попытки",
        );
      if (
        !body.supervisorUserId ||
        !detail.supervisors.some((user) => user.id === body.supervisorUserId) ||
        !body.startsAt ||
        !body.endsAt
      )
        fail(
          400,
          "PROCTOR_ASSIGNMENT_REQUIRED",
          "Выберите наблюдателя и время сессии",
        );
      const start = new Date(body.startsAt),
        end = new Date(body.endsAt);
      if (
        end <= new Date() ||
        end <= start ||
        end.getTime() - start.getTime() > 8 * 3600000
      )
        fail(
          400,
          "PROCTOR_WINDOW_INVALID",
          "Укажите действующее окно экзамена не более 8 часов",
        );
      snapshot = {
        supervisorUserId: body.supervisorUserId,
        startsAt: body.startsAt,
        endsAt: body.endsAt,
        ordinal:
          (await tx.examAttempt.count({
            where: {
              tenantId: c.tenantId,
              enrollmentId: id,
              assessmentId: "FINAL",
            },
          })) + 1,
      };
    } else {
      if (!snapshot || snapshot.supervisorUserId !== c.userId)
        fail(
          403,
          "PROCTOR_SUPERVISOR_REQUIRED",
          "Решение принимает назначенный наблюдатель",
        );
      if (body.decision === "ADMITTED") {
        if (
          detail.activeAttempt ||
          !["ASSIGNED", "ADMITTED"].includes(previous.decision) ||
          new Date(snapshot.startsAt) > new Date() ||
          new Date(snapshot.endsAt) <= new Date() ||
          !body.identityConfirmed ||
          !body.presenceConfirmed
        )
          fail(
            409,
            "PROCTOR_IDENTITY_REQUIRED",
            "В пределах сессии подтвердите личность и личное присутствие слушателя до начала экзамена",
          );
        snapshot = {
          ...snapshot,
          identityConfirmed: true,
          presenceConfirmed: true,
        };
      } else {
        if (!body.attemptId || detail.activeAttempt?.id !== body.attemptId)
          fail(
            409,
            "PROCTOR_ATTEMPT_REQUIRED",
            "Выберите текущую попытку экзамена",
          );
        await tx.$executeRaw`SELECT id FROM "ExamAttempt" WHERE "tenantId"=${c.tenantId} AND id=${body.attemptId} FOR UPDATE`;
        const attempt = await tx.examAttempt.findFirstOrThrow({
          where: { tenantId: c.tenantId, id: body.attemptId, enrollmentId: id },
        });
        if (
          attempt.ordinal !== snapshot.ordinal ||
          !snapshot.identityConfirmed ||
          !snapshot.presenceConfirmed
        )
          fail(
            409,
            "PROCTOR_SESSION_MISMATCH",
            "Попытка не относится к подтверждённой сессии",
          );
        if (body.decision !== "INCIDENT" && attempt.state !== "AWAITING_REVIEW")
          fail(
            409,
            "PROCTOR_SUBMISSION_REQUIRED",
            "Сначала слушатель должен завершить попытку",
          );
        if (body.decision === "APPROVED" && !body.presenceConfirmed)
          fail(
            400,
            "PROCTOR_PRESENCE_REQUIRED",
            "Подтвердите наблюдение до завершения экзамена и разрешение зафиксированных замечаний",
          );
        snapshot = {
          ...snapshot,
          attemptId: attempt.id,
          attemptHash: contentHash(attempt),
        };
        if (body.decision === "REJECTED")
          await tx.examAttempt.update({
            where: { id: attempt.id },
            data: {
              state: "INVALIDATED",
              activeKey: null,
              finishedAt: new Date(),
              verdict: null,
            },
          });
      }
    }
    const row = await tx.lmsReviewDecision.create({
      data: {
        tenantId: c.tenantId,
        targetType: "PROCTORING",
        targetId: id,
        revision: body.revision + 1,
        contentHash: requestHash,
        decisionKey: body.commandId,
        decision: body.decision,
        actorId: c.userId,
        feedback: body.feedback,
        snapshot: json(snapshot),
      },
    });
    await audit(tx, c, "LMS_PROCTORING_RECORDED", row.id, {
      enrollmentId: id,
      decision: body.decision,
      attemptId: snapshot.attemptId,
      supervisorUserId: snapshot.supervisorUserId,
    });
    await enqueueEnrollmentNotification(tx, enrollment, "RESULT", {
      key: `PROCTORING:${row.id}`,
      titleRu:
        body.decision === "ADMITTED"
          ? "Личность и присутствие подтверждены: итоговый экзамен доступен"
          : body.decision === "REJECTED"
            ? "Попытка не принята наблюдателем. Ознакомьтесь с причиной и условиями пересдачи"
            : "Обновлён журнал наблюдения за экзаменом",
      titleKz:
        body.decision === "ADMITTED"
          ? "Жеке басы мен қатысуы расталды: қорытынды емтихан қолжетімді"
          : body.decision === "REJECTED"
            ? "Бақылаушы әрекетті қабылдамады. Себеп пен қайта тапсыру шарттарын оқыңыз"
            : "Емтиханды бақылау журналы жаңартылды",
    });
    return proctoringDetail(c, id, tx);
  });
}
