"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Icon, Notice } from "@demo/ui";
import { registrationSchema, type OrganizationNames } from "@demo/contracts";
import { api, json, setCsrf } from "@/lib/api";
import { OrganizationNameFields } from "./organization-name-fields";
import { CabinetLanguageProvider } from "./cabinet-language";
import { LanguageSwitch, lmsError, useLanguage } from "./lms/common";
import "./center-onboarding.css";

export function Register({
  onRegistered,
}: {
  onRegistered: () => Promise<void>;
}) {
  const router = useRouter();
  const { t, language, setLanguage } = useLanguage("public");
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
  const [error, setError] = useState<unknown>(null);
  const [invalid, setInvalid] = useState(false);
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
      setInvalid(true);
      return;
    }
    setBusy(true);
    setError(null);
    setInvalid(false);
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
      setError(caught);
    } finally {
      setBusy(false);
    }
  }
  return (
    <CabinetLanguageProvider t={t}><main className="center-registration" lang={language === "kz" ? "kk" : "ru"}>
      <LanguageSwitch language={language} onChange={setLanguage} />
      <Link href="/login" className="back-link">
        ← {t("Ко входу", "Кіруге")}
      </Link>
      <div className="page-heading">
        <div>
          <span className="brand">
            <Icon name="print" /> DEMO
          </span>
          <h1>{t("Зарегистрировать учебный центр", "Оқу орталығын тіркеу")}</h1>
          <p>
            {t("Создайте пространство центра. Реквизиты, комиссию и формы заполните следующим шагом.", "Орталықтың кеңістігін құрыңыз. Келесі қадамда деректемелерді, комиссияны және нысандарды толтырыңыз.")}
          </p>
        </div>
      </div>
      <section className="panel">
        <form onSubmit={submit}>
          {!!error && <Notice>{lmsError(error, t)}</Notice>}
          {invalid && <Notice>{t("Проверьте название центра, имя директора, адрес почты и пароль от 12 символов.", "Орталық атауын, директордың атын, пошта мекенжайын және кемінде 12 таңбалық құпиясөзді тексеріңіз.")}</Notice>}
          <fieldset className="registration-fields" disabled={busy}>
            <legend>{t("Название центра", "Орталық атауы")}</legend>
            <OrganizationNameFields value={names} onChange={setNames} />
            <h2>{t("Директор центра", "Орталық директоры")}</h2>
            <p className="muted">
              {t("Вы будете согласовывать заявки и управлять центром. Сотрудников можно добавить позже в настройках пользователей.", "Өтінімдерді келісіп, орталықты басқарасыз. Қызметкерлерді кейін пайдаланушы баптауларында қосуға болады.")}
            </p>
            <label>
              {t("Ваше имя", "Сіздің атыңыз")}
              <input
                required
                maxLength={255}
                autoComplete="name"
                value={displayName}
                onChange={(event) => setDisplayName(event.target.value)}
              />
            </label>
            <label>
              {t("Электронная почта", "Электрондық пошта")}
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
              {t("Пароль", "Құпиясөз")}
              <input
                required
                type="password"
                minLength={12}
                maxLength={256}
                autoComplete="new-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
              <small>{t("Не менее 12 символов.", "Кемінде 12 таңба.")}</small>
            </label>
            <button className="primary" disabled={busy}>
              {busy ? t("Создаём центр…", "Орталық құрылуда…") : t("Создать центр и продолжить", "Орталық құрып, жалғастыру")}
            </button>
          </fieldset>
        </form>
      </section>
      <p className="fine-print">
        {t("Уже есть учётная запись?", "Тіркелгіңіз бар ма?")} <Link href="/login">{t("Войти в свой центр", "Орталығыңызға кіру")}</Link>
      </p>
    </main></CabinetLanguageProvider>
  );
}
