import { trainingDirection, type Draft } from "@demo/contracts";

/** One real recipient per form/course/category; group protocols keep all members. */
export function approvalPreviewSamples(draft: Draft) {
  const seen = new Set<string>();
  return draft.items.flatMap((item) =>
    item.assignments.flatMap((assignment) => {
      const key = JSON.stringify([
        assignment.eventId || trainingDirection(assignment.templateId),
        assignment.templateId,
        assignment.biotCategory,
      ]);
      if (seen.has(key)) return [];
      seen.add(key);
      return [
        {
          rowId: item.id,
          assignmentId: assignment.id,
          fullNameRu: item.fullNameRu,
          templateId: assignment.templateId,
        },
      ];
    }),
  );
}
