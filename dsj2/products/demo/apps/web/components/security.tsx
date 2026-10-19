"use client";
import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { api, json, setCsrf } from "@/lib/api";
import { LanguageSwitch, lmsError, useLanguage } from "./lms/common";
type SecurityStatus = {
  enabled: boolean;
  required: boolean;
  requiredStaff: boolean;
  canSetPolicy: boolean;
  recoveryRemaining: number;
  csrfToken: string;
};
export function SecuritySettings() {
  const { language, setLanguage, t } = useLanguage("security");
  const [status, setStatus] = useState<SecurityStatus | null>(null),
    [password, setPassword] = useState(""),
    [code, setCode] = useState("");
  const [action, setAction] = useState("SETUP"),
    [reauth, setReauth] = useState(""),
    [secret, setSecret] = useState(""),
    [codes, setCodes] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState<unknown>(null),
    [done, setDone] = useState(false);
  const errorRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    void api<SecurityStatus>("/auth/mfa/status")
      .then((s) => {
        setStatus(s);
        setCsrf(s.csrfToken);
      })
      .catch(setError);
  }, []);
  useEffect(() => {
    if (error) errorRef.current?.focus();
  }, [error]);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      if (secret) {
        const result = await api<{ recoveryCodes: string[] }>(
          "/auth/mfa/confirm",
          { method: "POST", body: json({ reauthToken: reauth, code }) },
        );
        setSecret("");
        setCode("");
        setPassword("");
        setCodes(result.recoveryCodes);
        setDone(true);
        return;
      }
      const purpose =
        action === "SETUP"
          ? "SETUP"
          : action === "POLICY"
            ? "POLICY"
            : "MANAGE";
      const verified = await api<{ reauthToken: string }>("/auth/mfa/reauth", {
        method: "POST",
        body: json({ password, ...(code ? { code } : {}), purpose }),
      });
      setPassword("");
      setCode("");
      setReauth(verified.reauthToken);
      if (action === "SETUP") {
        const setup = await api<{ secret: string }>("/auth/mfa/setup", {
          method: "POST",
          body: json({ reauthToken: verified.reauthToken }),
        });
        setSecret(setup.secret);
      } else if (action === "POLICY") {
        const result = await api<{ requiredStaff: boolean }>(
          "/auth/mfa/policy",
          {
            method: "POST",
            body: json({
              reauthToken: verified.reauthToken,
              required: !status?.requiredStaff,
            }),
          },
        );
        setStatus((s) =>
          s
            ? {
                ...s,
                requiredStaff: result.requiredStaff,
                required: result.requiredStaff,
              }
            : s,
        );
      } else {
        const result = await api<{ recoveryCodes?: string[] }>(
          "/auth/mfa/manage",
          {
            method: "POST",
            body: json({ reauthToken: verified.reauthToken, action }),
          },
        );
        setCodes(result.recoveryCodes || []);
        setDone(true);
      }
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section
      className="lms-panel"
      style={{ maxWidth: 640, margin: "24px auto", padding: 20 }}
    >
      <div className="lms-toolbar">
        <h1>{t("Безопасность входа", "Кіру қауіпсіздігі")}</h1>
        <LanguageSwitch language={language} onChange={setLanguage} />
      </div>
      {!!error && (
        <div className="notice error" role="alert" tabIndex={-1} ref={errorRef}>
          {lmsError(error, t)}
        </div>
      )}
      {done ? (
        <>
          <h2>{t("Изменения сохранены", "Өзгерістер сақталды")}</h2>
          {!!codes?.length && (
            <>
              <p>
                {t(
                  "Сохраните резервные коды в защищённом месте. Каждый работает один раз; повторно они не показываются.",
                  "Қалпына келтіру кодтарын қауіпсіз жерде сақтаңыз. Әр код бір рет қолданылады және қайта көрсетілмейді.",
                )}
              </p>
              <textarea
                aria-label={t("Резервные коды", "Қалпына келтіру кодтары")}
                readOnly
                rows={10}
                value={codes.join("\n")}
              />
            </>
          )}
          <a href="/login" className="primary">
            {t("Войти снова", "Қайта кіру")}
          </a>
        </>
      ) : (
        <form onSubmit={submit}>
          {status && (
            <p>
              {status.enabled
                ? t("Второй фактор подключён", "Екінші фактор қосылған")
                : status.required
                  ? t(
                      "Для вашей роли требуется второй фактор",
                      "Сіздің рөліңізге екінші фактор қажет",
                    )
                  : t(
                      "Подключите приложение с одноразовыми кодами",
                      "Бір реттік кодтары бар қолданбаны қосыңыз",
                    )}
            </p>
          )}
          {secret ? (
            <>
              <p>
                {t(
                  "Добавьте в приложение новый TOTP: 6 цифр, 30 секунд. Ключ:",
                  "Қолданбаға жаңа TOTP қосыңыз: 6 сан, 30 секунд. Кілт:",
                )}
              </p>
              <input
                aria-label={t("Ключ подключения", "Қосу кілті")}
                readOnly
                value={secret}
              />
              <label>
                {t("Код нового устройства", "Жаңа құрылғының коды")}
                <input
                  required
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                />
              </label>
            </>
          ) : (
            <>
              {status?.enabled && (
                <label>
                  {t("Действие", "Әрекет")}
                  <select
                    value={action}
                    onChange={(e) => setAction(e.target.value)}
                  >
                    <option value="SETUP">
                      {t("Подключить новое устройство", "Жаңа құрылғы қосу")}
                    </option>
                    <option value="RECOVERY">
                      {t(
                        "Обновить резервные коды",
                        "Қалпына келтіру кодтарын жаңарту",
                      )}
                    </option>
                    {!status.required && (
                      <option value="DISABLE">
                        {t("Отключить второй фактор", "Екінші факторды өшіру")}
                      </option>
                    )}
                    {status.canSetPolicy && (
                      <option value="POLICY">
                        {status.requiredStaff
                          ? t(
                              "Снять обязательность для сотрудников",
                              "Қызметкерлер үшін міндеттілікті алып тастау",
                            )
                          : t(
                              "Сделать обязательным для сотрудников",
                              "Қызметкерлер үшін міндетті ету",
                            )}
                      </option>
                    )}
                  </select>
                </label>
              )}
              <label>
                {t("Текущий пароль", "Қазіргі құпиясөз")}
                <input
                  required
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </label>
              {status?.enabled && (
                <label>
                  {t(
                    "Код приложения или резервный код",
                    "Қолданба коды немесе қалпына келтіру коды",
                  )}
                  <input
                    required
                    autoComplete="one-time-code"
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                  />
                </label>
              )}
            </>
          )}
          <div className="lms-actions">
            <button className="primary" disabled={busy || !status}>
              {busy
                ? t("Проверяем…", "Тексерілуде…")
                : secret
                  ? t("Подтвердить подключение", "Қосуды растау")
                  : t("Продолжить", "Жалғастыру")}
            </button>
            {secret && (
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  setSecret("");
                  setCode("");
                  setReauth("");
                  setError(null);
                }}
              >
                {t("Начать настройку заново", "Баптауды қайта бастау")}
              </button>
            )}
            {!status && (
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  setError(null);
                  void api<SecurityStatus>("/auth/mfa/status")
                    .then((s) => {
                      setStatus(s);
                      setCsrf(s.csrfToken);
                    })
                    .catch(setError);
                }}
              >
                {t("Повторить загрузку", "Қайта жүктеу")}
              </button>
            )}
            <Link href="/learn">{t("К обучению", "Оқуға өту")}</Link>
          </div>
        </form>
      )}
    </section>
  );
}
