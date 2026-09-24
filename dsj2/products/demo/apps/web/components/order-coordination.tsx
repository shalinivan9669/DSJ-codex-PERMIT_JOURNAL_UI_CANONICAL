"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { Notice } from "@demo/ui";
import { api, errorText, json } from "@/lib/api";
import type { AppContext } from "@/lib/types";
export type Proposal = {
  id: string;
  kind: string;
  status: string;
  message: string;
  requestId: string;
  requestRevision: number;
  resolution?: string;
  changes?: {
    rowId: string;
    fullNameRu?: string;
    fullNameKz?: string;
    positionRu?: string;
    positionKz?: string;
    employmentStatus?: string;
  }[];
};
export function OrderCoordination({
  order,
  context,
  onChanged,
}: {
  order: {
    id: string;
    revision: number;
    ownerId?: string | null;
    dueDate?: string | null;
    contact?: string;
    status: string;
    proposals?: Proposal[];
  };
  context: AppContext;
  onChanged: () => void;
}) {
  const [users, setUsers] = useState<{ id: string; displayName: string }[]>([
    { id: context.user.id, displayName: context.user.displayName },
  ]);
  const [owner, setOwner] = useState(order.ownerId || "");
  const [due, setDue] = useState(order.dueDate || "");
  const [contact, setContact] = useState(order.contact || "");
  const [reason, setReason] = useState("");
  const [resolution, setResolution] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const readonly = context.user.role === "VIEWER";
  useEffect(() => {
    if (context.user.role === "ADMIN")
      void api<{ items: { id: string; displayName: string; role: string }[] }>(
        "/users",
      )
        .then((r) => setUsers(r.items.filter((u) => u.role !== "EMPLOYER")))
        .catch((c) => setError(errorText(c)));
  }, [context.user.role]);
  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setError("");
    try {
      await action();
      onChanged();
    } catch (c) {
      setError(errorText(c));
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      {error && <Notice>{error}</Notice>}
      {!readonly && (
        <details className="outcome-entry">
          <summary>Ответственный, срок и завершение заказа</summary>
          <div className="form-grid">
            <label>
              Ответственный
              <select value={owner} onChange={(e) => setOwner(e.target.value)}>
                <option value="">Не назначен</option>
                {users.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.displayName}
                  </option>
                ))}
                {owner && !users.some((u) => u.id === owner) && (
                  <option value={owner}>Назначенный сотрудник</option>
                )}
              </select>
            </label>
            <label>
              Согласованный срок
              <input
                type="date"
                value={due}
                onChange={(e) => setDue(e.target.value)}
              />
            </label>
          </div>
          <label>
            Контакт / передача работы
            <input
              value={contact}
              onChange={(e) => setContact(e.target.value)}
              placeholder="Контакт заказчика или сведения для коллеги"
            />
          </label>
          <button
            disabled={busy}
            onClick={() =>
              void run(() =>
                api(`/orders/${order.id}`, {
                  method: "PATCH",
                  body: json({
                    expectedRevision: order.revision,
                    ownerId: owner || null,
                    dueDate: due || null,
                    contact,
                  }),
                }),
              )
            }
          >
            Сохранить ответственность и срок
          </button>
          <label>
            Основание завершения / отмены
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </label>
          <div className="toolbar-actions">
            <button
              disabled={busy || !reason.trim() || order.status === "COMPLETED"}
              onClick={() =>
                void run(() =>
                  api(`/orders/${order.id}`, {
                    method: "PATCH",
                    body: json({
                      expectedRevision: order.revision,
                      status: "COMPLETED",
                      reason,
                    }),
                  }),
                )
              }
            >
              Завершить исполнение заказа
            </button>
            <button
              disabled={busy || !reason.trim() || order.status === "CANCELLED"}
              onClick={() =>
                void run(() =>
                  api(`/orders/${order.id}`, {
                    method: "PATCH",
                    body: json({
                      expectedRevision: order.revision,
                      status: "CANCELLED",
                      reason,
                    }),
                  }),
                )
              }
            >
              Отменить заказ с причиной
            </button>
          </div>
          <p className="fine-print">
            Система проверит незавершённые обязательства и обращения. Изменение
            состояния заказа не аннулирует выданные документы.
          </p>
        </details>
      )}
      {!!order.proposals?.length && (
        <section className="outcome-entry">
          <h3>Обращения заказчика</h3>
          {order.proposals.map((p) => (
            <article className="milestone" key={p.id}>
              <strong>
                {(
                  {
                    UPDATE_LIST: "Изменения списка",
                    CONFIRM_LIST: "Подтверждение списка",
                    CLARIFICATION: "Уточнение",
                    REPEAT_REQUEST: "Повторная заявка",
                  } as Record<string, string>
                )[p.kind] || p.kind}
              </strong>
              <p>{p.message}</p>
              <small>
                Редакция списка {p.requestRevision}.{" "}
                {(
                  {
                    PENDING: "Нужно рассмотреть",
                    ACCEPTED: "Принято",
                    REJECTED: "Отклонено",
                  } as Record<string, string>
                )[p.status] || p.status}
              </small>
              <Link href={`/requests/${p.requestId}`}>Открыть заявку</Link>
              {p.changes?.map((change, index) => (
                <p key={change.rowId}>
                  Предложение {index + 1}:{" "}
                  {[
                    change.fullNameRu,
                    change.fullNameKz,
                    change.positionRu,
                    change.positionKz,
                    change.employmentStatus
                      ? (
                          {
                            CURRENT: "Работает",
                            LEFT: "Выбыл",
                            TRAINED_ELSEWHERE: "Обучен у другого поставщика",
                          } as Record<string, string>
                        )[change.employmentStatus]
                      : "",
                  ]
                    .filter(Boolean)
                    .join("; ")}
                </p>
              ))}
              {p.resolution && <p>{p.resolution}</p>}
              {!readonly && p.status === "PENDING" && (
                <>
                  <label>
                    Решение центра и основание
                    <textarea
                      value={resolution[p.id] || ""}
                      onChange={(e) =>
                        setResolution({ ...resolution, [p.id]: e.target.value })
                      }
                    />
                  </label>
                  <div className="toolbar-actions">
                    <button
                      disabled={busy || !resolution[p.id]?.trim()}
                      onClick={() =>
                        void run(() =>
                          api(`/orders/${order.id}/proposals/${p.id}/resolve`, {
                            method: "POST",
                            body: json({
                              status: "ACCEPTED",
                              resolution: resolution[p.id],
                            }),
                          }),
                        )
                      }
                    >
                      Принять и применить согласованные изменения
                    </button>
                    <button
                      disabled={busy || !resolution[p.id]?.trim()}
                      onClick={() =>
                        void run(() =>
                          api(`/orders/${order.id}/proposals/${p.id}/resolve`, {
                            method: "POST",
                            body: json({
                              status: "REJECTED",
                              resolution: resolution[p.id],
                            }),
                          }),
                        )
                      }
                    >
                      Отклонить с пояснением
                    </button>
                  </div>
                </>
              )}
            </article>
          ))}
        </section>
      )}
    </>
  );
}
