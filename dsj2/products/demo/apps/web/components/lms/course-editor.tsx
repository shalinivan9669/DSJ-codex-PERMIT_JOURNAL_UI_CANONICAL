"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Notice } from "@demo/ui";
import {
  courseContentSchema,
  regulatoryProfileSchema,
  type CourseContent,
  type LmsLesson,
  type RegulatoryProfile,
} from "@demo/contracts/src/lms";
import {
  ApiError,
  api,
  json,
  BEFORE_LOGOUT_EVENT,
  NavigationBlockedError,
} from "@/lib/api";
import { AutosaveLane } from "@/lib/autosave";
import { lms, type CourseVersion, type Course } from "@/lib/lms-api";
import {
  LmsErrorDiagnostic,
  LmsHeading,
  Status,
  lmsError,
  type Translate,
} from "./common";
import { useLmsSaveNavigation } from "./use-save-navigation";
import type { CalendarVersion } from "./sanitary-settings";
import { AssessmentAuthor } from "./assessment-author";
import { LessonAuthor } from "./lesson-author";
import { CourseLearningSettings } from "./course-learning-settings";
import { CourseAvailability, regulatoryStates } from "./course-availability";
import { SourcePicker } from "./source-library";

export const emptyCourse = () =>
  courseContentSchema.parse({
    titleRu: "Новый курс",
    titleKz: "Жаңа курс",
    modules: [],
    exam: { questions: [], questionCount: 1 },
  });
export const emptyProfile = (issuer = "") =>
  regulatoryProfileSchema.parse({ title: "Новое основание", issuer });
type Draft = { content: CourseContent; profile: RegulatoryProfile };
type AuthorVersion = CourseVersion & {
  allowedActions?: string[];
  review?: {
    state: string;
    contentHash: string;
    revision: number;
    feedback: string;
  } | null;
};
export function CourseEditor({ id, t }: { id: string; t: Translate }) {
  const [version, setVersion] = useState<AuthorVersion | null>(null);
  const [versions, setVersions] = useState<CourseVersion[]>([]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [course, setCourse] = useState<Course | null>(null);
  const [undo, setUndo] = useState<Draft[]>([]);
  const [deletion, setDeletion] = useState<{
    moduleId: string;
    lessonId?: string;
    choices: Record<string, string>;
  } | null>(null);
  const [showValidation, setShowValidation] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [saveState, setSaveState] = useState("saved");
  const [busy, setBusy] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [calendars, setCalendars] = useState<CalendarVersion[]>([]);
  const [recovery, setRecovery] = useState<Draft | null>(null);
  const [reviewFeedback, setReviewFeedback] = useState("");
  const [dependencyBlocked, setDependencyBlocked] = useState(false);
  const [preview, setPreview] = useState(false);
  const [demoOnly, setDemoOnly] = useState(false);
  const [section, setSection] = useState<"overview" | "modules" | "exam" | "settings" | "review">("overview");
  const [dragged, setDragged] = useState<{
    moduleId: string;
    lessonId?: string;
  } | null>(null);
  const lane = useRef<AutosaveLane<Draft> | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const loadRequest = useRef(0);
  useLmsSaveNavigation(
    id,
    () => !!lane.current?.dirty,
    () => lane.current?.flush() || Promise.resolve(),
    (caught) => setError(caught),
  );
  function install(value: AuthorVersion) {
    const next = { content: value.content, profile: value.profile };
    setVersion(value);
    setDraft(next);
    setError(null);
    setConflict(false);
    setSaveState("saved");
    setUndo([]);
    setDeletion(null);
    setShowValidation(false);
    lane.current = new AutosaveLane(
      next,
      value.revision,
      async (snapshot, revision) => {
        try {
          const saved = await lms.saveVersion(
            value.id,
            revision,
            snapshot.content,
            snapshot.profile,
          );
          setVersion((current) =>
            current?.id === saved.id
              ? {
                  ...current,
                  review: saved.review,
                  allowedActions: saved.allowedActions,
                  publicationIssues: saved.publicationIssues,
                }
              : current,
          );
          return saved;
        } catch (caught) {
          if (caught instanceof ApiError && caught.status === 409) {
            lane.current?.pause(caught);
            setConflict(true);
          }
          throw caught;
        }
      },
      (state, revision, caught) => {
        setSaveState(state);
        setVersion((current) => (current ? { ...current, revision } : current));
        if (caught) setError(caught);
        else if (state === "saved") {
          setError(null);
          try {
            sessionStorage.removeItem(`lms-author-draft:${id}`);
          } catch {
            /* Optional local recovery; the server remains the source of truth. */
          }
        }
      },
    );
  }
  async function load() {
    const request = ++loadRequest.current;
    try {
      const data = await lms.course(id);
      if (request !== loadRequest.current) return;
      setCourse(data.course);
      setDemoOnly(data.demoOnly === true);
      setVersions(data.versions);
      const latest =
        data.versions.find((v) => v.status === "DRAFT") || data.versions[0];
      if (latest) {
        install(latest);
        try {
          const stored = sessionStorage.getItem(`lms-author-draft:${id}`);
          if (stored) {
            const cache = JSON.parse(stored) as {
              versionId: string;
              draft: Draft;
            };
            if (cache.versionId === latest.id)
              setRecovery({
                content: courseContentSchema.parse(cache.draft.content),
                profile: regulatoryProfileSchema.parse(cache.draft.profile),
              });
          }
        } catch {
          /* Optional local recovery; the server remains the source of truth. */
        }
      }
    } catch (caught) {
      if (request === loadRequest.current) setError(caught);
    }
  }
  useEffect(() => {
    void load();
    void api<CalendarVersion[]>("/lms/sanitary/calendars")
      .then(setCalendars)
      .catch(() => {});
    return () => {
      loadRequest.current += 1;
      if (timer.current) clearTimeout(timer.current);
    };
  }, [id]);
  useEffect(() => {
    const leave = (event: BeforeUnloadEvent) => {
      if (lane.current?.dirty) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    const logout = (event: Event) => {
      (
        event as CustomEvent<{ waitUntil: (p: Promise<unknown>) => void }>
      ).detail.waitUntil(
        lane.current?.flush().catch(() => {
          throw new NavigationBlockedError();
        }) || Promise.resolve(),
      );
    };
    window.addEventListener("beforeunload", leave);
    window.addEventListener(BEFORE_LOGOUT_EVENT, logout);
    return () => {
      window.removeEventListener("beforeunload", leave);
      window.removeEventListener(BEFORE_LOGOUT_EVENT, logout);
    };
  }, []);
  function edit(next: Draft, remember = true) {
    setDependencyBlocked(false);
    if (draft && remember)
      setUndo((previous) => [...previous.slice(-49), structuredClone(draft)]);
    setDraft(next);
    setVersion((current) => (current ? { ...current, review: null } : current));
    try {
      sessionStorage.setItem(
        `lms-author-draft:${id}`,
        JSON.stringify({ versionId: version?.id, draft: next }),
      );
    } catch {
      /* Optional local recovery; the server remains the source of truth. */
    }
    lane.current?.edit(next);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(
      () => void lane.current?.flush().catch(() => {}),
      600,
    );
  }
  async function businessAction(kind: "publish" | "new") {
    if (!version || busy) return;
    setBusy(true);
    setError(null);
    try {
      if (kind === "publish") {
        setShowValidation(true);
        const revision = await lane.current!.flush();
        install(await lms.publish(version.id, revision));
      } else install(await lms.newVersion(id));
    } catch (caught) {
      setError(caught);
    } finally {
      setBusy(false);
    }
  }
  async function reviewAction(action: "SUBMIT" | "APPROVE" | "RETURN") {
    if (!version || busy) return;
    setBusy(true);
    setError(null);
    try {
      const revision = await lane.current!.flush();
      await api(
        `/lms/course-versions/${encodeURIComponent(version.id)}/review`,
        {
          method: "POST",
          body: json({ revision, action, feedback: reviewFeedback }),
        },
      );
      setReviewFeedback("");
      await load();
    } catch (caught) {
      setError(caught);
    } finally {
      setBusy(false);
    }
  }
  if (!draft || !version)
    return (
      <section aria-busy={!error}>
        {error ? (
          <Notice>
            {lmsError(error, t)}
            <LmsErrorDiagnostic error={error} t={t} />
            <button onClick={() => void load()}>
              {t("Повторить", "Қайталау")}
            </button>
          </Notice>
        ) : (
          t("Открываем курс…", "Курс ашылуда…")
        )}
      </section>
    );
  const allowed = version.allowedActions || [];
  const canPublish = version.status === "DRAFT" && allowed.includes("publish");
  const canClone =
    version.status === "PUBLISHED" &&
    (allowed.includes("clone") || allowed.includes("create"));
  const canSubmitReview =
    version.status === "DRAFT" &&
    allowed.includes("submitReview") &&
    !["PENDING", "APPROVED"].includes(version.review?.state || "");
  const canApproveReview =
    version.status === "DRAFT" &&
    version.review?.state === "PENDING" &&
    allowed.includes("approveReview");
  const canReturnReview =
    version.status === "DRAFT" &&
    version.review?.state === "PENDING" &&
    allowed.includes("returnReview");
  const frozen = version.status !== "DRAFT" || !allowed.includes("edit");
  const content = draft.content;
  const profile = draft.profile;
  const published = version.status === "PUBLISHED" ? version : versions.find((item) => item.status === "PUBLISHED");
  const issues = version.publicationIssues || [];
  const canAuthor = [...allowed, ...(course?.allowedActions || [])].some((action) => ["edit", "clone", "publish", "submitReview", "approveReview"].includes(action));
  if (!canAuthor) return (
    <>
      <LmsHeading title={t(content.titleRu, content.titleKz)}>
        <Link className="button" href="/lms">{t("К программам", "Бағдарламаларға")}</Link>
      </LmsHeading>
      <section className="panel lms-panel">
        <p><Status value={version.status} t={t} /> · {t("Версия", "Нұсқа")} {version.version} · {content.hours} {t("ч.", "сағ.")}</p>
        {(content.descriptionRu || content.descriptionKz) && <p>{t(content.descriptionRu, content.descriptionKz)}</p>}
        <p>{t("Доступ к обучению", "Оқуға қолжетімділік")}: {content.accessDays} {t("дней", "күн")} · <Status value={profile.assessmentKind} t={t} /></p>
        {course?.assignmentPaused && <p role="status">{t("Новые назначения приостановлены", "Жаңа тағайындаулар тоқтатылған")}{course.assignmentPauseReason ? `: ${course.assignmentPauseReason}` : ""}</p>}
        <div className="lms-actions">
          {published && course?.allowedActions?.includes("assign") && !course.assignmentPaused && <Link className="button primary lms-primary" href={`/lms/assign?versionId=${encodeURIComponent(published.id)}`}>{t("Назначить обучение", "Оқуды тағайындау")}</Link>}
          {course?.allowedActions?.includes("reviewResults") && <Link className="button" href={`/lms/teaching?tab=reviews&courseId=${encodeURIComponent(id)}`}>{t("Открыть работы на проверку", "Тексеруге жіберілген жұмыстарды ашу")}</Link>}
        </div>
      </section>
      <section className="panel lms-panel">
        <h2>{t("Содержание программы", "Бағдарлама мазмұны")}</h2>
        {content.modules.map((module) => <section key={module.id}>
          <h3>{t(module.titleRu, module.titleKz)}</h3>
          <ul className="lms-list">{module.lessons.map((lesson) => <li key={lesson.id}>
            <span>{t(lesson.titleRu, lesson.titleKz)}</span>
            <span><Status value={lesson.kind} t={t} />{lesson.required ? ` · ${t("Обязательный", "Міндетті")}` : ""}</span>
          </li>)}</ul>
        </section>)}
        {!content.modules.length && <p>{t("Содержание готовится", "Мазмұн дайындалуда")}</p>}
      </section>
    </>
  );
  function goToIssue(issue: (typeof issues)[number]) {
    setSection(issue.target);
    window.requestAnimationFrame(() => {
      const target = document.getElementById(issue.questionId ? `author-question-${issue.questionId}` : issue.lessonId ? `author-lesson-${issue.lessonId}` : issue.moduleId ? `author-module-${issue.moduleId}` : `author-${issue.target}`);
      if (!target) return;
      let parent: HTMLElement | null = target;
      while (parent) {
        if (parent instanceof HTMLDetailsElement) parent.open = true;
        parent = parent.parentElement;
      }
      if (issue.target === "overview" && issue.code !== "COURSE_TITLE_REQUIRED") target.querySelectorAll("details").forEach((item) => { item.open = true; });
      target.scrollIntoView({ behavior: "auto", block: "start" });
      const field = target.querySelector<HTMLElement>("input:not(:disabled),textarea:not(:disabled),select:not(:disabled),button:not(:disabled)");
      (field || target).focus({ preventScroll: true });
    });
  }
  const allLessons = content.modules.flatMap((module) => module.lessons);
  const removedIds = deletion
    ? allLessons
        .filter((lesson) =>
          deletion.lessonId
            ? lesson.id === deletion.lessonId
            : content.modules
                .find((module) => module.id === deletion.moduleId)
                ?.lessons.includes(lesson),
        )
        .map((lesson) => lesson.id)
    : [];
  const affectedLessons = allLessons.filter(
    (lesson) =>
      !removedIds.includes(lesson.id) &&
      lesson.prerequisiteLessonIds.some((dependency) =>
        removedIds.includes(dependency),
      ),
  );
  const contentEdit = (patch: Partial<CourseContent>) =>
    edit({
      ...draft,
      content: { ...content, ...patch },
      profile:
        patch.category !== undefined
          ? { ...profile, category: patch.category }
          : profile,
    });
  const profileEdit = (patch: Partial<RegulatoryProfile>) =>
    edit({ ...draft, profile: { ...profile, ...patch } });
  function lessonEdit(
    moduleId: string,
    lessonId: string,
    patch: Partial<LmsLesson>,
  ) {
    contentEdit({
      modules: content.modules.map((m) =>
        m.id === moduleId
          ? {
              ...m,
              lessons: m.lessons.map((l) =>
                l.id === lessonId ? { ...l, ...patch } : l,
              ),
            }
          : m,
      ),
    });
  }
  function applyDeletion(
    moduleId: string,
    lessonId?: string,
    choices: Record<string, string> = {},
  ) {
    const removed = content.modules
      .filter((module) => module.id === moduleId)
      .flatMap((module) => module.lessons)
      .filter((lesson) => !lessonId || lesson.id === lessonId)
      .map((lesson) => lesson.id);
    contentEdit({
      modules: content.modules
        .filter((module) => lessonId || module.id !== moduleId)
        .map((module) => ({
          ...module,
          lessons: module.lessons
            .filter((lesson) => !removed.includes(lesson.id))
            .map((lesson) => ({
              ...lesson,
              prerequisiteLessonIds: [
                ...new Set(
                  lesson.prerequisiteLessonIds.flatMap((dependency) =>
                    removed.includes(dependency)
                      ? choices[lesson.id]
                        ? [choices[lesson.id]!]
                        : []
                      : [dependency],
                  ),
                ),
              ],
            })),
        })),
    });
    setDeletion(null);
  }
  function requestDeletion(moduleId: string, lessonId?: string) {
    if (
      !lessonId &&
      content.modules.some(
        (module) =>
          module.id !== moduleId &&
          module.prerequisiteModuleIds?.includes(moduleId),
      )
    ) {
      setDependencyBlocked(true);
      return;
    }
    const removed = content.modules
      .filter((module) => module.id === moduleId)
      .flatMap((module) => module.lessons)
      .filter((lesson) => !lessonId || lesson.id === lessonId)
      .map((lesson) => lesson.id);
    if (
      allLessons.some(
        (lesson) =>
          !removed.includes(lesson.id) &&
          lesson.prerequisiteLessonIds.some((dependency) =>
            removed.includes(dependency),
          ),
      )
    )
      setDeletion({ moduleId, lessonId, choices: {} });
    else applyDeletion(moduleId, lessonId);
  }
  function moveModule(from: number, to: number) {
    if (frozen || busy || conflict || to < 0 || to >= content.modules.length)
      return;
    const modules = [...content.modules];
    const [module] = modules.splice(from, 1);
    modules.splice(to, 0, module!);
    contentEdit({ modules });
  }
  function moveLesson(moduleId: string, from: number, to: number) {
    const module = content.modules.find((item) => item.id === moduleId);
    if (
      frozen ||
      busy ||
      conflict ||
      !module ||
      to < 0 ||
      to >= module.lessons.length
    )
      return;
    const lessons = [...module.lessons];
    const [lesson] = lessons.splice(from, 1);
    lessons.splice(to, 0, lesson!);
    contentEdit({
      modules: content.modules.map((item) =>
        item.id === moduleId ? { ...item, lessons } : item,
      ),
    });
  }
  return (
    <>
      <LmsHeading title={t(content.titleRu, content.titleKz)}>
        <Link className="button" href="/lms">
          {t("К курсам", "Курстарға")}
        </Link>
      </LmsHeading>
      <nav className="lms-author-sections" aria-label={t("Разделы программы", "Бағдарлама бөлімдері")}>
        {([['overview', t("Сведения", "Мәліметтер")], ['modules', t("Содержание", "Мазмұны")], ['exam', t("Итоговая проверка", "Қорытынды тексеру")], ['settings', t("Условия", "Шарттар")], ['review', t("Публикация", "Жариялау")]] as const).map(([key, label]) => (
          <button type="button" key={key} aria-current={section === key ? "step" : undefined} onClick={() => { setSection(key); setPreview(false); }}>{label}</button>
        ))}
      </nav>
      <div className="lms-editor-actions">
        <span>
          <Status value={version.status} t={t} /> · {t("Версия", "Нұсқа")}{" "}
          {version.version}
        </span>
        <span className="lms-save-state" role="status">
          {frozen
            ? ""
            : saveState === "saved"
              ? t("Сохранено", "Сақталды")
              : saveState === "saving" || saveState === "dirty"
                ? t("Сохраняем…", "Сақталуда…")
                : t("Не сохранено", "Сақталмады")}
        </span>
      </div>
      {course && section === "review" && (
        <CourseAvailability course={course} onChange={setCourse} t={t} />
      )}
      {published && section === "review" && course?.allowedActions?.includes("assign") && !course.assignmentPaused && (
        <section className="panel lms-panel">
          <p>{t("Доступна для назначения версия", "Тағайындауға қолжетімді нұсқа")} {published.version}</p>
          <Link className="button primary lms-primary" href={`/lms/assign?versionId=${encodeURIComponent(published.id)}`}>
            {t("Назначить обучение", "Оқуды тағайындау")}
          </Link>
        </section>
      )}
      {section === "review" && version.status === "DRAFT" && issues.length > 0 && (
        <section className="panel lms-panel" aria-label={t("До публикации", "Жариялау алдында")}>
          <h2>{t("Что нужно заполнить", "Нені толтыру қажет")}</h2>
          <ul className="lms-author-issues">
            {issues.map((issue, index) => (
              <li key={`${issue.code}:${issue.lessonId || issue.moduleId || issue.questionId || index}`}>
                <button type="button" onClick={() => { setShowValidation(true); goToIssue(issue); }}>
                  {t(issue.messageRu, issue.messageKz)}
                  {issue.lessonId && ` · ${t(content.modules.flatMap((module) => module.lessons).find((lesson) => lesson.id === issue.lessonId)?.titleRu || "Урок", content.modules.flatMap((module) => module.lessons).find((lesson) => lesson.id === issue.lessonId)?.titleKz || "Сабақ")}`}
                </button>
              </li>
            ))}
          </ul>
          {saveState !== "saved" && <p role="status">{t("Список обновится после сохранения изменений.", "Тізім өзгерістер сақталғаннан кейін жаңартылады.")}</p>}
        </section>
      )}
      <details hidden={section !== "modules"} className="panel lms-panel" open={preview} onToggle={(event) => setPreview(event.currentTarget.open)}>
        <summary>{t("Предварительный вид слушателя", "Тыңдаушы көрінісін алдын ала қарау")}</summary>
        {preview && <div className="lms-prose">
          <h2>{t(content.titleRu, content.titleKz)}</h2>
          <p>{t(content.descriptionRu, content.descriptionKz)}</p>
          {content.modules.map((module) => <section key={module.id}>
            <h3>{t(module.titleRu, module.titleKz) || t("Новый модуль", "Жаңа модуль")}</h3>
            {module.lessons.map((lesson) => <article key={lesson.id}>
              <h4>{t(lesson.titleRu, lesson.titleKz) || t("Новый урок", "Жаңа сабақ")}{lesson.required ? ` · ${t("Обязательный", "Міндетті")}` : ""}</h4>
              {lesson.kind === "TEXT" && <p>{t(lesson.textRu, lesson.textKz)}</p>}
              {lesson.assignment && <p>{t(lesson.assignment.instructionsRu, lesson.assignment.instructionsKz)}</p>}
              {lesson.kind !== "TEXT" && <p><Status value={lesson.kind} t={t} /></p>}
            </article>)}
          </section>)}
        </div>}
      </details>
      {recovery && (
        <Notice>
          {t(
            "Есть локальные несохранённые изменения. Просмотрите актуальную редакцию перед восстановлением.",
            "Жергілікті сақталмаған өзгерістер бар. Қалпына келтірер алдында соңғы редакцияны тексеріңіз.",
          )}
          <button
            type="button"
            disabled={frozen || busy || conflict}
            onClick={() => {
              edit(recovery);
              setRecovery(null);
            }}
          >
            {t(
              "Восстановить локальные изменения",
              "Жергілікті өзгерістерді қалпына келтіру",
            )}
          </button>
          <button
            type="button"
            onClick={() => {
              setRecovery(null);
              try {
                sessionStorage.removeItem(`lms-author-draft:${id}`);
              } catch {
                /* Optional local recovery; the server remains the source of truth. */
              }
            }}
          >
            {t("Оставить серверную редакцию", "Сервер редакциясын қалдыру")}
          </button>
        </Notice>
      )}
      {!frozen && undo.length > 0 && (
        <button
          type="button"
          disabled={busy || conflict}
          onClick={() => {
            const previous = undo[undo.length - 1]!;
            setUndo((values) => values.slice(0, -1));
            edit(previous, false);
          }}
        >
          {t("Отменить изменение", "Өзгерісті болдырмау")}
        </button>
      )}
      {!!error && (
        <Notice>
          {lmsError(error, t)}
          <LmsErrorDiagnostic error={error} t={t} />
          <button
            onClick={() =>
              conflict
                ? (setRecovery(draft), void load())
                : void lane.current?.flush().catch(() => {})
            }
          >
            {conflict
              ? t("Открыть актуальную редакцию", "Соңғы нұсқаны ашу")
              : t("Повторить", "Қайталау")}
          </button>
        </Notice>
      )}
      {dependencyBlocked && (
        <Notice>
          {t(
            "Сначала снимите или замените требование этого модуля у зависимых модулей.",
            "Алдымен тәуелді модульдердегі осы модуль талабын алып тастаңыз немесе ауыстырыңыз.",
          )}
        </Notice>
      )}
      {deletion && (
        <section
          className="panel lms-panel"
          role="alert"
          aria-label={t("Зависимые уроки", "Тәуелді сабақтар")}
        >
          <p>
            {t(
              "Удаляемый материал используется в следующих уроках. Для каждого выберите новую зависимость или её снятие.",
              "Жойылатын материал келесі сабақтарда қолданылады. Әр сабақ үшін жаңа тәуелділікті немесе оны жоюды таңдаңыз.",
            )}
          </p>
          {affectedLessons.map((lesson) => (
            <label key={lesson.id}>
              {t(lesson.titleRu, lesson.titleKz)}
              <select
                value={deletion.choices[lesson.id] ?? "__choose__"}
                onChange={(event) =>
                  setDeletion({
                    ...deletion,
                    choices: {
                      ...deletion.choices,
                      [lesson.id]: event.target.value,
                    },
                  })
                }
              >
                <option value="__choose__" disabled>
                  {t("Выберите действие", "Әрекетті таңдаңыз")}
                </option>
                <option value="">
                  {t("Снять зависимость", "Тәуелділікті жою")}
                </option>
                {allLessons
                  .slice(
                    0,
                    allLessons.findIndex((item) => item.id === lesson.id),
                  )
                  .filter((item) => !removedIds.includes(item.id))
                  .map((item) => (
                    <option key={item.id} value={item.id}>
                      {t(item.titleRu, item.titleKz)}
                    </option>
                  ))}
              </select>
            </label>
          ))}
          <div className="lms-actions">
            <button
              type="button"
              disabled={affectedLessons.some(
                (lesson) => deletion.choices[lesson.id] === undefined,
              )}
              onClick={() =>
                applyDeletion(
                  deletion.moduleId,
                  deletion.lessonId,
                  deletion.choices,
                )
              }
            >
              {t("Применить и удалить", "Қолданып жою")}
            </button>
            <button type="button" onClick={() => setDeletion(null)}>
              {t("Оставить материал", "Материалды сақтау")}
            </button>
          </div>
        </section>
      )}
      <fieldset
        id="author-overview"
        hidden={section !== "overview"}
        disabled={frozen || busy || conflict}
        className="panel lms-panel"
        onBlur={() => {
          if (lane.current?.dirty && !lane.current.paused)
            void lane.current.flush().catch(() => {});
        }}
      >
        <legend>{t("Программа", "Бағдарлама")}</legend>
        <div className="lms-fields">
          <label>
            {t("Название RU", "Атауы RU")}
            <input
              value={content.titleRu}
              onChange={(e) => contentEdit({ titleRu: e.target.value })}
            />
          </label>
          <label>
            {t("Название KZ", "Атауы KZ")}
            <input
              value={content.titleKz}
              onChange={(e) => contentEdit({ titleKz: e.target.value })}
            />
          </label>
          <label>
            {t("Описание RU", "Сипаттама RU")}
            <textarea
              value={content.descriptionRu}
              onChange={(e) => contentEdit({ descriptionRu: e.target.value })}
            />
          </label>
          <label>
            {t("Описание KZ", "Сипаттама KZ")}
            <textarea
              value={content.descriptionKz}
              onChange={(e) => contentEdit({ descriptionKz: e.target.value })}
            />
          </label>
          <label>
            {t("Категория слушателей", "Тыңдаушылар санаты")}
            <input
              value={content.category}
              onChange={(e) => contentEdit({ category: e.target.value })}
            />
          </label>
          <div className="lms-fields">
            <label>
              {t("Часы", "Сағат")}
              <input
                type="number"
                min={0}
                max={10000}
                value={content.hours}
                onChange={(e) => contentEdit({ hours: Number(e.target.value) })}
              />
            </label>
            <label>
              {t("Доступ, дней", "Қолжетімділік, күн")}
              <input
                type="number"
                min={1}
                max={3650}
                value={content.accessDays}
                onChange={(e) =>
                  contentEdit({ accessDays: Number(e.target.value) })
                }
              />
            </label>
          </div>
        </div>
        <details>
          <summary>
            {t("Основание и оформление", "Негіз және рәсімдеу")}
          </summary>
          <div className="lms-fields">
            <label>
              {t("Название основания", "Негіздің атауы")}
              <input
                value={profile.title}
                onChange={(e) => profileEdit({ title: e.target.value })}
              />
            </label>
            <label>
              {t("Проверка основания", "Негізді тексеру")}
              <select
                value={profile.status}
                onChange={(e) =>
                  profileEdit({
                    status: e.target.value as RegulatoryProfile["status"],
                  })
                }
              >
                <option value="NEEDS_LEGAL_REVIEW">
                  {t("Нужна правовая проверка", "Құқықтық тексеру қажет")}
                </option>
                <option value="DRAFT">{t("Черновик", "Жоба")}</option>
                <option value="CONFIRMED">
                  {t("Проверено", "Тексерілген")}
                </option>
              </select>
            </label>
            <label>
              {t("Компетенции", "Құзыреттер")}
              <select
                value={profile.competency}
                onChange={(e) =>
                  profileEdit({
                    competency: e.target
                      .value as RegulatoryProfile["competency"],
                  })
                }
              >
                <option value="OTHER">{t("Иные", "Өзге")}</option>
                <option value="GENERAL">{t("Общие", "Жалпы")}</option>
                <option value="SPECIAL">{t("Специальные", "Арнайы")}</option>
                <option value="HYGIENE">
                  {t("Гигиенические", "Гигиеналық")}
                </option>
              </select>
            </label>
            <label>
              {t("Оценка", "Бағалау")}
              <select
                value={profile.assessmentKind}
                onChange={(e) =>
                  profileEdit({
                    assessmentKind: e.target
                      .value as RegulatoryProfile["assessmentKind"],
                  })
                }
              >
                <option value="PRACTICE">
                  {t("Учебный тест", "Жаттығу тесті")}
                </option>
                <option value="CENTER_EXAM">
                  {t("Экзамен центра", "Орталық емтиханы")}
                </option>
                <option value="EXTERNAL_AUTHORIZED">
                  {t("Внешний экзамен", "Сыртқы емтихан")}
                </option>
              </select>
            </label>
            <label>
              {t("Действует с", "Басталуы")}
              <input
                type="date"
                value={profile.effectiveFrom || ""}
                aria-label={t("Действует с", "Басталуы")}
                aria-invalid={content.learningOutcome !== "LEARNING" && profile.assessmentKind !== "PRACTICE" && !profile.effectiveFrom || undefined}
                aria-describedby={content.learningOutcome !== "LEARNING" && profile.assessmentKind !== "PRACTICE" && !profile.effectiveFrom ? "effective-from-required" : undefined}
                onChange={(e) =>
                  profileEdit({ effectiveFrom: e.target.value || null })
                }
              />
              {content.learningOutcome !== "LEARNING" && profile.assessmentKind !== "PRACTICE" && !profile.effectiveFrom && <small id="effective-from-required" role="status">{t("Укажите дату начала действия основания: без неё результат экзамена не допускает оформление документов.", "Негіздің күшіне ену күнін көрсетіңіз: онсыз емтихан нәтижесі бойынша құжаттарды рәсімдеуге болмайды.")}</small>}
            </label>
            <label>
              {t("Действует до", "Аяқталуы")}
              <input
                type="date"
                value={profile.effectiveUntil || ""}
                onChange={(e) =>
                  profileEdit({ effectiveUntil: e.target.value || null })
                }
              />
            </label>
            <label>
              {t("Основание проверки", "Тексеру негізі")}
              <input
                value={profile.reviewReference}
                onChange={(e) =>
                  profileEdit({ reviewReference: e.target.value })
                }
              />
            </label>
            <label>
              {t("Уполномоченный экзаменатор", "Уәкілетті емтихан алушы")}
              <input
                value={profile.examiner}
                onChange={(e) => profileEdit({ examiner: e.target.value })}
              />
            </label>
            <label>
              {t("Эмитент документа", "Құжатты беруші")}
              <input
                value={profile.issuer}
                onChange={(e) => profileEdit({ issuer: e.target.value })}
              />
            </label>
            <label>
              {t("Вид документа", "Құжат түрі")}
              <select
                value={profile.legalForm}
                onChange={(e) =>
                  profileEdit({
                    legalForm: e.target.value as RegulatoryProfile["legalForm"],
                  })
                }
              >
                <option value="INFORMATION_CARD">
                  {t("Информационная карточка", "Ақпараттық карточка")}
                </option>
                <option value="PAPER_ORIGINAL">
                  {t("Бумажный оригинал", "Қағаз түпнұсқа")}
                </option>
                <option value="ELECTRONIC_ORIGINAL">
                  {t("Электронный оригинал", "Электрондық түпнұсқа")}
                </option>
                <option value="COPY_OF_ORIGINAL">
                  {t("Копия оригинала", "Түпнұсқа көшірмесі")}
                </option>
              </select>
            </label>
          </div>
          <fieldset>
            <legend>{t("Комплект документов", "Құжаттар жинағы")}</legend>
            {(
              [
                ["PROTOCOL", "Протокол", "Хаттама"],
                ["CERTIFICATE", "Сертификат", "Сертификат"],
                ["CREDENTIAL", "Удостоверение", "Куәлік"],
              ] as const
            ).map(([kind, ru, kz]) => (
              <label className="lms-inline-label" key={kind}>
                <input
                  type="checkbox"
                  checked={profile.documentTypes.includes(kind)}
                  onChange={(e) =>
                    profileEdit({
                      documentTypes: e.target.checked
                        ? [...profile.documentTypes, kind]
                        : profile.documentTypes.filter(
                            (value) => value !== kind,
                          ),
                    })
                  }
                />
                {t(ru, kz)}
              </label>
            ))}
          </fieldset>
          {demoOnly ? <label className="lms-inline-label"><input type="checkbox" checked={profile.synthetic} onChange={(event) => profileEdit({ synthetic: event.target.checked })} />{t("Учебный пример — без юридической силы", "Оқу үлгісі — заңды күші жоқ")}</label> : profile.synthetic && <p className="muted">{t("Учебный пример — без юридической силы", "Оқу үлгісі — заңды күші жоқ")}</p>}
          <label className="lms-inline-label">
            <input
              type="checkbox"
              checked={profile.sanitary}
              onChange={(e) => profileEdit({ sanitary: e.target.checked })}
            />
            {t("Санитарное обучение", "Санитариялық оқыту")}
          </label>
          {profile.sanitary && (
            <div className="lms-fields">
              <label>
                {t("Производственный календарь", "Өндірістік күнтізбе")}
                <select
                  value={profile.calendarVersionId || ""}
                  onChange={(event) => {
                    const calendar = calendars.find(
                      (value) => value.id === event.target.value,
                    );
                    profileEdit({
                      calendarVersionId: event.target.value || null,
                      ...(calendar ? { timezone: calendar.timezone } : {}),
                    });
                  }}
                >
                  <option value="">
                    {t("Выберите календарь", "Күнтізбені таңдаңыз")}
                  </option>
                  {calendars.map((calendar) => (
                    <option key={calendar.id} value={calendar.id}>
                      {calendar.name} · {t("версия", "нұсқа")}{" "}
                      {calendar.version}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                {t(
                  "Время окончания рабочего дня",
                  "Жұмыс күнінің аяқталу уақыты",
                )}
                <input
                  type="time"
                  value={profile.cutoff}
                  onChange={(event) =>
                    profileEdit({ cutoff: event.target.value })
                  }
                />
              </label>
            </div>
          )}
          <div className="lms-fields">
            {(
              [
                ["requiresApproval", "Требуется согласование", "Келісу қажет"],
                ["requiresPractice", "Требуется практика", "Практика қажет"],
                [
                  "requiresProctoring",
                  "Требуется прокторинг",
                  "Прокторинг қажет",
                ],
                [
                  "requiresEmployeeSignature",
                  "Требуется подпись слушателя",
                  "Тыңдаушы қол қоюы қажет",
                ],
              ] as const
            ).map(([key, ru, kz]) => (
              <label key={key} className="lms-inline-label">
                <input
                  type="checkbox"
                  checked={profile[key]}
                  aria-describedby={key === "requiresProctoring" && profile.requiresProctoring && content.learningOutcome !== "LEARNING" && profile.assessmentKind !== "EXTERNAL_AUTHORIZED" ? "local-proctoring-limit" : undefined}
                  onChange={(e) => profileEdit({ [key]: e.target.checked })}
                />
                {t(ru, kz)}
              </label>
            ))}
          </div>
          {profile.requiresProctoring && content.learningOutcome !== "LEARNING" && profile.assessmentKind !== "EXTERNAL_AUTHORIZED" && (
            <label id="local-proctoring-limit">{t("Способ контроля экзамена", "Емтиханды бақылау тәсілі")}<select value={profile.proctoringMode || "UNSPECIFIED"} onChange={event => profileEdit({ proctoringMode: event.target.value as RegulatoryProfile["proctoringMode"] })}><option value="UNSPECIFIED">{t("Требует согласования", "Келісуді қажет етеді")}</option><option value="LOCAL_SUPERVISED">{t("Местный экзамен под наблюдением сотрудника", "Қызметкер бақылауымен жергілікті емтихан")}</option></select><span className="muted">{t("Наблюдатель подтверждает личность и присутствие, ведёт журнал сессии и принимает конкретную попытку перед выставлением оценки.", "Бақылаушы жеке басы мен қатысуды растайды, сессия журналын жүргізеді және баға қойылғанға дейін нақты әрекетті қабылдайды.")}</span></label>
          )}
          {profile.requiresPractice && (
            <label>
              {t(
                "Основание подтверждения практики",
                "Практиканы растау негізі",
              )}
              <select
                value={profile.practiceEvidenceMode || "UNSPECIFIED"}
                aria-describedby="practice-evidence-help"
                onChange={(event) =>
                  profileEdit({
                    practiceEvidenceMode: event.target
                      .value as RegulatoryProfile["practiceEvidenceMode"],
                  })
                }
              >
                <option value="UNSPECIFIED">
                  {t(
                    "Не выбрано — допуск закрыт",
                    "Таңдалмаған — рұқсат жабық",
                  )}
                </option>
                <option value="REVIEWED_ASSIGNMENTS">
                  {t(
                    "Проверенные обязательные практические работы",
                    "Тексерілген міндетті практикалық жұмыстар",
                  )}
                </option>
                <option value="IN_PERSON">
                  {t(
                    "Очная практика с оценкой преподавателя",
                    "Оқытушы бағалайтын күндізгі практика",
                  )}
                </option>
              </select>
              <span className="muted" id="practice-evidence-help">
                {t(
                  "Основание должно соответствовать утверждённой программе. Онлайн-практика засчитывается после принятия всех обязательных практических работ преподавателем.",
                  "Негіз бекітілген бағдарламаға сәйкес болуы тиіс. Онлайн-практика барлық міндетті практикалық жұмыстарды оқытушы қабылдағаннан кейін есептеледі.",
                )}
              </span>
              {content.learningOutcome !== "LEARNING" && profile.assessmentKind !== "EXTERNAL_AUTHORIZED" && (profile.practiceEvidenceMode === "IN_PERSON" || content.metadata?.format === "IN_PERSON") && (
                <span role="status">
                  {t(
                    "Добавьте обязательное занятие в программу. В группе преподаватель назначит дату, критерии и оценит практику каждого участника.",
                    "Бағдарламаға міндетті сабақ қосыңыз. Топта оқытушы күн мен критерийлерді белгілеп, әр қатысушының практикасын бағалайды.",
                  )}
                </span>
              )}
            </label>
          )}
          <label>
            {t("Комиссия", "Комиссия")}
            <select
              value={profile.commissionKind}
              onChange={(e) =>
                profileEdit({
                  commissionKind: e.target
                    .value as RegulatoryProfile["commissionKind"],
                })
              }
            >
              <option value="NONE">
                {t(
                  "Не требуется по основанию",
                  "Негіз бойынша талап етілмейді",
                )}
              </option>
              <option value="CENTER">
                {t("Учебного центра", "Оқу орталығының")}
              </option>
              <option value="EMPLOYER">
                {t("Работодателя", "Жұмыс берушінің")}
              </option>
              <option value="EXTERNAL">{t("Внешняя", "Сыртқы")}</option>
            </select>
          </label>
          {profile.commission.map((person, i) => (
            <div className="lms-fields" key={i}>
              <label>
                {t("ФИО члена комиссии", "Комиссия мүшесінің аты-жөні")}
                <input
                  value={person.name}
                  onChange={(e) =>
                    profileEdit({
                      commission: profile.commission.map((p, n) =>
                        n === i ? { ...p, name: e.target.value } : p,
                      ),
                    })
                  }
                />
              </label>
              <label>
                {t("Роль в комиссии", "Комиссиядағы рөлі")}
                <input
                  value={person.role}
                  onChange={(e) =>
                    profileEdit({
                      commission: profile.commission.map((p, n) =>
                        n === i ? { ...p, role: e.target.value } : p,
                      ),
                    })
                  }
                />
              </label>
            </div>
          ))}
          <button
            type="button"
            onClick={() =>
              profileEdit({
                commission: [...profile.commission, { name: "", role: "" }],
              })
            }
          >
            {t("Добавить члена комиссии", "Комиссия мүшесін қосу")}
          </button>
          <label>
            {t(
              "Обязательные подписанты — по одному на строку",
              "Міндетті қол қоюшылар — әр жолға біреу",
            )}
            <textarea
              value={profile.requiredSignatures.join("\n")}
              onChange={(e) =>
                profileEdit({
                  requiredSignatures: e.target.value
                    .split("\n")
                    .filter(Boolean),
                })
              }
            />
          </label>
          <SourcePicker t={t} onSelect={source => profileEdit({ status: "NEEDS_LEGAL_REVIEW", sources: [...profile.sources.filter(value => value.sourceId !== source.sourceId), source] })} />
          {profile.sources.map((source, i) => (
            <div key={source.sourceId || i}>
            <fieldset disabled={!!source.sourceRevisionId}>
              <legend>
                {t("Источник", "Дереккөз")} {i + 1}
              </legend>
              <label>
                {t("Название", "Атауы")}
                <input
                  value={source.title}
                  onChange={(e) =>
                    profileEdit({
                      sources: profile.sources.map((s, n) =>
                        n === i ? { ...s, title: e.target.value } : s,
                      ),
                    })
                  }
                />
              </label>
              <div className="lms-fields">
                <label>
                  {t("Ссылка", "Сілтеме")}
                  <input
                    type="url"
                    value={source.url}
                    onChange={(e) =>
                      profileEdit({
                        sources: profile.sources.map((s, n) =>
                          n === i ? { ...s, url: e.target.value } : s,
                        ),
                      })
                    }
                  />
                </label>
                <label>
                  {t("Редакция", "Редакция")}
                  <input
                    value={source.revision}
                    onChange={(e) =>
                      profileEdit({
                        sources: profile.sources.map((s, n) =>
                          n === i ? { ...s, revision: e.target.value } : s,
                        ),
                      })
                    }
                  />
                </label>
              </div>
              <div className="lms-fields">
                {(
                  [
                    ["number", "Номер НПА", "НҚА нөмірі"],
                    ["authority", "Орган", "Орган"],
                    ["article", "Статья", "Бап"],
                    ["paragraph", "Пункт", "Тармақ"],
                    ["subparagraph", "Подпункт", "Тармақша"],
                  ] as const
                ).map(([key, ru, kz]) => (
                  <label key={key}>
                    {t(ru, kz)}
                    <input
                      value={source[key] || ""}
                      onChange={(event) =>
                        profileEdit({
                          sources: profile.sources.map((item, position) =>
                            position === i
                              ? { ...item, [key]: event.target.value }
                              : item,
                          ),
                        })
                      }
                    />
                  </label>
                ))}
                {(
                  [
                    ["date", "Дата НПА", "НҚА күні"],
                    ["effectiveOn", "Дата актуальности", "Өзектілік күні"],
                  ] as const
                ).map(([key, ru, kz]) => (
                  <label key={key}>
                    {t(ru, kz)}
                    <input
                      type="date"
                      value={source[key] || ""}
                      onChange={(event) =>
                        profileEdit({
                          sources: profile.sources.map((item, position) =>
                            position === i
                              ? { ...item, [key]: event.target.value || null }
                              : item,
                          ),
                        })
                      }
                    />
                  </label>
                ))}
                <label>
                  {t("Состояние источника", "Дереккөз күйі")}
                  <select
                    value={source.status || ""}
                    onChange={(event) =>
                      profileEdit({
                        sources: profile.sources.map((item, position) =>
                          position === i
                            ? {
                                ...item,
                                status: (event.target.value ||
                                  undefined) as typeof source.status,
                              }
                            : item,
                        ),
                      })
                    }
                  >
                    <option value="">{t("Не указано", "Көрсетілмеген")}</option>
                    {regulatoryStates.map(([value, ru, kz]) => (
                      <option key={value} value={value}>
                        {t(ru, kz)}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            </fieldset>
            <button type="button" onClick={() => profileEdit({ status: "NEEDS_LEGAL_REVIEW", sources: profile.sources.filter((_, index) => index !== i) })}>
              {t("Убрать источник из программы", "Дереккөзді бағдарламадан алып тастау")}
            </button>
            </div>
          ))}
          <button
            type="button"
            onClick={() =>
              profileEdit({
                sources: [
                  ...profile.sources,
                  { title: "", url: "", revision: "" },
                ],
              })
            }
          >
            {t("Добавить источник", "Дереккөз қосу")}
          </button>
        </details>
      </fieldset>
      <fieldset
        disabled={frozen || busy || conflict}
        className="panel lms-panel"
        id="author-settings"
        hidden={section !== "settings"}
      >
        <legend>{t("Учебные настройки", "Оқу параметрлері")}</legend>
        <CourseLearningSettings
          content={content}
          courseId={id}
          onChange={contentEdit}
          t={t}
        />
      </fieldset>
      <fieldset
        disabled={frozen || busy || conflict}
        className="panel lms-panel"
        id="author-modules"
        hidden={section !== "modules"}
      >
        <legend>{t("Модули и уроки", "Модульдер мен сабақтар")}</legend>
        {content.modules.map((module, index) => (
          <details
            key={module.id}
            id={`author-module-${module.id}`}
            onDragOver={(event) => {
              if (dragged && !dragged.lessonId) event.preventDefault();
            }}
            onDrop={(event) => {
              if (dragged && !dragged.lessonId) {
                event.preventDefault();
                moveModule(
                  content.modules.findIndex(
                    (item) => item.id === dragged.moduleId,
                  ),
                  index,
                );
                setDragged(null);
              }
            }}
            open={
              content.modules.length === 1 ||
              (showValidation &&
                (!module.titleRu.trim() || !module.titleKz.trim()))
            }
          >
            <summary>
              {t(module.titleRu, module.titleKz) ||
                t("Новый модуль", "Жаңа модуль")}{" "}
              · {module.lessons.length}
            </summary>
            <button
              type="button"
              className="lms-author-drag"
              draggable={!frozen && !busy && !conflict}
              onDragStart={(event) => {
                event.dataTransfer.effectAllowed = "move";
                event.dataTransfer.setData("text/plain", module.id);
                setDragged({ moduleId: module.id });
              }}
              onDragEnd={() => setDragged(null)}
              aria-label={`${t("Перенести модуль", "Модульді жылжыту")}: ${t(module.titleRu, module.titleKz)}`}
            >
              {t(
                "Перетащить модуль · или используйте кнопки ниже",
                "Модульді сүйреңіз · немесе төмендегі батырмаларды қолданыңыз",
              )}
            </button>
            <div className="lms-fields">
              <label>
                {t("Модуль RU", "Модуль RU")}
                <input
                  value={module.titleRu}
                  onChange={(e) =>
                    contentEdit({
                      modules: content.modules.map((m) =>
                        m.id === module.id
                          ? { ...m, titleRu: e.target.value }
                          : m,
                      ),
                    })
                  }
                />
              </label>
              <label>
                {t("Модуль KZ", "Модуль KZ")}
                <input
                  value={module.titleKz}
                  onChange={(e) =>
                    contentEdit({
                      modules: content.modules.map((m) =>
                        m.id === module.id
                          ? { ...m, titleKz: e.target.value }
                          : m,
                      ),
                    })
                  }
                />
              </label>
            </div>
            {showValidation &&
              (!module.titleRu.trim() || !module.titleKz.trim()) && (
                <p role="alert">
                  {t(
                    "Укажите название модуля на двух языках",
                    "Модуль атауын екі тілде көрсетіңіз",
                  )}
                </p>
              )}
            <details>
              <summary>
                {t(
                  "Предыдущие обязательные модули",
                  "Алдыңғы міндетті модульдер",
                )}
              </summary>
              {content.modules
                .filter((item) => item.id !== module.id)
                .map((previous) => (
                  <label className="lms-inline-label" key={previous.id}>
                    <input
                      type="checkbox"
                      checked={
                        module.prerequisiteModuleIds?.includes(previous.id) ||
                        false
                      }
                      disabled={
                        content.modules.indexOf(previous) >= index &&
                        !module.prerequisiteModuleIds?.includes(previous.id)
                      }
                      onChange={(event) =>
                        contentEdit({
                          modules: content.modules.map((item) =>
                            item.id === module.id
                              ? {
                                  ...item,
                                  prerequisiteModuleIds: event.target.checked
                                    ? [
                                        ...(item.prerequisiteModuleIds || []),
                                        previous.id,
                                      ]
                                    : item.prerequisiteModuleIds?.filter(
                                        (dependency) =>
                                          dependency !== previous.id,
                                      ),
                                }
                              : item,
                          ),
                        })
                      }
                    />
                    {t(previous.titleRu, previous.titleKz)}
                    {content.modules.indexOf(previous) >= index &&
                    module.prerequisiteModuleIds?.includes(previous.id)
                      ? ` — ${t("нарушена последовательность", "реттілік бұзылған")}`
                      : ""}
                  </label>
                ))}
            </details>
            {module.lessons.map((lesson, lessonIndex) => (
              <fieldset
                key={lesson.id}
                id={`author-lesson-${lesson.id}`}
                onDragOver={(event) => {
                  if (dragged?.lessonId && dragged.moduleId === module.id)
                    event.preventDefault();
                }}
                onDrop={(event) => {
                  if (dragged?.lessonId && dragged.moduleId === module.id) {
                    event.preventDefault();
                    event.stopPropagation();
                    moveLesson(
                      module.id,
                      module.lessons.findIndex(
                        (item) => item.id === dragged.lessonId,
                      ),
                      lessonIndex,
                    );
                    setDragged(null);
                  }
                }}
              >
                <legend>
                  {t("Урок", "Сабақ")} {lessonIndex + 1}
                </legend>
                <button
                  type="button"
                  className="lms-author-drag"
                  draggable={!frozen && !busy && !conflict}
                  onDragStart={(event) => {
                    event.stopPropagation();
                    event.dataTransfer.effectAllowed = "move";
                    event.dataTransfer.setData("text/plain", lesson.id);
                    setDragged({ moduleId: module.id, lessonId: lesson.id });
                  }}
                  onDragEnd={() => setDragged(null)}
                  aria-label={`${t("Перенести элемент", "Элементті жылжыту")}: ${t(lesson.titleRu, lesson.titleKz)}`}
                >
                  {t(
                    "Перетащить элемент · или используйте кнопки ниже",
                    "Элементті сүйреңіз · немесе төмендегі батырмаларды қолданыңыз",
                  )}
                </button>
                <LessonAuthor
                  timezone={content.accessPolicy?.timezone || profile.timezone}
                  lesson={lesson}
                  onChange={(patch) => lessonEdit(module.id, lesson.id, patch)}
                  courseId={id}
                  disabled={frozen || busy || conflict}
                  showValidation={showValidation}
                  flush={() => lane.current!.flush()}
                  onBusy={setBusy}
                  t={t}
                />
                {lesson.prerequisiteLessonIds.some(
                  (dependency) =>
                    !allLessons
                      .slice(
                        0,
                        allLessons.findIndex((item) => item.id === lesson.id),
                      )
                      .some((item) => item.id === dependency),
                ) && (
                  <p role="alert">
                    {t("Нарушена последовательность", "Реттілік бұзылған")}:{" "}
                    {lesson.prerequisiteLessonIds
                      .filter(
                        (dependency) =>
                          !allLessons
                            .slice(
                              0,
                              allLessons.findIndex(
                                (item) => item.id === lesson.id,
                              ),
                            )
                            .some((item) => item.id === dependency),
                      )
                      .map((dependency) => (
                        <span key={dependency}>
                          {allLessons.find((item) => item.id === dependency)
                            ?.titleRu || dependency}{" "}
                          <button
                            type="button"
                            onClick={() =>
                              lessonEdit(module.id, lesson.id, {
                                prerequisiteLessonIds:
                                  lesson.prerequisiteLessonIds.filter(
                                    (item) => item !== dependency,
                                  ),
                              })
                            }
                          >
                            {t("Снять зависимость", "Тәуелділікті жою")}
                          </button>
                        </span>
                      ))}
                  </p>
                )}
                <details>
                  <summary>
                    {t(
                      "Предыдущие обязательные уроки",
                      "Алдыңғы міндетті сабақтар",
                    )}
                  </summary>
                  {content.modules
                    .flatMap((value) => value.lessons)
                    .slice(
                      0,
                      allLessons.findIndex((value) => value.id === lesson.id),
                    )
                    .map((previous) => (
                      <label className="lms-inline-label" key={previous.id}>
                        <input
                          type="checkbox"
                          checked={lesson.prerequisiteLessonIds.includes(
                            previous.id,
                          )}
                          onChange={(event) =>
                            lessonEdit(module.id, lesson.id, {
                              prerequisiteLessonIds: event.target.checked
                                ? [...lesson.prerequisiteLessonIds, previous.id]
                                : lesson.prerequisiteLessonIds.filter(
                                    (value) => value !== previous.id,
                                  ),
                            })
                          }
                        />
                        {t(
                          previous.titleRu,
                          previous.titleKz || previous.titleRu,
                        )}
                      </label>
                    ))}
                </details>
                <div className="lms-actions">
                  <button
                    type="button"
                    disabled={lessonIndex === 0}
                    onClick={() => {
                      const lessons = [...module.lessons];
                      [lessons[lessonIndex - 1], lessons[lessonIndex]] = [
                        lessons[lessonIndex]!,
                        lessons[lessonIndex - 1]!,
                      ];
                      contentEdit({
                        modules: content.modules.map((m) =>
                          m.id === module.id ? { ...m, lessons } : m,
                        ),
                      });
                    }}
                  >
                    {t("Выше", "Жоғары")}
                  </button>
                  <button
                    type="button"
                    disabled={lessonIndex === module.lessons.length - 1}
                    onClick={() =>
                      moveLesson(module.id, lessonIndex, lessonIndex + 1)
                    }
                  >
                    {t("Ниже", "Төмен")}
                  </button>
                  <button
                    type="button"
                    onClick={() => requestDeletion(module.id, lesson.id)}
                  >
                    {t("Убрать урок", "Сабақты алып тастау")}
                  </button>
                </div>
              </fieldset>
            ))}
            <div className="lms-actions">
              <button
                type="button"
                onClick={() =>
                  contentEdit({
                    modules: content.modules.map((m) =>
                      m.id === module.id
                        ? {
                            ...m,
                            lessons: [
                              ...m.lessons,
                              {
                                id: crypto.randomUUID(),
                                titleRu: "",
                                titleKz: "",
                                kind: "TEXT",
                                textRu: "",
                                textKz: "",
                                materialId: null,
                                durationSeconds: null,
                                required: true,
                                prerequisiteLessonIds: [],
                              },
                            ],
                          }
                        : m,
                    ),
                  })
                }
              >
                {t("Добавить урок", "Сабақ қосу")}
              </button>
              <button
                type="button"
                disabled={index === 0}
                onClick={() => {
                  const modules = [...content.modules];
                  [modules[index - 1], modules[index]] = [
                    modules[index]!,
                    modules[index - 1]!,
                  ];
                  contentEdit({ modules });
                }}
              >
                {t("Модуль выше", "Модульді жоғары")}
              </button>
              <button
                type="button"
                disabled={index === content.modules.length - 1}
                onClick={() => moveModule(index, index + 1)}
              >
                {t("Модуль ниже", "Модульді төмен")}
              </button>
              <button type="button" onClick={() => requestDeletion(module.id)}>
                {t("Убрать модуль", "Модульді алып тастау")}
              </button>
            </div>
          </details>
        ))}
        <button
          type="button"
          onClick={() =>
            contentEdit({
              modules: [
                ...content.modules,
                {
                  id: crypto.randomUUID(),
                  titleRu: "",
                  titleKz: "",
                  lessons: [],
                },
              ],
            })
          }
        >
          {t("Добавить модуль", "Модуль қосу")}
        </button>
      </fieldset>
      <fieldset
        disabled={frozen || busy || conflict}
        className="panel lms-panel"
        id="author-exam"
        hidden={section !== "exam"}
      >
        <legend>{t("Вопросы и оценка", "Сұрақтар мен бағалау")}</legend>
        <AssessmentAuthor
          timezone={content.accessPolicy?.timezone || profile.timezone}
          value={content.exam}
          onChange={(exam) => contentEdit({ exam })}
          courseId={id}
          disabled={frozen || busy || conflict}
          showValidation={showValidation}
          flush={() => lane.current!.flush()}
          onBusy={setBusy}
          t={t}
        />
      </fieldset>
      <section
        className="panel lms-panel"
        id="author-review"
        hidden={section !== "review"}
        aria-label={t("Согласование программы", "Бағдарламаны келісу")}
      >
        <p role="status">
          {t("Согласование", "Келісу")}:{" "}
          {version.review?.state === "PENDING"
            ? t("На проверке", "Тексеруде")
            : version.review?.state === "APPROVED"
              ? t("Одобрена текущая редакция", "Ағымдағы редакция мақұлданған")
              : version.review?.state === "RETURNED"
                ? t("Возвращено на доработку", "Түзетуге қайтарылған")
                : t("Черновик", "Жоба")}
        </p>
        {version.review?.feedback && <p>{version.review.feedback}</p>}
        {version.status === "DRAFT" && !canPublish && ["PENDING", "APPROVED"].includes(version.review?.state || "") && <p>{t("Следующий шаг — администратор согласует и опубликует программу.", "Келесі қадам — әкімші бағдарламаны келісіп, жариялайды.")}</p>}
        {(canApproveReview || canReturnReview) && (
          <label>
            {t("Комментарий к решению", "Шешімге түсініктеме")}
            <textarea
              value={reviewFeedback}
              onChange={(event) => setReviewFeedback(event.target.value)}
            />
          </label>
        )}
        <div className="lms-actions">
          {canSubmitReview && (
            <button
              type="button"
              className={canPublish ? undefined : "primary lms-primary"}
              disabled={busy || conflict}
              onClick={() => void reviewAction("SUBMIT")}
            >
              {t("Отправить на проверку", "Тексеруге жіберу")}
            </button>
          )}
          {canApproveReview && (
            <button
              type="button"
              className={canPublish ? undefined : "primary lms-primary"}
              disabled={busy || conflict}
              onClick={() => void reviewAction("APPROVE")}
            >
              {t("Одобрить редакцию", "Редакцияны мақұлдау")}
            </button>
          )}
          {canReturnReview && (
            <button
              type="button"
              disabled={busy || conflict || !reviewFeedback.trim()}
              onClick={() => void reviewAction("RETURN")}
            >
              {t("Вернуть на доработку", "Түзетуге қайтару")}
            </button>
          )}
        </div>
      </section>
      <div className="lms-editor-actions" hidden={section !== "review"}>
        {(canPublish || canClone) && (
          <button
            className={canPublish ? "primary lms-primary" : "button"}
            disabled={busy || conflict}
            onClick={() => void businessAction(canPublish ? "publish" : "new")}
          >
            {busy
              ? t("Подождите…", "Күтіңіз…")
              : canPublish
                ? t("Опубликовать", "Жариялау")
                : t("Создать новую версию", "Жаңа нұсқа жасау")}
          </button>
        )}
        {versions.length > 1 && (
          <details>
            <summary>{t("История версий", "Нұсқалар тарихы")}</summary>
            {versions.map((v) => (
              <p key={v.id}>
                {v.version} · <Status value={v.status} t={t} />
              </p>
            ))}
          </details>
        )}
      </div>
      {section !== "review" && <div className="lms-editor-actions">
        <button type="button" className="primary lms-primary" onClick={() => setSection(section === "overview" ? "modules" : section === "modules" ? "exam" : section === "exam" ? "settings" : "review")}>
          {section === "overview" ? t("К содержанию программы", "Бағдарлама мазмұнына") : section === "modules" ? t("К итоговой проверке", "Қорытынды тексеруге") : section === "exam" ? t("К условиям прохождения", "Өту шарттарына") : t("К публикации", "Жариялауға")}
        </button>
      </div>}
    </>
  );
}
