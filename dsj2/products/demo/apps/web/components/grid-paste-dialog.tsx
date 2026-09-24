"use client";
import { useState } from "react";
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
  onClose,
  onApply,
}: {
  items: Recipient[];
  startRow: number;
  startField: GridField;
  text: string;
  onClose: () => void;
  onApply: (items: Recipient[]) => void | Promise<void>;
}) {
  const [mode, setMode] = useState<"EMPTY" | "REPLACE">("EMPTY");
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  let preview: ReturnType<typeof previewGridPaste> | undefined;
  let error = "";
  try {
    preview = previewGridPaste(items, startRow, startField, text, mode);
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
      {preview && (
        <>
          <p>
            {preview.rows} строк · {preview.columns} колонок ·{" "}
            {preview.changes.length} изменений · новых получателей:{" "}
            {preview.added}
          </p>
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
            !preview?.changes.length ||
            (mode === "REPLACE" && !confirmed)
          }
          onClick={async () => {
            if (!preview) return;
            setBusy(true);
            try {
              await onApply(preview.items);
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
