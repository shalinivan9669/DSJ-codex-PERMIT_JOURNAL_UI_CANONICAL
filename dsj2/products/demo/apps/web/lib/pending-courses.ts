import { trainingDirection, isTechnicalBlankRow } from "@demo/contracts";
import { documentTitle, type Draft } from "./types";

/** Stable row/event identities keep selection correct across autosave and sorting. */
export function pendingCourses(draft: Draft) {
  const issued = new Set(
    (draft.issuedAssignments || []).map(
      (entry) => entry.rowId + ":" + entry.assignmentId,
    ),
  );
  return draft.items
    .filter((row) => !isTechnicalBlankRow(row))
    .flatMap((row) => {
      const groups = new Map<string, typeof row.assignments>();
      for (const assignment of row.assignments) {
        const key =
          assignment.eventId || trainingDirection(assignment.templateId);
        groups.set(key, [...(groups.get(key) || []), assignment]);
      }
      return [...groups.entries()].map(([key, assignments]) => ({
        key: row.id + ":" + key,
        row,
        assignments,
        course:
          draft.events?.find((event) => event.id === key)?.title ||
          documentTitle(assignments[0].templateId).replace(/ — .*/, ""),
        issued: assignments.every((assignment) =>
          issued.has(row.id + ":" + assignment.id),
        ),
        passed: assignments.every(
          (assignment) => assignment.outcome?.status === "PASSED",
        ),
        failed: assignments.some((assignment) =>
          ["FAILED", "ABSENT"].includes(assignment.outcome?.status || ""),
        ),
      }));
    });
}
