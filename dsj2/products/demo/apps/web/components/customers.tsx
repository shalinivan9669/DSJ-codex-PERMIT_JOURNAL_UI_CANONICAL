"use client";
import { useEffect, useState, type FormEvent } from "react";
import { Icon, Modal, Notice } from "@demo/ui";
import { api, errorText, json } from "@/lib/api";
import type { AppContext, Customer, Page } from "@/lib/types";
const emptyCustomer = {
  nameRu: "",
  nameKz: "",
  bin: "",
  addressRu: "",
  addressKz: "",
  archived: false,
};
export function Customers({ context }: { context: AppContext }) {
  const [rows, setRows] = useState<Page<Customer>>({ items: [], total: 0 });
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [edit, setEdit] = useState<Partial<Customer> | null>(null);
  const [error, setError] = useState("");
  const [refresh, setRefresh] = useState(0);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    let active = true;
    const timer = setTimeout(() => {
      setLoading(true);
      api<Page<Customer>>(
        `/customers?${new URLSearchParams({ search, page: String(page), pageSize: "20" })}`,
      )
        .then((result) => {
          if (active) {
            setRows(result);
            setError("");
          }
        })
        .catch((caught) => {
          if (active) setError(errorText(caught));
        })
        .finally(() => {
          if (active) setLoading(false);
        });
    }, 200);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [page, search, refresh]);
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>Заказчики</h1>
          <p>
            Организации внутри вашего центра. Реквизиты RU и KZ сохраняются
            отдельно.
          </p>
        </div>
        {context.user.role !== "VIEWER" && (
          <button className="primary" onClick={() => setEdit(emptyCustomer)}>
            <Icon name="plus" />
            Добавить заказчика
          </button>
        )}
      </div>
      {error && <Notice>{error}</Notice>}
      <section className="panel">
        <div className="toolbar">
          <label className="search-field">
            <Icon name="search" />
            <input
              aria-label="Поиск заказчиков"
              placeholder="Название или БИН"
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                setPage(1);
              }}
            />
          </label>
          <span className="count muted">Всего: {rows.total}</span>
        </div>
        <div className="table-scroll" aria-busy={loading}>
          <table>
            <thead>
              <tr>
                <th>Название на русском</th>
                <th>Название на казахском</th>
                <th>БИН</th>
                <th>Статус</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.items.map((customer) => (
                <tr key={customer.id}>
                  <td>
                    <strong>{customer.nameRu}</strong>
                    <small>{customer.addressRu}</small>
                  </td>
                  <td>{customer.nameKz || "—"}</td>
                  <td>{customer.bin || "—"}</td>
                  <td>{customer.archived ? "В архиве" : "Активен"}</td>
                  <td>
                    {context.user.role !== "VIEWER" && (
                      <button onClick={() => setEdit(customer)}>
                        Изменить
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!rows.items.length && !loading && (
          <div className="empty-state">
            <Icon name="company" size={36} />
            <h2>Заказчики не найдены</h2>
            <p>
              Добавьте реквизиты организации один раз и выбирайте её в заявках.
            </p>
          </div>
        )}
        <div className="pagination">
          <span>Страница {page}</span>
          <div>
            <button
              disabled={page === 1}
              onClick={() => setPage((value) => value - 1)}
            >
              Назад
            </button>
            <button
              disabled={page * 20 >= rows.total}
              onClick={() => setPage((value) => value + 1)}
            >
              Далее
            </button>
          </div>
        </div>
      </section>
      {edit && (
        <CustomerDialog
          customer={edit}
          onClose={() => setEdit(null)}
          onSaved={() => {
            setEdit(null);
            setRefresh((value) => value + 1);
          }}
        />
      )}
    </>
  );
}
export function CustomerDialog({
  customer,
  onClose,
  onSaved,
}: {
  customer: Partial<Customer>;
  onClose: () => void;
  onSaved: (customer: Customer) => void;
}) {
  const [value, setValue] = useState({ ...emptyCustomer, ...customer });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function save(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const { nameRu, nameKz, bin, addressRu, addressKz, archived } = value;
      const result = await api<Customer>(
        customer.id ? `/customers/${customer.id}` : "/customers",
        {
          method: customer.id ? "PATCH" : "POST",
          body: json({ nameRu, nameKz, bin, addressRu, addressKz, archived }),
        },
      );
      onSaved(result);
    } catch (caught) {
      setError(errorText(caught));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title={customer.id ? "Реквизиты заказчика" : "Новый заказчик"}
      onClose={onClose}
    >
      <form onSubmit={save}>
        {error && <Notice>{error}</Notice>}
        <div className="form-grid">
          {[
            ["nameRu", "Название на русском"],
            ["nameKz", "Название на казахском"],
            ["bin", "БИН"],
            ["addressRu", "Адрес на русском"],
            ["addressKz", "Адрес на казахском"],
          ].map(([key, label]) => (
            <label key={key}>
              {label}
              <input
                autoFocus={key === "nameRu"}
                required={key === "nameRu"}
                value={String(value[key as keyof typeof value] || "")}
                onChange={(event) =>
                  setValue({ ...value, [key]: event.target.value })
                }
              />
            </label>
          ))}
        </div>
        {customer.id && (
          <label className="checkbox">
            <input
              type="checkbox"
              checked={value.archived}
              onChange={(event) =>
                setValue({ ...value, archived: event.target.checked })
              }
            />
            Перенести в архив
          </label>
        )}
        <div className="modal-actions">
          <button type="button" onClick={onClose}>
            Отмена
          </button>
          <button className="primary" disabled={busy}>
            {busy ? "Сохраняем…" : "Сохранить"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
