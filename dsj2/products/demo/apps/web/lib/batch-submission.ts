import {
  assignmentIdentityKey,
  LIMITS,
  type AssignmentIdentity,
} from "@demo/contracts";
import { pendingCourses } from "./pending-courses";
import { draftPayload, type Draft } from "./types";

function chosenCourses(draft: Draft, selected: string[] | null) {
  const keys = selected === null ? null : new Set(selected);
  return pendingCourses(draft).filter(
    (course) =>
      !course.issued && course.passed && (!keys || keys.has(course.key)),
  );
}

/** Preserve the selected people/courses and exclude forms already issued. */
export function batchAssignments(
  draft: Draft,
  selected: string[] | null,
): AssignmentIdentity[] {
  const issued = new Set(
    (draft.issuedAssignments || []).map(assignmentIdentityKey),
  );
  const assignments = new Map<string, AssignmentIdentity>();
  for (const course of chosenCourses(draft, selected)) {
    for (const assignment of course.assignments) {
      const identity = { rowId: course.row.id, assignmentId: assignment.id };
      const key = assignmentIdentityKey(identity);
      if (!issued.has(key)) assignments.set(key, identity);
    }
  }
  return [...assignments.values()];
}

/** Feedback belongs to input and selection, not to autosave/polling metadata. */
export function batchFeedbackKey(
  draft: Draft,
  selected: string[] | null,
): string {
  return JSON.stringify({
    requestId: draft.id,
    draft: draftPayload(draft),
    issuedAssignments: [
      ...new Set((draft.issuedAssignments || []).map(assignmentIdentityKey)),
    ].sort(),
    chosen: [
      ...new Set(chosenCourses(draft, selected).map((course) => course.key)),
    ].sort(),
  });
}

/** Server-controlled approval status establishes freshness; scope must match exactly. */
export function matchingBatchApproval(
  draft: Draft,
  assignments: AssignmentIdentity[],
): boolean {
  const approval = draft.approval;
  if (
    !assignments.length ||
    !approval ||
    approval.needsPreparation ||
    !["PENDING", "APPROVED"].includes(approval.status) ||
    !approval.assignments?.length
  )
    return false;
  const selected = [...new Set(assignments.map(assignmentIdentityKey))].sort();
  const approved = [
    ...new Set(approval.assignments.map(assignmentIdentityKey)),
  ].sort();
  return (
    selected.length === approved.length &&
    selected.every((key, index) => key === approved[index])
  );
}

/** Invalid storage restores automatic selection; an explicit empty selection stays empty. */
export function parseBatchSelection(raw: string | null): string[] | null {
  // Each key joins a row ID and event ID (at most 80 characters each).
  const keyLimit = 161;
  if (raw === null || raw.length > LIMITS.documents * (keyLimit * 6 + 3) + 2)
    return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed === null) return null;
    if (
      !Array.isArray(parsed) ||
      parsed.length > LIMITS.documents ||
      parsed.some(
        (key) =>
          typeof key !== "string" || !key.trim() || key.length > keyLimit,
      )
    )
      return null;
    return [...new Set(parsed as string[])];
  } catch {
    return null;
  }
}
