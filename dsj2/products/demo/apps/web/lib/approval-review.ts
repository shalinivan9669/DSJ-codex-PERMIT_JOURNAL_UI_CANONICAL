import {
  trainingDirection,
  hasAutomaticPositiveOutcome,
  type Draft,
  type FieldSource,
  type ValidationIssue,
} from "@demo/contracts";

export type ApprovalReview = {
  draft: Draft;
  provenance: Record<string, Record<string, FieldSource>>;
  issues: ValidationIssue[];
};
export const reviewSourceLabels: Record<string, string> = {
  COURSE: "Стандарт курса",
  CENTER: "Профиль центра",
  PRESET: "Настройка",
  REQUEST: "Общие данные заявки",
  EVENT: "Общие данные обучения",
  MANUAL: "Введено вручную",
  IMPORTED: "Из импорта",
  AUTO: "Автоматически",
  CLEARED: "Явно очищено",
  INHERITED: "Общие данные",
};

/** Summarize exactly the server-resolved submitted scope, not the live editor. */
export function approvalReviewSummary(
  review: ApprovalReview,
  submitted = review.draft,
) {
  const employers = new Set(
    submitted.items.map((row) => row.employerId).filter(Boolean),
  );
  const groups = new Map<
    string,
    {
      id: string;
      title: string;
      people: Set<string>;
      documents: Set<string>;
      documentDates: Set<string>;
      protocolDates: Set<string>;
      periods: Set<string>;
      hours: Set<string>;
      results: Set<string>;
      sources: Set<string>;
      exceptions: Set<string>;
    }
  >();
  const exceptions = new Set<string>();
  for (const row of review.draft.items)
    for (const assignment of row.assignments) {
      const direction = trainingDirection(assignment.templateId);
      const key = assignment.eventId || direction;
      const event = review.draft.events?.find(
        (entry) => entry.id === assignment.eventId,
      );
      const group = groups.get(key) || {
        id: key,
        title:
          event?.title ||
          { BIOT: "БиОТ", PTM: "ПТМ", PB: "ПБ", PS: "ПС" }[direction],
        people: new Set<string>(),
        documents: new Set<string>(),
        documentDates: new Set<string>(),
        protocolDates: new Set<string>(),
        periods: new Set<string>(),
        hours: new Set<string>(),
        results: new Set<string>(),
        sources: new Set<string>(),
        exceptions: new Set<string>(),
      };
      group.people.add(row.id);
      group.documents.add(assignment.templateId);
      group.documentDates.add(assignment.documentDate || "Не задана");
      group.protocolDates.add(assignment.protocolDate || "Не задана");
      group.periods.add(
        assignment.trainingStart && assignment.trainingEnd
          ? `${assignment.trainingStart} — ${assignment.trainingEnd}`
          : "Не задан",
      );
      group.hours.add(
        [assignment.hours, assignment.productionHours]
          .filter(Boolean)
          .join(" / ") || "Не заданы",
      );
      group.results.add(
        assignment.result ||
          {
            PASSED: "Сдал",
            FAILED: "Не сдал",
            ABSENT: "Не явился",
            UNKNOWN: "Ожидает сдачи",
          }[assignment.outcome?.status || "UNKNOWN"],
      );
      for (const source of Object.values(
        review.provenance[`${row.id}:${assignment.id}`] || {},
      ))
        group.sources.add(reviewSourceLabels[source] || source);
      if (
        assignment.outcome?.source &&
        !hasAutomaticPositiveOutcome(assignment)
      )
        group.sources.add(assignment.outcome.source);
      const rawRow = submitted.items.find((entry) => entry.id === row.id);
      const rawAssignment = rawRow?.assignments.find(
        (entry) => entry.id === assignment.id,
      );
      if (
        (assignment.outcome?.status &&
          assignment.outcome.status !== "PASSED") ||
        Object.values(rawAssignment?.fieldOrigins || {}).some((origin) =>
          ["MANUAL", "IMPORTED", "CLEARED"].includes(origin),
        ) ||
        !!rawAssignment?.biotManualFields?.length ||
        (rawRow?.employerId &&
          (submitted.kind === "COMPANY"
            ? rawRow.employerId !== submitted.customerId
            : employers.size > 1))
      ) {
        exceptions.add(row.id);
        group.exceptions.add(row.id);
      }
      groups.set(key, group);
    }
  return {
    people: review.draft.items.length,
    courses: [...groups.values()],
    exceptions: exceptions.size,
  };
}
