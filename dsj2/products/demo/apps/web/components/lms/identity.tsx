"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { Notice } from "@demo/ui";
import { consentText, consentVersion } from "@demo/contracts/src/lms";
import { api, json, setCsrf } from "@/lib/api";
import { LanguageSwitch, lmsError, useLanguage } from "./common";
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
  const [error, setError] = useState(""),
    [token, setToken] = useState("");
  const [center, setCenter] = useState("");
  const registration = path === "/learn/register",
    recovery = path === "/learn/recovery";
  useEffect(() => {
    const value =
      new URLSearchParams(window.location.search).get("token") || "";
    setToken(value);
    if (!registration && !recovery && value)
      void api<{ centerName: string }>("/learn/invite/inspect", {
        method: "POST",
        body: json({ token: value }),
      })
        .then((result) => setCenter(result.centerName))
        .catch((caught) => setError(lmsError(caught, t)));
  }, [path]);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const result = await api<{ csrfToken?: string; redirect: string }>(
        registration
          ? "/learn/register"
          : recovery
            ? "/learn/recovery/exchange"
            : "/learn/invite/exchange",
        {
          method: "POST",
          body: json(
            registration
              ? { email, password, displayName, consentVersion, consent }
              : recovery
                ? { token, password }
                : { token, password, consentVersion, consent },
          ),
        },
      );
      setPassword("");
      if (result.csrfToken) setCsrf(result.csrfToken);
      if (!recovery) await onAuthenticated();
      router.replace(result.redirect);
    } catch (caught) {
      setError(lmsError(caught, t));
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
        {error && <Notice>{error}</Notice>}
        <form onSubmit={submit}>
          {registration && (
            <>
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
          <label>
            {t("Пароль", "Құпиясөз")}
            <input
              type="password"
              autoComplete="new-password"
              minLength={12}
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
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
            disabled={busy || (!registration && !token)}
          >
            {busy
              ? t("Подождите…", "Күтіңіз…")
              : recovery
                ? t("Изменить пароль", "Құпиясөзді өзгерту")
                : t("Продолжить", "Жалғастыру")}
          </button>
          <p>
            <Link href="/login">
              {t("Уже есть учётная запись — войти", "Тіркелгі бар — кіру")}
            </Link>
          </p>
        </form>
      </section>
    </main>
  );
}
