"use client";
import { useEffect, useRef, useState } from "react";
import { api, json } from "@/lib/api";
import { lmsError, type Translate } from "./common";
import { CustomerDialog } from "../customers";
import type { Customer } from "@/lib/types";
type Organization = { id: string; nameRu: string; nameKz?: string | null; bin?: string; archived?: boolean };
export function OperatorOrganization({ value, onChange, t, disabled = false }: {
  value: string; onChange: (value: Organization | null) => void; t: Translate; disabled?: boolean;
}) {
  const [search, setSearch] = useState(""), [items, setItems] = useState<Organization[]>([]), [selected, setSelected] = useState<Organization | null>(null);
  const [creating, setCreating] = useState(false), [name, setName] = useState(""), [nameKz, setNameKz] = useState(""), [bin, setBin] = useState("");
  const [editing, setEditing] = useState<Customer | null>(null);
  const [loading, setLoading] = useState(true), [refresh, setRefresh] = useState(0);
  const [busy, setBusy] = useState(false), [error, setError] = useState<unknown>(null), [existing, setExisting] = useState<Organization[]>([]);
  const operation = useRef<{ fingerprint: string; key: string } | null>(null);
  const disabledRef = useRef(disabled);
  disabledRef.current = disabled;
  useEffect(() => {
    let alive = true;
    if (value) void api<Organization>(`/customers/${value}`).then((row) => { if (alive) setSelected(row); }).catch((caught) => { if (alive) setError(caught); });
    else setSelected(null);
    return () => { alive = false; };
  }, [value, refresh]);
  useEffect(() => {
    let alive = true;
    setLoading(true); setError(null);
    const timer = setTimeout(() => void api<{ items: Organization[] }>(`/customers?search=${encodeURIComponent(search)}`).then((result) => { if (alive) setItems(result.items.filter((row) => !row.archived)); }).catch((caught) => { if (alive) { setError(caught); setItems([]); } }).finally(() => { if (alive) setLoading(false); }), 180);
    return () => { alive = false; clearTimeout(timer); };
  }, [search, refresh]);
  function choose(row: Organization | null) {
    if (disabledRef.current || row?.archived) return false;
    setSelected(row); onChange(row); setCreating(false); setExisting([]);
    return true;
  }
  async function editOrganization(row: Organization) {
    if (busy || disabledRef.current) return;
    setBusy(true); setError(null);
    try { const customer = await api<Customer>(`/customers/${row.id}`); if (!disabledRef.current) setEditing(customer); }
    catch (caught) { setError(caught); }
    finally { setBusy(false); }
  }
  async function create() {
    if (busy || disabledRef.current || !name.trim()) return;
    setBusy(true); setError(null); setExisting([]);
    const body = { nameRu: name.trim(), nameKz: nameKz.trim(), bin: bin.trim() }, fingerprint = JSON.stringify(body);
    if (operation.current?.fingerprint !== fingerprint) operation.current = { fingerprint, key: crypto.randomUUID() };
    try {
      if (body.bin) {
        const matches = await api<{ items: Organization[] }>(`/customers?search=${encodeURIComponent(body.bin)}`);
        const exact = matches.items.filter((row) => row.bin === body.bin);
        if (exact.length) { setExisting(exact); return; }
      }
      if (disabledRef.current) return;
      const result = await api<Organization>("/customers", { method: "POST", headers: { "idempotency-key": operation.current.key }, body: json(body) });
      if (choose(result)) { setName(""); setNameKz(""); setBin(""); operation.current = null; }
    } catch (caught) { setError(caught); } finally { setBusy(false); }
  }
  return <div>
    {selected && !creating ? <><div className="lms-toolbar"><strong>{t(selected.nameRu, selected.nameKz || selected.nameRu)}</strong>{!disabled && <><button type="button" disabled={busy} onClick={() => choose(null)}>{t("Изменить организацию", "Ұйымды өзгерту")}</button><button type="button" disabled={busy} onClick={() => void editOrganization(selected)}>{selected.archived ? t("Открыть реквизиты", "Деректемелерді ашу") : t("Дополнить реквизиты", "Деректемелерді толықтыру")}</button></>}</div>{selected.archived && <p className="lms-error" role="alert">{t("Организация в архиве: новые назначения недоступны. Выберите другую организацию или откройте реквизиты и снимите отметку «Перенести в архив».", "Ұйым мұрағатта: жаңа тағайындаулар қолжетімсіз. Басқа ұйымды таңдаңыз немесе деректемелерді ашып, «Мұрағатқа көшіру» белгісін алып тастаңыз.")}</p>}</> : !creating ? <div className="lms-toolbar">
      <label>{t("Организация · поиск по названию или БИН", "Ұйым · атауы немесе БСН бойынша іздеу")}<input type="search" disabled={disabled} value={search} onChange={(event) => setSearch(event.target.value)} /></label>
      <label>{t("Выбрать организацию", "Ұйымды таңдау")}<select value={value} disabled={disabled || loading} onChange={(event) => choose(items.find((item) => item.id === event.target.value) || null)}><option value="">{t("Без организации / выберите ниже", "Ұйымсыз / төменнен таңдаңыз")}</option>{items.map((row) => <option key={row.id} value={row.id}>{t(row.nameRu, row.nameKz || row.nameRu)}{row.bin ? ` · ${row.bin}` : ""}</option>)}</select></label>
      {loading && <span role="status">{t("Загружаем организации…", "Ұйымдар жүктелуде…")}</span>}
      {!loading && !error && !items.length && <span role="status">{t("Доступных организаций не найдено. Измените поиск или создайте организацию. Архивные записи выбрать нельзя.", "Қолжетімді ұйымдар табылмады. Іздеуді өзгертіңіз немесе ұйым құрыңыз. Мұрағаттағы жазбаларды таңдау мүмкін емес.")}</span>}
      <button type="button" disabled={disabled} onClick={() => { setCreating(true); setName(search); }}>{t("Новая организация", "Жаңа ұйым")}</button>
    </div> : <div className="lms-toolbar">
      <label>{t("Название на русском", "Орыс тіліндегі атауы")}<input maxLength={300} value={name} onChange={(event) => setName(event.target.value)} disabled={busy || disabled} /></label>
      <label>{t("Название на казахском", "Қазақ тіліндегі атауы")}<input maxLength={300} value={nameKz} onChange={(event) => setNameKz(event.target.value)} disabled={busy || disabled} /></label>
      <label>{t("БИН · если известен", "БСН · белгілі болса")}<input maxLength={12} inputMode="numeric" value={bin} onChange={(event) => setBin(event.target.value)} disabled={busy || disabled} /></label>
      <button type="button" onClick={() => void create()} disabled={busy || disabled || !name.trim() || (!!bin && !/^\d{12}$/.test(bin))}>{t("Создать и выбрать", "Құру және таңдау")}</button>
      <button type="button" disabled={busy || disabled} onClick={() => setCreating(false)}>{t("К поиску", "Іздеуге")}</button>
    </div>}
    {!!existing.length && <div role="alert"><p>{t("Организация с этим БИН уже есть. Выберите действующую запись; для архивной сначала откройте реквизиты и снимите отметку «Перенести в архив».", "Бұл БСН бар ұйым тіркелген. Белсенді жазбаны таңдаңыз; мұрағаттағы ұйым үшін алдымен деректемелерді ашып, «Мұрағатқа көшіру» белгісін алып тастаңыз.")}</p>{existing.map((row) => <div key={row.id}><strong>{t(row.nameRu, row.nameKz || row.nameRu)}</strong>{row.archived ? <> · {t("В архиве", "Мұрағатта")} <button type="button" disabled={busy || disabled} onClick={() => void editOrganization(row)}>{t("Открыть реквизиты", "Деректемелерді ашу")}</button></> : <button type="button" disabled={busy || disabled} onClick={() => choose(row)}>{t("Выбрать организацию", "Ұйымды таңдау")}</button>}</div>)}</div>}
    {!!error && <p role="alert">{lmsError(error, t)} <button type="button" disabled={loading || busy} onClick={() => setRefresh(value => value + 1)}>{t("Повторить загрузку", "Қайта жүктеу")}</button></p>}
    {editing && <CustomerDialog customer={editing} onClose={() => setEditing(null)} onSaved={(row) => { setEditing(null); if (row.archived) { setSelected((current) => current?.id === row.id ? row : current); setExisting((current) => current.map((item) => item.id === row.id ? row : item)); } else choose(row); setRefresh((current) => current + 1); }} />}
  </div>;
}
