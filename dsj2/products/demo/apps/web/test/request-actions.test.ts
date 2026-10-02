import test from "node:test";
import assert from "node:assert/strict";
import {
  requestActions,
  type RequestActionsInput,
} from "../lib/request-actions";

function input(
  approval?: "PENDING" | "APPROVED" | "REJECTED" | "SUPERSEDED",
  changes: Partial<RequestActionsInput> = {},
): RequestActionsInput {
  return {
    role: "OPERATOR",
    dirty: false,
    draft: {
      status: "DRAFT",
      items: [{ id: "row" }] as RequestActionsInput["draft"]["items"],
      ...(approval
        ? {
            approval: {
              status: approval,
              proposalId: "proposal",
              proposalHash: "hash",
              baseRevision: 0,
              submittedBy: "operator",
              submittedAt: "2026-10-01T00:00:00Z",
            },
          }
        : {}),
    },
    ...changes,
  };
}

test("draft entry offers checks and one submit action, withholding decision/preparation/documents", () => {
  const actions = requestActions(input());
  assert.equal(actions.showValidate, true);
  assert.equal(actions.showPreview, true);
  assert.equal(actions.showSave, true);
  assert.equal(actions.showDecision, false);
  assert.equal(actions.showPrepareSigning, false);
  assert.equal(actions.showDocuments, false);
});

test("pending unchanged data needs no repeat submission; dirty data needs a new save and no stale decision", () => {
  const pending = requestActions(input("PENDING"));
  assert.equal(pending.showSave, false);
  assert.equal(pending.showPrepareSigning, false);
  assert.equal(pending.showDocuments, false);
  assert.equal(pending.showDecision, false);
  assert.equal(
    requestActions(input("PENDING", { role: "DIRECTOR" })).showDecision,
    true,
  );
  const dirty = requestActions(
    input("PENDING", { role: "DIRECTOR", dirty: true }),
  );
  assert.equal(dirty.showSave, true);
  assert.equal(dirty.showDecision, false);
  assert.equal(dirty.showPrepareSigning, false);
});

test("approved clean data offers preparation and documents; local changes require saving before preparation", () => {
  const approved = requestActions(input("APPROVED"));
  assert.equal(approved.showSave, false);
  assert.equal(approved.showDecision, false);
  assert.equal(approved.showPrepareSigning, true);
  assert.equal(approved.prepareSigningDisabled, false);
  assert.equal(approved.showDocuments, true);
  const dirty = requestActions(input("APPROVED", { dirty: true }));
  assert.equal(dirty.showSave, true);
  assert.equal(dirty.showPrepareSigning, true);
  assert.equal(dirty.prepareSigningDisabled, true);
  assert.equal(dirty.showDocuments, true);
  assert.equal(
    requestActions(input("APPROVED", { busy: true })).prepareSigningDisabled,
    true,
  );
  const empty = input("APPROVED");
  empty.draft.items = [];
  assert.equal(requestActions(empty).prepareSigningDisabled, true);
});

test("rejected and superseded drafts offer resubmission without preparation or director decision", () => {
  for (const status of ["REJECTED", "SUPERSEDED"] as const) {
    const actions = requestActions(input(status, { role: "DIRECTOR" }));
    assert.equal(actions.showSave, true);
    assert.equal(actions.showValidate, true);
    assert.equal(actions.showDecision, false);
    assert.equal(actions.showPrepareSigning, false);
    assert.equal(actions.showDocuments, false);
  }
});

test("viewers have no mutation actions and retain access to approved/prepared documents", () => {
  for (const status of [
    undefined,
    "PENDING",
    "APPROVED",
    "REJECTED",
  ] as const) {
    const actions = requestActions(
      input(status, { role: "VIEWER", dirty: true }),
    );
    assert.equal(actions.editable, false);
    assert.equal(actions.showSave, false);
    assert.equal(actions.showValidate, false);
    assert.equal(actions.showPreview, false);
    assert.equal(actions.showDecision, false);
    assert.equal(actions.showPrepareSigning, false);
    assert.equal(actions.showDocuments, status === "APPROVED");
  }
});

test("finalized and historical issuances expose documents without editor or repeated preparation", () => {
  const prepared = input("APPROVED", { role: "VIEWER" });
  prepared.draft.status = "FINALIZED";
  const actions = requestActions(prepared);
  assert.equal(actions.showDocuments, true);
  assert.equal(actions.showValidate, false);
  assert.equal(actions.showSave, false);
  assert.equal(actions.showPrepareSigning, false);
  const historical = input();
  historical.draft.status = "CANCELLED";
  historical.draft.issuances = [
    { id: "issuance", sourceRevision: 1, createdAt: "2026-10-01T00:00:00Z" },
  ];
  assert.equal(requestActions(historical).showDocuments, true);
  const finalized = input();
  finalized.draft.status = "FINALIZED";
  assert.equal(requestActions(finalized).showDocuments, true);
});

test("approving archive removes editing and preparation while preserving only issued documents", () => {
  const request = input("APPROVED", { role: "DIRECTOR" });
  assert.equal(requestActions(request).showPrepareSigning, true);
  assert.equal(requestActions(request).showDocuments, true);
  request.draft.archivedAt = "2026-10-01T00:00:00Z";
  const archived = requestActions(request);
  assert.equal(archived.editable, false);
  assert.equal(archived.showSave, false);
  assert.equal(archived.showValidate, false);
  assert.equal(archived.showPreview, false);
  assert.equal(archived.showPrepareSigning, false);
  assert.equal(archived.showDecision, false);
  assert.equal(archived.showDocuments, false);
  request.draft.archivedAt = null;
  request.draft.archived = true;
  assert.equal(requestActions(request).editable, false);
  assert.equal(requestActions(request).showDocuments, false);
  request.draft.approval = input("PENDING").draft.approval;
  assert.equal(requestActions(request).showDecision, false);
  request.draft.issuances = [
    {
      id: "historical-issuance",
      sourceRevision: 1,
      createdAt: "2026-10-01T00:00:00Z",
    },
  ];
  assert.equal(requestActions(request).showDocuments, true);
  request.draft.issuances = [];
  request.draft.status = "FINALIZED";
  assert.equal(requestActions(request).showDocuments, true);
});
