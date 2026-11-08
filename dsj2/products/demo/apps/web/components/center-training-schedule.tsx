"use client";
import { useCabinetText } from "./cabinet-language";
import type { CommonFields } from "@demo/contracts";
import { TrainingDateSettings } from "./training-date-settings";

export function CenterTrainingSchedule({
  commonFields,
  disabled,
  onChange,
}: {
  commonFields?: CommonFields;
  disabled: boolean;
  onChange: (commonFields: CommonFields) => void;
}) {
  const tr = useCabinetText();
  return (
    <section aria-label={tr("График обучения центра")}>
      <h3>{tr("График обучения по умолчанию")}</h3>
      <p className="fine-print">
        {tr("Этот график используется в новых заявках. Для группы или документа можно задать другой.")}</p>
      <TrainingDateSettings
        rule={commonFields?.trainingDateRule}
        disabled={disabled}
        onChange={(trainingDateRule) =>
          onChange({ ...commonFields, trainingDateRule })
        }
      />
      <p className="fine-print">
        {tr("После применения графика сохраните настройки центра.")}</p>
    </section>
  );
}
