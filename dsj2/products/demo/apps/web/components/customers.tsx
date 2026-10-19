"use client";
import { useEffect, useState, type FormEvent } from "react";
import { Icon, Modal, Notice } from "@demo/ui";
import { api, json } from "@/lib/api";
import type { AppContext, Customer, Page } from "@/lib/types";
import { OrganizationNameFields } from "./organization-name-fields";
import { useCabinetLanguage, useCabinetError } from "./cabinet-language";
const emptyCustomer = {
  nameRu: "",
  nameKz: "",
  legalForm: "NONE" as const,
  ownNameRu: "",
  ownNameKz: "",
  bin: "",
  addressRu: "",
  addressKz: "",
  city: "",
  archived: false,
};
export function Customers({ context }: { context: AppContext }) {
  const t = useCabinetLanguage();
  const [rows, setRows] = useState<Page<Customer>>({ items: [], total: 0 });
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [edit, setEdit] = useState<Partial<Customer> | null>(null);
  const [error, setError] = useCabinetError();
  const [refresh, setRefresh] = useState(0);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let active = true;
    setLoading(true);
    const timer = setTimeout(() => {
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
          if (active) { setError(caught); setRows({ items: [], total: 0 }); }
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
          <h1>{t("Заказчики", "Тапсырыс берушілер")}</h1>
        </div>
        {context.user.role !== "VIEWER" && (
          <button className="primary" onClick={() => setEdit(emptyCustomer)}>
            <Icon name="plus" />
            {t("Добавить заказчика", "Тапсырыс берушіні қосу")}
          </button>
        )}
      </div>
      {error && (
        <Notice>
          {error}{" "}
          <button
            disabled={loading}
            onClick={() => setRefresh((value) => value + 1)}
          >
            {t("Повторить загрузку", "Қайта жүктеу")}
          </button>
        </Notice>
      )}
      <section className="panel">
        <div className="toolbar">
          <label className="search-field">
            <Icon name="search" />
            <input
              aria-label={t("Поиск заказчиков", "Тапсырыс берушілерді іздеу")}
              placeholder={t("Название или БИН", "Атауы немесе БСН")}
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                setPage(1);
              }}
            />
          </label>
          {search && (
            <button
              onClick={() => {
                setSearch("");
                setPage(1);
              }}
            >
              {t("Сбросить поиск", "Іздеуді тазарту")}
            </button>
          )}
          <span className="count muted" role="status">
            {loading ? t("Загружаем заказчиков…", "Тапсырыс берушілер жүктелуде…") : error ? t("Список не загружен", "Тізім жүктелмеді") : `${t("Всего", "Барлығы")}: ${rows.total}`}
          </span>
        </div>
        <div className="table-scroll" aria-busy={loading}>
          <table>
            <thead>
              <tr>
                <th>{t("Название на русском", "Орыс тіліндегі атауы")}</th>
                <th>{t("Название на казахском", "Қазақ тіліндегі атауы")}</th>
                <th>{t("БИН", "БСН")}</th>
                <th>{t("Статус", "Күйі")}</th>
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
                  <td>{customer.archived ? t("В архиве", "Мұрағатта") : t("Активен", "Белсенді")}</td>
                  <td>
                    {context.user.role !== "VIEWER" && (
                      <button onClick={() => setEdit(customer)}>
                        {t("Изменить", "Өзгерту")}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!rows.items.length && !loading && !error && (
          <div className="empty-state">
            <Icon name="company" size={36} />
            <h2>{search ? t("Заказчики не найдены", "Тапсырыс берушілер табылмады") : t("Заказчиков ещё нет", "Тапсырыс берушілер әлі жоқ")}</h2>
            <p>
              {search
                ? t("Попробуйте другое название или БИН либо сбросьте поиск.", "Басқа атауды немесе БСН енгізіңіз не іздеуді тазалаңыз.")
                : t("Добавьте реквизиты организации один раз и выбирайте её в заявках.", "Ұйым деректемелерін бір рет қосып, өтінімдерде таңдаңыз.")}
            </p>
            {search ? (
              <button
                onClick={() => {
                  setSearch("");
                  setPage(1);
                }}
              >
                {t("Сбросить поиск", "Іздеуді тазарту")}
              </button>
            ) : (
              context.user.role !== "VIEWER" && (
                <button onClick={() => setEdit(emptyCustomer)}>
                  {t("Добавить заказчика", "Тапсырыс берушіні қосу")}
                </button>
              )
            )}
          </div>
        )}
        {loading && !rows.items.length && (
          <div className="empty-state" aria-hidden="true">
            {t("Загружаем заказчиков…", "Тапсырыс берушілер жүктелуде…")}
          </div>
        )}
        <div className="pagination">
          <span>
            {t("Страница", "Бет")} {page} / {Math.max(1, Math.ceil(rows.total / 20))}
          </span>
          <div>
            <button
              disabled={page === 1 || loading}
              onClick={() => setPage((value) => value - 1)}
            >
              {t("Назад", "Артқа")}
            </button>
            <button
              disabled={page * 20 >= rows.total || loading}
              onClick={() => setPage((value) => value + 1)}
            >
              {t("Далее", "Келесі")}
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
  const t = useCabinetLanguage();
  const [value, setValue] = useState(() => ({
    ...emptyCustomer,
    ...customer,
    legalForm: customer.id
      ? (customer.legalForm ?? null)
      : (customer.legalForm ?? "NONE"),
    ownNameRu: customer.id
      ? (customer.ownNameRu ?? null)
      : (customer.ownNameRu ?? ""),
    ownNameKz: customer.id
      ? (customer.ownNameKz ?? null)
      : (customer.ownNameKz ?? ""),
  }));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useCabinetError();
  async function save(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const {
        nameRu,
        nameKz,
        legalForm,
        ownNameRu,
        ownNameKz,
        bin,
        addressRu,
        addressKz,
        city,
        archived,
      } = value;
      const result = await api<Customer>(
        customer.id ? `/customers/${customer.id}` : "/customers",
        {
          method: customer.id ? "PATCH" : "POST",
          body: json({
            nameRu,
            nameKz,
            legalForm,
            ownNameRu,
            ownNameKz,
            bin,
            addressRu,
            addressKz,
            city,
            archived,
          }),
        },
      );
      onSaved(result);
    } catch (caught) {
      setError(caught);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title={customer.id ? t("Реквизиты организации", "Ұйым деректемелері") : t("Новая организация", "Жаңа ұйым")}
      onClose={() => { if (!busy) onClose(); }}
    >
      <form onSubmit={save}>
        {error && <Notice>{error}</Notice>}
        <OrganizationNameFields
          value={value}
          onChange={(names) => setValue({ ...value, ...names })}
        />
        <details className="customer-extra-fields">
          <summary>{t("Дополнительные реквизиты", "Қосымша деректемелер")}</summary>
          <p className="fine-print">
            {t("БИН и адрес можно добавить сейчас или позже.", "БСН мен мекенжайды қазір немесе кейін қосуға болады.")}
          </p>
          <div className="form-grid">
            {[
              ["bin", t("БИН", "БСН")],
              ["addressRu", t("Адрес на русском", "Орыс тіліндегі мекенжай")],
              ["addressKz", t("Адрес на казахском", "Қазақ тіліндегі мекенжай")],
              ["city", t("Город (подтверждённый)", "Қала (расталған)")],
            ].map(([key, label]) => (
              <label key={key}>
                {label}
                <input
                  value={String(value[key as keyof typeof value] || "")}
                  onChange={(event) =>
                    setValue({ ...value, [key]: event.target.value })
                  }
                />
              </label>
            ))}
          </div>
        </details>
        {customer.id && (
          <label className="checkbox">
            <input
              type="checkbox"
              checked={value.archived}
              onChange={(event) =>
                setValue({ ...value, archived: event.target.checked })
              }
            />
            {t("Перенести в архив", "Мұрағатқа көшіру")}
          </label>
        )}
        <div className="modal-actions">
          <button type="button" disabled={busy} onClick={onClose}>
            {t("Отмена", "Бас тарту")}
          </button>
          <button className="primary" disabled={busy}>
            {busy ? t("Сохраняем…", "Сақталуда…") : t("Сохранить", "Сақтау")}
          </button>
        </div>
      </form>
    </Modal>
  );
}
