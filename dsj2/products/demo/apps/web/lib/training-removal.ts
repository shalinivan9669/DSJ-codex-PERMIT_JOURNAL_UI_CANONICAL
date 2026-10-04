import {
  courseProgramDefaults,
  hasAutomaticPositiveOutcome,
  positiveAssignmentDefaults,
  trainingDirection,
  type Assignment,
  type TrainingDirection,
} from "@demo/contracts";
import { newAssignment, type Draft } from "./types";
import {
  trainingDirectionLabel,
  trainingDisplayTitle,
} from "./training-display";

export type TrainingRemoval = {
  operationId: string;
  eventIds: string[];
  recipientIds: string[];
  assignments: number;
  titles: string[];
  createdAt: string;
  restored: boolean;
};
export type RemovalTarget = {
  direction: TrainingDirection;
  recipientIds: string[];
  eventIds: string[];
  removeDefault: boolean;
  label: string;
  protected: boolean;
};

function hasRecordedTrainingFacts(assignment: Assignment): boolean {
  const defaults = positiveAssignmentDefaults(assignment.templateId);
  const defaultResult = (key: "result" | "resultKz") =>
    assignment.fieldOrigins?.[key] === "COURSE" &&
    assignment[key] === defaults[key];
  const programOrigin = assignment.fieldOrigins?.trainingSubject;
  const defaultProgram =
    ["COURSE", "AUTO", "INHERITED"].includes(programOrigin || "") &&
    assignment.trainingSubject ===
      courseProgramDefaults(assignment.templateId).trainingSubject;
  return (
    (assignment.outcome?.status !== undefined &&
      assignment.outcome.status !== "UNKNOWN" &&
      !hasAutomaticPositiveOutcome(assignment)) ||
    (!!assignment.result && !defaultResult("result")) ||
    (!!assignment.resultKz && !defaultResult("resultKz")) ||
    !!assignment.resultEn ||
    (!!assignment.trainingSubject && !defaultProgram) ||
    !!assignment.biotKnowledgeResult ||
    !!assignment.biotKnowledgeResultEn ||
    !!assignment.biotProctoringResult ||
    !!assignment.biotProctoringResultEn ||
    !!assignment.biotUniqueNumber ||
    !!assignment.biotNotes ||
    !!assignment.biotNotesEn ||
    !!assignment.externalBasisNumber ||
    !!assignment.retakeOf ||
    !!assignment.trainingDateRule ||
    !!assignment.biotManualFields?.length ||
    Object.values(assignment.fieldOrigins || {}).some((origin) =>
      ["MANUAL", "IMPORTED", "CLEARED"].includes(origin),
    )
  );
}

/** The confirmation names the affected saved facts, never treats an empty selection as an exam record. */
export function trainingRemovalTarget(
  draft: Draft,
  direction: TrainingDirection,
  recipientIds: string[],
  removeDefault: boolean,
  eventIds?: string[],
): RemovalTarget {
  const selected = new Set(recipientIds);
  const assignments = draft.items
    .filter((row) => selected.has(row.id))
    .flatMap((row) =>
      row.assignments.filter(
        (a) =>
          trainingDirection(a.templateId) === direction &&
          (!eventIds || (a.eventId && eventIds.includes(a.eventId))),
      ),
    );
  const ids = eventIds || [
    ...new Set(assignments.flatMap((a) => (a.eventId ? [a.eventId] : []))),
  ];
  const events = (draft.events || []).filter((e) => ids.includes(e.id));
  const protectedAssignment = assignments.some(hasRecordedTrainingFacts);
  const protectedEvent = events.some(
    (e) =>
      (!!e.commonFields.trainingSubject &&
        e.commonFields.fieldOrigins?.trainingSubject !== "COURSE") ||
      !!e.commonFields.trainingDateRule ||
      Object.values(e.commonFields.fieldOrigins || {}).some((origin) =>
        ["MANUAL", "IMPORTED", "CLEARED"].includes(origin),
      ) ||
      Object.values(e.commonFields.dateOrigins || {}).some((origin) =>
        ["MANUAL", "IMPORTED", "CLEARED"].includes(origin),
      ) ||
      ["hours", "productionHours"].some((key) => {
        const primary = assignments.find(
          (a) => a.eventId === e.id && !a.templateId.endsWith("-protocol"),
        );
        const baseline = primary ? newAssignment(primary.templateId) : null;
        return (
          !!e.commonFields[key as "hours"] &&
          e.commonFields[key as "hours"] !== baseline?.[key as "hours"]
        );
      }),
  );
  return {
    direction,
    recipientIds: [
      ...new Set(
        assignments.map(
          (a) =>
            draft.items.find((row) =>
              row.assignments.some((entry) => entry.id === a.id),
            )!.id,
        ),
      ),
    ],
    eventIds: ids,
    removeDefault,
    label:
      events.map((e) => trainingDisplayTitle(e.title)).join(", ") ||
      trainingDirectionLabel(direction),
    protected: protectedAssignment || protectedEvent,
  };
}
