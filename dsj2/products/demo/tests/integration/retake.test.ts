import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { db, hash, type Context } from "../../apps/api/src/core";
import { provision } from "../../scripts/setup";
import {
  createRequest,
  finalize,
  retake,
  patchRequest,
  listRequests,
} from "../../apps/api/src/requests";
import {
  draftSchema,
  resolveDraft,
  documentPlan,
} from "../../packages/contracts/src";
import { assertTestDatabase } from "./test-database";

test("retake preserves failed issued attempt, creates an explicitly linked unknown attempt with new event and no dates/numbers, isolates references", async () => {
  assertTestDatabase();
  const seeded = await provision({
    email: `retake-${randomUUID()}@example.test`,
    password: "Synthetic-Test-Password!",
    name: "Синтетический центр пересдачи",
    sample: true,
  });
  const c: Context = {
    ...seeded,
    role: "ADMIN",
    sessionId: "test",
    csrfHash: "test",
    correlationId: randomUUID(),
  };
  try {
    const eventId = randomUUID();
    const input = draftSchema.parse({
      schemaVersion: 2,
      kind: "PERSON",
      events: [
        {
          id: eventId,
          title: "Первая проверка",
          protocolTemplateId: "pb-protocol",
          commonFields: {
            documentDate: "2026-09-24",
            protocolDate: "2026-09-24",
            trainingStart: "2026-09-23",
            trainingEnd: "2026-09-24",
            trainingSubject: "Синтетическая программа",
          },
        },
      ],
      items: [
        {
          id: "row",
          fullNameRu: "Синтетический Участник",
          personnelNumber: "0000442",
          positionRu: "Инженер",
          assignments: [
            {
              id: "first",
              templateId: "pb-card",
              eventId,
              protocolMode: "GROUP",
              outcome: { status: "FAILED", source: "Синтетическая ведомость" },
            },
          ],
        },
      ],
    });
    const original = await createRequest(c, input);
    await finalize(c, original.id, { expectedRevision: 0 }, randomUUID());
    const oldRecord = await db.printRequest.findUniqueOrThrow({
      where: { id: original.id },
    });
    const oldDocuments = await db.issuedDocument.findMany({
      where: { requestId: original.id },
    });
    const oldSnapshots = await db.renderInputSnapshot.findMany({
      where: { requestId: original.id },
    });
    assert.equal(oldDocuments.length, 1);
    assert.equal(oldDocuments[0].ownerKind, "GROUP");
    assert.equal((await listRequests(c, { search: "0000442" })).total, 1);
    assert.equal(
      (await listRequests(c, { search: oldDocuments[0].number })).total,
      1,
    );
    const args = {
      expectedRevision: oldRecord.revision,
      rowId: "row",
      assignmentId: "first",
      reason: "Повторная проверка по тестовому основанию",
    };
    await assert.rejects(
      retake(c, original.id, {
        ...args,
        expectedRevision: oldRecord.revision + 1,
      }),
    );
    await assert.rejects(
      retake({ ...c, tenantId: randomUUID() }, original.id, args),
    );
    const copy = await retake(c, original.id, args);
    const next = draftSchema.parse(
      (await db.printRequest.findUniqueOrThrow({ where: { id: copy.id } }))
        .draft,
    );
    const assignment = next.items[0].assignments[0];
    assert.deepEqual(assignment.retakeOf, {
      requestId: original.id,
      rowId: "row",
      assignmentId: "first",
      reason: args.reason,
    });
    assert.notEqual(next.events![0].id, eventId);
    assert.notEqual(next.items[0].id, "row");
    assert.equal(assignment.outcome?.status, "UNKNOWN");
    assert.equal(assignment.result, "");
    const resolved = resolveDraft(next, {
      documentDate: "2000-01-01",
      trainingStart: "2000-01-01",
    }).draft;
    assert.equal(resolved.items[0].assignments[0].documentDate, "");
    assert.equal(resolved.items[0].assignments[0].trainingStart, "");
    assert.equal(documentPlan(resolved).individuals.length, 0);
    assert.equal(
      await db.numberReservation.count({ where: { tenantId: c.tenantId } }),
      1,
    );
    assert.equal(
      hash(
        (
          await db.printRequest.findUniqueOrThrow({
            where: { id: original.id },
          })
        ).draft,
      ),
      hash(oldRecord.draft),
    );
    assert.equal(
      hash(
        await db.renderInputSnapshot.findMany({
          where: { requestId: original.id },
        }),
      ),
      hash(oldSnapshots),
    );
    assert.equal(
      hash(
        await db.issuedDocument.findMany({ where: { requestId: original.id } }),
      ),
      hash(oldDocuments),
    );
    const forged = structuredClone(next);
    forged.items[0].fullNameRu = "Другой Получатель";
    await assert.rejects(
      patchRequest(c, copy.id, { expectedRevision: 0, draft: forged }),
    );
    const foreign = structuredClone(next);
    foreign.items[0].assignments[0].retakeOf!.requestId = randomUUID();
    await assert.rejects(
      patchRequest(c, copy.id, { expectedRevision: 0, draft: foreign }),
    );
    await assert.rejects(retake(c, copy.id, { ...args, expectedRevision: 0 }));
    const namesake = await db.recipient.create({
      data: {
        tenantId: c.tenantId,
        data: { fullNameRu: "Синтетический Участник" },
      },
    });
    const wrongIdentity = structuredClone(next);
    wrongIdentity.items[0].recipientId = namesake.id;
    await assert.rejects(
      patchRequest(c, copy.id, { expectedRevision: 0, draft: wrongIdentity }),
    );
    await db.issuanceEvent.create({
      data: {
        tenantId: c.tenantId,
        issuanceId: oldDocuments[0].issuanceId,
        kind: "REPLACED",
        reason: "Синтетическая исправленная попытка",
        actorId: c.userId,
      },
    });
    await assert.rejects(retake(c, original.id, args));
    await assert.rejects(
      patchRequest(c, copy.id, { expectedRevision: 0, draft: next }),
    );
    assert.equal(
      await db.auditEvent.count({
        where: { tenantId: c.tenantId, action: "RETAKE_DRAFT_CREATED" },
      }),
      1,
    );
  } finally {
    await db.$disconnect();
  }
});
