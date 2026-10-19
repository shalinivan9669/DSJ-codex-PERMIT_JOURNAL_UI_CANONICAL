"use client";
import Link from "next/link";
import { canManageLearning, canManageSystem } from "@demo/contracts";
import type { AppContext } from "@/lib/types";
import { LmsHeading, type Translate } from "./common";

export function AdministrativeWorkspace({ context, t }: { context: AppContext; t: Translate }) {
  if (!canManageLearning(context.user.role)) return null;
  const system = canManageSystem(context.user.role);
  return <>
    <LmsHeading title={system ? t("Кабинет суперадминистратора", "Суперәкімші кабинеті") : t("Кабинет администратора", "Әкімші кабинеті")}>
      <Link className="button primary lms-primary" href="/settings?tab=users">{t("Управлять пользователями", "Пайдаланушыларды басқару")}</Link>
    </LmsHeading>
    <section className="panel lms-panel">
      <h2>{context.tenant.name}</h2>
      <ul className="lms-list">
        <li><div><strong>{t("Пользователи и учебные полномочия", "Пайдаланушылар және оқу өкілеттіктері")}</strong><div className="lms-list-meta">{t("Назначения преподавателей, методистов и комиссии", "Оқытушылар, әдіскерлер және комиссия тағайындаулары")}</div></div><Link href="/lms/learning-roles">{t("Управлять полномочиями", "Өкілеттіктерді басқару")}</Link></li>
        <li><strong>{t("Программы и материалы", "Бағдарламалар және материалдар")}</strong><Link href="/lms">{t("Открыть библиотеку", "Кітапхананы ашу")}</Link></li>
        <li><strong>{t("Результаты и документы", "Нәтижелер және құжаттар")}</strong><Link href="/lms/results">{t("Открыть результаты", "Нәтижелерді ашу")}</Link></li>
        <li><strong>{t("Статистика обучения", "Оқу статистикасы")}</strong><Link href="/lms/reports">{t("Открыть отчёты", "Есептерді ашу")}</Link></li>
        {system && <li><strong>{t("Настройки учебного центра", "Оқу орталығының баптаулары")}</strong><Link href="/settings?tab=profile">{t("Открыть настройки", "Баптауларды ашу")}</Link></li>}
        <li><strong>{t("Формы документов", "Құжат нысандары")}</strong><Link href="/settings?tab=templates">{t("Открыть формы", "Нысандарды ашу")}</Link></li>
        {system && <li><strong>{t("Системные настройки и нумерация", "Жүйе баптаулары және нөмірлеу")}</strong><Link href="/settings?tab=numbering">{t("Управлять нумерацией", "Нөмірлеуді басқару")}</Link></li>}
        {system && <li><strong>{t("Журнал действий", "Әрекеттер журналы")}</strong><Link href="/settings?tab=audit">{t("Открыть журнал", "Журналды ашу")}</Link></li>}
      </ul>
    </section>
    <div className="lms-actions">
      <Link href="/lms/applications">{t("Заявки на обучение", "Оқуға өтінімдер")}</Link>
      <Link href="/lms/assign">{t("Люди и назначения", "Адамдар және тағайындаулар")}</Link>
    </div>
  </>;
}
