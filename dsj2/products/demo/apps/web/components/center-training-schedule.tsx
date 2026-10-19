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
        {tr("Один раз укажите часы в учебном дне по вашей программе. Новые заявки используют сохранённый график центра; у группы или документа можно задать другой. Индивидуально введённые даты сохраняются.")}</p>
      <TrainingDateSettings
        rule={commonFields?.trainingDateRule}
        disabled={disabled}
        onChange={(trainingDateRule) =>
          onChange({ ...commonFields, trainingDateRule })
        }
      />
      <p className="fine-print">
        {tr("После применения графика сохраните настройки центра. Дата документа по умолчанию равна дате создания заявки и доступна для отдельного изменения, в том числе за прошедший период.")}</p>
    </section>
  );
}
