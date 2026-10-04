import type { Assignment, Draft } from "./types";
import {
  courseResultText,
  isProtectedField,
  nonPassedResultKz,
  factualAssessmentText,
} from "@demo/contracts";

export type EventOutcomeInput = {
  status: NonNullable<Assignment["outcome"]>["status"];
  source: string;
  knowledge?: string;
  proctoring?: string;
};

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
  if (!event || (input.status !== "UNKNOWN" && !input.source.trim()))
    throw new Error(
      "Выберите известный результат и укажите источник подтверждения.",
    );
  const selected = new Set(recipientIds);
  return draft.items.map((item) =>
    !selected.has(item.id)
      ? item
      : {
          ...item,
          assignments: item.assignments.map((assignment) =>
            assignment.eventId !== eventId
              ? assignment
              : {
                  ...assignment,
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
                  result:
                    input.status === "PASSED" &&
                    assignment.result.trim() &&
                    (isProtectedField(assignment.fieldOrigins?.result) ||
                      !assignment.fieldOrigins?.result)
                      ? assignment.result
                      : input.status !== "PASSED" &&
                          factualAssessmentText(
                            assignment.result,
                            assignment.fieldOrigins?.result,
                          )
                        ? assignment.result
                        : courseResultText(assignment.templateId, input.status),
                  ...(input.status !== "PASSED"
                    ? {
                        resultKz:
                          factualAssessmentText(
                            assignment.resultKz,
                            assignment.fieldOrigins?.resultKz,
                          ) || nonPassedResultKz(input.status),
                        resultEn: "",
                      }
                    : {}),
                  fieldOrigins: {
                    ...assignment.fieldOrigins,
                        outcome: "MANUAL" as const,
                    result:
                      input.status === "PASSED" &&
                      assignment.result.trim() &&
                      (isProtectedField(assignment.fieldOrigins?.result) ||
                        !assignment.fieldOrigins?.result)
                        ? assignment.fieldOrigins?.result || "MANUAL"
                        : input.status !== "PASSED" &&
                            factualAssessmentText(
                              assignment.result,
                              assignment.fieldOrigins?.result,
                            )
                          ? assignment.fieldOrigins?.result || "MANUAL"
                          : "COURSE",
                  },
                  outcome: {
                    status: input.status,
                    source:
                      input.status === "UNKNOWN" ? "" : input.source.trim(),
                  },
                },
          ),
        },
  );
}
