"use client";
import Link from "next/link";
import { Fragment, useEffect, useState } from "react";
import { Notice } from "@demo/ui";
import { api, errorText, json } from "@/lib/api";
import type { AppContext } from "@/lib/types";
import { OrderFinance, type Commercial } from "./order-finance";
import { ValueLibrary } from "./value-library";
import { OrderCoordination, type Proposal } from "./order-coordination";
import { OrderEvidence } from "./order-evidence";
import { EvidenceMatrix } from "./evidence-matrix";

type Milestone = {
  id: string;
  label: string;
  source: string;
  category: string;
  status: string;
  ownerId?: string;
  dueDate?: string;
  evidence?: string;
};
type Order = {
  id: string;
  revision: number;
  commercial: Commercial;
  title: string;
  customer?: { id: string; nameRu: string } | null;
  customerId?: string | null;
  employerId?: string | null;
  payerId?: string | null;
  employer?: { id: string; nameRu: string } | null;
  payer?: { id: string; nameRu: string } | null;
  contact?: string;
  ownerId?: string;
  dueDate?: string;
  status: string;
  requests: { requestId: string; request?: { title: string } }[];
  milestones: Milestone[];
  nextActions?: {
    id?: string;
    label: string;
    reason?: string;
    requestId?: string;
    source?: string;
  }[];
  summary?: {
    people: number;
    events: number;
    personEventServices: number;
    legacyAssignments: number;
  };
  completion?: Record<string, boolean>;
  proposals?: Proposal[];
  events?: { id: string; title: string; requestId: string }[];
  attachments?: {
    id: string;
    fileName: string;
    eventId?: string | null;
    source?: string;
  }[];
  financialDocuments?: {
    id: string;
    type: string;
    number: string;
    documentDate: string;
    source: string;
  }[];
};
type Renewal = {
  id: string;
  state: string;
  fullNameRu?: string;
  manualText?: string;
  customer?: { id?: string; nameRu: string };
  customerId?: string | null;
  recipient?: { data?: { fullNameRu?: string } };
  sourceRequestId: string;
  contactAfter?: string;
  nextContactDate?: string;
  documentValidUntil?: string;
  nextCheckDate?: string;
  policyVersion?: string;
  basisDate?: string;
  reason?: string;
  policySource?: string;
  contacts?: {
    id: string;
    occurredOn: string;
    outcome: string;
    note: string;
    channel?: string;
  }[];
};
const statuses: Record<string, string> = {
  NEEDS_REVIEW: "Нужно проверить актуальность",
  ORDER_AGREED: "Создана новая заявка",
  PENDING: "Ожидает действия",
  DONE: "Выполнено",
  WAIVED: "Снято с основанием",
  OPEN: "Открыто",
  CLOSED: "Закрыто",
  COMPLETED: "Исполнение завершено",
  CANCELLED: "Заказ отменён",
  CONFIRMED: "Подтверждено",
  DEFERRED: "Отложено",
  IRRELEVANT: "Неактуально",
  CONTACTED: "Связались",
  NEW: "Новая потребность",
};
const categoryNames: Record<string, string> = {
  DATA: "Список и данные",
  RESULTS: "Фактические результаты",
  DOCUMENTS: "Документы",
  TRANSFER: "Передача заказчику",
  SETTLEMENT: "Расчёты",
  EVIDENCE: "Основания",
};
export function Workbench({ context }: { context: AppContext }) {
  const [tab, setTab] = useState("orders");
  const [orders, setOrders] = useState<Order[]>([]);
  const [renewals, setRenewals] = useState<Renewal[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [refresh, setRefresh] = useState(0);
  const [showArchivedRenewals, setShowArchivedRenewals] = useState(false);
  const [label, setLabel] = useState("");
  const [category, setCategory] = useState("TRANSFER");
  const [source, setSource] = useState("CONTRACT");
  const [reference, setReference] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [evidence, setEvidence] = useState<Record<string, string>>({});
  const [contact, setContact] = useState<{
    id: string;
    outcome: string;
    note: string;
    occurredOn: string;
    nextContactDate: string;
  } | null>(null);
  const readonly = context.user.role === "VIEWER";
  useEffect(() => {
    let active = true;
    setBusy(true);
    Promise.all([
      api<{ items: Order[] }>("/orders"),
      api<{ items: Renewal[] }>("/renewals"),
    ])
      .then(([a, b]) => {
        if (active) {
          setOrders(a.items);
          setRenewals(b.items);
          setError("");
          setSelectedId((old) => old || a.items[0]?.id || "");
        }
      })
      .catch((caught) => {
        if (active) setError(errorText(caught));
      })
      .finally(() => {
        if (active) setBusy(false);
      });
    return () => {
      active = false;
    };
  }, [refresh]);
  const selected = orders.find((o) => o.id === selectedId);
  async function reloadOrders() {
    const result = await api<{ items: Order[] }>("/orders");
    setOrders(result.items);
  }
  const renewalGroups = Object.values(
    renewals
      .filter(
        (r) =>
          showArchivedRenewals ||
          !["IRRELEVANT", "ORDER_AGREED"].includes(r.state),
      )
      .reduce<Record<string, { id: string; name: string; items: Renewal[] }>>(
        (groups, renewal) => {
          const key = renewal.customerId || "individual";
          groups[key] ||= {
            id: key,
            name: renewal.customer?.nameRu || "Без организации заказчика",
            items: [],
          };
          groups[key].items.push(renewal);
          return groups;
        },
        {},
      ),
  ).sort((a, b) => a.name.localeCompare(b.name, "ru"));
  async function run(action: () => Promise<unknown>, message: string) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await action();
      setNotice(message);
      setRefresh((v) => v + 1);
    } catch (caught) {
      setError(errorText(caught));
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>Работа центра</h1>
          <p>
            Обязательства по заказам, передача документов и подтверждённые
            повторные обращения.
          </p>
        </div>
        <Link className="button primary" href="/requests/new">
          Новая заявка
        </Link>
      </div>
      <div className="tabs" role="tablist" aria-label="Рабочая очередь">
        {[
          ["orders", "Исполнение заказов"],
          ["renewals", "Повторные обращения"],
          ["library", "Источники и правила"],
        ].map(([key, title]) => (
          <button
            key={key}
            role="tab"
            aria-selected={tab === key}
            onClick={() => setTab(key)}
          >
            {title}
          </button>
        ))}
      </div>
      {error && (
        <Notice>
          {error}
          <button onClick={() => setRefresh((v) => v + 1)}>
            Повторить загрузку
          </button>
        </Notice>
      )}
      {notice && <Notice kind="success">{notice}</Notice>}
      {tab === "library" ? (
        <ValueLibrary context={context} />
      ) : tab === "orders" ? (
        <div className="workbench-grid">
          <section className="panel workbench-list" aria-label="Список заказов">
            <div className="toolbar">
              <h2>Заказы</h2>
              <span className="muted" role="status">
                {busy ? "Обновляем заказы…" : `Всего: ${orders.length}`}
              </span>
            </div>
            <div
              className="table-scroll workbench-list-scroll"
              aria-busy={busy}
            >
              <table>
                <thead>
                  <tr>
                    <th>Заказ / заказчик</th>
                    <th>Следующий шаг</th>
                    <th>Срок</th>
                  </tr>
                </thead>
                <tbody>
                  {orders.map((order) => (
                    <tr
                      key={order.id}
                      className={order.id === selectedId ? "selected" : ""}
                    >
                      <td>
                        <button
                          className="text-button"
                          aria-pressed={order.id === selectedId}
                          aria-controls="selected-order-details"
                          onClick={() => setSelectedId(order.id)}
                        >
                          {order.title}
                        </button>
                        <small>
                          {order.customer?.nameRu || "Заказчик не задан"}
                        </small>
                      </td>
                      <td>
                        {order.nextActions?.[0]?.label ||
                          order.milestones.find((m) => m.status === "PENDING")
                            ?.label ||
                          "Проверьте состав обязательств"}
                      </td>
                      <td>{order.dueDate || "Не задан"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!orders.length && !busy && !error && (
              <div className="empty-state">
                <h3>Нет коммерческих заказов</h3>
                <p>
                  Откройте заявку и выберите «Создать связанный заказ», если
                  нужны контроль обязательств и расчёты.
                </p>
                <Link href="/requests">Открыть заявки</Link>
              </div>
            )}
            {!orders.length && busy && (
              <div className="empty-state" aria-hidden="true">
                Загружаем заказы…
              </div>
            )}
          </section>
          {selected && (
            <section
              className="panel workbench-detail"
              id="selected-order-details"
              aria-label="Выбранный заказ"
            >
              <h2>{selected.title}</h2>
              <p>{statuses[selected.status] || selected.status}</p>
              {selected.summary && (
                <p>
                  Состав заказа: {selected.summary.people} чел. ·{" "}
                  {selected.summary.events} событий ·{" "}
                  {selected.summary.personEventServices} услуг «человек +
                  событие»
                  {selected.summary.legacyAssignments
                    ? ` · ${selected.summary.legacyAssignments} назначений без события`
                    : ""}
                  . Число файлов не считается числом услуг.
                </p>
              )}
              {selected.completion && (
                <div
                  className="form-grid"
                  aria-label="Состояния исполнения заказа"
                >
                  <p>
                    Результаты обучения:{" "}
                    {selected.completion.training
                      ? "исходы зафиксированы"
                      : "требуют подтверждения"}
                  </p>
                  <p>
                    Документы:{" "}
                    {selected.completion.documents
                      ? "оформлены"
                      : "требуют действия"}
                  </p>
                  <p>
                    Передача:{" "}
                    {selected.completion.transfer
                      ? "подтверждена"
                      : "не подтверждена"}
                  </p>
                  <p>
                    Расчёты:{" "}
                    {selected.completion.settlement
                      ? "нет невыполненных обязательств"
                      : "требуют действия"}
                  </p>
                </div>
              )}
              <p className="muted">
                Ответственный:{" "}
                {selected.ownerId === context.user.id
                  ? context.user.displayName
                  : selected.ownerId
                    ? "назначен сотрудник"
                    : "не назначен"}
                . Срок: {selected.dueDate || "не задан"}.
              </p>
              <div className="linked-requests">
                {selected.requests.map((r) => (
                  <Link
                    className="button"
                    key={r.requestId}
                    href={`/requests/${r.requestId}`}
                  >
                    {r.request?.title || "Открыть связанную заявку"}
                  </Link>
                ))}
              </div>
              <h3>Обязательства и основания выполнения</h3>
              {selected.nextActions
                ?.filter((action) =>
                  ["RESULT_REVIEW", "DATA_REVIEW"].includes(
                    action.source || "",
                  ),
                )
                .map((action) => (
                  <article className="milestone" key={action.id}>
                    <strong>{action.label}</strong>
                    <p>
                      {action.source === "RESULT_REVIEW"
                        ? "Исход не подтверждается автоматически. Укажите фактический результат и источник в заявке."
                        : "Проверьте указанные данные в связанной заявке. Сохранённые сведения и документы не изменяются автоматически."}
                    </p>
                    {action.requestId && (
                      <Link href={`/requests/${action.requestId}`}>
                        {action.source === "RESULT_REVIEW"
                          ? "Уточнить результат в заявке"
                          : "Уточнить данные в заявке"}
                      </Link>
                    )}
                  </article>
                ))}
              {selected.milestones.map((m) => (
                <article className="milestone" key={m.id}>
                  <strong>{m.label}</strong>
                  <small>
                    {categoryNames[m.category] || m.category} ·{" "}
                    {statuses[m.status] || m.status} · Срок:{" "}
                    {m.dueDate || "не задан"}
                  </small>
                  {m.evidence && <p>{m.evidence}</p>}
                  {!readonly && m.status === "PENDING" && (
                    <>
                      <label>
                        Подтверждение выполнения
                        <input
                          value={evidence[m.id] || ""}
                          onChange={(e) =>
                            setEvidence({ ...evidence, [m.id]: e.target.value })
                          }
                          placeholder="Что передано, кому и когда / ссылка на основание"
                        />
                      </label>
                      <button
                        disabled={busy || !evidence[m.id]?.trim()}
                        onClick={() =>
                          void run(
                            () =>
                              api(`/orders/${selected.id}/milestones/${m.id}`, {
                                method: "PATCH",
                                body: json({
                                  status: "DONE",
                                  evidence: evidence[m.id],
                                }),
                              }),
                            "Обязательство выполнено, основание сохранено.",
                          )
                        }
                      >
                        Зафиксировать выполнение
                      </button>
                    </>
                  )}
                </article>
              ))}
              {!readonly && (
                <details className="outcome-entry">
                  <summary>Добавить согласованное обязательство</summary>
                  <label>
                    Что требуется сделать
                    <input
                      value={label}
                      onChange={(e) => setLabel(e.target.value)}
                    />
                  </label>
                  <div className="form-grid">
                    <label>
                      Категория
                      <select
                        value={category}
                        onChange={(e) => setCategory(e.target.value)}
                      >
                        {Object.entries(categoryNames).map(([key, title]) => (
                          <option key={key} value={key}>
                            {title}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Основание
                      <select
                        value={source}
                        onChange={(e) => setSource(e.target.value)}
                      >
                        <option value="CONTRACT">Договорное</option>
                        <option value="NORMATIVE">Нормативное</option>
                        <option value="RECOMMENDATION">Рекомендованное</option>
                      </select>
                    </label>
                  </div>
                  <label>
                    Источник требования
                    <input
                      value={reference}
                      onChange={(e) => setReference(e.target.value)}
                    />
                  </label>
                  <label>
                    Срок (если согласован)
                    <input
                      type="date"
                      value={dueDate}
                      onChange={(e) => setDueDate(e.target.value)}
                    />
                  </label>
                  <button
                    disabled={busy || !label.trim() || !reference.trim()}
                    onClick={() =>
                      void run(
                        () =>
                          api(`/orders/${selected.id}/milestones`, {
                            method: "POST",
                            body: json({
                              label,
                              source,
                              category,
                              sourceReference: reference,
                              ...(dueDate ? { dueDate } : {}),
                            }),
                          }),
                        "Обязательство добавлено в заказ.",
                      )
                    }
                  >
                    Добавить обязательство
                  </button>
                </details>
              )}
              <OrderFinance
                key={`finance-${selected.id}`}
                orderId={selected.id}
                revision={selected.revision}
                commercial={selected.commercial || {}}
                context={context}
                onChanged={reloadOrders}
              />
              {!!selected.financialDocuments?.length && (
                <details className="outcome-entry">
                  <summary>Сохранённые договоры, счета и акты</summary>
                  {selected.financialDocuments.map((document) => (
                    <p key={document.id}>
                      {(
                        {
                          CONTRACT: "Договор",
                          INVOICE: "Счёт",
                          ACT: "Акт",
                        } as Record<string, string>
                      )[document.type] || document.type}{" "}
                      № {document.number} · {document.documentDate}
                      <small>{document.source}</small>
                    </p>
                  ))}
                </details>
              )}
              <OrderCoordination
                key={`coordination-${selected.id}`}
                order={selected}
                context={context}
                onChanged={reloadOrders}
              />
              <OrderEvidence
                key={`evidence-${selected.id}`}
                orderId={selected.id}
                events={selected.events}
                attachments={selected.attachments}
                canManage={!readonly}
                onChanged={() => setRefresh((v) => v + 1)}
              />
              <p className="fine-print">
                Готовый PDF, передача заказчику, фактическое обучение и расчёты
                имеют отдельные основания завершения.
              </p>
            </section>
          )}
        </div>
      ) : (
        <section className="panel workbench-detail">
          <h2>Потребности из подтверждённой истории</h2>
          {context.user.role === "ADMIN" && (
            <EvidenceMatrix
              context={context}
              scanOnly
              onChanged={() => setRefresh((v) => v + 1)}
            />
          )}
          <p>
            Перед новой заявкой уточните актуальность человека и направления.
            Дата документа сама по себе не означает потребность в продаже.
          </p>
          <label className="checkbox">
            <input
              type="checkbox"
              checked={showArchivedRenewals}
              onChange={(e) => setShowArchivedRenewals(e.target.checked)}
            />
            Показывать завершённые и неактуальные потребности
          </label>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Источник</th>
                  <th>Состояние / следующее обращение</th>
                  <th>Действия</th>
                </tr>
              </thead>
              <tbody>
                {renewalGroups.map((group) => (
                  <Fragment key={group.id}>
                    <tr>
                      <th colSpan={3} scope="rowgroup">
                        {group.name} · потребностей: {group.items.length}
                      </th>
                    </tr>
                    {group.items.map((r) => (
                      <tr key={r.id}>
                        <td>
                          {r.fullNameRu ||
                            r.recipient?.data?.fullNameRu ||
                            r.customer?.nameRu ||
                            "Потребность из истории"}
                          <small>{r.policySource}</small>
                          <small>
                            Политика: {r.policyVersion || "Версия не указана"}.
                            Дата основания: {r.basisDate || "Не указана"}.
                          </small>
                          <Link href={`/requests/${r.sourceRequestId}`}>
                            Исходная заявка
                          </Link>
                        </td>
                        <td>
                          {statuses[r.state] || r.state}
                          <small>
                            Обращение:{" "}
                            {r.nextContactDate ||
                              r.contactAfter ||
                              "Дата обращения не задана"}
                          </small>
                          <small>
                            Срок документа:{" "}
                            {r.documentValidUntil || "Не подтверждён"}
                          </small>
                          <small>
                            Следующая проверка знаний:{" "}
                            {r.nextCheckDate || "Не подтверждена"}
                          </small>
                          {r.reason && <p>Основание состояния: {r.reason}</p>}
                          {!!r.contacts?.length && (
                            <details>
                              <summary>
                                История контактов ({r.contacts.length})
                              </summary>
                              {r.contacts.map((contact) => (
                                <p key={contact.id}>
                                  {contact.occurredOn} ·{" "}
                                  {statuses[contact.outcome] || contact.outcome}
                                  <small>{contact.note}</small>
                                </p>
                              ))}
                            </details>
                          )}
                        </td>
                        <td>
                          {!readonly && (
                            <>
                              <button
                                disabled={busy}
                                onClick={() =>
                                  setContact({
                                    id: r.id,
                                    outcome: "CONTACTED",
                                    note: "",
                                    occurredOn: "",
                                    nextContactDate: "",
                                  })
                                }
                              >
                                Записать результат контакта
                              </button>
                              {r.state === "CONFIRMED" && (
                                <button
                                  disabled={busy}
                                  onClick={() =>
                                    void run(async () => {
                                      const result = await api<{
                                        id?: string;
                                        requestId?: string;
                                      }>(`/renewals/${r.id}/repeat`, {
                                        method: "POST",
                                        body: json({ confirmedCurrent: true }),
                                      });
                                      if (result.requestId || result.id)
                                        window.location.assign(
                                          `/requests/${result.requestId || result.id}`,
                                        );
                                    }, "Создана связанная повторная заявка.")
                                  }
                                >
                                  Создать повторную заявку
                                </button>
                              )}
                            </>
                          )}
                        </td>
                      </tr>
                    ))}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
          {!renewalGroups.length && !busy && !error && (
            <p>
              Потребности пока не подтверждены. Добавляйте их из истории
              оформленной заявки с проверенным источником срока.
            </p>
          )}
          {contact && (
            <form
              className="contact-form"
              onSubmit={(e) => {
                e.preventDefault();
                void run(async () => {
                  await api(`/renewals/${contact.id}/contacts`, {
                    method: "POST",
                    body: json({
                      occurredOn: contact.occurredOn,
                      channel: "MANUAL",
                      outcome: contact.outcome,
                      note: contact.note,
                      ...(contact.nextContactDate
                        ? { nextContactDate: contact.nextContactDate }
                        : {}),
                    }),
                  });
                  setContact(null);
                }, "Результат контакта сохранён.");
              }}
            >
              <h3>Результат обращения</h3>
              <div className="form-grid">
                <label>
                  Дата контакта
                  <input
                    required
                    type="date"
                    value={contact.occurredOn}
                    onChange={(e) =>
                      setContact({ ...contact, occurredOn: e.target.value })
                    }
                  />
                </label>
                <label>
                  Ответ заказчика
                  <select
                    value={contact.outcome}
                    onChange={(e) =>
                      setContact({ ...contact, outcome: e.target.value })
                    }
                  >
                    <option value="CONTACTED">Контакт состоялся</option>
                    <option value="CONFIRMED">Потребность подтверждена</option>
                    <option value="DEFERRED">Отложено</option>
                    <option value="IRRELEVANT">Неактуально</option>
                  </select>
                </label>
                <label>
                  Следующее обращение
                  <input
                    type="date"
                    value={contact.nextContactDate}
                    onChange={(e) =>
                      setContact({
                        ...contact,
                        nextContactDate: e.target.value,
                      })
                    }
                  />
                </label>
              </div>
              <label>
                Подтверждённые сведения / причина
                <textarea
                  required
                  value={contact.note}
                  onChange={(e) =>
                    setContact({ ...contact, note: e.target.value })
                  }
                />
              </label>
              <div className="toolbar-actions">
                <button type="button" onClick={() => setContact(null)}>
                  Отмена
                </button>
                <button className="primary" disabled={busy}>
                  Сохранить контакт
                </button>
              </div>
            </form>
          )}
        </section>
      )}
    </>
  );
}
