import { trainingDirection } from "@demo/contracts";
import type { Recipient } from "./types";
import { trainingDirectionLabel } from "./training-display";

/** The same input is printed as a position, profession or awarded qualification. */
export function recipientPositionLabel(item: Pick<Recipient, "assignments">) {
  const directions = new Set(
    item.assignments.map((a) => trainingDirection(a.templateId)),
  );
  if (!directions.has("PS")) return "Должность";
  if (directions.size > 1) return "Должность / профессия / квалификация";
  return item.assignments.some((a) =>
    ["ps-witness", "ps-protocol"].includes(a.templateId),
  )
    ? "Профессия / квалификация"
    : "Профессия";
}

/** One date editor per real training, rather than a repeated editor for each form. */
export function recipientCourses(item: Recipient, resolved: Recipient = item) {
  const seen = new Set<string>();
  return item.assignments.flatMap((assignment, assignmentIndex) => {
    const direction = trainingDirection(assignment.templateId);
    const key = `${direction}:${assignment.eventId || "individual"}`;
    const protocolOnly = assignment.templateId.endsWith("-protocol");
    if (
      seen.has(key) ||
      (protocolOnly &&
        item.assignments.some(
          (entry) =>
            entry.eventId === assignment.eventId &&
            trainingDirection(entry.templateId) === direction &&
            !entry.templateId.endsWith("-protocol"),
        ))
    )
      return [];
    seen.add(key);
    return [
      {
        key,
        label: direction
          ? trainingDirectionLabel(direction)
          : assignment.templateId,
        assignment,
        assignmentIndex,
        protocolOnly,
        resolved:
          resolved.assignments.find((a) => a.id === assignment.id) ||
          assignment,
      },
    ];
  });
}
