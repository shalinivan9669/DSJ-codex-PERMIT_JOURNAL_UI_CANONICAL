"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { api, errorText, json, setCsrf } from "@/lib/api";
type Details = {
  existingAccount: boolean;
  expiresAt: string;
  accessExpiresAt: string;
};
export function EmployerInviteAccept() {
  const token = useRef("");
  const started = useRef(false);
  const errorRef = useRef<HTMLDivElement>(null);
  const [details, setDetails] = useState<Details | null>(null);
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    token.current = window.location.hash.slice(1);
    // The fragment never reaches HTTP logs; remove it before the first API call.
    window.history.replaceState(null, "", "/invite");
    if (!/^[a-f0-9]{64}$/.test(token.current)) {
      setError(
        "В ссылке отсутствует действующее приглашение. Откройте полную ссылку, полученную от учебного центра.",
      );
      setBusy(false);
      return;
    }
    void api<Details>("/auth/employer-invite/inspect", {
      method: "POST",
      body: json({ token: token.current }),
    })
      .then(setDetails)
      .catch((e) => setError(errorText(e)))
      .finally(() => setBusy(false));
  }, []);
  useEffect(() => {
    if (error) errorRef.current?.focus();
  }, [error]);
  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    if (!details?.existingAccount && password !== confirmation) {
      setError("Пароли не совпадают. Повторите новый пароль.");
      return;
    }
    setBusy(true);
    try {
      const result = await api<{ csrfToken: string }>(
        "/auth/employer-invite/exchange",
        { method: "POST", body: json({ token: token.current, password }) },
      );
      token.current = "";
      setPassword("");
      setConfirmation("");
      setCsrf(result.csrfToken);
      window.location.replace("/portal");
    } catch (e) {
      setError(errorText(e));
      setBusy(false);
    }
  }
  return (
    <main className="initial-state">
      <section
        className="login-card"
        style={{ width: "min(100%, 440px)", boxSizing: "border-box" }}
      >
        <h1>Приглашение представителя</h1>
        <p>
          Доступ к заказам и сотрудникам вашей организации в пределах прав,
          назначенных учебным центром.
        </p>
        {error && (
          <div
            role="alert"
            aria-label="Ошибка приглашения"
            tabIndex={-1}
            ref={errorRef}
            className="notice"
          >
            {error}
          </div>
        )}
        {busy && !details && <p role="status">Проверяем приглашение…</p>}
        {details && (
          <form onSubmit={(e) => void submit(e)}>
            <p>
              {details.existingAccount
                ? "Подтвердите текущий пароль вашей учётной записи. Приглашение не меняет пароль."
                : "Задайте свой пароль для последующих входов. Не менее 12 символов; вставка и менеджер паролей доступны."}
            </p>
            <p>
              Доступ до{" "}
              {new Date(details.accessExpiresAt).toLocaleString("ru-RU")}.
              Приглашение действует до{" "}
              {new Date(details.expiresAt).toLocaleString("ru-RU")}.
            </p>
            <label>
              {details.existingAccount ? "Текущий пароль" : "Новый пароль"}
              <input
                type="password"
                autoComplete={
                  details.existingAccount ? "current-password" : "new-password"
                }
                minLength={12}
                maxLength={256}
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </label>
            {!details.existingAccount && (
              <label>
                Повторите новый пароль
                <input
                  type="password"
                  autoComplete="new-password"
                  minLength={12}
                  maxLength={256}
                  required
                  value={confirmation}
                  onChange={(e) => setConfirmation(e.target.value)}
                />
              </label>
            )}
            <button className="primary" type="submit" disabled={busy}>
              {busy ? "Открываем доступ…" : "Принять приглашение"}
            </button>
          </form>
        )}
        <p>
          Ссылка одноразовая. После принятия входите по своему адресу и паролю.
        </p>
        <Link href="/login">Перейти ко входу</Link>
      </section>
    </main>
  );
}
