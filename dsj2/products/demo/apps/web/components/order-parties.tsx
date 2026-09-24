"use client";
import { useEffect, useState } from "react";
import { Notice } from "@demo/ui";
import { api, errorText, json } from "@/lib/api";
import { RecordPicker } from "./record-picker";

type Party = { id: string; nameRu: string };
export type OrderPartiesData = {
  id: string;
  revision: number;
  status: string;
  customerId?: string | null;
  employerId?: string | null;
  payerId?: string | null;
  customer?: Party | null;
  employer?: Party | null;
  payer?: Party | null;
};

export function OrderParties({
  order,
  readonly,
  onChanged,
}: {
  order: OrderPartiesData;
  readonly: boolean;
  onChanged: () => void | Promise<void>;
}) {
  const [employer, setEmployer] = useState<Party | null>(
    order.employer || order.customer || null,
  );
  const [payer, setPayer] = useState<Party | null>(order.payer || null);
  const [picker, setPicker] = useState<"employer" | "payer" | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  useEffect(() => {
    if (!busy) {
      setEmployer(order.employer || order.customer || null);
      setPayer(order.payer || null);
    }
  }, [order.employerId, order.payerId, order.customerId, busy]);
  const changed =
    (employer?.id || null) !== (order.employerId || order.customerId || null) ||
    (payer?.id || null) !== (order.payerId || null);
  async function save() {
    setBusy(true);
    setError("");
    setSuccess("");
    try {
      await api(`/orders/${order.id}`, {
        method: "PATCH",
        body: json({
          expectedRevision: order.revision,
          employerId: employer?.id || null,
          payerId: payer?.id || null,
          ...(order.status !== "OPEN" ? { status: "OPEN", reason } : {}),
        }),
      });
      await onChanged();
      setSuccess(
        "Стороны заказа сохранены. Состав и оставшиеся действия пересчитаны по работодателю участников.",
      );
    } catch (caught) {
      setError(errorText(caught));
    } finally {
      setBusy(false);
    }
  }
  return (
    <details className="outcome-entry">
      <summary>Заказчик, плательщик и работодатель участников</summary>
      <p>
        Заказчик: <strong>{order.customer?.nameRu || "Не указан"}</strong>.
      </p>
      <p>
        Работодатель определяет, чьи участники из связанных групп относятся к
        этому заказу. Плательщик учитывается отдельно. Выданные документы, права
        кабинета и ранее согласованные обязательства сохраняются.
      </p>
      {error && <Notice>{error}</Notice>}
      {success && <Notice kind="success">{success}</Notice>}
      <div className="form-grid">
        <div>
          <strong>Работодатель участников</strong>
          <p data-testid="order-employer">
            {employer?.nameRu || "Как заказчик"}
          </p>
          {!readonly && (
            <button disabled={busy} onClick={() => setPicker("employer")}>
              Выбрать работодателя участников
            </button>
          )}
        </div>
        <div>
          <strong>Плательщик</strong>
          <p data-testid="order-payer">{payer?.nameRu || "Не указан"}</p>
          {!readonly && (
            <>
              <button disabled={busy} onClick={() => setPicker("payer")}>
                Выбрать плательщика
              </button>
              {payer && (
                <button
                  disabled={busy}
                  className="text-button"
                  onClick={() => setPayer(null)}
                >
                  Убрать плательщика
                </button>
              )}
            </>
          )}
        </div>
      </div>
      {!readonly && (
        <>
          {order.status !== "OPEN" && (
            <label>
              Причина повторного открытия для изменения сторон
              <textarea
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                disabled={busy}
              />
            </label>
          )}
          <button
            disabled={
              busy || !changed || (order.status !== "OPEN" && !reason.trim())
            }
            onClick={() => void save()}
          >
            {busy ? "Сохраняем стороны…" : "Сохранить стороны заказа"}
          </button>
        </>
      )}
      {picker && (
        <RecordPicker
          kind="customers"
          onClose={() => setPicker(null)}
          onCustomer={(party) => {
            if (picker === "employer") setEmployer(party);
            else setPayer(party);
            setPicker(null);
            setError("");
            setSuccess("");
          }}
        />
      )}
    </details>
  );
}
