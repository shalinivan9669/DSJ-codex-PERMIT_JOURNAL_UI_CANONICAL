"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Notice } from "@demo/ui";
import { api, json } from "@/lib/api";
import { useCabinetLanguage } from "./cabinet-language";
import { lmsError, type Translate } from "./lms/common";
import { OperatorOrganization } from "./lms/operator-organization";

type AccessRequest = {
  id: string;
  organizationName: string;
  bin: string;
  comment: string;
  status: "PENDING" | "APPROVED" | "REJECTED";
  decisionNote?: string | null;
  createdAt: string;
  resolvedAt?: string | null;
  user?: { displayName: string; email: string };
  customer?: { id: string; nameRu: string; nameKz?: string } | null;
};

/** Requests do not grant access. A centre manager must verify and approve the organization. */
export function EmployerAccessRequests({ manager = false, t: suppliedText }: { manager?: boolean; t?: Translate }) {
  const cabinetText = useCabinetLanguage();
  const t = suppliedText || cabinetText;
  const [items, setItems] = useState<AccessRequest[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);
  const [refresh, setRefresh] = useState(0);
  const [organizationName, setOrganizationName] = useState("");
  const [bin, setBin] = useState("");
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(false);
  const [reviewing, setReviewing] = useState("");
  const request = useRef<{ fingerprint: string; requestKey: string } | null>(null);
  useEffect(() => {
    let current = true;
    setLoading(true);
    setError(null);
    void api<{ items: AccessRequest[] }>("/employer-access-requests").then(result => {
      if (current) setItems(result.items);
    }).catch(caught => {
      if (current) { setError(caught); setItems(null); }
    }).finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, [refresh, manager]);
  useEffect(() => {
    const update = () => { if (!document.hidden) setRefresh(value => value + 1); };
    window.addEventListener("focus", update);
    return () => window.removeEventListener("focus", update);
  }, []);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true); setError(null); setMessage(false);
    const data = { organizationName: organizationName.trim(), bin: bin.trim(), comment: comment.trim() };
    const fingerprint = JSON.stringify(data);
    if (request.current?.fingerprint !== fingerprint) request.current = { fingerprint, requestKey: crypto.randomUUID() };
    try {
      await api("/employer-access-requests", { method: "POST", body: json({ ...data, requestKey: request.current.requestKey }) });
      setMessage(true); setRefresh(value => value + 1); setComment(""); request.current = null;
    } catch (caught) { setError(caught); }
    finally { setBusy(false); }
  }

  const pending = items?.filter(item => item.status === "PENDING") || [];
  return <section className="outcome-entry" aria-busy={loading}>
    <h3>{manager ? t("Запросы представителей", "Өкілдердің сұраулары") : t("Доступ к организации", "Ұйымға рұқсат")}</h3>
    {!!error && <Notice><span role="alert">{lmsError(error, t)}</span> <button type="button" disabled={loading || busy} onClick={() => setRefresh(value => value + 1)}>{t("Повторить загрузку", "Қайта жүктеу")}</button></Notice>}
    {loading && <p role="status">{t("Загружаем запросы…", "Сұраулар жүктелуде…")}</p>}
    {message && <p role="status">{t("Запрос передан администратору центра. Решение появится здесь.", "Сұрау орталық әкімшісіне берілді. Шешім осы жерде көрсетіледі.")}</p>}
    {items && <>
      {manager && !pending.length && <p>{t("Новых запросов нет", "Жаңа сұраулар жоқ")}</p>}
      <ul className="lms-list">{items.map(item => <li key={item.id}>
        <div>
          <strong>{item.organizationName}</strong>
          <div className="lms-list-meta">{item.bin && `${t("БИН", "БСН")}: ${item.bin} · `}{new Date(item.createdAt).toLocaleDateString(t("ru-KZ", "kk-KZ"))}</div>
          {manager && item.user && <p>{item.user.displayName} · {item.user.email}</p>}
          <p>{item.status === "PENDING" ? t("Ожидает решения центра", "Орталық шешімі күтілуде") : item.status === "APPROVED" ? t("Доступ предоставлен", "Рұқсат берілді") : t("Запрос отклонён", "Сұрау қабылданбады")}</p>
          {item.comment && <p>{item.comment}</p>}
          {item.decisionNote && <p>{item.decisionNote}</p>}
          {manager && reviewing === item.id && <AccessDecision request={item} t={t} onDone={() => { setReviewing(""); setRefresh(value => value + 1); }} onClose={() => setReviewing("")} />}
        </div>
        {manager && item.status === "PENDING" && reviewing !== item.id && <button type="button" onClick={() => setReviewing(item.id)}>{t("Рассмотреть", "Қарастыру")}</button>}
        {!manager && item.status === "APPROVED" && <button type="button" onClick={() => window.location.reload()}>{t("Открыть кабинет организации", "Ұйым кабинетін ашу")}</button>}
      </li>)}</ul>
      {!manager && !pending.length && <form onSubmit={submit}>
        <p>{t("Укажите организацию, которую представляете. Центр проверит полномочия и откроет доступ.", "Өзіңіз өкілдік ететін ұйымды көрсетіңіз. Орталық өкілеттікті тексеріп, рұқсат береді.")}</p>
        <div className="form-grid">
          <label>{t("Название организации", "Ұйым атауы")}<input required maxLength={300} value={organizationName} disabled={busy} onChange={event => setOrganizationName(event.target.value)} /></label>
          <label>{t("БИН · если известен", "БСН · белгілі болса")}<input inputMode="numeric" pattern="[0-9]{12}" maxLength={12} value={bin} disabled={busy} onChange={event => setBin(event.target.value)} /></label>
        </div>
        <label>{t("Комментарий для учебного центра", "Оқу орталығына түсініктеме")}<textarea maxLength={2000} value={comment} disabled={busy} onChange={event => setComment(event.target.value)} /></label>
        <button type="submit" className="primary" disabled={busy || loading || !organizationName.trim()}>{busy ? t("Передаём…", "Жіберілуде…") : t("Запросить доступ", "Рұқсат сұрау")}</button>
      </form>}
    </>}
  </section>;
}

function AccessDecision({ request, t, onDone, onClose }: { request: AccessRequest; t: Translate; onDone: () => void; onClose: () => void }) {
  const [customerId, setCustomerId] = useState("");
  const [permissions, setPermissions] = useState(["READ"]);
  const [expiresAt, setExpiresAt] = useState("");
  const [note, setNote] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  async function decide(decision: "APPROVE" | "REJECT") {
    if (busy || (decision === "APPROVE" && (!customerId || !confirmed))) return;
    setBusy(true); setError(null);
    try {
      await api(`/employer-access-requests/${request.id}/resolve`, { method: "POST", body: json({ decision, note: note.trim(), ...(decision === "APPROVE" ? { customerId, permissions, ...(expiresAt ? { expiresAt: new Date(expiresAt).toISOString() } : {}) } : {}) }) });
      onDone();
    } catch (caught) { setError(caught); }
    finally { setBusy(false); }
  }
  return <section className="panel lms-panel" aria-labelledby={`decision-title-${request.id}`}>
    <h4 id={`decision-title-${request.id}`}>{t("Решение по запросу", "Сұрау бойынша шешім")}</h4>
    {!!error && <p role="alert">{lmsError(error, t)}</p>}
    <OperatorOrganization value={customerId} disabled={busy} t={t} onChange={value => { setCustomerId(value?.id || ""); setConfirmed(false); }} />
    <div className="toolbar-actions">{([
      ["READ", t("Просмотр", "Қарау")], ["DOWNLOAD", t("Скачивание файлов", "Файлдарды жүктеу")], ["ASSIGN_TRAINING", t("Назначение обучения", "Оқуды тағайындау")], ["PROPOSE", t("Предложения изменений", "Өзгерістер ұсыну")], ["APPROVE_DATA", t("Подтверждение списка", "Тізімді растау")],
    ] as [string, string][]).map(([permission, label]) => <label className="checkbox" key={permission}><input type="checkbox" checked={permissions.includes(permission)} disabled={busy || permission === "READ"} onChange={event => { setPermissions(previous => event.target.checked ? [...previous, permission] : previous.filter(value => value !== permission)); setConfirmed(false); }} />{label}</label>)}</div>
    <label>{t("Доступ до", "Рұқсат мерзімі")}<input type="datetime-local" value={expiresAt} disabled={busy} onChange={event => { setExpiresAt(event.target.value); setConfirmed(false); }} /></label>
    <label>{t("Комментарий к решению", "Шешімге түсініктеме")}<textarea required minLength={3} maxLength={2000} aria-describedby={`decision-note-${request.id}`} value={note} disabled={busy} onChange={event => setNote(event.target.value)} /></label>
    <p id={`decision-note-${request.id}`} className="muted">{t("Укажите основание решения: не менее 3 символов. Представитель увидит этот комментарий.", "Шешімнің негізін кемінде 3 таңбамен көрсетіңіз. Өкіл бұл түсініктемені көреді.")}</p>
    <label className="checkbox"><input type="checkbox" checked={confirmed} disabled={busy} onChange={event => setConfirmed(event.target.checked)} />{t("Полномочия представителя проверены. Предоставить указанные права к данным выбранной организации.", "Өкілдің өкілеттіктері тексерілді. Таңдалған ұйым деректеріне көрсетілген құқықтарды беру.")}</label>
    <div className="actions">
      <button type="button" className="primary" disabled={busy || !confirmed || !customerId || note.trim().length < 3 || !expiresAt || new Date(expiresAt).getTime() <= Date.now()} onClick={() => void decide("APPROVE")}>{busy ? t("Сохраняем…", "Сақталуда…") : t("Предоставить доступ", "Рұқсат беру")}</button>
      <button type="button" disabled={busy || note.trim().length < 3} onClick={() => void decide("REJECT")}>{t("Отклонить с причиной", "Себебін көрсетіп қабылдамау")}</button>
      <button type="button" disabled={busy} onClick={onClose}>{t("Отмена", "Бас тарту")}</button>
    </div>
  </section>;
}
