import test from "node:test";
import assert from "node:assert/strict";
import { PreparationSaves } from "../lib/preparation-saves";
import {
  emptyOutcomePreparation,
  preparationKey,
  writePreparation,
  type PreparationIdentity,
  type PreparationRecord,
} from "../lib/preparation-storage";

class MemoryStorage {
  values = new Map<string, string>();
  getItem(key: string) {
    return this.values.get(key) ?? null;
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
  requestId: "request-a",
  kind: "outcome",
  targetId: "biot",
};
function record(
  owner: PreparationIdentity = identity,
): PreparationRecord<typeof emptyOutcomePreparation> {
  return {
    version: 1,
    identity: owner,
    title: "БиОТ",
    requestRevision: 7,
    context: "synthetic-context",
    savedAt: "2026-11-08T00:00:00Z",
    value: {
      ...emptyOutcomePreparation,
      status: "PASSED",
      source: "Синтетическая неподтверждённая ведомость",
    },
  };
}

test("an unmounted failed request does not block or get retried by another request's flush", () => {
  const saves = new PreparationSaves();
  const storage = new MemoryStorage();
  const keyA = preparationKey(identity);
  const pendingA = {
    record: record(),
    expectedRaw: null,
    error: "Quota exceeded",
  };
  saves.pendingRecords.set(keyA, pendingA);
  let attemptsA = 0;
  // This is the retained callback after the first request unmounts on save failure.
  saves.register("unmounted-a", {
    key: keyA,
    identity,
    dirty: () => true,
    flush: () => {
      attemptsA++;
      return false;
    },
  });
  saves.release("unmounted-a", false);
  const identityB = { ...identity, requestId: "request-b" };
  const keyB = preparationKey(identityB);
  const candidateB = record(identityB);
  saves.pendingRecords.set(keyB, {
    record: candidateB,
    expectedRaw: null,
    error: "",
  });
  let dirtyB = true;
  saves.register("mounted-b", {
    key: keyB,
    identity: identityB,
    dirty: () => dirtyB,
    flush: () => {
      writePreparation(storage, keyB, candidateB, null);
      saves.pendingRecords.delete(keyB);
      dirtyB = false;
      return true;
    },
  });

  assert.equal(
    saves.flush(() => storage, identityB),
    true,
  );
  assert.equal(saves.needsSave(identityB), false);
  assert.equal(storage.getItem(keyB), JSON.stringify(candidateB));
  assert.equal(
    attemptsA,
    0,
    "another request must not retry the stale callback",
  );
  assert.equal(storage.getItem(keyA), null);
  assert.equal(saves.pendingRecords.get(keyA), pendingA);
  assert.equal(saves.activeSaves.has("unmounted-a"), true);
  assert.equal(saves.needsSave(identity), true);
  assert.equal(saves.needsSave(), true, "logout still sees the unsaved draft");
  assert.equal(
    saves.flush(() => storage, identity),
    false,
  );
  assert.equal(
    attemptsA,
    1,
    "the originating request still reports the failure",
  );
  assert.equal(saves.pendingRecords.get(keyA), pendingA);
});

test("reopening a failed preparation retries its retained candidate without a stale callback blocking it again", () => {
  const saves = new PreparationSaves();
  const storage = new MemoryStorage();
  const key = preparationKey(identity);
  const original = writePreparation(storage, key, record(), null);
  const pending = {
    record: {
      ...record(),
      value: { ...record().value, source: "Новый несохранённый ввод" },
    },
    expectedRaw: original,
    error: "Quota exceeded",
  };
  saves.pendingRecords.set(key, pending);
  let staleAttempts = 0;
  saves.register("closed-panel", {
    key,
    identity,
    dirty: () => true,
    flush: () => {
      staleAttempts++;
      // The old callback still expects the value observed before its failure.
      // Once the reopened panel saves, this would conflict with that save.
      try {
        writePreparation(storage, key, pending.record, original);
        return true;
      } catch {
        return false;
      }
    },
  });
  saves.release("closed-panel", false);

  const restored = saves.pendingRecords.get(key)!;
  assert.equal(restored, pending, "remount restores the unsaved candidate");
  let dirty = true;
  const retry = () => {
    if (!dirty) return true;
    writePreparation(storage, key, restored.record, restored.expectedRaw);
    saves.pendingRecords.delete(key);
    dirty = false;
    return true;
  };
  saves.register("reopened-panel", {
    key,
    identity,
    dirty: () => dirty,
    flush: retry,
  });
  assert.equal(retry(), true, "the reopened panel's explicit retry succeeds");
  assert.equal(storage.getItem(key), JSON.stringify(pending.record));
  assert.equal(saves.needsSave(identity), false);
  assert.equal(
    saves.flush(() => storage, identity),
    true,
  );
  assert.equal(staleAttempts, 0);
  assert.equal(saves.activeSaves.has("closed-panel"), false);
});

test("a detached pending draft survives unavailable storage and is saved on its scoped retry", () => {
  const saves = new PreparationSaves();
  const storage = new MemoryStorage();
  const key = preparationKey(identity);
  const pending = { record: record(), expectedRaw: null, error: "Unavailable" };
  saves.pendingRecords.set(key, pending);
  assert.equal(
    saves.flush(() => {
      throw new Error("Browser denied access to localStorage");
    }, identity),
    false,
  );
  assert.equal(saves.pendingRecords.get(key), pending);
  assert.equal(saves.needsSave(identity), true);
  assert.equal(
    saves.flush(() => storage, identity),
    true,
  );
  assert.equal(storage.getItem(key), JSON.stringify(pending.record));
  assert.equal(saves.needsSave(identity), false);
});

test("scope isolates tenant, user and encoded request boundaries while global flush protects every draft", () => {
  const saves = new PreparationSaves();
  const storage = new MemoryStorage();
  const neighbors = [
    { ...identity, tenantId: "another-tenant" },
    { ...identity, userId: "another-operator" },
    { ...identity, requestId: "request-a:child" },
    { ...identity, requestId: "request-ab" },
  ];
  for (const owner of neighbors) {
    saves.pendingRecords.set(preparationKey(owner), {
      record: record(owner),
      expectedRaw: null,
      error: "",
    });
  }
  assert.equal(saves.needsSave(identity), false);
  assert.equal(
    saves.flush(() => storage, identity),
    true,
  );
  assert.equal(storage.values.size, 0);
  assert.equal(saves.pendingRecords.size, neighbors.length);
  assert.equal(saves.needsSave(), true);
  assert.equal(
    saves.flush(() => storage),
    true,
  );
  for (const owner of neighbors)
    assert.equal(
      storage.getItem(preparationKey(owner)),
      JSON.stringify(record(owner)),
    );
  assert.equal(saves.needsSave(), false);
});

test("scoped retry preserves a concurrent stored draft and failed explicit deletion", () => {
  const saves = new PreparationSaves();
  const storage = new MemoryStorage();
  const key = preparationKey(identity);
  const original = writePreparation(storage, key, record(), null);
  const concurrent = writePreparation(
    storage,
    key,
    { ...record(), value: { ...record().value, source: "Другое окно" } },
    original,
  );
  const deletion = { record: null, expectedRaw: original, error: "" };
  saves.pendingRecords.set(key, deletion);
  assert.equal(
    saves.flush(() => storage, identity),
    false,
  );
  assert.equal(storage.getItem(key), concurrent);
  assert.equal(saves.pendingRecords.get(key), deletion);
  assert.equal(saves.needsSave(identity), true);
});

test("failure target uses the current request's retained identity, excluding other owners and mismatched records", () => {
  const saves = new PreparationSaves();
  const others = [
    { ...identity, requestId: "another-request" },
    { ...identity, tenantId: "another-tenant" },
    { ...identity, userId: "another-operator" },
  ];
  for (const owner of others) {
    saves.pendingRecords.set(preparationKey(owner), {
      record: record(owner),
      expectedRaw: null,
      error: "Unavailable",
    });
  }
  // Even a key in this request must not redirect to a mismatched record's target.
  saves.pendingRecords.set(
    preparationKey({ ...identity, targetId: "mismatched-target" }),
    { record: record(others[0]), expectedRaw: null, error: "Invalid" },
  );
  assert.equal(saves.unsaved(identity), undefined);
  const pending = {
    record: record(),
    expectedRaw: null,
    error: "Unavailable",
  };
  saves.pendingRecords.set(preparationKey(identity), pending);
  assert.equal(
    saves.flush(() => {
      throw new Error("Unavailable storage");
    }, identity),
    false,
  );
  assert.deepEqual(saves.unsaved(identity), {
    targetId: "biot",
    kind: "outcome",
    title: "БиОТ",
  });
  assert.equal(saves.pendingRecords.get(preparationKey(identity)), pending);
});

test("a failed initial read has an actionable registered calendar target without parsing raw storage", () => {
  const saves = new PreparationSaves();
  const calendar: PreparationIdentity = {
    ...identity,
    kind: "calendar",
    targetId: "request",
  };
  let dirty = true;
  saves.register("unreadable-calendar", {
    key: preparationKey(calendar),
    identity: calendar,
    title: "Общий график заявки",
    dirty: () => dirty,
    flush: () => !dirty,
  });
  assert.equal(saves.pendingRecords.size, 0);
  assert.equal(
    saves.flush(() => {
      throw new Error("A failed read must not attempt a write");
    }, calendar),
    false,
  );
  assert.deepEqual(saves.unsaved(calendar), {
    targetId: "request",
    kind: "calendar",
    title: "Общий график заявки",
  });
  assert.equal(
    saves.unsaved({ ...calendar, requestId: "another-request" }),
    undefined,
  );
  dirty = false;
  assert.equal(saves.unsaved(calendar), undefined);
});

test("an unsaved cancellation keeps its explicit target when the candidate record is null", () => {
  const saves = new PreparationSaves();
  const pending = {
    record: null,
    identity,
    title: "БиОТ",
    expectedRaw: JSON.stringify(record()),
    error: "Storage unavailable",
  };
  saves.pendingRecords.set(preparationKey(identity), pending);
  assert.deepEqual(saves.unsaved(identity), {
    targetId: "biot",
    kind: "outcome",
    title: "БиОТ",
  });
  assert.equal(saves.pendingRecords.get(preparationKey(identity)), pending);
});
