"use client";
import { useEffect, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { api, json, setCsrf } from "@/lib/api";
import { LanguageSwitch, lmsError, useLanguage } from "./lms/common";
type Details = {
  existingAccount: boolean;
  expiresAt: string;
  accessExpiresAt: string;
  customerNameRu?: string;
  customerNameKz?: string;
  centerName?: string;
  displayName?: string;
  permissions?: string[];
};
export function EmployerInviteAccept() {
  const { t, language, setLanguage } = useLanguage("public");
  const token = useRef("");
  const started = useRef(false);
  const errorRef = useRef<HTMLDivElement>(null);
  const [details, setDetails] = useState<Details | null>(null);
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const [localError, setLocalError] = useState<"MISSING" | "PASSWORD" | null>(null);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    token.current = window.location.hash.slice(1);
    // The fragment never reaches HTTP logs; remove it before the first API call.
    window.history.replaceState(null, "", "/invite");
    if (!/^[a-f0-9]{64}$/.test(token.current)) {
      setLocalError("MISSING");
      setBusy(false);
      return;
    }
    void api<Details>("/auth/employer-invite/inspect", {
      method: "POST",
      body: json({ token: token.current }),
    })
      .then(setDetails)
      .catch(setError)
      .finally(() => setBusy(false));
  }, []);
  useEffect(() => {
    if (error || localError) errorRef.current?.focus();
  }, [error, localError]);
  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setLocalError(null);
    if (!details?.existingAccount && password !== confirmation) {
      setLocalError("PASSWORD");
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
      setError(e);
      setBusy(false);
    }
  }
  return (
    <main className="initial-state" lang={language === "kz" ? "kk" : "ru"}>
      <section
        className="login-card"
        style={{ width: "min(100%, 440px)", boxSizing: "border-box" }}
      >
        <LanguageSwitch language={language} onChange={setLanguage} />
        <h1>{t("Приглашение представителя", "Өкілге шақыру")}</h1>
        <p>
          {t("Доступ к заказам и сотрудникам вашей организации в пределах прав, назначенных учебным центром.", "Оқу орталығы белгілеген құқықтар шегінде ұйымыңыздың тапсырыстары мен қызметкерлеріне рұқсат.")}
        </p>
        {(!!error || !!localError) && (
          <div
            role="alert"
            aria-label={t("Ошибка приглашения", "Шақыру қатесі")}
            tabIndex={-1}
            ref={errorRef}
            className="notice"
          >
            {localError === "MISSING" ? t("В ссылке отсутствует действующее приглашение. Откройте полную ссылку, полученную от учебного центра.", "Сілтемеде жарамды шақыру жоқ. Оқу орталығы берген толық сілтемені ашыңыз.") : localError === "PASSWORD" ? t("Пароли не совпадают. Повторите новый пароль.", "Құпиясөздер сәйкес емес. Жаңа құпиясөзді қайталаңыз.") : lmsError(error, t)}
          </div>
        )}
        {busy && !details && <p role="status">{t("Проверяем приглашение…", "Шақыруды тексерудеміз…")}</p>}
        {details && (
          <form onSubmit={(e) => void submit(e)}>
            <div className="panel">
              {details.centerName && <p>{t("Учебный центр", "Оқу орталығы")}: <strong>{details.centerName}</strong></p>}
              {details.customerNameRu && <p>{t("Организация", "Ұйым")}: <strong>{t(details.customerNameRu, details.customerNameKz || details.customerNameRu)}</strong></p>}
              {details.displayName && <p>{t("Представитель", "Өкіл")}: {details.displayName}</p>}
              {!!details.permissions?.length && <p>{t("Ваши права", "Сіздің құқықтарыңыз")}: {details.permissions.map(permission => ({
                READ: t("просмотр", "қарау"),
                DOWNLOAD: t("скачивание файлов", "файлдарды жүктеу"),
                ASSIGN_TRAINING: t("назначение обучения", "оқуды тағайындау"),
                PROPOSE: t("предложения изменений", "өзгерістер ұсыну"),
                APPROVE_DATA: t("подтверждение списка", "тізімді растау"),
              })[permission] || t("дополнительное право", "қосымша құқық")).join(", ")}</p>}
            </div>
            <p>
              {details.existingAccount
                ? t("Подтвердите текущий пароль вашей учётной записи. Приглашение не меняет пароль.", "Тіркелгіңіздің ағымдағы құпиясөзін растаңыз. Шақыру құпиясөзді өзгертпейді.")
                : t("Задайте свой пароль для последующих входов. Не менее 12 символов; вставка и менеджер паролей доступны.", "Кейін кіру үшін кемінде 12 таңбадан тұратын құпиясөз орнатыңыз. Қою және құпиясөз менеджері қолжетімді.")}
            </p>
            <p>
              {t("Доступ до", "Рұқсат мерзімі")}{" "}
              {new Date(details.accessExpiresAt).toLocaleString(t("ru-KZ", "kk-KZ"))}.
              {t("Приглашение действует до", "Шақыру мерзімі")}{" "}
              {new Date(details.expiresAt).toLocaleString(t("ru-KZ", "kk-KZ"))}.
            </p>
            <label>
              {details.existingAccount ? t("Текущий пароль", "Ағымдағы құпиясөз") : t("Новый пароль", "Жаңа құпиясөз")}
              <input
                type="password"
                autoComplete={
                  details.existingAccount ? "current-password" : "new-password"
                }
                minLength={12}
                maxLength={256}
                required
                disabled={busy}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </label>
            {!details.existingAccount && (
              <label>
                {t("Повторите новый пароль", "Жаңа құпиясөзді қайталаңыз")}
                <input
                  type="password"
                  autoComplete="new-password"
                  minLength={12}
                  maxLength={256}
                  required
                  disabled={busy}
                  value={confirmation}
                  onChange={(e) => setConfirmation(e.target.value)}
                />
              </label>
            )}
            <button className="primary" type="submit" disabled={busy}>
              {busy ? t("Открываем доступ…", "Рұқсат ашылуда…") : t("Принять приглашение", "Шақыруды қабылдау")}
            </button>
          </form>
        )}
        <p>
          {t("Ссылка одноразовая. После принятия входите по своему адресу и паролю.", "Сілтеме бір реттік. Қабылдағаннан кейін өз мекенжайыңыз бен құпиясөзіңіз арқылы кіріңіз.")}
        </p>
        <Link href="/login">{t("Перейти ко входу", "Кіруге өту")}</Link>
      </section>
    </main>
  );
}
