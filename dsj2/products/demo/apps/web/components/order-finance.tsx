"use client";
import { canManageCenter } from "@demo/contracts";
import { useState } from "react";
import { Notice } from "@demo/ui";
import { api, errorText, json } from "@/lib/api";
import { kztToMinor, minorToKzt } from "@/lib/money";
import type { AppContext } from "@/lib/types";
type Line = {
  label: string;
  unit: "PERSON_SERVICE" | "GROUP" | "FIXED";
  quantity: number;
  unitPriceMinor: string;
  discountMinor: string;
  discountReason: string;
  serviceVersion?: string;
};
export type Commercial = {
  lines?: Line[];
  taxRateBasisPoints?: number | null;
  taxBasis?: string;
  subtotalMinor?: string;
  taxMinor?: string | null;
  totalMinor?: string | null;
  paidMinor?: string;
  paymentState?: string;
};
export function OrderFinance({
  orderId,
  revision,
  commercial,
  context,
  onChanged,
}: {
  orderId: string;
  revision: number;
  commercial: Commercial;
  context: AppContext;
  onChanged: () => void | Promise<void>;
}) {
  const [lines, setLines] = useState<Line[]>(commercial.lines || []);
  const [tax, setTax] = useState(
    commercial.taxRateBasisPoints === null ||
      commercial.taxRateBasisPoints === undefined
      ? ""
      : String(commercial.taxRateBasisPoints),
  );
  const [taxBasis, setTaxBasis] = useState(commercial.taxBasis || "");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [payment, setPayment] = useState("");
  const [date, setDate] = useState("");
  const [source, setSource] = useState("");
  const [documentType, setDocumentType] = useState("INVOICE");
  const [number, setNumber] = useState("");
  const readonly = context.user.role === "VIEWER";
  async function run(action: () => Promise<unknown>) {
    setError("");
    setBusy(true);
    try {
      await action();
      await onChanged();
    } catch (c) {
      setError(errorText(c));
    } finally {
      setBusy(false);
    }
  }
  return (
    <details className="outcome-entry">
      <summary>Расчёты и финансовые основания</summary>
      {error && <Notice>{error}</Notice>}
      {commercial.subtotalMinor !== undefined && (
        <p>
          Стоимость услуг до налога: {minorToKzt(commercial.subtotalMinor)} KZT
          · Налог:{" "}
          {commercial.taxMinor === null || commercial.taxMinor === undefined
            ? "требует уточнения"
            : `${minorToKzt(commercial.taxMinor)} KZT`}
        </p>
      )}
      <p>
        Согласовано: {minorToKzt(commercial.totalMinor)} KZT · Оплачено:{" "}
        {minorToKzt(commercial.paidMinor || "0")} KZT
      </p>
      <p className="fine-print">
        Цена задаётся за согласованную услугу. Количество напечатанных
        документов не определяет стоимость. Налог не предполагается
        автоматически.
      </p>
      <p className="fine-print mobile-table-hint">
        Прокрутите таблицу вправо, чтобы увидеть все поля услуги.
      </p>
      <div className="table-scroll">
        <table className="finance-table">
          <thead>
            <tr>
              <th>Услуга</th>
              <th>Единица</th>
              <th>Количество</th>
              <th>Цена, KZT</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {lines.map((line, index) => (
              <tr key={index}>
                <td>
                  <input
                    aria-label={`Услуга ${index + 1}`}
                    disabled={readonly}
                    value={line.label}
                    onChange={(e) =>
                      setLines(
                        lines.map((v, i) =>
                          i === index ? { ...v, label: e.target.value } : v,
                        ),
                      )
                    }
                  />
                </td>
                <td>
                  <select
                    aria-label={`Единица услуги ${index + 1}`}
                    disabled={readonly}
                    value={line.unit}
                    onChange={(e) =>
                      setLines(
                        lines.map((v, i) =>
                          i === index
                            ? { ...v, unit: e.target.value as Line["unit"] }
                            : v,
                        ),
                      )
                    }
                  >
                    <option value="PERSON_SERVICE">Человек / услуга</option>
                    <option value="GROUP">Группа</option>
                    <option value="FIXED">Фиксированно</option>
                  </select>
                </td>
                <td>
                  <input
                    aria-label={`Количество услуги ${index + 1}`}
                    disabled={readonly}
                    type="number"
                    min="1"
                    step="1"
                    value={line.quantity}
                    onChange={(e) =>
                      setLines(
                        lines.map((v, i) =>
                          i === index
                            ? { ...v, quantity: Number(e.target.value) }
                            : v,
                        ),
                      )
                    }
                  />
                </td>
                <td>
                  <MoneyInput
                    label={`Цена услуги ${index + 1}`}
                    value={line.unitPriceMinor}
                    disabled={readonly}
                    onChange={(value) =>
                      setLines(
                        lines.map((v, i) =>
                          i === index ? { ...v, unitPriceMinor: value } : v,
                        ),
                      )
                    }
                  />
                </td>
                <td>
                  <button
                    disabled={readonly}
                    aria-label={`Убрать услугу ${index + 1}`}
                    onClick={() =>
                      setLines(lines.filter((_, i) => i !== index))
                    }
                  >
                    Убрать
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!readonly && (
        <button
          onClick={() =>
            setLines([
              ...lines,
              {
                label: "",
                unit: "PERSON_SERVICE",
                quantity: 1,
                unitPriceMinor: "0",
                discountMinor: "0",
                discountReason: "",
              },
            ])
          }
        >
          Добавить согласованную услугу
        </button>
      )}
      <div className="form-grid">
        <label>
          Налоговая ставка
          <select
            disabled={readonly}
            value={tax}
            onChange={(e) => setTax(e.target.value)}
          >
            <option value="">Требуется уточнение</option>
            <option value="0">0% / без налога по основанию</option>
            <option value="1200">12%</option>
            <option value="1600">16%</option>
          </select>
        </label>
        <label>
          Основание налогового расчёта
          <input
            disabled={readonly}
            value={taxBasis}
            onChange={(e) => setTaxBasis(e.target.value)}
            placeholder="Подтверждённые условия расчёта"
          />
        </label>
      </div>
      {!readonly && (
        <button
          disabled={
            busy ||
            !lines.length ||
            lines.some(
              (l) => !l.label.trim() || !/^\d+$/.test(l.unitPriceMinor),
            ) ||
            (tax !== "" && !taxBasis.trim())
          }
          onClick={() =>
            void run(() =>
              api(`/orders/${orderId}/commercial`, {
                method: "PUT",
                body: json({
                  expectedRevision: revision,
                  lines,
                  taxRateBasisPoints: tax === "" ? null : Number(tax),
                  taxBasis,
                }),
              }),
            )
          }
        >
          Сохранить согласованный расчёт
        </button>
      )}
      {!readonly && (
        <details>
          <summary>Реквизиты договора, счёта или акта</summary>
          <div className="form-grid">
            <label>
              Вид документа
              <select
                value={documentType}
                onChange={(e) => setDocumentType(e.target.value)}
              >
                <option value="CONTRACT">Договор</option>
                <option value="INVOICE">Счёт</option>
                <option value="ACT">Акт</option>
              </select>
            </label>
            <label>
              Номер
              <input
                value={number}
                onChange={(e) => setNumber(e.target.value)}
              />
            </label>
            <label>
              Дата
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
              />
            </label>
            <label>
              Источник / реквизиты
              <input
                value={source}
                onChange={(e) => setSource(e.target.value)}
              />
            </label>
          </div>
          <button
            disabled={busy || !number.trim() || !date || !source.trim()}
            onClick={() =>
              void run(() =>
                api(`/orders/${orderId}/financial-documents`, {
                  method: "POST",
                  body: json({
                    type: documentType,
                    number,
                    documentDate: date,
                    source,
                  }),
                }),
              )
            }
          >
            Сохранить реквизиты
          </button>
        </details>
      )}
      {canManageCenter(context.user.role) && (
        <details>
          <summary>Зафиксировать подтверждённый платёж</summary>
          <label>
            Сумма, KZT
            <input
              value={payment}
              inputMode="decimal"
              onChange={(e) => setPayment(e.target.value)}
            />
          </label>
          <label>
            Дата платежа
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </label>
          <label>
            Источник подтверждения платежа
            <input value={source} onChange={(e) => setSource(e.target.value)} />
          </label>
          <button
            disabled={busy || !payment || !date || !source.trim()}
            onClick={() =>
              void run(() =>
                api(`/orders/${orderId}/payments`, {
                  method: "POST",
                  body: json({
                    amountMinor: kztToMinor(payment),
                    occurredOn: date,
                    source,
                    reconciliationRequired: false,
                  }),
                }),
              )
            }
          >
            Зафиксировать платёж
          </button>
        </details>
      )}
    </details>
  );
}
function MoneyInput({
  value,
  onChange,
  disabled,
  label,
}: {
  value: string;
  onChange: (value: string) => void;
  disabled: boolean;
  label: string;
}) {
  const [text, setText] = useState(minorToKzt(value));
  const [invalid, setInvalid] = useState(false);
  return (
    <>
      <input
        aria-label={label}
        aria-invalid={invalid}
        disabled={disabled}
        inputMode="decimal"
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          try {
            onChange(kztToMinor(e.target.value));
            setInvalid(false);
          } catch {
            setInvalid(true);
            onChange("");
          }
        }}
      />
      {invalid && (
        <small className="field-error">
          Не более двух знаков после запятой
        </small>
      )}
    </>
  );
}
