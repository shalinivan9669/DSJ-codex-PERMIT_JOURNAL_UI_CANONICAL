import type { Draft } from "./types";

export type RejectionDetail = {
  id: string;
  requestId: string;
  proposalHash: string;
  status: string;
  decision?: { decision: string; comment: string } | null;
};

/** An async result belongs only to the same currently returned proposal. */
export function rejectionReason(
  draft: Pick<Draft, "id" | "approval">,
  detail: RejectionDetail | null,
): string | null {
  if (
    draft.approval?.status !== "REJECTED" ||
    !detail ||
    detail.requestId !== draft.id ||
    detail.id !== draft.approval.proposalId ||
    detail.proposalHash !== draft.approval.proposalHash ||
    detail.status !== "REJECTED" ||
    detail.decision?.decision !== "REJECT"
  )
    return null;
  return detail.decision.comment.trim() || null;
}
