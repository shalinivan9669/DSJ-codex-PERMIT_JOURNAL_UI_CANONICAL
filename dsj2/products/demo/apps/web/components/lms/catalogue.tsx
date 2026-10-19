"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Notice } from "@demo/ui";
import { lms, type Course, type Paged } from "@/lib/lms-api";
import { emptyCourse, emptyProfile } from "./course-editor";
import { PublicityEditor } from "./public-catalogue";
import {
  LmsHeading,
  PageControls,
  Status,
  LmsErrorDiagnostic,
  lmsError,
  type Translate,
} from "./common";

export function Catalogue({
  t,
  canEdit,
  canCreate = canEdit,
  issuer = "",
}: {
  t: Translate;
  canEdit: boolean;
  canCreate?: boolean;
  issuer?: string;
}) {
  const router = useRouter();
  const [data, setData] = useState<Paged<Course>>({ items: [], total: 0 });
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    let alive = true;
    const timer = setTimeout(() => {
      setBusy(true);
      void lms
        .courses(page, search)
        .then((value) => {
          if (alive) {
            setData(value);
            setError(null);
          }
        })
        .catch((caught) => {
          if (alive) setError(caught);
        })
        .finally(() => {
          if (alive) setBusy(false);
        });
    }, 180);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [page, search, refresh]);
  async function create() {
    if (busy || !canCreate) return;
    setBusy(true);
    setError(null);
    try {
      const value = await lms.createCourse(emptyCourse(), emptyProfile(issuer));
      router.push(`/lms/courses/${value.course.id}`);
    } catch (caught) {
      setError(caught);
      setBusy(false);
    }
  }
  return (
    <>
      <LmsHeading title={t("Программы обучения", "Оқу бағдарламалары")}>
        {canCreate && (
          <button
            className="primary lms-primary"
            disabled={busy}
            onClick={() => void create()}
          >
            {t("Создать программу", "Бағдарлама жасау")}
          </button>
        )}
      </LmsHeading>
      {!!error && (
        <Notice>
          {lmsError(error, t)}
          <LmsErrorDiagnostic error={error} t={t} />
          <button onClick={() => setRefresh((v) => v + 1)}>
            {t("Повторить", "Қайталау")}
          </button>
        </Notice>
      )}
      <section className="panel lms-panel" aria-busy={busy}>
        <div className="lms-toolbar">
          <label>
            {t("Найти курс", "Курсты табу")}
            <input
              type="search"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
            />
          </label>
        </div>
        <ul className="lms-list">
          {data.items.map((course) => {
            const version = course.latestVersion || course.versions?.[0];
            const published = course.publishedVersion || (version?.status === "PUBLISHED" ? version : null);
            const canOpenEditor = course.allowedActions
              ? course.allowedActions.some((action) => ["edit", "publish", "submitReview"].includes(action))
              : canEdit;
            const canAssign = course.allowedActions?.includes("assign") && !!published && !course.assignmentPaused;
            if (!version) return null;
            return (
              <li key={course.id}>
                <div>
                  <Link
                    className="lms-list-title"
                    href={
                      canOpenEditor
                        ? `/lms/courses/${course.id}`
                        : canAssign
                          ? `/lms/assign?versionId=${published!.id}`
                          : `/lms/courses/${course.id}`
                    }
                  >
                    {t(version.content.titleRu, version.content.titleKz)}
                  </Link>
                  <div className="lms-list-meta">
                    <Status value={version.status} t={t} />
                    <span>
                      {version.content.hours} {t("ч.", "сағ.")}
                    </span>
                    {version.content.metadata?.durationDays && <span>{t("Продолжительность", "Ұзақтығы")}: {version.content.metadata.durationDays} {t("дней", "күн")}</span>}
                    <span>
                      {t("Версия", "Нұсқа")} {version.version}
                    </span>
                  </div>
                  {published && published.id !== version.id && <p className="lms-save-state">{t("Для назначения доступна опубликованная версия", "Тағайындау үшін жарияланған нұсқа қолжетімді")} {published.version}</p>}
                  <details>
                    <summary>{t("Условия обучения", "Оқу шарттары")}</summary>
                    <p>
                      {t("Доступ", "Қолжетімділік")}:{" "}
                      {version.content.accessDays} {t("дней", "күн")} ·{" "}
                      <Status value={version.profile.assessmentKind} t={t} /> ·{" "}
                      <Status value={version.profile.status} t={t} />
                    </p>
                  </details>
                  {course.assignmentPaused && (
                    <p>
                      {t(
                        "Новые назначения приостановлены",
                        "Жаңа тағайындаулар тоқтатылған",
                      )}
                      {course.assignmentPauseReason
                        ? `: ${course.assignmentPauseReason}`
                        : ""}
                    </p>
                  )}
                  {course.allowedActions?.includes("publish") && <PublicityEditor courseId={course.id} t={t} />}
                  {course.currentReview &&
                    course.currentReview.status !== "CURRENT" && (
                      <p>
                        <Link href={`/lms/courses/${course.id}`}>
                          {t(
                            "Нужно актуализировать основание",
                            "Негізді өзектендіру қажет",
                          )}
                        </Link>
                      </p>
                    )}
                </div>
                {canAssign ? (
                  <Link
                    className="button"
                    href={`/lms/assign?versionId=${published!.id}`}
                  >
                    {t("Назначить обучение", "Оқуды тағайындау")}
                  </Link>
                ) : canOpenEditor ? <Link className="button" href={`/lms/courses/${course.id}`}>{t("Продолжить подготовку", "Дайындауды жалғастыру")}</Link> : null}
              </li>
            );
          })}
        </ul>
        {!data.items.length && !busy && !error && (
          <p className="lms-empty">
            {search ? t("Программы не найдены. Измените поиск.", "Бағдарламалар табылмады. Іздеуді өзгертіңіз.") : canCreate ? t("Создайте программу: сведения, содержание и условия прохождения.", "Бағдарлама жасаңыз: мәліметтер, мазмұн және өту шарттары.") : t("Администратор назначит вам программу или опубликует её для обучения.", "Әкімші сізге бағдарламаны бекітеді немесе оны оқу үшін жариялайды.")}
          </p>
        )}
        <PageControls
          page={page}
          total={data.total}
          pageSize={data.pageSize || 50}
          onPage={setPage}
          t={t}
        />
      </section>
    </>
  );
}
