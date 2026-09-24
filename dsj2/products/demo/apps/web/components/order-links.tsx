"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { Notice } from "@demo/ui";
import { api, errorText, json } from "@/lib/api";
import type { Customer, Draft } from "@/lib/types";
import { RecordPicker } from "./record-picker";

type RequestRow = {
  id: string;
  title: string;
  status: string;
  itemCount: number;
};
type OrderDetail = {
  id: string;
  title: string;
  status: string;
  revision: number;
  customerId: string | null;
  requests: { id: string; requestId: string; title: string }[];
};

export function OrderRequests({
  orderId,
  onChanged,
}: {
  orderId: string;
  onChanged: () => void | Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState<RequestRow[]>([]);
  const [total, setTotal] = useState(0);
  const [detail, setDetail] = useState<OrderDetail | null>(null);
  const [selected, setSelected] = useState<RequestRow | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [busy, setBusy] = useState(false);
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    if (!open) return;
    let alive = true;
    const timer = setTimeout(() => {
      setBusy(true);
      void Promise.all([
        api<OrderDetail>(`/orders/${orderId}`),
        api<{ items: RequestRow[]; total: number }>(
          `/print-requests?${new URLSearchParams({ search, page: String(page), pageSize: "20" })}`,
        ),
      ])
        .then(([order, result]) => {
          if (alive) {
            setDetail(order);
            setRows(result.items);
            setTotal(result.total);
            setError("");
          }
        })
        .catch((c) => {
          if (alive) setError(errorText(c));
        })
        .finally(() => {
          if (alive) setBusy(false);
        });
    }, 200);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [open, orderId, search, page, refresh]);
  async function attach() {
    if (!selected || !detail || !confirmed) return;
    setBusy(true);
    setError("");
    setSuccess("");
    try {
      await api(`/orders/${orderId}`, {
        method: "PATCH",
        body: json({
          expectedRevision: detail.revision,
          requestIds: [selected.id],
          ...(detail.status !== "OPEN" ? { status: "OPEN", reason } : {}),
        }),
      });
      setSuccess(
        "Заявка связана с заказом. Люди, события и выданные файлы не копировались.",
      );
      setSelected(null);
      setConfirmed(false);
      setReason("");
      setRefresh((v) => v + 1);
      await onChanged();
    } catch (c) {
      setError(errorText(c));
    } finally {
      setBusy(false);
    }
  }
  return (
    <details
      className="outcome-entry"
      onToggle={(e) => setOpen(e.currentTarget.open)}
    >
      <summary>Группы и заявки заказа</summary>
      <p>
        Добавьте другую группу или дату из существующей заявки. Одну смешанную
        группу можно связать с несколькими заказами: каждый заказ учитывает
        только своего работодателя.
      </p>
      {error && <Notice>{error}</Notice>}
      {success && <Notice kind="success">{success}</Notice>}
      {detail?.requests.map((row) => (
        <p key={row.requestId}>
          <Link href={`/requests/${row.requestId}`}>
            {row.title || "Связанная заявка"}
          </Link>
        </p>
      ))}
      <label>
        Найти заявку для связи
        <input
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(1);
            setSelected(null);
            setConfirmed(false);
          }}
        />
      </label>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Заявка</th>
              <th>Состав</th>
              <th>Действие</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const linked = detail?.requests.some(
                (r) => r.requestId === row.id,
              );
              return (
                <tr key={row.id}>
                  <td>
                    {row.title || "Без названия"}
                    <small>
                      {row.status === "DRAFT"
                        ? "Черновик"
                        : row.status === "FINALIZED"
                          ? "Оформлена"
                          : "Отменена"}
                    </small>
                  </td>
                  <td>{row.itemCount} получателей в исходной заявке</td>
                  <td>
                    <button
                      disabled={busy || linked || row.status === "CANCELLED"}
                      onClick={() => {
                        setSelected(row);
                        setConfirmed(false);
                        setSuccess("");
                      }}
                    >
                      {linked ? "Уже связана" : "Выбрать заявку"}
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="pagination">
        <span>
          Найдено: {total} · страница {page}
        </span>
        <div>
          <button
            disabled={busy || page === 1}
            onClick={() => setPage((v) => v - 1)}
          >
            Предыдущие заявки
          </button>
          <button
            disabled={busy || page * 20 >= total}
            onClick={() => setPage((v) => v + 1)}
          >
            Следующие заявки
          </button>
        </div>
      </div>
      {selected && (
        <div className="outcome-entry">
          <p>
            Связать «{selected.title}» с заказом «{detail?.title}».
          </p>
          {detail?.status !== "OPEN" && (
            <label>
              Основание повторного открытия заказа
              <textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            </label>
          )}
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(e) => setConfirmed(e.target.checked)}
            />
            Подтверждаю связь группы с этим заказом
          </label>
          <button
            disabled={
              busy ||
              !confirmed ||
              (detail?.status !== "OPEN" && !reason.trim())
            }
            onClick={() => void attach()}
          >
            Связать выбранную заявку
          </button>
        </div>
      )}
    </details>
  );
}

export function RequestOrderLink({
  draft,
  flush,
}: {
  draft: Draft;
  flush: () => Promise<number>;
}) {
  const [open, setOpen] = useState(false),
    [search, setSearch] = useState(""),
    [busy, setBusy] = useState(false),
    [picker, setPicker] = useState(false);
  const [orders, setOrders] = useState<OrderDetail[]>([]),
    [selected, setSelected] = useState<OrderDetail | null>(null),
    [customer, setCustomer] = useState<Customer | null>(null);
  const [title, setTitle] = useState(draft.title || "Заказ по группе"),
    [reason, setReason] = useState(""),
    [confirmed, setConfirmed] = useState(false),
    [error, setError] = useState(""),
    [success, setSuccess] = useState("");
  useEffect(() => {
    if (!open) return;
    let alive = true;
    const timer = setTimeout(() => {
      setBusy(true);
      void api<{ items: OrderDetail[] }>(
        `/orders?search=${encodeURIComponent(search)}`,
      )
        .then((result) => {
          if (alive) {
            setOrders(result.items);
            setError("");
          }
        })
        .catch((c) => {
          if (alive) setError(errorText(c));
        })
        .finally(() => {
          if (alive) setBusy(false);
        });
    }, 200);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [open, search]);
  async function run(create: boolean) {
    setBusy(true);
    setError("");
    setSuccess("");
    try {
      await flush();
      if (create) {
        await api("/orders", {
          method: "POST",
          body: json({
            title,
            customerId: customer!.id,
            requestIds: [draft.id],
          }),
        });
      } else {
        const current = await api<OrderDetail>(`/orders/${selected!.id}`);
        await api(`/orders/${current.id}`, {
          method: "PATCH",
          body: json({
            expectedRevision: current.revision,
            requestIds: [draft.id],
            ...(current.status !== "OPEN" ? { status: "OPEN", reason } : {}),
          }),
        });
      }
      setSuccess(
        create
          ? "Создан заказ выбранного работодателя, связанный с этой группой."
          : "Группа связана с существующим заказом без копирования заявки.",
      );
      setSelected(null);
      setConfirmed(false);
    } catch (c) {
      setError(errorText(c));
    } finally {
      setBusy(false);
    }
  }
  return (
    <details
      className="outcome-entry"
      onToggle={(e) => setOpen(e.currentTarget.open)}
    >
      <summary>Связать группу с заказом или другим работодателем</summary>
      <p>
        Выданный протокол остаётся общим. Доступ заказчика и состав его заказа
        ограничиваются его участниками.
      </p>
      {error && <Notice>{error}</Notice>}
      {success && (
        <Notice kind="success">
          {success} <Link href="/workbench">Перейти к заказам</Link>
        </Notice>
      )}
      <label>
        Поиск существующего заказа
        <input
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setSelected(null);
            setConfirmed(false);
          }}
        />
      </label>
      <label>
        Существующий заказ
        <select
          value={selected?.id || ""}
          onChange={(e) => {
            setSelected(orders.find((o) => o.id === e.target.value) || null);
            setConfirmed(false);
          }}
        >
          <option value="">Выберите заказ</option>
          {orders.map((order) => (
            <option key={order.id} value={order.id}>
              {order.title}
              {order.requests.some((r) => r.requestId === draft.id)
                ? " · уже связан"
                : ""}
            </option>
          ))}
        </select>
      </label>
      {selected && (
        <>
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(e) => setConfirmed(e.target.checked)}
            />
            Подтверждаю добавление этой группы в выбранный заказ
          </label>
          {selected.status !== "OPEN" && (
            <label>
              Причина повторного открытия заказа
              <textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            </label>
          )}
          <button
            disabled={
              busy ||
              !confirmed ||
              (selected.status !== "OPEN" && !reason.trim())
            }
            onClick={() => void run(false)}
          >
            Добавить группу в существующий заказ
          </button>
        </>
      )}
      <details>
        <summary>Создать отдельный заказ работодателя из этой группы</summary>
        <label>
          Название отдельного заказа
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={255}
          />
        </label>
        <p>{customer?.nameRu || "Работодатель не выбран"}</p>
        <button disabled={busy} onClick={() => setPicker(true)}>
          Выбрать работодателя для заказа
        </button>
        <button
          disabled={busy || !customer || !title.trim()}
          onClick={() => void run(true)}
        >
          Создать заказ работодателя
        </button>
      </details>
      {picker && (
        <RecordPicker
          kind="customers"
          onClose={() => setPicker(false)}
          onCustomer={(value) => {
            setCustomer(value);
            setPicker(false);
          }}
        />
      )}
    </details>
  );
}
