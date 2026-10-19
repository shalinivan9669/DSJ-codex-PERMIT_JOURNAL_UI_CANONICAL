import { Body, Controller, Get, Param, Post, Req } from "@nestjs/common";
import { canManageCenter, z } from "@demo/contracts";
import { membershipSchema } from "@demo/contracts/src/operator-value";
import {
  audit,
  db,
  fail,
  json,
  parse,
  transaction,
  type Context,
  type DemoRequest,
} from "./core";
import { rateLimit } from "./auth";

export const employerAccessRoutes = [
  ["GET", "/employer-access-requests"],
  ["POST", "/employer-access-requests"],
  ["POST", "/employer-access-requests/:id/resolve"],
] as const;
const requestSchema = z
  .object({
    organizationName: z.string().trim().min(2).max(500),
    bin: z
      .string()
      .trim()
      .regex(/^(?:\d{12})?$/)
      .default(""),
    comment: z.string().trim().max(2000).default(""),
    requestKey: z.string().uuid(),
  })
  .strict();
const decisionSchema = z
  .object({
    decision: z.enum(["APPROVE", "REJECT"]),
    customerId: z.string().max(80).optional(),
    permissions: membershipSchema.shape.permissions.default(["READ"]),
    expiresAt: z.string().datetime().nullable().optional(),
    note: z.string().trim().min(3).max(2000),
  })
  .strict();
function accessContext(req: DemoRequest) {
  const c = req.context;
  if (!c) fail(401, "SESSION_REQUIRED", "Войдите в DEMO");
  if (c.learningMode || (!canManageCenter(c.role) && c.role !== "EMPLOYER"))
    fail(403, "ROLE_DENIED", "Недостаточно прав");
  return c;
}
export async function listEmployerAccessRequests(c: Context) {
  if (!canManageCenter(c.role) && c.role !== "EMPLOYER")
    fail(403, "ROLE_DENIED", "Недостаточно прав");
  const manager = canManageCenter(c.role);
  const items = await db.employerAccessRequest.findMany({
    where: { tenantId: c.tenantId, ...(manager ? {} : { userId: c.userId }) },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: 200,
  });
  const users = manager
    ? await db.user.findMany({
        where: {
          tenantId: c.tenantId,
          id: { in: items.map((item) => item.userId) },
        },
        select: { id: true, displayName: true, email: true },
      })
    : [];
  const customers = await db.customerOrganization.findMany({
    where: {
      tenantId: c.tenantId,
      id: {
        in: items.flatMap((item) => (item.customerId ? [item.customerId] : [])),
      },
    },
    select: { id: true, nameRu: true, nameKz: true },
  });
  return {
    items: items.map(
      ({ activeKey: _activeKey, requestKey: _requestKey, ...item }) => ({
        ...item,
        ...(manager
          ? { user: users.find((user) => user.id === item.userId) }
          : {}),
        customer:
          customers.find((customer) => customer.id === item.customerId) || null,
      }),
    ),
  };
}
export async function requestEmployerAccess(c: Context, input: unknown) {
  if (c.role !== "EMPLOYER")
    fail(403, "ROLE_DENIED", "Запрос доступен представителю организации");
  const data = parse(requestSchema, input);
  return transaction(async (tx) => {
    await tx.$executeRaw`SELECT id FROM "User" WHERE "tenantId"=${c.tenantId} AND id=${c.userId} FOR UPDATE`;
    const user = await tx.user.findFirst({
      where: {
        tenantId: c.tenantId,
        id: c.userId,
        active: true,
        role: "EMPLOYER",
      },
    });
    if (!user) fail(403, "ROLE_DENIED", "Войдите заново");
    const replay = await tx.employerAccessRequest.findUnique({
      where: {
        tenantId_requestKey: {
          tenantId: c.tenantId,
          requestKey: data.requestKey,
        },
      },
    });
    if (replay) {
      if (
        replay.userId !== c.userId ||
        replay.organizationName !== data.organizationName ||
        replay.bin !== data.bin ||
        replay.comment !== data.comment
      )
        fail(
          409,
          "IDEMPOTENCY_CONFLICT",
          "Запрос изменился. Обновите страницу",
        );
      return replay;
    }
    const activeKey = `${c.tenantId}:${c.userId}:${data.bin || data.organizationName.toLocaleLowerCase("ru").replace(/\s+/g, " ")}`;
    const pending = await tx.employerAccessRequest.findUnique({
      where: { activeKey },
    });
    if (pending) return pending;
    const value = await tx.employerAccessRequest.create({
      data: { ...data, tenantId: c.tenantId, userId: c.userId, activeKey },
    });
    const managers = await tx.user.findMany({
      where: {
        tenantId: c.tenantId,
        active: true,
        role: { in: ["SUPER_ADMIN", "ADMIN", "DIRECTOR"] },
      },
      select: { id: true },
    });
    for (const manager of managers)
      await tx.lmsLearningNotification.create({
        data: {
          tenantId: c.tenantId,
          userId: manager.id,
          sourceType: "ACCOUNT",
          sourceId: manager.id,
          deliveryKey: `EMPLOYER_ACCESS:${value.id}:PENDING`,
          kind: "EMPLOYER_ACCESS_REQUESTED",
          titleRu: `Запрос доступа: ${data.organizationName}`,
          titleKz: `Рұқсат сұрауы: ${data.organizationName}`,
          href: "/settings?tab=users#organization-access",
        },
      });
    await audit(tx, c, "EMPLOYER_ACCESS_REQUESTED", value.id, {
      organizationName: data.organizationName,
      bin: data.bin,
    });
    return value;
  });
}
export async function resolveEmployerAccess(
  c: Context,
  id: string,
  input: unknown,
) {
  if (!canManageCenter(c.role))
    fail(403, "ROLE_DENIED", "Решение принимает администратор центра");
  const data = parse(decisionSchema, input);
  if (data.expiresAt && new Date(data.expiresAt) <= new Date())
    fail(400, "VALIDATION", "Укажите будущую дату окончания доступа");
  return transaction(async (tx) => {
    await tx.$executeRaw`SELECT id FROM "EmployerAccessRequest" WHERE id=${id} AND "tenantId"=${c.tenantId} FOR UPDATE`;
    const request = await tx.employerAccessRequest.findFirst({
      where: { id, tenantId: c.tenantId },
    });
    if (!request) fail(404, "NOT_FOUND", "Запрос не найден");
    const actor = await tx.user.findFirst({
      where: { id: c.userId, tenantId: c.tenantId, active: true },
    });
    if (!actor || actor.role !== c.role || !canManageCenter(actor.role))
      fail(403, "ROLE_DENIED", "Полномочия изменились. Войдите заново");
    const status = data.decision === "APPROVE" ? "APPROVED" : "REJECTED";
    if (request.status !== "PENDING") {
      if (
        request.status === status &&
        request.decisionNote === data.note &&
        (status === "REJECTED" || request.customerId === data.customerId)
      )
        return request;
      fail(409, "REVISION_CONFLICT", "По запросу уже принято другое решение");
    }
    let membershipId: string | null = null;
    if (status === "APPROVED") {
      if (!data.customerId || !data.permissions.includes("READ"))
        fail(400, "VALIDATION", "Выберите организацию и разрешите просмотр");
      const customer = await tx.customerOrganization.findFirst({
        where: { tenantId: c.tenantId, id: data.customerId, archived: false },
      });
      if (!customer || (request.bin && customer.bin !== request.bin))
        fail(
          400,
          "CUSTOMER_BIN_MISMATCH",
          "БИН выбранной организации должен совпадать с запросом",
        );
      await tx.$executeRaw`SELECT id FROM "User" WHERE id=${request.userId} AND "tenantId"=${c.tenantId} FOR UPDATE`;
      if (
        !(await tx.user.findFirst({
          where: {
            id: request.userId,
            tenantId: c.tenantId,
            active: true,
            role: "EMPLOYER",
          },
        }))
      )
        fail(
          409,
          "EMPLOYER_USER_REQUIRED",
          "Представитель неактивен или его роль изменена",
        );
      const where = {
        tenantId_customerId_userId: {
          tenantId: c.tenantId,
          customerId: customer.id,
          userId: request.userId,
        },
      };
      const existing = await tx.employerMembership.findUnique({ where });
      if (
        existing?.active &&
        (!existing.expiresAt || existing.expiresAt > new Date())
      )
        fail(
          409,
          "EMPLOYER_ACCESS_EXISTS",
          "Доступ уже действует. Измените его в списке представителей",
        );
      const membership = await tx.employerMembership.upsert({
        where,
        create: {
          tenantId: c.tenantId,
          customerId: customer.id,
          userId: request.userId,
          permissions: json([...new Set(data.permissions)]),
          recipientIds: json([]),
          createdBy: c.userId,
          expiresAt: data.expiresAt ? new Date(data.expiresAt) : null,
        },
        update: {
          active: true,
          permissions: json([...new Set(data.permissions)]),
          recipientIds: json([]),
          createdBy: c.userId,
          expiresAt: data.expiresAt ? new Date(data.expiresAt) : null,
        },
      });
      membershipId = membership.id;
      await audit(tx, c, "EMPLOYER_MEMBERSHIP_CREATED", membership.id, {
        requestId: id,
        customerId: customer.id,
        permissions: data.permissions,
        expiresAt: data.expiresAt,
      });
    }
    const value = await tx.employerAccessRequest.update({
      where: { id },
      data: {
        status,
        activeKey: null,
        decisionNote: data.note,
        customerId: status === "APPROVED" ? data.customerId : null,
        membershipId,
        resolvedBy: c.userId,
        resolvedAt: new Date(),
      },
    });
    await tx.lmsLearningNotification.create({
      data: {
        tenantId: c.tenantId,
        userId: request.userId,
        sourceType: "ACCOUNT",
        sourceId: request.userId,
        deliveryKey: `EMPLOYER_ACCESS:${id}:${status}`,
        kind: "EMPLOYER_ACCESS_RESOLVED",
        titleRu:
          status === "APPROVED"
            ? "Доступ к организации предоставлен"
            : "Получен ответ на запрос доступа",
        titleKz:
          status === "APPROVED"
            ? "Ұйымға рұқсат берілді"
            : "Рұқсат сұрауына жауап алынды",
        href: "/portal",
      },
    });
    await audit(tx, c, "EMPLOYER_ACCESS_RESOLVED", id, {
      status,
      note: data.note,
      membershipId,
    });
    return value;
  });
}
@Controller()
export class EmployerAccessController {
  @Get("employer-access-requests") list(@Req() req: DemoRequest) {
    return listEmployerAccessRequests(accessContext(req));
  }
  @Post("employer-access-requests") create(
    @Req() req: DemoRequest,
    @Body() body: unknown,
  ) {
    const c = accessContext(req);
    rateLimit(`employer-access:${c.tenantId}:${c.userId}`, 20, 60000);
    return requestEmployerAccess(c, body);
  }
  @Post("employer-access-requests/:id/resolve") resolve(
    @Req() req: DemoRequest,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    return resolveEmployerAccess(accessContext(req), id, body);
  }
}
