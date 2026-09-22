import { createHash, randomUUID } from "node:crypto";
import { HttpException } from "@nestjs/common";
import { PrismaClient, Prisma } from "@demo/database";
import { z } from "@demo/contracts";
import type { Request } from "express";
export const db = new PrismaClient({ log: [] });
export type Context = {
  tenantId: string;
  userId: string;
  role: string;
  sessionId: string;
  csrfHash: string;
  correlationId: string;
};
export type DemoRequest = Request & {
  context?: Context;
  correlationId: string;
};
export function fail(
  status: number,
  code: string,
  message: string,
  details?: unknown,
): never {
  throw new HttpException({ code, message, details }, status);
}
export function ctx(req: DemoRequest, write = false, admin = false): Context {
  const c = req.context;
  if (!c) fail(401, "SESSION_REQUIRED", "Войдите в DEMO");
  if ((admin && c.role !== "ADMIN") || (write && c.role === "VIEWER"))
    fail(403, "ROLE_DENIED", "Недостаточно прав");
  return c;
}
export function parse<T>(
  schema: { parse: (x: unknown) => T },
  input: unknown,
): T {
  try {
    return schema.parse(input);
  } catch (e) {
    if (e instanceof z.ZodError)
      fail(400, "VALIDATION", "Проверьте заполнение полей", e.issues);
    throw e;
  }
}
export function canonical(input: unknown): string {
  if (input === null || typeof input !== "object") return JSON.stringify(input);
  if (Array.isArray(input)) return "[" + input.map(canonical).join(",") + "]";
  return (
    "{" +
    Object.entries(input as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .filter(([, v]) => v !== undefined)
      .map(([k, v]) => JSON.stringify(k) + ":" + canonical(v))
      .join(",") +
    "}"
  );
}
export function hash(input: unknown): string {
  return createHash("sha256")
    .update(typeof input === "string" ? input : canonical(input))
    .digest("hex");
}
export function json(input: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(input)) as Prisma.InputJsonValue;
}
export async function audit(
  tx: Prisma.TransactionClient,
  c: Context,
  action: string,
  entityId: string,
  metadata: Record<string, unknown> = {},
) {
  await tx.auditEvent.create({
    data: {
      tenantId: c.tenantId,
      actorId: c.userId,
      action,
      entityId,
      metadata: json(metadata),
      correlationId: c.correlationId || randomUUID(),
    },
  });
}
export async function transaction<T>(
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await db.$transaction(fn, {
        maxWait: 20000,
        timeout: 30000,
        isolationLevel: "ReadCommitted",
      });
    } catch (e) {
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        ["P2034", "P2002"].includes(e.code) &&
        attempt < 8
      ) {
        await new Promise((r) =>
          setTimeout(r, 10 + Math.random() * 50 * (attempt + 1)),
        );
        continue;
      }
      throw e;
    }
  }
}
export async function scopedRequest(
  c: Context,
  id: string,
  tx: Prisma.TransactionClient = db,
) {
  const record = await tx.printRequest.findFirst({
    where: { id, tenantId: c.tenantId },
  });
  if (!record) fail(404, "NOT_FOUND", "Заявка не найдена");
  return record;
}
