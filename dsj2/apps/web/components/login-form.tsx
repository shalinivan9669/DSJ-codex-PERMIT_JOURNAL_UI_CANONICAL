"use client";

import { useState, type FormEvent } from "react";
import { Input } from "@dsj/ui";

export function LoginForm() {
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    const form = new FormData(event.currentTarget);
    setPending(true); setError("");
    try {
      const response = await fetch("/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: form.get("email"), password: form.get("password") }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Не удалось войти.");
      window.location.assign(result.destination);
    } catch (error) { setError(error instanceof Error ? error.message : "Ошибка сети. Повторите попытку."); }
    finally { setPending(false); }
  }
  return <form onSubmit={submit} className="space-y-5">
    <div className="space-y-2"><label htmlFor="email">Электронная почта</label>
      <Input id="email" name="email" type="email" autoComplete="username" required disabled={pending} /></div>
    <div className="space-y-2"><label htmlFor="password">Пароль</label>
      <Input id="password" name="password" type="password" autoComplete="current-password" required disabled={pending} /></div>
    {error && <p role="alert" className="rounded border border-rose-200 bg-rose-50 p-3 text-rose-700">{error}</p>}
    <button type="submit" disabled={pending} className="w-full rounded bg-[var(--accent)] px-4 py-3 font-medium text-white disabled:opacity-60">{pending ? "Вход…" : "Войти"}</button>
  </form>;
}
