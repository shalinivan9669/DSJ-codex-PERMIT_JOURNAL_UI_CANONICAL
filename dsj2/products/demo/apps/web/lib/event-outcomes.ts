import type { Assignment, Draft } from "./types";
import {
  courseResultText,
  isProtectedField,
  nonPassedResultKz,
  positiveResultKz,
  factualAssessmentText,
} from "@demo/contracts";

export type EventOutcomeInput = {
  status: NonNullable<Assignment["outcome"]>["status"];
  source: string;
  knowledge?: string;
  proctoring?: string;
};

function outcomeWording(assignment: Assignment, input: EventOutcomeInput) {
  const next = {
    result: assignment.result,
    resultKz: assignment.resultKz,
    resultEn: assignment.resultEn,
    fieldOrigins: { ...assignment.fieldOrigins },
  };
  for (const [key, fallback] of [
    ["result", courseResultText(assignment.templateId, input.status)],
    [
      "resultKz",
      input.status === "PASSED"
        ? positiveResultKz(assignment.templateId)
        : nonPassedResultKz(input.status),
    ],
  ] as const) {
    const origin = assignment.fieldOrigins?.[key];
    if (
      origin === "CLEARED" ||
      (isProtectedField(origin) && !assignment[key]?.trim())
    ) {
      next[key] = "";
      continue;
    }
    const preserve =
      input.status === "PASSED"
        ? assignment[key]?.trim() && (isProtectedField(origin) || !origin)
        : factualAssessmentText(assignment[key], origin);
    if (preserve) next.fieldOrigins[key] = origin || "MANUAL";
    else {
      next[key] = fallback;
      next.fieldOrigins[key] = "COURSE";
    }
  }
  if (
    input.status !== "PASSED" &&
    !isProtectedField(assignment.fieldOrigins?.resultEn)
  )
    next.resultEn = "";
  return next;
}

/** An omitted selection explicitly means every participant of this event. */
export function eventOutcomeRecipients(
  draft: Pick<Draft, "items">,
  eventId: string,
  selectedIds?: readonly string[],
) {
  const selected = selectedIds ? new Set(selectedIds) : undefined;
  return draft.items.filter(
    (item) =>
      (!selected || selected.has(item.id)) &&
      item.assignments.some((assignment) => assignment.eventId === eventId),
  );
}

/** Confirm only the reviewed people and event; an empty input never clears an individual result. */
export function applyEventOutcomes(
  draft: Pick<Draft, "items" | "events">,
  eventId: string,
  recipientIds: readonly string[],
  input: EventOutcomeInput,
) {
  const event = draft.events?.find((row) => row.id === eventId);
  if (!event) throw new Error("Обучение не найдено. Обновите заявку.");
  const source =
    input.source.trim() || "Результат указан оператором для выбранного состава";
  const selected = new Set(recipientIds);
  return draft.items.map((item) =>
    !selected.has(item.id)
      ? item
      : {
          ...item,
          assignments: item.assignments.map((assignment) => {
            if (assignment.eventId !== eventId) return assignment;
            const wording = outcomeWording(assignment, input);
            return {
              ...assignment,
              ...wording,
              ...(event.protocolTemplateId === "biot-itr-protocol"
                ? {
                    ...(input.knowledge?.trim()
                      ? { biotKnowledgeResult: input.knowledge.trim() }
                      : {}),
                    ...(input.proctoring?.trim()
                      ? { biotProctoringResult: input.proctoring.trim() }
                      : {}),
                  }
                : {}),
              fieldOrigins: {
                ...wording.fieldOrigins,
                outcome: "MANUAL" as const,
                ...(event.protocolTemplateId === "biot-itr-protocol"
                  ? {
                      ...(input.knowledge?.trim()
                        ? { biotKnowledgeResult: "MANUAL" as const }
                        : {}),
                      ...(input.proctoring?.trim()
                        ? { biotProctoringResult: "MANUAL" as const }
                        : {}),
                    }
                  : {}),
              },
              outcome: {
                status: input.status,
                source: input.status === "UNKNOWN" ? "" : source,
              },
            };
          }),
        },
  );
}
