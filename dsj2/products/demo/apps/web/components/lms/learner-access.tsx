"use client";
import { useEffect, useMemo, useState } from "react";
import { Notice } from "@demo/ui";
import { api, ApiError, json } from "@/lib/api";
import { lmsError, type Translate } from "./common";

type AccessRow = {
  recipientId: string; nameRu: string; nameKz: string; email: string;
  state: "LINKED" | "ACCOUNT_UNAVAILABLE" | "INVITED" | "INVITE_EXPIRED" | "NOT_LINKED";
  userId: string | null; expiresAt: string | null; assignedCount: number; available: boolean; canInvite: boolean;
};
type Prepared = { url: string; expiresAt?: string; recovery?: boolean };

export function LearnerAccess({ recipientIds, customerId, t, canRecover = false }: {
  recipientIds: string[]; customerId?: string; t: Translate; canRecover?: boolean;
}) {
  const key = [...new Set(recipientIds)].sort().join(",");
  const ids = useMemo(() => key ? key.split(",") : [], [key]);
  const [page, setPage] = useState(0);
  const [rows, setRows] = useState<AccessRow[]>([]);
  const [emails, setEmails] = useState<Record<string, string>>({});
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [prepared, setPrepared] = useState<Record<string, Prepared>>({});
  const [rowErrors, setRowErrors] = useState<Record<string, unknown>>({});
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false), [loading, setLoading] = useState(false);
  const [refresh, setRefresh] = useState(0), [copied, setCopied] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const actualPage = Math.min(page, Math.max(0, Math.ceil(ids.length / 25) - 1));
  const visibleRows = rows.slice(actualPage * 25, (actualPage + 1) * 25);
  useEffect(() => { setPage(0); setPrepared({}); setRowErrors({}); }, [key, customerId]);
  useEffect(() => {
    let active = true;
    if (!key) { setRows([]); setLoading(false); return; }
    setLoading(true);
    void (async () => {
      const items: AccessRow[] = [];
      const selectedIds = key.split(",");
      for (let offset = 0; offset < selectedIds.length && active; offset += 250) {
        const batch = await api<{ items: AccessRow[] }>("/lms/learner-access/query", {
          method: "POST", body: json({ recipientIds: selectedIds.slice(offset, offset + 250), ...(customerId ? { customerId } : {}) }),
        });
        items.push(...batch.items);
      }
      return { items };
    })().then(value => {
      if (!active) return;
      setRows(value.items); setError(null);
      setEmails(previous => ({ ...previous, ...Object.fromEntries(value.items.map(row => [row.recipientId, previous[row.recipientId] ?? row.email])) }));
      setSelected(previous => ({ ...previous, ...Object.fromEntries(value.items.map(row => [row.recipientId, previous[row.recipientId] ?? (row.state === "NOT_LINKED" || row.state === "INVITE_EXPIRED")])) }));
    }).catch(caught => { if (active) { setError(caught); if (caught instanceof ApiError && [401, 403].includes(caught.status)) { setRows([]); setPrepared({}); setSelected({}); setEmails({}); } } }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [key, customerId, refresh]);
  useEffect(() => {
    const focus = () => setRefresh(value => value + 1);
    window.addEventListener("focus", focus);
    const timer = window.setInterval(() => { if (!busy && document.visibilityState === "visible") focus(); }, 30_000);
    return () => { window.removeEventListener("focus", focus); window.clearInterval(timer); };
  }, [busy]);
  const chosen = rows.filter(row => selected[row.recipientId] && !["LINKED", "ACCOUNT_UNAVAILABLE"].includes(row.state) && row.canInvite);
  async function prepare() {
    if (busy || loading) return;
    setBusy(true); setCopied(false);
    setProgress({ done: 0, total: chosen.length });
    try {
      for (const row of chosen) {
        try {
          const result = await api<Prepared>("/lms/invites", { method: "POST", body: json({ recipientId: row.recipientId, email: (emails[row.recipientId] || "").trim(), ...(customerId ? { customerId } : {}) }) });
          setPrepared(previous => ({ ...previous, [row.recipientId]: { ...result, url: new URL(result.url, window.location.origin).toString() } }));
          setRowErrors(previous => ({ ...previous, [row.recipientId]: null }));
          setSelected(previous => ({ ...previous, [row.recipientId]: false }));
        } catch (caught) {
          setRowErrors(previous => ({ ...previous, [row.recipientId]: caught }));
        }
        setProgress(previous => ({ ...previous, done: previous.done + 1 }));
      }
      setRefresh(value => value + 1);
    } finally { setBusy(false); }
  }
  async function recover(row: AccessRow) {
    if (busy || !row.userId) return;
    setBusy(true);
    try {
      const result = await api<Prepared>("/lms/recovery", { method: "POST", body: json({ userId: row.userId }) });
      setPrepared(previous => ({ ...previous, [row.recipientId]: { ...result, recovery: true, url: new URL(result.url, window.location.origin).toString() } }));
      setRowErrors(previous => ({ ...previous, [row.recipientId]: null }));
    } catch (caught) { setRowErrors(previous => ({ ...previous, [row.recipientId]: caught })); }
    finally { setBusy(false); }
  }
  async function copy(value: string) {
    try { await navigator.clipboard.writeText(value); setCopied(true); }
    catch { setError({ code: "CLIPBOARD_UNAVAILABLE" }); }
  }
  if (!ids.length) return null;
  return <section className="panel lms-panel lms-access" aria-busy={busy || loading}>
    <h2>{t("Доступ слушателей", "Тыңдаушылардың қолжетімділігі")}</h2>
    {!!error && <Notice>{lmsError(error, t)} <button type="button" disabled={busy} onClick={() => setRefresh(value => value + 1)}>{t("Повторить", "Қайталау")}</button></Notice>}
    {loading && <p role="status">{t("Открываем доступы…", "Қолжетімділікті жүктеуде…")}</p>}
    <div className="lms-table-scroll" role="region" aria-label={t("Слушатели и доступ", "Тыңдаушылар және қолжетімділік")} tabIndex={0}>
      <table className="lms-table"><thead><tr><th>{t("Слушатель", "Тыңдаушы")}</th><th>{t("Доступ", "Қолжетімділік")}</th><th>{t("Передать слушателю", "Тыңдаушыға беру")}</th></tr></thead>
        <tbody>{visibleRows.map(row => <tr key={row.recipientId}>
          <td><label className="lms-inline-label">
            {!["LINKED", "ACCOUNT_UNAVAILABLE"].includes(row.state) && row.canInvite && <input type="checkbox" disabled={busy || loading} checked={!!selected[row.recipientId]} onChange={event => setSelected(previous => ({ ...previous, [row.recipientId]: event.target.checked }))} />}
            <span>{t(row.nameRu, row.nameKz || row.nameRu)}</span>
          </label></td>
          <td>{row.state === "LINKED" ? row.available ? t("Доступ открыт", "Қолжетімділік ашық") : t("Аккаунт связан · проверьте сроки назначения", "Тіркелгі байланысқан · тағайындау мерзімін қараңыз") : row.state === "ACCOUNT_UNAVAILABLE" ? t("Аккаунт недоступен · обратитесь к директору", "Тіркелгі қолжетімсіз · директорға хабарласыңыз") : !row.assignedCount ? t("Сначала назначьте обучение", "Алдымен оқуды тағайындаңыз") : !row.canInvite ? t("Срок назначения истёк · продлите доступ к обучению", "Тағайындау мерзімі өткен · оқу қолжетімділігін ұзартыңыз") : row.state === "INVITED" ? t("Приглашение подготовлено · ожидает активации", "Шақыру дайын · белсендіруді күтуде") : row.state === "INVITE_EXPIRED" ? t("Приглашение истекло", "Шақыру мерзімі өткен") : t("Нужно приглашение", "Шақыру қажет")}
            {row.expiresAt && <small className="lms-list-meta">{t("Срок ссылки", "Сілтеме мерзімі")}: {new Date(row.expiresAt).toLocaleString(t("ru-KZ", "kk-KZ"))}</small>}
          </td>
          <td>{row.state === "LINKED" ? <><span>{row.email}</span><p><button type="button" onClick={() => void copy(`${row.email}\n${window.location.origin}/login`)}>{t("Скопировать адрес входа", "Кіру мекенжайын көшіру")}</button></p>{canRecover && <details><summary>{t("Восстановление доступа", "Қолжетімділікті қалпына келтіру")}</summary><button type="button" disabled={busy} onClick={() => void recover(row)}>{t("Подготовить ссылку восстановления", "Қалпына келтіру сілтемесін дайындау")}</button></details>}</> : row.state !== "ACCOUNT_UNAVAILABLE" && row.canInvite && <label>{t("Электронная почта", "Электрондық пошта")}<input type="email" autoComplete="off" disabled={busy} value={emails[row.recipientId] || ""} onChange={event => setEmails(previous => ({ ...previous, [row.recipientId]: event.target.value }))} /></label>}
            {!!rowErrors[row.recipientId] && <p className="lms-error" role="alert">{lmsError(rowErrors[row.recipientId], t)}</p>}
            {prepared[row.recipientId] && <label>{prepared[row.recipientId].recovery ? t("Ссылка восстановления", "Қалпына келтіру сілтемесі") : t("Личная ссылка активации", "Жеке белсендіру сілтемесі")}<input readOnly value={prepared[row.recipientId].url} onFocus={event => event.target.select()} /><button type="button" onClick={() => void copy(prepared[row.recipientId].url)}>{t("Скопировать ссылку", "Сілтемені көшіру")}</button></label>}
          </td>
        </tr>)}</tbody>
      </table>
    </div>
    {!!chosen.length && <div className="lms-actions"><button type="button" className="primary" disabled={busy || loading} onClick={() => void prepare()}>{busy ? t("Подготавливаем…", "Дайындауда…") : `${t("Подготовить приглашения", "Шақыруларды дайындау")} · ${chosen.length}`}</button></div>}
    {busy && progress.total > 0 && <p role="status">{progress.done} / {progress.total}</p>}
    {rows.some(row => rowErrors[row.recipientId]) && <p className="lms-error"><button type="button" disabled={busy} onClick={() => setPage(Math.floor(rows.findIndex(row => rowErrors[row.recipientId]) / 25))}>{t("Исправить строки", "Жолдарды түзету")} · {rows.filter(row => rowErrors[row.recipientId]).length}</button></p>}
    {chosen.some(row => row.state === "INVITED") && <p>{t("Для выбранных слушателей прежние ссылки будут заменены.", "Таңдалған тыңдаушылардың бұрынғы сілтемелері ауыстырылады.")}</p>}
    {!!Object.keys(prepared).length && <p role="status">{t("Ссылки подготовлены. Передайте каждую её слушателю; автоматической отправки нет.", "Сілтемелер дайын. Әр сілтемені тиісті тыңдаушыға беріңіз; автоматты жіберу жоқ.")}</p>}
    {Object.keys(prepared).length > 1 && <button type="button" onClick={() => void copy(rows.filter(row => prepared[row.recipientId]).map(row => `${t(row.nameRu, row.nameKz || row.nameRu)} · ${emails[row.recipientId] || row.email}\n${prepared[row.recipientId].url}`).join("\n\n"))}>{t("Скопировать подготовленные приглашения", "Дайын шақыруларды көшіру")}</button>}
    {copied && <p role="status">{t("Скопировано", "Көшірілді")}</p>}
    {ids.length > 25 && <div className="lms-pagination"><button type="button" disabled={busy || loading || actualPage === 0} onClick={() => setPage(actualPage - 1)}>{t("Назад", "Артқа")}</button><span>{actualPage + 1} / {Math.ceil(ids.length / 25)}</span><button type="button" disabled={busy || loading || (actualPage + 1) * 25 >= ids.length} onClick={() => setPage(actualPage + 1)}>{t("Далее", "Келесі")}</button></div>}
  </section>;
}
