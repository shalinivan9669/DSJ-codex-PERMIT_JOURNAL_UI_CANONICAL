import { randomBytes } from "node:crypto";
import type { Response } from "express";
import {
  employerInviteSchema,
  employerInviteTokenSchema,
  employerInviteExchangeSchema,
} from "@demo/contracts/src/employer-invites";
import {
  db,
  fail,
  hash,
  json,
  parse,
  transaction,
  audit,
  type Context,
  type DemoRequest,
} from "./core";
import {
  passwordHash,
  passwordMatches,
  rateLimit,
  sessionCookies,
} from "./auth";

function invalid(): never {
  fail(
    410,
    "INVITE_UNAVAILABLE",
    "Приглашение недействительно, использовано или отозвано. Обратитесь в учебный центр.",
  );
}
function admin(c: Context) {
  if (c.role !== "ADMIN")
    fail(
      403,
      "ROLE_DENIED",
      "Только администратор может приглашать представителей",
    );
}
const publicFields = {
  id: true,
  customerId: true,
  email: true,
  displayName: true,
  permissions: true,
  recipientIds: true,
  expiresAt: true,
  accessExpiresAt: true,
  consumedAt: true,
  revokedAt: true,
  createdAt: true,
} as const;
export async function listEmployerInvites(c: Context) {
  admin(c);
  return {
    items: await db.employerInvite.findMany({
      where: { tenantId: c.tenantId },
      select: publicFields,
      orderBy: { createdAt: "desc" },
      take: 500,
    }),
  };
}
export async function createEmployerInvite(c: Context, input: unknown) {
  admin(c);
  const data = parse(employerInviteSchema, input);
  const now = Date.now();
  if (
    Date.parse(data.expiresAt) <= now ||
    Date.parse(data.expiresAt) > now + 7 * 86400_000 ||
    Date.parse(data.accessExpiresAt) < Date.parse(data.expiresAt)
  )
    fail(
      400,
      "INVITE_EXPIRY",
      "Приглашение действует до 7 суток; срок доступа должен заканчиваться не раньше приглашения",
    );
  const token = randomBytes(32).toString("hex");
  const invite = await transaction(async (tx) => {
    // Every invitation mutation acquires this key before invitation rows.
    // Serializing creation also guarantees that a newly copied link supersedes older pending links.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${data.email}, 8142))`;
    if (
      !(await tx.customerOrganization.findFirst({
        where: { id: data.customerId, tenantId: c.tenantId },
      }))
    )
      fail(404, "CUSTOMER_NOT_FOUND", "Заказчик не найден");
    const user = await tx.user.findUnique({ where: { email: data.email } });
    if (
      user &&
      (user.tenantId !== c.tenantId || user.role !== "EMPLOYER" || !user.active)
    )
      fail(
        400,
        "INVITE_PRINCIPAL",
        "Этот адрес нельзя использовать для отдельного представителя выбранного центра",
      );
    const previousMembership = user
      ? await tx.employerMembership.findUnique({
          where: {
            tenantId_customerId_userId: {
              tenantId: c.tenantId,
              customerId: data.customerId,
              userId: user.id,
            },
          },
        })
      : null;
    if (
      previousMembership?.active &&
      (!previousMembership.expiresAt ||
        previousMembership.expiresAt.getTime() > Date.now())
    )
      fail(
        409,
        "MEMBERSHIP_EXISTS",
        "У представителя уже есть действующий доступ к этой организации. Для изменения области сначала отзовите доступ, затем создайте новое приглашение.",
      );
    const recipients = [...new Set(data.recipientIds)];
    if (
      recipients.length &&
      (await tx.recipient.count({
        where: { id: { in: recipients }, tenantId: c.tenantId },
      })) !== recipients.length
    )
      fail(404, "RECIPIENT_NOT_FOUND", "Один из получателей не найден");
    // Supersede earlier unclaimed links for precisely the same principal/company.
    await tx.employerInvite.updateMany({
      where: {
        tenantId: c.tenantId,
        customerId: data.customerId,
        email: data.email,
        consumedAt: null,
        revokedAt: null,
      },
      data: { revokedAt: new Date() },
    });
    const value = await tx.employerInvite.create({
      data: {
        tenantId: c.tenantId,
        customerId: data.customerId,
        email: data.email,
        displayName: data.displayName,
        secretHash: hash(token),
        existingUserId: user?.id,
        userSessionVersion: user?.sessionVersion,
        permissions: json([...new Set(data.permissions)]),
        recipientIds: json(recipients),
        expiresAt: new Date(data.expiresAt),
        accessExpiresAt: new Date(data.accessExpiresAt),
        createdBy: c.userId,
      },
      select: publicFields,
    });
    await audit(tx, c, "EMPLOYER_INVITE_CREATED", value.id, {
      customerId: data.customerId,
    });
    return value;
  });
  return {
    ...invite,
    inviteUrl: `${process.env.DEMO_ORIGIN || "http://localhost:3100"}/invite#${token}`,
  };
}
export async function inspectEmployerInvite(req: DemoRequest, input: unknown) {
  rateLimit(`invite-inspect:${req.ip}`, 20);
  const { token } = parse(employerInviteTokenSchema, input);
  const invite = await db.employerInvite.findUnique({
    where: { secretHash: hash(token) },
  });
  if (
    !invite ||
    invite.consumedAt ||
    invite.revokedAt ||
    invite.expiresAt.getTime() <= Date.now()
  )
    invalid();
  const tenant = await db.tenant.findUnique({ where: { id: invite.tenantId } });
  const creator = await db.user.findFirst({
    where: {
      id: invite.createdBy,
      tenantId: invite.tenantId,
      active: true,
      role: "ADMIN",
    },
  });
  if (!tenant?.active || !creator) invalid();
  return {
    existingAccount: !!invite.existingUserId,
    expiresAt: invite.expiresAt,
    accessExpiresAt: invite.accessExpiresAt,
  };
}
export async function exchangeEmployerInvite(
  req: DemoRequest,
  res: Response,
  input: unknown,
) {
  rateLimit(`invite-exchange:${req.ip}`, 10);
  const data = parse(employerInviteExchangeSchema, input);
  // Calculate outside the transaction to keep locks short. This hash is used only for a NEW account.
  const newDigest = await passwordHash(data.password);
  const token = randomBytes(32).toString("hex");
  const csrf = randomBytes(32).toString("hex");
  const result = await transaction(async (tx) => {
    const digest = hash(data.token);
    const lookup = await tx.employerInvite.findUnique({
      where: { secretHash: digest },
      select: { email: true },
    });
    if (!lookup) invalid();
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${lookup.email}, 8142))`;
    await tx.$executeRaw`SELECT id FROM "EmployerInvite" WHERE "secretHash"=${digest} FOR UPDATE`;
    const invite = await tx.employerInvite.findUnique({
      where: { secretHash: digest },
    });
    if (
      !invite ||
      invite.consumedAt ||
      invite.revokedAt ||
      invite.expiresAt.getTime() <= Date.now() ||
      invite.accessExpiresAt.getTime() <= Date.now()
    )
      invalid();
    await tx.$executeRaw`SELECT id FROM "Tenant" WHERE id=${invite.tenantId} FOR SHARE`;
    const tenant = await tx.tenant.findUnique({
      where: { id: invite.tenantId },
    });
    const creator = await tx.user.findFirst({
      where: {
        id: invite.createdBy,
        tenantId: invite.tenantId,
        active: true,
        role: "ADMIN",
      },
    });
    if (!tenant?.active || !creator) invalid();
    let user = await tx.user.findUnique({ where: { email: invite.email } });
    if (invite.existingUserId) {
      // Use the same lock order as membership revocation, then revalidate the principal.
      await tx.$executeRaw`SELECT id FROM "EmployerMembership" WHERE "tenantId"=${invite.tenantId} AND "customerId"=${invite.customerId} AND "userId"=${invite.existingUserId} FOR UPDATE`;
      await tx.$executeRaw`SELECT id FROM "User" WHERE id=${invite.existingUserId} FOR UPDATE`;
      user = await tx.user.findUnique({ where: { id: invite.existingUserId } });
      if (
        !user ||
        user.email !== invite.email ||
        user.tenantId !== invite.tenantId ||
        !user.active ||
        user.role !== "EMPLOYER" ||
        user.sessionVersion !== invite.userSessionVersion
      )
        invalid();
      if (!(await passwordMatches(data.password, user.passwordHash)))
        fail(
          401,
          "INVITE_PASSWORD",
          "Для существующей учётной записи укажите её текущий пароль",
        );
      user = await tx.user.update({
        where: { id: user.id },
        data: { sessionVersion: { increment: 1 } },
      });
      await tx.session.deleteMany({
        where: { tenantId: invite.tenantId, userId: user.id },
      });
    } else {
      if (user) invalid();
      user = await tx.user.create({
        data: {
          tenantId: invite.tenantId,
          email: invite.email,
          displayName: invite.displayName,
          passwordHash: newDigest,
          role: "EMPLOYER",
        },
      });
    }
    const previousMembership = await tx.employerMembership.findUnique({
      where: {
        tenantId_customerId_userId: {
          tenantId: invite.tenantId,
          customerId: invite.customerId,
          userId: user.id,
        },
      },
    });
    if (
      previousMembership?.active &&
      (!previousMembership.expiresAt ||
        previousMembership.expiresAt.getTime() > Date.now())
    )
      invalid();
    const membershipData = {
      tenantId: invite.tenantId,
      customerId: invite.customerId,
      userId: user.id,
      permissions: json(invite.permissions),
      recipientIds: json(invite.recipientIds),
      expiresAt: invite.accessExpiresAt,
      createdBy: invite.createdBy,
      active: true,
    };
    const membership = previousMembership
      ? await tx.employerMembership.update({
          where: { id: previousMembership.id },
          data: membershipData,
        })
      : await tx.employerMembership.create({ data: membershipData });
    const now = new Date();
    // A membership can be explicitly regranted. Retire the old grant handles so
    // revoking a historical accepted link can never deactivate the new grant.
    if (previousMembership)
      await tx.employerInvite.updateMany({
        where: {
          tenantId: invite.tenantId,
          membershipId: previousMembership.id,
          consumedAt: { not: null },
          revokedAt: null,
        },
        data: { revokedAt: now },
      });
    const changed = await tx.employerInvite.updateMany({
      where: {
        id: invite.id,
        consumedAt: null,
        revokedAt: null,
        expiresAt: { gt: now },
      },
      data: { consumedAt: now, membershipId: membership.id },
    });
    if (changed.count !== 1) invalid();
    const expiresAt = new Date(
      Math.min(Date.now() + 8 * 3600_000, invite.accessExpiresAt.getTime()),
    );
    await tx.session.create({
      data: {
        id: hash(token),
        tenantId: invite.tenantId,
        userId: user.id,
        csrfHash: hash(csrf),
        sessionVersion: user.sessionVersion,
        expiresAt,
      },
    });
    await audit(
      tx,
      {
        tenantId: invite.tenantId,
        userId: user.id,
        role: "EMPLOYER",
        sessionId: hash(token),
        csrfHash: hash(csrf),
        correlationId: req.correlationId,
      },
      "EMPLOYER_INVITE_ACCEPTED",
      invite.id,
      {
        membershipId: membership.id,
        regranted: !!previousMembership,
        previousScope: previousMembership
          ? {
              permissions: previousMembership.permissions,
              recipientIds: previousMembership.recipientIds,
              expiresAt: previousMembership.expiresAt,
              active: previousMembership.active,
            }
          : null,
      },
    );
    return { csrfToken: csrf, expiresAt, membershipId: membership.id };
  });
  sessionCookies(
    res,
    token,
    csrf,
    Math.max(1, Math.floor((result.expiresAt.getTime() - Date.now()) / 1000)),
  );
  return result;
}
export async function revokeEmployerInvite(c: Context, id: string) {
  admin(c);
  return transaction(async (tx) => {
    const lookup = await tx.employerInvite.findFirst({
      where: { id, tenantId: c.tenantId },
      select: { email: true },
    });
    if (!lookup) fail(404, "NOT_FOUND", "Приглашение не найдено");
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${lookup.email}, 8142))`;
    await tx.$executeRaw`SELECT id FROM "EmployerInvite" WHERE id=${id} AND "tenantId"=${c.tenantId} FOR UPDATE`;
    const invite = await tx.employerInvite.findFirst({
      where: { id, tenantId: c.tenantId },
    });
    if (!invite) fail(404, "NOT_FOUND", "Приглашение не найдено");
    if (invite.revokedAt) return { revoked: true };
    await tx.employerInvite.update({
      where: { id },
      data: { revokedAt: new Date() },
    });
    if (invite.membershipId) {
      const membership = await tx.employerMembership.update({
        where: {
          tenantId_id: { tenantId: c.tenantId, id: invite.membershipId },
        },
        data: { active: false },
      });
      await tx.user.updateMany({
        where: { id: membership.userId, tenantId: c.tenantId },
        data: { sessionVersion: { increment: 1 } },
      });
      await tx.session.deleteMany({
        where: { userId: membership.userId, tenantId: c.tenantId },
      });
    }
    await audit(tx, c, "EMPLOYER_INVITE_REVOKED", id);
    return { revoked: true };
  });
}
