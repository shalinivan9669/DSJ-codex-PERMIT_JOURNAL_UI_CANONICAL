import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { assertTestDatabase } from "./test-database";
import { db, type Context } from "../../apps/api/src/core";
import { provision } from "../../scripts/setup";
import {
  createRequest,
  finalize,
  requestDetail,
  validateRequest,
} from "../../apps/api/src/requests";
import { draftSchema } from "../../packages/contracts/src";
import { createApprovalFixture } from "./live-approval-fixture";

test("1001 planned documents including a group protocol fail before issuing numbers or jobs", async (t) => {
  assertTestDatabase();
  const who = await provision({
    email: `document-capacity-${randomUUID()}@example.test`,
    password: "Synthetic-Document-Capacity-Only!",
    name: "Синтетическая граница выпуска",
    sample: true,
  });
  const context: Context = {
    ...who,
    role: "ADMIN",
    sessionId: "test",
    csrfHash: "test",
    correlationId: randomUUID(),
  };
  const approvals = await createApprovalFixture(context);
  t.after(() => approvals.close());
  try {
    const eventId = randomUUID();
    const draft = draftSchema.parse({
      kind: "PERSON",
      schemaVersion: 2,
      demoMode: true,
      events: [
        {
          id: eventId,
          title: "Тестовая группа",
          protocolTemplateId: "pb-protocol",
          commonFields: {},
        },
      ],
      items: Array.from({ length: 250 }, (_, row) => ({
        id: `row-${row}`,
        fullNameRu: `Синтетический Получатель ${row}`,
        workplaceRu: "Синтетическое предприятие",
        // 249 recipients × (PB pair + PTM pair), plus one PB pair + PS
        // triple = 1001 actual LIVE forms. One PB protocol has GROUP ownership.
        assignments: Array.from({ length: 2 }, (_, column) => ({
          id: `assignment-${row}-${column}`,
          templateId:
            column === 0 ? "pb-card" : row === 0 ? "ps-card" : "ptm-card",
          documentDate: "2026-09-29",
          hours: "10",
          productionHours: "16",
          trainingSubject: "Синтетическая программа",
          result: "Сдал",
          ...(column === 0 && row === 0
            ? {
                eventId,
                protocolMode: "GROUP",
                outcome: { status: "PASSED", source: "Тестовая ведомость" },
              }
            : {
                protocolMode: "INDIVIDUAL",
                outcome: { status: "PASSED", source: "Тестовая ведомость" },
              }),
        })),
      })),
    });
    const created = await createRequest(context, draft);
    const checked = await validateRequest(context, created.id, {
      expectedRevision: created.revision,
    });
    assert.equal(checked.documentCount, 1001);
    assert.ok(checked.issues.some((issue) => issue.code === "DOCUMENT_LIMIT"));
    await approvals.approve(created.id, "DOCUMENT_LIMIT");
    await assert.rejects(
      finalize(
        context,
        created.id,
        { expectedRevision: created.revision },
        randomUUID(),
      ),
      (error: any) =>
        error.getStatus() === 409 &&
        error.getResponse().code === "DIRECTOR_APPROVAL_REQUIRED",
    );
    const reloaded = await requestDetail(context, created.id);
    assert.equal(reloaded.status, "DRAFT");
    assert.equal(reloaded.revision, created.revision);
    assert.equal(reloaded.items.length, 250);
    assert.equal(reloaded.documents.length, 0);
    assert.equal(reloaded.jobs.length, 0);
    assert.equal(
      await db.numberReservation.count({ where: { tenantId: who.tenantId } }),
      0,
    );
    assert.equal(
      await db.issuance.count({ where: { requestId: created.id } }),
      0,
    );
  } finally {
    await db.$disconnect();
  }
});
