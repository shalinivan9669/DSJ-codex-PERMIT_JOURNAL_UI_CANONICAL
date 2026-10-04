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
  requestDetail,
} from "../../apps/api/src/requests";
import {
  draftSchema,
  resolveDraft,
  documentPlan,
} from "../../packages/contracts/src";
import { assertTestDatabase } from "./test-database";
import { createApprovalFixture } from "./live-approval-fixture";
import { submitApproval } from "../../apps/api/src/approvals";

test("retake preserves failed issued attempt, creates an explicitly linked unknown attempt with new event and no dates/numbers, isolates references", async (t) => {
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
  const approvals = await createApprovalFixture(c);
  t.after(() => approvals.close());
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
    await approvals.approve(original.id);
    await finalize(
      c,
      original.id,
      { expectedRevision: original.revision },
      randomUUID(),
    );
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
    const next = draftSchema.parse((await requestDetail(c, copy.id)).draft);
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
      patchRequest(c, copy.id, {
        expectedRevision: copy.revision,
        draft: forged,
      }),
    );
    const foreign = structuredClone(next);
    foreign.items[0].assignments[0].retakeOf!.requestId = randomUUID();
    await assert.rejects(
      patchRequest(c, copy.id, {
        expectedRevision: copy.revision,
        draft: foreign,
      }),
    );
    await assert.rejects(
      retake(c, copy.id, { ...args, expectedRevision: copy.revision }),
    );
    const namesake = await db.recipient.create({
      data: {
        tenantId: c.tenantId,
        data: { fullNameRu: "Синтетический Участник" },
      },
    });
    const wrongIdentity = structuredClone(next);
    wrongIdentity.items[0].recipientId = namesake.id;
    await assert.rejects(
      patchRequest(c, copy.id, {
        expectedRevision: copy.revision,
        draft: wrongIdentity,
      }),
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
      patchRequest(c, copy.id, {
        expectedRevision: copy.revision,
        draft: next,
      }),
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

test("failed partial batch remains a frozen retake source while the same request prepares waiting people", async (t) => {
  assertTestDatabase();
  const seeded = await provision({
    email: `partial-retake-${randomUUID()}@example.test`,
    password: "Synthetic-Test-Password!",
    name: "Синтетический центр частичной пересдачи",
    sample: true,
  });
  const c: Context = {
    ...seeded,
    role: "ADMIN",
    sessionId: "test",
    csrfHash: "test",
    correlationId: randomUUID(),
  };
  const approvals = await createApprovalFixture(c);
  t.after(async () => {
    await approvals.close();
    await db.$disconnect();
  });
  const eventId = randomUUID();
  const original = await createRequest(
    c,
    draftSchema.parse({
      kind: "PERSON",
      schemaVersion: 2,
      events: [
        {
          id: eventId,
          title: "Проверка ПБ",
          protocolTemplateId: "pb-protocol",
          commonFields: {
            documentDate: "2026-10-04",
            protocolDate: "2026-10-04",
            trainingStart: "2026-10-01",
            trainingEnd: "2026-10-03",
          },
        },
      ],
      items: ["failed", "waiting"].map((rowId) => ({
        id: rowId,
        fullNameRu: `Синтетический Получатель ${rowId}`,
        positionRu: "Оператор",
        assignments: [
          {
            id: "course",
            templateId: "pb-card",
            eventId,
            protocolMode: "GROUP",
            outcome: {
              status: rowId === "failed" ? "FAILED" : "UNKNOWN",
              source: rowId === "failed" ? "Синтетическая ведомость" : "",
            },
          },
        ],
      })),
    }),
  );
  const assignments = [{ rowId: "failed", assignmentId: "course" }];
  await submitApproval(c, original.id, {
    expectedRevision: original.revision,
    assignments,
  });
  await approvals.approve(original.id);
  await finalize(
    c,
    original.id,
    { expectedRevision: original.revision, assignments },
    randomUUID(),
  );
  const detail = await requestDetail(c, original.id);
  assert.equal(detail.status, "DRAFT");
  assert.equal(detail.documents.length, 1);
  assert.equal(detail.documents[0].ownerKind, "GROUP");
  const snapshots = await db.renderInputSnapshot.findMany({
    where: { tenantId: c.tenantId, requestId: original.id },
  });
  const draft = draftSchema.parse(detail.draft);
  draft.items.find((row) => row.id === "failed")!.fullNameRu =
    "Синтетическое имя для следующей подготовки";
  draft.items.find((row) => row.id === "waiting")!.positionRu =
    "Исправленная должность ожидающего";
  const saved = await patchRequest(c, original.id, {
    expectedRevision: detail.revision,
    draft,
  });
  const args = {
    expectedRevision: saved.revision,
    rowId: "failed",
    assignmentId: "course",
    reason: "Явная синтетическая пересдача неуспешной попытки",
  };
  await assert.rejects(retake(c, original.id, { ...args, rowId: "waiting" }));
  const copied = await retake(c, original.id, args);
  const next = draftSchema.parse(copied.draft);
  assert.equal(next.items.length, 1);
  assert.equal(next.items[0].fullNameRu, "Синтетический Получатель failed");
  assert.equal(next.items[0].assignments[0].outcome?.status, "UNKNOWN");
  assert.equal(next.items[0].assignments[0].retakeOf?.requestId, original.id);
  assert.notEqual(next.events?.[0].id, eventId);
  assert.equal(next.items[0].assignments[0].documentDate, "");
  assert.equal(
    hash(
      await db.renderInputSnapshot.findMany({
        where: { tenantId: c.tenantId, requestId: original.id },
      }),
    ),
    hash(snapshots),
  );
  assert.equal((await requestDetail(c, original.id)).status, "DRAFT");
});
