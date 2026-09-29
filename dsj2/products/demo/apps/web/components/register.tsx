"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Icon, Notice } from "@demo/ui";
import { registrationSchema, type OrganizationNames } from "@demo/contracts";
import { api, errorText, json, setCsrf } from "@/lib/api";
import { OrganizationNameFields } from "./organization-name-fields";
import "./center-onboarding.css";

export function Register({
  onRegistered,
}: {
  onRegistered: () => Promise<void>;
}) {
  const router = useRouter();
  const [names, setNames] = useState<OrganizationNames>({
    legalForm: "NONE",
    ownNameRu: "",
    ownNameKz: "",
    nameRu: "",
    nameKz: "",
  });
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit(event: FormEvent) {
    event.preventDefault();
    const parsed = registrationSchema.safeParse({
      legalForm: names.legalForm,
      ownNameRu: names.ownNameRu,
      ownNameKz: names.ownNameKz || "",
      displayName,
      email: email.trim(),
      password,
    });
    if (!parsed.success) {
      setError(parsed.error.issues.map((issue) => issue.message).join(". "));
      return;
    }
    setBusy(true);
    setError("");
    try {
      const result = await api<{ csrfToken: string }>("/auth/register", {
        method: "POST",
        body: json(parsed.data),
      });
      setCsrf(result.csrfToken);
      setPassword("");
      await onRegistered();
      router.replace("/onboarding");
    } catch (caught) {
      setError(errorText(caught));
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="center-registration">
      <Link href="/login" className="back-link">
        ← Ко входу
      </Link>
      <div className="page-heading">
        <div>
          <span className="brand">
            <Icon name="print" /> DEMO
          </span>
          <h1>Зарегистрировать учебный центр</h1>
          <p>
            Создайте пространство центра. Реквизиты, комиссию и формы заполните
            следующим шагом.
          </p>
        </div>
      </div>
      <section className="panel">
        <form onSubmit={submit}>
          {error && <Notice>{error}</Notice>}
          <fieldset className="registration-fields" disabled={busy}>
            <legend>Название центра</legend>
            <OrganizationNameFields value={names} onChange={setNames} />
            <h2>Администратор центра</h2>
            <label>
              Ваше имя
              <input
                required
                maxLength={255}
                autoComplete="name"
                value={displayName}
                onChange={(event) => setDisplayName(event.target.value)}
              />
            </label>
            <label>
              Электронная почта
              <input
                required
                type="email"
                maxLength={255}
                autoComplete="username"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
            </label>
            <label>
              Пароль
              <input
                required
                type="password"
                minLength={12}
                maxLength={256}
                autoComplete="new-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
              <small>Не менее 12 символов.</small>
            </label>
            <button className="primary" disabled={busy}>
              {busy ? "Создаём центр…" : "Создать центр и продолжить"}
            </button>
          </fieldset>
        </form>
      </section>
      <p className="fine-print">
        Уже есть учётная запись? <Link href="/login">Войти в свой центр</Link>
      </p>
    </main>
  );
}
