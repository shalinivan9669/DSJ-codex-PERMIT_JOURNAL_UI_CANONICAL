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
  >;
  role: Role;
  dirty: boolean;
  busy?: boolean;
};

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
  const canPrintCurrentPreview =
    approval === "APPROVED" &&
    draft.approvedRevision === draft.revision &&
    !dirty &&
    !archived;
  return {
    editable,
    showValidate: editable,
    showPreview: editable,
    showSave: editable && dirty,
    showDecision:
      isDirectorRole(role) && approval === "PENDING" && !dirty && !archived,
    showPrepareSigning: editable && approval === "APPROVED",
    prepareSigningDisabled:
      busy || !draft.items.length || !canPrintCurrentPreview,
    canPrintCurrentPreview,
    showDocuments:
      canPrintCurrentPreview ||
      draft.status === "FINALIZED" ||
      !!draft.issuances?.length,
  };
}
