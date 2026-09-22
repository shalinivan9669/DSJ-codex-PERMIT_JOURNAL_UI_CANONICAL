import {
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
} from "node:crypto";
import { promisify } from "node:util";
import type { Response, NextFunction } from "express";
import { z } from "@demo/contracts";
import {
  db,
  fail,
  hash,
  parse,
  audit,
  type DemoRequest,
  type Context,
} from "./core";
const scrypt = promisify(scryptCallback);
export async function passwordHash(password: string): Promise<string> {
  const salt = randomBytes(24).toString("hex");
  const derived = (await scrypt(password, salt, 64)) as Buffer;
  return `scrypt:${salt}:${derived.toString("hex")}`;
}
export async function passwordMatches(
  password: string,
  encoded: string,
): Promise<boolean> {
  const [algorithm, salt, value] = encoded.split(":");
  if (algorithm !== "scrypt" || !salt || !value) return false;
  const derived = (await scrypt(password, salt, 64)) as Buffer;
  const expected = Buffer.from(value, "hex");
  return (
    derived.length === expected.length && timingSafeEqual(derived, expected)
  );
}
export function cookies(req: DemoRequest): Record<string, string> {
  return Object.fromEntries(
    (req.headers.cookie || "")
      .split(";")
      .map((v) => v.trim().split("="))
      .filter((v) => v.length === 2)
      .map(([k, v]) => {
        try {
          return [k, decodeURIComponent(v)];
        } catch {
          return [k, ""];
        }
      }),
  );
}
const buckets = new Map<string, { start: number; count: number }>();
let activeUploads = 0;
export function rateLimit(key: string, limit: number, windowMs = 60_000) {
  const now = Date.now();
  if (buckets.size > 10_000)
    for (const [k, v] of buckets)
      if (v.start + windowMs < now) buckets.delete(k);
  let b = buckets.get(key);
  if (!b || now - b.start > windowMs) {
    b = { start: now, count: 0 };
    buckets.set(key, b);
  }
  if (++b.count > limit)
    fail(429, "RATE_LIMIT", "Слишком много запросов. Повторите через минуту");
}
export function originCheck(req: DemoRequest) {
  if (!["GET", "HEAD", "OPTIONS"].includes(req.method)) {
    const allowed = process.env.DEMO_ORIGIN || "http://localhost:3100";
    if (req.headers.origin !== allowed)
      fail(403, "ORIGIN_REJECTED", "Источник запроса не разрешён");
  }
}
export async function authenticate(
  req: DemoRequest,
  res: Response,
  next: NextFunction,
) {
  try {
    rateLimit(`api:${req.ip}`, 600);
    originCheck(req);
    if (req.path === "/auth/login" || req.path === "/health") {
      next();
      return;
    }
    const token = cookies(req).demo_session;
    if (!token || !/^[a-f0-9]{64}$/.test(token))
      fail(401, "SESSION_REQUIRED", "Войдите в DEMO");
    const s = await db.session.findUnique({ where: { id: hash(token) } });
    if (!s || s.expiresAt.getTime() < Date.now())
      fail(401, "SESSION_EXPIRED", "Сессия завершена. Войдите снова");
    const [user, tenant] = await Promise.all([
      db.user.findFirst({ where: { id: s.userId, tenantId: s.tenantId } }),
      db.tenant.findUnique({ where: { id: s.tenantId } }),
    ]);
    if (
      !user?.active ||
      !tenant?.active ||
      user.sessionVersion !== s.sessionVersion
    )
      fail(401, "SESSION_REVOKED", "Сессия отозвана");
    if (!["GET", "HEAD", "OPTIONS"].includes(req.method)) {
      const csrf = req.headers["x-csrf-token"];
      if (typeof csrf !== "string" || hash(csrf) !== s.csrfHash)
        fail(403, "CSRF_REJECTED", "Обновите страницу перед изменением данных");
    }
    req.context = {
      tenantId: s.tenantId,
      userId: user.id,
      role: user.role,
      sessionId: s.id,
      csrfHash: s.csrfHash,
      correlationId: req.correlationId,
    };
    if (
      req.method === "POST" &&
      ["/photos", "/imports/preview"].includes(req.path)
    ) {
      rateLimit(`upload:${user.id}`, 30);
      if (activeUploads >= 4)
        fail(
          429,
          "UPLOAD_BUSY",
          "Обработчик загрузок занят. Повторите через несколько секунд",
        );
      activeUploads++;
      res.once("close", () => {
        activeUploads--;
      });
    }
    next();
  } catch (e) {
    next(e);
  }
}
const passwordSchema = z
  .string()
  .min(12, "Пароль должен содержать не менее 12 символов")
  .max(256);
export { passwordSchema };
export async function login(req: DemoRequest, res: Response, input: unknown) {
  rateLimit(`login:${req.ip}`, 10, 60_000);
  const data = parse(
    z
      .object({ email: z.email().max(255), password: z.string().max(256) })
      .strict(),
    input,
  );
  const user = await db.user.findUnique({
    where: { email: data.email.toLowerCase() },
  });
  const fallback =
    "scrypt:000000000000000000000000000000000000000000000000:" +
    "0".repeat(128);
  const valid = await passwordMatches(
    data.password,
    user?.passwordHash || fallback,
  );
  const tenant = user
    ? await db.tenant.findUnique({ where: { id: user.tenantId } })
    : null;
  if (!valid || !user?.active || !tenant?.active)
    fail(401, "LOGIN_FAILED", "Неверный логин или пароль");
  const token = randomBytes(32).toString("hex");
  const csrf = randomBytes(32).toString("hex");
  const id = hash(token);
  await db.session.create({
    data: {
      id,
      tenantId: user.tenantId,
      userId: user.id,
      csrfHash: hash(csrf),
      sessionVersion: user.sessionVersion,
      expiresAt: new Date(Date.now() + 8 * 3600_000),
    },
  });
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  res.setHeader("Set-Cookie", [
    `demo_session=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=28800${secure}`,
    `demo_csrf=${csrf}; Path=/; SameSite=Strict; Max-Age=28800${secure}`,
  ]);
  await audit(
    db,
    {
      tenantId: user.tenantId,
      userId: user.id,
      role: user.role,
      sessionId: id,
      csrfHash: hash(csrf),
      correlationId: req.correlationId,
    },
    "AUTH_LOGIN",
    user.id,
  );
  return {
    user: {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      role: user.role,
    },
    tenant: { id: tenant.id, name: tenant.name, timezone: tenant.timezone },
    csrfToken: csrf,
  };
}
export async function logout(c: Context, res: Response) {
  await db.session.deleteMany({
    where: { id: c.sessionId, tenantId: c.tenantId },
  });
  res.setHeader("Set-Cookie", [
    "demo_session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0",
    "demo_csrf=; Path=/; SameSite=Strict; Max-Age=0",
  ]);
  await audit(db, c, "AUTH_LOGOUT", c.userId);
  return { ok: true };
}
export async function changePassword(c: Context, input: unknown) {
  const data = parse(
    z
      .object({
        currentPassword: z.string().max(256),
        newPassword: passwordSchema,
      })
      .strict(),
    input,
  );
  const user = await db.user.findFirstOrThrow({
    where: { id: c.userId, tenantId: c.tenantId },
  });
  if (!(await passwordMatches(data.currentPassword, user.passwordHash)))
    fail(400, "PASSWORD_INVALID", "Текущий пароль неверен");
  const digest = await passwordHash(data.newPassword);
  await db.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: user.id },
      data: { passwordHash: digest, sessionVersion: { increment: 1 } },
    });
    await tx.session.deleteMany({
      where: { userId: user.id, tenantId: c.tenantId },
    });
    await audit(tx, c, "PASSWORD_CHANGED", user.id);
  });
  return { ok: true, reauthenticate: true };
}
