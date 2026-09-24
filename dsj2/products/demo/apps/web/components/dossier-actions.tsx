"use client";
import { useState } from "react";
import { Notice } from "@demo/ui";
import { api, downloadExport, errorText } from "@/lib/api";
import { today } from "@demo/contracts";
export function DossierActions({
  records,
  timezone,
}: {
  records: {
    id: string;
    title?: string;
    category?: string;
    customerVisible?: boolean;
  }[];
  timezone: string;
}) {
  const [selected, setSelected] = useState<string[]>([]);
  const [asOf, setAsOf] = useState(today(timezone));
  const [reminders, setReminders] = useState<{
    items: { id: string; title: string; state: string; nextAction: string }[];
    limitation: string;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const allowed = records.filter(
    (r) => r.customerVisible && r.category !== "QUALIFICATION",
  );
  async function run(action: () => Promise<unknown>, message: string) {
    setBusy(true);
    setError("");
    setSuccess("");
    try {
      await action();
      setSuccess(message);
    } catch (c) {
      setError(errorText(c));
    } finally {
      setBusy(false);
    }
  }
  return (
    <details className="outcome-entry">
      <summary>Выбранное досье для заказчика и контроль сроков</summary>
      {error && <Notice>{error}</Notice>}
      {success && <Notice kind="success">{success}</Notice>}
      <p>
        В пакет входят только выбранные записи и вложения с разрешённым доступом
        заказчику. Внутренние квалификационные документы сотрудников недоступны
        в этом пакете.
      </p>
      <fieldset>
        <legend>Разрешённые записи для пакета</legend>
        {allowed.map((record) => (
          <label className="checkbox-label" key={record.id}>
            <input
              type="checkbox"
              checked={selected.includes(record.id)}
              onChange={(e) =>
                setSelected(
                  e.target.checked
                    ? [...selected, record.id]
                    : selected.filter((id) => id !== record.id),
                )
              }
            />
            {record.title}
          </label>
        ))}
        {!allowed.length && (
          <p>
            Разрешённых для передачи записей нет. Доступ задаётся явно в записи
            досье.
          </p>
        )}
      </fieldset>
      <button
        disabled={
          busy || !selected.some((id) => allowed.some((r) => r.id === id))
        }
        onClick={() =>
          void run(
            () =>
              downloadExport(
                "/dossier/export",
                {
                  recordIds: selected.filter((id) =>
                    allowed.some((r) => r.id === id),
                  ),
                },
                "Досье центра для заказчика.zip",
              ),
            "Разрешённый пакет подготовлен. Отправка заказчику не выполнялась.",
          )
        }
      >
        Скачать выбранное досье ZIP
      </button>
      <div className="form-grid">
        <label>
          Дата проверки сроков
          <input
            type="date"
            value={asOf}
            onChange={(e) => setAsOf(e.target.value)}
          />
        </label>
      </div>
      <button
        disabled={busy || !asOf}
        onClick={() =>
          void run(async () => {
            setReminders(
              await api(
                `/dossier/reminders?asOf=${encodeURIComponent(asOf)}&withinDays=30`,
              ),
            );
          }, "Сроки записей проверены.")
        }
      >
        Показать сроки на ближайшие 30 дней
      </button>
      {reminders && (
        <>
          <p>{reminders.limitation}</p>
          {reminders.items.map((item) => (
            <article className="milestone" key={item.id}>
              <strong>{item.title}</strong>
              <small>
                {item.state === "CONTACT_DUE"
                  ? "Приближается дата проверки"
                  : "Дата прошла — требуется проверка источника"}
              </small>
              <p>{item.nextAction}</p>
            </article>
          ))}
          {!reminders.items.length && (
            <p>
              Записей с наступающей датой проверки в выбранном интервале нет.
            </p>
          )}
        </>
      )}
    </details>
  );
}
