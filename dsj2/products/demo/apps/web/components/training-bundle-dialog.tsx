"use client";

import { useState } from "react";
import { Modal, Notice } from "@demo/ui";
import { assignTrainingBundle } from "@/lib/request-bundles";
import { trainingDirection } from "@demo/contracts";
import { errorText } from "@/lib/api";
import type { Draft } from "@/lib/types";

const trainings = [
  {
    id: "BIOT",
    shortLabel: "БиОТ",
    label: "Безопасность и охрана труда",
    detail: "Рабочий: удостоверение и протокол. ИТР: сертификат и протокол.",
  },
  {
    id: "PTM",
    shortLabel: "ПТМ",
    label: "Пожарно-технический минимум",
    detail: "Удостоверение и протокол.",
  },
  {
    id: "PB",
    shortLabel: "ПБ",
    label: "Промышленная безопасность",
    detail: "Удостоверение и протокол.",
  },
  {
    id: "PS",
    shortLabel: "ПС",
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
  onRemove,
}: {
  draft: Draft;
  selectedIds: string[];
  disabled: boolean;
  onClose: () => void;
  onApply: (draft: Draft) => Promise<void>;
  onRemove?: (direction: Direction, recipientIds: string[]) => void;
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
        {trainings.map((training) => {
          const assigned = recipients.filter((item) =>
            item.assignments.some(
              (a) => trainingDirection(a.templateId) === training.id,
            ),
          );
          return (
            <div key={training.id} className="training-choice-with-actions">
              <label className="training-choice">
                <input
                  type="checkbox"
                  checked={
                    (assigned.length === recipients.length &&
                      recipients.length > 0) ||
                    chosen.includes(training.id)
                  }
                  ref={(element) => {
                    if (element)
                      element.indeterminate =
                        assigned.length > 0 &&
                        assigned.length < recipients.length &&
                        !chosen.includes(training.id);
                  }}
                  aria-checked={
                    assigned.length > 0 &&
                    assigned.length < recipients.length &&
                    !chosen.includes(training.id)
                      ? "mixed"
                      : undefined
                  }
                  onChange={(event) => {
                    if (
                      assigned.length === recipients.length &&
                      !chosen.includes(training.id)
                    ) {
                      onClose();
                      onRemove?.(
                        training.id,
                        assigned.map((item) => item.id),
                      );
                      return;
                    }
                    setChosen((current) =>
                      event.target.checked
                        ? [...current, training.id]
                        : current.filter((id) => id !== training.id),
                    );
                  }}
                />
                <span>
                  <strong>{training.label}</strong>
                  <small>{training.detail}</small>
                  <small>
                    {assigned.length
                      ? `Сейчас назначено ${assigned.length} из ${recipients.length}${assigned.length === recipients.length ? " · всем" : " · части"}.`
                      : "Сейчас никому не назначено"}
                  </small>
                  {chosen.includes(training.id) && (
                    <small role="status">
                      Будет добавлено отсутствующим:{" "}
                      {recipients.length - assigned.length}. Изменение ещё не
                      сохранено.
                    </small>
                  )}
                </span>
              </label>
              {!!assigned.length && onRemove && (
                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    onRemove(
                      training.id,
                      assigned.map((item) => item.id),
                    );
                  }}
                >
                  Снять {training.shortLabel} · {assigned.length}
                </button>
              )}
            </div>
          );
        })}
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
