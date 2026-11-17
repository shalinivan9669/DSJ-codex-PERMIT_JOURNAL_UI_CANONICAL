import { useId, type ReactNode } from "react";
import {
  BIOT_CATEGORIES,
  isProtectedField,
  trainingHoursPrograms,
  trainingHoursRule,
  type CommonFields,
  type TrainingHoursProgram,
} from "@demo/contracts";

export type HoursField = "hours" | "productionHours" | "hoursProgram";

const enteredSources: Record<string, string> = {
  MANUAL: "Введено вручную",
  IMPORTED: "Из файла",
  CLEARED: "Значение очищено",
  REQUEST: "Общие данные заявки",
  PRESET: "Из набора настроек",
  SERVICE_RULE: "Из паспорта услуги",
  CENTER: "Из настроек центра",
  EVENT: "Из общего обучения",
};

type FieldAttributes = {
  "data-field-path": string;
  "aria-invalid"?: boolean;
  "aria-describedby"?: string;
};

export function TrainingHoursFields({
  templateId,
  category,
  effective,
  original,
  origins,
  mixed = false,
  label,
  practiceLabel = "Производственное обучение, часов",
  disabled,
  attributes,
  feedback,
  onChange,
  onRestore,
}: {
  templateId: string;
  category?: "WORKER" | "ITR";
  effective: Pick<CommonFields, HoursField | "biotCategory">;
  original: Pick<CommonFields, HoursField | "fieldOrigins"> & {
    biotManualFields?: readonly string[];
  };
  origins?: Record<string, string>;
  mixed?: boolean;
  label: string;
  practiceLabel?: string;
  disabled: boolean;
  attributes: (key: HoursField) => FieldAttributes;
  feedback: (key: HoursField) => ReactNode;
  onChange: (patch: Pick<CommonFields, HoursField>) => void;
  onRestore: (key: HoursField) => void;
}) {
  const id = useId();
  const programs = trainingHoursPrograms(templateId);
  const rule = trainingHoursRule(templateId, category, effective);
  const hasIndividualHours =
    mixed && !effective.hours && !effective.hoursProgram;
  const biot = templateId.startsWith("biot-");
  const courseLabel = biot
    ? "Основание расчёта часов БиОТ"
    : templateId.startsWith("ptm-")
      ? "Программа ПТМ"
      : "Вид подготовки по ПБ";
  function overridden(key: HoursField) {
    const origin = original.fieldOrigins?.[key];
    return (
      isProtectedField(origin) ||
      !!original.biotManualFields?.includes(key) ||
      (!origin && !!original[key])
    );
  }
  function field(key: "hours" | "productionHours", title: string) {
    const input = attributes(key);
    const descriptionId = id + "-" + key;
    const source = origins?.[key] || original.fieldOrigins?.[key];
    return (
      <div>
        <label>
          {title}
          <input
            {...input}
            aria-label={title}
            aria-describedby={[input["aria-describedby"], descriptionId]
              .filter(Boolean)
              .join(" ")}
            data-training-field={key}
            inputMode="decimal"
            disabled={disabled}
            placeholder={
              key === "hours" && hasIndividualHours
                ? "По категории слушателя"
                : undefined
            }
            value={effective[key] || ""}
            onChange={(e) => onChange({ [key]: e.target.value })}
          />
        </label>
        {feedback(key)}
        <small id={descriptionId}>
          {source && enteredSources[source] && <>{enteredSources[source]}. </>}
          {key === "hours" &&
            (hasIndividualHours
              ? "У рабочих и ИТР часы рассчитываются отдельно."
              : rule.source)}
          {key === "hours" && rule.url && (
            <>
              {" "}
              <a href={rule.url} target="_blank" rel="noreferrer">
                Основание
              </a>
            </>
          )}
        </small>
        {overridden(key) && (
          <button
            type="button"
            className="text-button"
            disabled={disabled}
            aria-label={`Вернуть расчёт: ${title}`}
            onClick={() => onRestore(key)}
          >
            Вернуть расчёт
          </button>
        )}
      </div>
    );
  }
  const programField = programs.length > 0 && (
    <div>
      <label>
        {courseLabel}
        <select
          {...attributes("hoursProgram")}
          aria-label={courseLabel}
          data-training-field="hoursProgram"
          disabled={disabled}
          value={effective.hoursProgram || ""}
          onChange={(e) => {
            onChange({
              hoursProgram: e.target.value
                ? (e.target.value as TrainingHoursProgram)
                : undefined,
            });
          }}
        >
          <option value="">
            {templateId.startsWith("ptm-")
              ? "Выберите программу"
              : "По категории слушателя"}
          </option>
          {programs.map((program) => (
            <option key={program.id} value={program.id}>
              {program.label}
            </option>
          ))}
        </select>
        {feedback("hoursProgram")}
      </label>
      {overridden("hoursProgram") && (
        <button
          type="button"
          className="text-button"
          disabled={disabled}
          aria-label={`Вернуть общий выбор: ${courseLabel}`}
          onClick={() => onRestore("hoursProgram")}
        >
          Вернуть общий выбор
        </button>
      )}
    </div>
  );
  return (
    <>
      {biot && programField ? (
        <details>
          <summary>Вариант программы для расчёта часов</summary>
          {programField}
        </details>
      ) : (
        programField
      )}
      {field(
        "hours",
        effective.biotCategory
          ? BIOT_CATEGORIES[effective.biotCategory].hoursLabel
          : label,
      )}
      {(effective.biotCategory === "WORKER" ||
        rule.productionHours ||
        effective.productionHours) &&
        field("productionHours", practiceLabel)}
    </>
  );
}
