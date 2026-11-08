"use client";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { Notice } from "@demo/ui";
import type { LearningAnswers, LmsQuestion } from "@demo/contracts/src/lms";
import { ApiError, api, json, BEFORE_LOGOUT_EVENT, NavigationBlockedError } from "@/lib/api";
import { formatLearningDateTime } from "@/lib/learning-date-format";
import { safeLmsReturnTo } from "@/lib/lms-navigation";
import { teachingReviewPath } from "@/lib/teaching-review-path";
import { ReviewDecisionDrafts, recoverReviewDecision, type ReviewDecisionDraft, type ReviewTarget } from "@/lib/review-decision-draft";
import {
  LmsErrorDiagnostic,
  LmsHeading,
  lmsError,
  type Translate,
} from "./common";
import { TeachingChoiceSearch, useTeachingContext } from "./teaching-context";
import { QuestionResponse } from "./question-response";
import { ProctoringQueue, ProctoringSession } from "./proctoring";
import { useLmsSaveNavigation } from "./use-save-navigation";

type TargetType = "ATTEMPT" | "SUBMISSION";
type Item = {
  id: string;
  targetType: TargetType;
  enrollmentId: string;
  elementId?: string;
  submittedAt: string;
  revision: number;
  courseId: string;
  groupId?: string | null;
  learnerName: string;
  titleRu: string;
  titleKz: string;
  courseTitleRu?: string;
  courseTitleKz?: string;
  elementTitleRu?: string;
  elementTitleKz?: string;
  state: string;
};
type Detail = Item & {
  proctoringPending?: boolean;
  contentHash: string;
  questions?: LmsQuestion[];
  answers?: LearningAnswers;
  pendingQuestionIds?: string[];
  questionScores?: Record<string, number | null>;
  text?: string;
  attachments?: { id: string; name: string; downloadUrl: string }[];
  instructionsRu?: string;
  instructionsKz?: string;
  criteriaRu?: string;
  criteriaKz?: string;
  allowedActions: string[];
  history: {
    decision: string;
    feedback: string;
    reviewerName: string;
    createdAt: string;
    revision: number;
  }[];
};
type CalendarItem = {
  id: string;
  kind: string;
  titleRu: string;
  titleKz: string;
  startsAt: string;
  href: string;
  timezone?: string;
};
type DecisionDraft = ReviewDecisionDraft;
function decisionName(value: string, t: Translate) {
  return value === "GRADE"
    ? t("Оценка выставлена", "Баға қойылды")
    : value === "ACCEPTED"
      ? t("Принято", "Қабылданды")
      : value === "RETURNED"
        ? t("Возвращено на доработку", "Түзетуге қайтарылды")
        : value === "REJECTED"
          ? t("Отклонено", "Қабылданбады")
          : value === "PENDING_REVIEW" ||
              value === "AWAITING_REVIEW" ||
              value === "SUBMITTED"
            ? t("Ожидает проверки", "Тексеруді күтуде")
            : t("Обработано", "Өңделді");
}
function retryLabel(error: unknown, t: Translate) {
  const details = error instanceof ApiError ? error.details : error;
  return details && typeof details === "object" && "code" in details && details.code === "LMS_DEPLOYMENT_REVIEW_REQUIRED"
    ? t("Проверить доступ", "Қолжетімділікті тексеру")
    : t("Повторить загрузку", "Қайта жүктеу");
}
export function TeacherWorkspace({ t, scope, mode = "teacher", canManageRoles = false, timezone = "Asia/Qyzylorda" }: { t: Translate; scope: string; mode?: "teacher" | "expert"; canManageRoles?: boolean; timezone?: string }) {
  const expert = mode === "expert";
  const [view, setView] = useState<"reviews" | "groups" | "events" | "proctoring">(expert ? "groups" : "reviews");
  const [events, setEvents] = useState<CalendarItem[]>([]);
  const [data, setData] = useState<{ items: Item[]; total: number } | null>(
    null,
  );
  const [type, setType] = useState<TargetType | "ALL">("ALL");
  const [courseId, setCourseId] = useState("");
  const [groupId, setGroupId] = useState("");
  const [page, setPage] = useState(1);
  const [refresh, setRefresh] = useState(0);
  const choices = useTeachingContext({
    courseId,
    groupId,
    groupCourseId: courseId,
    refresh,
  });
  const context = choices.error ? null : choices.context;
  const [detail, setDetail] = useState<Detail | null>(null);
  const [form, setForm] = useState<DecisionDraft | null>(null);
  const drafts = useMemo(() => new ReviewDecisionDrafts(scope, () => window.sessionStorage), [scope]);
  const [storageIssue, setStorageIssue] = useState<"read" | "write" | "clear" | null>(null);
  const selection = useRef(0);
  const [error, setError] = useState<unknown>(null);
  const [reviewError, setReviewError] = useState<unknown>(null);
  const [eventsError, setEventsError] = useState<unknown>(null);
  const [loadingReviews, setLoadingReviews] = useState(true);
  const [loadingEvents, setLoadingEvents] = useState(true);
  const [loadedQuery, setLoadedQuery] = useState("");
  const reviewQuery = JSON.stringify([type, courseId, groupId, page]);
  const visibleReviews = loadedQuery === reviewQuery && !reviewError ? data : null;
  const selectedReview = useRef<Pick<Item, "targetType" | "id"> | null>(null);
  const decisionPending = useRef(false);
  const queueContext = useRef({ courseId, groupId, type });
  queueContext.current = { courseId, groupId, type };
  const [busy, setBusy] = useState(false);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [notice, setNotice] = useState(false);
  const [revisionChanged, setRevisionChanged] = useState(false);
  function saveDraft(target: ReviewTarget, value: DecisionDraft) {
    try { drafts.write(target, value); setStorageIssue(drafts.unsaved ? "write" : null); }
    catch { setStorageIssue("write"); }
  }
  function clearDraft(target: ReviewTarget) {
    try { drafts.clear(target); setStorageIssue(drafts.unsaved ? "write" : null); }
    catch { setStorageIssue("clear"); }
  }
  async function flushDrafts() {
    try { drafts.flush(); setStorageIssue(null); }
    catch { setStorageIssue(drafts.unsaved ? "write" : "clear"); throw new NavigationBlockedError(); }
  }
  useLmsSaveNavigation(`teacher-review:${scope}:${detail?.id || "queue"}`, () => drafts.unsaved, flushDrafts, () => setStorageIssue("write"));
  useEffect(() => {
    const unload = (event: BeforeUnloadEvent) => {
      if (drafts.unsaved) { event.preventDefault(); event.returnValue = ""; }
    };
    const logout = (event: Event) => {
      if (drafts.unsaved) (event as CustomEvent<{ waitUntil: (promise: Promise<unknown>) => void }>).detail.waitUntil(flushDrafts());
    };
    window.addEventListener("beforeunload", unload);
    window.addEventListener(BEFORE_LOGOUT_EVENT, logout);
    return () => { window.removeEventListener("beforeunload", unload); window.removeEventListener(BEFORE_LOGOUT_EVENT, logout); };
  }, [drafts]);
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const initialCourseId = params.get("courseId"), initialGroupId = params.get("groupId");
    if (initialCourseId && initialCourseId.length <= 100) setCourseId(initialCourseId);
    if (initialGroupId && initialGroupId.length <= 100) setGroupId(initialGroupId);
    const initialView = params.get("tab");
    if (initialView === "reviews" || initialView === "groups" || (initialView === "events" && !expert)) setView(initialView);
    const targetType = params.get("type"), reviewId = params.get("reviewId");
    if (targetType === "ATTEMPT" || targetType === "SUBMISSION") setType(targetType);
    if (reviewId && (targetType === "ATTEMPT" || targetType === "SUBMISSION")) {
      setView("reviews");
      void open({ id: reviewId, targetType });
    }
    return () => { selection.current++; };
  }, []);
  useEffect(() => {
    if (expert) return;
    let live = true;
    setLoadingEvents(true);
    const from = new Date();
    const to = new Date(from.getTime() + 14 * 86400000);
    void api<{ items: CalendarItem[] }>(
      `/lms/calendar?from=${encodeURIComponent(from.toISOString())}&to=${encodeURIComponent(to.toISOString())}&page=1&pageSize=10`,
    )
      .then((value) => {
        if (live) { setEvents(value.items); setEventsError(null); }
      })
      .catch((caught) => {
        if (live) { setEventsError(caught); setEvents([]); clearUnauthorized(caught); }
      })
      .finally(() => { if (live) setLoadingEvents(false); });
    return () => {
      live = false;
    };
  }, [refresh, expert]);
  useEffect(() => {
    let live = true;
    setLoadingReviews(true);
    const params = new URLSearchParams({
      page: String(page),
      pageSize: "20",
    });
    if (type !== "ALL") params.set("type", type);
    if (courseId) params.set("courseId", courseId);
    if (groupId) params.set("groupId", groupId);
    void api<{ items: Item[]; total: number }>(`/lms/reviews?${params}`)
      .then((value) => {
        if (!live) return;
        const lastPage = Math.max(1, Math.ceil(value.total / 20));
        if (page > lastPage) setPage(lastPage);
        else { setData(value); setLoadedQuery(reviewQuery); }
        setReviewError(null);
      })
      .catch((caught) => {
        if (live) { setReviewError(caught); setData(null); clearUnauthorized(caught); }
      })
      .finally(() => { if (live) setLoadingReviews(false); });
    return () => {
      live = false;
    };
  }, [type, courseId, groupId, page, refresh]);
  useEffect(() => {
    const update = () => { if (document.visibilityState === "visible" && !busy && !loadingDetail) setRefresh((value) => value + 1); };
    const timer = setInterval(update, 20000);
    window.addEventListener("focus", update);
    return () => { clearInterval(timer); window.removeEventListener("focus", update); };
  }, [busy, loadingDetail]);
  function receiveError(caught: unknown) {
    setError(caught);
    clearUnauthorized(caught);
  }
  function clearUnauthorized(caught: unknown) {
    if (caught instanceof ApiError && [401, 403].includes(caught.status)) {
      selection.current++;
      setDetail(null);
      setForm(null);
      setLoadingDetail(false);
      setData(null);
      setEvents([]);
      setNotice(false);
    }
  }
  async function open(item: Pick<Item, "targetType" | "id">) {
    selectedReview.current = item;
    setView("reviews");
    const token = ++selection.current;
    setLoadingDetail(true);
    setError(null);
    setNotice(false);
    setDetail(null);
    setForm(null);
    try {
      const value = await api<Detail>(
        `/lms/reviews/${item.targetType}/${encodeURIComponent(item.id)}`,
      );
      if (token !== selection.current) return;
      setDetail(value);
      window.history.replaceState(window.history.state, "", teachingReviewPath(queueContext.current, item));
      let previous: DecisionDraft | null = null;
      if (!value.allowedActions.length) clearDraft(item);
      else {
        try { previous = drafts.read(item); setStorageIssue(drafts.unsaved ? "write" : null); }
        catch { setStorageIssue("read"); }
      }
      const recovered = recoverReviewDecision(previous, value);
      setRevisionChanged(recovered.changed);
      setForm(recovered.draft);
      if (previous && value.allowedActions.length) saveDraft(item, recovered.draft);
    } catch (caught) {
      if (token === selection.current) {
        if (caught instanceof ApiError && [403, 404].includes(caught.status)) clearDraft(item);
        receiveError(caught);
      }
    } finally {
      if (token === selection.current) setLoadingDetail(false);
    }
  }
  function change(patch: Partial<DecisionDraft>) {
    if (!form || !detail) return;
    const next = { ...form, ...patch, key: crypto.randomUUID() };
    setForm(next);
    saveDraft(detail, next);
  }
  async function submit() {
    if (!detail || !form || decisionPending.current || loadingDetail) return;
    decisionPending.current = true;
    const token = selection.current;
    setBusy(true);
    setError(null);
    try {
      const decision =
        detail.targetType === "ATTEMPT" ? "GRADE" : form.decision;
      await api(
        `/lms/reviews/${detail.targetType}/${encodeURIComponent(detail.id)}/decision`,
        {
          method: "POST",
          body: json({
            decisionKey: form.key,
            revision: detail.revision,
            contentHash: detail.contentHash,
            decision,
            feedback: form.feedback,
            ...(detail.targetType === "ATTEMPT"
              ? {
                  questionScores: Object.fromEntries(
                    (detail.pendingQuestionIds || []).map((id) => [
                      id,
                      form.scores[id],
                    ]),
                  ),
                }
              : {}),
          }),
        },
      );
      clearDraft(detail);
      if (token !== selection.current) return;
      await open(detail);
      setNotice(true);
      setRefresh((value) => value + 1);
    } catch (caught) {
      if (token === selection.current) receiveError(caught);
    } finally {
      decisionPending.current = false;
      setBusy(false);
    }
  }
  const pending = detail?.pendingQuestionIds || [];
  const canSubmit =
    !!detail &&
    !detail.proctoringPending &&
    !!form &&
    (detail.targetType === "ATTEMPT"
      ? detail.allowedActions.includes("GRADE") &&
        pending.every((id) => form.scores[id] !== undefined)
      : detail.allowedActions.includes(form.decision)) &&
    (detail?.targetType === "ATTEMPT" ||
      form?.decision === "ACCEPTED" ||
      !!form?.feedback.trim());
  return (
    <>
      <LmsHeading
        title={expert ? t("Кабинет комиссии", "Комиссия кабинеті") : t("Кабинет преподавателя", "Оқытушы кабинеті")}
      >
        <Link className="button" href={expert ? "/lms/results" : "/lms/calendar"}>
          {expert ? t("Результаты аттестации", "Аттестаттау нәтижелері") : t("Вебинары и посещаемость", "Вебинарлар және қатысу")}
        </Link>
        {expert && <Link className="button" href="/lms/commission">{t("Протоколы и подпись", "Хаттамалар және қол қою")}</Link>}
      </LmsHeading>
      {storageIssue && <Notice>
        {storageIssue === "read"
          ? t("Не удалось восстановить черновик решения. Повторите загрузку черновика.", "Шешімнің жобасын қалпына келтіру мүмкін болмады. Жобаны қайта жүктеңіз.")
          : storageIssue === "clear"
            ? t("Не удалось удалить черновик с этого устройства. Сохранённое решение не изменено.", "Бұл құрылғыдан жобаны жою мүмкін болмады. Сақталған шешім өзгерген жоқ.")
            : t("Черновик решения не сохранён на устройстве. Не закрывайте страницу до сохранения черновика или решения.", "Шешімнің жобасы құрылғыда сақталмады. Жоба немесе шешім сақталғанша бетті жаппаңыз.")}
        <button type="button" disabled={busy || loadingDetail} onClick={() => {
          if (storageIssue === "read" && selectedReview.current) void open(selectedReview.current);
          else void flushDrafts().catch(() => {});
        }}>{storageIssue === "read" ? t("Загрузить черновик", "Жобаны жүктеу") : storageIssue === "clear" ? t("Удалить черновик", "Жобаны жою") : t("Сохранить черновик", "Жобаны сақтау")}</button>
      </Notice>}
      {!detail && <div className="lms-actions" role="group" aria-label={expert ? t("Задачи комиссии", "Комиссия міндеттері") : t("Задачи преподавателя", "Оқытушы міндеттері")}>
        <button type="button" aria-pressed={view === "groups"} onClick={() => setView("groups")}>{expert ? t("Группы аттестации", "Аттестаттау топтары") : t("Мои группы", "Менің топтарым")}</button>
        <button type="button" aria-pressed={view === "reviews"} onClick={() => setView("reviews")}>{expert ? t("Работы комиссии", "Комиссия жұмыстары") : t("Проверка работ", "Жұмыстарды тексеру")}</button>
        <button type="button" aria-pressed={view === "proctoring"} onClick={() => setView("proctoring")}>{t("Контроль экзамена", "Емтиханды бақылау")}</button>
        {!expert && <button type="button" aria-pressed={view === "events"} onClick={() => setView("events")}>{t("Ближайшие занятия", "Алдағы сабақтар")}</button>}
      </div>}
      {!!(error || choices.error) && (
        <Notice>
          {lmsError(error || choices.error, t)}
          <LmsErrorDiagnostic error={error || choices.error} t={t} />
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              setRefresh((value) => value + 1);
              if (selectedReview.current) void open(selectedReview.current);
            }}
          >
            {t(
              "Обновить данные",
              "Деректерді жаңарту",
            )}
          </button>
        </Notice>
      )}
      {notice && (
        <p role="status">{t("Решение сохранено", "Шешім сақталды")}</p>
      )}
      {revisionChanged && <Notice>{t("Ответы изменились. Комментарий сохранён; проверьте работу заново.", "Жауаптар өзгерді. Түсініктеме сақталды; жұмысты қайта тексеріңіз.")}</Notice>}
      {!detail && view === "proctoring" && <ProctoringQueue t={t} />}
      <section className="panel lms-panel" hidden={!!detail || view !== "reviews"}>
        <h2>{t("Очередь проверки", "Тексеру кезегі")}</h2>
        {!!reviewError && <Notice>{lmsError(reviewError, t)}<LmsErrorDiagnostic error={reviewError} t={t} /><button disabled={loadingReviews} onClick={() => setRefresh(value => value + 1)}>{retryLabel(reviewError, t)}</button></Notice>}
        {loadingReviews && <p role="status">{t("Загружаем работы…", "Жұмыстар жүктелуде…")}</p>}
        <div className="lms-fields">
          <label>
            {t("Работы", "Жұмыстар")}
            <select
              value={type}
              onChange={(event) => {
                setType(event.target.value as TargetType | "ALL");
                setPage(1);
              }}
            >
              <option value="ALL">{t("Все ожидающие работы", "Барлық күтілетін жұмыстар")}</option>
              <option value="ATTEMPT">
                {t("Ответы на тесты", "Тест жауаптары")}
              </option>
              <option value="SUBMISSION">
                {t("Практические задания", "Практикалық тапсырмалар")}
              </option>
            </select>
          </label>
          <label>
            {t("Курс", "Курс")}
            <select
              value={courseId}
              onChange={(event) => {
                setCourseId(event.target.value);
                setGroupId("");
                setPage(1);
              }}
            >
              <option value="">
                {t("Все мои курсы", "Менің барлық курстарым")}
              </option>
              {courseId && !context?.courses.some(course => course.id === courseId) && <option value={courseId}>{t("Выбранная программа", "Таңдалған бағдарлама")}</option>}
              {context?.courses.map((course) => (
                <option key={course.id} value={course.id}>
                  {t(course.titleRu, course.titleKz)}
                </option>
              ))}
            </select>
          </label>
          <label>
            {t("Группа", "Топ")}
            <select
              value={groupId}
              onChange={(event) => {
                setGroupId(event.target.value);
                setPage(1);
              }}
            >
              <option value="">
                {t("Все мои группы", "Менің барлық топтарым")}
              </option>
              {context?.groups
                .filter((group) => !courseId || group.courseId === courseId)
                .map((group) => (
                  <option key={group.id} value={group.id}>
                    {group.name}
                  </option>
                ))}
            </select>
          </label>
        </div>
        <ul className="lms-list">
          {visibleReviews?.items.map((item) => (
            <li
              key={`${item.targetType}:${item.id}`}
              className={
                detail?.id === item.id ? "lms-author-selected" : undefined
              }
            >
              <div>
                <strong>{item.learnerName}</strong>
                <p>
                  {t(item.titleRu, item.titleKz)} ·{" "}
                  {decisionName(item.state, t)} ·{" "}
                  {formatLearningDateTime(item.submittedAt, timezone, t("ru-KZ", "kk-KZ"))}
                </p>
                {item.elementTitleRu && <p>{t(item.elementTitleRu, item.elementTitleKz || item.elementTitleRu)}</p>}
              </div>
              <button
                type="button"
                disabled={busy}
                onClick={() => void open(item)}
              >
                {t("Открыть работу", "Жұмысты ашу")}
              </button>
            </li>
          ))}
        </ul>
        {visibleReviews && !loadingReviews && !visibleReviews.items.length && (
          <p>{t("Работ для проверки нет", "Тексерілетін жұмыстар жоқ")}</p>
        )}
        {visibleReviews && visibleReviews.total > 20 && (
          <div className="lms-actions">
            <button
              type="button"
              disabled={loadingReviews || page === 1}
              onClick={() => setPage((value) => value - 1)}
            >
              {t("Назад", "Артқа")}
            </button>
            <span>
              {page} / {Math.ceil(visibleReviews.total / 20)}
            </span>
            <button
              type="button"
              disabled={loadingReviews || page * 20 >= visibleReviews.total}
              onClick={() => setPage((value) => value + 1)}
            >
              {t("Далее", "Әрі қарай")}
            </button>
          </div>
        )}
      </section>
      {loadingDetail && (
        <p role="status">
          {t("Открываем отправленную работу…", "Жіберілген жұмыс ашылуда…")}
        </p>
      )}
      {detail && form && (
        <section className="panel lms-panel" aria-busy={loadingDetail}>
          <button type="button" disabled={busy} onClick={() => { selection.current++; selectedReview.current = null; setDetail(null); setForm(null); setError(null); setNotice(false); window.history.replaceState(window.history.state, "", teachingReviewPath(queueContext.current)); }}>{t("К очереди работ", "Жұмыстар кезегіне")}</button>
          <h2>
            {detail.learnerName} · {t(detail.titleRu, detail.titleKz)}
          </h2>
          {detail.courseTitleRu && detail.courseTitleRu !== detail.titleRu && <p>{t(detail.courseTitleRu, detail.courseTitleKz || detail.courseTitleRu)}</p>}
          {detail.proctoringPending && <><Notice>{t("Дождитесь решения наблюдателя и обновите работу.", "Бақылаушының шешімін күтіп, жұмысты жаңартыңыз.")}</Notice><ProctoringSession enrollmentId={detail.enrollmentId} t={t} /><button type="button" onClick={() => void open(detail)}>{t("Обновить работу после контроля", "Бақылаудан кейін жұмысты жаңарту")}</button></>}
          <p>{decisionName(detail.state, t)}</p>
          {detail.targetType === "ATTEMPT" ? (
            detail.questions?.map((question, index) => {
              const spec =
                question.answerSpec?.kind === "CASE"
                  ? question.answerSpec.response
                  : question.answerSpec;
              return (
                <fieldset key={question.id}>
                  <QuestionResponse
                    question={question}
                    value={detail.answers?.[question.id]}
                    onChange={() => {}}
                    disabled
                    t={t}
                    number={index + 1}
                  />
                  {spec?.kind === "TEXT" && spec.mode === "MANUAL" && (
                    <p className="lms-review-answer">
                      {t("Критерии", "Критерийлер")}:{" "}
                      {t(spec.criteriaRu, spec.criteriaKz)}
                    </p>
                  )}
                  {pending.includes(question.id) && (
                    <label>
                      {t("Оценка ответа", "Жауап бағасы")}
                      <select
                        disabled={
                          busy ||
                          loadingDetail ||
                          !detail.allowedActions.includes("GRADE")
                        }
                        value={(detail.state === "FINISHED" ? detail.questionScores?.[question.id] : form.scores[question.id]) ?? ""}
                        onChange={(event) => {
                          const scores = { ...form.scores };
                          if (event.target.value === "")
                            delete scores[question.id];
                          else
                            scores[question.id] = Number(event.target.value) as
                              | 0
                              | 1;
                          change({ scores });
                        }}
                      >
                        <option value="">
                          {t("Выберите оценку", "Бағаны таңдаңыз")}
                        </option>
                        <option value="1">
                          {t(
                            "Соответствует критериям — 1",
                            "Критерийлерге сәйкес — 1",
                          )}
                        </option>
                        <option value="0">
                          {t("Не соответствует — 0", "Сәйкес емес — 0")}
                        </option>
                      </select>
                    </label>
                  )}
                </fieldset>
              );
            })
          ) : (
            <>
              <h3>{t("Инструкция и критерии", "Нұсқаулық пен критерийлер")}</h3>
              <p className="lms-review-answer">
                {t(detail.instructionsRu || "", detail.instructionsKz || "")}
              </p>
              <p className="lms-review-answer">
                {t(detail.criteriaRu || "", detail.criteriaKz || "")}
              </p>
              <h3>{t("Ответ слушателя", "Тыңдаушы жауабы")}</h3>
              <p className="lms-review-answer">{detail.text}</p>
              <ul>
                {detail.attachments?.map((file) => (
                  <li key={file.id}>
                    {/^\/api\/lms\//.test(file.downloadUrl) ||
                    /^\/lms\//.test(file.downloadUrl) ? (
                      <a
                        href={
                          file.downloadUrl.startsWith("/api/")
                            ? file.downloadUrl
                            : `/api${file.downloadUrl}`
                        }
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        {file.name}
                      </a>
                    ) : (
                      file.name
                    )}
                  </li>
                ))}
              </ul>
            </>
          )}
          {detail.allowedActions.length > 0 && (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void submit();
              }}
            >
              <fieldset disabled={busy || loadingDetail}>
                {detail.targetType === "SUBMISSION" && (
                  <label>
                    {t("Решение", "Шешім")}
                    <select
                      value={form.decision}
                      onChange={(event) =>
                        change({ decision: event.target.value })
                      }
                    >
                      <option value="">
                        {t("Выберите решение", "Шешімді таңдаңыз")}
                      </option>
                      {detail.allowedActions.map((action) => (
                        <option key={action} value={action}>
                          {decisionName(action, t)}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                <label>
                  {t("Обратная связь слушателю", "Тыңдаушыға кері байланыс")}
                  <textarea
                    rows={4}
                    maxLength={10000}
                    value={form.feedback}
                    onChange={(event) =>
                      change({ feedback: event.target.value })
                    }
                  />
                </label>
                <button
                  type="submit"
                  className="primary lms-primary"
                  disabled={!canSubmit}
                >
                  {busy
                    ? t("Сохраняем…", "Сақталуда…")
                    : detail.targetType === "ATTEMPT" ? t("Передать оценку слушателю", "Бағаны тыңдаушыға беру") : form.decision === "ACCEPTED" ? t("Принять работу", "Жұмысты қабылдау") : form.decision === "RETURNED" ? t("Вернуть на доработку", "Түзетуге қайтару") : form.decision === "REJECTED" ? t("Отклонить работу", "Жұмысты қабылдамау") : t("Сохранить решение", "Шешімді сақтау")}
                </button>
                <p className="muted">
                  {t(
                    "После принятия итоговую оценку изменить нельзя.",
                    "Қабылданған соң қорытынды бағаны өзгертуге болмайды.",
                  )}
                </p>
              </fieldset>
            </form>
          )}
          {!detail.allowedActions.length && <div className="lms-actions">

            <button type="button" className="primary lms-primary" disabled={busy} onClick={() => {
              const next = visibleReviews?.items.find((item) => item.id !== detail.id);
              if (next) void open(next);
              else { selectedReview.current = null; setDetail(null); setForm(null); window.history.replaceState(window.history.state, "", teachingReviewPath(queueContext.current)); }
            }}>{t("К следующей работе", "Келесі жұмысқа")}</button>
          </div>}
          <details>
            <summary>{t("История проверки", "Тексеру тарихы")}</summary>
            <ol className="lms-review-history">
              {detail.history.map((entry, index) => (
                <li key={`${entry.createdAt}-${index}`}>
                  <strong>{decisionName(entry.decision, t)}</strong> ·{" "}
                  {entry.reviewerName} ·{" "}
                  {formatLearningDateTime(entry.createdAt, timezone, t("ru-KZ", "kk-KZ"))}
                  <p className="lms-review-answer">{entry.feedback}</p>
                </li>
              ))}
            </ol>
          </details>
        </section>
      )}
      <section className="panel lms-panel" hidden={!!detail || view !== "groups"}>
        <h2>{expert ? t("Группы аттестации", "Аттестаттау топтары") : t("Мои группы", "Менің топтарым")}</h2>
        <label>{t("Программа", "Бағдарлама")}<select value={courseId} onChange={event => { setCourseId(event.target.value); setGroupId(""); setPage(1); }}><option value="">{t("Все мои программы", "Менің барлық бағдарламаларым")}</option>{courseId && !context?.courses.some(course => course.id === courseId) && <option value={courseId}>{t("Выбранная программа", "Таңдалған бағдарлама")}</option>}{context?.courses.map(course => <option key={course.id} value={course.id}>{t(course.titleRu, course.titleKz)}</option>)}</select></label>
        {!!context && (context.coursesTotal > context.pageSize || choices.query.courseSearch) && <TeachingChoiceSearch choices={choices} kind="course" t={t} />}
        <TeachingChoiceSearch choices={choices} kind="group" t={t} />
        <ul className="lms-list">
          {context?.groups.map((group) => (
            <li key={group.id}>
              <strong>{group.name}</strong>
              <Link href={expert ? `/lms/results?groupId=${encodeURIComponent(group.id)}` : `/lms/groups/${encodeURIComponent(group.id)}`}>
                {expert ? t("Результаты группы", "Топ нәтижелері") : t("Состав, прогресс и занятия", "Құрам, үлгерім және сабақтар")}
              </Link>
            </li>
          ))}
        </ul>
        {context && !context.groups.length && <p>{expert ? t("Назначенных групп аттестации нет", "Тағайындалған аттестаттау топтары жоқ") : t("Назначенных групп нет", "Тағайындалған топтар жоқ")}</p>}
        {!expert && <Link href="/lms">{t("Мои курсы и материалы", "Менің курстарым және материалдарым")}</Link>}
        {canManageRoles && context?.canManage && (
          <Link href="/lms/learning-roles">
            {t("Учебные роли", "Оқу рөлдері")}
          </Link>
        )}
      </section>
      {!expert && <section className="panel lms-panel" hidden={!!detail || view !== "events"}>
        <h2>
          {t("Ближайшие занятия и сроки", "Алдағы сабақтар мен мерзімдер")}
        </h2>
        {!!eventsError && <Notice>{lmsError(eventsError, t)}<LmsErrorDiagnostic error={eventsError} t={t} /><button disabled={loadingEvents} onClick={() => setRefresh(value => value + 1)}>{retryLabel(eventsError, t)}</button></Notice>}
        {loadingEvents && <p role="status">{t("Загружаем занятия…", "Сабақтар жүктелуде…")}</p>}
        <ul className="lms-list">
          {events.map((event) => (
            <li key={event.id}>
              <Link
                href={
                  safeLmsReturnTo(event.href) || "/lms/calendar"
                }
              >
                {t(event.titleRu, event.titleKz)}
              </Link>
              <time dateTime={event.startsAt}>
                {formatLearningDateTime(event.startsAt, event.timezone || timezone, t("ru-KZ", "kk-KZ"))}
              </time>
            </li>
          ))}
        </ul>
        {!loadingEvents && !eventsError && !events.length && (
          <p>
            {t(
              "На ближайшие две недели событий нет",
              "Алдағы екі аптаға оқиғалар жоқ",
            )}
          </p>
        )}
      </section>}
    </>
  );
}
