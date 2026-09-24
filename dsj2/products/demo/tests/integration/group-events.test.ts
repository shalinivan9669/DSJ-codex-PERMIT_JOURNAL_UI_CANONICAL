import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { assertTestDatabase } from "./test-database";
import { db, type Context } from "../../apps/api/src/core";
import { provision } from "../../scripts/setup";
import { draftSchema } from "../../packages/contracts/src";
import {
  createRequest,
  finalize,
  validateRequest,
} from "../../apps/api/src/requests";
import { ArtifactStore, runRender } from "../../packages/printing/src";

test("real group owner, immutable roster, atomic counts and idempotent concurrent registration", async () => {
  assertTestDatabase();
  const seeded = await provision({
    email: `group-${randomUUID()}@example.test`,
    password: "Synthetic-Test-Password!",
    name: "Групповой синтетический центр",
    sample: true,
  });
  const c: Context = {
    ...seeded,
    role: "ADMIN",
    sessionId: "test",
    csrfHash: "test",
    correlationId: randomUUID(),
  };
  const eventId = randomUUID();
  const draft = draftSchema.parse({
    kind: "PERSON",
    schemaVersion: 2,
    events: [
      {
        id: eventId,
        title: "Проверка ПБ",
        protocolTemplateId: "pb-protocol",
        commonFields: {
          documentDate: "2026-09-24",
          protocolDate: "2026-09-23",
          trainingSubject: "Промышленная безопасность",
          trainingStart: "2026-09-21",
          trainingEnd: "2026-09-23",
        },
      },
    ],
    items: Array.from({ length: 3 }, (_, i) => ({
      id: `row-${i}`,
      fullNameRu: `Тестовый Получатель ${i}`,
      fullNameKz: `Әділ Өмір ${i}`,
      positionRu: "Мастер",
      assignments: [
        {
          id: "card",
          templateId: "pb-card",
          protocolMode: "GROUP",
          eventId,
          result: i === 2 ? "Не сдал" : "Сдал",
          outcome: {
            status: i === 2 ? "FAILED" : "PASSED",
            source: "Синтетическая ведомость",
          },
        },
      ],
    })),
  });
  const r = await createRequest(c, draft);
  const validation = await validateRequest(c, r.id, { expectedRevision: 0 });
  assert.deepEqual(validation.issues, []);
  assert.equal(validation.documentCount, 3);
  assert.equal(
    await db.numberReservation.count({ where: { tenantId: c.tenantId } }),
    0,
  );
  const result = await Promise.all([
    finalize(c, r.id, { expectedRevision: 0 }, randomUUID()),
    finalize(c, r.id, { expectedRevision: 0 }, randomUUID()),
  ]);
  assert.deepEqual(result[0], result[1]);
  const docs = await db.issuedDocument.findMany({ where: { requestId: r.id } });
  assert.equal(docs.length, 3);
  const group = docs.find((d) => d.ownerKind === "GROUP")!;
  assert.equal(group.rowId, null);
  assert.equal(group.assignmentId, null);
  assert.equal(group.groupEventId, eventId);
  assert.equal(
    await db.groupDocumentMember.count({ where: { documentId: group.id } }),
    3,
  );
  assert.equal(await db.generationJob.count({ where: { requestId: r.id } }), 8);
  assert.equal(
    await db.numberReservation.count({
      where: { tenantId: c.tenantId, namespace: "PB:PROTOCOL" },
    }),
    1,
  );
  const snaps = await db.renderInputSnapshot.findMany({
    where: { requestId: r.id, templateVersionId: { not: null } },
  });
  const snap = snaps.find((s) => (s.input as any).groupEvent)!;
  assert.equal((snap.input as any).items.length, 3);
  for (const s of snaps.filter((s) => !(s.input as any).groupEvent))
    assert.equal((s.input as any).items[0].linkedProtocolDocumentId, group.id);
  const docx = await runRender("docx", snap.input);
  assert.ok(docx.buffer.length > 1000);
  const pdf = await runRender(
    "pdf",
    {},
    { inputBytes: docx.buffer, inputExtension: "docx" },
  );
  assert.equal(pdf.buffer.subarray(0, 4).toString(), "%PDF");
  const store = new ArtifactStore();
  await store.put(docx.buffer, "docx");
  await store.put(pdf.buffer, "pdf");
  await assert.rejects(
    db.issuedDocument.update({
      where: { id: group.id },
      data: { number: "changed" },
    }),
  );
  await assert.rejects(
    db.groupDocumentMember.deleteMany({ where: { documentId: group.id } }),
  );
  await db.$disconnect();
});
