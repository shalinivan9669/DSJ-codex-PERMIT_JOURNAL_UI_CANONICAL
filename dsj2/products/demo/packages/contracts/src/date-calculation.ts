import { z } from "zod";
import { biotValidUntil, type BiotCategory } from "./biot";
import {
  KZ_TRAINING_CALENDAR_LABEL,
  KZ_TRAINING_CALENDAR_VERSION,
  kzTrainingDay,
} from "./kz-training-calendar";
export {
  KZ_TRAINING_CALENDAR_LABEL,
  KZ_TRAINING_CALENDAR_VERSION,
  KZ_TRAINING_CALENDAR_SOURCES,
} from "./kz-training-calendar";

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
    hoursSource: z.enum(["THEORY", "THEORY_AND_PRODUCTION", "SEPARATE_BLOCKS"]),
    productionHoursPerDay: z.number().positive().max(24).optional(),
    calendar: z.enum(["CALENDAR", "WEEKDAYS", "KZ_FIVE_DAY"]),
    calendarVersion: z.literal(KZ_TRAINING_CALENDAR_VERSION).optional(),
    anchor: z.enum([
      "DOCUMENT_IS_START",
      "DOCUMENT_IS_END",
      "DOCUMENT_AFTER_TRAINING",
    ]),
    protocolDate: z.enum(["MANUAL", "DOCUMENT_DATE", "TRAINING_END"]),
    source: z.string().trim().min(3).max(500),
  })
  .strict()
  .superRefine((rule, ctx) => {
    if (rule.calendar === "KZ_FIVE_DAY" && !rule.calendarVersion)
      ctx.addIssue({
        code: "custom",
        path: ["calendarVersion"],
        message: "Выберите проверенную версию календаря Казахстана",
      });
    if (rule.hoursSource === "SEPARATE_BLOCKS" && !rule.productionHoursPerDay)
      ctx.addIssue({
        code: "custom",
        path: ["productionHoursPerDay"],
        message: "Укажите производственные часы в день отдельно",
      });
  });
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

/** Legacy anchors remain inclusive. The new anchor finishes before issue day. */
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
      rule.hoursSource !== "THEORY" ? countHours(values.productionHours) : 0;
    if (theory === null || production === null) {
      problems.push(
        "Для расчёта периода укажите положительное число часов, предусмотренных графиком.",
      );
    } else {
      trainingDays =
        rule.hoursSource === "SEPARATE_BLOCKS"
          ? Math.ceil(theory / rule.hoursPerDay) +
            Math.ceil(production / (rule.productionHoursPerDay || 0))
          : Math.ceil((theory + production) / rule.hoursPerDay);
      if (
        !Number.isFinite(trainingDays) ||
        trainingDays < 1 ||
        trainingDays > 3660
      ) {
        problems.push(
          "Расчётный период превышает 3660 учебных дней. Проверьте часы и график.",
        );
      } else {
        const eligible = (date: Date): boolean | null => {
          if (date.getUTCFullYear() < 1 || date.getUTCFullYear() > 9999) {
            problems.push(
              "Расчётный период выходит за допустимые календарные даты.",
            );
            return null;
          }
          if (rule.calendar === "KZ_FIVE_DAY") {
            const day = kzTrainingDay(date);
            if (day === null)
              problems.push(
                "Календарь Казахстана проверен только для 2025–2026 годов. Для этого периода укажите даты вручную или выберите подтверждённый график; праздники других лет не предполагаются.",
              );
            return day;
          }
          return (
            rule.calendar === "CALENDAR" || ![0, 6].includes(date.getUTCDay())
          );
        };
        const endBeforeIssue = rule.anchor === "DOCUMENT_AFTER_TRAINING";
        const first = new Date(anchor);
        let firstEligible: boolean | null;
        if (endBeforeIssue) {
          do {
            first.setUTCDate(first.getUTCDate() - 1);
            firstEligible = eligible(first);
          } while (firstEligible === false);
        } else {
          firstEligible = eligible(first);
          if (firstEligible === false)
            problems.push(
              "Дата документа попадает на неучебный день выбранного графика. Измените дату или выберите обучение до даты документа.",
            );
        }
        const other = new Date(first);
        const direction = rule.anchor === "DOCUMENT_IS_START" ? 1 : -1;
        let remaining = trainingDays - 1;
        while (remaining > 0 && !problems.length) {
          other.setUTCDate(other.getUTCDate() + direction);
          if (eligible(other)) remaining--;
        }
        if (!problems.length) {
          const firstDate = first.toISOString().slice(0, 10);
          const opposite = other.toISOString().slice(0, 10);
          proposed.trainingStart = direction === -1 ? opposite : firstDate;
          proposed.trainingEnd = direction === -1 ? firstDate : opposite;
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
  const hours =
    rule.hoursSource === "SEPARATE_BLOCKS"
      ? `последовательно: теория по ${rule.hoursPerDay} акад. ч. в день, затем производственное обучение по ${rule.productionHoursPerDay} ч. в день; каждый блок округляется отдельно`
      : `${rule.hoursPerDay} ч. программы в день; ${rule.hoursSource === "THEORY" ? "по выбранным часам обучения, производственное обучение отдельно" : "по сумме часов только при одинаковых единицах, подтверждённых графиком"}`;
  const calendar =
    rule.calendar === "KZ_FIVE_DAY"
      ? KZ_TRAINING_CALENDAR_LABEL
      : rule.calendar === "CALENDAR"
        ? "календарные дни, включая выходные"
        : "понедельник–пятница, без учёта праздников";
  const anchor =
    rule.anchor === "DOCUMENT_AFTER_TRAINING"
      ? "обучение заканчивается в последний учебный день до даты документа"
      : `дата документа — ${rule.anchor === "DOCUMENT_IS_END" ? "последний" : "первый"} день`;
  return `${hours}; ${calendar}; ${anchor}. Неполный день округляется вверх, дни обучения включены. Источник: ${rule.source}`;
}

/** Explicit dates remain unchanged; a new strict schedule reports the conflict. */
export function trainingBeforeIssueProblems(
  values: DateValues,
  rule?: TrainingDateRule | null,
) {
  if (
    rule?.anchor !== "DOCUMENT_AFTER_TRAINING" ||
    !calendarDate(values.documentDate)
  )
    return [];
  return (["trainingStart", "trainingEnd"] as const)
    .filter(
      (field) =>
        calendarDate(values[field]) && values[field]! >= values.documentDate!,
    )
    .map((field) => ({
      field,
      message: `${field === "trainingStart" ? "Начало" : "Окончание"} обучения должно быть раньше даты документа. Исправьте эту дату или дату документа.`,
    }));
}
