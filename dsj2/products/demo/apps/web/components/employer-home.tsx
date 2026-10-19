"use client";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { Notice } from "@demo/ui";
import { api } from "@/lib/api";
import type { AppContext } from "@/lib/types";
import type { Paged } from "@/lib/lms-api";
import type { ResultEnrollment } from "@/lib/results-api";
import { EmployerPortal } from "./employer-portal";
import { EmployerAccessRequests } from "./employer-access-request";
import { LanguageSwitch, LmsHeading, PageControls, Status, lmsError, useLanguage } from "./lms/common";
import "./lms/lms.css";

type Organization = { id: string; nameRu: string; nameKz: string };
type Roster = { customerId: string; permissions: string[]; recipients: { id: string; fullNameRu: string }[] };
type Group = { id: string; name: string; startsAt: string | null; dueAt: string | null };
type Workplace = { timezone: string; calendar: { items: { id: string; titleRu: string; titleKz: string; startsAt: string; href: string }[] } };
type View = "training" | "employees" | "groups";
const pageSize = 25;

export function EmployerHome({ context }: { context: AppContext }) {
  if (context.user.role !== "EMPLOYER") return null;
  return <EmployerHomeContent key={`${context.tenant.id}:${context.user.id}`} context={context} />;
}

function EmployerHomeContent({ context }: { context: AppContext }) {
  const params = useSearchParams();
  const orders = params.get("section") === "orders";
  const scope = `${context.tenant.id}:${context.user.id}`;
  const { language, setLanguage, t } = useLanguage(scope);
  const [organizations, setOrganizations] = useState<Organization[] | null>(null);
  const [customerId, setCustomerId] = useState("");
  const [view, setView] = useState<View>("training");
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("ALL");
  const [page, setPage] = useState(1);
  const [groupPage, setGroupPage] = useState(1);
  const [roster, setRoster] = useState<Roster | null>(null);
  const [trainingPage, setEnrollments] = useState<Paged<ResultEnrollment> | null>(null);
  const [enrollmentScope, setEnrollmentScope] = useState("");
  const [groups, setGroups] = useState<Paged<Group> | null>(null);
  const [workplace, setWorkplace] = useState<Workplace | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [rosterError, setRosterError] = useState<unknown>(null);
  const [trainingError, setTrainingError] = useState<unknown>(null);
  const [groupError, setGroupError] = useState<unknown>(null);
  const [calendarError, setCalendarError] = useState<unknown>(null);
  const [loading, setLoading] = useState(false);
  const [refresh, setRefresh] = useState(0);

  useEffect(() => {
    if (orders) return;
    let active = true;
    void api<{ customers: Organization[] }>("/lms/employer-import/context").then(value => {
      if (!active) return;
      setOrganizations(value.customers);
      setError(null);
      setCustomerId(previous => value.customers.some(item => item.id === previous) ? previous : value.customers[0]?.id || "");
    }).catch(caught => {
      if (active) { setError(caught); setOrganizations(null); setCustomerId(""); setRoster(null); setEnrollments(null); }
    });
    return () => { active = false; };
  }, [orders, scope, refresh]);

  useEffect(() => {
    if (orders || !customerId) return;
    let active = true;
    setRoster(null);
    setRosterError(null);
    void api<Roster>(`/portal/evidence?customerId=${encodeURIComponent(customerId)}`).then(value => {
      if (active) setRoster(value);
    }).catch(caught => { if (active) { setRosterError(caught); setRoster(null); } });
    return () => { active = false; };
  }, [orders, customerId, scope, refresh]);

  useEffect(() => {
    if (orders || view !== "training" || !customerId) return;
    let active = true;
    setLoading(true);
    setEnrollments(null);
    const timer = setTimeout(() => {
      const query = new URLSearchParams({ customerId, page: String(page), pageSize: String(pageSize), search, view: filter, expiringDays: "30" });
      void api<Paged<ResultEnrollment>>(`/lms/enrollments?${query}`).then(value => {
        if (active) { setEnrollments(value); setEnrollmentScope(JSON.stringify([customerId, page, search, filter])); setTrainingError(null); }
      }).catch(caught => { if (active) { setTrainingError(caught); setEnrollments(null); } }).finally(() => { if (active) setLoading(false); });
    }, 250);
    return () => { active = false; clearTimeout(timer); };
  }, [orders, view, customerId, page, search, filter, scope, refresh]);

  useEffect(() => {
    if (orders || view !== "groups") return;
    let active = true;
    setGroups(null);
    void api<Paged<Group>>(`/lms/groups?page=${groupPage}&pageSize=${pageSize}`).then(value => {
      if (active) { setGroups(value); setGroupError(null); }
    }).catch(caught => { if (active) { setGroupError(caught); setGroups(null); } });
    return () => { active = false; };
  }, [orders, view, groupPage, scope, refresh]);

  useEffect(() => {
    if (orders || view !== "training") return;
    let active = true;
    void api<Workplace>("/lms/workplace").then(value => {
      if (active) { setWorkplace(value); setCalendarError(null); }
    }).catch(caught => { if (active) { setCalendarError(caught); setWorkplace(null); } });
    return () => { active = false; };
  }, [orders, view, scope, refresh]);

  useEffect(() => {
    const update = () => { if (!document.hidden) setRefresh(value => value + 1); };
    window.addEventListener("focus", update);
    return () => window.removeEventListener("focus", update);
  }, []);

  const customer = organizations?.find(item => item.id === customerId);
  const activeRoster = roster?.customerId === customerId ? roster : null;
  const enrollments = enrollmentScope === JSON.stringify([customerId, page, search, filter]) ? trainingPage : null;
  const canAssign = !!context.user.canAssignTraining && !!activeRoster?.permissions.includes("ASSIGN_TRAINING");
  const assignmentHref = `/lms/assign${customerId ? `?customerId=${encodeURIComponent(customerId)}` : ""}`;
  const resultHref = `/lms/results${customerId && view !== "groups" ? `?customerId=${encodeURIComponent(customerId)}` : ""}`;
  const people = activeRoster?.recipients.filter(person => person.fullNameRu.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase())) || [];
  const currentError = error || (view === "employees" ? rosterError : view === "groups" ? groupError : trainingError || rosterError);
  const date = (value?: string | null) => value ? new Date(value).toLocaleDateString(t("ru-KZ", "kk-KZ"), { timeZone: context.tenant.timezone || "Asia/Qyzylorda" }) : "—";
  function changeView(value: View) { setView(value); setSearch(""); setPage(1); }

  return <div className="lms-workspace" lang={language === "kz" ? "kk" : "ru"}>
    <div className="lms-task-navigation">
      <nav className="lms-tabs" aria-label={t("Кабинет организации", "Ұйым кабинеті")}>
        <Link href="/portal" aria-current={!orders ? "page" : undefined}>{t("Сотрудники и обучение", "Қызметкерлер және оқу")}</Link>
        <Link href="/portal?section=orders" aria-current={orders ? "page" : undefined}>{t("Заказы и документы", "Тапсырыстар және құжаттар")}</Link>
      </nav>
      <div className="lms-actions lms-task-utilities"><Link href="/lms/notifications">{t("Уведомления", "Хабарламалар")}</Link><LanguageSwitch language={language} onChange={setLanguage} /></div>
    </div>
    {orders ? <EmployerPortal /> : <>
      <LmsHeading title={t("Кабинет организации", "Ұйым кабинеті")}>
        {canAssign && view !== "groups" && <Link className="button primary lms-primary" href={assignmentHref}>{t("Назначить обучение", "Оқуды тағайындау")}</Link>}
        <Link className="button" href={resultHref}>{t("Результаты и документы", "Нәтижелер және құжаттар")}</Link>
      </LmsHeading>
      <div className="lms-actions">
        <button type="button" aria-pressed={view === "training"} onClick={() => changeView("training")}>{t("Обучение", "Оқу")}</button>
        <button type="button" aria-pressed={view === "employees"} onClick={() => changeView("employees")}>{t("Сотрудники", "Қызметкерлер")}</button>
        <button type="button" aria-pressed={view === "groups"} onClick={() => changeView("groups")}>{t("Группы", "Топтар")}</button>
        <Link href="/lms/applications">{t("Мои заявки", "Менің өтінімдерім")}</Link>
        <Link href="/lms/reports">{t("Статистика", "Статистика")}</Link>
      </div>
      {!!currentError && <Notice>{lmsError(currentError, t)} <button type="button" onClick={() => setRefresh(value => value + 1)}>{t("Повторить", "Қайталау")}</button></Notice>}
      {organizations === null && !error && <p role="status">{t("Загружаем кабинет…", "Кабинет жүктелуде…")}</p>}
      {organizations && !organizations.length && <EmployerAccessRequests t={t} />}
      {organizations && organizations.length > 0 && <details><summary>{t("Доступ к другой организации", "Басқа ұйымға рұқсат")}</summary><EmployerAccessRequests t={t} /></details>}
      {view !== "groups" && customer && <section className="panel lms-panel" aria-busy={loading && view === "training"}>
        {organizations && organizations.length > 1 ? <label>{t("Организация", "Ұйым")}<select value={customerId} onChange={event => { setCustomerId(event.target.value); setPage(1); setSearch(""); }}>
          {organizations.map(item => <option key={item.id} value={item.id}>{t(item.nameRu, item.nameKz || item.nameRu)}</option>)}
        </select></label> : <h2>{t(customer.nameRu, customer.nameKz || customer.nameRu)}</h2>}
        <div className="lms-fields">
          <label>{t("Поиск сотрудника по ФИО", "Қызметкерді аты-жөні бойынша іздеу")}<input type="search" value={search} onChange={event => { setSearch(event.target.value); setPage(1); }} /></label>
          {view === "training" && <label>{t("Обучение", "Оқу")}<select value={filter} onChange={event => { setFilter(event.target.value); setPage(1); }}>
            <option value="ALL">{t("Все назначения", "Барлық тағайындаулар")}</option>
            <option value="INCOMPLETE">{t("Не завершено", "Аяқталмаған")}</option>
            <option value="EXPIRING">{t("Срок обучения истекает в течение 30 дней", "Оқу мерзімі 30 күн ішінде аяқталады")}</option>
            <option value="WAITING_DOCUMENTS">{t("Ожидаются документы", "Құжаттар күтілуде")}</option>
          </select></label>}
        </div>
        {view === "employees" ? <>
          {activeRoster ? <>
            <p>{search ? t("Найдено сотрудников", "Табылған қызметкерлер") : t("Сотрудников в доступном составе", "Қолжетімді құрамдағы қызметкерлер")}: {people.length}</p>
            <ul className="lms-list">{people.slice((page - 1) * pageSize, page * pageSize).map(person => <li key={person.id}><strong>{person.fullNameRu}</strong></li>)}</ul>
            {!people.length && <p>{search ? t("По вашему запросу сотрудников нет", "Сұрауыңыз бойынша қызметкерлер жоқ") : t("В доступном составе пока нет сотрудников", "Қолжетімді құрамда әзірше қызметкерлер жоқ")}</p>}
            <PageControls page={page} total={people.length} pageSize={pageSize} onPage={setPage} t={t} />
          </> : !rosterError && <p role="status">{t("Загружаем состав…", "Құрам жүктелуде…")}</p>}
          {canAssign && <Link href={`/lms/import?customerId=${encodeURIComponent(customerId)}`}>{t("Добавить сотрудников и назначить обучение", "Қызметкерлерді қосып, оқуды тағайындау")}</Link>}
        </> : <>
          {loading && <p role="status">{t("Загружаем обучение…", "Оқу жүктелуде…")}</p>}
          {enrollments && <>
            <p>{t("Назначений по выбранному условию", "Таңдалған шарт бойынша тағайындаулар")}: {enrollments.total}</p>
            <div className="table-scroll"><table className="lms-table"><thead><tr>
              <th>{t("Сотрудник", "Қызметкер")}</th><th>{t("Программа и группа", "Бағдарлама және топ")}</th><th>{t("Прогресс", "Үлгерім")}</th><th>{t("Результат", "Нәтиже")}</th><th>{t("Срок обучения", "Оқу мерзімі")}</th><th>{t("Документы", "Құжаттар")}</th>
            </tr></thead><tbody>{enrollments.items.map(item => <tr key={item.id}>
              <td><strong>{t(item.recipient?.data.fullNameRu || "", item.recipient?.data.fullNameKz || item.recipient?.data.fullNameRu || "")}</strong><div className="lms-list-meta">{t(item.recipient?.data.positionRu || "", item.recipient?.data.positionKz || item.recipient?.data.positionRu || "")}</div></td>
              <td>{t(item.courseVersion?.content.titleRu || "", item.courseVersion?.content.titleKz || item.courseVersion?.content.titleRu || "")}{item.group && <div><Link href={`/lms/groups/${encodeURIComponent(item.group.id)}`}>{item.group.name}</Link></div>}</td>
              <td><Status value={item.status} t={t} /><div>{item.progressPercent == null ? "—" : `${item.progressPercent}%`}</div></td>
              <td>{item.result ? <Status value={item.result.state || item.result.verdict} t={t} /> : t("Пока нет", "Әзірше жоқ")}</td>
              <td>{date(item.dueAt)}</td>
              <td><Link href={`/lms/results?enrollmentId=${encodeURIComponent(item.id)}`}>{item.documents?.some(document => document.status === "ISSUED") ? t("Открыть документы", "Құжаттарды ашу") : t("Открыть результат", "Нәтижені ашу")}</Link></td>
            </tr>)}</tbody></table></div>
            {!enrollments.items.length && <p className="lms-empty">{search || filter !== "ALL" ? t("Назначений по выбранным условиям нет", "Таңдалған шарттар бойынша тағайындаулар жоқ") : t("Этой организации ещё не назначено обучение", "Бұл ұйымға әлі оқу тағайындалмаған")}</p>}
            <PageControls page={page} total={enrollments.total} pageSize={pageSize} onPage={setPage} t={t} />
          </>}
        </>}
      </section>}
      {view === "groups" && <section className="panel lms-panel"><h2>{t("Группы доступных организаций", "Қолжетімді ұйымдар топтары")}</h2>
        {groups ? <><ul className="lms-list">{groups.items.map(group => <li key={group.id}><div><strong>{group.name}</strong><div className="lms-list-meta">{date(group.startsAt)} — {date(group.dueAt)}</div></div><Link href={`/lms/groups/${encodeURIComponent(group.id)}`}>{t("Состав и обучение", "Құрам және оқу")}</Link></li>)}</ul>
          {!groups.items.length && <p>{t("Доступных учебных групп пока нет", "Әзірше қолжетімді оқу топтары жоқ")}</p>}
          <PageControls page={groupPage} total={groups.total} pageSize={pageSize} onPage={setGroupPage} t={t} />
        </> : !groupError && <p role="status">{t("Загружаем группы…", "Топтар жүктелуде…")}</p>}
      </section>}
      {view === "training" && !!workplace?.calendar.items.length && <section className="panel lms-panel"><h2>{t("Ближайшие события доступных организаций", "Қолжетімді ұйымдардың алдағы оқиғалары")}</h2><ul className="lms-list">{workplace.calendar.items.map(event => <li key={event.id}><div>{t(event.titleRu, event.titleKz || event.titleRu)}<div className="lms-list-meta">{new Date(event.startsAt).toLocaleString(t("ru-KZ", "kk-KZ"), { timeZone: workplace.timezone, dateStyle: "short", timeStyle: "short" })}</div></div><Link href={event.href.startsWith("/lms/") && !event.href.startsWith("//") ? event.href : "/lms/calendar"}>{t("Открыть", "Ашу")}</Link></li>)}</ul></section>}
      {view === "training" && !!calendarError && <Notice>{lmsError(calendarError, t)} <button type="button" onClick={() => setRefresh(value => value + 1)}>{t("Обновить события", "Оқиғаларды жаңарту")}</button></Notice>}
    </>}
  </div>;
}
