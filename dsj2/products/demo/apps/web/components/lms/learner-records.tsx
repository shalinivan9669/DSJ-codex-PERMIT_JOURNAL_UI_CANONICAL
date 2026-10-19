"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Notice } from "@demo/ui";
import { lms, type Enrollment, type Learning, type Paged } from "@/lib/lms-api";
import { LmsDocument } from "./documents";
import {
  LmsErrorDiagnostic,
  LmsHeading,
  PageControls,
  Status,
  lmsError,
  type Translate,
} from "./common";

type RecordsView = "results" | "documents" | "tests";
type OwnEnrollment = Omit<Enrollment, "result"> & {
  result?: (NonNullable<Enrollment["result"]> & { examAt?: string | null }) | null;
};

function recordDate(value: string, t: Translate) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? t("Дата уточняется", "Күні нақтылануда")
    : date.toLocaleDateString(t("ru-RU", "kk-KZ"));
}

function admissionMessage(data: Learning, t: Translate) {
  if (data.examReadiness.ready)
    return t("Условия допуска выполнены.", "Қатысу шарттары орындалды.");
  const messages: Record<string, [string, string]> = {
    AWAITING_REVIEW: ["Работа отправлена и ожидает решения преподавателя.", "Жұмыс жіберілді, оқытушы шешімі күтілуде."],
    FINAL_COMPLETED: ["Итоговая проверка пройдена.", "Қорытынды тексеру тапсырылды."],
    ACCESS_CLOSED: ["Учебный доступ закрыт. Условия доступа указаны в программе.", "Оқуға қолжетімділік жабық. Қолжетімділік шарттары бағдарламада көрсетілген."],
    COURSE_PREREQUISITE_REQUIRED: ["Сначала завершите обязательную базовую программу.", "Алдымен міндетті негізгі бағдарламаны аяқтаңыз."],
    ATTEMPT_LIMIT: ["Попытки исчерпаны. Обратитесь в учебный центр.", "Талпыныстар таусылды. Оқу орталығына хабарласыңыз."],
    ASSESSMENT_EXPIRED: ["Срок итоговой проверки завершён.", "Қорытынды тексеру мерзімі аяқталды."],
    WAITING_EXTERNAL: ["Ожидается результат внешнего экзамена.", "Сыртқы емтихан нәтижесі күтілуде."],
    PRACTICE_REVIEW_REQUIRED: ["Дождитесь принятия обязательной практической работы.", "Міндетті практикалық жұмыстың қабылдануын күтіңіз."],
    IN_PERSON_PRACTICE_REQUIRED: ["Учебному центру нужно подтвердить очную практику.", "Оқу орталығы күндізгі практиканы растауы керек."],
    PROCTORING_REQUIRED: ["Учебному центру нужно подтвердить условия прокторинга.", "Оқу орталығы прокторинг шарттарын растауы керек."],
    ROUTE_REVIEW_REQUIRED: ["Учебному центру нужно подтвердить условия аттестации.", "Оқу орталығы аттестаттау шарттарын растауы керек."],
    ROUTE_EXPIRED: ["Период действия условий аттестации требует уточнения учебным центром.", "Оқу орталығы аттестаттау шарттарының қолданылу мерзімін нақтылауы керек."],
  };
  const reason = data.examReadiness.reasonCode;
  return reason && messages[reason]
    ? t(...messages[reason])
    : t("Откройте программу, чтобы увидеть оставшиеся условия допуска.", "Қалған қатысу шарттарын көру үшін бағдарламаны ашыңыз.");
}

function OwnAssessments({ data, t }: { data: Learning; t: Translate }) {
  const lessons = data.content.modules.flatMap((module) => module.lessons);
  const assessments = lessons.filter((lesson) => !!lesson.assessment);
  const finalAttempts = data.attempts.filter((attempt) => attempt.purpose === "FINAL");
  const active = finalAttempts.find((attempt) => attempt.state === "IN_PROGRESS");
  const finalTitle = data.profile.assessmentKind === "EXTERNAL_AUTHORIZED"
    ? t("Внешняя аттестация", "Сыртқы аттестаттау")
    : data.profile.assessmentKind === "PRACTICE"
      ? t("Практическая проверка", "Практикалық тексеру")
      : t("Итоговая проверка", "Қорытынды тексеру");
  return (
    <div className="lms-prose">
      {assessments.length > 0 && <>
        <h3>{t("Проверки в уроках", "Сабақтардағы тексерулер")}</h3>
        <ul className="lms-list">
          {assessments.map((lesson) => <li key={lesson.id}>
            <div>
              <strong>{t(lesson.titleRu, lesson.titleKz)}</strong>
              <p>{lesson.completed
                ? t("Завершено", "Аяқталды")
                : lesson.locked
                  ? t("Сначала выполните предыдущие условия программы.", "Алдымен бағдарламаның алдыңғы шарттарын орындаңыз.")
                  : t("Результат и условия прохождения — в уроке.", "Нәтиже мен өту шарттары сабақта көрсетілген.")}</p>
            </div>
            <Link className="button" href={`/learn/${encodeURIComponent(data.id)}?lessonId=${encodeURIComponent(lesson.id)}`}>
              {t("Открыть урок", "Сабақты ашу")}
            </Link>
          </li>)}
        </ul>
      </>}
      <h3>{finalTitle}</h3>
      <p role="status">{active
        ? t("Есть незавершённая попытка. Продолжите её в программе.", "Аяқталмаған талпыныс бар. Оны бағдарламада жалғастырыңыз.")
        : admissionMessage(data, t)}</p>
      {data.examReadiness.remainingAttempts !== undefined && data.profile.assessmentKind !== "EXTERNAL_AUTHORIZED" && <p>
        {t("Осталось попыток", "Қалған талпыныстар")}: {data.examReadiness.remainingAttempts}
      </p>}
      {!!data.examReadiness.missingLessonIds.length && <ul>
        {lessons.filter((lesson) => data.examReadiness.missingLessonIds.includes(lesson.id)).map((lesson) => <li key={lesson.id}>
          <Link href={`/learn/${encodeURIComponent(data.id)}?lessonId=${encodeURIComponent(lesson.id)}`}>
            {t(lesson.titleRu, lesson.titleKz)}
          </Link>
          {data.examReadiness.missingSubmissionStates?.[lesson.id] === "SUBMITTED"
            ? ` · ${t("Ожидает проверки", "Тексеруді күтуде")}`
            : data.examReadiness.missingSubmissionStates?.[lesson.id] === "RETURNED"
              ? ` · ${t("Вернул преподаватель", "Оқытушы қайтарды")}`
              : ""}
        </li>)}
      </ul>}
      <Link className="button primary lms-primary" href={`/learn/${encodeURIComponent(data.id)}`}>
        {active ? t("Продолжить попытку", "Талпынысты жалғастыру") : t("Открыть проверку в программе", "Бағдарламадағы тексеруді ашу")}
      </Link>
    </div>
  );
}

export function OwnLearningRecords({ t, view }: { t: Translate; view: RecordsView }) {
  const [data, setData] = useState<Paged<OwnEnrollment> | null>(null);
  const [paging, setPaging] = useState({ view, page: 1 });
  const page = paging.view === view ? paging.page : 1;
  const [refresh, setRefresh] = useState(0);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<Learning | null>(null);
  const [detailError, setDetailError] = useState<unknown>(null);

  useEffect(() => {
    const update = () => { if (!document.hidden) setRefresh((value) => value + 1); };
    window.addEventListener("focus", update);
    return () => window.removeEventListener("focus", update);
  }, []);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setData(null);
    setError(null);
    void lms.enrollments(true, page)
      .then((value) => {
        if (!alive) return;
        setData(value);
        setSelected((current) => value.items.some((item) => item.id === current) ? current : null);
      })
      .catch((caught) => { if (alive) setError(caught); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [page, view, refresh]);

  useEffect(() => {
    let alive = true;
    setDetail(null);
    setDetailError(null);
    if (view === "tests" && selected) {
      void lms.learning(selected)
        .then((value) => { if (alive) setDetail(value); })
        .catch((caught) => { if (alive) setDetailError(caught); });
    }
    return () => { alive = false; };
  }, [view, selected, refresh]);

  const title = view === "documents"
    ? t("Мои документы", "Менің құжаттарым")
    : view === "tests"
      ? t("Мои тесты и проверки", "Менің тесттерім мен тексерулерім")
      : t("Мои результаты", "Менің нәтижелерім");
  return (
    <>
      <LmsHeading title={title}>
        <button type="button" disabled={loading} onClick={() => setRefresh((value) => value + 1)}>
          {t("Обновить", "Жаңарту")}
        </button>
      </LmsHeading>
      {!!error && <Notice>
        {lmsError(error, t)}
        <LmsErrorDiagnostic error={error} t={t} />
        <button type="button" onClick={() => setRefresh((value) => value + 1)}>{t("Повторить", "Қайталау")}</button>
      </Notice>}
      <div aria-busy={loading}>
        {loading && <p role="status">{t("Открываем ваше обучение…", "Сіздің оқуыңыз ашылуда…")}</p>}
        {data?.items.map((item) => {
          const courseTitle = t(item.courseVersion?.content.titleRu || "Программа обучения", item.courseVersion?.content.titleKz || "Оқу бағдарламасы");
          const progress = Math.max(0, Math.min(100, item.progressPercent || 0));
          const result = item.result;
          const documents = item.documents || [];
          return <section className="panel lms-panel" key={item.id}>
            <h2><Link href={`/learn/${encodeURIComponent(item.id)}`}>{courseTitle}</Link></h2>
            {view === "results" && <>
              <div className="lms-list-meta">
                {result ? <Status value={result.state || result.status || result.verdict} t={t} /> : <span>{t("Результата пока нет", "Нәтиже әлі жоқ")}</span>}
                <span>{t("Пройдено", "Өтілді")}: {progress}%</span>
                {result?.score != null && result.maximum != null && <span>{t("Баллы", "Ұпайлар")}: {result.score} / {result.maximum}</span>}
              </div>
              <progress className="lms-progress" max={100} value={progress} aria-label={`${t("Прогресс программы", "Бағдарлама барысы")}: ${courseTitle}`} />
              {result?.examAt && <p>{t("Дата проверки", "Тексеру күні")}: <time dateTime={result.examAt}>{recordDate(result.examAt, t)}</time></p>}
              {!result && item.status === "CANCELLED" && <p><Status value={item.status} t={t} /></p>}
              <Link className="button" href={`/learn/${encodeURIComponent(item.id)}`}>{t("Открыть обучение и результат", "Оқу мен нәтижені ашу")}</Link>
            </>}
            {view === "documents" && <>
              {documents.map((document) => <LmsDocument key={document.id} id={document.id} learner canPrepare={false} canAttest={false} revision={refresh} t={t} />)}
              {!documents.length && <p>{t("Документы по этой программе пока не оформлены.", "Бұл бағдарлама бойынша құжаттар әлі рәсімделмеді.")}</p>}
              <Link href={`/learn/${encodeURIComponent(item.id)}`}>{t("Открыть результат обучения", "Оқу нәтижесін ашу")}</Link>
            </>}
            {view === "tests" && <>
              <button type="button" className="button" aria-expanded={selected === item.id} aria-controls={`own-assessments-${item.id}`} onClick={() => setSelected((current) => current === item.id ? null : item.id)}>
                {selected === item.id ? t("Скрыть проверки", "Тексерулерді жасыру") : t("Показать тесты и условия", "Тесттер мен шарттарды көрсету")}
              </button>
              {selected === item.id && <div id={`own-assessments-${item.id}`}>
                {detailError ? <Notice>
                  {lmsError(detailError, t)}
                  <LmsErrorDiagnostic error={detailError} t={t} />
                  <button type="button" onClick={() => setRefresh((value) => value + 1)}>{t("Повторить", "Қайталау")}</button>
                </Notice> : detail?.id === item.id
                  ? <OwnAssessments data={detail} t={t} />
                  : <p role="status" aria-busy="true">{t("Открываем ваши проверки…", "Сіздің тексерулеріңіз ашылуда…")}</p>}
              </div>}
            </>}
          </section>;
        })}
        {data && !data.items.length && !loading && !error && <section className="panel lms-panel">
          <p>{t("Обучение ещё не назначено.", "Оқу әлі тағайындалмады.")}</p>
          <div className="lms-actions">
            <Link className="button" href="/catalogue">{t("Выбрать программу", "Бағдарламаны таңдау")}</Link>
            <Link href="/learn/applications">{t("Мои заявки", "Менің өтінімдерім")}</Link>
          </div>
        </section>}
      </div>
      {data && <PageControls page={page} total={data.total} pageSize={data.pageSize || 50} onPage={(next) => { setSelected(null); setPaging({ view, page: next }); }} t={t} />}
    </>
  );
}
