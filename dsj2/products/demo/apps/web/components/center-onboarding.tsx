"use client";
import Link from "next/link";
import { useState } from "react";
import { Notice } from "@demo/ui";
import { canManageCenter } from "@demo/contracts";
import type { AppContext } from "@/lib/types";
import { ProfileForm, Templates } from "./settings";
import "./center-onboarding.css";

export function CenterOnboarding({
  context,
  onContextChange,
}: {
  context: AppContext;
  onContextChange: (context: AppContext) => void;
}) {
  const [step, setStep] = useState<"profile" | "templates">("profile");
  if (!canManageCenter(context.user.role))
    return (
      <Notice kind="info">
        Данные и формы центра настраивает директор.{" "}
        <Link href="/requests/new">Создать черновик заявки</Link>
      </Notice>
    );
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>Подготовим ваш центр к работе</h1>
          <p>
            Сведения вводятся один раз и подставляются в документы. Изменить их
            можно позже в настройках.
          </p>
        </div>
      </div>
      <nav className="center-setup-steps" aria-label="Подготовка центра">
        <button
          aria-current={step === "profile" ? "step" : undefined}
          onClick={() => setStep("profile")}
        >
          <span>1</span> Реквизиты и люди
        </button>
        <button
          aria-current={step === "templates" ? "step" : undefined}
          onClick={() => setStep("templates")}
        >
          <span>2</span> Проверить формы
        </button>
        <Link className="button" href="/requests/new">
          <span>3</span> Первая заявка
        </Link>
      </nav>
      <Notice kind="info">
        Черновик заявки можно начать сейчас. Перед оформлением документов
        подтвердите реквизиты центра и используемые формы.
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
          <button onClick={() => setStep("templates")}>Перейти к формам</button>
        )}
        <Link className="button" href="/requests/new">
          Начать черновик заявки
        </Link>
        <Link href="/settings">Все настройки центра</Link>
      </div>
    </>
  );
}
