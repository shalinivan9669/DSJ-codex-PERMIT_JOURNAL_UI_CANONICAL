"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { Notice } from "@demo/ui";
import { consentText, consentVersion } from "@demo/contracts/src/lms";
import { api, ApiError, json, setCsrf } from "@/lib/api";
import { safeLmsReturnTo } from "@/lib/lms-navigation";
import {
  LmsErrorDiagnostic,
  LanguageSwitch,
  lmsError,
  useLanguage,
} from "./common";
import "./lms.css";

export function LearnerIdentity({
  path,
  onAuthenticated,
}: {
  path: string;
  onAuthenticated: () => Promise<void>;
}) {
  const router = useRouter();
  const { t, language, setLanguage } = useLanguage("public");
  const [email, setEmail] = useState(""),
    [displayName, setDisplayName] = useState(""),
    [password, setPassword] = useState("");
  const [consent, setConsent] = useState(false),
    [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null),
    [token, setToken] = useState("");
  const [center, setCenter] = useState("");
  const [accountExists, setAccountExists] = useState(false);
  const [recipientName, setRecipientName] = useState("");
  const [inspecting, setInspecting] = useState(false);
  const [challenge, setChallenge] = useState(""), [code, setCode] = useState("");
  const [signedIn, setSignedIn] = useState(false);
  const [returnTo, setReturnTo] = useState<string | null>(null);
  const [registrationConfig, setRegistrationConfig] = useState<{enabled: boolean; centers: {key: string; name: string}[]} | null>(null);
  const [centerKey, setCenterKey] = useState("");
  const registration = path === "/learn/register",
    recovery = path === "/learn/recovery";
  useEffect(() => {
    let active = true;
    const address = new URL(window.location.href);
    setReturnTo(safeLmsReturnTo(address.searchParams.get("returnTo")));
    const value = new URLSearchParams(address.hash.slice(1)).get("token") || address.searchParams.get("token") || "";
    if (address.searchParams.has("token")) {
      address.searchParams.delete("token");
      address.hash = new URLSearchParams({ token: value }).toString();
      window.history.replaceState(window.history.state, "", address);
    }
    setToken(value);
    if (registration) {
      setInspecting(true);
      void api<{enabled: boolean; centers: {key: string; name: string}[]}>("/learn/registration")
        .then((result) => { if (active) { setRegistrationConfig(result); if (result.centers.length === 1) setCenterKey(result.centers[0].key); } })
        .catch((caught) => { if (active) setError(caught); })
        .finally(() => { if (active) setInspecting(false); });
    }
    if (!registration && !recovery && value) {
      setInspecting(true);
      void api<{ centerName: string; email: string; recipientName: string; accountExists: boolean }>("/learn/invite/inspect", {
        method: "POST",
        body: json({ token: value }),
      })
        .then((result) => { if (active) { setCenter(result.centerName); setEmail(result.email); setRecipientName(result.recipientName); setAccountExists(result.accountExists); } })
        .catch((caught) => { if (active) setError(caught); })
        .finally(() => { if (active) setInspecting(false); });
    }
    return () => { active = false; };
  }, [path]);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      if (!registration && !recovery && accountExists && !signedIn) {
        const authentication = await api<{ csrfToken?: string; mfaRequired?: boolean; challengeToken?: string }>(challenge ? "/auth/mfa/challenge" : "/auth/login", {
          method: "POST", body: json(challenge ? { challengeToken: challenge, code } : { email, password }),
        });
        setPassword("");
        if (authentication.mfaRequired && authentication.challengeToken) {
          setChallenge(authentication.challengeToken);
          return;
        }
        if (authentication.csrfToken) setCsrf(authentication.csrfToken);
        setSignedIn(true);
      }
      const result = await api<{ csrfToken?: string; redirect: string }>(
        registration
          ? "/learn/register"
          : recovery
            ? "/learn/recovery/exchange"
            : accountExists ? "/learn/invite/accept" : "/learn/invite/exchange",
        {
          method: "POST",
          body: json(
            registration
              ? { email, password, displayName, consentVersion, consent, ...(centerKey ? {centerKey} : {}) }
              : recovery
                ? { token, password }
                : accountExists ? { token, consentVersion, consent } : { token, password, consentVersion, consent },
          ),
        },
      );
      setPassword("");
      if (result.csrfToken) setCsrf(result.csrfToken);
      if (!recovery) await onAuthenticated();
      router.replace(
        registration
          ? safeLmsReturnTo(new URLSearchParams(window.location.search).get("returnTo")) || (sessionStorage.getItem("lms:course-choice") ? "/catalogue" : result.redirect)
          : result.redirect,
      );
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 401) {
        setSignedIn(false);
        setChallenge("");
        setCode("");
      }
      if (caught instanceof ApiError && (caught.details as { code?: string })?.code === "INVITE_SIGN_IN_REQUIRED") {
        setAccountExists(true);
        setPassword("");
      }
      setError(caught);
    } finally {
      setBusy(false);
    }
  }
  return (
    <main
      className="initial-state lms-workspace"
      lang={language === "kz" ? "kk" : "ru"}
    >
      <section
        className="panel lms-panel"
        style={{ width: "min(100%, 540px)", textAlign: "left" }}
      >
        <div className="lms-toolbar">
          <strong className="brand">DEMO</strong>
          <LanguageSwitch language={language} onChange={setLanguage} />
        </div>
        <h1>
          {registration
            ? t("Начать обучение", "Оқуды бастау")
            : recovery
              ? t("Новый пароль", "Жаңа құпиясөз")
              : t("Принять приглашение", "Шақыруды қабылдау")}
        </h1>
        {center && <p>{center}</p>}
        {recipientName && <p><strong>{recipientName}</strong> · {email}</p>}
        {inspecting && <p role="status">{registration ? t("Проверяем доступность регистрации…", "Тіркелу мүмкіндігін тексерудеміз…") : t("Открываем приглашение…", "Шақыруды ашуда…")}</p>}
        {registration && registrationConfig && !registrationConfig.enabled && <Notice>{t("Самостоятельная регистрация сейчас закрыта. Получите личную ссылку приглашения у своего учебного центра. Если кабинет уже создан, войдите в него.", "Өз бетіңізше тіркелу қазір жабық. Оқу орталығынан жеке шақыру сілтемесін алыңыз. Кабинет бұрын жасалған болса, оған кіріңіз.")} <Link href="/login">{t("Войти", "Кіру")}</Link></Notice>}
        {!registration && !token && <Notice>{t("Откройте личную ссылку, которую передал учебный центр.", "Оқу орталығы берген жеке сілтемені ашыңыз.")}</Notice>}
        {!!error && (
          <Notice>
            {lmsError(error, t)}
            <LmsErrorDiagnostic error={error} t={t} />
          </Notice>
        )}
        {(!registration || registrationConfig?.enabled) && <form onSubmit={submit}>
          {registration && (
            <>
              {registrationConfig && registrationConfig.centers.length > 1 && <label>{t("Учебный центр", "Оқу орталығы")}<select required value={centerKey} onChange={event => setCenterKey(event.target.value)}><option value="">{t("Выберите центр", "Орталықты таңдаңыз")}</option>{registrationConfig.centers.map(item => <option key={item.key} value={item.key}>{item.name}</option>)}</select></label>}
              {registrationConfig?.centers.length === 1 && <p>{registrationConfig.centers[0].name}</p>}
              <label>
                {t("ФИО", "Аты-жөні")}
                <input
                  autoComplete="name"
                  required
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                />
              </label>
              <label>
                {t("Электронная почта", "Электрондық пошта")}
                <input
                  type="email"
                  autoComplete="username"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </label>
            </>
          )}
          {!challenge && !signedIn && <label>
            {!registration && !recovery && accountExists ? t("Пароль вашей учётной записи", "Тіркелгіңіздің құпиясөзі") : t("Придумайте пароль", "Құпиясөз орнатыңыз")}
            <input
              type="password"
              autoComplete={accountExists ? "current-password" : "new-password"}
              minLength={accountExists ? undefined : 12}
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>}
          {challenge && !signedIn && <label>{t("Код приложения или резервный код", "Қолданба немесе қалпына келтіру коды")}<input autoFocus autoComplete="one-time-code" required value={code} onChange={event => setCode(event.target.value)} /></label>}
          {challenge && !signedIn && <button type="button" disabled={busy} onClick={() => { setChallenge(""); setCode(""); setPassword(""); setError(null); }}>{t("Начать вход заново", "Кіруді қайта бастау")}</button>}
          {!recovery && (
            <label className="lms-inline-label">
              <input
                type="checkbox"
                required
                checked={consent}
                onChange={(e) => setConsent(e.target.checked)}
              />
              <span>{consentText[language]}</span>
            </label>
          )}
          <button
            className="primary lms-primary"
            disabled={busy || inspecting || (!registration && !token)}
          >
            {busy
              ? t("Подождите…", "Күтіңіз…")
              : recovery
                ? t("Изменить пароль", "Құпиясөзді өзгерту")
                : registration ? t("Создать личный кабинет", "Жеке кабинет жасау") : challenge ? t("Подтвердить вход и принять приглашение", "Кіруді растап, шақыруды қабылдау") : t("Принять приглашение", "Шақыруды қабылдау")}
          </button>
          <p>
            <Link href={registration && returnTo ? `/login?returnTo=${encodeURIComponent(returnTo)}` : "/login"}>
              {t("Уже есть учётная запись — войти", "Тіркелгі бар — кіру")}
            </Link>
          </p>
        </form>}
      </section>
    </main>
  );
}
