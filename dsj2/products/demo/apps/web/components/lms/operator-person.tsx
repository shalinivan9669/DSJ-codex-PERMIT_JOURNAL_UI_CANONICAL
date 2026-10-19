"use client";
import { useRef, useState, type FormEvent } from "react";
import { api, ApiError, json } from "@/lib/api";
import { lmsError, type Translate } from "./common";

export function OperatorPerson({ t, customerId, onCreated }: { t: Translate; customerId?: string; onCreated: (id: string) => void }) {
  const [fields, setFields] = useState({ fullNameRu: "", positionRu: "", iin: "", email: "", phone: "" });
  const [busy, setBusy] = useState(false), [error, setError] = useState<unknown>(null), [distinct, setDistinct] = useState(false);
  const operation = useRef<{ fingerprint: string; key: string } | null>(null);
  const code = error instanceof ApiError ? (error.details as { code?: string })?.code : "";
  async function add(event: FormEvent) {
    event.preventDefault(); if (busy) return;
    setBusy(true); setError(null);
    const body = { ...fields, customerId, confirmDistinctPerson: distinct }, fingerprint = JSON.stringify(body);
    if (operation.current?.fingerprint !== fingerprint) operation.current = { fingerprint, key: crypto.randomUUID() };
    try {
      const person = await api<{ id: string }>("/lms/operator/recipients", { method: "POST", body: json({ ...body, idempotencyKey: operation.current.key }) });
      onCreated(person.id); setFields({ fullNameRu: "", positionRu: "", iin: "", email: "", phone: "" }); setDistinct(false); operation.current = null;
    } catch (caught) { setError(caught); } finally { setBusy(false); }
  }
  return <form onSubmit={(event) => void add(event)} className="lms-panel">
    <div className="lms-toolbar">
      <label>{t("ФИО нового человека", "Жаңа адамның аты-жөні")}<input required value={fields.fullNameRu} maxLength={300} onChange={(event) => setFields((old) => ({ ...old, fullNameRu: event.target.value }))} /></label>
      <label>{t("Должность", "Лауазым")}<input value={fields.positionRu} maxLength={200} onChange={(event) => setFields((old) => ({ ...old, positionRu: event.target.value }))} /></label>
      <label>E-mail<input type="email" value={fields.email} maxLength={255} onChange={(event) => setFields((old) => ({ ...old, email: event.target.value }))} /></label>
    </div>
    <details><summary>{t("ИИН и телефон · если известны", "ЖСН және телефон · белгілі болса")}</summary><div className="lms-toolbar">
      <label>{t("ИИН", "ЖСН")}<input inputMode="numeric" pattern="[0-9]{12}" maxLength={12} value={fields.iin} onChange={(event) => setFields((old) => ({ ...old, iin: event.target.value }))} /></label>
      <label>{t("Телефон", "Телефон")}<input type="tel" maxLength={40} value={fields.phone} onChange={(event) => setFields((old) => ({ ...old, phone: event.target.value }))} /></label>
    </div></details>
    {!!error && <p role="alert">{code === "PERSON_MATCH_REVIEW" ? t("Такое ФИО или контакт уже есть. Найдите человека в списке или подтвердите отдельную новую карточку.", "Осы аты-жөні немесе байланыс бар. Адамды тізімнен табыңыз немесе бөлек жаңа карточканы растаңыз.") : code === "PERSON_ALREADY_EXISTS" ? t("Человек с этим ИИН уже есть. Выберите его из списка.", "Осы ЖСН бар адам тіркелген. Оны тізімнен таңдаңыз.") : lmsError(error, t)}</p>}
    {(code === "PERSON_MATCH_REVIEW" || distinct) && <label className="lms-inline-label"><input type="checkbox" checked={distinct} onChange={(event) => setDistinct(event.target.checked)} />{t("Это другой человек, создать отдельную карточку", "Бұл басқа адам, бөлек карточка құру")}</label>}
    <button disabled={busy || !fields.fullNameRu.trim()}>{busy ? t("Сохраняем…", "Сақталуда…") : t("Добавить в выбранный состав", "Таңдалған құрамға қосу")}</button>
  </form>;
}
