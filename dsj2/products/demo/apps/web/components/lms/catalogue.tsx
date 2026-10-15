"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Notice } from "@demo/ui";
import { lms, type Course, type Paged } from "@/lib/lms-api";
import { emptyCourse, emptyProfile } from "./course-editor";
import {
  LmsHeading,
  PageControls,
  Status,
  lmsError,
  type Translate,
} from "./common";

export function Catalogue({
  t,
  canEdit,
  issuer = "",
}: {
  t: Translate;
  canEdit: boolean;
  issuer?: string;
}) {
  const router = useRouter();
  const [data, setData] = useState<Paged<Course>>({ items: [], total: 0 });
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [error, setError] = useState("");
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
            setError("");
          }
        })
        .catch((caught) => {
          if (alive) setError(lmsError(caught, t));
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
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const value = await lms.createCourse(emptyCourse(), emptyProfile(issuer));
      router.push(`/lms/courses/${value.course.id}`);
    } catch (caught) {
      setError(lmsError(caught, t));
      setBusy(false);
    }
  }
  return (
    <>
      <LmsHeading title={t("Курсы", "Курстар")}>
        {canEdit && (
          <button
            className="primary lms-primary"
            disabled={busy}
            onClick={() => void create()}
          >
            {t("Создать курс", "Курс жасау")}
          </button>
        )}
      </LmsHeading>
      {error && (
        <Notice>
          {error}
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
            if (!version) return null;
            return (
              <li key={course.id}>
                <div>
                  <Link
                    className="lms-list-title"
                    href={
                      canEdit
                        ? `/lms/courses/${course.id}`
                        : `/lms/assign?versionId=${version.id}`
                    }
                  >
                    {t(version.content.titleRu, version.content.titleKz)}
                  </Link>
                  <div className="lms-list-meta">
                    <Status value={version.status} t={t} />
                    <span>
                      {version.content.hours} {t("ч.", "сағ.")}
                    </span>
                    <span>
                      {t("Версия", "Нұсқа")} {version.version}
                    </span>
                  </div>
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
                {version.status === "PUBLISHED" && !course.assignmentPaused && (
                  <Link
                    className="button"
                    href={`/lms/assign?versionId=${version.id}`}
                  >
                    {t("Назначить", "Тағайындау")}
                  </Link>
                )}
              </li>
            );
          })}
        </ul>
        {!data.items.length && !busy && !error && (
          <p className="lms-empty">
            {t("Курсов пока нет.", "Курстар әлі жоқ.")}
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
