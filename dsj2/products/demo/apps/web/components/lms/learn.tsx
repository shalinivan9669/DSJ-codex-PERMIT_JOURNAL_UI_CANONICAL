"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Notice } from "@demo/ui";
import type { LmsLesson } from "@demo/contracts/src/lms";
import { ProctoringSession } from "./proctoring";
import {
  lms,
  type Attempt,
  type Enrollment,
  type Learning,
  type LessonProgress,
  type Paged,
} from "@/lib/lms-api";
import { Exam } from "./exam";
import { LearnerAssessment } from "./learner-assessment";
import { LearnerSubmissionForm } from "./learner-submission";
import { LearnerSession } from "./teaching-calendar";
import { LmsDocument } from "./documents";
import { WorkspaceCompanion } from "./workplace";
import {
  LmsHeading,
  PageControls,
  Status,
  LmsErrorDiagnostic,
  lmsError,
  type Translate,
} from "./common";

function lockExplanation(reason: string | null | undefined, t: Translate) {
  return reason === "ACCESS_CLOSED"
    ? t(
        "Учебный доступ сейчас закрыт. Проверьте период доступа выше.",
        "Оқуға қолжетімділік қазір жабық. Жоғарыдағы қолжетімділік мерзімін тексеріңіз.",
      )
    : reason === "COURSE_PREREQUISITE_REQUIRED"
      ? t(
          "Сначала завершите базовую программу, указанную выше.",
          "Алдымен жоғарыда көрсетілген негізгі бағдарламаны аяқтаңыз.",
        )
      : t(
          "Сначала завершите обязательные элементы предыдущего модуля или указанные уроки.",
          "Алдымен алдыңғы модульдің міндетті элементтерін немесе көрсетілген сабақтарды аяқтаңыз.",
        );
}
function finalRequirement(reason: string | null | undefined, t: Translate) {
  const messages: Record<string, [string, string]> = {
    AWAITING_REVIEW: ["Итоговая работа отправлена. Решение появится после проверки преподавателем.", "Қорытынды жұмыс жіберілді. Шешім оқытушы тексергеннен кейін көрсетіледі."],
    FINAL_COMPLETED: ["Итоговая проверка пройдена. Результат и доступные документы показаны ниже.", "Қорытынды тексеру тапсырылды. Нәтиже мен қолжетімді құжаттар төменде көрсетілген."],
    ATTEMPT_LIMIT: ["Попытки исчерпаны. Обратитесь в учебный центр.", "Талпыныстар таусылды. Оқу орталығына хабарласыңыз."],
    ASSESSMENT_EXPIRED: ["Срок итоговой проверки завершён. Учебный центр должен уточнить условия дальнейшего обучения.", "Қорытынды тексеру мерзімі аяқталды. Оқу орталығы әрі қарай оқу шарттарын нақтылауы керек."],
    ROUTE_REVIEW_REQUIRED: ["Учебный центр должен подтвердить условия итоговой аттестации.", "Оқу орталығы қорытынды аттестаттау шарттарын растауы керек."],
    ROUTE_EXPIRED: ["Срок действия условий аттестации истёк или ещё не наступил. Обратитесь в учебный центр.", "Аттестаттау шарттарының мерзімі аяқталды немесе әлі басталмады. Оқу орталығына хабарласыңыз."],
    WAITING_EXTERNAL: ["Учебный центр ожидает результат внешнего экзамена.", "Оқу орталығы сыртқы емтихан нәтижесін күтуде."],
    PROCTORING_REQUIRED: [
      "Откройте журнал контроля экзамена. Назначенный наблюдатель должен подтвердить вашу личность и присутствие в действующее время сессии.",
      "Емтиханды бақылау журналын ашыңыз. Тағайындалған бақылаушы сессияның қолданыстағы уақытында жеке басыңыз бен қатысуыңызды растауы керек.",
    ],
    IN_PERSON_PRACTICE_REQUIRED: [
      "Для допуска требуется подтверждение очной практики учебным центром.",
      "Рұқсат алу үшін оқу орталығының күндізгі практиканы растауы қажет.",
    ],
    PRACTICE_MODE_REQUIRED: [
      "Учебный центр должен определить допустимый способ подтверждения практики для этой программы.",
      "Оқу орталығы осы бағдарлама үшін практиканы растаудың рұқсат етілген тәсілін анықтауы керек.",
    ],
    PRACTICE_ASSIGNMENT_REQUIRED: [
      "В программе не определено практическое задание для допуска. Обратитесь в учебный центр.",
      "Бағдарламада рұқсатқа арналған практикалық тапсырма анықталмаған. Оқу орталығына хабарласыңыз.",
    ],
    PRACTICE_SESSION_REQUIRED: ["В программе не определено обязательное занятие для практики. Учебный центр должен уточнить программу.", "Бағдарламада практикаға арналған міндетті сабақ анықталмаған. Оқу орталығы бағдарламаны нақтылауы керек."],
    PRACTICE_REVIEW_REQUIRED: [
      "Дождитесь принятия обязательной практической работы преподавателем.",
      "Міндетті практикалық жұмысты оқытушының қабылдауын күтіңіз.",
    ],
  };
  return reason && messages[reason] ? t(...messages[reason]) : null;
}

export function MyCourses({ t }: { t: Translate }) {
  const [data, setData] = useState<Paged<Enrollment>>({ items: [], total: 0 });
  const [page, setPage] = useState(1),
    [refresh, setRefresh] = useState(0);
  const [error, setError] = useState<unknown>(null),
    [loading, setLoading] = useState(true);
  useEffect(() => {
    let alive = true;
    setLoading(true);
    void lms
      .enrollments(true, page)
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
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [page, refresh]);
  return (
    <>
      <LmsHeading title={t("Моё обучение", "Менің оқуым")} />
      <WorkspaceCompanion t={t} learner compact />
      {!!error && (
        <Notice>
          {lmsError(error, t)}
          <LmsErrorDiagnostic error={error} t={t} />
          <button onClick={() => setRefresh((v) => v + 1)}>
            {t("Повторить", "Қайталау")}
          </button>
        </Notice>
      )}
      <section className="panel lms-panel" aria-busy={loading}>
        <ul className="lms-list">
          {data.items.map((item) => (
            <li key={item.id}>
              <div>
                <div className="lms-list-title">
                  {t(
                    item.courseVersion?.content.titleRu || "",
                    item.courseVersion?.content.titleKz || "",
                  )}
                </div>
                <div className="lms-list-meta">
                  <span>{item.progressPercent || 0}%</span>
                  {item.courseVersion?.content.metadata?.durationDays && <span>{t("Продолжительность", "Ұзақтығы")}: {item.courseVersion.content.metadata.durationDays} {t("дней", "күн")}</span>}
                  {item.result && (
                    <Status
                      value={item.result.state || item.result.verdict}
                      t={t}
                    />
                  )}
                </div>
                <progress
                  className="lms-progress"
                  max={100}
                  value={item.progressPercent || 0}
                  aria-label={t("Прогресс курса", "Курс барысы")}
                />
              </div>
              <Link
                className="button primary lms-primary"
                href={`/learn/${item.id}`}
              >
                {item.status === "COMPLETED" || item.result?.verdict === "PASSED" ? t("Результат и документы", "Нәтиже және құжаттар") : item.progressPercent || item.lastLessonId ? t("Продолжить обучение", "Оқуды жалғастыру") : t("Начать обучение", "Оқуды бастау")}
              </Link>
            </li>
          ))}
        </ul>
        {!data.items.length && !loading && !error && (
          <p className="lms-empty">
            {t("Обучение ещё не назначено.", "Оқу әлі тағайындалмады.")}
            {" "}<Link href="/catalogue">{t("Выбрать программу", "Бағдарламаны таңдау")}</Link>{" · "}<Link href="/learn/applications">{t("Мои заявки", "Менің өтінімдерім")}</Link>
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
export function LearnerCourse({ id, t }: { id: string; t: Translate }) {
  const [data, setData] = useState<Learning | null>(null);
  const [lessonId, setLessonId] = useState("");
  const [error, setError] = useState<unknown>(null),
    [busy, setBusy] = useState(false);
  const [attempt, setAttempt] = useState<Attempt | null>(null);
  const [view, setView] = useState<"lesson" | "result">("lesson");
  const [documentRevision, setDocumentRevision] = useState(0);
  const loadSequence = useRef(0);
  async function load() {
    const request = ++loadSequence.current;
    try {
      const value = await lms.learning(id);
      if (request !== loadSequence.current) return;
      setData(value);
      setDocumentRevision((revision) => revision + 1);
      setError(null);
      const elements = value.content.modules.flatMap((module) => module.lessons);
      const lastIncomplete = [...(value.progress || [])].sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || "")).find((progress) => elements.some((item) => item.id === progress.lessonId && !item.completed && !item.locked));
      const queryLesson = new URLSearchParams(window.location.search).get("lessonId");
      setLessonId((current) => elements.some((item) => item.id === current) ? current : (elements.some((item) => item.id === queryLesson) ? queryLesson : null) || lastIncomplete?.lessonId || elements.find((item) => !item.completed && !item.locked)?.id || elements[0]?.id || "");
      if (!elements.some((item) => item.required && !item.completed)) setView("result");
      const active = value.attempts.find((a) => a.state === "IN_PROGRESS");
      if (active) setAttempt(active);
    } catch (caught) {
      if (request === loadSequence.current) setError(caught);
    }
  }
  useEffect(() => {
    void load();
    return () => { loadSequence.current++; };
  }, [id]);
  useEffect(() => {
    if (!data || !(data.attempts.some((item) => item.state === "AWAITING_REVIEW") || data.documents.some((item) => !["ISSUED", "VOIDED", "SUPERSEDED"].includes(item.status)) || (!data.documents.length && data.results.some((item) => item.eligible && item.verdict === "PASSED")))) return;
    const refresh = () => { if (document.visibilityState === "visible") void load(); };
    const timer = setInterval(refresh, 20000);
    window.addEventListener("focus", refresh);
    return () => { clearInterval(timer); window.removeEventListener("focus", refresh); };
  }, [id, data?.attempts.some((item) => item.state === "AWAITING_REVIEW"), data?.documents.map((item) => item.status).join(","), data?.results.map((item) => `${item.id}:${item.eligible}:${item.verdict}`).join(",")]);
  async function start() {
    if (busy) return;
    setBusy(true);
    try {
      setAttempt(await lms.startAttempt(id));
      setError(null);
    } catch (caught) {
      setError(caught);
    } finally {
      setBusy(false);
    }
  }
  if (!data)
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
  const lessons = data.content.modules.flatMap((m) => m.lessons);
  const lesson = lessons.find((l) => l.id === lessonId);
  const done = (id: string) =>
    lessons.some(
      (item) =>
        item.id === id && "completed" in item && item.completed === true,
    ) ||
    data.progress?.some(
      (p) => p.lessonId === id && (p.completedAt || p.completed),
    );
  return (
    <>
      <LmsHeading title={t(data.content.titleRu, data.content.titleKz)}>
        <Link className="button" href="/learn">
          {t("Мои курсы", "Менің курстарым")}
        </Link>
      </LmsHeading>
      {data.content.metadata?.durationDays && <p className="lms-list-meta">{t("Продолжительность программы", "Бағдарламаның ұзақтығы")}: {data.content.metadata.durationDays} {t("дней", "күн")} · {data.content.hours} {t("часов занятий", "оқу сағаты")}</p>}
      {!!error && (
        <Notice>
          {lmsError(error, t)}
          <LmsErrorDiagnostic error={error} t={t} />
        </Notice>
      )}
      {data.profile.requiresProctoring && <details className="panel lms-panel"><summary>{t("Условия и журнал контроля экзамена", "Емтиханды бақылау шарттары мен журналы")}</summary><ProctoringSession enrollmentId={id} t={t} /></details>}
      {data.examReadiness?.reasonCode === "ACCESS_CLOSED" && (
        <Notice>
          {data.status === "CANCELLED"
            ? t(
                "Назначение отменено. Для продолжения обратитесь в учебный центр.",
                "Тағайындау жойылды. Жалғастыру үшін оқу орталығына хабарласыңыз.",
              )
            : data.startsAt && Date.parse(data.startsAt) > Date.now()
              ? `${t("Обучение начнётся", "Оқу басталады")}: ${new Date(data.startsAt).toLocaleString(t("ru-RU", "kk-KZ"))}`
              : `${t("Период доступа завершён", "Қолжетімділік мерзімі аяқталды")}${data.dueAt ? `: ${new Date(data.dueAt).toLocaleString(t("ru-RU", "kk-KZ"))}` : ""}. ${t("Для продления обратитесь в учебный центр.", "Ұзарту үшін оқу орталығына хабарласыңыз.")}`}
        </Notice>
      )}
      {data.prerequisites?.some((item) => !item.satisfied) && (
        <section className="panel lms-panel">
          <h2>
            {t(
              "Сначала завершите базовое обучение",
              "Алдымен негізгі оқуды аяқтаңыз",
            )}
          </h2>
          <ul>
            {data.prerequisites
              .filter((item) => !item.satisfied)
              .map((item) => (
                <li key={item.courseId}>
                  <strong>
                    {t(
                      item.titleRu || "Базовая программа",
                      item.titleKz || "Негізгі бағдарлама",
                    )}
                  </strong>
                  {" · "}
                  {item.basis === "OFFICIAL_RESULT"
                    ? t(
                        "Нужен действующий подтверждённый результат аттестации.",
                        "Қолданыстағы расталған аттестаттау нәтижесі қажет.",
                      )
                    : item.basis === "LEARNING_COMPLETION"
                      ? t(
                          "Нужно завершить программу, включая её итоговый тест.",
                          "Бағдарламаны қорытынды тестімен бірге аяқтау қажет.",
                        )
                      : t(
                          "Нужно завершить обязательные учебные элементы.",
                          "Міндетті оқу элементтерін аяқтау қажет.",
                        )}{" "}
                  {item.enrollmentId ? (
                    <Link href={`/learn/${item.enrollmentId}`}>
                      {t("Открыть базовый курс", "Негізгі курсты ашу")}
                    </Link>
                  ) : (
                    t(
                      "Обратитесь в учебный центр для назначения.",
                      "Тағайындау үшін оқу орталығына хабарласыңыз.",
                    )
                  )}
                </li>
              ))}
          </ul>
        </section>
      )}
      {attempt ? (
        <Exam
          key={attempt.id}
          initial={attempt}
          t={t}
          onFinished={() => {
            setAttempt(null);
            void load();
          }}
        />
      ) : (
        <>
          <nav className="lms-learning-tabs" aria-label={t("Обучение и результат", "Оқу және нәтиже")}>
            <button type="button" aria-current={view === "lesson" ? "step" : undefined} onClick={() => setView("lesson")}>{t("Материалы и задания", "Материалдар мен тапсырмалар")}</button>
            <button type="button" aria-current={view === "result" ? "step" : undefined} onClick={() => setView("result")}>{t("Итоговая проверка и документы", "Қорытынды тексеру және құжаттар")}</button>
          </nav>
          <div className="lms-learning-layout" hidden={view !== "lesson"}>
            <aside
              className="panel lms-outline"
              aria-label={t("Содержание курса", "Курс мазмұны")}
            >
              <progress
                className="lms-progress"
                max={100}
                value={data.progressPercent || 0}
                aria-label={t("Прогресс курса", "Курс барысы")}
              />
              <span>{data.progressPercent || 0}%</span>
              {data.content.modules.map((module) => (
                <section key={module.id}>
                  <h2>{t(module.titleRu, module.titleKz)}</h2>
                  {module.lessons.map((item) => (
                    <button
                      key={item.id}
                      title={
                        item.locked
                          ? lockExplanation(item.lockReason, t)
                          : undefined
                      }
                      aria-current={lessonId === item.id ? "step" : undefined}
                      onClick={() => setLessonId(item.id)}
                    >
                      {done(item.id) ? "✓ " : ""}
                      {item.locked ? "🔒 " : ""}
                      {t(item.titleRu, item.titleKz)}
                      {item.required && (
                        <span aria-label={t("Обязательный", "Міндетті")}>
                          {" "}
                          *
                        </span>
                      )}
                    </button>
                  ))}
                </section>
              ))}
            </aside>
            {lesson && (
              <Lesson
                key={lesson.id}
                enrollmentId={id}
                lesson={lesson}
                locked={
                  lesson.locked ||
                  lesson.prerequisiteLessonIds.some(
                    (prerequisite) => !done(prerequisite),
                  )
                }
                lockReason={lesson.lockReason}
                requiredBefore={[
                  ...lesson.prerequisiteLessonIds
                    .filter((id) => !done(id))
                    .map((id) => lessons.find((item) => item.id === id))
                    .filter((item): item is typeof lesson => !!item)
                    .map((item) => t(item.titleRu, item.titleKz)),
                  ...(
                    data.content.modules.find((module) =>
                      module.lessons.some((item) => item.id === lesson.id),
                    )?.prerequisiteModuleIds || []
                  )
                    .map((id) =>
                      data.content.modules.find((module) => module.id === id),
                    )
                    .filter(
                      (module) =>
                        !!module &&
                        module.lessons.some(
                          (item) => item.required && !done(item.id),
                        ),
                    )
                    .map((module) => t(module!.titleRu, module!.titleKz)),
                ]}
                progress={data.progress?.find((p) => p.lessonId === lesson.id)}
                completedFromCourse={!!done(lesson.id)}
                t={t}
                onProgress={(value) => {
                  if (
                    (value.completedAt || value.completed) &&
                    !done(value.lessonId)
                  )
                    void load();
                  setData((current) => {
                    if (!current) return current;
                    const progress = [
                      ...(current.progress || []).filter(
                        (p) => p.lessonId !== value.lessonId,
                      ),
                      value,
                    ];
                    const required = lessons.filter((l) => l.required);
                    const progressPercent = required.length
                      ? Math.floor(
                          (100 *
                            required.filter(
                              (l) =>
                                l.completed ||
                                progress.some(
                                  (p) =>
                                    p.lessonId === l.id &&
                                    (p.completedAt || p.completed),
                                ),
                            ).length) /
                            required.length,
                        )
                      : 100;
                    return { ...current, progress, progressPercent };
                  });
                }}
                onReload={load}
                lastLesson={lessons[lessons.length - 1]?.id === lesson.id}
                onNext={() => {
                  const next =
                    lessons[lessons.findIndex((l) => l.id === lesson.id) + 1];
                  if (next) setLessonId(next.id);
                  else setView("result");
                }}
              />
            )}
          </div>
          <section className="panel lms-panel" hidden={view !== "result"}>
            <h2>{t("Результат обучения", "Оқу нәтижесі")}</h2>
            {"learningCompletion" in data && !!data.learningCompletion && (
              <p role="status">
                {t("Учебная программа завершена", "Оқу бағдарламасы аяқталды")}
              </p>
            )}
            {data.attempts.some((item) => item.state === "AWAITING_REVIEW") && (
              <p role="status">
                {t(
                  "Итоговая работа отправлена. Ожидаем проверку преподавателя.",
                  "Қорытынды жұмыс жіберілді. Оқытушының тексеруін күтеміз.",
                )}
              </p>
            )}
            {data.results.map((result) => (
              <p key={result.id}>
                <Status value={result.state || result.verdict} t={t} /> ·{" "}
                <Status value={result.assessmentKind} t={t} />
                {result.score != null
                  ? ` · ${result.score}/${result.maximum}`
                  : ""}
              </p>
            ))}
            {data.attempts.filter(item => item.state !== "IN_PROGRESS").map(item => <p key={item.id}>
              <button type="button" onClick={() => setAttempt(item)}>{t("Разобрать попытку", "Талпынысты талдау")} {item.ordinal}</button>
            </p>)}
            {data.profile.assessmentKind === "EXTERNAL_AUTHORIZED" ? (
              <p>
                {t(
                  "Ожидается результат внешнего экзамена.",
                  "Сыртқы емтихан нәтижесі күтілуде.",
                )}
              </p>
            ) : (
              <>
              {!data.attempts.some((item) => item.state === "AWAITING_REVIEW") && !("learningCompletion" in data && !!data.learningCompletion) && <p>
                {t("Вопросов", "Сұрақтар")}: {data.content.exam.questionCount} · {t("Время", "Уақыт")}: {data.content.exam.durationMinutes} {t("мин.", "мин.")} · {t("Осталось попыток", "Қалған талпыныстар")}: {data.examReadiness?.remainingAttempts ?? Math.max(0, data.content.exam.maxAttempts - data.attempts.length)}.
                {" "}{t("Время отсчитывается с нажатия кнопки начала.", "Уақыт бастау батырмасын басқаннан бастап есептеледі.")}
              </p>}
              <button
                className="primary lms-primary"
                disabled={
                  busy ||
                  !data.examReadiness?.ready ||
                  data.attempts.some(
                    (item) => item.state === "AWAITING_REVIEW",
                  ) ||
                  ("learningCompletion" in data && !!data.learningCompletion) ||
                  data.attempts.length >= data.content.exam.maxAttempts
                }
                onClick={() => void start()}
              >
                {busy
                  ? t("Открываем…", "Ашылуда…")
                  : data.attempts.length
                    ? t("Повторить попытку", "Қайта тапсыру")
                    : data.content.learningOutcome === "LEARNING"
                      ? t("Начать итоговый тест", "Қорытынды тестті бастау")
                      : data.profile.assessmentKind === "PRACTICE"
                        ? t("Начать учебный тест", "Жаттығу тестін бастау")
                        : t("Начать экзамен", "Емтиханды бастау")}
              </button>
              </>
            )}
            {!data.examReadiness?.ready && (
              <div className="lms-save-state">
                <p>
                  {finalRequirement(data.examReadiness?.reasonCode, t) ||
                    (data.examReadiness?.reasonCode === "ACCESS_CLOSED" ||
                    data.prerequisites?.some((item) => !item.satisfied)
                      ? lockExplanation(
                          data.examReadiness?.reasonCode === "ACCESS_CLOSED"
                            ? "ACCESS_CLOSED"
                            : "COURSE_PREREQUISITE_REQUIRED",
                          t,
                        )
                      : t(
                          "Сначала завершите обязательные учебные элементы.",
                          "Алдымен міндетті оқу элементтерін аяқтаңыз.",
                        ))}
                  {data.examReadiness &&
                    ` ${data.examReadiness.completedCount}/${data.examReadiness.requiredCount}`}
                </p>
                <ul>
                  {lessons
                    .filter((item) =>
                      data.examReadiness?.missingLessonIds.includes(item.id),
                    )
                    .map((item) => (
                      <li key={item.id}>
                        <button onClick={() => { setLessonId(item.id); setView("lesson"); }}>
                          {t(item.titleRu, item.titleKz)}
                        </button>
                        {" · "}
                        {item.kind === "ASSIGNMENT"
                          ? data.examReadiness?.missingSubmissionStates?.[item.id] === "SUBMITTED" ? t("Отправлено. Ожидает преподавателя", "Жіберілді. Оқытушыны күтуде") : data.examReadiness?.missingSubmissionStates?.[item.id] === "RETURNED" ? t("Вернул преподаватель — исправьте замечания", "Оқытушы қайтарды — ескертулерді түзетіңіз") : t(
                              "Нужна принятая преподавателем работа",
                              "Оқытушы қабылдаған жұмыс қажет",
                            )
                          : item.kind === "SESSION" &&
                              item.session?.attendanceRequired
                            ? t(
                                "Нужно подтверждение участия преподавателем",
                                "Оқытушының қатысуды растауы қажет",
                              )
                            : item.kind === "ASSESSMENT"
                              ? t(
                                  "Нужно пройти промежуточную проверку",
                                  "Аралық тексеруден өту қажет",
                                )
                              : t("Не завершено", "Аяқталмады")}
                      </li>
                    ))}
                </ul>
              </div>
            )}
            {data.attempts.length >= data.content.exam.maxAttempts &&
              !data.results.some((r) => r.verdict === "PASSED") && (
                <p>
                  {t(
                    "Попытки исчерпаны. Обратитесь в учебный центр.",
                    "Талпыныстар таусылды. Оқу орталығына хабарласыңыз.",
                  )}
                </p>
              )}
            {data.documents.map((document) => (
              <LmsDocument key={document.id} id={document.id} revision={documentRevision} learner t={t} />
            ))}
          </section>
        </>
      )}
    </>
  );
}
function Lesson({
  enrollmentId,
  lesson,
  locked,
  lockReason,
  requiredBefore,
  progress,
  t,
  onProgress,
  onNext,
  onReload,
  lastLesson,
  completedFromCourse,
}: {
  enrollmentId: string;
  lesson: LmsLesson;
  locked?: boolean;
  lockReason?: string | null;
  requiredBefore: string[];
  progress?: LessonProgress;
  t: Translate;
  onProgress: (value: LessonProgress) => void;
  onNext: () => void;
  onReload: () => Promise<void>;
  lastLesson: boolean;
  completedFromCourse: boolean;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const sequence = useRef(progress?.sequence || 0);
  const queue = useRef(Promise.resolve());
  const last = useRef(0);
  const interactionAt = useRef(0);
  const furthestPlayback = useRef(progress?.positionSeconds || 0);
  const [error, setError] = useState<unknown>(null),
    [busy, setBusy] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [materialError, setMaterialError] = useState(false);
  useEffect(() => {
    if ((progress?.sequence || 0) > sequence.current) {
      sequence.current = progress!.sequence!;
      setConflict(false);
      setError(null);
    }
  }, [progress?.sequence]);
  const completed = completedFromCourse || !!(progress?.completedAt || progress?.completed);
  const historicalWork = lockReason === "ACCESS_CLOSED";
  useEffect(() => {
    if (locked || !["TEXT", "PDF", "FILE", "LINK", "VIDEO"].includes(lesson.kind)) return;
    const interact = () => { interactionAt.current = Date.now(); };
    const tick = setInterval(() => { if (lesson.kind !== "VIDEO" && document.visibilityState === "visible" && Date.now() - interactionAt.current < 30000 && !conflict) void save(0, false).catch(() => {}); }, 10000);
    const visibility = () => { if (document.visibilityState !== "visible") { interactionAt.current = 0; if (!conflict) void save(video.current?.currentTime || 0, false).catch(() => {}); } };
    window.addEventListener("pointerdown", interact); window.addEventListener("keydown", interact); window.addEventListener("scroll", interact, true);
    document.addEventListener("visibilitychange", visibility);
    return () => { clearInterval(tick); window.removeEventListener("pointerdown", interact); window.removeEventListener("keydown", interact); window.removeEventListener("scroll", interact, true); document.removeEventListener("visibilitychange", visibility); };
  }, [enrollmentId, lesson.id, locked, conflict]);
  function save(positionSeconds = 0, playing = false, acknowledge = false) {
    const task = async () => {
      try {
        const value = await lms.progress(enrollmentId, lesson.id, {
          sequence: sequence.current + 1,
          positionSeconds,
          playing,
          acknowledge,
          playbackRate: video.current?.playbackRate || 1,
          interacting: document.visibilityState === "visible" && Date.now() - interactionAt.current < 30000,
        });
        sequence.current = value.sequence || sequence.current + 1;
        onProgress(value);
        setError(null);
      } catch (caught) {
        if (
          caught instanceof Error &&
          "status" in caught &&
          caught.status === 409
        )
          setConflict(true);
        setError(caught);
        throw caught;
      }
    };
    const next = queue.current.catch(() => {}).then(task);
    queue.current = next;
    return next;
  }
  async function acknowledge() {
    if (busy) return;
    setBusy(true);
    try {
      await save(0, false, true);
      onNext();
    } catch {
      /* Error stays with lesson. */
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="panel lms-lesson">
      <h2>{t(lesson.titleRu, lesson.titleKz)}</h2>
      {!!progress?.activeSeconds && <p className="muted">{t("Активное взаимодействие", "Белсенді әрекеттесу")}: {Math.floor(progress.activeSeconds / 60)} {t("мин", "мин")} {progress.activeSeconds % 60} {t("с", "с")}</p>}
      {materialError && <Notice>{t("Видео не загрузилось. Ваш прогресс сохранён.", "Бейне жүктелмеді. Оқу барысы сақталған.")} <button type="button" onClick={() => { setMaterialError(false); video.current?.load(); }}>{t("Повторить загрузку видео", "Бейнені қайта жүктеу")}</button></Notice>}
      {!!error && (
        <Notice>
          {lmsError(error, t)}
          <LmsErrorDiagnostic error={error} t={t} />
          <button
            onClick={() =>
              conflict
                ? void onReload()
                : void save(video.current?.currentTime || 0, false).catch(
                    () => {},
                  )
            }
          >
            {conflict
              ? t("Обновить прогресс", "Барысты жаңарту")
              : t("Повторить", "Қайталау")}
          </button>
        </Notice>
      )}
      {locked && (
        <p>
          {lockExplanation(lockReason, t)}
          {lockReason === "PREREQUISITE_REQUIRED" &&
            requiredBefore.length > 0 &&
            ` ${requiredBefore.join("; ")}`}
        </p>
      )}
      {!locked && lesson.kind === "VIDEO" && lesson.materialId && (
        <video
          ref={video}
          controls
          playsInline
          preload="metadata"
          src={`/api/lms/materials/${lesson.materialId}`}
          onLoadedMetadata={() => {
            setMaterialError(false);
            if (video.current && progress?.positionSeconds)
              video.current.currentTime = progress.positionSeconds;
          }}
          onError={() => setMaterialError(true)}
          onPlay={(event) =>
            void save(event.currentTarget.currentTime, false).catch(() => {})
          }
          onRateChange={(event) => {
            const rates = lesson.videoPolicy?.playbackRates;
            if (
              rates?.length &&
              !rates.includes(event.currentTarget.playbackRate)
            )
              event.currentTarget.playbackRate = rates.includes(1)
                ? 1
                : rates[0];
          }}
          onSeeking={(event) => {
            if (
              lesson.videoPolicy?.allowSeekAhead === false &&
              event.currentTarget.currentTime > furthestPlayback.current + 1
            )
              event.currentTarget.currentTime = furthestPlayback.current;
          }}
          onTimeUpdate={(event) => {
            if (!event.currentTarget.seeking && !event.currentTarget.paused)
              furthestPlayback.current = Math.max(
                furthestPlayback.current,
                event.currentTarget.currentTime,
              );
            if (
              Date.now() - last.current < 5000 ||
              event.currentTarget.paused ||
              event.currentTarget.seeking
            )
              return;
            last.current = Date.now();
            void save(event.currentTarget.currentTime, true).catch(() => {});
          }}
          onSeeked={(event) =>
            void save(event.currentTarget.currentTime, false).catch(() => {})
          }
          onPause={(event) =>
            void save(event.currentTarget.currentTime, true).catch(() => {})
          }
          onEnded={(event) =>
            void save(event.currentTarget.currentTime, true).catch(() => {})
          }
        >
          {lesson.subtitles?.map((subtitle, index) => (
            <track
              key={subtitle.materialId}
              kind="subtitles"
              src={`/api/lms/materials/${subtitle.materialId}`}
              srcLang={subtitle.language}
              label={subtitle.label}
              default={index === 0}
            />
          ))}
        </video>
      )}
      {!locked && lesson.kind === "PDF" && lesson.materialId && (
        <p>
          <a
            className="button"
            href={`/api/lms/materials/${lesson.materialId}`}
            target="_blank"
            rel="noopener noreferrer"
          >
            {t("Открыть материал PDF", "PDF материалын ашу")}
          </a>
        </p>
      )}
      {!locked && lesson.kind === "FILE" && lesson.materialId && (
        <p>
          <a
            className="button"
            href={`/api/lms/materials/${lesson.materialId}`}
            target="_blank"
            rel="noopener noreferrer"
          >
            {t("Открыть учебный файл", "Оқу файлын ашу")}
          </a>
        </p>
      )}
      {!locked && lesson.kind === "LINK" && lesson.url && (
        <p>
          <a
            className="button"
            href={lesson.url}
            target="_blank"
            rel="noopener noreferrer"
          >
            {t("Открыть материал", "Материалды ашу")}
          </a>
        </p>
      )}
      {(!locked || historicalWork) && lesson.kind === "ASSESSMENT" && (
        <LearnerAssessment
          enrollmentId={enrollmentId}
          lessonId={lesson.id}
          t={t}
          onFinished={() => void onReload()}
        />
      )}
      {(!locked || historicalWork) && lesson.kind === "ASSIGNMENT" && (
        <LearnerSubmissionForm
          enrollmentId={enrollmentId}
          lessonId={lesson.id}
          allowText={lesson.assignment?.allowText}
          allowFiles={lesson.assignment?.allowFiles}
          t={t}
          onSubmitted={() => void onReload()}
        />
      )}
      {(!locked || historicalWork) && lesson.kind === "SESSION" && (
        <LearnerSession
          enrollmentId={enrollmentId}
          lessonId={lesson.id}
          t={t}
        />
      )}
      {!locked && (
        <div className="lms-prose">{t(lesson.textRu, lesson.textKz)}</div>
      )}
      <div className="lms-editor-actions">
        {locked ? null : completed ? (
          <>
            <Status value="COMPLETED" t={t} />
            <button className="primary lms-primary" onClick={onNext}>
              {lastLesson ? t("К итоговой проверке", "Қорытынды тексеруге") : t("Следующий урок", "Келесі сабақ")}
            </button>
          </>
        ) : ["TEXT", "PDF", "FILE", "LINK"].includes(lesson.kind) ||
          (lesson.kind === "SESSION" && !lesson.session?.attendanceRequired) ? (
          <button
            className="primary lms-primary"
            disabled={busy}
            onClick={() => void acknowledge()}
          >
            {busy
              ? t("Сохраняем…", "Сақталуда…")
              : t("Изучено, дальше", "Оқыдым, келесі")}
          </button>
        ) : lesson.kind === "VIDEO" ? (
          <span className="lms-save-state">
            {t(
              "Просмотр сохраняется автоматически",
              "Көру барысы автоматты сақталады",
            )}
          </span>
        ) : null}
      </div>
    </section>
  );
}
