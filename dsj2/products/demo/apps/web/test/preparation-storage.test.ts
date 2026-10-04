import test from "node:test";
import assert from "node:assert/strict";
import { newAssignment, newRecipient, type Draft } from "../lib/types";
import {
  emptyOutcomePreparation,
  eventPreparationContext,
  parsePreparation,
  preparationKey,
  validOutcomePreparation,
  writePreparation,
  type PreparationIdentity,
  type PreparationRecord,
} from "../lib/preparation-storage";

class MemoryStorage {
  values = new Map<string, string>();
  getItem(key: string) {
    return this.values.get(key) || null;
  }
  setItem(key: string, value: string) {
    this.values.set(key, value);
  }
  removeItem(key: string) {
    this.values.delete(key);
  }
}
const identity: PreparationIdentity = {
  tenantId: "synthetic-tenant",
  userId: "operator",
  requestId: "request",
  targetId: "biot",
  kind: "outcome",
};
function record(): PreparationRecord<typeof emptyOutcomePreparation> {
  return {
    version: 1,
    identity,
    title: "БиОТ",
    requestRevision: 7,
    context: "synthetic-context",
    savedAt: "2026-10-03T00:00:00Z",
    value: {
      status: "PASSED",
      source: "Синтетическая неприменённая ведомость",
      knowledge: "Синтетический результат",
      proctoring: "Синтетический прокторинг",
      scope: "selected",
    },
  };
}
test("preparation identity isolates tenant/user/request/event/kind and survives serialized reload without confirmed metadata", () => {
  const storage = new MemoryStorage();
  const key = preparationKey(identity);
  const saved = writePreparation(storage, key, record(), null);
  const reloaded = parsePreparation(
    storage.getItem(key),
    identity,
    validOutcomePreparation,
  );
  assert.deepEqual(reloaded, record());
  assert.equal(saved?.includes("confirmedBy"), false);
  for (const patch of [
    { tenantId: "other" },
    { userId: "other" },
    { requestId: "other" },
    { targetId: "ptm" },
    { kind: "calendar" as const },
  ]) {
    const other = { ...identity, ...patch };
    assert.equal(storage.getItem(preparationKey(other)), null);
    assert.throws(() =>
      parsePreparation(saved, other, validOutcomePreparation),
    );
  }
  assert.equal(
    validOutcomePreparation({ ...record().value, confirmedBy: "forged" }),
    false,
  );
});
test("storage failure retains last durable input and retries; a concurrent preparation is not silently overwritten", () => {
  const storage = new MemoryStorage();
  const key = preparationKey(identity);
  const original = writePreparation(storage, key, record(), null);
  const changed = {
    ...record(),
    value: { ...record().value, source: "Другой источник" },
  };
  const broken = {
    ...storage,
    getItem: storage.getItem.bind(storage),
    removeItem: storage.removeItem.bind(storage),
    setItem() {
      throw new Error("Quota exceeded");
    },
  };
  assert.throws(
    () => writePreparation(broken, key, changed, original),
    /Quota/,
  );
  assert.equal(storage.getItem(key), original);
  const retried = writePreparation(storage, key, changed, original);
  assert.equal(
    parsePreparation(retried, identity, validOutcomePreparation)?.value.source,
    "Другой источник",
  );
  assert.throws(
    () => writePreparation(storage, key, record(), original),
    /другом окне/,
  );
  assert.equal(storage.getItem(key), retried);
  assert.equal(writePreparation(storage, key, null, retried), null);
});
test("invalid preparation is reported and explicit cancellation removes only the observed scoped record", () => {
  const storage = new MemoryStorage();
  const key = preparationKey(identity);
  const neighboringKey = preparationKey({ ...identity, targetId: "ptm" });
  const neighbor = writePreparation(
    storage,
    neighboringKey,
    { ...record(), identity: { ...identity, targetId: "ptm" } },
    null,
  );
  storage.setItem(key, "{invalid synthetic payload");
  const observed = storage.getItem(key);
  assert.throws(() =>
    parsePreparation(observed, identity, validOutcomePreparation),
  );
  assert.equal(writePreparation(storage, key, null, observed), null);
  assert.equal(storage.getItem(neighboringKey), neighbor);
});
test("review context invalidates relevant members/facts/program dates but preserves cosmetic and other-event edits", () => {
  const item = newRecipient();
  item.id = "person";
  item.employeeCategory = "WORKER";
  item.assignments = [
    {
      ...newAssignment("biot-worker-card"),
      id: "card",
      eventId: "biot",
      outcome: {
        status: "PASSED",
        source: "Synthetic previous",
        confirmedBy: "operator",
        confirmedAt: "2026-10-02T00:00:00Z",
      },
    },
  ];
  const draft: Draft = {
    id: "request",
    title: "Original",
    revision: 1,
    status: "DRAFT",
    kind: "PERSON",
    customerId: null,
    demoMode: true,
    items: [item],
    events: [
      {
        id: "biot",
        title: "БиОТ",
        protocolTemplateId: "biot-protocol",
        revision: 0,
        commonFields: { hours: "10" },
      },
    ],
  };
  const before = structuredClone(draft);
  const event = draft.events![0];
  const context = eventPreparationContext(draft, event);
  draft.title = "Cosmetic";
  draft.revision++;
  draft.items[0].fullNameRu = "Исправлено имя";
  assert.equal(eventPreparationContext(draft, event), context);
  draft.items[0].assignments.push({
    ...newAssignment("ptm-card"),
    eventId: "ptm",
  });
  assert.equal(eventPreparationContext(draft, event), context);
  event.commonFields.hours = "12";
  assert.notEqual(eventPreparationContext(draft, event), context);
  assert.equal(eventPreparationContext(draft, undefined), "REMOVED");
  assert.deepEqual(
    draft.items[0].assignments[0].outcome,
    before.items[0].assignments[0].outcome,
    "preparing a context must never rewrite confirmed facts",
  );
});
