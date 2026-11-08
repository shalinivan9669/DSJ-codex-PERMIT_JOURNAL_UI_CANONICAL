"use client";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Notice } from "@demo/ui";
import { ApiError } from "@/lib/api";
import { lms, type Course, type Paged } from "@/lib/lms-api";
import { safeLmsReturnTo } from "@/lib/lms-navigation";
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
  const returnTo = safeLmsReturnTo(useSearchParams().get("returnTo"));
  const assignmentReturnTo =
    returnTo && /^\/lms\/assign(?:\?|$)/.test(returnTo) ? returnTo : null;
  const [data, setData] = useState<Paged<Course>>({ items: [], total: 0 });
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [loadError, setLoadError] = useState<unknown>(null);
  const [createError, setCreateError] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [creationCheckPending, setCreationCheckPending] = useState(false);
  const creatingRef = useRef(false);
  const [loadedQuery, setLoadedQuery] = useState<string | null>(null);
  const [refresh, setRefresh] = useState(0);
  const query = JSON.stringify([page, search]);
  const loadNeedsSetup =
    catalogueErrorCode(loadError) === "LMS_DEPLOYMENT_REVIEW_REQUIRED";
  const createNeedsSetup =
    catalogueErrorCode(createError) === "LMS_DEPLOYMENT_REVIEW_REQUIRED";
  const creationUncertain =
    createError instanceof ApiError &&
    (createError.status === 0 || createError.status >= 500);
  const setupMessage = lmsError({ code: "LMS_DEPLOYMENT_REVIEW_REQUIRED" }, t);
  useEffect(() => {
    let alive = true;
    setLoading(true);
    setLoadError(null);
    const timer = setTimeout(() => {
      void lms
        .courses(page, search)
        .then((value) => {
          if (alive) {
            setData(value);
            setLoadedQuery(JSON.stringify([page, search]));
            setLoadError(null);
            setCreationCheckPending(false);
            setCreateError((before: unknown) =>
              catalogueErrorCode(before) === "LMS_DEPLOYMENT_REVIEW_REQUIRED"
                ? null
                : before,
            );
          }
        })
        .catch((caught) => {
          if (alive) setLoadError(caught);
        })
        .finally(() => {
          if (alive) setLoading(false);
        });
    }, 180);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [page, search, refresh]);
  function reload(resetSearch = false) {
    if (creatingRef.current || loading) return;
    setLoading(true);
    if (resetSearch || creationCheckPending) {
      setSearch("");
      setPage(1);
    }
    setRefresh((value) => value + 1);
  }
  async function create() {
    if (
      creatingRef.current ||
      loading ||
      creationCheckPending ||
      !canCreate ||
      loadNeedsSetup ||
      createNeedsSetup
    )
      return;
    creatingRef.current = true;
    setCreating(true);
    setCreateError(null);
    try {
      const value = await lms.createCourse(emptyCourse(), emptyProfile(issuer));
      router.push(`/lms/courses/${value.course.id}`);
    } catch (caught) {
      setCreateError(caught);
      setCreationCheckPending(
        caught instanceof ApiError &&
          (caught.status === 0 || caught.status >= 500) &&
          catalogueErrorCode(caught) !== "LMS_DEPLOYMENT_REVIEW_REQUIRED",
      );
      creatingRef.current = false;
      setCreating(false);
    }
  }
  return (
    <>
      <LmsHeading title={t("Программы обучения", "Оқу бағдарламалары")}>
        {assignmentReturnTo && (
          <Link className="button" href={assignmentReturnTo}>
            {t("Вернуться к назначению", "Тағайындауға оралу")}
          </Link>
        )}
        {canCreate && (
          <button
            className="primary lms-primary"
            disabled={
              loading ||
              creating ||
              creationCheckPending ||
              loadNeedsSetup ||
              createNeedsSetup
            }
            onClick={() => void create()}
          >
            {creating
              ? t("Создаём программу…", "Бағдарлама жасалуда…")
              : t("Создать программу", "Бағдарлама жасау")}
          </button>
        )}
      </LmsHeading>
      {!!createError && !(createNeedsSetup && loadNeedsSetup) && (
        <Notice>
          <strong>
            {createNeedsSetup
              ? t(
                  "Создание программ пока недоступно",
                  "Бағдарлама жасау әзірге қолжетімсіз",
                )
              : creationUncertain
                ? t(
                    "Не удалось подтвердить создание программы",
                    "Бағдарламаның жасалғанын растау мүмкін болмады",
                  )
                : t(
                    "Не удалось создать программу",
                    "Бағдарлама жасау мүмкін болмады",
                  )}
          </strong>
          <p>
            {createNeedsSetup
              ? setupMessage
              : creationUncertain
                ? t(
                    "Программа могла сохраниться. Обновите список и проверьте его перед новым созданием.",
                    "Бағдарлама сақталған болуы мүмкін. Жаңасын жасамас бұрын тізімді жаңартып, тексеріңіз.",
                  )
                : lmsError(createError, t)}
          </p>
          <LmsErrorDiagnostic error={createError} t={t} />
          <button
            type="button"
            disabled={loading || creating}
            onClick={() => reload(creationCheckPending)}
          >
            {createNeedsSetup
              ? t("Проверить доступ", "Қолжетімділікті тексеру")
              : t("Обновить список программ", "Бағдарламалар тізімін жаңарту")}
          </button>
        </Notice>
      )}
      <section className="panel lms-panel" aria-busy={loading}>
        <div className="lms-toolbar">
          <label>
            {t("Найти курс", "Курсты табу")}
            <input
              type="search"
              disabled={creating || creationCheckPending}
              value={search}
              onChange={(e) => {
                setLoading(true);
                setSearch(e.target.value);
                setPage(1);
              }}
            />
          </label>
        </div>
        {!!loadError && (
          <Notice>
            <strong>
              {loadNeedsSetup
                ? t(
                    "Доступ к программам пока закрыт",
                    "Бағдарламаларға қолжетімділік әзірге жабық",
                  )
                : t(
                    "Не удалось загрузить программы",
                    "Бағдарламаларды жүктеу мүмкін болмады",
                  )}
            </strong>
            <p>
              {loadNeedsSetup
                ? setupMessage
                : loadError instanceof ApiError && loadError.status === 403
                  ? t(
                      "Нет доступа к списку программ. Обратитесь к администратору центра.",
                      "Бағдарламалар тізіміне қолжетімділік жоқ. Орталық әкімшісіне хабарласыңыз.",
                    )
                  : loadError instanceof ApiError && loadError.status === 401
                    ? t(
                        "Сеанс завершён. Войдите снова, чтобы открыть программы.",
                        "Сеанс аяқталды. Бағдарламаларды ашу үшін қайта кіріңіз.",
                      )
                    : loadError instanceof ApiError && loadError.status === 0
                      ? t(
                          "Нет связи с сервером. Проверьте соединение и повторите загрузку списка.",
                          "Сервермен байланыс жоқ. Байланысты тексеріп, тізімді қайта жүктеңіз.",
                        )
                      : loadError instanceof ApiError &&
                          loadError.status === 429
                        ? t(
                            "Слишком частые запросы. Подождите немного и повторите загрузку.",
                            "Сұраулар тым жиі жіберілді. Біраз күтіп, қайта жүктеңіз.",
                          )
                        : t(
                            "Список временно недоступен. Повторите загрузку.",
                            "Тізім уақытша қолжетімсіз. Қайта жүктеңіз.",
                          )}
            </p>
            <LmsErrorDiagnostic error={loadError} t={t} />
            <button
              type="button"
              disabled={loading || creating}
              onClick={() => reload()}
            >
              {loadNeedsSetup
                ? t("Проверить доступ", "Қолжетімділікті тексеру")
                : t("Повторить загрузку", "Қайта жүктеу")}
            </button>
          </Notice>
        )}
        {loading && (
          <p role="status" aria-live="polite">
            {t("Загружаем программы…", "Бағдарламалар жүктелуде…")}
          </p>
        )}
        {!!data.items.length &&
          (loading || !!loadError || loadedQuery !== query) && (
            <p className="lms-save-state">
              {t(
                "Пока показан ранее загруженный список.",
                "Әзірге бұрын жүктелген тізім көрсетілген.",
              )}
            </p>
          )}
        <ul className="lms-list">
          {data.items.map((course) => {
            const version = course.latestVersion || course.versions?.[0];
            const published =
              course.publishedVersion ||
              (version?.status === "PUBLISHED" ? version : null);
            const canOpenEditor = course.allowedActions
              ? course.allowedActions.some((action) =>
                  ["edit", "publish", "submitReview"].includes(action),
                )
              : canEdit;
            const canAssign =
              course.allowedActions?.includes("assign") &&
              !!published &&
              !course.assignmentPaused;
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
                    {version.content.metadata?.durationDays && (
                      <span>
                        {t("Продолжительность", "Ұзақтығы")}:{" "}
                        {version.content.metadata.durationDays}{" "}
                        {t("дней", "күн")}
                      </span>
                    )}
                    <span>
                      {t("Версия", "Нұсқа")} {version.version}
                    </span>
                  </div>
                  {published && published.id !== version.id && (
                    <p className="lms-save-state">
                      {t(
                        "Для назначения: опубликованная версия",
                        "Тағайындау үшін: жарияланған нұсқа",
                      )}{" "}
                      {published.version}
                    </p>
                  )}
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
                  {course.allowedActions?.includes("publish") && (
                    <PublicityEditor courseId={course.id} t={t} />
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
                {canAssign ? (
                  <Link
                    className="button"
                    href={`/lms/assign?versionId=${published!.id}`}
                  >
                    {t("Назначить обучение", "Оқуды тағайындау")}
                  </Link>
                ) : canOpenEditor ? (
                  <Link className="button" href={`/lms/courses/${course.id}`}>
                    {t("Продолжить подготовку", "Дайындауды жалғастыру")}
                  </Link>
                ) : null}
              </li>
            );
          })}
        </ul>
        {!data.items.length &&
          !loading &&
          !loadError &&
          loadedQuery === query && (
            <p className="lms-empty">
              {search
                ? t(
                    "Программы не найдены. Измените поиск.",
                    "Бағдарламалар табылмады. Іздеуді өзгертіңіз.",
                  )
                : canCreate
                  ? t(
                      "Программ пока нет. Создайте первую.",
                      "Бағдарламалар әзірге жоқ. Алғашқысын жасаңыз.",
                    )
                  : t(
                      "Нет доступных программ. Обратитесь к администратору.",
                      "Қолжетімді бағдарламалар жоқ. Әкімшіге хабарласыңыз.",
                    )}
            </p>
          )}
        {!loading &&
          !loadError &&
          !creating &&
          !creationCheckPending &&
          loadedQuery === query && (
            <PageControls
              page={page}
              total={data.total}
              pageSize={data.pageSize || 50}
              onPage={(value) => {
                setLoading(true);
                setPage(value);
              }}
              t={t}
            />
          )}
      </section>
    </>
  );
}

function catalogueErrorCode(error: unknown) {
  const details = error instanceof ApiError ? error.details : error;
  return details && typeof details === "object" && "code" in details
    ? String(details.code || "")
    : "";
}
