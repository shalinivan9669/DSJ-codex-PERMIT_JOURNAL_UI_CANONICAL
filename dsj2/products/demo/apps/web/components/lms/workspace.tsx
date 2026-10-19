"use client";
import Link from "next/link";
import { canAuthorPrograms, canManageLearning, isLmsStaffRole } from "@demo/contracts";
import type { AppContext } from "@/lib/types";
import { workspaceStartPath } from "@/lib/user-roles";
import { Catalogue } from "./catalogue";
import { RegulatoryCatalogue } from "./regulatory-catalogue";
import { Assignments } from "./assignments";
import { CourseEditor } from "./course-editor";
import { LearnerCourse, MyCourses } from "./learn";
import { LanguageSwitch, useLanguage } from "./common";
import { Results } from "./results";
import { Sanitary } from "./sanitary";
import { TrainingGroup } from "./group";
import { TeacherWorkspace } from "./teacher-workspace";
import { LearningRoleBindings } from "./learning-role-bindings";
import { LearningCalendar } from "./teaching-calendar";
import { EmployerImport } from "./employer-import";
import { LmsProfile } from "./profile";
import { WorkspaceCompanion } from "./workplace";
import { Reports } from "./reports";
import { Applications } from "./applications";
import { LearningInbox } from "./notifications";
import { AdministrativeWorkspace } from "./role-home";
import { CommissionWorkspace } from "./commission";
import { OwnLearningRecords } from "./learner-records";
import { QuestionBankWorkspace } from "./question-bank-workspace";
import "./lms.css";
import "./author.css";

export function LmsWorkspace({
  context,
  pathname,
}: {
  context: AppContext;
  pathname: string;
}) {
  const { language, setLanguage, t } = useLanguage(
    `${context.tenant.id}:${context.user.id}`,
  );
  const role = context.user.role;
  const employer = role === "EMPLOYER";
  const viewer = role === "VIEWER";
  const canOperate = isLmsStaffRole(role);
  const canAssign = canOperate || (employer && context.user.canAssignTraining === true);
  const canManage = canManageLearning(role);
  const canAuthor = canAuthorPrograms(role);
  const administrative = ["ADMIN", "SUPER_ADMIN"].includes(role);
  const learningRoles = new Set([role, ...(context.user.learningRoles || [])]);
  const teacher = learningRoles.has("TEACHER");
  const expert = learningRoles.has("EXPERT");
  const methodist = learningRoles.has("METHODIST");
  const canReview = canManage || teacher || expert;
  const canReadCourses = canOperate || canAuthor || teacher || expert || methodist;
  const canSchedule = canManage || teacher;
  const canReadResults = canOperate || teacher || expert || employer;
  const canReadReports = canReadResults || viewer;
  const learnerView = pathname.startsWith("/learn");
  const commissionView = role === "EXPERT" || (expert && !teacher && !canManage);
  const course = /^\/lms\/courses\/([^/]+)$/.exec(pathname);
  const enrollment = /^\/learn\/([^/]+)$/.exec(pathname);
  const group = /^\/lms\/groups\/([^/]+)$/.exec(pathname);
  const tabs: [string, string][] = learnerView
    ? [["/learn", t("Моё обучение", "Менің оқуым")], ["/learn/tests", t("Мои тесты", "Менің тесттерім")], ["/learn/results", t("Мои результаты", "Менің нәтижелерім")], ["/learn/documents", t("Мои документы", "Менің құжаттарым")], ["/learn/applications", t("Мои заявки", "Менің өтінімдерім")], ["/learn/calendar", t("Календарь", "Күнтізбе")]]
    : employer
      ? [["/portal", t("Моя организация", "Менің ұйымым")], ["/lms/applications", t("Заявки", "Өтінімдер")], ...(canAssign ? [["/lms/assign", t("Сотрудники и назначения", "Қызметкерлер және тағайындаулар")] as [string, string]] : []), ["/lms/results", t("Результаты и документы", "Нәтижелер және құжаттар")]]
      : administrative
        ? [["/lms/workplace", t("Администрирование", "Әкімшілендіру")], ["/lms", t("Программы", "Бағдарламалар")], ["/lms/results", t("Результаты и документы", "Нәтижелер және құжаттар")]]
        : canOperate
          ? [["/lms/workplace", t("Рабочий кабинет", "Жұмыс кабинеті")], ["/lms/applications", t("Заявки на обучение", "Оқуға өтінімдер")], ["/lms/assign", t("Люди и назначения", "Адамдар және тағайындаулар")], ["/lms", t("Программы", "Бағдарламалар")], ["/lms/results", t("Результаты и документы", "Нәтижелер және құжаттар")]]
          : role === "METHODIST" || (methodist && !teacher && !expert)
            ? [["/lms", t("Мои программы", "Менің бағдарламаларым")], ...(canReview ? [["/lms/teaching", t("Проверка работ", "Жұмыстарды тексеру")] as [string, string]] : [])]
            : commissionView
              ? [["/lms/teaching", t("Кабинет комиссии", "Комиссия кабинеті")], ["/lms/results", t("Результаты аттестации", "Аттестаттау нәтижелері")], ["/lms/commission", t("Протоколы и подпись", "Хаттамалар және қол қою")]]
              : teacher
                ? [["/lms/teaching", t("Мои группы и работы", "Топтарым және жұмыстарым")], ["/lms/calendar", t("Вебинары и занятия", "Вебинарлар және сабақтар")], ["/lms/results", t("Результаты", "Нәтижелер")], ["/lms", t("Мои курсы", "Менің курстарым")]]
                : viewer ? [["/lms/reports", t("Обзор обучения", "Оқу шолуы")]] : [["/learn", t("Моё обучение", "Менің оқуым")]];
  const unavailable = <section className="panel lms-panel"><p>{t("Раздел недоступен для вашей роли.", "Бұл бөлім рөліңізге қолжетімсіз.")}</p><Link href={workspaceStartPath(role)}>{t("В мой кабинет", "Менің кабинетіме")}</Link></section>;
  return (
    <div className="lms-workspace" lang={language === "kz" ? "kk" : "ru"}>
      <div className="lms-task-navigation">
        <nav className="lms-tabs" aria-label={t("Задачи обучения", "Оқу міндеттері")}>
          {tabs.map(([href, label]) => <Link key={href} href={href} aria-current={pathname === href || (href === "/lms" && !!course) || (href === "/lms/assign" && (!!group || pathname === "/lms/import")) || (href === "/lms/teaching" && !!group && !canOperate) ? "page" : undefined}>{label}</Link>)}
        </nav>
        <div className="lms-actions lms-task-utilities">
          <Link href={learnerView ? "/learn/notifications" : "/lms/notifications"}>{t("Уведомления", "Хабарламалар")}</Link>
          <details className="lms-tools" onKeyDown={event => { if (event.key === "Escape") { event.currentTarget.open = false; event.currentTarget.querySelector("summary")?.focus(); } }}>
            <summary>{t("Ещё", "Тағы")}</summary>
            <nav aria-label={t("Дополнительные инструменты", "Қосымша құралдар")} onClick={event => { if ((event.target as HTMLElement).closest("a")) event.currentTarget.parentElement?.removeAttribute("open"); }}>
              {canSchedule && !learnerView && <Link href="/lms/calendar">{t("Расписание", "Кесте")}</Link>}
              {canReview && !learnerView && !tabs.some(([href]) => href === "/lms/teaching") && <Link href="/lms/teaching">{t("Проверка работ", "Жұмыстарды тексеру")}</Link>}
              {(canManage || expert) && !learnerView && !tabs.some(([href]) => href === "/lms/commission") && <Link href="/lms/commission">{t("Протоколы и подпись", "Хаттамалар және қол қою")}</Link>}
              {canReadReports && !learnerView && !viewer && <Link href="/lms/reports">{t("Отчёты", "Есептер")}</Link>}
              {canManage && !learnerView && <Link href="/lms/learning-roles">{t("Учебные полномочия", "Оқу өкілеттіктері")}</Link>}
              {(canManage || role === "METHODIST" || expert) && !learnerView && <Link href="/lms/regulatory">{t("Нормативная база", "Нормативтік база")}</Link>}
              {canAuthor && !learnerView && <Link href="/lms/questions">{t("Банк вопросов", "Сұрақтар банкі")}</Link>}
              {canOperate && !learnerView && <Link href="/lms/sanitary">{t("Санитарные результаты", "Санитариялық нәтижелер")}</Link>}
              {canManage && !learnerView && <Link href="/settings?tab=users">{t("Пользователи и настройки", "Пайдаланушылар және баптаулар")}</Link>}
              <Link href={learnerView ? "/learn/profile" : "/lms/profile"}>{t("Профиль", "Профиль")}</Link>
            </nav>
          </details>
          <LanguageSwitch language={language} onChange={setLanguage} />
        </div>
      </div>
      {pathname === "/lms/notifications" ||
      pathname === "/learn/notifications" ? (
        <LearningInbox
          t={t}
          timezone={context.tenant.timezone || "Asia/Qyzylorda"}
        />
      ) : pathname === "/lms/applications" ||
        pathname === "/learn/applications" ? (
        learnerView || canOperate || employer ? <Applications context={context} t={t} /> : unavailable
      ) : pathname === "/lms/import" && canAssign ? (
        <EmployerImport
          t={t}
          scope={`${context.tenant.id}:${context.user.id}`}
        />
      ) : pathname === "/lms/profile" || pathname === "/learn/profile" ? (
        <LmsProfile t={t} scope={`${context.tenant.id}:${context.user.id}`} />
      ) : pathname === "/lms/workplace" || pathname === "/learn/workplace" ? (
        administrative && !learnerView ? <AdministrativeWorkspace context={context} t={t} /> : learnerView || canOperate || employer ? <WorkspaceCompanion t={t} learner={learnerView} employer={employer} canManage={canOperate} canAssign={canAssign} /> : unavailable
      ) : pathname === "/lms/reports" && canReadReports ? (
        <Reports t={t} context={context} />
      ) : pathname === "/learn/calendar" || (pathname === "/lms/calendar" && (canSchedule || employer)) ? (
        <LearningCalendar t={t} />
      ) : pathname === "/lms/learning-roles" && canManage ? (
        <LearningRoleBindings t={t} canManageAccounts={canManage} />
      ) : pathname === "/lms/regulatory" && (canManage || role === "METHODIST" || expert) ? (
        <RegulatoryCatalogue t={t} />
      ) : pathname === "/lms/questions" && canAuthor ? (
        <QuestionBankWorkspace t={t} />
      ) : pathname === "/lms/commission" && (canManage || expert) ? (
        <CommissionWorkspace context={context} />
      ) : pathname === "/lms/teaching" && canReview ? (
        <TeacherWorkspace key={`${context.user.id}:${commissionView ? "expert" : "teacher"}`} t={t} mode={commissionView ? "expert" : "teacher"} canManageRoles={canManage} />
      ) : pathname === "/learn/results" || pathname === "/learn/documents" || pathname === "/learn/tests" ? (
        <OwnLearningRecords key={pathname} t={t} view={pathname === "/learn/results" ? "results" : pathname === "/learn/documents" ? "documents" : "tests"} />
      ) : learnerView ? (
        enrollment ? (
          <LearnerCourse key={enrollment[1]} id={enrollment[1]} t={t} />
        ) : (
          <MyCourses t={t} />
        )
      ) : group && canReadResults ? (
        <TrainingGroup key={group[1]} id={group[1]} t={t} canEdit={canOperate} />
      ) : course && canReadCourses ? (
        <CourseEditor key={course[1]} id={course[1]} t={t} />
      ) : pathname === "/lms/assign" && canAssign ? (
        <Assignments
          t={t}
          scope={`${context.tenant.id}:${context.user.id}`}
          canRepair={canOperate}
        />
      ) : pathname === "/lms/results" && canReadResults ? (
        <Results t={t} context={context} />
      ) : pathname === "/lms/sanitary" && canOperate ? (
        <Sanitary t={t} context={context} />
      ) : pathname === "/lms" && canReadCourses ? (
        <Catalogue
          t={t}
          canEdit={canManage}
          canCreate={canAuthor}
          issuer={context.profile?.nameRu || ""}
        />
      ) : unavailable}
    </div>
  );
}
