import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { db, type Context } from "../../apps/api/src/core";
import { passwordHash } from "../../apps/api/src/auth";
import {
  courseContentSchema,
  regulatoryProfileSchema,
} from "../../packages/contracts/src/lms";
import { assertTestDatabase } from "./test-database";

export const LMS_FIXTURE_VERSION = "lms-one-run-synthetic-v1";
export const LMS_PASSWORD = "Synthetic-LMS-only-20261015!";

export async function lmsTenant(name: string) {
  assertTestDatabase();
  const url = new URL(process.env.DATABASE_URL!);
  assert.ok(["localhost", "127.0.0.1"].includes(url.hostname));
  const tenant = await db.tenant.create({
    data: {
      name: `Synthetic ${name}`,
      demoOnly: true,
      timezone: "Asia/Qyzylorda",
    },
  });
  const user = await db.user.create({
    data: {
      tenantId: tenant.id,
      email: `${randomUUID()}@example.test`,
      displayName: "Synthetic director",
      role: "DIRECTOR",
      passwordHash: await passwordHash(LMS_PASSWORD),
    },
  });
  const context: Context = {
    tenantId: tenant.id,
    userId: user.id,
    role: user.role,
    sessionId: "synthetic",
    csrfHash: "synthetic",
    correlationId: randomUUID(),
  };
  return { tenant, user, context };
}

export async function lmsLearner(tenantId: string, suffix: string) {
  const recipient = await db.recipient.create({
    data: {
      tenantId,
      data: {
        fullNameRu: `Синтетический слушатель ${suffix}`,
        fullNameKz: `Синтетикалық тыңдаушы ${suffix}`,
        positionRu: "Работник",
        positionKz: "Қызметкер",
      },
    },
  });
  const user = await db.user.create({
    data: {
      tenantId,
      email: `${randomUUID()}@example.test`,
      displayName: `Synthetic learner ${suffix}`,
      role: "LEARNER",
      passwordHash: await passwordHash(LMS_PASSWORD),
    },
  });
  await db.learnerProfile.create({
    data: {
      tenantId,
      userId: user.id,
      recipientId: recipient.id,
      consentVersion: "lms-personal-data-2026-10-15-v1",
      consentAt: new Date(),
    },
  });
  const context: Context = {
    tenantId,
    userId: user.id,
    role: "LEARNER",
    sessionId: "synthetic",
    csrfHash: "synthetic",
    correlationId: randomUUID(),
  };
  return { user, recipient, context };
}

export function lmsCourse(
  options: {
    sanitary?: boolean;
    kind?: "PRACTICE" | "CENTER_EXAM" | "EXTERNAL_AUTHORIZED";
    questions?: number;
    required?: boolean;
    signatures?: string[];
  } = {},
) {
  const count = options.questions ?? 10;
  const content = courseContentSchema.parse({
    titleRu: "Синтетическая программа безопасности",
    titleKz: "Синтетикалық қауіпсіздік бағдарламасы",
    modules: [
      {
        id: "module-1",
        titleRu: "Модуль",
        titleKz: "Модуль",
        lessons: [
          {
            id: "lesson-1",
            titleRu: "Учебный текст",
            titleKz: "Оқу мәтіні",
            kind: "TEXT",
            textRu: "Синтетический материал для инженерной проверки.",
            textKz: "Инженерлік тексеруге арналған синтетикалық материал.",
            required: options.required ?? true,
          },
        ],
      },
    ],
    exam: {
      questions: Array.from({ length: count }, (_, i) => ({
        id: `q-${i}`,
        promptRu: `Вопрос ${i}`,
        promptKz: `Сұрақ ${i}`,
        options: [
          { id: "a", textRu: "Первый", textKz: "Бірінші" },
          { id: "b", textRu: "Второй", textKz: "Екінші" },
        ],
        correctOptionIds: ["a"],
      })),
      questionCount: count,
      durationMinutes: 30,
      maxAttempts: 3,
      thresholdPercent: 80,
      comparison: options.sanitary ? "GT" : "GTE",
    },
  });
  const profile = regulatoryProfileSchema.parse({
    title: "SYNTHETIC ENGINEERING PROFILE",
    synthetic: true,
    status: "CONFIRMED",
    reviewReference: "SYNTHETIC-NOT-AUTHORIZATION",
    sources: [
      {
        title: "Synthetic engineering fixture",
        url: "https://example.invalid/fixture",
        revision: "1",
      },
    ],
    effectiveFrom: "2020-01-01",
    assessmentKind: options.kind ?? "CENTER_EXAM",
    examiner: "Synthetic examiner",
    issuer: "Synthetic training center",
    sanitary: options.sanitary ?? false,
    requiresApproval: false,
    requiredSignatures: options.signatures ?? [],
    requiresEmployeeSignature: false,
    legalForm: "INFORMATION_CARD",
  });
  return { content, profile };
}

export async function lmsSession(base: string, email: string) {
  const response = await fetch(`${base}/auth/login`, {
    method: "POST",
    headers: {
      origin: process.env.DEMO_ORIGIN!,
      "content-type": "application/json",
    },
    body: JSON.stringify({ email, password: LMS_PASSWORD }),
  });
  assert.equal(
    response.status,
    201,
    `Login failed: ${await response.clone().text()}`,
  );
  const payload = await response.json();
  return {
    origin: process.env.DEMO_ORIGIN!,
    cookie: response.headers
      .getSetCookie()
      .map((item) => item.split(";")[0])
      .join("; "),
    "x-csrf-token": payload.csrfToken as string,
  };
}

export function lmsHttp(base: string, headers: Record<string, string>) {
  return (path: string, method = "GET", body?: unknown) =>
    fetch(base + path, {
      method,
      headers: {
        ...headers,
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
}

export async function lmsJson(response: Response, expected = 200) {
  const value = await response.text();
  assert.equal(response.status, expected, value);
  return JSON.parse(value);
}
