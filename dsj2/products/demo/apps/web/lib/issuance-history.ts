export function issuanceHistoryActions({
  canManage,
  readonly,
  status,
  issuanceIds,
}: {
  canManage: boolean;
  readonly: boolean;
  status: string;
  issuanceIds: string[];
}) {
  return {
    correct: canManage && issuanceIds.length > 0,
    cancel:
      canManage && readonly && status !== "DRAFT" && status !== "CANCELLED",
  };
}

/** A correction must name the exact frozen source; cancellation keeps its existing contract. */
export function issuanceHistoryPayload(
  action: "correct" | "cancel",
  reason: string,
  expectedRevision: number,
  issuanceId: string,
  issuanceIds: string[],
) {
  if (action === "correct" && !issuanceIds.includes(issuanceId))
    return undefined;
  return {
    reason,
    expectedRevision,
    ...(action === "correct" ? { issuanceId } : {}),
  };
}
