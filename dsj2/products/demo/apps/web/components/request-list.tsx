"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Icon, Notice } from "@demo/ui";
import { today } from "@demo/contracts";
import {
  newRequestBundle,
  requestBundles,
  type RequestBundle,
} from "@/lib/request-bundles";
import { api, downloadExport, errorText, json } from "@/lib/api";
import {
  newRecipient,
  type AppContext,
  type Draft,
  type Page,
  type Customer,
} from "@/lib/types";

export const statusNames: Record<string, string> = {
  DRAFT: "Черновик",
  FINALIZED: "Оформлено",
  ISSUED: "Оформлено",
  REGISTERED: "Зарегистрировано",
  CANCELLED: "Отменено",
  CORRECTED: "Исправлено",
  REPLACED: "Заменён исправленным выпуском",
  READY: "Готово",
  QUEUED: "В очереди",
  PENDING: "В очереди",
  RUNNING: "Формируется",
  FAILED: "Ошибка",
  PARTIAL: "Частично готово",
  COMPLETED: "Готово",
  SUCCEEDED: "Готово",
};
export function Status({ value }: { value: string }) {
  return (
    <span className={`status status-${value.toLowerCase()}`}>
      {statusNames[value] || value}
    </span>
  );
}
export function dateTime(value?: string) {
  return value
    ? new Intl.DateTimeFormat("ru-RU", {
        day: "2-digit",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
      }).format(new Date(value))
    : "—";
}
type RequestSummary = {
  id: string;
  title: string;
  kind: string;
  status: string;
  revision: number;
  itemCount?: number;
  recipientCount?: number;
  updatedAt?: string;
  createdAt?: string;
  customer?: Customer;
};
export function RequestList({
  context,
  history,
}: {
  context: AppContext;
  history: boolean;
}) {
  const [rows, setRows] = useState<Page<RequestSummary>>({
    items: [],
    total: 0,
  });
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState(history ? "FINALIZED" : "");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    setPage(1);
    setFilter(history ? "FINALIZED" : "");
  }, [history]);
  useEffect(() => {
    let active = true;
    setLoading(true);
    const timer = setTimeout(() => {
      setError("");
      const params = new URLSearchParams({
        page: String(page),
        pageSize: "20",
        search,
      });
      if (filter) params.set("status", filter);
      if (history) params.set("history", "true");
      api<Page<RequestSummary>>(`/print-requests?${params}`)
        .then((result) => {
          if (active) setRows(result);
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
  }, [page, search, filter, history, refresh]);
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>{history ? "История документов" : "Заявки на печать"}</h1>
          <p>
            {history
              ? "Зарегистрированные редакции и сохранённые оригиналы."
              : "От получателей и данных до готового комплекта."}
          </p>
        </div>
        {context.user.role !== "VIEWER" && (
          <Link className="button primary" href="/requests/new">
            <Icon name="plus" />
            Новая заявка
          </Link>
        )}
      </div>
      <section className="panel list-panel">
        <div className="toolbar">
          <label className="search-field">
            <Icon name="search" />
            <input
              aria-label="Поиск по заявкам"
              placeholder="Номер документа, название, получатель или заказчик"
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                setPage(1);
              }}
            />
          </label>
          <label className="inline-label">
            Статус
            <select
              value={filter}
              onChange={(event) => {
                setFilter(event.target.value);
                setPage(1);
              }}
            >
              <option value="">Все статусы</option>
              {!history && <option value="DRAFT">Черновики</option>}
              <option value="FINALIZED">Оформленные</option>
              <option value="CANCELLED">Отменённые</option>
            </select>
          </label>
          <button
            onClick={() =>
              void downloadExport(
                "/print-requests/export",
                {
                  search,
                  ...(history ? { history: true } : {}),
                  ...(filter ? { status: filter } : {}),
                  format: "XLSX",
                },
                "DEMO-registry.xlsx",
              ).catch((caught) => setError(errorText(caught)))
            }
          >
            <Icon name="download" />
            Реестр XLSX
          </button>
          {(search || filter) && (
            <button
              onClick={() => {
                setSearch("");
                setFilter("");
                setPage(1);
              }}
            >
              Сбросить фильтры
            </button>
          )}
          <span className="muted count" role="status">
            {loading ? "Загружаем заявки…" : `Всего: ${rows.total}`}
          </span>
        </div>
        {error && (
          <Notice>
            {error}{" "}
            <button onClick={() => setRefresh((value) => value + 1)}>
              Повторить
            </button>
          </Notice>
        )}
        <div className="table-scroll" aria-busy={loading}>
          <table className="request-table">
            <thead>
              <tr>
                <th>Заявка</th>
                <th>Заказчик</th>
                <th>Получатели</th>
                <th>Статус</th>
                <th>Обновлена</th>
                <th>
                  <span className="sr-only">Открыть</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.items.map((row) => (
                <tr key={row.id}>
                  <td>
                    <Link href={`/requests/${row.id}`} className="row-title">
                      {row.title || "Без названия"}
                    </Link>
                    <small>
                      {row.kind === "PERSON" ? "Человек" : "Организация"} ·
                      редакция {row.revision}
                    </small>
                  </td>
                  <td>{row.customer?.nameRu || "—"}</td>
                  <td>{row.itemCount ?? row.recipientCount ?? "—"}</td>
                  <td>
                    <Status value={row.status} />
                  </td>
                  <td>{dateTime(row.updatedAt || row.createdAt)}</td>
                  <td>
                    <Link
                      className="icon-link"
                      href={`/requests/${row.id}`}
                      aria-label={`Открыть ${row.title || "заявку"}`}
                    >
                      <Icon name="chevron" />
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!rows.items.length && !loading && !error && (
          <div className="empty-state">
            <Icon name="print" size={40} />
            <h2>
              {search || filter
                ? "Заявки не найдены"
                : "Всё начинается с заявки"}
            </h2>
            <p>
              {search || filter
                ? "Измените поиск или статус."
                : "Добавьте человека или список сотрудников организации."}
            </p>
            {search || filter ? (
              <button
                onClick={() => {
                  setSearch("");
                  setFilter("");
                  setPage(1);
                }}
              >
                Сбросить фильтры
              </button>
            ) : (
              !history &&
              context.user.role !== "VIEWER" && (
                <Link href="/requests/new" className="button">
                  Создать первую заявку
                </Link>
              )
            )}
          </div>
        )}
        {loading && !rows.items.length && (
          <div className="empty-state" aria-hidden="true">
            Загружаем заявки…
          </div>
        )}
        <div className="pagination">
          <span>
            Страница {page} из {Math.max(1, Math.ceil(rows.total / 20))}
          </span>
          <div>
            <button
              disabled={page === 1 || loading}
              onClick={() => setPage((value) => value - 1)}
            >
              Назад
            </button>
            <button
              disabled={page * 20 >= rows.total || loading}
              onClick={() => setPage((value) => value + 1)}
            >
              Далее
            </button>
          </div>
        </div>
      </section>
    </>
  );
}
export function NewRequest({ context }: { context: AppContext }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [kind, setKind] = useState<"PERSON" | "COMPANY">("PERSON");
  const [bundle, setBundle] = useState<RequestBundle | "">("");
  async function create(kind: "PERSON" | "COMPANY", bundle?: RequestBundle) {
    setBusy(true);
    setError("");
    try {
      const draft = await api<Draft>("/print-requests", {
        method: "POST",
        body: json({
          kind,
          schemaVersion: 2,
          commonFields: { documentDate: today(context.tenant.timezone) },
          title: bundle
            ? `БиОТ · ${requestBundles[bundle].label}`
            : kind === "PERSON"
              ? "Новая заявка на человека"
              : "Новая заявка организации",
          customerId: null,
          demoMode: !!context.tenant.demoOnly,
          ...(bundle
            ? newRequestBundle(bundle)
            : { items: [{ ...newRecipient(), assignments: [] }] }),
        }),
      });
      router.push(`/requests/${draft.id}/edit`);
    } catch (caught) {
      setError(errorText(caught));
      setBusy(false);
    }
  }
  return (
    <>
      <Link className="back-link" href="/requests">
        ← К заявкам
      </Link>
      <div className="page-heading">
        <div>
          <h1>Новая заявка</h1>
          <p>
            Укажите заказчика. Затем добавьте людей и отметьте нужные документы.
          </p>
        </div>
      </div>
      {error && <Notice>{error}</Notice>}
      {context.user.role === "VIEWER" ? (
        <Notice kind="info">
          Создавать заявки могут оператор и администратор центра.
        </Notice>
      ) : (
        <form
          className="panel request-start"
          onSubmit={(event) => {
            event.preventDefault();
            if (!busy) void create(kind, bundle || undefined);
          }}
        >
          <fieldset className="choice-fieldset" disabled={busy}>
            <legend>Кто заказчик?</legend>
            <div className="customer-kind-choices">
              <label className="choice-option">
                <input
                  type="radio"
                  name="customer-kind"
                  value="PERSON"
                  checked={kind === "PERSON"}
                  onChange={() => setKind("PERSON")}
                />
                <span>
                  <strong>Физическое лицо</strong>
                  <small>Личные данные и документы человека</small>
                </span>
              </label>
              <label className="choice-option">
                <input
                  type="radio"
                  name="customer-kind"
                  value="COMPANY"
                  checked={kind === "COMPANY"}
                  onChange={() => setKind("COMPANY")}
                />
                <span>
                  <strong>Организация</strong>
                  <small>Название компании и список людей</small>
                </span>
              </label>
            </div>
          </fieldset>
          <p className="request-start-context" role="status">
            {kind === "COMPANY"
              ? "В заявке выберите компанию или добавьте новую по форме и названию. Дополнительные реквизиты можно заполнить позже."
              : "Начните с ФИО и должности. При необходимости добавьте ещё людей; документы выбираются для каждого отдельно или сразу для всех."}
          </p>
          <details className="request-start-bundles">
            <summary>Начать с готового комплекта БиОТ</summary>
            <fieldset className="choice-fieldset" disabled={busy}>
              <legend className="sr-only">Начальный комплект документов</legend>
              <label className="checkbox-label">
                <input
                  type="radio"
                  name="initial-bundle"
                  checked={!bundle}
                  onChange={() => setBundle("")}
                />
                Выберу документы рядом с людьми
              </label>
              {(Object.keys(requestBundles) as RequestBundle[]).map((key) => (
                <label className="checkbox-label" key={key}>
                  <input
                    type="radio"
                    name="initial-bundle"
                    checked={bundle === key}
                    onChange={() => setBundle(key)}
                  />
                  {requestBundles[key].label} —{" "}
                  {requestBundles[key].description.toLowerCase()}
                </label>
              ))}
            </fieldset>
          </details>
          <div className="request-start-footer">
            <span className="muted">
              {bundle
                ? `Начальный комплект: ${requestBundles[bundle].label}`
                : "БиОТ, ПТМ, ПБ и ПС — на следующем экране"}
            </span>
            <button type="submit" className="primary" disabled={busy}>
              {busy ? "Создаём заявку…" : "Перейти к людям и документам"}
              <Icon name="chevron" />
            </button>
          </div>
        </form>
      )}
      <p className="fine-print">
        Номера документов назначаются только при оформлении. Черновик можно
        дополнить позже.
      </p>
    </>
  );
}
