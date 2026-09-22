/** Official rules, edition 30.05.2026, clauses 5, 12, 27 and 28.
 * https://zan.gov.kz/api/documents/225864/rus/download/pdf
 * Presets describe training; they do not issue an external ECS certificate.
 */
export const biotCategoryIds = [
  "WORKER",
  "MANAGER_GENERAL",
  "OHS_HEAD_GENERAL",
  "OHS_SPECIALIST_SPECIAL",
  "INSPECTOR_GENERAL",
  "INSPECTOR_SPECIAL",
  "COUNCIL_GENERAL",
  "COUNCIL_SPECIAL",
] as const;
export type BiotCategory = (typeof biotCategoryIds)[number];
type BiotPreset = {
  label: string;
  minimumHours: number;
  defaultHours: number;
  minimumProductionHours?: number;
  defaultProductionHours?: number;
  validityYears: 1 | 3 | null;
  form: "WORKER" | "ITR";
  program: "GENERAL" | "SPECIAL" | null;
  hoursLabel: string;
  requiresExternalCertificate: boolean;
  hint: string;
};
const generalHint =
  "Общие профессиональные компетенции. Сертификат оформляется в ЕЦС; DEMO не выдаёт и не заменяет сертификат ЕЦС.";
export const BIOT_CATEGORIES: Record<BiotCategory, BiotPreset> = {
  WORKER: {
    label: "Рабочий",
    minimumHours: 10,
    defaultHours: 10,
    minimumProductionHours: 16,
    defaultProductionHours: 16,
    validityYears: 1,
    form: "WORKER",
    program: null,
    hoursLabel: "Теоретическое обучение, акад. ч.",
    requiresExternalCertificate: false,
    hint: "Теория — не менее 10 академических часов; производственное обучение — не менее 16 часов. Очередная проверка — не реже одного раза в год.",
  },
  MANAGER_GENERAL: {
    label: "Первый руководитель / уполномоченное лицо — общие компетенции",
    minimumHours: 16,
    defaultHours: 16,
    validityYears: 3,
    form: "ITR",
    program: "GENERAL",
    hoursLabel: "Обучение, акад. ч.",
    requiresExternalCertificate: true,
    hint: generalHint,
  },
  OHS_HEAD_GENERAL: {
    label: "Руководитель службы охраны труда — общие компетенции",
    minimumHours: 40,
    defaultHours: 40,
    validityYears: 3,
    form: "ITR",
    program: "GENERAL",
    hoursLabel: "Обучение, акад. ч.",
    requiresExternalCertificate: true,
    hint: generalHint,
  },
  OHS_SPECIALIST_SPECIAL: {
    label:
      "Специалист / ответственный по охране труда — специальные компетенции",
    minimumHours: 40,
    defaultHours: 40,
    validityYears: 3,
    form: "ITR",
    program: "SPECIAL",
    hoursLabel: "Обучение, акад. ч.",
    requiresExternalCertificate: false,
    hint: "Специальные профессиональные компетенции: не менее 40 академических часов, периодичность — один раз в три года.",
  },
  INSPECTOR_GENERAL: {
    label: "Технический инспектор — общие компетенции",
    minimumHours: 24,
    defaultHours: 24,
    validityYears: 3,
    form: "ITR",
    program: "GENERAL",
    hoursLabel: "Обучение, акад. ч.",
    requiresExternalCertificate: true,
    hint: generalHint,
  },
  INSPECTOR_SPECIAL: {
    label: "Технический инспектор — специальные компетенции",
    minimumHours: 40,
    defaultHours: 40,
    validityYears: 1,
    form: "ITR",
    program: "SPECIAL",
    hoursLabel: "Обучение, акад. ч.",
    requiresExternalCertificate: false,
    hint: "Специальные профессиональные компетенции: не менее 40 академических часов и не реже одного раза в год.",
  },
  COUNCIL_GENERAL: {
    label: "Председатель производственного совета — общие компетенции",
    minimumHours: 24,
    defaultHours: 24,
    validityYears: null,
    form: "ITR",
    program: "GENERAL",
    hoursLabel: "Обучение, акад. ч.",
    requiresExternalCertificate: true,
    hint: `${generalHint} Один раз в течение срока полномочий; фиксированный срок в годах не назначается.`,
  },
  COUNCIL_SPECIAL: {
    label: "Председатель производственного совета — специальные компетенции",
    minimumHours: 40,
    defaultHours: 40,
    validityYears: null,
    form: "ITR",
    program: "SPECIAL",
    hoursLabel: "Обучение, акад. ч.",
    requiresExternalCertificate: false,
    hint: "Не менее 40 академических часов один раз в течение срока полномочий; фиксированный срок в годах не назначается.",
  },
};

/** Calendar anniversary, without timezone conversion or invented council term. */
export function biotValidUntil(
  date: string,
  category: BiotCategory,
): string | null {
  const years = BIOT_CATEGORIES[category].validityYears;
  if (!years || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const parsed = new Date(`${date}T12:00:00Z`);
  if (isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date)
    return null;
  const year = parsed.getUTCFullYear() + years;
  if (year > 9999) return null;
  const month = parsed.getUTCMonth();
  const lastDay = new Date(parsed);
  lastDay.setUTCFullYear(year, month + 1, 0);
  return `${String(year).padStart(4, "0")}-${String(month + 1).padStart(2, "0")}-${String(Math.min(parsed.getUTCDate(), lastDay.getUTCDate())).padStart(2, "0")}`;
}
