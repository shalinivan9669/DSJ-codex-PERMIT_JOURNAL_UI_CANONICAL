"use client";
import { useEffect, useState } from "react";
import { Notice } from "@demo/ui";
import { learningApi, type AssessmentItem } from "@/lib/learning-api";
import type { Attempt } from "@/lib/lms-api";
import { Exam } from "./exam";
import { LmsErrorDiagnostic, Status, lmsError, type Translate } from "./common";

function blockedReason(code: string | undefined, t: Translate) {
  const reasons: Record<string, [string, string]> = {
    ACCESS_CANCELLED: ["Назначение отменено. Обратитесь в учебный центр.", "Тағайындау жойылды. Оқу орталығына хабарласыңыз."],
    ACCESS_NOT_STARTED: ["Период доступа к обучению ещё не начался. Дата начала указана в курсе.", "Оқуға қолжетімділік кезеңі әлі басталмаған. Басталу күні курста көрсетілген."],
    ACCESS_EXPIRED: ["Период доступа к обучению завершён. Учебный центр может согласовать продление.", "Оқуға қолжетімділік кезеңі аяқталды. Оқу орталығы ұзартуды келісе алады."],
    ASSESSMENT_EXPIRED: ["Срок выполнения этого теста завершён. Обратитесь к преподавателю.", "Бұл тестті орындау мерзімі аяқталды. Оқытушыға хабарласыңыз."],
    ATTEMPT_LIMIT: ["Попытки использованы. Условия пересдачи уточните у преподавателя.", "Әрекеттер пайдаланылды. Қайта тапсыру шарттарын оқытушыдан нақтылаңыз."],
    PREREQUISITE_REQUIRED: ["Сначала завершите обязательные уроки, указанные перед этим тестом.", "Алдымен осы тест алдында көрсетілген міндетті сабақтарды аяқтаңыз."],
    PREVIOUS_MODULE_REQUIRED: ["Сначала завершите обязательные элементы предыдущего модуля.", "Алдымен алдыңғы модульдің міндетті элементтерін аяқтаңыз."],
    COURSE_PREREQUISITE_REQUIRED: ["Сначала завершите базовую программу, указанную в условиях курса.", "Алдымен курс шарттарында көрсетілген негізгі бағдарламаны аяқтаңыз."],
  };
  return t(...(reasons[code || ""] || ["Условия доступа показаны перед уроком. После их выполнения обновите курс.", "Қолжетімділік шарттары сабақ алдында көрсетілген. Оларды орындағаннан кейін курсты жаңартыңыз."]));
}

export function LearnerAssessment({
  enrollmentId,
  lessonId,
  t,
  onFinished,
}: {
  enrollmentId: string;
  lessonId: string;
  t: Translate;
  onFinished: () => void;
}) {
  const [item, setItem] = useState<AssessmentItem | null>(null),
    [attempt, setAttempt] = useState<Attempt | null>(null),
    [error, setError] = useState<unknown>(null),
    [busy, setBusy] = useState(false);
  async function load(notify = false) {
    try {
      const result = await learningApi.assessments(enrollmentId);
      const value =
        result.items.find((entry) => entry.lessonId === lessonId) || null;
      setItem(value);
      setAttempt(
        value?.attempts.find((entry) => entry.state === "IN_PROGRESS") || null,
      );
      setError(null);
      if (notify && item?.attempts.some((entry) => entry.state === "AWAITING_REVIEW") && !value?.attempts.some((entry) => entry.state === "AWAITING_REVIEW")) onFinished();
    } catch (caught) {
      setError(caught);
    }
  }
  useEffect(() => {
    void load();
  }, [enrollmentId, lessonId]);
  useEffect(() => {
    if (!item?.attempts.some((entry) => entry.state === "AWAITING_REVIEW")) return;
    const refresh = () => { if (document.visibilityState === "visible") void load(true); };
    const timer = setInterval(refresh, 15000);
    window.addEventListener("focus", refresh);
    return () => { clearInterval(timer); window.removeEventListener("focus", refresh); };
  }, [enrollmentId, lessonId, item?.attempts.some((entry) => entry.state === "AWAITING_REVIEW")]);
  async function start() {
    setBusy(true);
    try {
      setAttempt(await learningApi.startAssessment(enrollmentId, lessonId));
      setError(null);
    } catch (caught) {
      setError(caught);
    } finally {
      setBusy(false);
    }
  }
  if (attempt)
    return (
      <Exam
        key={attempt.id}
        initial={attempt}
        t={t}
        onFinished={() => {
          setAttempt(null);
          void load();
          onFinished();
        }}
      />
    );
  return (
    <section className="lms-panel">
      {error != null && (
        <Notice>
          {lmsError(error, t)}
          <LmsErrorDiagnostic error={error} t={t} />
          <button onClick={() => void load()}>
            {t("Повторить", "Қайталау")}
          </button>
        </Notice>
      )}
      {!item && !error && (
        <p role="status">{t("Загружаем тест…", "Тест жүктелуде…")}</p>
      )}
      {item && (
        <>
          {item.attempts.map((value) => (
            <p key={value.id}>
              {t("Попытка", "Талпыныс")} {value.ordinal} ·{" "}
              <Status
                value={
                  value.state === "AWAITING_REVIEW"
                    ? "NEEDS_REVIEW"
                    : value.result?.verdict || value.state
                }
                t={t}
              />
              {value.result?.score != null
                ? ` · ${value.result.score}/${value.result.maximum}`
                : ""}
              {value.state !== "IN_PROGRESS" && <button type="button" onClick={() => setAttempt(value)}>{t("Разобрать ответы", "Жауаптарды талдау")}</button>}
            </p>
          ))}
          {item.attempts.some((value) => value.state === "AWAITING_REVIEW") && (
            <p role="status">
              {t(
                "Ответ отправлен. Ожидаем проверку преподавателя.",
                "Жауап жіберілді. Оқытушының тексеруін күтеміз.",
              )}
            </p>
          )}
          {item.canStart ? (
            <button
              className="primary lms-primary"
              disabled={busy}
              onClick={() => void start()}
            >
              {busy
                ? t("Открываем…", "Ашылуда…")
                : item.attempts.length
                  ? t("Повторить тест", "Тестті қайталау")
                  : t("Начать тест", "Тестті бастау")}
            </button>
          ) : (
            !item.attempts.some(
              (value) => value.state === "AWAITING_REVIEW",
            ) && (
              <p>
                {blockedReason(item.reasonCode, t)}
              </p>
            )
          )}
        </>
      )}
    </section>
  );
}
