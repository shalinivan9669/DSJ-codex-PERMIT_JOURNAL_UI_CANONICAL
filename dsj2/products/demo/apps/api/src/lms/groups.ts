import { z } from "@demo/contracts";
import { audit, db, fail, parse, transaction, type Context } from "../core";
import { enrollmentFilter, assertLmsStaff, isLmsStaff } from "./scope";
import { assertAccessDate, runAssignmentChunk } from "./assignment-operations";
import { listEnrollmentPage } from "./enrollment-list";

export async function groupDetail(c: Context, id: string, query: unknown = {}) {
  if (!isLmsStaff(c) && c.role !== "EMPLOYER")
    fail(403, "ROLE_DENIED", "Недостаточно прав");
  const group = await db.lmsGroup.findFirst({
    where: { id, tenantId: c.tenantId },
  });
  if (!group) fail(404, "NOT_FOUND", "Группа не найдена");
  const scope = await enrollmentFilter(c);
  const access = await db.enrollment.findFirst({
    where: { AND: [scope, { groupId: id }] },
    select: { id: true },
  });
  if (!isLmsStaff(c) && !access) fail(404, "NOT_FOUND", "Группа не найдена");
  const page = await listEnrollmentPage(c, {
    ...parse(
      z.object({ page: z.coerce.number().int().min(1).default(1) }).strict(),
      query,
    ),
    groupId: id,
  });
  const exclusions = await db.lmsGroupMember.findMany({
    where: { tenantId: c.tenantId, groupId: id, excludedAt: { not: null } },
    select: { enrollmentId: true, excludedAt: true },
    take: 250,
    orderBy: { excludedAt: "desc" },
  });
  const historical = await db.enrollment.findMany({
    where: {
      AND: [scope, { id: { in: exclusions.map((m) => m.enrollmentId) } }],
    },
    select: { id: true, recipientId: true },
    take: 250,
  });
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
      ...(!isLmsStaff(c)
        ? { sourceOrderId: null, sourceRequestId: null, createdBy: undefined }
        : {}),
    },
    ...page,
    excluded: historical.map((e) => ({
      ...e,
      recipient: people.find((p) => p.id === e.recipientId)?.data,
      excludedAt: exclusions.find((m) => m.enrollmentId === e.id)!.excludedAt,
    })),
  };
}

export async function updateGroup(c: Context, id: string, input: unknown) {
  assertLmsStaff(c);
  const data = parse(
    z
      .object({
        name: z.string().trim().min(1).max(300).optional(),
        dueAt: z.string().datetime().optional(),
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
    if (data.dueAt) {
      // The current roster controls future actions. Individual extensions and completed facts survive.
      updated =
        await tx.$executeRaw`UPDATE "Enrollment" e SET "dueAt"=${new Date(data.dueAt)} WHERE e."tenantId"=${c.tenantId} AND e."groupId"=${id} AND NOT e."dueAtOverride" AND e."completedAt" IS NULL AND e.status='ACTIVE' AND EXISTS (SELECT 1 FROM "LmsGroupMember" m WHERE m."tenantId"=e."tenantId" AND m."enrollmentId"=e.id AND m."groupId"=${id} AND m."excludedAt" IS NULL)`;
    }
    const after = await tx.lmsGroup.update({
      where: { id },
      data: {
        ...(data.name ? { name: data.name } : {}),
        ...(data.dueAt ? { dueAt: new Date(data.dueAt) } : {}),
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
  return runAssignmentChunk(c, {
    ...data,
    groupId: id,
    groupName: group.name,
    courseVersionId: group.courseVersionId,
    customerId: group.customerId,
    sourceRequestId: group.sourceRequestId,
    sourceOrderId: group.sourceOrderId,
    dueAt: group.dueAt.toISOString(),
  });
}

export async function orderTraining(c: Context, id: string) {
  assertLmsStaff(c);
  const order = await db.serviceOrder.findFirst({
    where: { id, tenantId: c.tenantId },
    select: { id: true },
  });
  if (!order) fail(404, "NOT_FOUND", "Заказ не найден");
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
    requests: requests.map((r) => ({
      ...r,
      title: titles.find((p) => p.id === r.requestId)?.title || "",
    })),
  };
}
