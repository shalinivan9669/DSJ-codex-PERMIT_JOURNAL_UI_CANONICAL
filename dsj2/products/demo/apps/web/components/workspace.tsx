"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Icon, Notice } from "@demo/ui";
import {
  api,
  ApiError,
  errorText,
  json,
  setCsrf,
  SESSION_EXPIRED_EVENT,
  BEFORE_LOGOUT_EVENT,
} from "@/lib/api";
import type { AppContext } from "@/lib/types";
import { RequestList, NewRequest } from "./request-list";
import { Editor } from "./editor";
import { Customers } from "./customers";
import { Settings } from "./settings";
import { SessionDialog } from "./session-dialog";

export function Workspace() {
  const pathname = usePathname();
  const router = useRouter();
  const [context, setContext] = useState<AppContext | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [unauthorized, setUnauthorized] = useState(false);
  const [sessionExpired, setSessionExpired] = useState(false);
  const [sessionDialog, setSessionDialog] = useState(false);
  useEffect(() => {
    if (!context) return;
    const expired = () => {
      if (!sessionExpired) setSessionDialog(true);
      setSessionExpired(true);
    };
    window.addEventListener(SESSION_EXPIRED_EVENT, expired);
    return () => window.removeEventListener(SESSION_EXPIRED_EVENT, expired);
  }, [context, sessionExpired]);
  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const session = await api<{ csrfToken?: string }>("/auth/session");
      if (session.csrfToken) setCsrf(session.csrfToken);
      const result = await api<AppContext>("/context");
      if (result.csrfToken) setCsrf(result.csrfToken);
      setContext(result);
      setUnauthorized(false);
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 401)
        setUnauthorized(true);
      else setError(errorText(caught));
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    if (context && pathname === "/login") router.replace("/requests");
  }, [context, pathname, router]);
  async function logout() {
    try {
      const pending: Promise<unknown>[] = [];
      window.dispatchEvent(
        new CustomEvent(BEFORE_LOGOUT_EVENT, {
          detail: { waitUntil: (save: Promise<unknown>) => pending.push(save) },
        }),
      );
      await Promise.all(pending);
      await api("/auth/logout", { method: "POST", body: "{}" });
      setContext(null);
      setCsrf("");
      setUnauthorized(true);
      router.replace("/login");
    } catch (caught) {
      setError(errorText(caught));
    }
  }
  if (loading)
    return (
      <main className="initial-state" aria-busy="true">
        <Brand />
        <p>Открываем рабочее пространство…</p>
      </main>
    );
  if (unauthorized) return <Login onLogin={load} />;
  if (!context)
    return (
      <main className="initial-state">
        <Brand />
        <Notice>{error}</Notice>
        <button onClick={() => void load()}>Повторить подключение</button>
      </main>
    );
  const section = pathname.startsWith("/customers")
    ? "customers"
    : pathname.startsWith("/history")
      ? "history"
      : pathname.startsWith("/settings")
        ? "settings"
        : "requests";
  const requestMatch = /^\/requests\/([^/]+)(?:\/edit)?$/.exec(pathname);
  return (
    <>
      <a className="skip-link" href="#main">
        Перейти к содержимому
      </a>
      <header className="app-header">
        <Link
          href="/requests"
          className="brand-link"
          aria-label="DEMO — заявки"
        >
          <Brand />
        </Link>
        <nav aria-label="Основная навигация">
          {[
            ["requests", "Заявки"],
            ["customers", "Заказчики"],
            ["history", "История"],
            ["settings", "Настройки"],
          ].map(([path, label]) => (
            <Link
              key={path}
              href={`/${path}`}
              aria-current={section === path ? "page" : undefined}
            >
              {label}
            </Link>
          ))}
        </nav>
        <div className="session">
          <span>
            <strong>{context.user.displayName}</strong>
            <small>{context.tenant.name}</small>
          </span>
          <button className="text-button" onClick={() => void logout()}>
            Выйти
          </button>
        </div>
      </header>
      <main id="main" className="workspace">
        {error && <Notice>{error}</Notice>}
        {sessionExpired && (
          <Notice>
            Сессия завершена. Введённые данные остаются на странице. Войдите
            снова и повторите последнее действие.
            <button onClick={() => setSessionDialog(true)}>Войти снова</button>
          </Notice>
        )}
        {pathname === "/requests/new" ? (
          <NewRequest context={context} />
        ) : requestMatch ? (
          <Editor
            key={requestMatch[1]}
            id={requestMatch[1]}
            context={context}
          />
        ) : section === "customers" ? (
          <Customers context={context} />
        ) : section === "settings" ? (
          <Settings context={context} onContextChange={setContext} />
        ) : (
          <RequestList history={section === "history"} context={context} />
        )}
      </main>
      {sessionDialog && (
        <SessionDialog
          context={context}
          onClose={() => setSessionDialog(false)}
          onRestored={(restored) => {
            setContext(restored);
            setSessionExpired(false);
            setSessionDialog(false);
          }}
        />
      )}
      <footer className="site-footer">
        <span>DEMO · Подготовка и печать документов</span>
        <span>Часовой пояс центра: {context.tenant.timezone}</span>
      </footer>
    </>
  );
}
function Brand() {
  return (
    <span className="brand">
      <span className="brand-mark">
        <Icon name="print" size={24} />
      </span>
      <span>DEMO</span>
    </span>
  );
}
function Login({ onLogin }: { onLogin: () => Promise<void> }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const result = await api<{ csrfToken?: string }>("/auth/login", {
        method: "POST",
        body: json({ email, password }),
      });
      if (result.csrfToken) setCsrf(result.csrfToken);
      await onLogin();
    } catch (caught) {
      setError(errorText(caught));
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="login-page">
      <section className="login-intro">
        <Brand />
        <div>
          <h1>
            От заявки
            <br />к готовому документу.
          </h1>
          <p>
            Получатели, формы и файлы —<br />в одном рабочем пространстве.
          </p>
        </div>
        <div className="paper-illustration" aria-hidden="true">
          <div />
          <div />
          <div />
        </div>
        <small>Рабочее пространство учебного центра</small>
      </section>
      <section className="login-form">
        <form onSubmit={submit}>
          <h2>Войти в DEMO</h2>
          <p className="muted">Используйте учётную запись вашего центра.</p>
          {error && <Notice>{error}</Notice>}
          <label>
            Электронная почта
            <input
              type="email"
              autoComplete="username"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </label>
          <label>
            Пароль
            <input
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </label>
          <button className="primary" disabled={busy}>
            {busy ? "Входим…" : "Войти"}
          </button>
          <p className="fine-print">
            Нет доступа? Обратитесь к администратору вашего центра.
          </p>
        </form>
      </section>
    </main>
  );
}
