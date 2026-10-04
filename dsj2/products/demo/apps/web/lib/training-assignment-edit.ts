import { trainingDirection } from "@demo/contracts";
import { updateAssignment } from "./assignment-presets";
import type { Assignment, Recipient } from "./types";

const sharedTrainingFields = new Set([
  "documentDate", "protocolDate", "trainingStart", "trainingEnd",
  "trainingSubject", "trainingSubjectEn", "result", "resultEn", "outcome",
  "hours", "productionHours", "reason", "reasonEn", "education", "educationEn",
  "biotCategory", "biotCheckType", "biotIndustryRu", "biotIndustryKz",
  "biotKnowledgeResult", "biotProctoringResult", "biotUniqueNumber", "biotNotes",
  "biotIndustryEn", "biotKnowledgeResultEn", "biotProctoringResultEn", "biotNotesEn",
  "trainingDateRule",
]);

/** Edit shared training values once, including when a companion form is open. */
export function editTrainingAssignment(
  recipient: Recipient,
  id: string,
  patch: Partial<Assignment>,
  liveRules: boolean,
): Recipient {
  const selected = recipient.assignments.find((entry) => entry.id === id);
  if (!selected) return recipient;
  const values = { ...patch };
  if (
    liveRules &&
    selected.templateId.endsWith("-protocol") &&
    Object.hasOwn(values, "documentDate")
  ) {
    values.protocolDate = values.documentDate;
    delete values.documentDate;
  }
  const common = Object.fromEntries(
    Object.entries(values).filter(([key]) => sharedTrainingFields.has(key)),
  ) as Partial<Assignment>;
  return {
    ...recipient,
    assignments: recipient.assignments.map((entry) => {
      if (entry.id === id) return updateAssignment(entry, values);
      if (
        !liveRules ||
        entry.eventId !== selected.eventId ||
        trainingDirection(entry.templateId) !==
          trainingDirection(selected.templateId)
      )
        return entry;
      const relevant = { ...common };
      if (entry.templateId.endsWith("-protocol")) delete relevant.documentDate;
      return updateAssignment(entry, relevant);
    }),
  };
}

/** Returning a shared value has the same meaning from any form in the kit. */
export function restoreTrainingAssignmentField(
  recipient: Recipient,
  id: string,
  key: string,
  liveRules: boolean,
): Recipient {
  const selected = recipient.assignments.find((entry) => entry.id === id);
  if (!selected) return recipient;
  const field =
    liveRules &&
    selected.templateId.endsWith("-protocol") &&
    key === "documentDate"
      ? "protocolDate"
      : key;
  const dates = new Set([
    "documentDate",
    "protocolDate",
    "trainingStart",
    "trainingEnd",
    "validUntil",
  ]);
  return {
    ...recipient,
    assignments: recipient.assignments.map((entry) => {
      const linked =
        liveRules &&
        sharedTrainingFields.has(field) &&
        entry.eventId === selected.eventId &&
        trainingDirection(entry.templateId) ===
          trainingDirection(selected.templateId);
      if (entry.id !== id && !linked) return entry;
      if (field === "validUntil" && entry.id !== id) return entry;
      const next = {
        ...entry,
        fieldOrigins: {
          ...entry.fieldOrigins,
          [field]:
            field === "validUntil" ? ("AUTO" as const) : ("INHERITED" as const),
        },
      };
      if (dates.has(field))
        (next as unknown as Record<string, unknown>)[field] = "";
      next.biotManualFields = entry.biotManualFields?.filter(
        (manual) => manual !== field,
      );
      if (field === "protocolDate" && entry.templateId.endsWith("-protocol")) {
        next.documentDate = "";
        next.fieldOrigins.documentDate = "INHERITED";
      }
      return next;
    }),
  };
}
