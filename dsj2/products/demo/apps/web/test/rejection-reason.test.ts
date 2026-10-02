import test from "node:test";
import assert from "node:assert/strict";
import { rejectionReason, type RejectionDetail } from "../lib/rejection-reason";
import type { Draft } from "../lib/types";

function fixture() {
  const draft: Pick<Draft, "id" | "approval"> = {
    id: "request",
    approval: {
      proposalId: "proposal",
      proposalHash: "current-hash",
      status: "REJECTED",
      baseRevision: 1,
      submittedBy: "manager",
      submittedAt: "2026-10-02T00:00:00Z",
    },
  };
  const detail: RejectionDetail = {
    id: "proposal",
    requestId: "request",
    proposalHash: "current-hash",
    status: "REJECTED",
    decision: {
      decision: "REJECT",
      comment: "Уточните источник подтверждения результата.",
    },
  };
  return { draft, detail };
}

test("returned request shows the actual director comment of its current proposal", () => {
  const { draft, detail } = fixture();
  assert.equal(
    rejectionReason(draft, detail),
    "Уточните источник подтверждения результата.",
  );
  assert.equal(rejectionReason(draft, null), null);
  assert.equal(rejectionReason(draft, { ...detail, decision: null }), null);
  assert.equal(
    rejectionReason(draft, {
      ...detail,
      decision: { decision: "REJECT", comment: " " },
    }),
    null,
  );
});

test("a late or unrelated decision never appears after a request or revision changes", () => {
  const { draft, detail } = fixture();
  for (const patch of [
    { requestId: "another-request" },
    { id: "old-proposal" },
    { proposalHash: "old-hash" },
    { status: "APPROVED" },
    { decision: { decision: "APPROVE", comment: "Согласовано" } },
  ])
    assert.equal(rejectionReason(draft, { ...detail, ...patch }), null);
  draft.approval!.status = "PENDING";
  assert.equal(rejectionReason(draft, detail), null);
  draft.approval = undefined;
  assert.equal(rejectionReason(draft, detail), null);
});
