"use client";
import type { AppContext } from "@/lib/types";
import { Catalogue } from "./catalogue";
import { Assignments } from "./assignments";
import { CourseEditor } from "./course-editor";
import { LearnerCourse, MyCourses } from "./learn";
import { LanguageSwitch, LmsTabs, useLanguage } from "./common";
import { Results } from "./results";
import { Sanitary } from "./sanitary";
import { TrainingGroup } from "./group";
import "./lms.css";

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
  const learner = context.user.role === "LEARNER";
  const employer = context.user.role === "EMPLOYER";
  const canEdit = ["ADMIN", "DIRECTOR", "OPERATOR"].includes(context.user.role);
  const course = /^\/lms\/courses\/([^/]+)$/.exec(pathname);
  const enrollment = /^\/learn\/([^/]+)$/.exec(pathname);
  const group = /^\/lms\/groups\/([^/]+)$/.exec(pathname);
  return (
    <div className="lms-workspace" lang={language === "kz" ? "kk" : "ru"}>
      <div className="lms-toolbar">
        {!learner && <LmsTabs path={pathname} t={t} employer={employer} />}
        <LanguageSwitch language={language} onChange={setLanguage} />
      </div>
      {learner ? (
        enrollment ? (
          <LearnerCourse key={enrollment[1]} id={enrollment[1]} t={t} />
        ) : (
          <MyCourses t={t} />
        )
      ) : group ? (
        <TrainingGroup key={group[1]} id={group[1]} t={t} canEdit={canEdit} />
      ) : course && canEdit ? (
        <CourseEditor key={course[1]} id={course[1]} t={t} />
      ) : pathname === "/lms/assign" ? (
        <Assignments
          t={t}
          scope={`${context.tenant.id}:${context.user.id}`}
          canRepair={canEdit}
        />
      ) : pathname === "/lms/results" ? (
        <Results t={t} context={context} />
      ) : pathname === "/lms/sanitary" && !employer ? (
        <Sanitary t={t} context={context} />
      ) : (
        <Catalogue
          t={t}
          canEdit={canEdit}
          issuer={context.profile?.nameRu || ""}
        />
      )}
    </div>
  );
}
