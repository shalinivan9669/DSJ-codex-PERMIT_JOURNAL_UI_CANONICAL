import { itemSchema } from "@demo/contracts";
import { type Recipient } from "./types";

export type StoredRecipient = {
  id: string;
  data: Recipient;
  archived?: boolean;
};

/** Reuse personal data, including legacy rows missing optional editor fields. */
export function reuseRecipient(record: StoredRecipient): Recipient {
  const {
    assignments: _oldAssignments,
    importId: _importId,
    sourceRow: _sourceRow,
    ...person
  } = record.data;
  // The current item contract supplies missing text fields without changing
  // existing values. Keep other stored personal metadata; training facts belong
  // to the old request and must never become defaults for the new request.
  return itemSchema.passthrough().parse({
    ...person,
    id: crypto.randomUUID(),
    recipientId: record.id,
    assignments: [],
  });
}
