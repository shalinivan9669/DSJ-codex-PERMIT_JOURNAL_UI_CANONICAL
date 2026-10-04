import {
  trainingDateRuleSchema,
  KZ_TRAINING_CALENDAR_VERSION,
  type TrainingDateRule,
} from "@demo/contracts";
export type CalendarCandidate = {
  hoursPerDay: string;
  productionHoursPerDay: string;
  hoursSource: TrainingDateRule["hoursSource"] | "";
  calendar: TrainingDateRule["calendar"] | "";
  anchor: TrainingDateRule["anchor"] | "";
  protocolDate: TrainingDateRule["protocolDate"] | "";
  source: string;
};
export function calendarCandidate(
  rule?: TrainingDateRule | null,
): CalendarCandidate {
  return {
    hoursPerDay: rule ? String(rule.hoursPerDay) : "",
    productionHoursPerDay: rule?.productionHoursPerDay
      ? String(rule.productionHoursPerDay)
      : "",
    hoursSource: rule?.hoursSource || "THEORY",
    calendar: rule?.calendar || "KZ_FIVE_DAY",
    anchor: rule?.anchor || "DOCUMENT_AFTER_TRAINING",
    protocolDate: rule?.protocolDate || "MANUAL",
    source: rule?.source || "График учебного центра",
  };
}
export function validCalendarCandidate(
  value: unknown,
): value is CalendarCandidate {
  if (!value || typeof value !== "object") return false;
  const row = value as CalendarCandidate;
  return (
    Object.keys(calendarCandidate()).every(
      (key) => typeof row[key as keyof CalendarCandidate] === "string",
    ) &&
    Object.keys(row).every((key) => Object.hasOwn(calendarCandidate(), key)) &&
    ["", "THEORY", "THEORY_AND_PRODUCTION", "SEPARATE_BLOCKS"].includes(
      row.hoursSource,
    ) &&
    ["", "CALENDAR", "WEEKDAYS", "KZ_FIVE_DAY"].includes(row.calendar) &&
    [
      "",
      "DOCUMENT_IS_START",
      "DOCUMENT_IS_END",
      "DOCUMENT_AFTER_TRAINING",
    ].includes(row.anchor) &&
    ["", "MANUAL", "DOCUMENT_DATE", "TRAINING_END"].includes(row.protocolDate)
  );
}
function numeric(value: string) {
  return /^\d+(?:[.,]\d+)?$/.test(value.trim())
    ? Number(value.trim().replace(",", "."))
    : Number.NaN;
}
export function calendarCandidateRule(candidate: CalendarCandidate) {
  return {
    hoursPerDay: numeric(candidate.hoursPerDay),
    hoursSource: candidate.hoursSource,
    ...(candidate.hoursSource === "SEPARATE_BLOCKS"
      ? { productionHoursPerDay: numeric(candidate.productionHoursPerDay) }
      : {}),
    calendar: candidate.calendar,
    ...(candidate.calendar === "KZ_FIVE_DAY"
      ? { calendarVersion: KZ_TRAINING_CALENDAR_VERSION }
      : {}),
    anchor: candidate.anchor,
    protocolDate: candidate.protocolDate,
    source: candidate.source,
  };
}
export function calendarCandidateErrors(candidate: CalendarCandidate) {
  const errors: Partial<Record<keyof CalendarCandidate, string>> = {};
  const parsed = trainingDateRuleSchema.safeParse(
    calendarCandidateRule(candidate),
  );
  if (parsed.success) return errors;
  for (const issue of parsed.error.issues) {
    const key = issue.path[0] as keyof CalendarCandidate;
    errors[key] =
      key === "hoursPerDay" || key === "productionHoursPerDay"
        ? "Введите число больше 0 и не больше 24. Например, 8 или 7,5."
        : key === "source"
          ? "Укажите источник графика: от 3 до 500 символов."
          : "Выберите значение по фактическому графику программы.";
  }
  return errors;
}
