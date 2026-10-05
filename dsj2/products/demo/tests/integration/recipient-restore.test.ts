import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { provision } from "../../scripts/setup";
import { db, type Context } from "../../apps/api/src/core";
import { createRequest, patchRequest } from "../../apps/api/src/requests";
import { workingRequest } from "../../apps/api/src/approvals";
import { applyBusinessRules, draftSchema } from "../../packages/contracts/src";
import { assertTestDatabase } from "./test-database";

const rejected = (expected: string) => (error: unknown) => {
  assert.equal(
    (error as { getResponse(): { code: string } }).getResponse().code,
    expected,
  );
  return true;
};
test("committed recipient restore preserves server metadata, rejects forged business facts and remains revision and tenant scoped", async () => {
  assertTestDatabase();
  const seed = await provision({
    email: `recipient-restore-${randomUUID()}@example.test`,
    password: "Synthetic-restore-pass!",
    name: "СИНТЕТИЧЕСКИЙ центр восстановления",
    sample: true,
  });
  const c: Context = {
    tenantId: seed.tenantId,
    userId: seed.userId,
    role: "ADMIN",
    sessionId: "test",
    csrfHash: "test",
    correlationId: randomUUID(),
  };
  try {
    const initial = draftSchema.parse({
      kind: "PERSON",
      schemaVersion: 2,
      demoMode: true,
      items: [0, 1].map((index) => ({
        id: randomUUID(),
        fullNameRu: `Синтетический Получатель ${index}`,
        assignments: [
          {
            id: randomUUID(),
            templateId: "ptm-card",
            result: "Сдал",
            outcome: {
              status: "PASSED",
              source: "Исходная синтетическая ведомость",
            },
          },
        ],
      })),
    });
    const created = await createRequest(c, initial);
    const original = draftSchema.parse(
      (await workingRequest(c, created.id)).draft,
    );
    const rowId = original.items[0].id;
    const deleted = await patchRequest(c, created.id, {
      expectedRevision: created.revision,
      draft: applyBusinessRules({
        ...structuredClone(original),
        items: original.items.slice(1),
      }),
    });
    const mixed = structuredClone(original);
    mixed.items[0].assignments[0].result = "Подменённый результат";
    await assert.rejects(
      patchRequest(c, created.id, {
        expectedRevision: deleted.revision,
        draft: mixed,
        restoreRecipientId: rowId,
      }),
      rejected("RECIPIENT_RESTORE_CONFLICT"),
    );
    await assert.rejects(
      patchRequest(c, created.id, {
        expectedRevision: created.revision,
        draft: original,
        restoreRecipientId: rowId,
      }),
      rejected("REVISION_CONFLICT"),
    );
    await assert.rejects(
      patchRequest({ ...c, tenantId: randomUUID() }, created.id, {
        expectedRevision: deleted.revision,
        draft: original,
        restoreRecipientId: rowId,
      }),
    );
    const absent = await createRequest(c, {
      ...original,
      events: [],
      items: [],
    });
    await assert.rejects(
      patchRequest(c, absent.id, {
        expectedRevision: absent.revision,
        draft: original,
        restoreRecipientId: rowId,
      }),
      rejected("RECIPIENT_RESTORE_CONFLICT"),
    );
    const forged = structuredClone(original);
    for (const row of forged.items)
      for (const assignment of row.assignments) {
        assignment.outcome!.confirmedBy = "forged-user";
        assignment.outcome!.confirmedAt = "2099-01-01T00:00:00.000Z";
      }
    const restored = await patchRequest(c, created.id, {
      expectedRevision: deleted.revision,
      draft: forged,
      restoreRecipientId: rowId,
    });
    assert.deepEqual(
      draftSchema.parse((await workingRequest(c, created.id)).draft),
      original,
    );
    const fast = await patchRequest(c, created.id, {
      expectedRevision: restored.revision,
      draft: forged,
      restoreRecipientId: rowId,
    });
    assert.deepEqual(
      draftSchema.parse((await workingRequest(c, created.id)).draft),
      original,
    );
    const edited = structuredClone(original);
    edited.items[0].assignments[0].result =
      "Сдал после явного изменения результата";
    const started = Date.now();
    await patchRequest(c, created.id, {
      expectedRevision: fast.revision,
      draft: edited,
    });
    const saved = draftSchema.parse(
      (await workingRequest(c, created.id)).draft,
    );
    assert.equal(saved.items[0].assignments[0].outcome!.confirmedBy, c.userId);
    assert.ok(
      Date.parse(saved.items[0].assignments[0].outcome!.confirmedAt!) >=
        started,
    );
    assert.deepEqual(saved.items[1], original.items[1]);
  } finally {
    await db.$disconnect();
  }
});
