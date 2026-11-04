import assert from "node:assert/strict";
import { test } from "node:test";
import {
  BiotGroupSubmissionError,
  confirmedBiotHistoryLinks,
  describeBiotGroupFailure,
  submitBiotGroups,
} from "../../lib/biot-group-submission";

test("stops after a failed group and reports confirmed and uncertain results", async () => {
  const started: number[] = [];
  await assert.rejects(
    submitBiotGroups([1, 2, 3], async (group, markSent) => {
      started.push(group);
      markSent();
      if (group === 2) throw new Error("Соединение прервано.");
      return "request-1";
    }, (group) => `Тип ${group}`),
    (error: unknown) => {
      assert.ok(error instanceof BiotGroupSubmissionError);
      assert.equal(error.confirmed, 1);
      assert.equal(error.total, 3);
      assert.equal(error.currentRequestSent, true);
      assert.deepEqual(error.confirmedGroups, [{ label: "Тип 1", requestId: "request-1" }]);
      assert.deepEqual(confirmedBiotHistoryLinks(error, ["request-1"]), [{ label: "Тип 1", requestId: "request-1" }]);
      assert.deepEqual(confirmedBiotHistoryLinks(error, ["other"]), []);
      const message = describeBiotGroupFailure(error, true);
      assert.match(message, /1 из 3/);
      assert.match(message, /могла сохраниться/);
      assert.match(message, /Список заявок обновлён/);
      assert.match(message, /Проверьте историю/);
      return true;
    },
  );
  assert.deepEqual(started, [1, 2]);
});

test("never creates a history link for absent or malformed returned identifiers", () => {
  const error = new BiotGroupSubmissionError("ошибка", 4, 5, true, [
    { label: "нет заголовка", requestId: null },
    { label: "небезопасный путь", requestId: "../unsafe" },
    { label: "первый", requestId: "valid_1" },
    { label: "повтор", requestId: "valid_1" },
  ]);
  assert.deepEqual(confirmedBiotHistoryLinks(error, ["../unsafe", "valid_1"]), [{ label: "первый", requestId: "valid_1" }]);
});

test("distinguishes a failure before sending from a lost first response", async () => {
  const original = new Error("Не удалось получить номера.");
  await assert.rejects(submitBiotGroups([1], async () => { throw original; }, String), (e: unknown) => e === original);
  await assert.rejects(
    submitBiotGroups([1], async (_, markSent) => { markSent(); throw new Error("Ошибка сети."); }, String),
    (error: unknown) => {
      assert.ok(error instanceof BiotGroupSubmissionError);
      assert.equal(error.confirmed, 0);
      assert.match(describeBiotGroupFailure(error, false), /Не удалось обновить список/);
      return true;
    },
  );
});

test("finishes successfully when all groups are submitted", async () => {
  const sent: number[] = [];
  await submitBiotGroups([1, 2], async (group, markSent) => { markSent(); sent.push(group); }, String);
  assert.deepEqual(sent, [1, 2]);
});
