"use client";

import { useState } from "react";
import { Modal, Notice } from "@demo/ui";
import { assignTrainingBundle } from "@/lib/request-bundles";
import { errorText } from "@/lib/api";
import type { Draft } from "@/lib/types";

const trainings = [
  {
    id: "BIOT",
    label: "Безопасность и охрана труда",
    detail: "Рабочий: удостоверение и протокол. ИТР: сертификат и протокол.",
  },
  {
    id: "PTM",
    label: "Пожарно-технический минимум",
    detail: "Удостоверение и протокол.",
  },
  {
    id: "PB",
    label: "Промышленная безопасность",
    detail: "Удостоверение и протокол.",
  },
  {
    id: "PS",
    label: "ПС — обучение по профессии",
    detail: "Удостоверение, свидетельство и протокол. Бессрочно.",
  },
] as const;
type Direction = (typeof trainings)[number]["id"];

export function TrainingBundleDialog({
  draft,
  selectedIds,
  disabled,
  onClose,
  onApply,
}: {
  draft: Draft;
  selectedIds: string[];
  disabled: boolean;
  onClose: () => void;
  onApply: (draft: Draft) => Promise<void>;
}) {
  const [chosen, setChosen] = useState<Direction[]>([]);
  const [mode, setMode] = useState<"AUTO" | "GROUP" | "INDIVIDUAL">("AUTO");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const recipients = draft.items.filter((item) =>
    selectedIds.includes(item.id),
  );
  return (
    <Modal
      title="Назначить обучение"
      wide
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <p>
        {recipients.length === 1
          ? recipients[0].fullNameRu || "Новый получатель"
          : `Выбрано сотрудников: ${recipients.length}`}
      </p>
      <p className="muted">
        Выберите обучение. Обязательные документы добавятся вместе с протоколом
        по категории каждого сотрудника.
      </p>
      {error && <Notice>{error}</Notice>}
      <fieldset disabled={busy || disabled} className="training-choices">
        <legend>Направления обучения</legend>
        {trainings.map((training) => (
          <label key={training.id} className="training-choice">
            <input
              type="checkbox"
              checked={chosen.includes(training.id)}
              onChange={(event) =>
                setChosen((current) =>
                  event.target.checked
                    ? [...current, training.id]
                    : current.filter((id) => id !== training.id),
                )
              }
            />
            <span>
              <strong>{training.label}</strong>
              <small>{training.detail}</small>
            </span>
          </label>
        ))}
      </fieldset>
      <label>
        Протокол при добавлении
        <select
          value={mode}
          disabled={busy || disabled}
          onChange={(event) => setMode(event.target.value as typeof mode)}
        >
          <option value="AUTO">
            Общий от двух участников, индивидуальный для одного
          </option>
          <option value="GROUP">Общий протокол по каждому обучению</option>
          <option value="INDIVIDUAL">Отдельный протокол на каждого</option>
        </select>
      </label>
      <p className="fine-print">
        Группы рабочих и ИТР по БиОТ разделяются автоматически. Режим каждого
        обучения можно изменить в заявке.
      </p>
      <div className="modal-actions">
        <button type="button" disabled={busy} onClick={onClose}>
          Отмена
        </button>
        <button
          type="button"
          className="primary"
          disabled={busy || disabled || !chosen.length || !recipients.length}
          onClick={async () => {
            setBusy(true);
            setError("");
            try {
              let next = draft;
              for (const direction of chosen)
                next = assignTrainingBundle(
                  next,
                  selectedIds,
                  direction,
                  mode === "AUTO" ? undefined : mode,
                );
              await onApply(next);
            } catch (caught) {
              setError(errorText(caught));
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? "Сохраняем версию…" : "Добавить обучение и комплект"}
        </button>
      </div>
    </Modal>
  );
}
