"use client";
import { useEffect, useRef, useState } from "react";
import { Modal, Notice } from "@demo/ui";
import {
  gridColumns,
  previewGridPaste,
  type GridField,
} from "@/lib/grid-paste";
import type { Recipient } from "@/lib/types";
export function GridPasteDialog({
  items,
  startRow,
  startField,
  text,
  columns,
  newRecipientsTraining,
  operationError,
  onClose,
  onApply,
}: {
  items: Recipient[];
  startRow: number;
  startField: GridField;
  text: string;
  columns?: readonly GridField[];
  newRecipientsTraining?: string;
  operationError?: string;
  onClose: () => void;
  onApply: (items: Recipient[]) => void | boolean | Promise<void | boolean>;
}) {
  const [mode, setMode] = useState<"EMPTY" | "REPLACE">("EMPTY");
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [blankRows, setBlankRows] = useState<"KEEP" | "SKIP" | "">("");
  const [saveError, setSaveError] = useState("");
  const [attempted, setAttempted] = useState(false);
  const visibleSaveError = attempted ? operationError || saveError : "";
  const errorRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (visibleSaveError) errorRef.current?.focus();
  }, [visibleSaveError]);
  let preview: ReturnType<typeof previewGridPaste> | undefined;
  let error = "";
  try {
    preview = previewGridPaste(
      items,
      startRow,
      startField,
      text,
      mode,
      columns,
      blankRows || "KEEP",
    );
  } catch (c) {
    error = c instanceof Error ? c.message : "Не удалось прочитать диапазон";
  }
  return (
    <Modal
      title="Вставка диапазона в заявку"
      onClose={() => {
        if (!busy) onClose();
      }}
      wide
    >
      <p>
        Начало: строка {startRow + 1}, колонка{" "}
        {gridColumns.find(([field]) => field === startField)?.[1]}. Строки
        следуют исходному порядку заявки, включая скрытые поиском.
      </p>
      <p className="muted">
        Порядок колонок:{" "}
        {(columns ?? gridColumns.map(([field]) => field))
          .map((field) => gridColumns.find(([key]) => key === field)?.[1])
          .join(" → ")}
        .
      </p>
      <label>
        Режим вставки
        <select
          value={mode}
          onChange={(e) => {
            setMode(e.target.value as typeof mode);
            setConfirmed(false);
          }}
        >
          <option value="EMPTY">Заполнить только пустые</option>
          <option value="REPLACE">Заменить значения диапазона</option>
        </select>
      </label>
      {error && <Notice>{error}</Notice>}
      {visibleSaveError && (
        <div ref={errorRef} tabIndex={-1}>
          <Notice>{visibleSaveError}</Notice>
        </div>
      )}
      {preview && (
        <>
          <p>
            {preview.rows} строк · {preview.columns} колонок ·{" "}
            {preview.changes.length} изменений · новых получателей:{" "}
            {preview.added}
          </p>
          {!!preview.blankRows.length && (
            <label>
              Полностью пустые строки диапазона: {preview.blankRows.join(", ")}
              <select
                aria-label="Полностью пустые строки диапазона"
                value={blankRows}
                onChange={(event) => {
                  setBlankRows(event.target.value as typeof blankRows);
                  setConfirmed(false);
                  setSaveError("");
                }}
              >
                <option value="">Выберите, сохранять ли пустые строки</option>
                <option value="KEEP">
                  Сохранить пустые строки, включая новых пустых получателей
                </option>
                <option value="SKIP">
                  Пропустить пустые строки и сдвинуть следующие строки диапазона
                  вверх
                </option>
              </select>
            </label>
          )}
          {preview.added > 0 && (
            <section aria-label="Новые строки диапазона">
              <p>
                Каждая новая строка будет создана в черновике.{" "}
                {newRecipientsTraining ||
                  "Обучение не назначается; его можно выбрать после вставки."}
              </p>
              <ul>
                {preview.createdRows.map((row) => (
                  <li key={row.sourceRow}>
                    Строка диапазона {row.sourceRow} → получатель {row.row}:{" "}
                    {row.blank
                      ? "полностью пустая строка"
                      : "данные из диапазона"}
                  </li>
                ))}
              </ul>
            </section>
          )}
          <p className="fine-print">
            Пропущено заполненных ячеек: {preview.skippedFilled}. Ячеек без
            изменений: {preview.unchanged}.
            {preview.skippedBlankRows > 0 &&
              ` Пустых строк пропущено по вашему выбору: ${preview.skippedBlankRows}.`}
          </p>
          {!preview.appliedRows && (
            <Notice kind="info">
              Все строки диапазона пустые и пропущены по вашему выбору.
              Изменений для применения нет.
            </Notice>
          )}
          <div className="table-scroll bulk-preview">
            <table>
              <thead>
                <tr>
                  <th>Строка</th>
                  <th>Колонка</th>
                  <th>Сейчас</th>
                  <th>Будет</th>
                </tr>
              </thead>
              <tbody>
                {preview.changes.map((c) => (
                  <tr key={`${c.row}-${c.field}`}>
                    <td>{c.row}</td>
                    <td>
                      {gridColumns.find(([field]) => field === c.field)?.[1]}
                    </td>
                    <td>{c.before || "пусто"}</td>
                    <td>{c.after || "очистить"}</td>
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
              Подтверждаю замену значений показанного диапазона
            </label>
          )}
        </>
      )}
      <div className="modal-actions">
        <button disabled={busy} onClick={onClose}>
          Отмена
        </button>
        <button
          className="primary"
          disabled={
            busy ||
            (!preview?.changes.length && !preview?.added) ||
            (!!preview?.blankRows.length && !blankRows) ||
            (mode === "REPLACE" && !confirmed)
          }
          onClick={async () => {
            if (!preview) return;
            setBusy(true);
            setSaveError("");
            setAttempted(true);
            try {
              const applied = await onApply(preview.items);
              if (applied === false)
                setSaveError(
                  "Диапазон не сохранён. План вставки остаётся в диалоге; исправьте причину и повторите применение.",
                );
            } catch (caught) {
              setSaveError(
                caught instanceof Error
                  ? caught.message
                  : "Не удалось сохранить диапазон. План вставки сохранён; повторите применение.",
              );
            } finally {
              setBusy(false);
            }
          }}
        >
          Применить диапазон
        </button>
      </div>
    </Modal>
  );
}
