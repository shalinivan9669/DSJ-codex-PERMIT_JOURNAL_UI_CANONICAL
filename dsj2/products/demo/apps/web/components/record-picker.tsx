"use client";
import { useCabinetText, useCabinetError } from "./cabinet-language";
import { useEffect, useState } from "react";
import { Modal, Notice } from "@demo/ui";
import { api } from "@/lib/api";
import { type Customer, type Page, type Recipient } from "@/lib/types";
import { recordQueryIsCurrent, recordQueryKey } from "@/lib/record-query";
import { reuseRecipient, type StoredRecipient } from "@/lib/stored-recipient";

export { reuseRecipient } from "@/lib/stored-recipient";
export function RecordPicker({
  kind,
  onClose,
  onCustomer,
  onRecipient,
}: {
  kind: "customers" | "recipients";
  onClose: () => void;
  onCustomer?: (customer: Customer) => void;
  onRecipient?: (person: Recipient) => void;
}) {
  const tr = useCabinetText();
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [result, setResult] = useState<Page<Customer | StoredRecipient>>({
    items: [],
    total: 0,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useCabinetError();
  const [loadedQuery, setLoadedQuery] = useState<string>();
  const [failedQuery, setFailedQuery] = useState<string>();
  const [retry, setRetry] = useState(0);
  const query = recordQueryKey(kind, search, page);
  const current = recordQueryIsCurrent(query, loadedQuery, failedQuery);
  const loading = busy || (!current && failedQuery !== query);
  useEffect(() => {
    let active = true;
    setBusy(true);
    setError("");
    const timer = setTimeout(() => {
      api<Page<Customer | StoredRecipient>>(
        `/${kind}?${new URLSearchParams({ search, page: String(page), pageSize: "20" })}`,
      )
        .then((data) => {
          if (active) {
            setResult(data);
            setLoadedQuery(query);
            setFailedQuery(undefined);
            setError("");
          }
        })
        .catch((caught) => {
          if (active) {
            setError(caught);
            setFailedQuery(query);
          }
        })
        .finally(() => {
          if (active) setBusy(false);
        });
    }, 200);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [kind, page, search, query, retry]);
  return (
    <Modal
      title={
        kind === "customers"
          ? tr("Найти заказчика")
          : tr("Найти существующего получателя")
      }
      onClose={onClose}
      wide
    >
      <label>
        {tr("Поиск по справочнику")}<input
          autoFocus
          value={search}
          onChange={(e) => {
            setLoadedQuery(undefined);
            setFailedQuery(undefined);
            setSearch(e.target.value);
            setPage(1);
          }}
          placeholder={
            kind === "customers"
              ? tr("Название или БИН")
              : tr("ФИО, внешний или табельный номер")
          }
        />
      </label>
      {kind === "recipients" && (
        <p className="fine-print">
          {tr("Используем личные данные и подтверждённое фото. Даты нового события, результаты и документы выбираются заново.")}</p>
      )}
      {error && failedQuery === query && (
        <Notice>
          {error} {" "}{tr("Результаты этого поиска недоступны; измените запрос или повторите поиск.")}</Notice>
      )}
      {loading && <p role="status">{tr("Ищем по текущему запросу…")}</p>}
      <div className="table-scroll" aria-busy={loading}>
        <table>
          <thead>
            <tr>
              <th>{kind === "customers" ? tr("Организация") : tr("Получатель")}</th>
              <th>{tr("Идентификатор")}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {(current && !busy ? result.items : []).map((record) => {
              const customer = record as Customer;
              const recipient = record as StoredRecipient;
              return (
                <tr key={record.id}>
                  <td>
                    <strong>
                      {kind === "customers"
                        ? customer.nameRu
                        : recipient.data.fullNameRu}
                    </strong>
                    <small>
                      {kind === "customers"
                        ? customer.nameKz
                        : recipient.data.workplaceRu}
                    </small>
                  </td>
                  <td>
                    {kind === "customers"
                      ? customer.bin
                      : recipient.data.personnelNumber ||
                        recipient.data.externalId ||
                        tr("не указан")}
                  </td>
                  <td>
                    <button
                      disabled={!current || loading}
                      onClick={() => {
                        if (!current || loading) return;
                        if (kind === "customers") onCustomer?.(customer);
                        else onRecipient?.(reuseRecipient(recipient));
                      }}
                    >
                      {tr("Выбрать")}</button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {current && !loading && !result.items.length && (
        <p>{tr("Записи не найдены. Измените поиск или добавьте новую запись.")}</p>
      )}
      <div className="pagination">
        <span>
          {current
            ? `${tr("Найдено: ")}${result.total}${tr(" · страница ")}${page}`
            : `${tr("Страница ")}${page}`}
        </span>
        <div>
          <button
            disabled={loading || page === 1}
            onClick={() => {
              setLoadedQuery(undefined);
              setFailedQuery(undefined);
              setPage(page - 1);
            }}
          >
            {tr("Назад")}</button>
          <button
            disabled={loading || !current || page * 20 >= result.total}
            onClick={() => {
              setLoadedQuery(undefined);
              setFailedQuery(undefined);
              setPage(page + 1);
            }}
          >
            {tr("Далее")}</button>
        </div>
        {failedQuery === query && (
          <button
            onClick={() => {
              setFailedQuery(undefined);
              setLoadedQuery(undefined);
              setRetry(retry + 1);
            }}
          >
            {tr("Повторить поиск")}</button>
        )}
      </div>
    </Modal>
  );
}
