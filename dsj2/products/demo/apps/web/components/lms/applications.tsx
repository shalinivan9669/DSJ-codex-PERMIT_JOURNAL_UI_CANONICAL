"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Notice } from "@demo/ui";
import type { AppContext } from "@/lib/types";
import { api, json } from "@/lib/api";
import { zonedInputToIso } from "@/lib/learning-time";
import {
  applications,
  applicationStateText,
  type Application,
  type ApplicationOrder,
} from "@/lib/lms-applications";
import { LmsHeading, PageControls, type Translate } from "./common";

import { applicationError } from "./application-errors";
import { OperatorApplication } from "./operator-application";
import { LearnerAccess } from "./learner-access";
const label = (value: string, t: Translate) =>
  applicationStateText[value]
    ? t(...applicationStateText[value])
    : t("Не подтверждено", "Расталмады");
export function Applications({
  context,
  t,
}: {
  context: AppContext;
  t: Translate;
}) {
  const staff = ["SUPER_ADMIN", "ADMIN", "DIRECTOR", "OPERATOR"].includes(context.user.role);
  const [creating, setCreating] = useState(false);
  const [loading, setLoading] = useState(true);
  const basePath = context.user.role === "LEARNER" ? "/learn/applications" : "/lms/applications";
  const [data, setData] = useState<{
    items: Application[];
    total: number;
    pageSize: number;
  }>({ items: [], total: 0, pageSize: 50 });
  const [page, setPage] = useState(1),
    [search, setSearch] = useState(""),
    [state, setState] = useState("");
  const [error, setError] = useState<unknown>(null),
    [refresh, setRefresh] = useState(0),
    [selected, setSelected] = useState("");
  useEffect(() => {
    const query = new URLSearchParams(window.location.search);
    setSelected(query.get("id") || query.get("applicationId") || "");
    setCreating(staff && query.get("new") === "1");
  }, []);
  useEffect(() => {
    let alive = true;
    if (creating) return () => { alive = false; };
    setLoading(true);
    const timer = setTimeout(() => {
      void applications
        .list(page, search, state, selected)
        .then((v) => {
          if (alive) {
            setData(v);
            setError(null);
          }
        })
        .catch((e) => {
          if (alive) setError(e);
        }).finally(() => { if (alive) setLoading(false); });
    }, 120);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [page, search, state, selected, creating, refresh]);
  return (
    <>
      <LmsHeading
        title={
          staff
            ? t("Заявки на обучение", "Оқуға өтінімдер")
            : t("Мои заявки", "Менің өтінімдерім")
        }
      >
        {!creating && (selected ? <button onClick={() => { setSelected(""); window.history.replaceState(null, "", basePath); }}>{t("К заявкам", "Өтінімдерге")}</button> : staff ? <button className="primary lms-primary" onClick={() => setCreating(true)}>{t("Создать заявку", "Өтінім құру")}</button> : <Link className="button" href="/catalogue">{t("Программы", "Бағдарламалар")}</Link>)}
      </LmsHeading>
      {staff && creating && <OperatorApplication t={t} scope={`${context.tenant.id}:${context.user.id}`} onClose={() => setCreating(false)} onCreated={(id) => {
        setCreating(false); setSelected(id); setPage(1); setState(""); setSearch("");
        window.history.replaceState(null, "", `/lms/applications?id=${encodeURIComponent(id)}`);
        setRefresh((n) => n + 1);
      }} />}
      {!creating && <>
      {!!error && (
        <Notice>
          <span role="alert">{applicationError(error, t)}</span>
          <button onClick={() => setRefresh((n) => n + 1)}>
            {t("Повторить", "Қайталау")}
          </button>
        </Notice>
      )}
      <section className="panel lms-panel">
        {!selected &&
        <div className="lms-toolbar">
          <label>
            {t("Поиск", "Іздеу")}
            <input
              type="search"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
            />
          </label>
          <label>
            {t("Состояние", "Күйі")}
            <select
              value={state}
              onChange={(e) => {
                setState(e.target.value);
                setPage(1);
              }}
            >
              <option value="">{t("Все", "Барлығы")}</option>
              {[
                "NEW",
                "PROCESSING",
                "RETURNED",
                "REJECTED",
                "ACCEPTED",
                "CANCELLED",
              ].map((s) => (
                <option key={s} value={s}>
                  {label(s, t)}
                </option>
              ))}
            </select>
          </label>
        </div>}
        {loading && <p role="status">{t("Загружаем заявку…", "Өтінім жүктелуде…")}</p>}
        <ul className="lms-list">
          {data.items.filter((row) => !selected || row.id === selected).map((row) => (
            <li key={row.id}>
              <div>
                <strong>
                  {row.contact.organization || row.contact.contactName}
                </strong>
                <div>
                  {t(row.titleRu, row.titleKz)} · {row.quantity}{" "}
                  {t("чел.", "адам")}
                </div>
                <div className="lms-list-meta">
                  <span>{label(row.state, t)}</span>
                  <span>
                    {new Date(row.createdAt).toLocaleDateString("ru-RU", {
                      timeZone: context.tenant.timezone || "Asia/Qyzylorda",
                    })}
                  </span>
                  {row.ownerName && <span>{row.ownerName}</span>}
                </div>
                {row.reason && <p>{row.reason}</p>}
                {row.enrollmentId && !staff && row.kind === "B2C" && (
                  <Link
                    className="button primary"
                    href={`/learn/${row.enrollmentId}`}
                  >
                    {t("Начать / продолжить", "Бастау / жалғастыру")}
                  </Link>
                )}
              </div>
              <button
                onClick={() => {
                  const id = selected === row.id ? "" : row.id;
                  setSelected(id);
                  window.history.replaceState(null, "", id ? `${basePath}?id=${encodeURIComponent(id)}` : basePath);
                }}
                aria-expanded={selected === row.id}
              >
                {selected === row.id ? t("Закрыть карточку", "Карточканы жабу") : t("Открыть", "Ашу")}
              </button>
              {selected === row.id && (
                <ApplicationDetail
                  key={row.id}
                  row={row}
                  staff={staff}
                  t={t}
                  timezone={context.tenant.timezone || "Asia/Qyzylorda"}
                  refresh={() => setRefresh((n) => n + 1)}
                />
              )}
            </li>
          ))}
        </ul>
        {!loading && !data.items.length && (
          <p>{t("Заявок пока нет.", "Өтінімдер әлі жоқ.")}</p>
        )}
        {!selected && <PageControls
          page={page}
          total={data.total}
          pageSize={50}
          onPage={setPage}
          t={t}
        />}
      </section>
      </>}
    </>
  );
}
function ApplicationDetail({
  row,
  staff,
  t,
  refresh,
  timezone,
}: {
  row: Application;
  staff: boolean;
  t: Translate;
  refresh: () => void;
  timezone: string;
}) {
  const [reason, setReason] = useState(""),
    [comment, setComment] = useState(row.comment),
    [customerId, setCustomerId] = useState(row.customerId || ""),
    [createOrganization, setCreateOrganization] = useState(false);
  const [orgs, setOrgs] = useState<
      { id: string; nameRu: string; bin: string }[]
    >([]),
    [orgSearch, setOrgSearch] = useState(
      row.contact.bin || row.contact.organization || "",
    );
  const [error, setError] = useState<unknown>(null),
    [busy, setBusy] = useState(false),
    [order, setOrder] = useState<ApplicationOrder | null>(null);
  const errorRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (row.orderId)
      void applications.order(row.id).then(setOrder).catch(setError);
  }, [row.id, row.revision, row.orderId]);
  useEffect(() => {
    if (!staff || row.kind !== "B2B" || row.state === "ACCEPTED") return;
    let alive = true;
    const timer = setTimeout(() => {
      void api<{ items: { id: string; nameRu: string; bin: string }[] }>(
        `/customers?search=${encodeURIComponent(orgSearch)}`,
      )
        .then((v) => {
          if (alive) setOrgs(v.items);
        })
        .catch(setError);
    }, 180);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [staff, row.kind, row.state, orgSearch]);
  useEffect(() => {
    if (error) errorRef.current?.focus();
  }, [error]);
  async function action(action: string) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await applications.action(row.id, {
        action,
        revision: row.revision,
        reason,
        comment,
        ...(customerId ? { customerId } : {}),
        createOrganization,
      });
      refresh();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div style={{ width: "100%", flexBasis: "100%" }}>
      <p>
        {row.contact.contactName} · {row.contact.email} · {row.contact.phone}
      </p>
      {row.contact.bin && (
        <p>
          {t("БИН", "БСН")}: {row.contact.bin}
        </p>
      )}
      {row.comment && <p>{row.comment}</p>}
      {!!error && (
        <div ref={errorRef} tabIndex={-1}>
          <Notice>
            {applicationError(error, t)}
            <button
              onClick={() => {
                refresh();
                if (row.orderId)
                  void applications
                    .order(row.id)
                    .then(setOrder)
                    .catch(setError);
              }}
            >
              {t("Обновить состояние", "Күйін жаңарту")}
            </button>
          </Notice>
        </div>
      )}
      {staff && ["NEW", "PROCESSING", "RETURNED"].includes(row.state) && (
        <>
          {row.kind === "B2B" && !row.customerId && (
            <details open>
              <summary>
                {t("Подтверждённая организация", "Расталған ұйым")}
              </summary>
              <label>
                {t("Найти организацию", "Ұйымды табу")}
                <input
                  value={orgSearch}
                  onChange={(e) => setOrgSearch(e.target.value)}
                />
              </label>
              <label>
                {t("Связать с записью", "Жазбамен байланыстыру")}
                <select
                  value={customerId}
                  onChange={(e) => {
                    setCustomerId(e.target.value);
                    setCreateOrganization(false);
                  }}
                >
                  <option value="">{t("Не выбрана", "Таңдалмады")}</option>
                  {orgs.map((org) => (
                    <option key={org.id} value={org.id}>
                      {org.nameRu} · {org.bin}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <input
                  type="checkbox"
                  checked={createOrganization}
                  onChange={(e) => {
                    setCreateOrganization(e.target.checked);
                    if (e.target.checked) setCustomerId("");
                  }}
                />
                {t(
                  "Создать организацию по проверенным данным заявки",
                  "Тексерілген өтінім деректерімен ұйым құру",
                )}
              </label>
            </details>
          )}
          <div className="lms-toolbar">
            <button
              className="primary lms-primary"
              disabled={
                busy ||
                (row.kind === "B2B" && !customerId && !createOrganization)
              }
              onClick={() => void action("ACCEPT")}
            >
              {row.kind === "B2C" ? t("Принять и назначить обучение", "Қабылдау және оқуды тағайындау") : t("Принять заявку и создать заказ", "Өтінімді қабылдау және тапсырыс құру")}
            </button>
            {row.state !== "PROCESSING" && (
              <button disabled={busy} onClick={() => void action("TAKE")}>
                {t("Взять в работу", "Жұмысқа алу")}
              </button>
            )}
          </div>
          <details>
            <summary>
              {t("Вернуть или отклонить", "Қайтару немесе қабылдамау")}
            </summary>
            <label>
              {t(
                "Причина и необходимое исправление",
                "Себеп және қажетті түзету",
              )}
              <textarea
                maxLength={2000}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            </label>
            <button
              disabled={busy || !reason.trim()}
              onClick={() => void action("RETURN")}
            >
              {t("Вернуть для уточнения", "Нақтылауға қайтару")}
            </button>
            <button
              disabled={busy || !reason.trim()}
              onClick={() => void action("REJECT")}
            >
              {t("Отклонить", "Қабылдамау")}
            </button>
          </details>
        </>
      )}
      {!staff && row.state === "RETURNED" && (
        <>
          <label>
            {t("Уточнение", "Нақтылау")}
            <textarea
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              maxLength={2000}
            />
          </label>
          <button
            className="primary"
            disabled={busy}
            onClick={() => void action("RESUBMIT")}
          >
            {t("Отправить уточнение", "Нақтылауды жіберу")}
          </button>
        </>
      )}
      {!staff && ["NEW", "RETURNED"].includes(row.state) && (
        <button disabled={busy} onClick={() => void action("CANCEL")}>
          {t("Отменить заявку", "Өтінімді жою")}
        </button>
      )}
      {staff &&
        row.state === "ACCEPTED" &&
        row.kind === "B2C" &&
        !row.enrollmentId && (
          <button disabled={busy} onClick={() => void action("ACCEPT")}>
            {t("Продолжить назначение", "Тағайындауды жалғастыру")}
          </button>
        )}
      {order?.order && (
        <>
          {staff && row.recipientId && row.enrollmentId && <LearnerAccess recipientIds={[row.recipientId]} t={t} />}
          <div className="lms-toolbar">
            {staff && (
              <Link className="button" href={`/workbench?orderId=${order.order.id}`}>
                {t(
                  "Заказ, документы и оплата",
                  "Тапсырыс, құжаттар және төлем",
                )}
              </Link>
            )}
            {row.kind === "B2B" && (
              <Link
                className="button primary"
                href={`/lms/import?orderId=${order.order.id}&applicationId=${row.id}`}
              >
                {t("Заполнить состав и назначить", "Құрамды толтыру және тағайындау")}
              </Link>
            )}
          </div>
          {staff && row.kind === "B2B" && <Link href={`/lms/assign?orderId=${order.order.id}&versionId=${row.courseVersionId}&customerId=${row.customerId || ""}`}>{t("Выбрать людей из реестра", "Адамдарды тізілімнен таңдау")}</Link>}
          <p>
            {t("Назначено", "Тағайындалды")}: {order.assigned}/{order.expected}{" "}
            · {t("Завершили обучение", "Оқуды аяқтады")}: {order.completed}/
            {order.expected} · {t("Документы готовы", "Құжаттар дайын")}:{" "}
            {order.documentsReady}/{order.expected}
          </p>
          <Link href={`/lms/results?sourceOrderId=${order.order.id}`}>
            {t("Открыть результаты", "Нәтижелерді ашу")}
          </Link>
          {staff && (
            <OrderStages
              applicationId={row.id}
              initial={order}
              t={t}
              timezone={timezone}
            />
          )}
        </>
      )}
    </div>
  );
}
function OrderStages({
  applicationId,
  initial,
  t,
  timezone,
}: {
  applicationId: string;
  initial: ApplicationOrder;
  t: Translate;
  timezone: string;
}) {
  const [order, setOrder] = useState(initial),
    [stage, setStage] = useState("CONTACT"),
    [waived, setWaived] = useState(false),
    [evidence, setEvidence] = useState(""),
    [date, setDate] = useState(""),
    [documentId, setDocumentId] = useState("");
  const [error, setError] = useState<unknown>(null),
    [busy, setBusy] = useState(false);
  useEffect(() => setOrder(initial), [initial]);
  async function save(close = false) {
    if (!order.order || busy) return;
    setBusy(true);
    setError(null);
    try {
      if (close)
        await api(`/lms/applications/${applicationId}/close`, {
          method: "POST",
          body: json({ revision: order.order.revision, reason: evidence }),
        });
      else
        await applications.stage(applicationId, {
          stage,
          revision: order.order.revision,
          status: waived ? "WAIVED" : "DONE",
          evidence,
          reason: waived ? evidence : "",
          occurredAt: date ? zonedInputToIso(date, timezone) : undefined,
          financialDocumentId: documentId || undefined,
        });
      setOrder(await applications.order(applicationId));
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }
  return (
    <details>
      <summary>
        {t("Этапы заказа", "Тапсырыс кезеңдері")} ·{" "}
        {label(order.order?.status || "OPEN", t)}
      </summary>
      <p>{label(order.payment?.state || "UNKNOWN", t)}</p>
      <ul>
        {order.stages?.map((item) => (
          <li key={item.stage}>
            {label(item.stage, t)} ·{" "}
            {item.record
              ? label(item.record.status, t)
              : t("Нет подтверждения", "Растау жоқ")}
            {item.record?.reason && ` · ${item.record.reason}`}
          </li>
        ))}
      </ul>
      {order.order?.status !== "CLOSED" && (
        <>
          <label>
            {t("Этап", "Кезең")}
            <select
              value={stage}
              onChange={(e) => {
                setStage(e.target.value);
                setDocumentId("");
                if (e.target.value === "SETTLEMENT") setWaived(true);
              }}
            >
              {order.stages?.map((item) => (
                <option key={item.stage} value={item.stage}>
                  {label(item.stage, t)}
                </option>
              ))}
            </select>
          </label>
          <label>
            <input
              type="checkbox"
              checked={waived}
              disabled={stage === "SETTLEMENT"}
              onChange={(e) => setWaived(e.target.checked)}
            />
            {t("Не применяется", "Қолданылмайды")}
          </label>
          <label>
            {waived
              ? t("Причина", "Себеп")
              : t(
                  "Подтверждённое событие / ссылка",
                  "Расталған оқиға / сілтеме",
                )}
            <textarea
              maxLength={2000}
              value={evidence}
              onChange={(e) => setEvidence(e.target.value)}
            />
          </label>
          {!waived && (
            <label>
              {t("Когда произошло", "Қашан болды")}
              <input
                type="datetime-local"
                value={date}
                onChange={(e) => setDate(e.target.value)}
              />
            </label>
          )}
          {!waived && ["CONTRACT", "INVOICE"].includes(stage) && (
            <label>
              {t("Документ заказа", "Тапсырыс құжаты")}
              <select
                value={documentId}
                onChange={(e) => setDocumentId(e.target.value)}
              >
                <option value="">
                  {t("Выберите документ", "Құжатты таңдаңыз")}
                </option>
                {order.financialDocuments
                  ?.filter((d) => d.type === stage)
                  .map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.number} · {d.documentDate}
                    </option>
                  ))}
              </select>
            </label>
          )}
          {!!error && (
            <p role="alert">
              {applicationError(error, t)}{" "}
              <button
                onClick={() =>
                  void applications
                    .order(applicationId)
                    .then(setOrder)
                    .catch(setError)
                }
              >
                {t("Обновить состояние", "Күйін жаңарту")}
              </button>
            </p>
          )}
          <button
            className="primary"
            disabled={busy || !evidence.trim() || (!waived && !date)}
            onClick={() => void save()}
          >
            {t("Подтвердить этап", "Кезеңді растау")}
          </button>
          <details>
            <summary>{t("Закрытие заказа", "Тапсырысты жабу")}</summary>
            <button
              disabled={busy || !evidence.trim()}
              onClick={() => void save(true)}
            >
              {t(
                "Закрыть по завершённым фактам",
                "Аяқталған деректер бойынша жабу",
              )}
            </button>
          </details>
        </>
      )}
    </details>
  );
}
