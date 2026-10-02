import type { Draft, Role } from "./types";

export type RequestActionsInput = {
  draft: Pick<
    Draft,
    "status" | "approval" | "items" | "issuances" | "archived" | "archivedAt"
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
  return {
    editable,
    showValidate: editable,
    showPreview: editable,
    showSave:
      editable &&
      (dirty || (approval !== "PENDING" && approval !== "APPROVED")),
    showDecision:
      role === "DIRECTOR" && approval === "PENDING" && !dirty && !archived,
    showPrepareSigning: editable && approval === "APPROVED",
    prepareSigningDisabled: busy || !draft.items.length || dirty,
    showDocuments:
      (approval === "APPROVED" && !archived) ||
      draft.status === "FINALIZED" ||
      !!draft.issuances?.length,
  };
}
