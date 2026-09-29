"use client";

import { useId, useRef, useState } from "react";
import { Modal, Notice } from "@demo/ui";
import {
  addSelectedDocuments,
  assignedDocumentTemplates,
  documentChoices,
  MAX_RECIPIENT_DOCUMENTS,
  previewDocumentSelection,
  type DocumentTemplateId,
} from "@/lib/document-selection";
import type { Recipient } from "@/lib/types";
import "./document-selection.css";

export function DocumentSelectionDialog({
  items,
  selectedIds,
  disabled = false,
  onClose,
  onApply,
}: {
  items: Recipient[];
  selectedIds: string[];
  disabled?: boolean;
  onClose: () => void;
  onApply: (items: Recipient[]) => Promise<void>;
}) {
  const [chosen, setChosen] = useState<DocumentTemplateId[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const errorRef = useRef<HTMLDivElement>(null);
  const id = useId();
  const preview = previewDocumentSelection(items, selectedIds, chosen);
  const assigned = preview.recipients.map(assignedDocumentTemplates);
  const locked = busy || disabled;
  const recipient =
    preview.recipients.length === 1 ? preview.recipients[0] : null;

  function choiceList(additional: boolean) {
    return (
      <div className="document-choice-list">
        {documentChoices
          .filter((choice) => !!choice.additional === additional)
          .map((choice) => {
            const count = assigned.filter((templates) =>
              templates.has(choice.templateId),
            ).length;
            const alreadyAssigned =
              assigned.length > 0 && count === assigned.length;
            const checked =
              alreadyAssigned || chosen.includes(choice.templateId);
            return (
              <label className="document-choice" key={choice.templateId}>
                <input
                  type="checkbox"
                  checked={checked}
                  disabled={locked || alreadyAssigned}
                  ref={(input) => {
                    if (input) input.indeterminate = count > 0 && !checked;
                  }}
                  onChange={(event) => {
                    setError("");
                    setChosen((current) =>
                      event.target.checked
                        ? [...current, choice.templateId]
                        : current.filter(
                            (template) => template !== choice.templateId,
                          ),
                    );
                  }}
                />
                <span>
                  <strong>{choice.label}</strong>
                  {alreadyAssigned ? (
                    <small>
                      Уже в комплекте
                      {assigned.length > 1 ? " у всех выбранных" : ""}
                    </small>
                  ) : count > 0 ? (
                    <small>
                      Есть у {count} из {assigned.length}. Добавить остальным
                    </small>
                  ) : (
                    <small>
                      {assigned.length > 1
                        ? "Добавить всем выбранным"
                        : "Добавить в комплект"}
                    </small>
                  )}
                </span>
              </label>
            );
          })}
      </div>
    );
  }

  return (
    <Modal
      title="Выбрать документы"
      wide
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <div className="document-selection-dialog">
        <p className="document-selection-recipient">
          {recipient
            ? recipient.fullNameRu || recipient.fullNameKz || "Новый получатель"
            : `Получателей выбрано: ${preview.recipients.length}`}
        </p>
        <p id={`${id}-help`} className="muted">
          Отметьте нужные документы. Общие даты заявки подставятся
          автоматически. Индивидуальные сведения можно уточнить в «Даты и
          детали».
        </p>
        {error && (
          <div ref={errorRef} tabIndex={-1}>
            <Notice>{error}</Notice>
          </div>
        )}
        <fieldset aria-describedby={`${id}-help`} disabled={locked}>
          <legend>Удостоверения и сертификаты</legend>
          {choiceList(false)}
          <details className="document-selection-extra">
            <summary>Протоколы и дополнительные формы</summary>
            <p className="fine-print">
              Здесь можно добавить отдельный протокол получателя. Общий протокол
              уже связанной группы учтён в комплекте.
            </p>
            {choiceList(true)}
          </details>
        </fieldset>
        <p className="fine-print">
          Отмеченные ранее документы сохраняются. Изменить или удалить их можно
          в «Даты и детали».
        </p>
        {preview.overLimit.length > 0 && (
          <Notice>
            Не более {MAX_RECIPIENT_DOCUMENTS} документов на одного получателя.
            Уменьшите набор для:{" "}
            {preview.overLimit
              .map(
                ({ recipient: person }) =>
                  person.fullNameRu ||
                  person.fullNameKz ||
                  "получателя без ФИО",
              )
              .join(", ")}
            .
          </Notice>
        )}
        <p
          className="document-selection-summary"
          role="status"
          aria-live="polite"
        >
          {preview.documents
            ? `Будет добавлено документов: ${preview.documents}. Получателей: ${preview.people}.`
            : "Выберите документы, которые нужно добавить."}
        </p>
        <div className="modal-actions">
          <button type="button" disabled={busy} onClick={onClose}>
            Отмена
          </button>
          <button
            type="button"
            className="primary"
            disabled={
              locked || !preview.documents || !!preview.overLimit.length
            }
            onClick={async () => {
              setBusy(true);
              setError("");
              try {
                await onApply(addSelectedDocuments(items, selectedIds, chosen));
                onClose();
              } catch (caught) {
                setError(
                  caught instanceof Error
                    ? caught.message
                    : "Не удалось сохранить выбранные документы",
                );
                requestAnimationFrame(() => errorRef.current?.focus());
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? "Добавляем…" : "Добавить выбранные документы"}
          </button>
        </div>
      </div>
    </Modal>
  );
}
