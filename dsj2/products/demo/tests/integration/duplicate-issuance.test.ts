import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { db, json, type Context } from "../../apps/api/src/core";
import {
  draftSchema,
  itemSchema,
  assignmentSchema,
} from "../../packages/contracts/src";
import { duplicateIssuanceWarnings } from "../../apps/api/src/duplicate-issuance";
import { assertTestDatabase } from "./test-database";

test("duplicate lookup reads immutable PostgreSQL history by stable recipient, scopes tenant and never allocates numbers", async () => {
  assertTestDatabase();
  const tenant = await db.tenant.create({
    data: { name: "Синтетический центр повторов" },
  });
  const foreign = await db.tenant.create({
    data: { name: "Чужой центр повторов" },
  });
  const user = await db.user.create({
    data: {
      tenantId: tenant.id,
      email: `duplicate-${randomUUID()}@example.test`,
      displayName: "Оператор",
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
  const person = await db.recipient.create({
    data: {
      tenantId: tenant.id,
      data: { fullNameRu: "Синтетический человек" },
    },
  });
  const assignment = assignmentSchema.parse({
    id: "a",
    templateId: "biot-worker-card",
    trainingSubject: "Согласованная программа",
    protocolDate: "2026-09-22",
    biotCategory: "WORKER",
  });
  const draft = draftSchema.parse({
    kind: "PERSON",
    items: [
      itemSchema.parse({
        id: "old-row",
        recipientId: person.id,
        fullNameRu: "Синтетический человек",
        assignments: [assignment],
      }),
    ],
  });
  const request = await db.printRequest.create({
    data: {
      tenantId: tenant.id,
      kind: "PERSON",
      draft: json(draft),
      createdBy: user.id,
    },
  });
  const profile = await db.issuerProfileVersion.create({
    data: { tenantId: tenant.id, version: 1, profile: {}, createdBy: user.id },
  });
  const template = await db.templateVersion.create({
    data: {
      tenantId: tenant.id,
      templateId: "biot-worker-card",
      version: "test",
      checksum: "test",
      storageKey: randomUUID(),
      contract: {},
    },
  });
  const issuance = await db.issuance.create({
    data: {
      tenantId: tenant.id,
      requestId: request.id,
      sourceRevision: 0,
      snapshot: json({ draft }),
      inputHash: "test",
      profileVersionId: profile.id,
      createdBy: user.id,
    },
  });
  await db.issuedDocument.create({
    data: {
      tenantId: tenant.id,
      issuanceId: issuance.id,
      requestId: request.id,
      rowId: "old-row",
      assignmentId: "a",
      templateVersionId: template.id,
      templateId: template.templateId,
      namespace: "BIOT:CARD",
      number: "EXISTING-ONLY",
      documentDate: "2026-09-22",
    },
  });
  const next = draftSchema.parse({
    ...draft,
    items: [
      {
        ...draft.items[0],
        id: "new-row",
        assignments: [{ ...assignment, id: "new-a" }],
      },
    ],
  });
  const result = await duplicateIssuanceWarnings(c, next);
  assert.equal(result.length, 1);
  assert.equal(result[0].candidates[0].number, "EXISTING-ONLY");
  assert.deepEqual(
    await duplicateIssuanceWarnings({ ...c, tenantId: foreign.id }, next),
    [],
  );
  assert.deepEqual(
    await duplicateIssuanceWarnings(c, next, db, request.id),
    [],
  );
  assert.deepEqual(
    await duplicateIssuanceWarnings(c, {
      ...next,
      items: [{ ...next.items[0], recipientId: undefined }],
    }),
    [],
  );
  assert.equal(
    await db.numberReservation.count({ where: { tenantId: tenant.id } }),
    0,
  );
  await db.$disconnect();
});
