"use client";
import { useEffect, useState } from "react";
import { Modal, Notice } from "@demo/ui";
import { api, errorText } from "@/lib/api";
import {
  newAssignment,
  type Customer,
  type Page,
  type Recipient,
} from "@/lib/types";

type StoredRecipient = { id: string; data: Recipient; archived?: boolean };
export function reuseRecipient(record: StoredRecipient): Recipient {
  const {
    assignments: _oldAssignments,
    importId: _importId,
    sourceRow: _sourceRow,
    ...person
  } = record.data;
  return {
    ...person,
    id: crypto.randomUUID(),
    recipientId: record.id,
    assignments: [newAssignment()],
  };
}
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
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [result, setResult] = useState<Page<Customer | StoredRecipient>>({
    items: [],
    total: 0,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    const timer = setTimeout(() => {
      setBusy(true);
      api<Page<Customer | StoredRecipient>>(
        `/${kind}?${new URLSearchParams({ search, page: String(page), pageSize: "20" })}`,
      )
        .then((data) => {
          if (active) {
            setResult(data);
            setError("");
          }
        })
        .catch((caught) => {
          if (active) setError(errorText(caught));
        })
        .finally(() => {
          if (active) setBusy(false);
        });
    }, 200);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [kind, page, search]);
  return (
    <Modal
      title={
        kind === "customers"
          ? "Найти заказчика"
          : "Найти существующего получателя"
      }
      onClose={onClose}
      wide
    >
      <label>
        Поиск по справочнику
        <input
          autoFocus
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(1);
          }}
          placeholder={
            kind === "customers"
              ? "Название или БИН"
              : "ФИО, внешний или табельный номер"
          }
        />
      </label>
      {kind === "recipients" && (
        <p className="fine-print">
          Используем личные данные и подтверждённое фото. Даты нового события,
          результаты и документы выбираются заново.
        </p>
      )}
      {error && <Notice>{error}</Notice>}
      <div className="table-scroll" aria-busy={busy}>
        <table>
          <thead>
            <tr>
              <th>{kind === "customers" ? "Организация" : "Получатель"}</th>
              <th>Идентификатор</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {result.items.map((record) => {
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
                        "не указан"}
                  </td>
                  <td>
                    <button
                      onClick={() => {
                        if (kind === "customers") onCustomer?.(customer);
                        else onRecipient?.(reuseRecipient(recipient));
                      }}
                    >
                      Выбрать
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {!busy && !result.items.length && (
        <p>Записи не найдены. Измените поиск или добавьте новую запись.</p>
      )}
      <div className="pagination">
        <span>
          Найдено: {result.total} · страница {page}
        </span>
        <div>
          <button
            disabled={busy || page === 1}
            onClick={() => setPage(page - 1)}
          >
            Назад
          </button>
          <button
            disabled={busy || page * 20 >= result.total}
            onClick={() => setPage(page + 1)}
          >
            Далее
          </button>
        </div>
      </div>
    </Modal>
  );
}
