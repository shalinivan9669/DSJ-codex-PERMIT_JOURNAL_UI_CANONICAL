"use client";
import { useState, type FormEvent } from "react";
import { Modal, Notice } from "@demo/ui";
import { api, json, setCsrf } from "@/lib/api";
import type { AppContext } from "@/lib/types";
import { lmsError, useLanguage } from "./lms/common";

/** Reauthentication keeps the mounted editor and its unsaved autosave lane intact. */
export function SessionDialog({
  context,
  onClose,
  onRestored,
}: {
  context: AppContext;
  onClose: () => void;
  onRestored: (context: AppContext) => void;
}) {
  const { t } = useLanguage(`${context.tenant.id}:${context.user.id}`);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [challenge, setChallenge] = useState("");
  const [code, setCode] = useState("");
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const result = await api<
        AppContext & {
          csrfToken: string;
          mfaRequired?: boolean;
          challengeToken?: string;
        }
      >(challenge ? "/auth/mfa/challenge" : "/auth/login", {
        method: "POST",
        body: json(
          challenge
            ? { challengeToken: challenge, code }
            : { email: context.user.email, password },
        ),
      });
      if (result.mfaRequired && result.challengeToken) {
        setChallenge(result.challengeToken);
        setPassword("");
        return;
      }
      if (
        result.user.id !== context.user.id ||
        result.tenant.id !== context.tenant.id
      )
        throw new Error(
          "Учётная запись изменилась. Сохраните введённые данные отдельно и обратитесь к директору центра.",
        );
      setCsrf(result.csrfToken);
      const restored = await api<AppContext>("/context");
      setPassword("");
      onRestored(restored);
    } catch (caught) {
      setError(caught);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title={t("Восстановить сессию", "Сеансты қалпына келтіру")}
      onClose={() => !busy && onClose()}
    >
      <form onSubmit={submit}>
        <p>
          {t(
            "Войдите под своей учётной записью. Введённые данные сохранятся на странице; после входа повторите сохранение или оформление.",
            "Өз есептік жазбаңызбен кіріңіз. Енгізілген деректер бетте сақталады; кіргеннен кейін сақтауды немесе рәсімдеуді қайталаңыз.",
          )}
        </p>
        {!!error && <Notice>{lmsError(error, t)}</Notice>}
        {!challenge && (
          <>
            <label>
              {t("Электронная почта", "Электрондық пошта")}
              <input
                type="email"
                value={context.user.email}
                readOnly
                autoComplete="username"
              />
            </label>
            <label>
              {t("Пароль", "Құпиясөз")}
              <input
                type="password"
                autoComplete="current-password"
                required
                disabled={busy}
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
        {challenge && (
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              setChallenge("");
              setCode("");
              setError(null);
            }}
          >
            {t("Начать вход заново", "Кіруді қайта бастау")}
          </button>
        )}
        <div className="modal-actions">
          <button type="button" disabled={busy} onClick={onClose}>
            {t("Вернуться к данным", "Деректерге оралу")}
          </button>
          <button className="primary" disabled={busy}>
            {busy
              ? t("Входим…", "Кіруде…")
              : t("Войти и продолжить", "Кіріп, жалғастыру")}
          </button>
        </div>
      </form>
    </Modal>
  );
}
