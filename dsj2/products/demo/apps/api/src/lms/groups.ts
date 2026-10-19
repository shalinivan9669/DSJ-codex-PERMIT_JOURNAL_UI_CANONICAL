import { z } from "@demo/contracts";
import { Prisma } from "@demo/database";
import {
  accessPolicySchema,
  courseContentSchema,
} from "@demo/contracts/src/lms";
import {
  audit,
  db,
  fail,
  json,
  parse,
  transaction,
  type Context,
} from "../core";
import {
  enrollmentScopeSql,
  groupScopeSql,
  hasLearningPermission,
  isTeachingRole,
} from "./learning-permissions";
import { resolveAccessPolicy } from "./access-policy";
import { assertLmsStaff, isLmsStaff } from "./scope";
import { assertAccessDate, runAssignmentChunk } from "./assignment-operations";
import { listEnrollmentPage } from "./enrollment-list";

export async function listGroups(c: Context, input: unknown) {
  const q = parse(
    z
      .object({
        page: z.coerce.number().int().positive().default(1),
        pageSize: z.coerce.number().int().min(1).max(100).default(30),
      })
      .strict(),
    input,
  );
  const scope = groupScopeSql(c, "g");
  const [items, count] = await Promise.all([
    db.$queryRaw<
      Array<{
        id: string;
        name: string;
        courseVersionId: string;
        courseId: string;
        startsAt: Date | null;
        dueAt: Date | null;
        memberCount: bigint;
      }>
    >(
      Prisma.sql`SELECT g.id,g.name,g."courseVersionId",v."courseId",g."startsAt",g."dueAt",(SELECT count(*) FROM "LmsGroupMember" member JOIN "Enrollment" member_e ON member_e."tenantId"=member."tenantId" AND member_e.id=member."enrollmentId" AND member_e."groupId"=g.id WHERE member."tenantId"=g."tenantId" AND member."groupId"=g.id AND member."excludedAt" IS NULL AND ${enrollmentScopeSql(c, "member_e")}) AS "memberCount" FROM "LmsGroup" g JOIN "CourseVersion" v ON v."tenantId"=g."tenantId" AND v.id=g."courseVersionId" WHERE ${scope} ORDER BY g."createdAt" DESC,g.id LIMIT ${q.pageSize} OFFSET ${(q.page - 1) * q.pageSize}`,
    ),
    db.$queryRaw<Array<{ total: bigint }>>(
      Prisma.sql`SELECT count(*) AS total FROM "LmsGroup" g WHERE ${scope}`,
    ),
  ]);
  const teachers = await db.lmsTeachingBinding.findMany({
    where: {
      tenantId: c.tenantId,
      groupId: { in: items.map((g) => g.id) },
      role: "TEACHER",
      revokedAt: null,
    },
    select: { id: true, groupId: true, userId: true },
  });
  return {
    items: items.map((g) => ({
      ...g,
      memberCount: Number(g.memberCount),
      teacherBindings: teachers.filter((b) => b.groupId === g.id),
    })),
    total: Number(count[0].total),
    page: q.page,
    pageSize: q.pageSize,
  };
}

export async function groupDetail(c: Context, id: string, query: unknown = {}) {
  if (!isLmsStaff(c) && c.role !== "EMPLOYER" && !isTeachingRole(c))
    fail(403, "ROLE_DENIED", "Недостаточно прав");
  const visible = await db.$queryRaw<Array<{ id: string }>>(
    Prisma.sql`SELECT g.id FROM "LmsGroup" g WHERE g.id=${id} AND ${groupScopeSql(c, "g")} LIMIT 1`,
  );
  if (!visible.length) fail(404, "NOT_FOUND", "Группа не найдена");
  const group = await db.lmsGroup.findFirst({
    where: { id, tenantId: c.tenantId },
  });
  if (!group) fail(404, "NOT_FOUND", "Группа не найдена");
  const version = await db.courseVersion.findFirstOrThrow({
    where: { tenantId: c.tenantId, id: group.courseVersionId },
  });
  const page = await listEnrollmentPage(c, {
    ...parse(
      z.object({ page: z.coerce.number().int().min(1).default(1) }).strict(),
      query,
    ),
    groupId: id,
  });
  const historical = await db.$queryRaw<Array<{ id: string; recipientId: string; excludedAt: Date }>>(
    Prisma.sql`SELECT history_e.id,history_e."recipientId",member."excludedAt" FROM "LmsGroupMember" member JOIN "Enrollment" history_e ON history_e."tenantId"=member."tenantId" AND history_e.id=member."enrollmentId" WHERE member."tenantId"=${c.tenantId} AND member."groupId"=${id} AND member."excludedAt" IS NOT NULL AND ${enrollmentScopeSql(c, "history_e")} ORDER BY member."excludedAt" DESC,member.id DESC LIMIT 250`,
  );
  const people = await db.recipient.findMany({
    where: {
      tenantId: c.tenantId,
      id: { in: historical.map((e) => e.recipientId) },
    },
    select: { id: true, data: true },
  });
  return {
    group: {
      ...group,
      allowedActions: isLmsStaff(c)
        ? ["edit", "access", "members", "teacher", "schedule", "attendance"]
        : [
            ...((await hasLearningPermission(
              c,
              version.courseId,
              id,
              "SCHEDULE",
            ))
              ? ["schedule"]
              : []),
            ...((await hasLearningPermission(
              c,
              version.courseId,
              id,
              "ATTENDANCE",
            ))
              ? ["attendance"]
              : []),
          ],
      ...(!isLmsStaff(c)
        ? { sourceOrderId: null, sourceRequestId: null, createdBy: undefined }
        : {}),
    },
    ...page,
    excluded: historical.map((e) => ({
      ...e,
      recipient: people.find((p) => p.id === e.recipientId)?.data,
    })),
  };
}

export async function updateGroup(c: Context, id: string, input: unknown) {
  assertLmsStaff(c);
  const data = parse(
    z
      .object({
        name: z.string().trim().min(1).max(300).optional(),
        dueAt: z.string().datetime().nullable().optional(),
        accessPolicy: accessPolicySchema.optional(),
      })
      .strict(),
    input,
  );
  if (data.dueAt) assertAccessDate(new Date(data.dueAt));
  return transaction(async (tx) => {
    await tx.$executeRaw`SELECT id FROM "LmsGroup" WHERE id=${id} AND "tenantId"=${c.tenantId} FOR UPDATE`;
    const group = await tx.lmsGroup.findFirst({
      where: { id, tenantId: c.tenantId },
    });
    if (!group) fail(404, "NOT_FOUND", "Группа не найдена");
    let updated = 0;
    let access: ReturnType<typeof resolveAccessPolicy> | null = null;
    if (data.dueAt !== undefined || data.accessPolicy) {
      const version = await tx.courseVersion.findFirstOrThrow({
        where: { tenantId: c.tenantId, id: group.courseVersionId },
      });
      access = resolveAccessPolicy(
        courseContentSchema.parse(version.content),
        new Date(),
        data.accessPolicy ||
          (group.accessPolicy as unknown as
            | z.infer<typeof accessPolicySchema>
            | undefined),
        data.dueAt,
      );
      if (access.dueAt) assertAccessDate(access.dueAt);
      // The current roster controls future actions. Individual extensions and completed facts survive.
      updated =
        await tx.$executeRaw`UPDATE "Enrollment" e SET "dueAt"=${access.dueAt},"startsAt"=${access.startsAt},"accessPolicy"=${JSON.stringify(access.policy)}::jsonb WHERE e."tenantId"=${c.tenantId} AND e."groupId"=${id} AND NOT e."dueAtOverride" AND e."completedAt" IS NULL AND e.status='ACTIVE' AND EXISTS (SELECT 1 FROM "LmsGroupMember" m WHERE m."tenantId"=e."tenantId" AND m."enrollmentId"=e.id AND m."groupId"=${id} AND m."excludedAt" IS NULL)`;
    }
    const after = await tx.lmsGroup.update({
      where: { id },
      data: {
        ...(data.name ? { name: data.name } : {}),
        ...(access
          ? {
              dueAt: access.dueAt,
              startsAt: access.startsAt,
              accessPolicy: json(access.policy),
            }
          : {}),
      },
    });
    await audit(tx, c, "LMS_GROUP_UPDATED", id, {
      before: { name: group.name, dueAt: group.dueAt },
      after: { name: after.name, dueAt: after.dueAt },
      updated,
    });
    return after;
  });
}

export async function excludeGroupMember(
  c: Context,
  id: string,
  enrollmentId: string,
) {
  assertLmsStaff(c);
  return transaction(async (tx) => {
    const member = await tx.lmsGroupMember.findUnique({
      where: {
        tenantId_groupId_enrollmentId: {
          tenantId: c.tenantId,
          groupId: id,
          enrollmentId,
        },
      },
    });
    if (!member) fail(404, "NOT_FOUND", "Участник не найден");
    if (!member.excludedAt) {
      await tx.lmsGroupMember.update({
        where: { id: member.id },
        data: { excludedAt: new Date(), excludedBy: c.userId },
      });
      await audit(tx, c, "LMS_GROUP_MEMBER_EXCLUDED", id, {
        enrollmentId,
        before: { active: true },
        after: { active: false },
      });
    }
    return { ok: true };
  });
}

export async function addGroupMembers(c: Context, id: string, input: unknown) {
  assertLmsStaff(c);
  const data = parse(
    z
      .object({
        recipientIds: z.array(z.string().min(1).max(100)).min(1).max(10000),
        operationId: z.string().uuid(),
      })
      .strict(),
    input,
  );
  const group = await db.lmsGroup.findFirst({
    where: { id, tenantId: c.tenantId },
  });
  if (!group) fail(404, "NOT_FOUND", "Группа не найдена");
  const operation = await db.lmsAssignmentOperation.findFirst({
    where: { id: data.operationId, tenantId: c.tenantId, actorId: c.userId },
  });
  if (operation) {
    const saved = operation.input as Record<string, unknown>;
    if (saved.groupId !== id)
      fail(
        409,
        "ASSIGNMENT_OPERATION_CONFLICT",
        "Начните новое назначение для этой группы",
      );
    return runAssignmentChunk(c, { ...saved, ...data });
  }
  return runAssignmentChunk(c, {
    ...data,
    groupId: id,
    groupName: group.name,
    courseVersionId: group.courseVersionId,
    customerId: group.customerId,
    sourceRequestId: group.sourceRequestId,
    sourceOrderId: group.sourceOrderId,
  });
}

export async function orderTraining(c: Context, id: string) {
  assertLmsStaff(c);
  const order = await db.serviceOrder.findFirst({
    where: { id, tenantId: c.tenantId },
    select: { id: true },
  });
  if (!order) fail(404, "NOT_FOUND", "Заказ не найден");
  const application = await db.lmsApplication.findFirst({
    where: { tenantId: c.tenantId, orderId: id },
    select: { id: true, kind: true, courseVersionId: true, customerId: true, recipientId: true, enrollmentId: true, state: true },
  });
  const requests = await db.serviceOrderRequest.findMany({
    where: { tenantId: c.tenantId, orderId: id },
    select: { requestId: true },
    orderBy: { id: "asc" },
    take: 250,
  });
  const page = await listEnrollmentPage(c, { sourceOrderId: id, pageSize: 50 });
  const titles = await db.printRequest.findMany({
    where: {
      tenantId: c.tenantId,
      id: { in: requests.map((r) => r.requestId) },
    },
    select: { id: true, title: true },
  });
  return {
    ...page,
    application,
    requests: requests.map((r) => ({
      ...r,
      title: titles.find((p) => p.id === r.requestId)?.title || "",
    })),
  };
}
