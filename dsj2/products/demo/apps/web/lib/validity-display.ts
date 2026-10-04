import {
  BIOT_CATEGORIES,
  employeeCategoryFor,
  trainingDirection,
  type Assignment,
  type BiotCategory,
  type RequestItemInput,
} from "@demo/contracts";

export function liveValidityDescription(
  item: Pick<RequestItemInput, "employeeCategory" | "assignments">,
  assignment: Pick<Assignment, "templateId">,
) {
  if (trainingDirection(assignment.templateId) === "PS")
    return "ПС — бессрочно. Дата окончания не указывается. Срок определяется действующим правилом центра и не вводится вручную.";
  return `Расчётный срок: ${employeeCategoryFor(item) === "ITR" ? "3 года для ИТР" : "1 год для рабочего"} от даты этого документа. Введённая вручную или импортированная дата сохраняется; для пересчёта верните автоматический расчёт. Явная очистка также сохраняется и требует заполнения перед передачей директору.`;
}
export function presetValidityLabel(category: BiotCategory) {
  const years = BIOT_CATEGORIES[category].validityYears;
  return years === null
    ? "В течение срока полномочий; фиксированная дата не назначена"
    : `${years} ${years === 1 ? "год" : "года"}`;
}
export function biotCategoryDescription(
  category: BiotCategory,
  liveRules: boolean,
) {
  const preset = BIOT_CATEGORIES[category];
  if (!liveRules) return preset.hint;
  const hours = `Объём программы: не менее ${preset.minimumHours} академических часов${preset.minimumProductionHours ? ` и ${preset.minimumProductionHours} производственных часов` : ""}.`;
  const ecs = preset.requiresExternalCertificate
    ? " Общие профессиональные компетенции требуют сертификата ЕЦС; DEMO его не выдаёт и не заменяет."
    : "";
  const discrepancy =
    preset.form === "ITR" && preset.validityYears !== 3
      ? ` Описание категории указывает ${presetValidityLabel(category).toLowerCase()}; выбранное центром правило печати устанавливает 3 года для ИТР с сохранением ручных исключений. Расхождение с описанием категории не является подтверждением актуальной нормы закона.`
      : "";
  return hours + ecs + discrepancy;
}
