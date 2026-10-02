import { trainingDirection } from "@demo/contracts";
import { updateAssignment } from "./assignment-presets";
import type { Assignment, Recipient } from "./types";

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
  const shared = new Set([
    "documentDate",
    "protocolDate",
    "trainingStart",
    "trainingEnd",
    "trainingSubject",
    "trainingSubjectEn",
    "result",
    "resultEn",
    "outcome",
    "hours",
    "productionHours",
    "reason",
    "reasonEn",
    "education",
    "educationEn",
    "biotCategory",
    "biotCheckType",
    "biotIndustryRu",
    "biotIndustryKz",
    "biotKnowledgeResult",
    "biotProctoringResult",
    "biotUniqueNumber",
    "biotNotes",
    "biotIndustryEn",
    "biotKnowledgeResultEn",
    "biotProctoringResultEn",
    "biotNotesEn",
    "trainingDateRule",
  ]);
  const common = Object.fromEntries(
    Object.entries(values).filter(([key]) => shared.has(key)),
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
