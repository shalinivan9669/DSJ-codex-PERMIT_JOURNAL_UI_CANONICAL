import { randomBytes } from "node:crypto";
import { Body, Controller, Get, Post, Req, Res } from "@nestjs/common";
import type { Response } from "express";
import { consentText, consentVersion, z } from "@demo/contracts";
import {
  audit,
  db,
  fail,
  hash,
  json,
  parse,
  requireCapability,
  transaction,
  type Context,
  type DemoRequest,
} from "../core";
import {
  passwordHash,
  passwordMatches,
  passwordSchema,
  rateLimit,
  sessionCookies,
} from "../auth";
import { assertLmsDeploymentAllowed } from "./deployment-gate";

const registration = z
  .object({
    email: z.email().max(255),
    password: passwordSchema,
    displayName: z.string().trim().min(2).max(300),
    consentVersion: z.literal(consentVersion),
    consent: z.literal(true),
  })
  .strict();
const exchange = registration
  .extend({ token: z.string().regex(/^[a-f0-9]{64}$/) })
  .omit({ email: true, displayName: true });
function identityContext(
  tenantId: string,
  userId: string,
  req: DemoRequest,
): Context {
  return {
    tenantId,
    userId,
    role: "LEARNER",
    sessionId: "",
    csrfHash: "",
    correlationId: req.correlationId,
  };
}
async function establishSession(c: Context, res: Response) {
  const token = randomBytes(32).toString("hex");
  const csrf = randomBytes(32).toString("hex");
  const user = await db.user.findFirstOrThrow({
    where: { id: c.userId, tenantId: c.tenantId },
  });
  await db.session.create({
    data: {
      id: hash(token),
      tenantId: c.tenantId,
      userId: c.userId,
      csrfHash: hash(csrf),
      sessionVersion: user.sessionVersion,
      expiresAt: new Date(Date.now() + 8 * 3600_000),
    },
  });
  sessionCookies(res, token, csrf);
  return { ok: true, redirect: "/learn", csrfToken: csrf };
}
export async function registerLearner(
  req: DemoRequest,
  res: Response,
  input: unknown,
) {
  rateLimit(`learner-register:${req.ip}`, 5);
  const data = parse(registration, input);
  const tenantId = process.env.DEMO_LMS_REGISTRATION_TENANT_ID;
  const tenant = tenantId
    ? await db.tenant.findFirst({ where: { id: tenantId, active: true } })
    : null;
  if (!tenant)
    fail(
      409,
      "REGISTRATION_CLOSED",
      "Регистрация закрыта. Используйте приглашение центра",
    );
  await assertLmsDeploymentAllowed(tenant);
  const email = data.email.toLowerCase();
  const encoded = await passwordHash(data.password);
  const c = await transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${"learner-email:" + email},0))`;
    if (await tx.user.findUnique({ where: { email } }))
      fail(
        409,
        "REGISTRATION_UNAVAILABLE",
        "Не удалось зарегистрироваться. Войдите или обратитесь в центр",
      );
    const user = await tx.user.create({
      data: {
        tenantId: tenant.id,
        email,
        passwordHash: encoded,
        displayName: data.displayName,
        role: "LEARNER",
      },
    });
    const recipient = await tx.recipient.create({
      data: {
        tenantId: tenant.id,
        data: json({ fullNameRu: data.displayName, fullNameKz: "" }),
      },
    });
    await tx.learnerProfile.create({
      data: {
        tenantId: tenant.id,
        userId: user.id,
        recipientId: recipient.id,
        consentVersion,
        consentAt: new Date(),
      },
    });
    const c = identityContext(tenant.id, user.id, req);
    await audit(tx, c, "LMS_REGISTERED", user.id, { consentVersion });
    return c;
  });
  return establishSession(c, res);
}
export async function createLearnerInvite(c: Context, input: unknown) {
  const data = parse(
    z
      .object({
        recipientId: z.string().uuid(),
        email: z.email().max(255),
        customerId: z.string().uuid().optional(),
      })
      .strict(),
    input,
  );
  const recipient = await db.recipient.findFirst({
    where: { id: data.recipientId, tenantId: c.tenantId, archived: false },
  });
  if (!recipient) fail(404, "NOT_FOUND", "Слушатель не найден");
  if (
    data.customerId &&
    !(await db.recipientEmployment.findFirst({
      where: {
        tenantId: c.tenantId,
        recipientId: recipient.id,
        employerId: data.customerId,
      },
    }))
  )
    fail(404, "NOT_FOUND", "Слушатель не найден в организации");
  if (
    await db.learnerProfile.findFirst({
      where: { tenantId: c.tenantId, recipientId: recipient.id },
    })
  )
    fail(409, "ALREADY_LINKED", "У слушателя уже есть доступ");
  const token = randomBytes(32).toString("hex");
  const invite = await transaction(async (tx) => {
    const invite = await tx.learnerInvite.create({
      data: {
        tenantId: c.tenantId,
        recipientId: recipient.id,
        customerId: data.customerId,
        email: data.email.toLowerCase(),
        tokenHash: hash(token),
        expiresAt: new Date(Date.now() + 48 * 3600_000),
        createdBy: c.userId,
      },
    });
    await audit(tx, c, "LMS_INVITE_CREATED", invite.id, {
      recipientId: recipient.id,
    });
    return invite;
  });
  return {
    id: invite.id,
    token,
    url: `/learn/invite?token=${token}`,
    expiresAt: invite.expiresAt,
  };
}
export async function inspectLearnerInvite(req: DemoRequest, input: unknown) {
  rateLimit(`learner-invite:${req.ip}`, 20);
  const { token } = parse(
    z.object({ token: z.string().regex(/^[a-f0-9]{64}$/) }).strict(),
    input,
  );
  const invite = await db.learnerInvite.findUnique({
    where: { tokenHash: hash(token) },
  });
  if (
    !invite ||
    invite.usedAt ||
    invite.revokedAt ||
    invite.expiresAt <= new Date()
  )
    fail(
      410,
      "INVITE_INVALID",
      "Приглашение недействительно. Обратитесь в центр",
    );
  const tenant = await db.tenant.findFirst({
    where: { id: invite.tenantId, active: true },
  });
  if (!tenant)
    fail(
      410,
      "INVITE_INVALID",
      "Приглашение недействительно. Обратитесь в центр",
    );
  await assertLmsDeploymentAllowed(tenant);
  return {
    centerName: tenant.name,
    consentVersion,
    consentText,
    expiresAt: invite.expiresAt,
  };
}
export async function exchangeLearnerInvite(
  req: DemoRequest,
  res: Response,
  input: unknown,
) {
  rateLimit(`learner-exchange:${req.ip}`, 10);
  const data = parse(exchange, input);
  const encoded = await passwordHash(data.password);
  const c = await transaction(async (tx) => {
    const tokenHash = hash(data.token);
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${"learner-invite:" + tokenHash},0))`;
    const invite = await tx.learnerInvite.findUnique({ where: { tokenHash } });
    if (
      !invite ||
      invite.usedAt ||
      invite.revokedAt ||
      invite.expiresAt <= new Date()
    )
      fail(
        410,
        "INVITE_INVALID",
        "Приглашение недействительно. Обратитесь в центр",
      );
    const tenant = await tx.tenant.findFirst({
      where: { id: invite.tenantId, active: true },
    });
    const recipient = await tx.recipient.findFirst({
      where: {
        id: invite.recipientId,
        tenantId: invite.tenantId,
        archived: false,
      },
    });
    if (!tenant || !recipient)
      fail(
        410,
        "INVITE_INVALID",
        "Приглашение недействительно. Обратитесь в центр",
      );
    await assertLmsDeploymentAllowed(tenant);
    if (
      await tx.learnerProfile.findFirst({
        where: { tenantId: tenant.id, recipientId: recipient.id },
      })
    )
      fail(409, "ALREADY_LINKED", "Доступ уже открыт. Войдите в кабинет");
    let user = await tx.user.findUnique({ where: { email: invite.email } });
    if (
      user &&
      (user.tenantId !== tenant.id ||
        user.role !== "LEARNER" ||
        !user.active ||
        !(await passwordMatches(data.password, user.passwordHash)))
    )
      fail(
        409,
        "INVITE_UNAVAILABLE",
        "Не удалось открыть доступ. Обратитесь в центр",
      );
    if (
      user &&
      (await tx.learnerProfile.findFirst({
        where: { tenantId: tenant.id, userId: user.id },
      }))
    )
      fail(
        409,
        "INVITE_UNAVAILABLE",
        "Не удалось открыть доступ. Обратитесь в центр",
      );
    const person = recipient.data as Record<string, unknown>;
    user ??= await tx.user.create({
      data: {
        tenantId: tenant.id,
        email: invite.email,
        passwordHash: encoded,
        displayName: String(
          person.fullNameRu || person.fullNameKz || "Слушатель",
        ),
        role: "LEARNER",
      },
    });
    await tx.learnerProfile.create({
      data: {
        tenantId: tenant.id,
        userId: user.id,
        recipientId: recipient.id,
        consentVersion,
        consentAt: new Date(),
      },
    });
    await tx.enrollment.updateMany({
      where: {
        tenantId: tenant.id,
        recipientId: recipient.id,
        learnerUserId: null,
      },
      data: { learnerUserId: user.id },
    });
    await tx.learnerInvite.update({
      where: { id: invite.id },
      data: { usedAt: new Date() },
    });
    const c = identityContext(tenant.id, user.id, req);
    await audit(tx, c, "LMS_INVITE_ACCEPTED", invite.id, { consentVersion });
    return c;
  });
  return establishSession(c, res);
}
export async function createLearnerRecovery(c: Context, input: unknown) {
  const { userId } = parse(
    z.object({ userId: z.string().uuid() }).strict(),
    input,
  );
  const user = await db.user.findFirst({
    where: { tenantId: c.tenantId, id: userId, role: "LEARNER", active: true },
  });
  if (!user) fail(404, "NOT_FOUND", "Слушатель не найден");
  const token = randomBytes(32).toString("hex");
  await transaction(async (tx) => {
    await tx.learnerRecovery.create({
      data: {
        tenantId: c.tenantId,
        userId,
        tokenHash: hash(token),
        expiresAt: new Date(Date.now() + 30 * 60_000),
        createdBy: c.userId,
      },
    });
    await audit(tx, c, "LMS_RECOVERY_CREATED", userId);
  });
  return { token, url: `/learn/recovery?token=${token}` };
}
export async function recoverLearner(req: DemoRequest, input: unknown) {
  rateLimit(`learner-recovery:${req.ip}`, 10);
  const data = parse(
    z
      .object({
        token: z.string().regex(/^[a-f0-9]{64}$/),
        password: passwordSchema,
      })
      .strict(),
    input,
  );
  const encoded = await passwordHash(data.password);
  await transaction(async (tx) => {
    const tokenHash = hash(data.token);
    const target = await tx.learnerRecovery.findUnique({
      where: { tokenHash },
      select: { tenantId: true, userId: true },
    });
    if (!target)
      fail(
        410,
        "RECOVERY_INVALID",
        "Ссылка недействительна. Обратитесь в центр",
      );
    // Different links for one account must share the same lock. Re-read the
    // token after acquiring it so a completed recovery invalidates every peer.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${"learner-recovery-user:" + target.tenantId + ":" + target.userId},0))`;
    const recovery = await tx.learnerRecovery.findUnique({
      where: { tokenHash },
    });
    if (!recovery || recovery.usedAt || recovery.expiresAt <= new Date())
      fail(
        410,
        "RECOVERY_INVALID",
        "Ссылка недействительна. Обратитесь в центр",
      );
    const user = await tx.user.findFirst({
      where: {
        id: recovery.userId,
        tenantId: recovery.tenantId,
        active: true,
        role: "LEARNER",
      },
    });
    if (!user)
      fail(
        410,
        "RECOVERY_INVALID",
        "Ссылка недействительна. Обратитесь в центр",
      );
    await assertLmsDeploymentAllowed(
      await tx.tenant.findUniqueOrThrow({ where: { id: user.tenantId } }),
    );
    await tx.user.update({
      where: { id: user.id },
      data: { passwordHash: encoded, sessionVersion: { increment: 1 } },
    });
    await tx.session.deleteMany({
      where: { userId: user.id, tenantId: user.tenantId },
    });
    await tx.learnerRecovery.updateMany({
      where: { userId: user.id, tenantId: user.tenantId, usedAt: null },
      data: { usedAt: new Date() },
    });
    await audit(
      tx,
      identityContext(user.tenantId, user.id, req),
      "LMS_PASSWORD_RECOVERED",
      user.id,
    );
  });
  return { ok: true, redirect: "/login" };
}
@Controller()
export class LearnerIdentityController {
  @Post("learn/register") register(
    @Req() req: DemoRequest,
    @Res({ passthrough: true }) res: Response,
    @Body() body: unknown,
  ) {
    return registerLearner(req, res, body);
  }
  @Post("learn/invite/inspect") inspect(
    @Req() req: DemoRequest,
    @Body() body: unknown,
  ) {
    return inspectLearnerInvite(req, body);
  }
  @Post("learn/invite/exchange") exchange(
    @Req() req: DemoRequest,
    @Res({ passthrough: true }) res: Response,
    @Body() body: unknown,
  ) {
    return exchangeLearnerInvite(req, res, body);
  }
  @Post("learn/recovery/exchange") recovery(
    @Req() req: DemoRequest,
    @Body() body: unknown,
  ) {
    return recoverLearner(req, body);
  }
  @Post("lms/invites") invite(@Req() req: DemoRequest, @Body() body: unknown) {
    return createLearnerInvite(requireCapability(req, "lms:manage"), body);
  }
  @Post("lms/recovery") recover(
    @Req() req: DemoRequest,
    @Body() body: unknown,
  ) {
    return createLearnerRecovery(requireCapability(req, "center:manage"), body);
  }
  @Get("learn/profile") async profile(@Req() req: DemoRequest) {
    const c = requireCapability(req, "lms:learn");
    const profile = await db.learnerProfile.findFirst({
      where: { tenantId: c.tenantId, userId: c.userId },
    });
    if (!profile) fail(404, "NOT_FOUND", "Профиль не найден");
    const recipient = await db.recipient.findFirst({
      where: { tenantId: c.tenantId, id: profile.recipientId },
    });
    return { profile, recipient, consentVersion, consentText };
  }
}
