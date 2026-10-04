"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Icon, Notice } from "@demo/ui";
import { today } from "@demo/contracts";
import { PrintSetDownloads } from "./print-set-downloads";
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
  FINALIZED: "Подготовлено",
  ISSUED: "Оформлено",
  REGISTERED: "Зарегистрировано",
  CANCELLED: "Отменено",
  CORRECTED: "Исправлено",
  REPLACED: "Заменён исправленным выпуском",
  READY: "Готово",
  QUEUED: "В очереди",
  PENDING: "На согласовании",
  APPROVED: "Согласовано",
  REJECTED: "На доработке",
  SUPERSEDED: "Заменено новой редакцией",
  RENDERING: "Подготовка документов",
  AWAITING_SIGNATURE: "Ожидает подписи",
  SIGNED: "Подписано",
  LEGACY_ISSUED: "Исторический выпуск",
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
  archived?: boolean;
  lifecycle?: string | null;
  approval?: { status: string } | null;
  customer?: Customer;
  customerName?: string | null;
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
  const [filter, setFilter] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    setPage(1);
    setFilter("");
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
      params.set("archive", String(history));
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
          <h1>{history ? "Архив документов" : "Заявки на печать"}</h1>
          <p>
            {history
              ? "Завершённые выпуски, оригиналы, подписи и история исправлений."
              : "Рабочие версии, согласование директора, документы и печать."}
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
              <option value="FINALIZED">Подготовленные комплекты</option>
              <option value="CANCELLED">Отменённые</option>
            </select>
          </label>
          <button
            onClick={() =>
              void downloadExport(
                "/print-requests/export",
                {
                  search,
                  archive: history,
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
                      {row.kind === "PERSON"
                        ? "Физическое лицо"
                        : "Организация"}{" "}
                      · редакция {row.revision}
                    </small>
                  </td>
                  <td>{row.customerName || row.customer?.nameRu || "—"}</td>
                  <td>{row.itemCount ?? row.recipientCount ?? "—"}</td>
                  <td>
                    <Status
                      value={
                        row.lifecycle ||
                        (row.status === "DRAFT" && row.approval?.status) ||
                        row.status
                      }
                    />
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
                    <PrintSetDownloads requestId={row.id} compact />
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
  async function create(kind: "PERSON" | "COMPANY") {
    setBusy(true);
    setError("");
    try {
      const draft = await api<Draft>("/print-requests", {
        method: "POST",
        body: json({
          kind,
          schemaVersion: 2,
          businessRuleVersion: "LIVE_V1",
          englishAppendix: false,
          commonFields: { documentDate: today(context.tenant.timezone) },
          title:
            kind === "PERSON"
              ? "Новая заявка на человека"
              : "Новая заявка организации",
          customerId: null,
          demoMode: !!context.tenant.demoOnly,
          items: [{ ...newRecipient(), assignments: [] }],
        }),
      });
      router.push(`/requests/${draft.id}/edit`);
    } catch (caught) {
      setError(errorText(caught));
      setBusy(false);
    }
  }
  return (
    <section className="request-entry">
      <Link className="back-link" href="/requests">
        ← К заявкам
      </Link>
      <h1>Новая заявка</h1>
      {error && <Notice>{error}</Notice>}
      {context.user.role === "VIEWER" ? (
        <Notice kind="info">
          Создавать заявки могут менеджер и директор центра.
        </Notice>
      ) : (
        <form
          className="request-entry-form"
          onSubmit={(event) => {
            event.preventDefault();
            if (!busy) void create(kind);
          }}
        >
          <fieldset className="request-entry-choice" disabled={busy}>
            <legend className="sr-only">Тип заказчика</legend>
            <label>
              <input
                type="radio"
                name="customer-kind"
                value="PERSON"
                checked={kind === "PERSON"}
                onChange={() => setKind("PERSON")}
              />
              <span>Физическое лицо</span>
            </label>
            <label>
              <input
                type="radio"
                name="customer-kind"
                value="COMPANY"
                checked={kind === "COMPANY"}
                onChange={() => setKind("COMPANY")}
              />
              <span>Организация</span>
            </label>
          </fieldset>
          <p className="field-hint">
            Для выбранных курсов подставятся стандартные часы и положительный
            результат. Если человек ожидает сдачи, не сдал или не явился,
            измените результат в заявке перед согласованием.
          </p>
          <button
            type="submit"
            className="primary request-entry-next"
            disabled={busy}
          >
            {busy ? "Создаём заявку…" : "Далее"}
            <Icon name="chevron" />
          </button>
        </form>
      )}
    </section>
  );
}
