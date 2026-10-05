import {
  documentPlan,
  trainingDirection,
  stableValidationIssue,
  type Draft,
  type PreviewTarget,
  type ValidationIssue,
} from "@demo/contracts";
import { fail } from "./core";

/** Select identities only from the authorized source, retaining course dependencies. */
export function previewScope(source: Draft, target: PreviewTarget): Draft {
  let items: Draft["items"];
  if (target.kind === "ASSIGNMENT") {
    const item = source.items.find((row) => row.id === target.rowId);
    const assignment = item?.assignments.find(
      (entry) => entry.id === target.assignmentId,
    );
    if (!item || !assignment)
      fail(
        404,
        "PREVIEW_TARGET_NOT_FOUND",
        "Документ отсутствует в выбранной редакции заявки",
      );
    items = [
      {
        ...item,
        assignments: item.assignments.filter(
          (entry) =>
            entry.eventId === assignment.eventId &&
            trainingDirection(entry.templateId) ===
              trainingDirection(assignment.templateId),
        ),
      },
    ];
  } else {
    const group = documentPlan(source).groups.find(
      (entry) => entry.event.id === target.eventId,
    );
    if (!group)
      fail(
        404,
        "PREVIEW_TARGET_NOT_FOUND",
        "Общий протокол отсутствует в выбранной редакции заявки",
      );
    const rowIds = new Set(group.members.map(({ item }) => item.id));
    items = source.items
      .filter((item) => rowIds.has(item.id))
      .map((item) => ({
        ...item,
        assignments: item.assignments.filter(
          (entry) => entry.eventId === target.eventId,
        ),
      }));
  }
  const eventIds = new Set(
    items.flatMap((item) =>
      item.assignments.flatMap((entry) =>
        entry.eventId ? [entry.eventId] : [],
      ),
    ),
  );
  return {
    ...source,
    items,
    events: source.events?.filter((event) => eventIds.has(event.id)),
    ...(source.frozenResolution
      ? {
          frozenResolution: {
            ...source.frozenResolution,
            draft: previewScope(source.frozenResolution.draft, target),
          },
        }
      : {}),
  };
}

export function previewIssueApplies(
  draft: Draft,
  target: PreviewTarget,
  issue: ValidationIssue,
) {
  const addressed = stableValidationIssue(draft, issue);
  if (target.kind === "ASSIGNMENT") {
    if (addressed.rowId && addressed.rowId !== target.rowId) return false;
    if (
      addressed.assignmentId &&
      addressed.assignmentId !== target.assignmentId
    )
      return false;
    // The selected event's issuer is printed on personal forms too. Keep its
    // validation while excluding fields belonging only to the group protocol.
    const eventId = draft.items
      .find((item) => item.id === target.rowId)
      ?.assignments.find(
        (assignment) => assignment.id === target.assignmentId,
      )?.eventId;
    const profilePath = eventId ? `events.${eventId}.profile` : null;
    if (
      profilePath &&
      (addressed.path === profilePath ||
        addressed.path.startsWith(`${profilePath}.`))
    )
      return true;
    return !addressed.path.startsWith("events.") && addressed.path !== "events";
  }
  return (
    !addressed.assignmentId ||
    addressed.assignmentId === target.eventId ||
    [
      "OUTCOME_UNCONFIRMED",
      "OUTCOME_SOURCE_REQUIRED",
      "OUTCOME_REQUIRED",
      "TRAINING_OUTCOME_CONFLICT",
    ].includes(addressed.code)
  );
}
