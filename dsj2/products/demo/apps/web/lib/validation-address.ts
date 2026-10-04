import type { Recipient, Validation } from "./types";

export type AddressedIssue = Exclude<Validation["errors"][number], string> & {
  recipientId?: string;
  rowId?: string;
  assignmentId?: string;
  eventId?: string;
  field?: string;
};

/** Stable identities win over indices emitted for temporary validation arrays. */
export function addressIssue(
  issue: Validation["errors"][number],
  items: readonly Recipient[],
  events: readonly { id: string }[] = [],
): Validation["errors"][number] {
  if (typeof issue === "string") return issue;
  const value = issue as AddressedIssue;
  let path = Array.isArray(value.path)
    ? value.path.join(".")
    : value.path || "";
  const identity = value.recipientId || value.rowId || value.itemId;
  if (identity) {
    const row = items.findIndex((item) => item.id === identity);
    if (row < 0) return { ...value, path: "", message: value.message };
    path = path.replace(/^items\.\d+/, `items.${row}`);
    if (value.assignmentId) {
      const assignment = items[row].assignments.findIndex(
        (a) => a.id === value.assignmentId,
      );
      if (assignment < 0) return { ...value, path: "" };
      path = path.replace(/\.assignments\.\d+/, `.assignments.${assignment}`);
    }
  } else if (value.eventId && /^events\./.test(path)) {
    const event = events.findIndex(
      (candidate) => candidate.id === value.eventId,
    );
    path = event < 0 ? "" : path.replace(/^events\.\d+/, `events.${event}`);
  }
  return { ...value, path };
}
