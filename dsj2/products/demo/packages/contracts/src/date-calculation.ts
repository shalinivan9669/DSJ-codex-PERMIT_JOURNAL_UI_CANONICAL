import { z } from "zod";
import { biotValidUntil, type BiotCategory } from "./biot";

export const calculatedDateKeys = [
  "trainingStart",
  "trainingEnd",
  "protocolDate",
  "validUntil",
] as const;
export type CalculatedDateKey = (typeof calculatedDateKeys)[number];
export const dateOriginSchema = z.enum([
  "AUTO",
  "MANUAL",
  "IMPORTED",
  "CLEARED",
]);
export const dateOriginsSchema = z.partialRecord(
  z.enum(calculatedDateKeys),
  dateOriginSchema,
);

/** A schedule must be supplied explicitly: BIOT sources specify hours and
 * validity, but do not establish a universal conversion of hours into days. */
export const trainingDateRuleSchema = z
  .object({
    hoursPerDay: z.number().positive().max(24),
    hoursSource: z.enum(["THEORY", "THEORY_AND_PRODUCTION"]),
    calendar: z.enum(["CALENDAR", "WEEKDAYS"]),
    anchor: z.enum(["DOCUMENT_IS_START", "DOCUMENT_IS_END"]),
    protocolDate: z.enum(["MANUAL", "DOCUMENT_DATE", "TRAINING_END"]),
    source: z.string().trim().min(3).max(500),
  })
  .strict();
export type TrainingDateRule = z.infer<typeof trainingDateRuleSchema>;
export type DateOrigins = z.infer<typeof dateOriginsSchema>;
export type DateValues = Partial<
  Record<
    "documentDate" | "hours" | "productionHours" | CalculatedDateKey,
    string
  >
> & {
  biotCategory?: BiotCategory;
};

function calendarDate(value?: string): Date | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T12:00:00Z`);
  return Number.isNaN(date.getTime()) ||
    date.toISOString().slice(0, 10) !== value
    ? null
    : date;
}

function countHours(value?: string): number | null {
  if (!value || !/^\d+(?:[.,]\d+)?$/.test(value.trim())) return null;
  const hours = Number(value.trim().replace(",", "."));
  return Number.isFinite(hours) && hours > 0 ? hours : null;
}

/** Inclusive endpoints. Weekend anchors are rejected, never silently moved. */
export function calculateDates(
  values: DateValues,
  rule?: TrainingDateRule | null,
) {
  const proposed: Partial<Record<CalculatedDateKey, string>> = {};
  const problems: string[] = [];
  const anchor = calendarDate(values.documentDate);
  if (values.biotCategory && anchor)
    proposed.validUntil =
      biotValidUntil(values.documentDate!, values.biotCategory) || "";
  let trainingDays: number | null = null;
  if (rule && anchor) {
    const theory = countHours(values.hours);
    const production =
      rule.hoursSource === "THEORY_AND_PRODUCTION"
        ? countHours(values.productionHours)
        : 0;
    if (theory === null || production === null) {
      problems.push(
        "Для расчёта периода укажите положительное число часов, предусмотренных графиком.",
      );
    } else if (
      rule.calendar === "WEEKDAYS" &&
      [0, 6].includes(anchor.getUTCDay())
    ) {
      problems.push(
        "Дата документа попадает на выходной, а график допускает только понедельник–пятницу. Измените дату или график.",
      );
    } else {
      trainingDays = Math.ceil((theory + production) / rule.hoursPerDay);
      if (trainingDays > 3660) {
        problems.push(
          "Расчётный период превышает 3660 учебных дней. Проверьте часы и график.",
        );
      } else {
        const other = new Date(anchor);
        const direction = rule.anchor === "DOCUMENT_IS_END" ? -1 : 1;
        let remaining = trainingDays - 1;
        while (remaining > 0) {
          other.setUTCDate(other.getUTCDate() + direction);
          if (
            rule.calendar === "CALENDAR" ||
            ![0, 6].includes(other.getUTCDay())
          )
            remaining--;
        }
        if (other.getUTCFullYear() < 1 || other.getUTCFullYear() > 9999) {
          problems.push(
            "Расчётный период выходит за допустимые календарные даты.",
          );
        } else {
          const opposite = other.toISOString().slice(0, 10);
          proposed.trainingStart =
            rule.anchor === "DOCUMENT_IS_END" ? opposite : values.documentDate!;
          proposed.trainingEnd =
            rule.anchor === "DOCUMENT_IS_END" ? values.documentDate! : opposite;
          if (rule.protocolDate !== "MANUAL")
            proposed.protocolDate =
              rule.protocolDate === "DOCUMENT_DATE"
                ? values.documentDate!
                : proposed.trainingEnd;
        }
      }
    }
  }
  return { proposed, trainingDays, problems };
}

export function trainingRuleDescription(
  rule?: TrainingDateRule | null,
): string {
  if (!rule)
    return "Выберите график программы, чтобы рассчитывать период автоматически; до этого даты обучения и протокола вводятся вручную.";
  return `${rule.hoursPerDay} ч. в день; ${rule.hoursSource === "THEORY" ? "по часам обучения без производственных" : "по сумме учебных и производственных часов"}; ${rule.calendar === "CALENDAR" ? "календарные дни, включая выходные" : "понедельник–пятница, без учёта праздников"}; дата документа — ${rule.anchor === "DOCUMENT_IS_END" ? "последний" : "первый"} день. Неполный день округляется вверх, первый и последний дни включены. Источник: ${rule.source}`;
}
