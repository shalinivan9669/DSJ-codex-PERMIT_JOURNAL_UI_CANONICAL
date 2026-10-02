import { editTrainingAssignment } from "./training-assignment-edit";
import type { Recipient } from "./types";

/** A row shows an issue date only when all personal forms agree. */
export function recipientRowDate(item: Recipient, resolved: Recipient = item) {
  if (
    !item.assignments.some((entry) => !entry.templateId.endsWith("-protocol"))
  )
    return { kind: "none" as const, value: "" };
  const dates = new Set(
    resolved.assignments
      .filter((entry) => !entry.templateId.endsWith("-protocol"))
      .map((entry) => entry.documentDate || ""),
  );
  if (dates.size > 1) return { kind: "mixed" as const, value: "" };
  return { kind: "single" as const, value: [...dates][0] || "" };
}

/** The row explicitly changes one shared personal date; mixed dates stay in details. */
export function editRecipientRowDate(
  item: Recipient,
  resolved: Recipient,
  documentDate: string,
  liveRules = true,
): Recipient {
  if (recipientRowDate(item, resolved).kind !== "single") return item;
  return item.assignments
    .filter((entry) => !entry.templateId.endsWith("-protocol"))
    .reduce(
      (next, assignment) =>
        editTrainingAssignment(
          next,
          assignment.id,
          { documentDate },
          liveRules,
        ),
      item,
    );
}
