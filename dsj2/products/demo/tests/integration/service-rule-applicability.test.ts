import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { db, type Context } from "../../apps/api/src/core";
import { createRequest, validateRequest } from "../../apps/api/src/requests";
import { createServiceRule } from "../../apps/api/src/operator-value";
import {
  draftSchema,
  itemSchema,
  assignmentSchema,
} from "../../packages/contracts/src";
import { assertTestDatabase } from "./test-database";

test("request validation enforces tenant-scoped pinned service version and actual applicability before render or issuance", async () => {
  assertTestDatabase();
  const tenant = await db.tenant.create({
    data: { name: "Тестовый центр применимости" },
  });
  const user = await db.user.create({
    data: {
      tenantId: tenant.id,
      email: `rule-${randomUUID()}@example.test`,
      displayName: "Проверяющий",
      role: "ADMIN",
      passwordHash: "unused",
    },
  });
  const c: Context = {
    tenantId: tenant.id,
    userId: user.id,
    role: "ADMIN",
    sessionId: "test",
    csrfHash: "test",
    correlationId: randomUUID(),
  };
  const baseRule = {
    serviceKey: "BIOT",
    title: "Паспорт БиОТ",
    status: "APPROVED",
    source: "Синтетический проверенный источник",
    applicability: "Только тестовый сценарий",
    checkedOn: "2026-09-24",
    effectiveFrom: "2026-09-01",
    effectiveTo: "2026-12-31",
    definition: {
      programVersion: "1",
      category: "WORKER",
      compatibleTemplateIds: ["biot-worker-card", "biot-protocol"],
      requirements: [],
    },
  };
  const draftRule = await createServiceRule(c, {
    ...baseRule,
    status: "DRAFT",
  });
  function fixture(ruleId: string, protocolDate = "2026-09-24") {
    const eventId = randomUUID();
    return draftSchema.parse({
      kind: "PERSON",
      demoMode: true,
      events: [
        {
          id: eventId,
          title: "Проверка знаний",
          protocolTemplateId: "biot-protocol",
          serviceRuleVersionId: ruleId,
          commonFields: {
            protocolDate,
            trainingSubject: "Согласованная программа",
          },
        },
      ],
      items: [
        itemSchema.parse({
          id: randomUUID(),
          fullNameRu: "Синтетический слушатель",
          assignments: [
            assignmentSchema.parse({
              id: randomUUID(),
              templateId: "biot-worker-card",
              biotCategory: "WORKER",
              eventId,
              protocolMode: "GROUP",
              protocolDate,
              trainingSubject: "Согласованная программа",
              outcome: {
                status: "PASSED",
                source: "Синтетический фактический результат",
              },
            }),
          ],
        }),
      ],
    });
  }
  const request = await createRequest(c, fixture(draftRule.id));
  const invalid = await validateRequest(c, request.id, { expectedRevision: 0 });
  assert.ok(
    invalid.issues.some((issue) => issue.code === "SERVICE_RULE_NOT_APPROVED"),
  );
  const approved = await createServiceRule(c, baseRule);
  const late = await createRequest(c, fixture(approved.id, "2027-01-01"));
  assert.ok(
    (await validateRequest(c, late.id, { expectedRevision: 0 })).issues.some(
      (issue) => issue.code === "SERVICE_RULE_OUTSIDE_PERIOD",
    ),
  );
  const wrong = await createServiceRule(c, {
    ...baseRule,
    definition: { ...baseRule.definition, compatibleTemplateIds: ["ptm-card"] },
  });
  const badForm = await createRequest(c, fixture(wrong.id));
  assert.ok(
    (await validateRequest(c, badForm.id, { expectedRevision: 0 })).issues.some(
      (issue) => issue.code === "SERVICE_RULE_FORM_MISMATCH",
    ),
  );
  await assert.rejects(
    createRequest(c, fixture(randomUUID())),
    (error: unknown) =>
      typeof error === "object" &&
      error !== null &&
      "getResponse" in error &&
      (error as { getResponse(): { code: string } }).getResponse().code ===
        "SERVICE_RULE_NOT_FOUND",
  );
  assert.equal(
    await db.issuedDocument.count({ where: { tenantId: tenant.id } }),
    0,
  );
  assert.equal(
    await db.numberReservation.count({ where: { tenantId: tenant.id } }),
    0,
  );
  await db.$disconnect();
});
