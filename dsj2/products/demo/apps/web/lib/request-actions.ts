import { isDirectorRole } from "@demo/contracts";
import type { Draft, Role } from "./types";

export type RequestActionsInput = {
  draft: Pick<
    Draft,
    | "status"
    | "approval"
    | "items"
    | "issuances"
    | "archived"
    | "archivedAt"
    | "revision"
    | "approvedRevision"
    | "issuedAssignments"
  >;
  role: Role;
  dirty: boolean;
  busy?: boolean;
};

export function approvedScopeIssued(
  draft: Pick<Draft, "approval" | "issuedAssignments">,
) {
  const selected = draft.approval?.assignments;
  return (
    draft.approval?.status === "APPROVED" &&
    !!selected?.length &&
    selected.every((entry) =>
      draft.issuedAssignments?.some(
        (issued) =>
          issued.rowId === entry.rowId &&
          issued.assignmentId === entry.assignmentId,
      ),
    )
  );
}

/** Presentation eligibility only; every operation keeps its server-side checks. */
export function requestActions({
  draft,
  role,
  dirty,
  busy = false,
}: RequestActionsInput) {
  const archived = !!draft.archived || !!draft.archivedAt;
  const editable =
    draft.status === "DRAFT" &&
    !archived &&
    ["ADMIN", "DIRECTOR", "OPERATOR"].includes(role);
  const approval = draft.approval?.status;
  const alreadyPrepared = approvedScopeIssued(draft);
  const canPrintCurrentPreview =
    approval === "APPROVED" &&
    (draft.approvedRevision === draft.revision ||
      !!draft.approval?.assignments?.length) &&
    !dirty &&
    !archived;
  return {
    editable,
    showValidate: editable,
    showPreview: editable && !alreadyPrepared,
    showSave: editable && dirty,
    showDecision:
      isDirectorRole(role) && approval === "PENDING" && !dirty && !archived,
    showPrepareSigning: editable && approval === "APPROVED" && !alreadyPrepared,
    prepareSigningDisabled:
      busy || !draft.items.length || !canPrintCurrentPreview,
    canPrintCurrentPreview,
    showDocuments:
      canPrintCurrentPreview ||
      draft.status === "FINALIZED" ||
      !!draft.issuances?.length,
  };
}
