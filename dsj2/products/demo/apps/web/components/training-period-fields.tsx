"use client";

import { useId } from "react";
import { trainingPeriodErrors } from "@/lib/person-flow";

type PeriodKey = "trainingStart" | "trainingEnd";

/** One real course owns this pair, even when it has several printed forms. */
export function TrainingPeriodFields({
  values,
  fieldPath,
  fieldErrors = {},
  fieldHints = {},
  origins = {},
  disabled,
  onChange,
  onRestore,
}: {
  values: { trainingStart?: string; trainingEnd?: string };
  fieldPath: string;
  fieldErrors?: Record<string, string>;
  fieldHints?: Record<string, string>;
  origins?: Record<string, string | undefined>;
  disabled: boolean;
  onChange: (key: PeriodKey, value: string) => void;
  onRestore?: (key: PeriodKey) => void;
}) {
  const id = useId();
  const localErrors = trainingPeriodErrors(values);
  return (
    <div
      className="form-grid compact training-period-fields"
      aria-label="Период обучения ПС"
    >
      {(
        [
          ["trainingStart", "Обучение с"],
          ["trainingEnd", "по"],
        ] as const
      ).map(([key, label]) => {
        const path = `${fieldPath}.${key}`;
        const error = fieldErrors[path] || localErrors[key];
        const hint = fieldHints[path];
        const origin = origins[key];
        const exception = ["MANUAL", "IMPORTED", "CLEARED"].includes(
          origin || "",
        );
        return (
          <label key={key}>
            {label}
            <input
              type="date"
              aria-label={label}
              data-field-path={path}
              disabled={disabled}
              value={values[key] || ""}
              aria-invalid={!!error}
              aria-describedby={
                error || hint || exception ? `${id}-${key}` : undefined
              }
              onChange={(event) => onChange(key, event.target.value)}
            />
            {(error || hint || exception) && (
              <small
                id={`${id}-${key}`}
                className={error ? "field-error" : "field-hint"}
                aria-live="polite"
              >
                {error ||
                  hint ||
                  (origin === "IMPORTED"
                    ? "Из импорта"
                    : origin === "CLEARED"
                      ? "Явно очищено"
                      : "Задано вручную")}
              </small>
            )}
            {exception && onRestore && (
              <button
                type="button"
                className="text-button"
                disabled={disabled}
                onClick={() => onRestore(key)}
              >
                Вернуть общий расчёт
              </button>
            )}
          </label>
        );
      })}
    </div>
  );
}
