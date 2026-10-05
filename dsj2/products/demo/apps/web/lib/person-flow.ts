import { isBlankText, validDate } from "@demo/contracts";
import type { Recipient } from "./types";

export type PersonStage = "identity" | "category" | "courses" | "summary";

/** Resume is derived from the existing person, never a persisted wizard flag. */
export function initialPersonStage(person: Recipient): PersonStage {
  if (
    isBlankText(person.fullNameRu || person.fullNameKz) ||
    isBlankText(person.positionRu || person.positionKz)
  )
    return "identity";
  if (!person.employeeCategory) return "category";
  if (!person.assignments.length) return "courses";
  return "summary";
}

export function personStageForField(field: string): PersonStage {
  if (["fullNameRu", "fullNameKz", "positionRu", "positionKz"].includes(field))
    return "identity";
  if (field === "employeeCategory") return "category";
  return "courses";
}

/** Empty dates remain permitted here; document-specific validation owns requiredness. */
export function trainingPeriodErrors(values: {
  trainingStart?: string;
  trainingEnd?: string;
}): Partial<Record<"trainingStart" | "trainingEnd", string>> {
  const errors: Partial<Record<"trainingStart" | "trainingEnd", string>> = {};
  for (const key of ["trainingStart", "trainingEnd"] as const)
    if (values[key] && !validDate(values[key]))
      errors[key] = "Укажите существующую дату";
  if (
    values.trainingStart &&
    values.trainingEnd &&
    !errors.trainingStart &&
    !errors.trainingEnd &&
    values.trainingStart > values.trainingEnd
  )
    errors.trainingEnd = "Окончание обучения не может быть раньше начала";
  return errors;
}
