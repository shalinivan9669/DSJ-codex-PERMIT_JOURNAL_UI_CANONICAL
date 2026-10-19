"use client";
import { useEffect, useState } from "react";
import { Notice } from "@demo/ui";
import { api } from "@/lib/api";
import type { Page } from "@/lib/types";
import { cabinetError, useCabinetLanguage, useCabinetText } from "./cabinet-language";
import { auditActions, auditFields } from "./audit-labels";
import "./cabinet-responsive.css";

type SafeValues = Record<string, string | number | boolean | null>;
type AuditEntry = {
  id: string;
  createdAt: string;
  action: string;
  actorId: string;
  actorDisplayName?: string | null;
  entityId: string;
  entityType?: string | null;
  ip?: string | null;
  before?: SafeValues | null;
  after?: SafeValues | null;
  details?: SafeValues | null;
};

export function AuditLog({ timezone }: { timezone: string }) {
  const t = useCabinetLanguage();
  const tr = useCabinetText();
  const [page, setPage] = useState(1);
  const [revision, setRevision] = useState(0);
  const [data, setData] = useState<Page<AuditEntry> | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<unknown>(null);
  useEffect(() => {
    let active = true;
    setBusy(true); setError(null); setData(null);
    void api<Page<AuditEntry>>("/audit?page=" + page).then(result => {
      if (!active) return;
      const pageSize = result.pageSize || 50;
      const lastPage = Math.max(1, Math.ceil(result.total / pageSize));
      if (page > lastPage) { setPage(lastPage); return; }
      // Retain only the API's explicitly safe projection; never arbitrary metadata.
      setData({ items: result.items.map(({ id, createdAt, action, actorId, actorDisplayName, entityId, entityType, ip, before, after, details }) => ({ id, createdAt, action, actorId, actorDisplayName, entityId, entityType, ip, before, after, details })), total: result.total, page: result.page || page, pageSize });
    }).catch(caught => { if (active) setError(caught); }).finally(() => { if (active) setBusy(false); });
    return () => { active = false; };
  }, [page, revision]);
  const pages = Math.max(1, Math.ceil((data?.total || 0) / (data?.pageSize || 50)));
  const dateLabel = (value: string) => Number.isNaN(Date.parse(value)) ? "—" : new Date(value).toLocaleString(t("ru-KZ", "kk-KZ"), { timeZone: timezone });
  function values(value?: SafeValues | null) {
    if (!value || !Object.keys(value).length) return <span className="muted">{t("Не зафиксировано", "Тіркелмеген")}</span>;
    return <dl className="audit-values">{Object.entries(value).map(([key, entry]) => <div key={key}>
      <dt>{auditFields[key] ? t(...auditFields[key]) : key}</dt>
      <dd>{entry === null ? "—" : entry === true ? t("Да", "Иә") : entry === false ? t("Нет", "Жоқ") : String(entry)}</dd>
    </div>)}</dl>;
  }
  return <div className="audit-log">
    <div className="section-heading"><h2>{t("Журнал аудита", "Аудит журналы")}</h2><button type="button" disabled={busy} onClick={() => setRevision(value => value + 1)}>{t("Обновить", "Жаңарту")}</button></div>
    {!!error && <Notice><span role="alert">{cabinetError(error, tr)}</span></Notice>}
    <div aria-live="polite">
      {busy && <p className="muted">{t("Загружаем события…", "Оқиғалар жүктелуде…")}</p>}
      {data && <p className="muted">{t("Событий", "Оқиғалар")}: {data.total}. {t("Время учебного центра", "Оқу орталығының уақыты")} ({timezone}).</p>}
      {data && !data.items.length && <p>{t("В журнале пока нет событий.", "Журналда әзірше оқиғалар жоқ.")}</p>}
    </div>
    {!!data?.items.length && <div className="table-scroll" tabIndex={0} role="region" aria-label={t("События аудита", "Аудит оқиғалары")}>
      <table><thead><tr><th>{t("Время", "Уақыт")}</th><th>{t("Действие", "Әрекет")}</th><th>{t("Кто выполнил", "Орындаушы")}</th><th>{t("Объект", "Нысан")}</th><th>{t("IP-адрес", "IP мекенжайы")}</th><th>{t("Изменения", "Өзгерістер")}</th></tr></thead>
        <tbody>{data.items.map(entry => <tr key={entry.id}>
          <td><time dateTime={entry.createdAt}>{dateLabel(entry.createdAt)}</time></td>
          <td>{auditActions[entry.action] ? t(...auditActions[entry.action]) : t("Событие центра", "Орталық оқиғасы")}<small className="muted">{entry.action}</small></td>
          <td>{entry.actorDisplayName || <span className="muted">{entry.actorId || t("Система", "Жүйе")}</span>}{entry.actorDisplayName && <small className="muted">{entry.actorId}</small>}</td>
          <td>{entry.entityType && <small>{entry.entityType}</small>}<span className="muted">{entry.entityId}</span></td>
          <td>{entry.ip || t("Не зафиксирован", "Тіркелмеген")}</td>
          <td><details><summary>{t("Подробности", "Толығырақ")}</summary>
            <h3>{t("До изменения", "Өзгеріске дейін")}</h3>{values(entry.before)}
            <h3>{t("После изменения", "Өзгерістен кейін")}</h3>{values(entry.after)}
            {entry.details && Object.keys(entry.details).length > 0 && <><h3>{t("Сведения о действии", "Әрекет туралы мәліметтер")}</h3>{values(entry.details)}</>}
          </details></td>
        </tr>)}</tbody>
      </table>
    </div>}
    {(page > 1 || pages > 1) && <nav className="actions" aria-label={t("Страницы журнала аудита", "Аудит журналының беттері")}>
      <button type="button" disabled={busy || page <= 1} onClick={() => setPage(value => value - 1)}>{t("Назад", "Артқа")}</button>
      <span>{t("Страница", "Бет")} {page}{data ? " / " + pages : ""}</span>
      <button type="button" disabled={busy || !data || page >= pages} onClick={() => setPage(value => value + 1)}>{t("Далее", "Әрі қарай")}</button>
    </nav>}
  </div>;
}
