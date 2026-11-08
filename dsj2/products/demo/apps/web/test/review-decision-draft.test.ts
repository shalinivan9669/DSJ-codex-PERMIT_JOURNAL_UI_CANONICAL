import assert from "node:assert/strict";
import test from "node:test";
import {
  ReviewDecisionDrafts,
  clearReviewDecisionStorage,
  emptyReviewDecision,
  parseReviewDecision,
  recoverReviewDecision,
  reviewDraftKey,
} from "../lib/review-decision-draft";

const target = { targetType: "SUBMISSION" as const, id: "work-1" };
const draft = () => ({
  ...emptyReviewDecision("a".repeat(64), 1),
  feedback: "Проверьте расчёт",
  decision: "RETURNED",
  scores: { question1: 1 as const },
});
function memoryStorage() {
  const values = new Map<string, string>();
  return {
    values,
    get length() {
      return values.size;
    },
    key: (index: number) => [...values.keys()][index] || null,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
    removeItem: (key: string) => {
      values.delete(key);
    },
  };
}
test("decision drafts survive remount only in the same tenant user and target scope", () => {
  const storage = memoryStorage(),
    value = draft();
  new ReviewDecisionDrafts("tenant:user", () => storage).write(target, value);
  assert.deepEqual(
    new ReviewDecisionDrafts("tenant:user", () => storage).read(target),
    value,
  );
  assert.equal(
    new ReviewDecisionDrafts("tenant:other", () => storage).read(target),
    null,
  );
  assert.equal(
    new ReviewDecisionDrafts("other:user", () => storage).read(target),
    null,
  );
  assert.equal(
    new ReviewDecisionDrafts("tenant:user", () => storage).read({
      ...target,
      targetType: "ATTEMPT",
    }),
    null,
  );
});
test("unavailable reads can retry without replacing a saved decision draft", () => {
  const storage = memoryStorage(),
    value = draft();
  new ReviewDecisionDrafts("tenant:user", () => storage).write(target, value);
  let blocked = true;
  const restored = new ReviewDecisionDrafts("tenant:user", () => ({
    ...storage,
    getItem: (key) => {
      if (blocked) throw new Error("restricted");
      return storage.getItem(key);
    },
  }));
  assert.throws(() => restored.read(target), /restricted/);
  assert.equal(restored.unsaved, false);
  blocked = false;
  assert.deepEqual(restored.read(target), value);
});
test("valid imported question identifiers retain scores and oversized input is never claimed persisted", () => {
  const storage = memoryStorage();
  const store = new ReviewDecisionDrafts("tenant:user", () => storage);
  const value = { ...draft(), scores: { "Сұрақ 1.1": 1 as const } };
  store.write(target, value);
  assert.deepEqual(
    new ReviewDecisionDrafts("tenant:user", () => storage).read(target)?.scores,
    value.scores,
  );
  assert.throws(
    () => store.write(target, { ...value, feedback: "x".repeat(10001) }),
    /Invalid review draft/,
  );
  assert.equal(store.unsaved, true);
  assert.equal(store.read(target)?.feedback.length, 10001);
});
test("identical work keeps the retry key; changed hash or revision retains only the comment", () => {
  const value = draft();
  const current = {
    contentHash: value.contentHash,
    revision: 1,
    allowedActions: ["RETURNED"],
    pendingQuestionIds: ["question1"],
  };
  assert.deepEqual(recoverReviewDecision(value, current), {
    draft: value,
    changed: false,
  });
  for (const patch of [{ revision: 2 }, { contentHash: "b".repeat(64) }]) {
    const restored = recoverReviewDecision(value, { ...current, ...patch });
    assert.equal(restored.changed, true);
    assert.equal(restored.draft.feedback, value.feedback);
    assert.equal(restored.draft.decision, "");
    assert.deepEqual(restored.draft.scores, {});
    assert.notEqual(restored.draft.key, value.key);
  }
});
test("restoration cannot retain obsolete question scores or manufacture an allowed decision", () => {
  const value = draft();
  const restored = recoverReviewDecision(value, {
    contentHash: value.contentHash,
    revision: 1,
    allowedActions: ["GRADE"],
    pendingQuestionIds: ["question2"],
  });
  assert.deepEqual(restored.draft.scores, {});
  assert.equal(restored.draft.decision, "");
  assert.notEqual(restored.draft.key, value.key);
  const settled = recoverReviewDecision(value, {
    contentHash: value.contentHash,
    revision: 1,
    allowedActions: [],
  });
  assert.equal(settled.draft.feedback, "");
  assert.deepEqual(settled.draft.scores, {});
});
test("failed tab writes retain memory and block navigation until the same draft is stored", () => {
  const storage = memoryStorage(),
    value = draft();
  let unavailable = true;
  const store = new ReviewDecisionDrafts("tenant:user", () => ({
    ...storage,
    setItem: (key, raw) => {
      if (unavailable) throw new Error("quota");
      storage.setItem(key, raw);
    },
  }));
  assert.throws(() => store.write(target, value), /quota/);
  assert.equal(store.unsaved, true);
  assert.deepEqual(store.read(target), value);
  unavailable = false;
  store.flush();
  assert.equal(store.unsaved, false);
  assert.deepEqual(
    new ReviewDecisionDrafts("tenant:user", () => storage).read(target),
    value,
  );
});
test("confirmed decision clears only its own draft, and a failed deletion never replays memory", () => {
  const storage = memoryStorage(),
    value = draft(),
    other = { ...target, id: "other" };
  let failRemove = false;
  const store = new ReviewDecisionDrafts("tenant:user", () => ({
    ...storage,
    removeItem: (key) => {
      if (failRemove) throw new Error("blocked");
      storage.removeItem(key);
    },
  }));
  store.write(target, value);
  store.write(other, value);
  failRemove = true;
  assert.throws(() => store.clear(target), /blocked/);
  assert.equal(store.read(target), null);
  assert.equal(store.unsaved, false);
  failRemove = false;
  store.flush();
  assert.equal(storage.getItem(reviewDraftKey("tenant:user", target)), null);
  assert.notEqual(storage.getItem(reviewDraftKey("tenant:user", other)), null);
});
test("corrupt or oversized drafts cannot inject grades; successful logout cleanup is scope-only", () => {
  const value = draft();
  for (const raw of [
    "not json",
    JSON.stringify({ version: 2, ...value }),
    JSON.stringify({ version: 1, ...value, scores: { question1: 2 } }),
    JSON.stringify({ version: 1, ...value, feedback: "x".repeat(10001) }),
    JSON.stringify({ version: 1, ...value, revision: 0 }),
  ])
    assert.equal(parseReviewDecision(raw), null);
  const storage = memoryStorage();
  storage.setItem(
    reviewDraftKey("tenant:user", target),
    JSON.stringify({ version: 1, ...value }),
  );
  storage.setItem(reviewDraftKey("tenant:other", target), "other user");
  storage.setItem("demo:lms:assignment:tenant:user", "unrelated draft");
  clearReviewDecisionStorage(storage, "tenant:user");
  assert.equal(storage.getItem(reviewDraftKey("tenant:user", target)), null);
  assert.equal(
    storage.getItem(reviewDraftKey("tenant:other", target)),
    "other user",
  );
  assert.equal(
    storage.getItem("demo:lms:assignment:tenant:user"),
    "unrelated draft",
  );
});
