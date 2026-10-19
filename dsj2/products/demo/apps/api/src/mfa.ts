import { randomBytes, createCipheriv, createDecipheriv } from "node:crypto";
import { Secret, TOTP } from "otpauth";
import { z, canManageSystem } from "@demo/contracts";
import { Prisma, type User } from "@demo/database";
import type { Response } from "express";
import {
  db,
  audit,
  fail,
  hash,
  parse,
  transaction,
  type Context,
  type DemoRequest,
} from "./core";
import { passwordMatches, rateLimit, issueSession } from "./auth";
import { trustedClientIp } from "./proxy-policy";

const privileged = new Set([
  "SUPER_ADMIN",
  "ADMIN",
  "DIRECTOR",
  "OPERATOR",
  "TEACHER",
  "METHODIST",
  "EXPERT",
]);
export function mandatoryMfa(role: string, required: boolean) {
  return required && privileged.has(role);
}
function keyring() {
  const version = process.env.DEMO_MFA_KEY_VERSION || "v1";
  let keys: Record<string, string> = {};
  try {
    const parsed = JSON.parse(process.env.DEMO_MFA_KEYS || "{}");
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed))
      keys = parsed;
  } catch {
    /* fail closed below */
  }
  if (
    !/^[a-zA-Z0-9_-]{1,40}$/.test(version) ||
    !/^[a-f0-9]{64}$/i.test(keys[version] || "")
  )
    fail(
      503,
      "MFA_KEY_UNAVAILABLE",
      "Защита входа временно недоступна. Обратитесь к администратору",
    );
  return { version, keys };
}
export function encryptMfaSeed(seed: string, userId: string) {
  const { version, keys } = keyring(),
    iv = randomBytes(12);
  const cipher = createCipheriv(
    "aes-256-gcm",
    Buffer.from(keys[version], "hex"),
    iv,
  );
  cipher.setAAD(Buffer.from(`DEMO:MFA:${version}:${userId}`));
  const encrypted = Buffer.concat([
    cipher.update(seed, "utf8"),
    cipher.final(),
  ]);
  return [
    version,
    iv.toString("hex"),
    cipher.getAuthTag().toString("hex"),
    encrypted.toString("hex"),
  ].join(":");
}
export function decryptMfaSeed(encoded: string, userId: string) {
  const [version, iv, tag, value] = encoded.split(":"),
    { keys } = keyring();
  try {
    if (!/^[a-f0-9]{64}$/i.test(keys[version] || "")) throw new Error("key");
    const cipher = createDecipheriv(
      "aes-256-gcm",
      Buffer.from(keys[version], "hex"),
      Buffer.from(iv, "hex"),
    );
    cipher.setAAD(Buffer.from(`DEMO:MFA:${version}:${userId}`));
    cipher.setAuthTag(Buffer.from(tag, "hex"));
    return Buffer.concat([
      cipher.update(Buffer.from(value, "hex")),
      cipher.final(),
    ]).toString("utf8");
  } catch {
    fail(
      503,
      "MFA_KEY_UNAVAILABLE",
      "Ключ защиты недоступен. Обратитесь к администратору",
    );
  }
}
function totp(seed: string, label = "DEMO") {
  return new TOTP({
    issuer: "DEMO",
    label,
    algorithm: "SHA1",
    digits: 6,
    period: 30,
    secret: Secret.fromBase32(seed),
  });
}
const tokenSchema = z.string().trim().min(6).max(80);
async function factorLock(
  tx: Prisma.TransactionClient,
  c: Pick<Context, "tenantId" | "userId">,
) {
  await tx.$queryRaw`SELECT id FROM "User" WHERE id=${c.userId} AND "tenantId"=${c.tenantId} FOR UPDATE`;
  return tx.mfaFactor.findFirst({
    where: { userId: c.userId, tenantId: c.tenantId },
  });
}
/** Called under the user lock: a timestep/recovery code can only win once. */
async function consumeFactor(
  tx: Prisma.TransactionClient,
  c: Pick<Context, "tenantId" | "userId">,
  code: string,
) {
  const factor = await factorLock(tx, c);
  if (!factor?.enabledAt || !factor.secretCiphertext) return false;
  if (/^\d{6}$/.test(code)) {
    const verifier = totp(decryptMfaSeed(factor.secretCiphertext, c.userId));
    const now = Date.now(),
      delta = verifier.validate({ token: code, timestamp: now, window: 1 });
    const step = Math.floor(now / 30000) + (delta || 0);
    if (delta === null || step <= factor.lastTotpStep) return false;
    await tx.mfaFactor.update({
      where: { userId: c.userId },
      data: { lastTotpStep: step },
    });
    return true;
  }
  const consumed = await tx.mfaRecoveryCode.updateMany({
    where: {
      tenantId: c.tenantId,
      userId: c.userId,
      codeHash: hash(code.toUpperCase()),
      usedAt: null,
    },
    data: { usedAt: new Date() },
  });
  return consumed.count === 1;
}
export async function createMfaChallenge(user: User) {
  rateLimit(`mfa-login:${user.id}`, 12, 300_000);
  const challengeToken = randomBytes(32).toString("hex");
  await db.mfaChallenge.create({
    data: {
      id: hash(challengeToken),
      tenantId: user.tenantId,
      userId: user.id,
      sessionVersion: user.sessionVersion,
      expiresAt: new Date(Date.now() + 300_000),
    },
  });
  return { mfaRequired: true, challengeToken, expiresInSeconds: 300 };
}
export async function completeMfaChallenge(
  req: DemoRequest,
  res: Response,
  input: unknown,
) {
  const body = parse(
    z
      .object({
        challengeToken: z.string().regex(/^[a-f0-9]{64}$/),
        code: tokenSchema,
      })
      .strict(),
    input,
  );
  rateLimit(`mfa-ip:${trustedClientIp(req) || "unknown"}`, 100, 300_000);
  const result = await transaction(async (tx) => {
    const candidate = await tx.mfaChallenge.findUnique({
      where: { id: hash(body.challengeToken) },
      select: { userId: true, tenantId: true },
    });
    if (!candidate) return null;
    await factorLock(tx, candidate);
    await tx.$queryRaw`SELECT id FROM "MfaChallenge" WHERE id=${hash(body.challengeToken)} FOR UPDATE`;
    const challenge = await tx.mfaChallenge.findUnique({
      where: { id: hash(body.challengeToken) },
    });
    if (
      !challenge ||
      challenge.consumedAt ||
      challenge.expiresAt.getTime() <= Date.now() ||
      challenge.attempts >= 5
    )
      return null;
    rateLimit(`mfa-account:${challenge.userId}`, 15, 300_000);
    await tx.mfaChallenge.update({
      where: { id: challenge.id },
      data: { attempts: { increment: 1 } },
    });
    const user = await tx.user.findFirst({
      where: {
        id: challenge.userId,
        tenantId: challenge.tenantId,
        active: true,
        sessionVersion: challenge.sessionVersion,
      },
    });
    const tenant = await tx.tenant.findFirst({
      where: { id: challenge.tenantId, active: true },
    });
    if (!user || !tenant || !(await consumeFactor(tx, challenge, body.code)))
      return null;
    await tx.mfaChallenge.update({
      where: { id: challenge.id },
      data: { consumedAt: new Date() },
    });
    await audit(
      tx,
      {
        tenantId: user.tenantId,
        userId: user.id,
        role: user.role,
        sessionId: "",
        csrfHash: "",
        correlationId: req.correlationId,
        source: "browser",
        trustedIp: trustedClientIp(req),
      },
      "MFA_LOGIN_VERIFIED",
      user.id,
    );
    return { user, tenant };
  });
  if (!result)
    fail(
      401,
      "MFA_CODE_INVALID",
      "Код неверен, уже использован или срок входа истёк. Проверьте код либо войдите заново",
    );
  return issueSession(req, res, result.user, result.tenant, true);
}
export async function mfaStatus(c: Context) {
  const [factor, tenant, recovery] = await Promise.all([
    db.mfaFactor.findUnique({ where: { userId: c.userId } }),
    db.tenant.findUniqueOrThrow({ where: { id: c.tenantId } }),
    db.mfaRecoveryCode.count({ where: { userId: c.userId, usedAt: null } }),
  ]);
  return {
    enabled: !!factor?.enabledAt,
    required: mandatoryMfa(c.role, tenant.mfaRequiredStaff),
    requiredStaff: tenant.mfaRequiredStaff,
    canSetPolicy: canManageSystem(c.role),
    recoveryRemaining: recovery,
  };
}
export async function mfaReauthenticate(c: Context, input: unknown) {
  const body = parse(
    z
      .object({
        password: z.string().max(256),
        code: tokenSchema.optional(),
        purpose: z.enum(["SETUP", "MANAGE", "POLICY"]),
      })
      .strict(),
    input,
  );
  rateLimit(`mfa-reauth:${c.userId}`, 10, 300_000);
  const token = randomBytes(32).toString("hex");
  const valid = await transaction(async (tx) => {
    const factor = await factorLock(tx, c),
      user = await tx.user.findUniqueOrThrow({ where: { id: c.userId } });
    if (!(await passwordMatches(body.password, user.passwordHash)))
      return false;
    if (
      factor?.enabledAt &&
      (!body.code || !(await consumeFactor(tx, c, body.code)))
    )
      return false;
    if (body.purpose !== "SETUP" && !factor?.enabledAt) return false;
    await tx.mfaReauth.create({
      data: {
        id: hash(token),
        tenantId: c.tenantId,
        userId: c.userId,
        sessionId: c.sessionId,
        purpose: body.purpose,
        expiresAt: new Date(Date.now() + 300_000),
      },
    });
    await audit(tx, c, "MFA_REAUTHENTICATED", c.userId, {
      purpose: body.purpose,
    });
    return true;
  });
  if (!valid)
    fail(
      403,
      "MFA_REAUTH_FAILED",
      "Проверьте пароль и действующий второй фактор",
    );
  return { reauthToken: token, expiresInSeconds: 300 };
}
async function requireReauth(
  tx: Prisma.TransactionClient,
  c: Context,
  token: string,
  purpose: string,
  consume = false,
) {
  const liveSession = await tx.$queryRaw<
    { id: string }[]
  >`SELECT s.id FROM "Session" s JOIN "User" u ON u.id=s."userId" AND u."tenantId"=s."tenantId" AND u."sessionVersion"=s."sessionVersion" WHERE s.id=${c.sessionId} AND s."tenantId"=${c.tenantId} AND s."userId"=${c.userId} AND s."expiresAt">CURRENT_TIMESTAMP AND u.active`;
  if (!liveSession.length)
    fail(401, "SESSION_REVOKED", "Сессия отозвана. Войдите снова");
  const id = hash(token);
  await tx.$queryRaw`SELECT id FROM "MfaReauth" WHERE id=${id} FOR UPDATE`;
  const record = await tx.mfaReauth.findFirst({
    where: {
      id,
      tenantId: c.tenantId,
      userId: c.userId,
      sessionId: c.sessionId,
      purpose,
      consumedAt: null,
      expiresAt: { gt: new Date() },
    },
  });
  if (!record)
    fail(
      403,
      "MFA_REAUTH_REQUIRED",
      "Подтвердите пароль и повторите настройку безопасности",
    );
  if (consume)
    await tx.mfaReauth.update({
      where: { id },
      data: { consumedAt: new Date() },
    });
}
export async function mfaSetup(c: Context, input: unknown) {
  const body = parse(
    z.object({ reauthToken: z.string().length(64) }).strict(),
    input,
  );
  return transaction(async (tx) => {
    await factorLock(tx, c);
    await requireReauth(tx, c, body.reauthToken, "SETUP");
    const user = await tx.user.findUniqueOrThrow({ where: { id: c.userId } });
    const seed = new Secret({ size: 20 }).base32,
      pendingCiphertext = encryptMfaSeed(seed, c.userId);
    await tx.mfaFactor.upsert({
      where: { userId: c.userId },
      create: {
        userId: c.userId,
        tenantId: c.tenantId,
        pendingCiphertext,
        pendingExpiresAt: new Date(Date.now() + 300_000),
      },
      update: {
        pendingCiphertext,
        pendingExpiresAt: new Date(Date.now() + 300_000),
      },
    });
    await audit(tx, c, "MFA_SETUP_STARTED", c.userId);
    return {
      secret: seed,
      uri: totp(seed, user.email).toString(),
      expiresInSeconds: 300,
    };
  });
}
async function newRecoveryCodes(tx: Prisma.TransactionClient, c: Context) {
  const codes = Array.from({ length: 10 }, () =>
    randomBytes(12).toString("hex").toUpperCase(),
  );
  await tx.mfaRecoveryCode.deleteMany({
    where: { tenantId: c.tenantId, userId: c.userId },
  });
  await tx.mfaRecoveryCode.createMany({
    data: codes.map((code) => ({
      tenantId: c.tenantId,
      userId: c.userId,
      codeHash: hash(code),
    })),
  });
  return codes;
}
async function revokeSessions(tx: Prisma.TransactionClient, c: Context) {
  await tx.user.update({
    where: { id: c.userId },
    data: { sessionVersion: { increment: 1 } },
  });
  await tx.session.deleteMany({
    where: { tenantId: c.tenantId, userId: c.userId },
  });
  await tx.mfaChallenge.updateMany({
    where: { userId: c.userId, consumedAt: null },
    data: { consumedAt: new Date() },
  });
  await tx.mfaReauth.updateMany({
    where: { userId: c.userId, consumedAt: null },
    data: { consumedAt: new Date() },
  });
}
export async function mfaConfirm(c: Context, input: unknown) {
  const body = parse(
    z
      .object({
        reauthToken: z.string().length(64),
        code: z.string().regex(/^\d{6}$/),
      })
      .strict(),
    input,
  );
  rateLimit(`mfa-confirm:${c.userId}`, 8, 300_000);
  return transaction(async (tx) => {
    const factor = await factorLock(tx, c);
    await requireReauth(tx, c, body.reauthToken, "SETUP");
    if (
      !factor?.pendingCiphertext ||
      !factor.pendingExpiresAt ||
      factor.pendingExpiresAt.getTime() <= Date.now()
    )
      fail(
        409,
        "MFA_SETUP_EXPIRED",
        "Настройка истекла. Начните подключение заново",
      );
    const now = Date.now(),
      verifier = totp(decryptMfaSeed(factor.pendingCiphertext, c.userId));
    const delta = verifier.validate({
      token: body.code,
      timestamp: now,
      window: 1,
    });
    if (delta === null)
      fail(400, "MFA_CODE_INVALID", "Проверьте код из приложения");
    await requireReauth(tx, c, body.reauthToken, "SETUP", true);
    await tx.mfaFactor.update({
      where: { userId: c.userId },
      data: {
        secretCiphertext: factor.pendingCiphertext,
        pendingCiphertext: null,
        pendingExpiresAt: null,
        enabledAt: new Date(),
        lastTotpStep: Math.floor(now / 30000) + delta,
      },
    });
    const recoveryCodes = await newRecoveryCodes(tx, c);
    await revokeSessions(tx, c);
    await audit(tx, c, "MFA_ENABLED", c.userId, {
      replaced: !!factor.enabledAt,
    });
    return { enabled: true, recoveryCodes, reauthenticate: true };
  });
}
export async function mfaManage(c: Context, input: unknown) {
  const body = parse(
    z
      .object({
        reauthToken: z.string().length(64),
        action: z.enum(["RECOVERY", "DISABLE"]),
      })
      .strict(),
    input,
  );
  return transaction(async (tx) => {
    await factorLock(tx, c);
    await requireReauth(tx, c, body.reauthToken, "MANAGE", true);
    const tenant = await tx.tenant.findUniqueOrThrow({
      where: { id: c.tenantId },
    });
    if (
      body.action === "DISABLE" &&
      mandatoryMfa(c.role, tenant.mfaRequiredStaff)
    )
      fail(
        409,
        "MFA_POLICY_REQUIRED",
        "Второй фактор обязателен. Для смены устройства подключите новый фактор",
      );
    const recoveryCodes =
      body.action === "RECOVERY" ? await newRecoveryCodes(tx, c) : undefined;
    if (body.action === "DISABLE") {
      await tx.mfaFactor.deleteMany({
        where: { tenantId: c.tenantId, userId: c.userId },
      });
      await tx.mfaRecoveryCode.deleteMany({
        where: { tenantId: c.tenantId, userId: c.userId },
      });
    }
    await revokeSessions(tx, c);
    await audit(
      tx,
      c,
      body.action === "RECOVERY" ? "MFA_RECOVERY_REGENERATED" : "MFA_DISABLED",
      c.userId,
    );
    return { recoveryCodes, reauthenticate: true };
  });
}
export async function mfaPolicy(c: Context, input: unknown) {
  if (!canManageSystem(c.role))
    fail(403, "ROLE_DENIED", "Политика доступна руководителю центра");
  const body = parse(
    z
      .object({ reauthToken: z.string().length(64), required: z.boolean() })
      .strict(),
    input,
  );
  return transaction(async (tx) => {
    await factorLock(tx, c);
    await requireReauth(tx, c, body.reauthToken, "POLICY", true);
    await tx.tenant.update({
      where: { id: c.tenantId },
      data: { mfaRequiredStaff: body.required },
    });
    await audit(tx, c, "MFA_POLICY_CHANGED", c.tenantId, {
      required: body.required,
    });
    return { requiredStaff: body.required };
  });
}
