"use client";
import {
  calculateDates,
  calculatedDateKeys,
  trainingBeforeIssueProblems,
  type CalculatedDateKey,
  type DateValues,
  type TrainingDateRule,
} from "@demo/contracts";

const labels: Record<CalculatedDateKey, string> = {
  trainingStart: "Начало обучения",
  trainingEnd: "Окончание обучения",
  protocolDate: "Дата протокола",
  validUntil: "Действителен до",
};
export function DateCalculationStatus({
  values,
  rule,
  origins,
  disabled,
  onRestore,
  restoreKeys,
  forceValidity = false,
}: {
  values: DateValues;
  rule?: TrainingDateRule | null;
  origins?: Record<string, string | undefined>;
  disabled: boolean;
  onRestore: (key: CalculatedDateKey) => void;
  restoreKeys?: CalculatedDateKey[];
  forceValidity?: boolean;
  validityDescription?: string;
}) {
  const calculation = calculateDates(values, rule);
  const overrides = calculatedDateKeys.filter(
    (key) =>
      ["MANUAL", "IMPORTED", "CLEARED", "REQUEST", "EVENT", "CENTER"].includes(
        origins?.[key] || "",
      ) &&
      ((forceValidity && key === "validUntil") ||
        calculation.proposed[key] !== undefined),
  );
  return (
    <div className="fine-print" aria-live="polite">
      {calculation.problems.map((message) => (
        <p className="field-error" key={message}>
          {message}
        </p>
      ))}
      {trainingBeforeIssueProblems(values, rule).map(({ field, message }) => (
        <p className="field-error" key={field}>
          {message}
        </p>
      ))}
      {overrides.map((key) => (
        <p key={key}>
          {labels[key]}:{" "}
          {values[key] || "не указано"}.{" "}
          {!restoreKeys || restoreKeys.includes(key) ? (
            <button
              type="button"
              className="text-button"
              disabled={disabled}
              aria-label={`Вернуть автоматический расчёт: ${labels[key]}`}
              onClick={() => onRestore(key)}
            >
              Вернуть автоматический расчёт
            </button>
          ) : (
            "Настройка изменяется в общих сведениях события."
          )}
        </p>
      ))}
    </div>
  );
}
