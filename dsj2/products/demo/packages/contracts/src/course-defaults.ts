import type { Assignment, CommonFields } from "./index";

/** Exact legacy centre text, not a new statement of regulatory currency. */
export const LEGACY_PB_PROGRAM =
  'ПОПБ на ОПО согласно Закону РК от 2014 года №188-V "О гражданской защите"/Қауіпті өндірістік объектілердегі өнеркәсіптік қауіпсіздік "азаматтық қорғау туралы"ҚР 2014 жылғы №188-V Заңына сәйкес';

export const courseProgramKeys = [
  "trainingSubject",
  "trainingSubjectKz",
  "psGeneralSubjectRu",
  "psGeneralSubjectKz",
  "psSpecialSubjectRu",
  "psSpecialSubjectKz",
] as const;

/** Lowest-priority built-ins. Profiles, presets, event values and explicit
 * MANUAL/IMPORTED/CLEARED exceptions take precedence in resolveDraft. */
export function courseProgramDefaults(templateId: string): CommonFields {
  if (templateId.startsWith("biot-itr"))
    return {
      trainingSubject: "Безопасность и охрана труда",
      trainingSubjectKz: "Еңбек қауіпсіздігі және еңбекті қорғау",
    };
  if (templateId.startsWith("biot-"))
    return { trainingSubject: "Еқ және ЕҚ/БиОТ" };
  if (templateId.startsWith("ptm-"))
    return { trainingSubject: "ПТМ", trainingSubjectKz: "ӨТМ" };
  if (templateId.startsWith("pb-"))
    return { trainingSubject: LEGACY_PB_PROGRAM };
  if (templateId.startsWith("ps-"))
    return {
      trainingSubject: "ПС",
      psGeneralSubjectRu: "Общепроф. курс",
      psGeneralSubjectKz: "Жалпы кәсіби курс",
      psSpecialSubjectRu: "Спец. Курс",
      psSpecialSubjectKz: "арнайы курс",
    };
  return {};
}

/** Status is a fact; these are the appropriate document words for that fact. */
export function courseResultText(
  templateId: string,
  status: NonNullable<Assignment["outcome"]>["status"],
): string {
  if (status === "UNKNOWN") return "Не подтверждено";
  if (status === "FAILED") return "Не сдал";
  if (status === "ABSENT") return "Не явился";
  if (templateId.startsWith("biot-")) return "Өтті/прошел";
  if (templateId.startsWith("ptm-")) return "Прошел/ Өтті";
  if (templateId.startsWith("ps-")) return "Сдал/Тапсырды";
  return "Тапсырды/сдал";
}

export function nonPassedResultKz(status: "UNKNOWN" | "FAILED" | "ABSENT") {
  return { UNKNOWN: "Расталмаған", FAILED: "Тапсырмады", ABSENT: "Келмеді" }[
    status
  ];
}

/** Actual operator-entered grades/scores remain data even after a failure.
 * Old positive template literals and our generated status words are not grades. */
export function factualAssessmentText(value?: string, origin?: string): string {
  if (origin === "COURSE" || origin === "AUTO") return "";
  const text = value?.trim() || "";
  const normalized = text.toLocaleLowerCase("ru").replace(/\s+/g, "");
  const placeholders = [
    "",
    "хорошо",
    "жақсы",
    "жаксы",
    "сдал",
    "тапсырды",
    "прошел",
    "прошёл",
    "өтті",
    "сдал/тапсырды",
    "тапсырды/сдал",
    "прошел/өтті",
    "өтті/прошел",
    "несдал",
    "тапсырмады",
    "неявился",
    "келмеді",
    "неподтверждено",
    "расталмаған",
    "несдал/тапсырмады",
    "неявился/келмеді",
    "неподтверждено/расталмаған",
  ];
  return normalized.split("/").every((part) => placeholders.includes(part))
    ? ""
    : text;
}

export function isProtectedField(origin?: string): boolean {
  return origin === "MANUAL" || origin === "IMPORTED" || origin === "CLEARED";
}

/** A course change refreshes only previously automatic program text. */
export function withCourseProgram<T extends Assignment>(assignment: T): T {
  const defaults = courseProgramDefaults(assignment.templateId);
  const next = { ...assignment, fieldOrigins: { ...assignment.fieldOrigins } };
  for (const key of courseProgramKeys) {
    const origin = assignment.fieldOrigins?.[key];
    if (isProtectedField(origin) || (!origin && assignment[key])) continue;
    if (origin === "INHERITED") continue;
    if (
      origin === "COURSE" &&
      assignment[key] &&
      ![
        "biot-worker-card",
        "biot-itr-certificate",
        "ptm-card",
        "pb-card",
        "ps-card",
      ].some(
        (template) => courseProgramDefaults(template)[key] === assignment[key],
      )
    ) {
      // Older callers may have saved custom text beside stale automatic
      // metadata. An unrecognised nonempty program is never disposable.
      next.fieldOrigins[key] = "MANUAL";
      continue;
    }
    const value = defaults[key];
    if (value !== undefined || origin === "COURSE") {
      (next as unknown as Record<string, unknown>)[key] = value || "";
      next.fieldOrigins[key] = "COURSE";
    }
  }
  return next;
}
