"use client";
import { useState, type FormEvent } from "react";
import { Modal, Notice } from "@demo/ui";
import { api, errorText, json, setCsrf } from "@/lib/api";
import type { AppContext } from "@/lib/types";

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
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const result = await api<AppContext & { csrfToken: string }>(
        "/auth/login",
        {
          method: "POST",
          body: json({ email: context.user.email, password }),
        },
      );
      if (
        result.user.id !== context.user.id ||
        result.tenant.id !== context.tenant.id
      )
        throw new Error(
          "Учётная запись изменилась. Сохраните введённые данные отдельно и обратитесь к администратору.",
        );
      setCsrf(result.csrfToken);
      const restored = await api<AppContext>("/context");
      setPassword("");
      onRestored(restored);
    } catch (caught) {
      setError(errorText(caught));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title="Восстановить сессию" onClose={() => !busy && onClose()}>
      <form onSubmit={submit}>
        <p>
          Войдите под своей учётной записью. Введённые данные сохранятся на
          странице; после входа повторите сохранение или оформление.
        </p>
        {error && <Notice>{error}</Notice>}
        <label>
          Электронная почта
          <input
            type="email"
            value={context.user.email}
            readOnly
            autoComplete="username"
          />
        </label>
        <label>
          Пароль
          <input
            type="password"
            autoComplete="current-password"
            required
            disabled={busy}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </label>
        <div className="modal-actions">
          <button type="button" disabled={busy} onClick={onClose}>
            Вернуться к данным
          </button>
          <button className="primary" disabled={busy}>
            {busy ? "Входим…" : "Войти и продолжить"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
