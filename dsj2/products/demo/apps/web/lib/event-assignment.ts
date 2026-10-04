import {
  applyBusinessRules,
  commonFieldKeys,
  hasAutomaticPositiveOutcome,
  courseResultText,
  type Assignment,
  type Draft as DraftInput,
  type RequestItemInput,
} from "@demo/contracts";
import { biotAssignmentDefaults } from "./assignment-presets";

/** Explicitly join one unbound draft assignment; preserve all factual overrides. */
export function joinEventAssignment(
  assignment: Assignment,
  eventId: string,
): Assignment {
  const presets = biotAssignmentDefaults(assignment.templateId);
  return {
    ...assignment,
    eventId,
    protocolMode: "GROUP",
    fieldOrigins: {
      ...assignment.fieldOrigins,
      ...Object.fromEntries(
        commonFieldKeys.map((key) => [
          key,
          assignment.fieldOrigins?.[key] ||
            (assignment[key] && assignment[key] !== presets[key]
              ? "MANUAL"
              : "INHERITED"),
        ]),
      ),
    },
    outcome: assignment.outcome || { status: "UNKNOWN", source: "" },
  };
}

export function eligibleForEvent(assignment: Assignment, templateId: string) {
  return (
    assignment.templateId === templateId &&
    !assignment.eventId &&
    (!assignment.result ||
      (hasAutomaticPositiveOutcome(assignment) &&
        assignment.fieldOrigins?.result === "COURSE" &&
        assignment.result ===
          courseResultText(assignment.templateId, "PASSED"))) &&
    (!assignment.outcome ||
      assignment.outcome.status === "UNKNOWN" ||
      hasAutomaticPositiveOutcome(assignment)) &&
    !assignment.externalBasisNumber &&
    !assignment.retakeOf
  );
}

const ordered = (value: unknown): unknown =>
  Array.isArray(value)
    ? value.map(ordered)
    : value && typeof value === "object"
      ? Object.fromEntries(
          Object.entries(value)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([key, child]) => [key, ordered(child)]),
        )
      : value;

/** Join a generated LIVE kit atomically; never discard an independently edited protocol. */
export function joinEventAssignmentKit(
  draft: DraftInput,
  item: RequestItemInput,
  assignment: Assignment,
  eventId: string,
): Assignment[] | null {
  const expected = applyBusinessRules({
    ...draft,
    items: [{ ...item, assignments: [assignment] }],
  }).items[0].assignments;
  const generatedProtocol = expected.find((a) =>
    a.templateId.endsWith("-protocol"),
  );
  const companion = generatedProtocol
    ? item.assignments.find((a) => a.id === generatedProtocol.id)
    : undefined;
  if (
    companion &&
    (companion.eventId ||
      JSON.stringify(ordered(companion)) !==
        JSON.stringify(ordered(generatedProtocol)))
  )
    return null;
  return item.assignments.map((a) =>
    a.id === assignment.id || a.id === companion?.id
      ? joinEventAssignment(a, eventId)
      : a,
  );
}
