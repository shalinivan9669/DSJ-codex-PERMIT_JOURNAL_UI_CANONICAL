"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { Notice } from "@demo/ui";
import { api, errorText, json } from "@/lib/api";
import type { Recipient, Customer } from "@/lib/types";
import { RecordPicker } from "./record-picker";
import { CustomerDialog } from "./customers";
type History = {
  employment: {
    id: string;
    employerId: string;
    positionRu: string;
    personnelNumber?: string;
    period?: string;
  }[];
  requests: { requestId: string }[];
};
export function RecipientRecord({
  recipient,
  disabled,
  onChange,
}: {
  recipient: Recipient;
  disabled: boolean;
  onChange: (recipient: Recipient) => void;
}) {
  const [history, setHistory] = useState<History | null>(null);
  const [employer, setEmployer] = useState<Customer | null>(null);
  const [employerNames, setEmployerNames] = useState<Record<string, string>>(
    {},
  );
  const [picker, setPicker] = useState(false);
  const [createEmployer, setCreateEmployer] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  useEffect(() => {
    setSuccess("");
    setError("");
  }, [recipient.id, recipient.employerId]);
  useEffect(() => {
    let active = true;
    setHistory(null);
    setEmployer(null);
    setConfirmed(false);
    if (recipient.recipientId)
      void api<History>(`/recipients/${recipient.recipientId}`)
        .then((r) => {
          if (active) setHistory(r);
        })
        .catch((c) => {
          if (active) setError(errorText(c));
        });
    if (recipient.employerId)
      void api<Customer>(`/customers/${recipient.employerId}`)
        .then((r) => {
          if (active) setEmployer(r);
        })
        .catch((c) => {
          if (active) setError(errorText(c));
        });
    return () => {
      active = false;
    };
  }, [recipient.id, recipient.recipientId, recipient.employerId]);
  useEffect(() => {
    let active = true;
    setEmployerNames({});
    const employerIds = [
      ...new Set(history?.employment.map((period) => period.employerId) || []),
    ];
    void Promise.allSettled(
      employerIds.map(async (id) => {
        const value = await api<Customer>(`/customers/${id}`);
        return [id, value.nameRu] as const;
      }),
    ).then((results) => {
      if (active)
        setEmployerNames(
          Object.fromEntries(
            results.flatMap((result) =>
              result.status === "fulfilled" ? [result.value] : [],
            ),
          ),
        );
    });
    return () => {
      active = false;
    };
  }, [history]);
  async function save() {
    setBusy(true);
    setError("");
    try {
      const saved = await api<{ id: string }>(
        recipient.recipientId
          ? `/recipients/${recipient.recipientId}`
          : "/recipients",
        {
          method: recipient.recipientId ? "PATCH" : "POST",
          body: json({ ...recipient, assignments: [] }),
        },
      );
      onChange({ ...recipient, recipientId: saved.id });
      setConfirmed(false);
      setSuccess(
        "Текущие сведения человека сохранены в справочнике. Оформленные документы остаются неизменными.",
      );
      if (saved.id) setHistory(await api<History>(`/recipients/${saved.id}`));
    } catch (c) {
      setError(errorText(c));
    } finally {
      setBusy(false);
    }
  }
  function chooseEmployer(value: Customer) {
    setEmployer(value);
    setPicker(false);
    setCreateEmployer(false);
    setConfirmed(false);
    onChange({
      ...recipient,
      employerId: value.id,
      workplaceRu: value.nameRu,
      workplaceKz: value.nameKz,
      employerBin: value.bin,
      employerAddressRu: value.addressRu,
      employerAddressKz: value.addressKz,
    });
  }
  return (
    <details className="outcome-entry">
      <summary>Постоянная запись, работодатель и история</summary>
      {error && <Notice>{error}</Notice>}
      {success && <Notice kind="success">{success}</Notice>}
      <p>
        {recipient.recipientId
          ? "Человек связан с постоянной записью. Сведения текущего обращения могут отличаться от сохранённой истории."
          : "При необходимости сохраните человека для следующих обращений. Одинаковое ФИО само по себе не связывает разные записи."}
      </p>
      <div className="form-grid">
        {[
          ["personnelNumber", "Табельный номер"],
          ["externalId", "Внешний устойчивый ID"],
          ["employmentPeriod", "Период работы / основание актуальности"],
        ].map(([key, label]) => (
          <label key={key}>
            {label}
            <input
              disabled={disabled}
              value={String(recipient[key as keyof Recipient] || "")}
              onChange={(e) => {
                onChange({ ...recipient, [key]: e.target.value });
                setConfirmed(false);
              }}
            />
          </label>
        ))}
      </div>
      <p>Работодатель: {employer?.nameRu || "не связан со справочником"}</p>
      <button disabled={disabled} onClick={() => setPicker(true)}>
        Выбрать работодателя
      </button>
      <button disabled={disabled} onClick={() => setCreateEmployer(true)}>
        Добавить организацию работодателя
      </button>
      {!disabled && (
        <>
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(e) => setConfirmed(e.target.checked)}
            />
            Подтверждаю актуальность сведений для постоянной записи человека
          </label>
          <button
            disabled={busy || !confirmed || !recipient.fullNameRu.trim()}
            onClick={() => void save()}
          >
            {recipient.recipientId
              ? "Обновить текущие сведения человека"
              : "Сохранить человека в справочник"}
          </button>
        </>
      )}
      {!!history?.employment.length && (
        <>
          <h4>Сохранённые периоды работы</h4>
          {history.employment.map((period) => (
            <p key={period.id}>
              {employerNames[period.employerId] || "Сохранённый работодатель"} ·{" "}
              {period.positionRu || "Должность не указана"}
              {period.personnelNumber
                ? ` · табельный ${period.personnelNumber}`
                : ""}{" "}
              · {period.period || "Период не указан"}
            </p>
          ))}
        </>
      )}
      {!!history?.requests.length && (
        <>
          <h4>Обращения и оформленные файлы</h4>
          <div className="toolbar-actions">
            {[...new Set(history.requests.map((r) => r.requestId))].map(
              (id, index) => (
                <Link className="button" key={id} href={`/requests/${id}`}>
                  Открыть обращение {index + 1}
                </Link>
              ),
            )}
          </div>
        </>
      )}
      {picker && (
        <RecordPicker
          kind="customers"
          onClose={() => setPicker(false)}
          onCustomer={chooseEmployer}
        />
      )}
      {createEmployer && (
        <CustomerDialog
          customer={{}}
          onClose={() => setCreateEmployer(false)}
          onSaved={chooseEmployer}
        />
      )}
    </details>
  );
}
