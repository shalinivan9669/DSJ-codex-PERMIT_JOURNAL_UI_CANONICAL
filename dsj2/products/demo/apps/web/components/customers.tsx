"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { customerSchema } from "@demo/contracts";
import { Icon, Modal, Notice } from "@demo/ui";
import { ApiError, api, json } from "@/lib/api";
import type { AppContext, Customer, Page } from "@/lib/types";
import { OrganizationNameFields } from "./organization-name-fields";
import { useCabinetLanguage, useCabinetError } from "./cabinet-language";
import { initialCustomerDraft } from "@/lib/customer-draft";
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
          if (active) {
            setError(caught);
            setRows({ items: [], total: 0 });
          }
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
            {loading
              ? t("Загружаем заказчиков…", "Тапсырыс берушілер жүктелуде…")
              : error
                ? t("Список не загружен", "Тізім жүктелмеді")
                : `${t("Всего", "Барлығы")}: ${rows.total}`}
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
                  <td>
                    {customer.archived
                      ? t("В архиве", "Мұрағатта")
                      : t("Активен", "Белсенді")}
                  </td>
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
            <h2>
              {search
                ? t("Заказчики не найдены", "Тапсырыс берушілер табылмады")
                : t("Заказчиков ещё нет", "Тапсырыс берушілер әлі жоқ")}
            </h2>
            <p>
              {search
                ? t(
                    "Попробуйте другое название или БИН либо сбросьте поиск.",
                    "Басқа атауды немесе БСН енгізіңіз не іздеуді тазалаңыз.",
                  )
                : t(
                    "Добавьте реквизиты организации один раз и выбирайте её в заявках.",
                    "Ұйым деректемелерін бір рет қосып, өтінімдерде таңдаңыз.",
                  )}
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
            {t("Страница", "Бет")} {page} /{" "}
            {Math.max(1, Math.ceil(rows.total / 20))}
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
  const [value, setValue] = useState(() => initialCustomerDraft(customer));
  const [busy, setBusy] = useState(false);
  const saving = useRef(false);
  const creationAttempt = useRef<{ key: string; body: string } | null>(null);
  const [uncertain, setUncertain] = useState(false);
  const [attempted, setAttempted] = useState(false);
  const [error, setError] = useCabinetError();
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving.current) return;
    setError("");
    setAttempted(true);
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
    const parsed = customerSchema.safeParse({
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
    });
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      setError(
        issue?.message ||
          t("Проверьте название компании.", "Компания атауын тексеріңіз."),
      );
      const path = issue?.path[0];
      if (typeof path === "string") {
        const input = event.currentTarget.querySelector<HTMLInputElement>(
          `[data-field-path="${path}"]`,
        );
        const details = input?.closest("details");
        if (details) details.open = true;
        input?.focus();
      }
      return;
    }
    saving.current = true;
    setBusy(true);
    if (!customer.id)
      creationAttempt.current ||= {
        key: crypto.randomUUID(),
        body: json(parsed.data),
      };
    let result: Customer;
    try {
      result = await api<Customer>(
        customer.id ? `/customers/${customer.id}` : "/customers",
        {
          method: customer.id ? "PATCH" : "POST",
          ...(!customer.id && creationAttempt.current
            ? {
                headers: { "Idempotency-Key": creationAttempt.current.key },
                body: creationAttempt.current.body,
              }
            : { body: json(parsed.data) }),
        },
      );
      if (!customer.id && !result?.id)
        throw new ApiError(
          0,
          t(
            "Не удалось получить подтверждение создания организации. Проверьте сохранение.",
            "Ұйымның құрылғаны туралы растау алынбады. Сақталуын тексеріңіз.",
          ),
        );
    } catch (caught) {
      if (!customer.id) {
        const unknown =
          caught instanceof ApiError &&
          (caught.status === 0 || caught.status >= 500);
        setUncertain(unknown);
        if (!unknown) creationAttempt.current = null;
      }
      setError(caught);
      return;
    } finally {
      saving.current = false;
      setBusy(false);
    }
    creationAttempt.current = null;
    setUncertain(false);
    onSaved(result);
  }
  return (
    <Modal
      title={
        customer.id
          ? t("Реквизиты организации", "Ұйым деректемелері")
          : t("Новая организация", "Жаңа ұйым")
      }
      onClose={() => {
        if (!busy && !uncertain) onClose();
      }}
    >
      <form onSubmit={save}>
        {error && <Notice>{error}</Notice>}
        {uncertain && (
          <Notice kind="info">
            {t(
              "Ответ сервера не получен. Нажмите «Проверить сохранение»: повтор проверит ту же организацию без создания дубля. До проверки поля и закрытие окна заблокированы.",
              "Сервер жауабы алынбады. «Сақталуын тексеру» түймесін басыңыз: қайталау сол ұйымды көшірмесін жасамай тексереді. Тексеруге дейін өрістер мен терезені жабу бұғатталған.",
            )}
          </Notice>
        )}
        <fieldset
          disabled={busy || uncertain}
          className="stack"
          style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}
        >
          <legend className="sr-only">
            {t("Реквизиты организации", "Ұйым деректемелері")}
          </legend>
          <OrganizationNameFields
            value={value}
            onChange={(names) => setValue({ ...value, ...names })}
            disabled={busy || uncertain}
            showRequiredErrors={attempted}
            fieldPaths={
              value.legalForm
                ? ["ownNameRu", "ownNameKz"]
                : ["nameRu", "nameKz"]
            }
          />
          <details className="customer-extra-fields">
            <summary>
              {t("Дополнительные реквизиты", "Қосымша деректемелер")}
            </summary>
            <p className="fine-print">
              {t(
                "БИН и адрес можно добавить сейчас или позже.",
                "БСН мен мекенжайды қазір немесе кейін қосуға болады.",
              )}
            </p>
            <div className="form-grid">
              {[
                ["bin", t("БИН", "БСН")],
                ["addressRu", t("Адрес на русском", "Орыс тіліндегі мекенжай")],
                [
                  "addressKz",
                  t("Адрес на казахском", "Қазақ тіліндегі мекенжай"),
                ],
                ["city", t("Город (подтверждённый)", "Қала (расталған)")],
              ].map(([key, label]) => (
                <label key={key}>
                  {label}
                  <input
                    data-field-path={key}
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
        </fieldset>
        <div className="modal-actions">
          <button type="button" disabled={busy || uncertain} onClick={onClose}>
            {t("Отмена", "Бас тарту")}
          </button>
          <button className="primary" disabled={busy}>
            {busy
              ? t("Сохраняем…", "Сақталуда…")
              : uncertain
                ? t("Проверить сохранение", "Сақталуын тексеру")
                : t("Сохранить", "Сақтау")}
          </button>
        </div>
      </form>
    </Modal>
  );
}
