"use client";
import { useState } from "react";
import { Modal, Notice } from "@demo/ui";
import type { Customer, Recipient } from "@/lib/types";
import {
  patchRecipientEmployer,
  supplementRecipientEmployer,
} from "@/lib/recipient-employer";
import { RecordPicker } from "./record-picker";
import { CustomerDialog } from "./customers";

export function SharedEmployerDialog({
  items,
  selectedIds,
  customer,
  onEmployerChosen,
  onClose,
  onApply,
}: {
  items: Recipient[];
  selectedIds: string[];
  customer?: Customer;
  onEmployerChosen?: (customer: Customer) => void;
  onClose: () => void;
  onApply: (items: Recipient[]) => Promise<void>;
}) {
  const [employer, setEmployer] = useState<Customer | undefined>(customer);
  const [mode, setMode] = useState<"empty" | "all">("empty");
  const [view, setView] = useState<"main" | "picker" | "create">("main");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const ids = new Set(selectedIds);
  const selected = items.filter((item) => ids.has(item.id));
  const affected = selected.filter(
    (item) =>
      mode === "all" ||
      (!!employer && supplementRecipientEmployer(item, employer) !== item),
  );
  const choose = (value: Customer) => {
    onEmployerChosen?.(value);
    setEmployer(value);
    setView("main");
  };
  if (view === "picker")
    return (
      <RecordPicker
        kind="customers"
        onCustomer={choose}
        onClose={() => setView("main")}
      />
    );
  if (view === "create")
    return (
      <CustomerDialog
        customer={{}}
        onSaved={choose}
        onClose={() => setView("main")}
      />
    );
  return (
    <Modal
      title="Общая организация для людей"
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <p>
        Работодатель для {selected.length} получателей. Заказчик заявки остаётся
        прежним.
      </p>
      {error && <Notice>{error}</Notice>}
      {employer ? (
        <div className="employer-preview">
          <strong>{employer.nameRu}</strong>
          <span>{employer.nameKz}</span>
        </div>
      ) : (
        <p>
          Выберите работодателя или добавьте организацию по форме и названию.
        </p>
      )}
      <div className="toolbar-actions">
        <button disabled={busy} onClick={() => setView("picker")}>
          Выбрать организацию
        </button>
        <button disabled={busy} onClick={() => setView("create")}>
          Новая организация
        </button>
      </div>
      <fieldset className="choice-fieldset" disabled={busy}>
        <legend>Кому подставить организацию?</legend>
        <label className="checkbox-label">
          <input
            type="radio"
            name="employer-mode"
            checked={mode === "empty"}
            onChange={() => setMode("empty")}
          />
          Дополнить пустые реквизиты этой организации и людей без места работы
        </label>
        <label className="checkbox-label">
          <input
            type="radio"
            name="employer-mode"
            checked={mode === "all"}
            onChange={() => setMode("all")}
          />
          Всем {selected.length} выбранным, заменив текущее место работы
        </label>
      </fieldset>
      <p role="status">
        Будет изменено: {affected.length}.{" "}
        {selected.length - affected.length > 0
          ? `Сохранят своё место работы: ${selected.length - affected.length}.`
          : ""}
      </p>
      <div className="modal-actions">
        <button disabled={busy} onClick={onClose}>
          Отмена
        </button>
        <button
          className="primary"
          disabled={busy || !employer || !affected.length}
          onClick={async () => {
            if (!employer || busy) return;
            setBusy(true);
            setError("");
            const changed = new Set(affected.map((item) => item.id));
            try {
              await onApply(
                items.map((item) =>
                  changed.has(item.id)
                    ? mode === "all"
                      ? patchRecipientEmployer(item, employer)
                      : supplementRecipientEmployer(item, employer)
                    : item,
                ),
              );
            } catch {
              setError("Не удалось сохранить организацию. Повторите попытку.");
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? "Сохраняем…" : `Применить для ${affected.length}`}
        </button>
      </div>
    </Modal>
  );
}
