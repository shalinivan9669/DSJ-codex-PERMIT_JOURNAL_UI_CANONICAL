import { applyBusinessRules, draftSchema, type Draft } from "@demo/contracts";
import { fail, hash } from "./core";

type RestoreProposal = {
  tenantId: string;
  requestId: string;
  revision: number;
  operation: string;
  status: string;
  before: unknown;
  payload: unknown;
};

function conflict(): never {
  return fail(
    409,
    "RECIPIENT_RESTORE_CONFLICT",
    "Получателя можно восстановить только сразу после его удаления, без других изменений. Обновите заявку и проверьте её текущую версию.",
  );
}

/** Browser confirmation actor/time are never evidence, even in an undo command. */
function withoutConfirmationMetadata(draft: Draft): Draft {
  const value = structuredClone(draft);
  for (const row of value.items)
    for (const assignment of row.assignments)
      if (assignment.outcome) {
        delete assignment.outcome.confirmedBy;
        delete assignment.outcome.confirmedAt;
      }
  return value;
}

/** Only the current row or the immutable snapshot of this exact deletion is trusted. */
export function recipientRestoreBaseline(input: {
  tenantId: string;
  requestId: string;
  revision: number;
  rowId: string;
  current: Draft;
  incoming: Draft;
  proposal: RestoreProposal | null;
}): Draft {
  const { current, incoming, rowId, proposal } = input;
  if (current.items.some((row) => row.id === rowId)) {
    // An uncommitted removal (or a harmless repeated restore) already has a
    // trusted row. This branch cannot roll back any other current business fact.
    if (
      hash(withoutConfirmationMetadata(incoming)) !==
      hash(withoutConfirmationMetadata(current))
    )
      conflict();
    return current;
  }
  if (
    !proposal ||
    proposal.tenantId !== input.tenantId ||
    proposal.requestId !== input.requestId ||
    proposal.revision !== input.revision ||
    proposal.operation !== "SAVE" ||
    proposal.status !== "DRAFT"
  )
    conflict();
  const source = draftSchema.safeParse(proposal.before);
  const saved = draftSchema.safeParse(proposal.payload);
  if (!source.success || !saved.success || hash(saved.data) !== hash(current))
    conflict();
  const before = source.data;
  if (!before.items.some((row) => row.id === rowId)) conflict();

  // A deletion can remove an unused derived event or switch an AUTO protocol
  // from GROUP to INDIVIDUAL. Only those existing rules may change its context.
  const removed = applyBusinessRules({
    ...structuredClone(before),
    items: before.items.filter((row) => row.id !== rowId),
  });
  const employerIds = new Set([
    ...(removed.customerId ? [removed.customerId] : []),
    ...removed.items.flatMap((row) => (row.employerId ? [row.employerId] : [])),
  ]);
  removed.organizationSnapshots = (before.organizationSnapshots || []).filter(
    (organization) => employerIds.has(organization.id),
  );
  if (
    hash(removed) !== hash(current) ||
    hash(withoutConfirmationMetadata(incoming)) !==
      hash(withoutConfirmationMetadata(before))
  )
    conflict();
  // The regular outcome guard copies actor/time from here, never from incoming.
  // Reference, issued-assignment and approval guards still run on the normal save.
  return before;
}
