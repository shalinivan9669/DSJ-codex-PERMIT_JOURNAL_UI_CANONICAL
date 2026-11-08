import test from "node:test";
import assert from "node:assert/strict";
import { draftSchema, LIMITS } from "@demo/contracts";
import {
  batchAssignments,
  batchFeedbackKey,
  matchingBatchApproval,
  parseBatchSelection,
} from "../lib/batch-submission";
import type { Draft } from "../lib/types";

function fixture(): Draft {
  return {
    ...draftSchema.parse({
      kind: "PERSON",
      profileVersionId: "old-commission",
      items: [1, 2].map((index) => ({
        id: `person-${index}`,
        fullNameRu: `Синтетический получатель ${index}`,
        assignments: ["biot-worker-card", "biot-protocol", "ptm-card"].map(
          (templateId, number) => ({
            id: `assignment-${index}-${number}`,
            templateId,
            outcome: { status: "PASSED", source: "AUTO" },
          }),
        ),
      })),
    }),
    id: "request",
    revision: 1,
    status: "DRAFT",
  };
}

test("selected batch preserves people/course subsets and linked forms while excluding issued assignments", () => {
  const draft = fixture();
  draft.issuedAssignments = [
    {
      rowId: "person-2",
      assignmentId: "assignment-2-0",
      issuanceId: "issued-card",
    },
  ];
  const before = structuredClone(draft);
  assert.deepEqual(
    batchAssignments(draft, ["person-2:BIOT", "person-2:BIOT", "removed:BIOT"]),
    [{ rowId: "person-2", assignmentId: "assignment-2-1" }],
  );
  assert.equal(batchAssignments(draft, null).length, 5);
  assert.deepEqual(batchAssignments(draft, []), []);
  assert.deepEqual(draft, before);
  draft.items[1].assignments[1].outcome = { status: "UNKNOWN", source: "" };
  assert.deepEqual(batchAssignments(draft, ["person-2:BIOT"]), []);
  draft.items[1].assignments[1].outcome = {
    status: "FAILED",
    source: "Ведомость",
  };
  assert.deepEqual(batchAssignments(draft, ["person-2:BIOT"]), []);
});

test("feedback survives revision and approval metadata refresh but invalidates after input, commission or selection changes", () => {
  const draft = fixture();
  const selection = ["person-1:BIOT", "person-2:PTM"];
  const key = batchFeedbackKey(draft, selection);
  assert.notEqual(
    batchFeedbackKey({ ...draft, id: "copied-request" }, selection),
    key,
  );
  const refreshed = {
    ...draft,
    revision: 2,
    updatedAt: "2026-11-08T12:00:00Z",
    approvedRevision: 1,
    customerName: "Отображаемое имя",
  };
  assert.equal(batchFeedbackKey(refreshed, [...selection].reverse()), key);
  assert.equal(
    batchFeedbackKey(refreshed, [...selection, selection[0], "removed:PTM"]),
    key,
  );
  assert.notEqual(batchFeedbackKey(draft, ["person-1:BIOT"]), key);
  assert.notEqual(
    batchFeedbackKey(
      { ...draft, profileVersionId: "new-commission" },
      selection,
    ),
    key,
  );
  const edited = structuredClone(draft);
  edited.items[0].fullNameRu = "Исправленное имя";
  assert.notEqual(batchFeedbackKey(edited, selection), key);
  draft.issuedAssignments = [
    { rowId: "person-1", assignmentId: "assignment-1-0" },
  ];
  assert.notEqual(batchFeedbackKey(draft, selection), key);
});

test("automatic and explicit equivalent selections share feedback; issuance metadata order does not change eligibility", () => {
  const draft = fixture();
  const selected = [
    "person-1:BIOT",
    "person-1:PTM",
    "person-2:BIOT",
    "person-2:PTM",
  ];
  assert.equal(
    batchFeedbackKey(draft, null),
    batchFeedbackKey(draft, selected),
  );
  draft.issuedAssignments = [
    { rowId: "person-1", assignmentId: "assignment-1-0", issuanceId: "old-a" },
    { rowId: "person-2", assignmentId: "assignment-2-0", issuanceId: "old-b" },
  ];
  const key = batchFeedbackKey(draft, null);
  draft.issuedAssignments.reverse();
  draft.issuedAssignments[0].issuanceId = "display-metadata";
  assert.equal(batchFeedbackKey(draft, null), key);
});

test("a submitted or approved batch matches only the exact nonempty assignment set", () => {
  const draft = fixture();
  const assignments = batchAssignments(draft, ["person-2:BIOT"]);
  draft.approval = {
    proposalId: "proposal",
    status: "PENDING",
    baseRevision: 1,
    proposalHash: "hash",
    submittedBy: "operator",
    submittedAt: "2026-11-08T12:00:00Z",
    assignments: [...assignments].reverse(),
  };
  assert.equal(matchingBatchApproval(draft, assignments), true);
  assert.equal(
    matchingBatchApproval(draft, [...assignments, assignments[0]]),
    true,
  );
  assert.equal(matchingBatchApproval(draft, []), false);
  assert.equal(matchingBatchApproval(draft, assignments.slice(0, 1)), false);
  assert.equal(
    matchingBatchApproval(draft, batchAssignments(draft, null)),
    false,
  );
  assert.equal(
    matchingBatchApproval(draft, batchAssignments(draft, ["person-1:BIOT"])),
    false,
  );
  draft.approval.status = "APPROVED";
  assert.equal(matchingBatchApproval(draft, assignments), true);
  draft.approval.needsPreparation = true;
  assert.equal(matchingBatchApproval(draft, assignments), false);
  draft.approval.needsPreparation = false;
  for (const status of ["DRAFT", "REJECTED", "SUPERSEDED"] as const) {
    draft.approval.status = status;
    assert.equal(matchingBatchApproval(draft, assignments), false);
  }
});

test("stored selection keeps intentional empty/subset choices and rejects malformed or excessive data", () => {
  assert.equal(parseBatchSelection(null), null);
  assert.equal(parseBatchSelection("null"), null);
  assert.deepEqual(parseBatchSelection("[]"), []);
  assert.deepEqual(
    parseBatchSelection('["person:BIOT","person:PTM","person:BIOT"]'),
    ["person:BIOT", "person:PTM"],
  );
  for (const raw of [
    "",
    "broken",
    "{}",
    "true",
    "12",
    '"person:BIOT"',
    '["valid:BIOT",null]',
    '["valid:BIOT",1]',
    '[""]',
    '["   "]',
    JSON.stringify(["x".repeat(162)]),
    JSON.stringify(Array(LIMITS.documents + 1).fill("person:BIOT")),
  ])
    assert.equal(parseBatchSelection(raw), null);
});
