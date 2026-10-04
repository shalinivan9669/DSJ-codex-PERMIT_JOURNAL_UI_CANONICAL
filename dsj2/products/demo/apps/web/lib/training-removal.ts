import { trainingDirection, type TrainingDirection } from "@demo/contracts";
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
  const protectedAssignment = assignments.some(
    (a) =>
      (a.outcome?.status !== undefined && a.outcome.status !== "UNKNOWN") ||
      !!a.result ||
      (!!a.trainingSubject && a.fieldOrigins?.trainingSubject !== "COURSE") ||
      !!a.trainingDateRule ||
      Object.values(a.fieldOrigins || {}).some((origin) =>
        ["MANUAL", "IMPORTED", "CLEARED"].includes(origin),
      ),
  );
  const protectedEvent = events.some(
    (e) =>
      (!!e.commonFields.trainingSubject &&
        e.commonFields.fieldOrigins?.trainingSubject !== "COURSE") ||
      !!e.commonFields.trainingDateRule ||
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
