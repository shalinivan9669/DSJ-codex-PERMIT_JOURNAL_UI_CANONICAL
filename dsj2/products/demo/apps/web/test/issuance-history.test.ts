import assert from "node:assert/strict";
import { test } from "node:test";
import {
  issuanceHistoryActions,
  issuanceHistoryPayload,
} from "../lib/issuance-history";

test("a working draft with a prior frozen issuance can be corrected without enabling cancellation", () => {
  assert.deepEqual(
    issuanceHistoryActions({
      canManage: true,
      readonly: false,
      status: "DRAFT",
      issuanceIds: ["issued-old"],
    }),
    { correct: true, cancel: false },
  );
  assert.deepEqual(
    issuanceHistoryActions({
      canManage: true,
      readonly: false,
      status: "DRAFT",
      issuanceIds: [],
    }),
    { correct: false, cancel: false },
  );
});

test("correction retains prior issuance access while cancellation retains readonly and status guards", () => {
  const input = {
    canManage: true,
    readonly: true,
    status: "FINALIZED",
    issuanceIds: ["old"],
  };
  assert.deepEqual(issuanceHistoryActions(input), {
    correct: true,
    cancel: true,
  });
  assert.deepEqual(issuanceHistoryActions({ ...input, status: "CANCELLED" }), {
    correct: true,
    cancel: false,
  });
  assert.deepEqual(issuanceHistoryActions({ ...input, canManage: false }), {
    correct: false,
    cancel: false,
  });
  assert.equal(
    issuanceHistoryActions({ ...input, readonly: false }).cancel,
    false,
  );
});

test("correction targets the chosen older issuance with the current expected revision", () => {
  assert.deepEqual(
    issuanceHistoryPayload("correct", "Исправить подписантов", 18, "older", [
      "latest",
      "older",
    ]),
    {
      reason: "Исправить подписантов",
      expectedRevision: 18,
      issuanceId: "older",
    },
  );
  assert.equal(
    issuanceHistoryPayload("correct", "Причина", 18, "", ["latest"]),
    undefined,
  );
  assert.equal(
    issuanceHistoryPayload("correct", "Причина", 18, "other-request", [
      "latest",
    ]),
    undefined,
  );
});

test("cancellation never sends correction source to its strict API schema", () => {
  assert.deepEqual(
    issuanceHistoryPayload("cancel", "Причина отмены", 18, "older", [
      "latest",
      "older",
    ]),
    {
      reason: "Причина отмены",
      expectedRevision: 18,
    },
  );
});
