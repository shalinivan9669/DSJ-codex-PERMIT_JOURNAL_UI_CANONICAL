"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { Notice } from "@demo/ui";
import { api, ApiError, json } from "@/lib/api";
import type { Course } from "@/lib/lms-api";
import { applicationError } from "./application-errors";
import type { Translate } from "./common";

type Person = { id: string; data: { fullNameRu: string; positionRu?: string; phone?: string; email?: string } };
function operatorError(error: unknown, t: Translate) {
  const code = error instanceof ApiError ? (error.details as { code?: string })?.code : undefined;
  const messages: Record<string, [string, string]> = {
    APPLICATION_PERSON_EXISTS: ["Человек с этим ИИН уже есть. Найдите и выберите его по ФИО.", "Осы ЖСН бар адам тіркелген. Оны аты-жөні бойынша тауып таңдаңыз."],
    APPLICATION_PERSON_REQUIRED: ["Выберите человека или подтвердите создание новой карточки.", "Адамды таңдаңыз немесе жаңа карточка құруды растаңыз."],
    APPLICATION_PERSONAL_INVALID: ["Личная заявка оформляется на одного человека без организации.", "Жеке өтінім ұйымсыз бір адамға рәсімделеді."],
    APPLICATION_CONTACT_REQUIRED: ["Укажите контактное лицо и телефон или почту.", "Байланыс тұлғасын және телефон немесе поштаны көрсетіңіз."],
  };
  return code && messages[code] ? t(...messages[code]) : applicationError(error, t);
}
export function OperatorApplication({ t, scope, onCreated, onClose }: {
  t: Translate; scope: string; onCreated: (id: string) => void; onClose: () => void;
}) {
  const [courses, setCourses] = useState<Course[]>([]);
  const [kind, setKind] = useState<"B2B" | "B2C">("B2B");
  const [versionId, setVersionId] = useState("");
  const [search, setSearch] = useState("");
  const [organizations, setOrganizations] = useState<{ id: string; nameRu: string; bin: string }[]>([]);
  const [people, setPeople] = useState<Person[]>([]);
  const [customerId, setCustomerId] = useState("");
  const [recipientId, setRecipientId] = useState("");
  const [createNew, setCreateNew] = useState(false);
  const [fields, setFields] = useState({ organization: "", bin: "", contactName: "", phone: "", email: "", position: "", iin: "", quantity: 1, comment: "" });
  const [busy, setBusy] = useState(false), [error, setError] = useState<unknown>(null);
  const [ready, setReady] = useState(false);
  const errorRef = useRef<HTMLDivElement>(null);
  useEffect(() => { if (error) errorRef.current?.focus(); }, [error]);
  const operation = useRef<{ fingerprint: string; key: string } | null>(null);
  const storageKey = `demo:lms:operator-application:${scope}`;
  useEffect(() => {
    let alive = true;
    void api<{ items: Course[] }>("/lms/courses?pageSize=250&status=PUBLISHED").then((value) => {
      if (alive) setCourses(value.items);
    }).catch((caught) => { if (alive) setError(caught); });
    try {
      const saved = JSON.parse(sessionStorage.getItem(storageKey) || "null");
      if (saved) {
        setKind(saved.kind); setVersionId(saved.versionId); setCustomerId(saved.customerId);
        setRecipientId(saved.recipientId); setCreateNew(saved.createNew); setFields(saved.fields);
        operation.current = saved.operation || null;
      } else setVersionId(new URLSearchParams(window.location.search).get("versionId") || new URLSearchParams(window.location.search).get("courseVersionId") || "");
    } catch { /* Recovery is optional; the server owns saved applications. */ }
    setReady(true);
    return () => { alive = false; };
  }, [storageKey]);
  useEffect(() => {
    if (!ready) return;
    try { sessionStorage.setItem(storageKey, JSON.stringify({ kind, versionId, customerId, recipientId, createNew, fields, operation: operation.current })); }
    catch { /* Input remains in the current form. */ }
  }, [ready, storageKey, kind, versionId, customerId, recipientId, createNew, fields]);
  useEffect(() => {
    let alive = true;
    const timer = setTimeout(() => {
      if (kind === "B2B") void api<{ items: typeof organizations }>(`/customers?search=${encodeURIComponent(search)}`)
        .then((value) => { if (alive) setOrganizations(value.items); }).catch((caught) => { if (alive) setError(caught); });
      else void api<{ items: Person[] }>(`/recipients?search=${encodeURIComponent(search)}`)
        .then((value) => { if (alive) setPeople(value.items); }).catch((caught) => { if (alive) setError(caught); });
    }, 180);
    return () => { alive = false; clearTimeout(timer); };
  }, [kind, search]);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true); setError(null);
    const payload = {
      ...fields, kind, courseVersionId: versionId,
      quantity: kind === "B2C" ? 1 : fields.quantity,
      ...(kind === "B2B" && customerId && !createNew ? { customerId } : {}),
      ...(kind === "B2C" && recipientId && !createNew ? { recipientId } : {}),
      createOrganization: kind === "B2B" && createNew,
      createRecipient: kind === "B2C" && createNew,
    };
    const fingerprint = JSON.stringify(payload);
    if (operation.current?.fingerprint !== fingerprint) operation.current = { fingerprint, key: crypto.randomUUID() };
    try {
      sessionStorage.setItem(storageKey, JSON.stringify({ kind, versionId, customerId, recipientId, createNew, fields, operation: operation.current }));
    } catch { /* Retain the key in memory if local storage is unavailable. */ }
    try {
      const saved = await api<{ id: string }>("/lms/applications/operator", { method: "POST", body: json({ ...payload, idempotencyKey: operation.current.key }) });
      try { sessionStorage.removeItem(storageKey); } catch { /* Saved record remains available in the queue. */ }
      onCreated(saved.id);
    } catch (caught) { setError(caught); errorRef.current?.focus(); }
    finally { setBusy(false); }
  }
  const published = courses.flatMap((course) => {
    const version = course.publishedVersion || (course.latestVersion?.status === "PUBLISHED" ? course.latestVersion : null);
    return version && !course.assignmentPaused ? [{ ...course, version }] : [];
  });
  return <section className="panel lms-panel">
    <h2>{t("Новая заявка на обучение", "Оқуға жаңа өтінім")}</h2>
    <form onSubmit={(event) => void submit(event)}>
      {!!error && <div ref={errorRef} tabIndex={-1}><Notice>{operatorError(error, t)}</Notice></div>}
      <div className="lms-toolbar">
        <label>{t("Заказчик", "Тапсырыс беруші")}<select value={kind} disabled={busy} onChange={(event) => { setKind(event.target.value as "B2B" | "B2C"); setCreateNew(false); setSearch(""); }}>
          <option value="B2B">{t("Организация", "Ұйым")}</option><option value="B2C">{t("Физическое лицо", "Жеке тұлға")}</option>
        </select></label>
        <label>{t("Программа", "Бағдарлама")}<select required value={versionId} disabled={busy} onChange={(event) => setVersionId(event.target.value)}>
          <option value="">{t("Выберите опубликованную программу", "Жарияланған бағдарламаны таңдаңыз")}</option>
          {published.map((course) => <option key={course.version.id} value={course.version.id}>{t(course.version.content.titleRu, course.version.content.titleKz)} · {course.version.version}</option>)}
        </select></label>
      </div>
      {!published.length && <p>{t("Для назначения методист или директор должен опубликовать программу.", "Тағайындау үшін әдіскер немесе директор бағдарламаны жариялауы керек.")} <Link href="/lms">{t("Открыть программы", "Бағдарламаларды ашу")}</Link></p>}
      <label>{kind === "B2B" ? t("Найти организацию по названию или БИН", "Ұйымды атауы немесе БСН бойынша табу") : t("Найти человека по ФИО", "Адамды аты-жөні бойынша табу")}
        <input type="search" value={search} onChange={(event) => setSearch(event.target.value)} disabled={busy} />
      </label>
      <label>{t("Существующая запись", "Бар жазба")}<select disabled={busy || createNew} value={kind === "B2B" ? customerId : recipientId} onChange={(event) => {
        if (kind === "B2B") setCustomerId(event.target.value); else setRecipientId(event.target.value);
      }}><option value="">{t("Выберите запись", "Жазбаны таңдаңыз")}</option>
        {kind === "B2B" ? organizations.map((row) => <option key={row.id} value={row.id}>{row.nameRu} · {row.bin}</option>) : people.map((row) => <option key={row.id} value={row.id}>{row.data.fullNameRu} · {row.data.positionRu || row.data.email || row.data.phone || ""}</option>)}
      </select></label>
      <label className="lms-inline-label"><input type="checkbox" checked={createNew} disabled={busy} onChange={(event) => setCreateNew(event.target.checked)} />{kind === "B2B" ? t("Создать новую организацию", "Жаңа ұйым құру") : t("Создать карточку нового человека", "Жаңа адамның карточкасын құру")}</label>
      <div className="lms-toolbar">
        {kind === "B2B" && createNew && <><label>{t("Название организации", "Ұйым атауы")}<input required maxLength={300} value={fields.organization} onChange={(e) => setFields((v) => ({ ...v, organization: e.target.value }))} /></label><label>{t("БИН · 12 цифр", "БСН · 12 сан")}<input required inputMode="numeric" pattern="[0-9]{12}" maxLength={12} value={fields.bin} onChange={(e) => setFields((v) => ({ ...v, bin: e.target.value }))} /></label></>}
        {(kind === "B2B" || createNew) && <>
          <label>{kind === "B2B" ? t("Контактное лицо", "Байланыс тұлғасы") : t("ФИО", "Аты-жөні")}<input required maxLength={300} value={fields.contactName} onChange={(e) => setFields((v) => ({ ...v, contactName: e.target.value }))} /></label>
          <label>{t("Телефон", "Телефон")}<input type="tel" maxLength={40} value={fields.phone} onChange={(e) => setFields((v) => ({ ...v, phone: e.target.value }))} /></label>
          <label>E-mail<input type="email" maxLength={255} value={fields.email} onChange={(e) => setFields((v) => ({ ...v, email: e.target.value }))} /></label>
          <label>{t("Должность · необязательно", "Лауазым · міндетті емес")}<input maxLength={200} value={fields.position} onChange={(e) => setFields((v) => ({ ...v, position: e.target.value }))} /></label>
        </>}
        {kind === "B2C" && createNew && <label>{t("ИИН · если известен", "ЖСН · белгілі болса")}<input inputMode="numeric" pattern="[0-9]{12}" maxLength={12} value={fields.iin} onChange={(e) => setFields((v) => ({ ...v, iin: e.target.value }))} /></label>}
        {kind === "B2B" && <label>{t("Количество слушателей", "Тыңдаушылар саны")}<input type="number" min={1} max={10000} required value={fields.quantity} onChange={(e) => setFields((v) => ({ ...v, quantity: Number(e.target.value) }))} /></label>}
      </div>
      <details><summary>{t("Комментарий", "Түсініктеме")}</summary><label>{t("Уточнение к заявке", "Өтінімге түсініктеме")}<textarea maxLength={2000} value={fields.comment} onChange={(e) => setFields((v) => ({ ...v, comment: e.target.value }))} /></label></details>
      <div className="lms-toolbar"><button className="primary lms-primary" disabled={busy || !versionId || (!createNew && !(kind === "B2B" ? customerId : recipientId))}>{busy ? t("Сохраняем…", "Сақталуда…") : t("Создать заявку", "Өтінім құру")}</button><button type="button" disabled={busy} onClick={onClose}>{t("Вернуться к заявкам", "Өтінімдерге оралу")}</button></div>
    </form>
  </section>;
}
