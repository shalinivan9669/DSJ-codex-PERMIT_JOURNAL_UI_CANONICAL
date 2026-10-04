import type { Assignment, TrainingEventInput } from "@demo/contracts";

/** Attempt evidence belongs to the issued source, never to its retake. */
const attemptFields = [
  "result",
  "resultKz",
  "resultEn",
  "biotKnowledgeResult",
  "biotKnowledgeResultEn",
  "biotProctoringResult",
  "biotProctoringResultEn",
  "biotUniqueNumber",
  "biotNotes",
  "biotNotesEn",
  "externalBasisNumber",
  "documentDate",
  "protocolDate",
  "trainingStart",
  "trainingEnd",
  "validUntil",
] as const;
const attemptKeys = new Set<string>([
  ...attemptFields,
  "outcome",
  "outcome.source",
  "biotCheckType",
]);

export function resetRetakeAttempt(source: Assignment): Assignment {
  const assignment = structuredClone(source);
  assignment.outcome = { status: "UNKNOWN", source: "" };
  for (const key of attemptFields) assignment[key] = "";
  // Keep provenance for the retained course and individual exceptions only.
  assignment.fieldOrigins = Object.fromEntries(
    Object.entries(assignment.fieldOrigins || {}).filter(
      ([key]) => !attemptKeys.has(key),
    ),
  );
  assignment.biotManualFields = assignment.biotManualFields?.filter(
    (key) => key !== "validUntil",
  );
  if (assignment.templateId.startsWith("biot-"))
    assignment.biotCheckType = "REPEAT";
  return assignment;
}

export function resetRetakeEvent(
  source: TrainingEventInput,
): TrainingEventInput {
  const event = structuredClone(source);
  for (const key of attemptFields)
    delete (event.commonFields as Record<string, unknown>)[key];
  event.commonFields.fieldOrigins = Object.fromEntries(
    Object.entries(event.commonFields.fieldOrigins || {}).filter(
      ([key]) => !attemptKeys.has(key),
    ),
  );
  // Dates are newly calculated only after a new attempt date is chosen.
  delete event.commonFields.dateOrigins;
  delete event.rootEventId;
  delete event.lineageContext;
  delete event.lineageOwnContext;
  return event;
}
