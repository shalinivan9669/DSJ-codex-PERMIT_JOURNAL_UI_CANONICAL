"use client";
import {
  BIOT_CATEGORIES,
  calculateDates,
  calculatedDateKeys,
  trainingRuleDescription,
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
}: {
  values: DateValues;
  rule?: TrainingDateRule | null;
  origins?: Record<string, string | undefined>;
  disabled: boolean;
  onRestore: (key: CalculatedDateKey) => void;
  restoreKeys?: CalculatedDateKey[];
}) {
  const calculation = calculateDates(values, rule);
  const overrides = calculatedDateKeys.filter(
    (key) =>
      ["MANUAL", "IMPORTED", "CLEARED", "REQUEST", "EVENT", "CENTER"].includes(
        origins?.[key] || "",
      ) && calculation.proposed[key] !== undefined,
  );
  return (
    <div className="fine-print" aria-live="polite">
      <p>{trainingRuleDescription(rule)}</p>
      {calculation.trainingDays && (
        <p>
          Расчётная продолжительность: {calculation.trainingDays} учебных дней.
          Автоматический период: {calculation.proposed.trainingStart || "—"} —{" "}
          {calculation.proposed.trainingEnd || "—"}.
        </p>
      )}
      {values.biotCategory && (
        <p>
          Срок по категории:{" "}
          {BIOT_CATEGORIES[values.biotCategory].validityYears
            ? `${BIOT_CATEGORIES[values.biotCategory].validityYears} ${BIOT_CATEGORIES[values.biotCategory].validityYears === 1 ? "год" : "года"} от даты документа`
            : "фиксированный срок не установлен"}
          . Часы не изменяют срок действия.
        </p>
      )}
      {calculation.problems.map((message) => (
        <p className="field-error" key={message}>
          {message}
        </p>
      ))}
      {overrides.map((key) => (
        <p key={key}>
          {labels[key]}:{" "}
          {origins?.[key] === "IMPORTED" ? "импортированное" : "явно заданное"}{" "}
          исключение {values[key] || "(пусто)"}; расчёт:{" "}
          {calculation.proposed[key] || "(не назначается)"}.{" "}
          {values[key] !== calculation.proposed[key]
            ? "Отличается от расчёта."
            : "Сохранится даже при изменении расчёта."}{" "}
          {!restoreKeys || restoreKeys.includes(key) ? (
            <button
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
