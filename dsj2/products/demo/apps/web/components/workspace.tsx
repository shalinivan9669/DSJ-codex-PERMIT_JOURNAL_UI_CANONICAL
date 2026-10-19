"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Icon, Notice } from "@demo/ui";
import { roleLabel, isLmsStaffRole } from "@demo/contracts";
import { workspaceStartPath } from "@/lib/user-roles";
import { safeLmsReturnTo } from "@/lib/lms-navigation";
import {
  api,
  ApiError,
  errorText,
  json,
  setCsrf,
  SESSION_EXPIRED_EVENT,
  BEFORE_LOGOUT_EVENT,
  NavigationBlockedError,
} from "@/lib/api";
import type { AppContext } from "@/lib/types";
import { RequestList, NewRequest } from "./request-list";
import { Editor } from "./editor";
import { Customers } from "./customers";
import { Settings } from "./settings";
import { Workbench } from "./workbench";
import { EmployerHome } from "./employer-home";
import { PublicVerification } from "./public-verification";
import { SessionDialog } from "./session-dialog";
import { Register } from "./register";
import { CenterOnboarding } from "./center-onboarding";
import { Approvals } from "./approvals";
import { LmsWorkspace } from "./lms/workspace";
import { LearnerIdentity } from "./lms/identity";
import { LanguageSwitch, lmsError, useLanguage } from "./lms/common";
import { PublicCatalogue } from "./lms/public-catalogue";
import { SecuritySettings } from "./security";
import { CabinetLanguageProvider } from "./cabinet-language";

export function Workspace() {
  const pathname = usePathname();
  const publicVerification = pathname === "/verify" || pathname.startsWith("/verify/");
  const router = useRouter();
  const [context, setContext] = useState<AppContext | null>(null);
  const { t: lmsText, language, setLanguage } = useLanguage(
    context ? `${context.tenant.id}:${context.user.id}` : "anonymous",
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [unauthorized, setUnauthorized] = useState(false);
  const [mfaSetupRequired, setMfaSetupRequired] = useState(false);
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
      setMfaSetupRequired(false);
    } catch (caught) {
      if (
        caught instanceof ApiError &&
        (caught.details as { code?: string })?.code === "MFA_SETUP_REQUIRED"
      ) {
        setMfaSetupRequired(true);
        setUnauthorized(false);
      } else if (caught instanceof ApiError && caught.status === 401)
        setUnauthorized(true);
      else setError(errorText(caught));
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    if (!publicVerification) void load();
  }, [load, publicVerification]);
  useEffect(() => {
    if (context && ["/", "/login", "/register"].includes(pathname))
      router.replace(
        safeLmsReturnTo(new URLSearchParams(window.location.search).get("returnTo")) || (sessionStorage.getItem("lms:course-choice")
          ? "/catalogue"
          : workspaceStartPath(context.user.role, pathname === "/register")),
      );
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
      if (!(caught instanceof NavigationBlockedError))
        setError(errorText(caught));
    }
  }
  if (publicVerification)
    return <PublicVerification token={pathname === "/verify" ? undefined : pathname.slice("/verify/".length)} />;
  if (pathname === "/catalogue")
    return <PublicCatalogue context={context || undefined} />;
  if (mfaSetupRequired || (pathname === "/security" && !unauthorized))
    return <SecuritySettings />;
  if (
    ["/learn/register", "/learn/invite", "/learn/recovery"].includes(pathname)
  )
    return <LearnerIdentity path={pathname} onAuthenticated={load} />;
  if (loading)
    return (
      <main className="initial-state" aria-busy="true">
        <Brand />
        <p>{lmsText("Открываем рабочее пространство…", "Жұмыс кеңістігін ашуда…")}</p>
      </main>
    );
  if (unauthorized)
    return pathname === "/register" ? (
      <Register onRegistered={load} />
    ) : (
      <Login onLogin={load} />
    );
  if (!context)
    return (
      <main className="initial-state">
        <Brand />
        <Notice>{error}</Notice>
        <button onClick={() => void load()}>{lmsText("Повторить подключение", "Қосылуды қайталау")}</button>
      </main>
    );
  const section =
    pathname.startsWith("/lms") || pathname.startsWith("/learn")
      ? "lms"
      : pathname.startsWith("/approvals")
        ? "approvals"
        : pathname.startsWith("/workbench")
          ? "workbench"
          : pathname.startsWith("/customers")
            ? "customers"
            : pathname.startsWith("/history")
              ? "history"
              : pathname.startsWith("/settings")
                ? "settings"
                : "requests";
  const requestMatch = /^\/requests\/([^/]+)(?:\/edit)?$/.exec(pathname);
  const teachingRole = ["TEACHER", "METHODIST", "EXPERT"].includes(
    context.user.role,
  );
  const canTeach =
    !!context.user.canTeach ||
    teachingRole ||
    ["ADMIN", "SUPER_ADMIN", "DIRECTOR"].includes(context.user.role);
  const canLearn = !!context.user.canLearn || context.user.role === "LEARNER";
  const tr = lmsText;
  const role = context.user.role;
  const learningRoles = new Set(context.user.learningRoles || []);
  const teachingNav: string[][] = [
    ...(role === "METHODIST" || learningRoles.has("METHODIST")
      ? [["lms", tr("Программы", "Бағдарламалар")]] : []),
    ...(role === "TEACHER" || learningRoles.has("TEACHER")
      ? [["lms/teaching", tr("Кабинет преподавателя", "Оқытушы кабинеті")]] : []),
    ...(role === "EXPERT" || learningRoles.has("EXPERT")
      ? [["lms/teaching", tr("Кабинет комиссии", "Комиссия кабинеті")]] : []),
  ].filter((item, index, rows) => rows.findIndex((row) => row[0] === item[0]) === index);
  const mainNav: string[][] = role === "LEARNER" || teachingRole
    ? [...(canLearn ? [["learn", tr("Моё обучение", "Менің оқуым")]] : []), ...teachingNav]
    : role === "EMPLOYER"
      ? [["portal", tr("Кабинет организации", "Ұйым кабинеті")], ["lms/workplace", tr("Обучение сотрудников", "Қызметкерлерді оқыту")]]
      : role === "ADMIN" || role === "SUPER_ADMIN"
        ? [["lms/workplace", tr("Управление обучением", "Оқытуды басқару")],
          ["requests", tr("Документы", "Құжаттар")],
          ["customers", tr("Организации", "Ұйымдар")],
          ["settings", role === "SUPER_ADMIN" ? tr("Управление системой", "Жүйені басқару") : tr("Администрирование", "Әкімшілендіру")]]
        : [["requests", tr("Подготовка документов", "Құжаттарды дайындау")],
          ["approvals", role === "DIRECTOR" ? tr("Кабинет директора", "Директор кабинеті") : tr("Согласование", "Келісу")],
          ["workbench", tr("Работа центра", "Орталық жұмысы")],
          ...(isLmsStaffRole(role) ? [["lms/workplace", tr("Обучение", "Оқыту")]] : []),
          ...(role === "VIEWER" ? [["lms/reports", tr("Обзор обучения", "Оқу шолуы")]] : []),
          ...(!isLmsStaffRole(role) && canTeach ? teachingNav : []),
          ...(canLearn ? [["learn", tr("Моё обучение", "Менің оқуым")]] : []),
          ["customers", tr("Заказчики", "Тапсырыс берушілер")],
          ["history", tr("Архив", "Мұрағат")],
          ...(role === "DIRECTOR" ? [["settings", tr("Настройки", "Параметрлер")]] : [])];
  if (canLearn && !mainNav.some(([path]) => path === "learn"))
    mainNav.push(["learn", tr("Моё обучение", "Менің оқуым")]);
  return (
    <CabinetLanguageProvider t={lmsText}>
      <a className="skip-link" href="#main">
        {tr("Перейти к содержимому", "Мазмұнға өту")}
      </a>
      <header className="app-header">
        <Link
          href={workspaceStartPath(context.user.role)}
          className="brand-link"
          aria-label="DEMO"
        >
          <Brand />
        </Link>
        <nav aria-label={tr("Основная навигация", "Негізгі навигация")}>
          {mainNav.map(([path, label]) => (
            <Link
              key={path}
              href={`/${path}`}
              aria-current={
                pathname === `/${path}` ||
                (path === "learn" && pathname.startsWith("/learn/")) ||
                (section === path && path !== "lms") ||
                (path === "lms/workplace" && pathname.startsWith("/lms"))
                  ? "page"
                  : undefined
              }
            >
              {label}
            </Link>
          ))}
        </nav>
        <div className="session">
          <Link href="/lms/profile">{tr("Профиль и пароль", "Профиль және құпиясөз")}</Link>
          {section !== "lms" && <LanguageSwitch language={language} onChange={setLanguage} />}
          <Link href="/security">{tr("Безопасность", "Қауіпсіздік")}</Link>
          <span>
            <strong>{context.user.displayName}</strong>
            <small>{tr(roleLabel(role), ({SUPER_ADMIN:"Суперәкімші",ADMIN:"Әкімші",DIRECTOR:"Директор",OPERATOR:"Оператор",VIEWER:"Қараушы",EMPLOYER:"Ұйым өкілі",LEARNER:"Тыңдаушы",TEACHER:"Оқытушы",METHODIST:"Әдіскер",EXPERT:"Сарапшы / комиссия мүшесі"} as Record<string,string>)[role] || role)} · {context.tenant.name}</small>
          </span>
          <button className="text-button" onClick={() => void logout()}>
            {tr("Выйти", "Шығу")}
          </button>
        </div>
      </header>
      <main id="main" className="workspace" lang={language === "kz" ? "kk" : "ru"}>
        {error && <Notice>{error}</Notice>}
        {sessionExpired && (
          <Notice>
            {tr(
              "Сессия завершена. Введённые данные остаются на странице. Войдите снова и повторите последнее действие.",
              "Сессия аяқталды. Енгізілген деректер бетте сақталады. Қайта кіріп, соңғы әрекетті қайталаңыз.",
            )}
            <button onClick={() => setSessionDialog(true)}>
              {tr("Войти снова", "Қайта кіру")}
            </button>
          </Notice>
        )}
        {section === "lms" ||
        context.user.role === "LEARNER" ||
        teachingRole ? (
          <LmsWorkspace context={context} pathname={pathname} />
        ) : context.user.role === "EMPLOYER" ? (
          <EmployerHome context={context} />
        ) : pathname === "/portal" ? (
          <EmployerHome context={context} />
        ) : pathname === "/onboarding" ? (
          <CenterOnboarding context={context} onContextChange={setContext} />
        ) : pathname === "/requests/new" ? (
          <NewRequest context={context} />
        ) : requestMatch ? (
          <Editor
            key={requestMatch[1]}
            id={requestMatch[1]}
            context={context}
          />
        ) : section === "approvals" ? (
          <Approvals context={context} />
        ) : section === "workbench" ? (
          <Workbench context={context} />
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
        <span>
          {section === "lms" || context.user.role === "LEARNER" || teachingRole
            ? tr("DEMO · Обучение и документы", "DEMO · Оқыту және құжаттар")
            : tr("DEMO · Подготовка и печать документов", "DEMO · Құжаттарды дайындау және басып шығару")}
        </span>
        <span>
          {tr("Часовой пояс центра", "Орталықтың уақыт белдеуі")}:{" "}
          {context.tenant.timezone}
        </span>
      </footer>
    </CabinetLanguageProvider>
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
  const [error, setError] = useState<unknown>(null);
  const [challenge, setChallenge] = useState("");
  const [code, setCode] = useState("");
  const { t, language, setLanguage } = useLanguage("login");
  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const result = await api<{
        csrfToken?: string;
        mfaRequired?: boolean;
        challengeToken?: string;
        mfaSetupRequired?: boolean;
      }>(challenge ? "/auth/mfa/challenge" : "/auth/login", {
        method: "POST",
        body: json(
          challenge ? { challengeToken: challenge, code } : { email, password },
        ),
      });
      if (result.mfaRequired && result.challengeToken) {
        setChallenge(result.challengeToken);
        setPassword("");
        return;
      }
      if (result.csrfToken) setCsrf(result.csrfToken);
      await onLogin();
    } catch (caught) {
      setError(caught);
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
          <h2>{t("Войти в DEMO", "DEMO жүйесіне кіру")}</h2>
          <LanguageSwitch language={language} onChange={setLanguage} />
          <p className="muted">
            {t(
              "Используйте учётную запись вашего центра.",
              "Орталығыңыздың есептік жазбасын пайдаланыңыз.",
            )}
          </p>
          {!!error && <Notice>{lmsError(error, t)}</Notice>}
          {!challenge && (
            <>
              <label>
                {t("Электронная почта", "Электрондық пошта")}
                <input
                  type="email"
                  autoComplete="username"
                  required
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                />
              </label>
              <label>
                {t("Пароль", "Құпиясөз")}
                <input
                  type="password"
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                />
              </label>
            </>
          )}
          {challenge && (
            <label>
              {t(
                "Код приложения или резервный код",
                "Қолданба коды немесе қалпына келтіру коды",
              )}
              <input
                autoFocus
                required
                autoComplete="one-time-code"
                value={code}
                onChange={(event) => setCode(event.target.value)}
              />
            </label>
          )}
          <button className="primary" disabled={busy}>
            {busy ? t("Входим…", "Кіруде…") : t("Войти", "Кіру")}
          </button>
          {challenge && (
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                setChallenge("");
                setCode("");
              }}
            >
              {t("Начать вход заново", "Кіруді қайта бастау")}
            </button>
          )}
          <p className="fine-print">
            {t(
              "Нет доступа? Обратитесь к директору вашего центра.",
              "Кіру мүмкін емес пе? Орталық директорына хабарласыңыз.",
            )}
          </p>
          <p>
            <Link href="/register">
              {t("Зарегистрировать учебный центр", "Оқу орталығын тіркеу")}
            </Link>
          </p>
          <p>
            <Link href="/learn/register">
              {t("Зарегистрироваться на обучение", "Оқуға тіркелу")}
            </Link>
          </p>
          <p><Link href="/verify">{t("Проверить документ", "Құжатты тексеру")}</Link></p>
        </form>
      </section>
    </main>
  );
}
