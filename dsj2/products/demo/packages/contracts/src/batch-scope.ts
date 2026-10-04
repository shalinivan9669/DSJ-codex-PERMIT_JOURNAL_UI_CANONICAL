import type { Assignment, Draft, RequestItemInput } from "./index";
import { trainingDirection } from "./business-rules";
import {
  hasAutomaticPositiveOutcome,
  positiveAssignmentDefaults,
} from "./course-defaults";

export type AssignmentIdentity = { rowId: string; assignmentId: string };
export function assignmentIdentityKey(value: AssignmentIdentity): string {
  return JSON.stringify([value.rowId, value.assignmentId]);
}

/** A technical empty row has no person or operator-entered training facts. */
export function isTechnicalBlankRecipient(item: RequestItemInput): boolean {
  const personal = [
    "fullNameRu",
    "fullNameKz",
    "fullNameEn",
    "positionRu",
    "positionKz",
    "positionEn",
    "workplaceRu",
    "workplaceKz",
    "workplaceEn",
    "departmentRu",
    "departmentKz",
    "departmentEn",
    "employerBin",
    "employerAddressRu",
    "employerAddressKz",
    "employerAddressEn",
    "recipientId",
    "externalId",
    "personnelNumber",
    "employerId",
    "employmentPeriod",
  ] as const;
  if (
    item.photoAssetId ||
    item.importId ||
    item.sourceRow !== undefined ||
    personal.some((key) => String(item[key] || "").trim())
  )
    return false;
  return !item.assignments.some((assignment) => {
    if (
      assignment.outcome &&
      !hasAutomaticPositiveOutcome(assignment) &&
      (assignment.outcome.status !== "UNKNOWN" ||
        assignment.outcome.source.trim() ||
        assignment.outcome.confirmedAt ||
        assignment.outcome.confirmedBy)
    )
      return true;
    if (assignment.retakeOf) return true;
    if (
      Object.values(assignment.fieldOrigins || {}).some((origin) =>
        ["MANUAL", "IMPORTED", "CLEARED"].includes(origin),
      )
    )
      return true;
    const facts = [
      "documentDate",
      "protocolDate",
      "trainingStart",
      "trainingEnd",
      "validUntil",
      "reason",
      "reasonEn",
      "education",
      "educationEn",
      "professionRu",
      "professionKz",
      "psQualificationRu",
      "psQualificationKz",
    ];
    if (
      facts.some((field) => {
        const value = (assignment as unknown as Record<string, unknown>)[field];
        const origin = assignment.fieldOrigins?.[field];
        return (
          String(value || "").trim() &&
          !["AUTO", "INHERITED", "COURSE"].includes(origin || "")
        );
      })
    )
      return true;
    // A default bundle may carry a course program, hours and inherited dates.
    // Newly configured course words are automatic; operator input stays protected.
    const defaults = positiveAssignmentDefaults(assignment.templateId);
    if (
      ["result", "resultKz", "resultEn"].some((field) => {
        const value = assignment[field as "result" | "resultKz" | "resultEn"];
        return (
          String(value || "").trim() &&
          !(
            assignment.fieldOrigins?.[field] === "COURSE" &&
            value === defaults[field as "result" | "resultKz"]
          )
        );
      })
    )
      return true;
    return !![
      assignment.externalBasisNumber,
      assignment.biotKnowledgeResult,
      assignment.biotProctoringResult,
      assignment.biotUniqueNumber,
      assignment.biotNotes,
    ].some((value) => String(value || "").trim());
  });
}
export const isTechnicalBlankRow = isTechnicalBlankRecipient;

/** Select actual row/course assignments and include the linked forms of that course. */
export function selectAssignmentScope(
  draft: Draft,
  selected?: AssignmentIdentity[],
  issued: AssignmentIdentity[] = [],
) {
  const issuedKeys = new Set(issued.map(assignmentIdentityKey));
  const available = draft.items
    .filter((item) => !isTechnicalBlankRecipient(item))
    .flatMap((item) =>
      item.assignments.map((assignment) => ({ item, assignment })),
    );
  const requested =
    selected ||
    available
      .filter(
        ({ item, assignment }) =>
          !issuedKeys.has(
            assignmentIdentityKey({
              rowId: item.id,
              assignmentId: assignment.id,
            }),
          ),
      )
      .map(({ item, assignment }) => ({
        rowId: item.id,
        assignmentId: assignment.id,
      }));
  const keys = new Set<string>();
  for (const identity of requested) {
    const match = available.find(
      ({ item, assignment }) =>
        item.id === identity.rowId && assignment.id === identity.assignmentId,
    );
    if (!match) throw new Error("ASSIGNMENT_SELECTION_INVALID");
    if (issuedKeys.has(assignmentIdentityKey(identity)))
      throw new Error("ASSIGNMENT_ALREADY_ISSUED");
    for (const assignment of match.item.assignments) {
      const sameCourse = match.assignment.eventId
        ? assignment.eventId === match.assignment.eventId &&
          trainingDirection(assignment.templateId) ===
            trainingDirection(match.assignment.templateId)
        : !assignment.eventId &&
          trainingDirection(assignment.templateId) ===
            trainingDirection(match.assignment.templateId);
      const key = assignmentIdentityKey({
        rowId: match.item.id,
        assignmentId: assignment.id,
      });
      if (sameCourse && !issuedKeys.has(key)) keys.add(key);
    }
  }
  const items = draft.items.flatMap((item) => {
    const assignments = item.assignments.filter((assignment) =>
      keys.has(
        assignmentIdentityKey({ rowId: item.id, assignmentId: assignment.id }),
      ),
    );
    return assignments.length ||
      (!selected &&
        !item.assignments.length &&
        !isTechnicalBlankRecipient(item))
      ? [{ ...item, assignments }]
      : [];
  });
  const eventIds = new Set(
    items.flatMap((item) =>
      item.assignments.flatMap((assignment) =>
        assignment.eventId ? [assignment.eventId] : [],
      ),
    ),
  );
  const organizationIds = new Set([
    ...(draft.customerId ? [draft.customerId] : []),
    ...items.flatMap((item) => (item.employerId ? [item.employerId] : [])),
  ]);
  const scope: Draft = {
    ...draft,
    items,
    events: draft.events?.filter((event) => eventIds.has(event.id)),
    organizationSnapshots: draft.organizationSnapshots?.filter((value) =>
      organizationIds.has(value.id),
    ),
    trainingDefaults: undefined,
  };
  const assignments = items
    .flatMap((item) =>
      item.assignments.map((assignment) => ({
        rowId: item.id,
        assignmentId: assignment.id,
      })),
    )
    .sort((a, b) =>
      assignmentIdentityKey(a).localeCompare(assignmentIdentityKey(b)),
    );
  return { draft: scope, assignments };
}

/** Ignore list order and unrelated naming when comparing the agreed print scope. */
export function approvalScopeValue(
  draft: Draft,
  assignments: AssignmentIdentity[],
) {
  const scope = selectAssignmentScope(draft, assignments).draft;
  return {
    ...scope,
    title: undefined,
    items: scope.items
      .map((item) => ({
        ...item,
        sourceRow: undefined,
        sourceOrder: undefined,
        assignments: [...item.assignments].sort(
          (a: Assignment, b: Assignment) => a.id.localeCompare(b.id),
        ),
      }))
      .sort((a, b) => a.id.localeCompare(b.id)),
    events: scope.events
      ?.map((event) => ({ ...event, title: undefined }))
      .sort((a, b) => a.id.localeCompare(b.id)),
  };
}
