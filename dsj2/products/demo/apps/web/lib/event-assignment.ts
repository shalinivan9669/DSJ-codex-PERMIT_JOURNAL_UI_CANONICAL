import { commonFieldKeys, type Assignment } from "@demo/contracts";
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
    fieldOrigins: Object.fromEntries(
      commonFieldKeys.map((key) => [
        key,
        assignment.fieldOrigins?.[key] ||
          (assignment[key] && assignment[key] !== presets[key]
            ? "MANUAL"
            : "INHERITED"),
      ]),
    ),
    outcome: assignment.outcome || { status: "UNKNOWN", source: "" },
  };
}

export function eligibleForEvent(assignment: Assignment, templateId: string) {
  return (
    assignment.templateId === templateId &&
    !assignment.eventId &&
    !assignment.result &&
    (!assignment.outcome || assignment.outcome.status === "UNKNOWN") &&
    !assignment.externalBasisNumber &&
    !assignment.retakeOf
  );
}
