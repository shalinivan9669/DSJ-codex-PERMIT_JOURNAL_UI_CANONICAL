import test from "node:test";
import assert from "node:assert/strict";
import { approvalRefreshRequired } from "../lib/approval-refresh";

test("approval polling refreshes only a changed decision, version or issuance state", () => {
  const current = {
    revision: 3,
    status: "DRAFT",
    approval: { proposalId: "p", status: "PENDING", proposalHash: "hash" },
  };
  const same = { ...current, requestStatus: "DRAFT" };
  assert.equal(approvalRefreshRequired(current, same), false);
  assert.equal(
    approvalRefreshRequired(current, {
      ...same,
      approval: { ...same.approval, status: "APPROVED" },
    }),
    true,
  );
  assert.equal(
    approvalRefreshRequired(current, { ...same, revision: 4 }),
    true,
  );
  assert.equal(
    approvalRefreshRequired(current, { ...same, requestStatus: "FINALIZED" }),
    true,
  );
  assert.equal(
    approvalRefreshRequired(current, { ...same, approval: null }),
    true,
  );
});
