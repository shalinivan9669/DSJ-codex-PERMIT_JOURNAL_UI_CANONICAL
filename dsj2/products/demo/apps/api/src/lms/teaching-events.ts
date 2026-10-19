import { Prisma, type LmsTeachingEvent } from "@demo/database";
import { courseContentSchema } from "@demo/contracts/src/lms";
import { z } from "@demo/contracts";
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
import { isLmsStaff } from "./scope";
import {
  assertLearningPermission,
  hasLearningPermission,
  enrollmentScopeSql,
  groupScopeSql,
  isTeachingRole,
  teachingBindingPermissionSql,
} from "./learning-permissions";
import { notifyTeachingEvent } from "./notifications";

const pageFields = {
  page: z.coerce.number().int().min(1).max(100000).default(1),
  pageSize: z.coerce.number().int().min(1).max(250).default(50),
};
export const learningPageSchema = z.object(pageFields).strict();
const identifier = z.string().min(1).max(100);
export const practiceCriteriaSchema = z.array(z.object({ id: identifier, titleRu: z.string().trim().min(1).max(500), titleKz: z.string().trim().min(1).max(500) }).strict()).max(50).refine(rows => new Set(rows.map(row => row.id)).size === rows.length, "Критерии повторяются");
const link = z
  .string()
  .max(2000)
  .nullable()
  .optional()
  .refine(
    (value) => !value || safeTeachingUrl(value),
    "Используйте безопасную HTTPS-ссылку без пароля",
  );
const fields = {
  titleRu: z.string().trim().min(1).max(500),
  titleKz: z.string().trim().max(500).default(""),
  startsAt: z.string().datetime(),
  endsAt: z.string().datetime(),
  timezone: z.string().max(100),
  teacherUserId: identifier,
  joinUrl: link,
  recordingUrl: link,
  recordingMaterialId: identifier.nullable().optional(),
  location: z.string().trim().max(1000).nullable().optional(),
  practiceCriteria: practiceCriteriaSchema.optional(),
};
export function safeTeachingUrl(value: string) {
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      ![...value].some(
        (character) =>
          character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
      )
    );
  } catch {
    return false;
  }
}
export function validateTeachingDates(
  startsAt: string,
  endsAt: string,
  timezone: string,
) {
  try {
    new Intl.DateTimeFormat("en", { timeZone: timezone }).format();
  } catch {
    fail(400, "TIMEZONE_INVALID", "Выберите действующий часовой пояс");
  }
  if (Date.parse(endsAt) <= Date.parse(startsAt))
    fail(400, "EVENT_DATES_INVALID", "Окончание должно быть позже начала");
}
export async function teachingVisibilitySql(
  c: Context,
  alias = "e",
  tx: Prisma.TransactionClient = db,
) {
  const event = Prisma.raw(alias);
  if (c.learningMode || (c.role === "LEARNER" && !isTeachingRole(c))) {
    const enrollment = await enrollmentScopeSql(c, "n", tx);
    return Prisma.sql`${event}."tenantId"=${c.tenantId} AND EXISTS (SELECT 1 FROM "LmsGroupMember" m JOIN "Enrollment" n ON n."tenantId"=m."tenantId" AND n.id=m."enrollmentId" WHERE m."tenantId"=${event}."tenantId" AND m."groupId"=${event}."groupId" AND n."courseVersionId"=${event}."courseVersionId" AND (${enrollment}) AND (m."excludedAt" IS NULL OR (${event}."endsAt"<=m."excludedAt" AND EXISTS (SELECT 1 FROM "LmsAttendance" a WHERE a."tenantId"=m."tenantId" AND a."eventId"=${event}.id AND a."enrollmentId"=n.id))))`;
  }
  const scope = await groupScopeSql(c, "g", tx);
  return Prisma.sql`${event}."tenantId"=${c.tenantId} AND EXISTS (SELECT 1 FROM "LmsGroup" g WHERE g."tenantId"=${event}."tenantId" AND g.id=${event}."groupId" AND (${scope}))`;
}
export async function scopedTeachingEvent(
  c: Context,
  id: string,
  tx: Prisma.TransactionClient = db,
) {
  const scope = await teachingVisibilitySql(c, "e", tx);
  const rows = await tx.$queryRaw<LmsTeachingEvent[]>(
    Prisma.sql`SELECT e.* FROM "LmsTeachingEvent" e WHERE e.id=${id} AND (${scope}) LIMIT 1`,
  );
  if (!rows[0]) fail(404, "NOT_FOUND", "Занятие не найдено");
  return rows[0];
}
export async function groupVersion(
  c: Context,
  groupId: string,
  tx: Prisma.TransactionClient,
) {
  const group = await tx.lmsGroup.findFirst({
    where: { tenantId: c.tenantId, id: groupId },
  });
  if (!group) fail(404, "NOT_FOUND", "Группа не найдена");
  const version = await tx.courseVersion.findFirst({
    where: { tenantId: c.tenantId, id: group.courseVersionId },
  });
  if (!version) fail(404, "NOT_FOUND", "Программа не найдена");
  return { group, version };
}
/** Historical calendar visibility does not grant current access to a private recording. */
export async function recordingVisibilitySql(c: Context, alias = "event", tx: Prisma.TransactionClient = db) {
  const event = Prisma.raw(alias);
  if (!c.learningMode && (isLmsStaff(c) || isTeachingRole(c))) return teachingVisibilitySql(c, alias, tx);
  const scope = enrollmentScopeSql(c, "recording_n", tx);
  return Prisma.sql`${event}."tenantId"=${c.tenantId} AND ${event}.status='SCHEDULED' AND ${event}."endsAt"<=CURRENT_TIMESTAMP AND EXISTS (
    SELECT 1 FROM "LmsGroupMember" recording_m JOIN "Enrollment" recording_n ON recording_n."tenantId"=recording_m."tenantId" AND recording_n.id=recording_m."enrollmentId"
    WHERE recording_m."tenantId"=${event}."tenantId" AND recording_m."groupId"=${event}."groupId" AND recording_m."excludedAt" IS NULL
      AND recording_n."courseVersionId"=${event}."courseVersionId" AND recording_n.status IN ('ACTIVE','COMPLETED')
      AND (recording_n."startsAt" IS NULL OR recording_n."startsAt"<=CURRENT_TIMESTAMP)
      AND (recording_n."dueAt" IS NULL OR recording_n."dueAt">CURRENT_TIMESTAMP) AND (${scope}))`;
}
async function flags(
  c: Context,
  event: LmsTeachingEvent,
  tx: Prisma.TransactionClient = db,
) {
  const { version } = await groupVersion(c, event.groupId, tx);
  return {
    canSchedule: await hasLearningPermission(
      c,
      version.courseId,
      event.groupId,
      "SCHEDULE",
      tx,
    ),
    canAttend: await hasLearningPermission(
      c,
      version.courseId,
      event.groupId,
      "ATTENDANCE",
      tx,
    ),
  };
}
export async function listTeachingEvents(c: Context, input: unknown) {
  const q = parse(
    z
      .object({
        ...pageFields,
        groupId: identifier.optional(),
        enrollmentId: identifier.optional(),
        requirementId: identifier.optional(),
      })
      .strict(),
    input,
  );
  const scope = await teachingVisibilitySql(c);
  const clauses = [scope];
  if (q.groupId) clauses.push(Prisma.sql`e."groupId"=${q.groupId}`);
  if (q.requirementId)
    clauses.push(Prisma.sql`e."requirementId"=${q.requirementId}`);
  if (q.enrollmentId) {
    const enrollmentScope = await enrollmentScopeSql(c, "n");
    clauses.push(
      Prisma.sql`EXISTS(SELECT 1 FROM "Enrollment" n JOIN "LmsGroupMember" m ON m."tenantId"=n."tenantId" AND m."enrollmentId"=n.id WHERE n.id=${q.enrollmentId} AND (${enrollmentScope}) AND m."groupId"=e."groupId" AND m."tenantId"=e."tenantId")`,
    );
  }
  const where = Prisma.join(clauses, " AND ");
  const [items, count] = await Promise.all([
    db.$queryRaw<LmsTeachingEvent[]>(
      Prisma.sql`SELECT e.* FROM "LmsTeachingEvent" e WHERE ${where} ORDER BY e."startsAt" DESC,e.id LIMIT ${q.pageSize} OFFSET ${(q.page - 1) * q.pageSize}`,
    ),
    db.$queryRaw<{ total: bigint }[]>(
      Prisma.sql`SELECT count(*) AS total FROM "LmsTeachingEvent" e WHERE ${where}`,
    ),
  ]);
  let canSchedule = false;
  let requirements: { id: string; titleRu: string; titleKz: string }[] = [];
  let teachers: { id: string; name: string }[] = [];
  if (q.groupId) {
    const groupScope = await groupScopeSql(c, "g");
    const visible = await db.$queryRaw<{ id: string }[]>(
      Prisma.sql`SELECT g.id FROM "LmsGroup" g WHERE g.id=${q.groupId} AND (${groupScope}) LIMIT 1`,
    );
    if (!visible.length) fail(404, "NOT_FOUND", "Группа не найдена");
    const { version } = await groupVersion(c, q.groupId, db);
    canSchedule = await hasLearningPermission(
      c,
      version.courseId,
      q.groupId,
      "SCHEDULE",
    );
    if (canSchedule) {
      requirements = courseContentSchema
        .parse(version.content)
        .modules.flatMap((m) => m.lessons)
        .filter((l) => l.kind === "SESSION")
        .map((l) => ({ id: l.id, titleRu: l.titleRu, titleKz: l.titleKz }));
      teachers = await db.$queryRaw<{ id: string; name: string }[]>(
        Prisma.sql`SELECT u.id,u."displayName" AS name FROM "User" u WHERE u."tenantId"=${c.tenantId} AND u.active AND (u.role IN ('SUPER_ADMIN','ADMIN','DIRECTOR') OR EXISTS (SELECT 1 FROM "LmsTeachingBinding" b WHERE b."tenantId"=u."tenantId" AND b."userId"=u.id AND b."courseId"=${version.courseId} AND (b."groupId" IS NULL OR b."groupId"=${q.groupId}) AND b."revokedAt" IS NULL AND ${teachingBindingPermissionSql("ATTENDANCE")})) ORDER BY u."displayName",u.id LIMIT 250`,
      );
    }
  }
  const ownAttendance =
    items.length &&
    (c.learningMode || (c.role === "LEARNER" && !isTeachingRole(c)))
      ? await db.$queryRaw<
          { eventId: string; status: string; recordedAt: Date }[]
        >(
          Prisma.sql`SELECT DISTINCT ON(a."eventId") a."eventId",a.status,a."recordedAt" FROM "LmsAttendance" a JOIN "Enrollment" n ON n."tenantId"=a."tenantId" AND n.id=a."enrollmentId" WHERE a."tenantId"=${c.tenantId} AND a."eventId" IN (${Prisma.join(items.map((item) => item.id))}) AND (${enrollmentScopeSql(c, "n")}) ORDER BY a."eventId",a.revision DESC`,
        )
      : [];
  const ownPractice = items.length && (c.learningMode || (c.role === "LEARNER" && !isTeachingRole(c)))
    ? await db.$queryRaw<Array<{ eventId: string; decision: string; feedback: string; createdAt: Date }>>(Prisma.sql`
      SELECT DISTINCT ON(d.snapshot->>'eventId') d.snapshot->>'eventId' AS "eventId",d.decision,d.feedback,d."createdAt" FROM "LmsReviewDecision" d
      JOIN "Enrollment" n ON n."tenantId"=d."tenantId" AND n.id=d.snapshot->>'enrollmentId'
      WHERE d."tenantId"=${c.tenantId} AND d."targetType"='PRACTICE' AND d.snapshot->>'eventId' IN (${Prisma.join(items.map(item => item.id))}) AND (${enrollmentScopeSql(c, "n")})
      ORDER BY d.snapshot->>'eventId',d.revision DESC`) : [];
  return {
    items: items.map((item) => ({
      ...item,
      ownAttendance:
        ownAttendance.find((row) => row.eventId === item.id) || null,
      ownPractice: ownPractice.find(row => row.eventId === item.id) || null,
    })),
    total: Number(count[0]?.total || 0),
    page: q.page,
    pageSize: q.pageSize,
    canSchedule,
    requirements,
    teachers,
  };
}
export async function teachingEventDetail(c: Context, id: string) {
  const event = await scopedTeachingEvent(c, id),
    permissions = await flags(c, event);
  const history = await db.lmsTeachingEventChange.findMany({
    where: { tenantId: c.tenantId, eventId: id },
    orderBy: { revision: "desc" },
    take: 100,
    select: {
      id: true,
      kind: true,
      reason: true,
      createdAt: true,
      revision: true,
    },
  });
  return { event, ...permissions, history };
}
async function validateBindings(
  c: Context,
  courseId: string,
  groupId: string,
  body: { teacherUserId: string; recordingMaterialId?: string | null },
  tx: Prisma.TransactionClient,
) {
  const user = await tx.user.findFirst({
    where: { tenantId: c.tenantId, id: body.teacherUserId, active: true },
  });
  if (!user)
    fail(400, "TEACHER_INVALID", "Выберите действующего преподавателя");
  if (
    !(await hasLearningPermission(
      { ...c, userId: user.id, role: user.role },
      courseId,
      groupId,
      "ATTENDANCE",
      tx,
    ))
  )
    fail(
      400,
      "TEACHER_SCOPE",
      "Преподаватель не назначен на эту программу или группу",
    );
  if (body.recordingMaterialId) {
    const material = await tx.lmsMaterial.findFirst({
      where: { tenantId: c.tenantId, id: body.recordingMaterialId },
    });
    const binding =
      material && material.courseId !== courseId
        ? await tx.lmsMaterialBinding.findFirst({
            where: { tenantId: c.tenantId, courseId, materialId: material.id },
          })
        : null;
    const state = material && await tx.lmsMaterialState.findUnique({ where: { tenantId_materialId: { tenantId: c.tenantId, materialId: material.id } } });
    if (!material || state?.hidden || state?.deleted || !material.mimeType.startsWith("video/") || (material.courseId !== courseId && !binding))
      fail(
        404,
        "NOT_FOUND",
        "Запись занятия не найдена в материалах программы",
      );
  }
}
export async function createTeachingEvent(c: Context, input: unknown) {
  const body = parse(
    z
      .object({
        ...fields,
        groupId: identifier,
        requirementId: identifier.nullable().optional(),
        operationId: z.string().uuid(),
      })
      .strict(),
    input,
  );
  validateTeachingDates(body.startsAt, body.endsAt, body.timezone);
  const payloadHash = hash(JSON.stringify(body));
  return transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "LmsGroup" WHERE "tenantId"=${c.tenantId} AND id=${body.groupId} FOR UPDATE`;
    const { group, version } = await groupVersion(c, body.groupId, tx);
    await assertLearningPermission(
      c,
      version.courseId,
      group.id,
      "SCHEDULE",
      tx,
    );
    const replay = await tx.lmsTeachingEventChange.findUnique({
      where: {
        tenantId_commandId: {
          tenantId: c.tenantId,
          commandId: body.operationId,
        },
      },
    });
    if (replay) {
      if (replay.payloadHash !== payloadHash)
        fail(409, "COMMAND_CONFLICT", "Повтор операции содержит другие данные");
      return scopedTeachingEvent(c, replay.eventId, tx);
    }
    if (body.requirementId) {
      const lesson = courseContentSchema
        .parse(version.content)
        .modules.flatMap((m) => m.lessons)
        .find((l) => l.id === body.requirementId && l.kind === "SESSION");
      if (!lesson)
        fail(
          400,
          "SESSION_REQUIREMENT_INVALID",
          "Выберите занятие из назначенной версии программы",
        );
      if (
        await tx.lmsTeachingEvent.findFirst({
          where: {
            tenantId: c.tenantId,
            groupId: group.id,
            requirementId: body.requirementId,
            status: "SCHEDULED",
          },
        })
      )
        fail(
          409,
          "SESSION_ALREADY_SCHEDULED",
          "Для этого требования уже есть занятие. Перенесите его или сначала отмените.",
        );
    }
    await validateBindings(c, version.courseId, group.id, body, tx);
    const event = await tx.lmsTeachingEvent.create({
      data: {
        ...body,
        practiceCriteria: body.practiceCriteria ? json(body.practiceCriteria) : undefined,
        startsAt: new Date(body.startsAt),
        endsAt: new Date(body.endsAt),
        tenantId: c.tenantId,
        courseVersionId: version.id,
        createdBy: c.userId,
        revision: 1,
      },
    });
    await tx.lmsTeachingEventChange.create({
      data: {
        tenantId: c.tenantId,
        eventId: event.id,
        revision: event.revision,
        commandId: body.operationId,
        payloadHash,
        kind: "CREATED",
        actorId: c.userId,
        reason: "",
        snapshot: json(event),
      },
    });
    await notifyTeachingEvent(tx, event, "CREATED");
    await audit(tx, c, "lms.teaching-event.created", event.id, {
      groupId: group.id,
      requirementId: body.requirementId,
    });
    return event;
  });
}
export async function updateTeachingEvent(
  c: Context,
  id: string,
  input: unknown,
  cancel = false,
) {
  const command = {
    commandId: z.string().uuid(),
    expectedRevision: z.number().int().min(1),
    reason: z.string().trim().min(1).max(2000),
  };
  const edited = cancel
    ? null
    : parse(z.object({ ...fields, ...command }).strict(), input);
  const body = edited || parse(z.object(command).strict(), input);
  const payloadHash = hash(JSON.stringify({ id, cancel, ...body }));
  return transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "LmsTeachingEvent" WHERE "tenantId"=${c.tenantId} AND id=${id} FOR UPDATE`;
    const event = await scopedTeachingEvent(c, id, tx),
      { version } = await groupVersion(c, event.groupId, tx);
    await assertLearningPermission(
      c,
      version.courseId,
      event.groupId,
      "SCHEDULE",
      tx,
    );
    const replay = await tx.lmsTeachingEventChange.findUnique({
      where: {
        tenantId_commandId: { tenantId: c.tenantId, commandId: body.commandId },
      },
    });
    if (replay) {
      if (replay.payloadHash !== payloadHash)
        fail(409, "COMMAND_CONFLICT", "Повтор операции содержит другие данные");
      return event;
    }
    if (event.revision !== body.expectedRevision)
      fail(
        409,
        "REVISION_CONFLICT",
        "Занятие изменено. Откройте сохранённую версию",
      );
    if (event.status === "CANCELLED")
      fail(
        409,
        "EVENT_CANCELLED",
        "Занятие отменено. Создайте замену при необходимости",
      );
    let changes: Prisma.LmsTeachingEventUpdateInput = { status: "CANCELLED" };
    if (edited) {
      validateTeachingDates(edited.startsAt, edited.endsAt, edited.timezone);
      await validateBindings(c, version.courseId, event.groupId, edited, tx);
      if (edited.practiceCriteria && hash(edited.practiceCriteria) !== hash(event.practiceCriteria || []) && await tx.lmsReviewDecision.findFirst({ where: { tenantId: c.tenantId, targetType: "PRACTICE", targetId: { startsWith: `${id}:` } } }))
        fail(409, "PRACTICE_CRITERIA_FROZEN", "Практика уже оценена. Для новых критериев создайте отдельное занятие");
      if (
        (Date.parse(edited.startsAt) !== event.startsAt.getTime() ||
          Date.parse(edited.endsAt) !== event.endsAt.getTime()) &&
        (await tx.lmsAttendance.findFirst({
          where: { tenantId: c.tenantId, eventId: id },
        }))
      )
        fail(
          409,
          "ATTENDANCE_RECORDED",
          "Участие уже зафиксировано. Создайте отдельное занятие вместо переноса состоявшегося",
        );
      const {
        commandId: _commandId,
        expectedRevision: _expectedRevision,
        reason: _reason,
        ...edit
      } = edited;
      changes = {
        ...edit,
        practiceCriteria: edit.practiceCriteria ? json(edit.practiceCriteria) : undefined,
        startsAt: new Date(edited.startsAt),
        endsAt: new Date(edited.endsAt),
      };
    }
    const updated = await tx.lmsTeachingEvent.update({
      where: { id },
      data: { ...changes, revision: { increment: 1 } },
    });
    await tx.lmsTeachingEventChange.create({
      data: {
        tenantId: c.tenantId,
        eventId: id,
        revision: updated.revision,
        commandId: body.commandId,
        payloadHash,
        kind: cancel ? "CANCELLED" : "UPDATED",
        actorId: c.userId,
        reason: body.reason,
        snapshot: json(updated),
      },
    });
    await notifyTeachingEvent(tx, updated, cancel ? "CANCELLED" : "UPDATED");
    await audit(
      tx,
      c,
      cancel ? "lms.teaching-event.cancelled" : "lms.teaching-event.updated",
      id,
      { reason: body.reason, revision: updated.revision },
    );
    return updated;
  });
}
export async function teachingAttendance(
  c: Context,
  id: string,
  input: unknown,
) {
  const q = parse(learningPageSchema, input),
    event = await scopedTeachingEvent(c, id),
    permissions = await flags(c, event);
  if (!permissions.canAttend && !isLmsStaff(c))
    fail(
      403,
      "ROLE_DENIED",
      "Список участия доступен назначенному преподавателю",
    );
  const scope = await enrollmentScopeSql(c, "n");
  const where = Prisma.sql`m."tenantId"=${c.tenantId} AND m."groupId"=${event.groupId} AND m."excludedAt" IS NULL AND n."courseVersionId"=${event.courseVersionId} AND (${scope})`;
  const [rows, count] = await Promise.all([
    db.$queryRaw<{ enrollmentId: string; nameRu: string; nameKz: string }[]>(
      Prisma.sql`SELECT n.id AS "enrollmentId",r.data->>'fullNameRu' AS "nameRu",COALESCE(r.data->>'fullNameKz',r.data->>'fullNameRu') AS "nameKz" FROM "LmsGroupMember" m JOIN "Enrollment" n ON n."tenantId"=m."tenantId" AND n.id=m."enrollmentId" JOIN "Recipient" r ON r."tenantId"=n."tenantId" AND r.id=n."recipientId" WHERE ${where} ORDER BY r.data->>'fullNameRu',n.id LIMIT ${q.pageSize} OFFSET ${(q.page - 1) * q.pageSize}`,
    ),
    db.$queryRaw<{ total: bigint }[]>(
      Prisma.sql`SELECT count(*) AS total FROM "LmsGroupMember" m JOIN "Enrollment" n ON n."tenantId"=m."tenantId" AND n.id=m."enrollmentId" WHERE ${where}`,
    ),
  ]);
  const history = rows.length
    ? await db.lmsAttendance.findMany({
        where: {
          tenantId: c.tenantId,
          eventId: id,
          enrollmentId: { in: rows.map((row) => row.enrollmentId) },
        },
        orderBy: { revision: "desc" },
      })
    : [];
  return {
    items: rows.map((row) => {
      const own = history.filter((a) => a.enrollmentId === row.enrollmentId);
      return {
        ...row,
        status: own[0]?.status || null,
        revision: own[0]?.revision || 0,
        recordedAt: own[0]?.recordedAt,
        history: own.map((a) => ({
          revision: a.revision,
          status: a.status,
          reason: a.reason,
          recordedAt: a.recordedAt,
        })),
      };
    }),
    total: Number(count[0]?.total || 0),
    page: q.page,
    pageSize: q.pageSize,
    canAttend: permissions.canAttend,
    eventRevision: event.revision,
  };
}
export async function recordTeachingAttendance(
  c: Context,
  id: string,
  input: unknown,
) {
  const body = parse(
    z
      .object({
        commandId: z.string().uuid(),
        expectedRevision: z.number().int().min(1),
        reason: z.string().trim().min(1).max(2000),
        items: z
          .array(
            z
              .object({
                enrollmentId: identifier,
                status: z.enum(["PRESENT", "ABSENT"]),
                expectedRevision: z.number().int().min(0),
              })
              .strict(),
          )
          .min(1)
          .max(250),
      })
      .strict(),
    input,
  );
  if (
    new Set(body.items.map((row) => row.enrollmentId)).size !==
    body.items.length
  )
    fail(400, "DUPLICATE_ENROLLMENT", "Участник выбран дважды");
  return transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "LmsTeachingEvent" WHERE "tenantId"=${c.tenantId} AND id=${id} FOR UPDATE`;
    const event = await scopedTeachingEvent(c, id, tx),
      { version } = await groupVersion(c, event.groupId, tx);
    await assertLearningPermission(
      c,
      version.courseId,
      event.groupId,
      "ATTENDANCE",
      tx,
    );
    if (event.status !== "SCHEDULED")
      fail(
        409,
        "EVENT_CANCELLED",
        "Нельзя отмечать участие в отменённом занятии",
      );
    if (event.startsAt.getTime() > Date.now())
      fail(409, "EVENT_NOT_STARTED", "Занятие ещё не началось");
    if (event.revision !== body.expectedRevision)
      fail(409, "REVISION_CONFLICT", "Занятие изменено. Обновите список");
    const ids = body.items.map((row) => row.enrollmentId),
      scope = await enrollmentScopeSql(c, "n", tx);
    const members = await tx.$queryRaw<{ id: string }[]>(
      Prisma.sql`SELECT n.id FROM "Enrollment" n JOIN "LmsGroupMember" m ON m."tenantId"=n."tenantId" AND m."enrollmentId"=n.id WHERE m."tenantId"=${c.tenantId} AND m."groupId"=${event.groupId} AND m."excludedAt" IS NULL AND n."courseVersionId"=${event.courseVersionId} AND n.id IN (${Prisma.join(ids)}) AND (${scope}) FOR UPDATE OF n`,
    );
    if (members.length !== ids.length)
      fail(404, "NOT_FOUND", "Участник не входит в доступную группу");
    const replay = await tx.lmsAttendance.findMany({
      where: { tenantId: c.tenantId, commandId: body.commandId },
    });
    if (replay.length) {
      if (
        replay.length !== body.items.length ||
        body.items.some(
          (item) =>
            !replay.some(
              (row) =>
                row.eventId === id &&
                row.enrollmentId === item.enrollmentId &&
                row.status === item.status &&
                row.reason === body.reason &&
                row.revision === item.expectedRevision + 1,
            ),
        )
      )
        fail(409, "COMMAND_CONFLICT", "Повтор операции содержит другие данные");
      return { saved: replay.length };
    }
    const current = await tx.$queryRaw<
      { enrollmentId: string; revision: number }[]
    >(
      Prisma.sql`SELECT DISTINCT ON("enrollmentId") "enrollmentId",revision FROM "LmsAttendance" WHERE "tenantId"=${c.tenantId} AND "eventId"=${id} AND "enrollmentId" IN (${Prisma.join(ids)}) ORDER BY "enrollmentId",revision DESC`,
    );
    if (
      body.items.some(
        (item) =>
          (current.find((row) => row.enrollmentId === item.enrollmentId)
            ?.revision || 0) !== item.expectedRevision,
      )
    )
      fail(
        409,
        "REVISION_CONFLICT",
        "Отметки изменены. Откройте сохранённый список",
      );
    await tx.lmsAttendance.createMany({
      data: body.items.map((item) => ({
        tenantId: c.tenantId,
        eventId: id,
        enrollmentId: item.enrollmentId,
        revision: item.expectedRevision + 1,
        status: item.status,
        method: "MANUAL",
        actorId: c.userId,
        reason: body.reason,
        commandId: body.commandId,
      })),
    });
    await audit(tx, c, "lms.attendance.recorded", id, {
      commandId: body.commandId,
      count: body.items.length,
      reason: body.reason,
    });
    return { saved: body.items.length };
  });
}
