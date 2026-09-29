"use client";
import { useEffect, useRef, useState } from "react";
import { Modal, Notice } from "@demo/ui";
import {
  bulkFields,
  bulkRecipientFields,
  previewBulk,
  type BulkField,
  type BulkMode,
} from "@/lib/bulk-edit";
import { templateLabels, type Recipient } from "@/lib/types";

export function BulkDialog({
  items,
  resolvedItems,
  selectedIds,
  operationError,
  onClose,
  onApply,
}: {
  items: Recipient[];
  resolvedItems?: Recipient[];
  selectedIds: string[];
  operationError?: string;
  onClose: () => void;
  onApply: (items: Recipient[]) => Promise<void>;
}) {
  const directions = [
    ...new Set(
      items
        .filter((i) => selectedIds.includes(i.id))
        .flatMap((i) => i.assignments.map((a) => a.templateId.split("-")[0])),
    ),
  ];
  const [direction, setDirection] = useState(
    directions.length === 1 ? directions[0] : "",
  );
  const [mode, setMode] = useState<BulkMode>("EMPTY");
  const [patch, setPatch] = useState<Partial<Record<BulkField, string>>>({});
  const [review, setReview] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [attempted, setAttempted] = useState(false);
  const errorRef = useRef<HTMLDivElement>(null);
  const previewRef = useRef<HTMLElement>(null);
  const visibleError = error || (attempted ? operationError : "");
  useEffect(() => {
    if (!visibleError) return;
    errorRef.current?.focus({ preventScroll: true });
    errorRef.current?.scrollIntoView({ block: "nearest" });
  }, [visibleError]);
  const preview = previewBulk(
    items,
    selectedIds,
    direction,
    patch,
    mode,
    resolvedItems,
  );
  const reset = () => {
    setReview(false);
    setConfirmed(false);
    setError("");
    setAttempted(false);
  };
  const documentFieldsSelected = bulkFields.some(([field]) =>
    Object.hasOwn(patch, field),
  );
  return (
    <Modal
      title={`Общие значения для ${selectedIds.length} получателей`}
      onClose={() => {
        if (!busy) onClose();
      }}
      wide
    >
      <p>
        Выбранные строки остаются выбранными при поиске. Изменение затронет
        только отмеченных получателей и поля. Данные человека не зависят от
        направления документов. Перед сохранением проверьте список изменений.
      </p>
      {visibleError && (
        <div ref={errorRef} tabIndex={-1}>
          <Notice>{visibleError}</Notice>
        </div>
      )}
      <details className="bulk-recipient-fields">
        <summary>Должность и место работы</summary>
        <p className="fine-print">
          Заполните общую организацию или должность для выбранной группы. RU и
          KZ независимы. В режиме «Только пустые» индивидуальные значения
          сохраняются; замена требует отдельного подтверждения.
        </p>
        <div className="form-grid">
          {bulkRecipientFields.map(([field, label]) => (
            <div key={field} className="bulk-field">
              <label className="checkbox">
                <input
                  type="checkbox"
                  disabled={mode === "INHERITED"}
                  checked={Object.hasOwn(patch, field)}
                  onChange={(event) => {
                    setPatch((current) => {
                      const next = { ...current };
                      if (event.target.checked) next[field] = "";
                      else delete next[field];
                      return next;
                    });
                    reset();
                  }}
                />
                {label}
              </label>
              <input
                aria-label={`Общее значение: ${label}`}
                maxLength={500}
                disabled={mode === "INHERITED" || !Object.hasOwn(patch, field)}
                value={patch[field] || ""}
                onChange={(event) => {
                  setPatch({ ...patch, [field]: event.target.value });
                  reset();
                }}
              />
            </div>
          ))}
        </div>
      </details>
      <div className="form-grid">
        <label>
          Направление
          <select
            aria-label="Направление"
            aria-describedby="bulk-direction-help"
            value={direction}
            onChange={(e) => {
              setDirection(e.target.value);
              reset();
            }}
          >
            <option value="">Выберите направление</option>
            {directions.map((d) => (
              <option key={d} value={d}>
                {(
                  {
                    biot: "БиОТ",
                    ptm: "ПТМ",
                    pb: "Промышленная безопасность",
                    ps: "Промышленная безопасность (ПС)",
                  } as Record<string, string>
                )[d] || d}
              </option>
            ))}
          </select>
          <small id="bulk-direction-help">
            Нужно только для отмеченных полей документов.
          </small>
        </label>
        <label>
          Режим применения
          <select
            value={mode}
            onChange={(e) => {
              setMode(e.target.value as BulkMode);
              if (e.target.value === "INHERITED") {
                setPatch((current) => {
                  const next = { ...current };
                  for (const [field] of bulkRecipientFields) delete next[field];
                  return next;
                });
              }
              reset();
            }}
          >
            <option value="EMPTY">Заполнить только пустые</option>
            <option value="INHERITED">Изменить только наследуемые</option>
            <option value="REPLACE">Заменить отмеченные поля</option>
          </select>
        </label>
      </div>
      {mode === "INHERITED" && (
        <p className="fine-print">
          Ручные, импортированные и явно очищенные значения сохраняются. Новые
          значения фиксируются как исключения выбранных назначений; общий
          протокол требует одинаковых сведений события. Должность и место работы
          в этом режиме не меняются.
        </p>
      )}
      <div className="form-grid">
        {bulkFields.map(([field, label, type]) => (
          <div key={field} className="bulk-field">
            <label className="checkbox">
              <input
                type="checkbox"
                checked={Object.hasOwn(patch, field)}
                onChange={(e) => {
                  setPatch((old) => {
                    const next = { ...old };
                    if (e.target.checked) next[field] = "";
                    else delete next[field];
                    return next;
                  });
                  reset();
                }}
              />
              {label}
            </label>
            <input
              aria-label={`Общее значение: ${label}`}
              disabled={!Object.hasOwn(patch, field)}
              type={type}
              value={patch[field] || ""}
              onChange={(e) => {
                setPatch({ ...patch, [field]: e.target.value });
                reset();
              }}
            />
          </div>
        ))}
      </div>
      <p className="fine-print">
        Фактические результаты подтверждаются отдельно для конкретного события.
        Эти поля не меняют результат проверки.
      </p>
      {review && (
        <section
          ref={previewRef}
          tabIndex={-1}
          aria-label="Предварительные изменения"
        >
          <h3>
            {preview.people} человек
            {preview.assignments > 0
              ? ` · ${preview.assignments} назначений`
              : ""}{" "}
            · {preview.changes.length} изменений
          </h3>
          {documentFieldsSelected && (
            <p>
              Назначений других направлений без изменений: {preview.skipped}.
            </p>
          )}
          <div className="table-scroll bulk-preview">
            <table>
              <thead>
                <tr>
                  <th>Получатель / документ</th>
                  <th>Поле</th>
                  <th>Сейчас</th>
                  <th>Будет</th>
                </tr>
              </thead>
              <tbody>
                {preview.changes.map((c) => (
                  <tr key={`${c.recipientId}-${c.assignmentId}-${c.field}`}>
                    <td>
                      {c.name}
                      <small>
                        {c.assignmentId
                          ? templateLabels[c.templateId]
                          : "Данные человека"}
                      </small>
                    </td>
                    <td>
                      {
                        [...bulkRecipientFields, ...bulkFields].find(
                          ([f]) => f === c.field,
                        )?.[1]
                      }
                    </td>
                    <td>{c.before || "пусто"}</td>
                    <td>{c.after || "будет очищено"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {mode === "REPLACE" && (
            <label className="checkbox">
              <input
                type="checkbox"
                checked={confirmed}
                onChange={(e) => setConfirmed(e.target.checked)}
              />
              Подтверждаю замену отмеченных полей, включая индивидуальные
              значения
            </label>
          )}
        </section>
      )}
      <div className="modal-actions">
        <button disabled={busy} onClick={onClose}>
          Отмена
        </button>
        {!review ? (
          <button
            className="primary"
            disabled={
              (documentFieldsSelected && !direction) ||
              !Object.keys(patch).length
            }
            onClick={() => {
              setReview(true);
              requestAnimationFrame(() => {
                previewRef.current?.focus({ preventScroll: true });
                previewRef.current?.scrollIntoView({ block: "start" });
              });
            }}
          >
            Показать изменения
          </button>
        ) : (
          <button
            className="primary"
            disabled={
              busy ||
              !preview.changes.length ||
              (mode === "REPLACE" && !confirmed)
            }
            onClick={async () => {
              setBusy(true);
              setError("");
              setAttempted(true);
              try {
                await onApply(preview.items);
              } catch (caught) {
                setError(
                  caught instanceof Error
                    ? caught.message
                    : "Не удалось сохранить изменения",
                );
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy
              ? "Сохраняем…"
              : `Применить ${preview.changes.length} изменений`}
          </button>
        )}
      </div>
    </Modal>
  );
}
