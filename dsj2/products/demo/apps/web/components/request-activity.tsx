"use client";
import { canManageCenter } from "@demo/contracts";
import { useEffect, useState } from "react";
import { Notice } from "@demo/ui";
import { api, errorText } from "@/lib/api";
import { dateTime } from "./request-list";

type Entry = {
  id: string;
  action: string;
  createdAt: string;
  actorName: string;
  details?: {
    comment?: string;
    reason?: string;
    operation?: string;
    signatures?: number;
  };
};
const actionNames: Record<string, string> = {
  CHANGE_PROPOSED: "Изменения отправлены на согласование",
  CHANGE_APPROVED: "Изменения согласованы",
  CHANGE_REJECTED: "Изменения возвращены на доработку",
  ISSUANCE_REGISTERED: "Комплект подготовлен к подписанию",
  SIGNATURE_VERIFIED: "ЭЦП проверена",
  ISSUANCE_COMPLETED: "Выдача завершена, комплект в архиве",
  ISSUANCE_CANCELLED: "Выдача аннулирована",
  CORRECTION_DRAFT_CREATED: "Создана заявка на исправление",
  DRAFT_ARCHIVED: "Заявка помещена в архив",
  REQUEST_CREATED: "Создана заявка",
  DRAFT_UPDATED: "Сохранена рабочая редакция",
  PREVIEW_REQUESTED: "Запрошен предварительный просмотр",
  IMPORT_APPLIED: "Импортированы сотрудники",
};

export function RequestActivity({
  requestId,
  role,
  revision,
}: {
  requestId: string;
  role: string;
  revision: number;
}) {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [error, setError] = useState("");
  const [refresh, setRefresh] = useState(0);
  const [action, setAction] = useState("");
  const [actor, setActor] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  useEffect(() => {
    let active = true;
    void api<{ items: Entry[] }>(`/print-requests/${requestId}/activity`)
      .then((value) => {
        if (active) {
          setEntries(value.items);
          setError("");
        }
      })
      .catch((caught) => {
        if (active) setError(errorText(caught));
      });
    return () => {
      active = false;
    };
  }, [requestId, revision, refresh]);
  const visible = entries.filter(
    (entry) =>
      (!action || entry.action === action) &&
      (!actor || entry.actorName === actor) &&
      (!from || entry.createdAt.slice(0, 10) >= from) &&
      (!to || entry.createdAt.slice(0, 10) <= to),
  );
  return (
    <details className="panel request-activity">
      <summary>История заявки</summary>
      <div className="section-heading">
        <p>
          {canManageCenter(role)
            ? "Последние 200 событий. Фильтры применяются к показанным событиям."
            : "Основные события согласования, подписания и выдачи."}
        </p>
        <button onClick={() => setRefresh((value) => value + 1)}>
          Обновить историю
        </button>
      </div>
      {error && <Notice>{error}</Notice>}
      {canManageCenter(role) && (
        <div className="form-grid">
          <label>
            Событие
            <select
              value={action}
              onChange={(event) => setAction(event.target.value)}
            >
              <option value="">Все события</option>
              {[...new Set(entries.map((entry) => entry.action))].map(
                (value) => (
                  <option key={value} value={value}>
                    {actionNames[value] || "Операция с заявкой"}
                  </option>
                ),
              )}
            </select>
          </label>
          <label>
            Сотрудник
            <select
              value={actor}
              onChange={(event) => setActor(event.target.value)}
            >
              <option value="">Все сотрудники</option>
              {[...new Set(entries.map((entry) => entry.actorName))].map(
                (value) => (
                  <option key={value}>{value}</option>
                ),
              )}
            </select>
          </label>
          <label>
            С даты
            <input
              type="date"
              value={from}
              onChange={(event) => setFrom(event.target.value)}
            />
          </label>
          <label>
            По дату
            <input
              type="date"
              value={to}
              onChange={(event) => setTo(event.target.value)}
            />
          </label>
        </div>
      )}
      {visible.length ? (
        <ol className="activity-list">
          {visible.map((entry) => (
            <li key={entry.id}>
              <strong>
                {actionNames[entry.action] || "Операция с заявкой"}
              </strong>
              <span>
                {dateTime(entry.createdAt)} · {entry.actorName}
              </span>
              {entry.details?.comment && <p>{entry.details.comment}</p>}
              {entry.details?.reason && <p>{entry.details.reason}</p>}
            </li>
          ))}
        </ol>
      ) : (
        <p className="muted">Нет событий по выбранным условиям.</p>
      )}
    </details>
  );
}
