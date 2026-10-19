"use client";
import Link from "next/link";
import { useState } from "react";
import { Notice } from "@demo/ui";
import { canManageCenter } from "@demo/contracts";
import type { AppContext } from "@/lib/types";
import { ProfileForm, Templates } from "./settings";
import { useCabinetLanguage } from "./cabinet-language";
import "./center-onboarding.css";

export function CenterOnboarding({
  context,
  onContextChange,
}: {
  context: AppContext;
  onContextChange: (context: AppContext) => void;
}) {
  const t = useCabinetLanguage();
  const [step, setStep] = useState<"profile" | "templates">("profile");
  if (!canManageCenter(context.user.role))
    return (
      <Notice kind="info">
        {t("Данные и формы центра настраивает директор.", "Орталық деректері мен нысандарын директор баптайды.")}{" "}
        <Link href="/requests/new">{t("Создать черновик заявки", "Өтінім жобасын құру")}</Link>
      </Notice>
    );
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>{t("Подготовим ваш центр к работе", "Орталықты жұмысқа дайындайық")}</h1>
          <p>
            {t("Сведения вводятся один раз и подставляются в документы. Изменить их можно позже в настройках.", "Мәліметтер бір рет енгізіліп, құжаттарға қойылады. Оларды кейін баптауларда өзгертуге болады.")}
          </p>
        </div>
      </div>
      <nav className="center-setup-steps" aria-label={t("Подготовка центра", "Орталықты дайындау")}>
        <button
          aria-current={step === "profile" ? "step" : undefined}
          onClick={() => setStep("profile")}
        >
          <span>1</span> {t("Реквизиты и комиссия", "Деректемелер және комиссия")}
        </button>
        <button
          aria-current={step === "templates" ? "step" : undefined}
          onClick={() => setStep("templates")}
        >
          <span>2</span> {t("Проверить формы", "Нысандарды тексеру")}
        </button>
        <Link className="button" href="/requests/new">
          <span>3</span> {t("Первая заявка", "Алғашқы өтінім")}
        </Link>
      </nav>
      <Notice kind="info">
        {t("Черновик заявки можно начать сейчас. Перед оформлением документов подтвердите реквизиты центра и используемые формы.", "Өтінім жобасын қазір бастауға болады. Құжаттарды рәсімдемес бұрын орталық деректемелері мен қолданылатын нысандарды растаңыз.")}
      </Notice>
      <section className="panel center-setup-panel">
        <div hidden={step !== "profile"}>
          <ProfileForm
            profile={context.profile}
            onSaved={(profile) =>
              onContextChange({
                ...context,
                profile,
                profileVersionId: profile.id || context.profileVersionId,
              })
            }
          />
        </div>
        <div hidden={step !== "templates"}>
          <Templates initial={context.templates} />
        </div>
      </section>
      <div className="center-setup-next">
        {step === "profile" && (
          <button onClick={() => setStep("templates")}>{t("Перейти к формам", "Нысандарға өту")}</button>
        )}
        <Link className="button" href="/requests/new">
          {t("Начать черновик заявки", "Өтінім жобасын бастау")}
        </Link>
        <Link href="/settings">{t("Все настройки центра", "Орталықтың барлық баптаулары")}</Link>
      </div>
      <section className="panel lms-panel">
        <h2>{t("Подготовка обучения", "Оқуды дайындау")}</h2>
        <ol className="lms-list">
          <li><div><strong>{t("Сотрудники и доступы", "Қызметкерлер және рұқсаттар")}</strong><p>{t("Добавьте преподавателя, методиста и эксперта. При необходимости назначьте первого суперадминистратора с подтверждением своего пароля.", "Оқытушыны, әдіскерді және сарапшыны қосыңыз. Қажет болса, құпиясөзіңізді растап, алғашқы суперәкімшіні тағайындаңыз.")}</p></div><Link href="/settings?tab=users">{t("Открыть пользователей", "Пайдаланушыларды ашу")}</Link></li>
          <li><strong>{t("Организации и представители", "Ұйымдар және өкілдер")}</strong><Link href="/customers">{t("Добавить организацию", "Ұйымды қосу")}</Link></li>
          <li><strong>{t("Программы и содержание", "Бағдарламалар және мазмұн")}</strong><Link href="/lms">{t("Создать программу", "Бағдарлама құру")}</Link></li>
          <li><strong>{t("Ответственные за курсы и группы", "Курстар мен топтарға жауаптылар")}</strong><Link href="/lms/learning-roles">{t("Назначить полномочия", "Өкілеттіктерді тағайындау")}</Link></li>
          <li><strong>{t("Слушатели и назначения", "Тыңдаушылар және тағайындаулар")}</strong><Link href="/lms/assign">{t("Назначить обучение", "Оқуды тағайындау")}</Link></li>
        </ol>
      </section>
    </>
  );
}
