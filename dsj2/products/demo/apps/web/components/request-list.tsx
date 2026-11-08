"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Fragment, useEffect, useRef, useState } from "react";
import { Icon, Notice } from "@demo/ui";
import { PrintSetDownloads } from "./print-set-downloads";
import { PrintingOverview } from "./printing-overview";
import "./request-list.css";
import { api, downloadExport, errorText } from "@/lib/api";
import {
  newRequestStorageKey,
  prepareNewRequest,
  restoreNewRequest,
  type NewRequestAttempt,
} from "@/lib/new-request";
import {
  documentTitle,
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
  NEEDS_PREPARATION: "Требует подготовки",
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
  approval?: { status: string; needsPreparation?: boolean } | null;
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
  const [exportError, setExportError] = useState("");
  const [exporting, setExporting] = useState(false);
  const exportInFlight = useRef(false);
  const [expanded, setExpanded] = useState<string | null>(null);
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
  async function exportRegistry() {
    if (exportInFlight.current) return;
    exportInFlight.current = true;
    setExporting(true);
    setExportError("");
    try {
      await downloadExport(
        "/print-requests/export",
        {
          search,
          archive: history,
          ...(filter ? { status: filter } : {}),
          format: "XLSX",
        },
        "КОРОЧКИ-реестр.xlsx",
      );
    } catch (caught) {
      setExportError(errorText(caught));
    } finally {
      exportInFlight.current = false;
      setExporting(false);
    }
  }
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>{history ? "Архив документов" : "Заявки на печать"}</h1>

        </div>
        {context.user.role !== "VIEWER" && (
          <Link className="button primary" href="/requests/new">
            <Icon name="plus" />
            Новая заявка
          </Link>
        )}
      </div>
      <PrintingOverview />
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
          <button disabled={exporting} onClick={() => void exportRegistry()}>
            <Icon name="download" />
            {exporting ? "Готовим реестр…" : "Реестр XLSX"}
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
        {exportError && (
          <Notice>
            {exportError}{" "}
            <button disabled={exporting} onClick={() => void exportRegistry()}>
              Повторить экспорт
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
                <Fragment key={row.id}>
                  <tr>
                    <td>
                      <Link href={`/requests/${row.id}`} className="row-title">
                        {row.title || "Без названия"}
                      </Link>
                      <small>
                        {row.kind === "PERSON"
                          ? "Физическое лицо"
                          : "Организация"}{" "}
                      </small>
                    </td>
                    <td>{row.customerName || row.customer?.nameRu || "—"}</td>
                    <td>
                      <button
                        className="request-composition-toggle"
                        aria-expanded={expanded === row.id}
                        aria-controls={`request-recipients-${row.id}`}
                        aria-label={`${expanded === row.id ? "Скрыть" : "Показать"} состав заявки «${row.title || "Без названия"}»`}
                        onClick={() =>
                          setExpanded(expanded === row.id ? null : row.id)
                        }
                      >
                        {row.itemCount ?? row.recipientCount ?? "—"} ·{" "}
                        {expanded === row.id ? "Скрыть" : "Состав"}
                      </button>
                    </td>
                    <td>
                      <Status
                        value={
                          row.lifecycle ||
                          (row.status === "DRAFT" &&
                            (row.approval?.needsPreparation
                              ? "NEEDS_PREPARATION"
                              : row.approval?.status)) ||
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
                      {(row.status === "FINALIZED" || !!row.lifecycle) && (
                        <PrintSetDownloads requestId={row.id} compact />
                      )}
                    </td>
                  </tr>
                  {expanded === row.id && (
                    <tr id={`request-recipients-${row.id}`}>
                      <td colSpan={6} className="request-composition-cell">
                        <RequestRecipients
                          requestId={row.id}
                          revision={row.revision}
                        />
                      </td>
                    </tr>
                  )}
                </Fragment>
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
                : history
                  ? "В архиве пока нет документов"
                  : "Всё начинается с заявки"}
            </h2>
            <p>
              {search || filter
                ? "Измените поиск или статус."
                : history
                  ? "Здесь появятся завершённые выпуски и заявки, перенесённые в архив."
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

function RequestRecipients({
  requestId,
  revision,
}: {
  requestId: string;
  revision: number;
}) {
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState("");
  const [refresh, setRefresh] = useState(0);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    void api<Draft>(`/print-requests/${requestId}`)
      .then((value) => {
        if (active) setDraft(value);
      })
      .catch((caught) => {
        if (active) setError(errorText(caught));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [requestId, revision, refresh]);
  if (loading) return <p role="status">Загружаем состав заявки…</p>;
  if (error)
    return (
      <Notice>
        {error}{" "}
        <button onClick={() => setRefresh((value) => value + 1)}>
          Повторить загрузку состава
        </button>
      </Notice>
    );
  if (!draft?.items.length)
    return <p className="muted">В заявке пока нет сотрудников.</p>;
  return (
    <div className="table-scroll">
      <table className="request-recipient-table" aria-label="Состав заявки">
        <thead>
          <tr>
            <th>Сотрудник</th>
            <th>Должность</th>
            <th>Документы</th>
          </tr>
        </thead>
        <tbody>
          {draft.items.map((person) => (
            <tr key={person.id}>
              <td>
                <Link
                  href={`/requests/${encodeURIComponent(requestId)}?recipient=${encodeURIComponent(person.id)}`}
                >
                  {person.fullNameRu || person.fullNameKz || "ФИО не заполнено"}
                </Link>
              </td>
              <td>{person.positionRu || person.positionKz || "—"}</td>
              <td>
                {person.assignments.length
                  ? [
                      ...new Set(
                        person.assignments.map((assignment) =>
                          documentTitle(
                            assignment.templateId,
                            !!assignment.eventId,
                          ),
                        ),
                      ),
                    ].join(" · ")
                  : "Документы не выбраны"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function NewRequest({ context }: { context: AppContext }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [kind, setKind] = useState<"PERSON" | "COMPANY">("PERSON");
  const attempt = useRef<NewRequestAttempt | null>(null);
  const creating = useRef(false);
  const [restoring, setRestoring] = useState(true);
  const [pending, setPending] = useState(false);
  const storageKey = newRequestStorageKey(context);
  useEffect(() => {
    attempt.current = null;
    setPending(false);
    try {
      attempt.current = restoreNewRequest(sessionStorage.getItem(storageKey));
      if (attempt.current) {
        setKind(attempt.current.kind);
        setPending(true);
      }
    } catch (caught) {
      setError(errorText(caught));
    } finally {
      setRestoring(false);
    }
  }, [storageKey]);
  async function create(kind: "PERSON" | "COMPANY") {
    if (creating.current || restoring) return;
    creating.current = true;
    setBusy(true);
    setError("");
    try {
      attempt.current ||= prepareNewRequest(context, kind);
      setPending(true);
      try {
        sessionStorage.setItem(storageKey, JSON.stringify(attempt.current));
      } catch {
        /* The same-page retry still retains the exact attempt. */
      }
      const draft = await api<Draft>("/print-requests", {
        method: "POST",
        headers: { "Idempotency-Key": attempt.current.key },
        body: attempt.current.body,
      });
      if (!draft || typeof draft.id !== "string" || !draft.id)
        throw new Error(
          "Сервер не подтвердил создание заявки. Повторите попытку: новая копия не будет создана.",
        );
      try {
        sessionStorage.removeItem(storageKey);
      } catch {
        /* A retained attempt safely reopens the same request. */
      }
      router.push(`/requests/${encodeURIComponent(draft.id)}/edit`);
    } catch (caught) {
      setError(errorText(caught));
      setBusy(false);
      creating.current = false;
    }
  }
  return (
    <section className="request-entry">
      <Link className="back-link" href="/requests">
        ← К заявкам
      </Link>
      <h1>Новая заявка</h1>
      {error && <Notice>{error}</Notice>}
      {pending && !busy && (
        <Notice kind="info">
          Создание ещё не подтверждено. Повторите попытку, чтобы открыть ту же
          заявку без дубликата.
        </Notice>
      )}
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
          <fieldset
            className="request-entry-choice"
            disabled={busy || restoring || pending}
          >
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
          <button
            type="submit"
            className="primary request-entry-next"
            disabled={busy || restoring}
          >
            {busy
              ? "Создаём заявку…"
              : pending
                ? "Повторить создание"
                : "Далее"}
            <Icon name="chevron" />
          </button>
        </form>
      )}
    </section>
  );
}
