"use client";
import { useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { Notice } from "@demo/ui";
import { api, ApiError, json } from "@/lib/api";
import { cabinetError, useCabinetText } from "./cabinet-language";
import { cabinetKz } from "./cabinet-translations";
import type { Translate } from "./lms/common";
import "./cabinet-responsive.css";

export function OwnPasswordForm({ t }: { t?: Translate }) {
  const cabinetText = useCabinetText();
  const tr = t ? (value: string) => t(value, cabinetKz[value] || value) : cabinetText;
  const currentInput = useRef<HTMLInputElement>(null);
  const repeatInput = useRef<HTMLInputElement>(null);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [repeat, setRepeat] = useState("");
  const [error, setError] = useState<unknown>(null);
  const [mismatch, setMismatch] = useState(false);
  const [changed, setChanged] = useState(false);
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy || changed) return;
    setError(null);
    setMismatch(repeat !== newPassword);
    if (repeat !== newPassword) { repeatInput.current?.focus(); return; }
    setBusy(true);
    try {
      await api("/auth/password", { method: "POST", body: json({ currentPassword, newPassword }) });
      setCurrentPassword(""); setNewPassword(""); setRepeat("");
      setChanged(true);
    } catch (caught) {
      setError(caught);
      if (caught instanceof ApiError && (caught.details as { code?: string })?.code === "PASSWORD_INVALID") {
        currentInput.current?.focus();
      }
    } finally { setBusy(false); }
  }
  return <form className="narrow-form own-password-form" onSubmit={submit} aria-busy={busy}>
    <h2>{tr("Смена пароля")}</h2>
    {!!error && <Notice>{cabinetError(error, tr)}</Notice>}
    {changed ? <>
      <Notice kind="success">{tr("Пароль изменён. Войдите заново с новым паролем.")}</Notice>
      <Link className="button primary" href="/login">{t ? t("Войти", "Кіру") : tr("Войти")}</Link>
    </> : <>
      <label>{tr("Текущий пароль")}<input ref={currentInput} type="password" required maxLength={256} autoComplete="current-password" disabled={busy} value={currentPassword} onChange={event => setCurrentPassword(event.target.value)} /></label>
      <label>{tr("Новый пароль")}<input type="password" required minLength={12} maxLength={256} autoComplete="new-password" disabled={busy} value={newPassword} onChange={event => { setNewPassword(event.target.value); setMismatch(false); }} /></label>
      <label>{tr("Повторите новый пароль")}<input ref={repeatInput} type="password" required minLength={12} maxLength={256} autoComplete="new-password" disabled={busy} aria-invalid={mismatch || undefined} aria-describedby={mismatch ? "password-mismatch" : undefined} value={repeat} onChange={event => { setRepeat(event.target.value); setMismatch(false); }} /></label>
      {mismatch && <p id="password-mismatch" role="alert" className="field-error">{tr("Новые пароли не совпадают.")}</p>}
      <button className="primary" disabled={busy}>{tr(busy ? "Сохраняем…" : "Изменить пароль")}</button>
    </>}
  </form>;
}
