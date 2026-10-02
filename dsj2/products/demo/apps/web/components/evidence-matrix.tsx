"use client";
import { canManageCenter } from "@demo/contracts";
import { useEffect, useState } from "react";
import { Notice } from "@demo/ui";
import { api, errorText, json } from "@/lib/api";
import type { AppContext, Customer } from "@/lib/types";
import { RecordPicker } from "./record-picker";

type Rule = {
  id: string;
  title: string;
  version: number;
  status: string;
  source: string;
};
type Cell = {
  ruleId: string;
  state: string;
  source: "OWN" | "EXTERNAL" | null;
  originalNumber?: string;
  issuer?: string;
  documentDate?: string;
  validUntil?: string;
  sourceReference?: string;
  nextAction: string;
};
type Matrix = {
  columns: Rule[];
  rows: {
    recipientId: string;
    fullNameRu: string;
    currentness?: string;
    cells: Cell[];
  }[];
  limitation: string;
};
const states: Record<string, string> = {
  UNKNOWN: "Сведений нет",
  UNVERIFIED: "Источник не проверен",
  VERIFIED: "Источник проверен",
  VERIFIED_NO_EXPIRY: "Источник проверен, срок не указан",
  APPROACHING: "Срок приближается",
  REVIEW_DATE_PASSED: "Требуется уточнение срока",
  SUPERSEDED: "Документ заменён",
};

export function EvidenceMatrix({
  context,
  scanOnly = false,
  onChanged,
}: {
  context: AppContext;
  scanOnly?: boolean;
  onChanged?: () => void;
}) {
  const [rules, setRules] = useState<Rule[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [picker, setPicker] = useState(false);
  const [matrix, setMatrix] = useState<Matrix | null>(null);
  const [lead, setLead] = useState("30");
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [cursor, setCursor] = useState<string | null>(null);
  useEffect(() => {
    void api<{ items: Rule[] }>("/service-rules")
      .then((r) =>
        setRules(r.items.filter((rule) => rule.status === "APPROVED")),
      )
      .catch((c) => setError(errorText(c)));
  }, []);
  async function run() {
    setBusy(true);
    setError("");
    setSuccess("");
    try {
      if (scanOnly) {
        const result = await api<{
          scanned: number;
          created: number;
          existing: number;
          excluded: number;
          nextCursor: string | null;
        }>("/renewals/scan", {
          method: "POST",
          body: json({
            ruleVersionId: selected[0],
            contactLeadDays: Number(lead),
            confirmedPolicy: confirmed,
            ...(cursor ? { afterRequestId: cursor } : {}),
          }),
        });
        setSuccess(
          `Проверено записей: ${result.scanned}. Новых обращений для проверки: ${result.created}. Уже учтено: ${result.existing}. Исключено: ${result.excluded}. Потребности и результаты не подтверждены автоматически.`,
        );
        setCursor(result.nextCursor);
        onChanged?.();
      } else {
        setMatrix(
          await api<Matrix>("/evidence/matrix", {
            method: "POST",
            body: json({ customerId: customer?.id, ruleVersionIds: selected }),
          }),
        );
      }
    } catch (c) {
      setError(errorText(c));
    } finally {
      setBusy(false);
    }
  }
  return (
    <details className="outcome-entry">
      <summary>
        {scanOnly
          ? "Подготовить очередь по проверенному правилу"
          : "Матрица сведений: люди и программы"}
      </summary>
      {error && <Notice>{error}</Notice>}
      {success && <Notice kind="success">{success}</Notice>}
      <p>
        {scanOnly
          ? "Проверяются оформленные документы, связанные с выбранной версией правила. Срок берётся из сохранённого документа. Очередь требует подтверждения актуальности оператором."
          : "Сопоставьте людей заказчика с выбранными программами. Отсутствие сведений и непроверенный внешний источник показаны отдельно от проверенного документа."}
      </p>
      {!scanOnly && (
        <div className="toolbar-actions">
          <span>{customer?.nameRu || "Заказчик не выбран"}</span>
          <button onClick={() => setPicker(true)}>
            Выбрать заказчика для матрицы
          </button>
        </div>
      )}
      <fieldset>
        <legend>Утверждённые версии правил</legend>
        {rules.length ? (
          rules.map((rule) => (
            <label className="checkbox-label" key={rule.id}>
              <input
                type={scanOnly ? "radio" : "checkbox"}
                name={scanOnly ? "renewal-rule" : undefined}
                checked={selected.includes(rule.id)}
                disabled={
                  !scanOnly &&
                  selected.length >= 30 &&
                  !selected.includes(rule.id)
                }
                onChange={(e) => {
                  setSelected(
                    scanOnly
                      ? [rule.id]
                      : e.target.checked
                        ? [...selected, rule.id]
                        : selected.filter((id) => id !== rule.id),
                  );
                  setConfirmed(false);
                  setMatrix(null);
                  setCursor(null);
                }}
              />
              {rule.title} · версия {rule.version}
              <small>{rule.source}</small>
            </label>
          ))
        ) : (
          <p>
            Утверждённых правил нет. Директор проверяет источник и
            применимость в паспорте услуги.
          </p>
        )}
      </fieldset>
      {scanOnly && (
        <>
          <label>
            За сколько дней до срока предложить контакт
            <input
              type="number"
              min="0"
              max="365"
              value={lead}
              onChange={(e) => {
                setLead(e.target.value);
                setCursor(null);
                setConfirmed(false);
              }}
            />
          </label>
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(e) => setConfirmed(e.target.checked)}
            />
            Проверена применимость выбранной версии правила к сохранённым
            документам
          </label>
        </>
      )}
      <button
        disabled={
          busy ||
          !selected.length ||
          (scanOnly
            ? !canManageCenter(context.user.role) ||
              !confirmed ||
              !/^\d+$/.test(lead) ||
              Number(lead) > 365
            : !customer)
        }
        onClick={() => void run()}
      >
        {scanOnly
          ? cursor
            ? "Продолжить со следующей части истории"
            : "Подготовить обращения для проверки"
          : "Показать матрицу"}
      </button>
      {matrix && (
        <>
          <p>{matrix.limitation}</p>
          <div className="table-scroll">
            <table className="source-data-table">
              <thead>
                <tr>
                  <th>Получатель</th>
                  {matrix.columns.map((c) => (
                    <th key={c.id}>
                      {c.title}
                      <small>Версия {c.version}</small>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {matrix.rows.map((row) => (
                  <tr key={row.recipientId}>
                    <td>
                      {row.fullNameRu}
                      {row.currentness === "REQUIRES_CONFIRMATION" && (
                        <small>
                          Актуальность связи с работодателем требует
                          подтверждения
                        </small>
                      )}
                    </td>
                    {matrix.columns.map((column) => {
                      const cell = row.cells.find(
                        (c) => c.ruleId === column.id,
                      );
                      return (
                        <td key={column.id}>
                          {cell ? (
                            <>
                              <strong>
                                {states[cell.state] || cell.state}
                              </strong>
                              <small>
                                {cell.source === "OWN"
                                  ? "Документ центра"
                                  : cell.source === "EXTERNAL"
                                    ? "Внешний источник"
                                    : "Источник не известен"}
                              </small>
                              {cell.originalNumber && (
                                <small>№ {cell.originalNumber}</small>
                              )}
                              {cell.issuer && <small>{cell.issuer}</small>}
                              {cell.validUntil && (
                                <small>Срок документа: {cell.validUntil}</small>
                              )}
                              <p>{cell.nextAction}</p>
                            </>
                          ) : (
                            "Сведений нет"
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!matrix.rows.length && (
            <p>Нет доступных получателей выбранного заказчика.</p>
          )}
        </>
      )}
      {picker && (
        <RecordPicker
          kind="customers"
          onClose={() => setPicker(false)}
          onCustomer={(record) => {
            setCustomer(record);
            setMatrix(null);
            setPicker(false);
          }}
        />
      )}
    </details>
  );
}
