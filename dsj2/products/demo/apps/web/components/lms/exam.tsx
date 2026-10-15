"use client";
import { useEffect, useRef, useState } from "react";
import { Notice } from "@demo/ui";
import {
  ApiError,
  BEFORE_LOGOUT_EVENT,
  NavigationBlockedError,
} from "@/lib/api";
import { lms, type Attempt } from "@/lib/lms-api";
import { Status, lmsError, type Translate } from "./common";
import { useLmsSaveNavigation } from "./use-save-navigation";

export function Exam({
  initial,
  t,
  onFinished,
}: {
  initial: Attempt;
  t: Translate;
  onFinished: () => void;
}) {
  const [attempt, setAttempt] = useState(initial);
  const [answers, setAnswers] = useState(initial.answers);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [now, setNow] = useState(() =>
    initial.serverNow ? Date.parse(initial.serverNow) : Date.now(),
  );
  const clock = useRef({ server: now, monotonic: performance.now() });
  function receive(value: Attempt) {
    if (value.serverNow) {
      clock.current = {
        server: Date.parse(value.serverNow),
        monotonic: performance.now(),
      };
      setNow(clock.current.server);
    }
    setAttempt(value);
  }
  const latest = useRef(initial.answers);
  const sequence = useRef(initial.sequence);
  const generation = useRef(0);
  const saved = useRef(0);
  const flight = useRef<Promise<void> | null>(null);
  const blocked = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useLmsSaveNavigation(
    initial.id,
    () => generation.current !== saved.current,
    flush,
    (caught) => setError(lmsError(caught, t)),
  );
  const finished = attempt.state !== "IN_PROGRESS";
  const remaining = Math.max(
    0,
    Math.ceil((Date.parse(attempt.deadlineAt) - now) / 1000),
  );
  async function flush(): Promise<void> {
    if (blocked.current) throw new NavigationBlockedError();
    if (flight.current) {
      await flight.current;
      return flush();
    }
    if (generation.current === saved.current) return;
    const snapshot = structuredClone(latest.current),
      captured = generation.current;
    setSaving(true);
    flight.current = (async () => {
      try {
        const value = await lms.answers(
          attempt.id,
          sequence.current + 1,
          snapshot,
        );
        sequence.current = value.sequence;
        saved.current = captured;
        receive(value);
        setError("");
      } catch (caught) {
        if (caught instanceof ApiError && caught.status === 409) {
          blocked.current = true;
          setConflict(true);
        }
        setError(lmsError(caught, t));
        throw caught;
      } finally {
        flight.current = null;
        setSaving(false);
      }
    })();
    await flight.current;
    if (generation.current !== saved.current) await flush();
  }
  useEffect(() => {
    const tick = setInterval(
      () =>
        setNow(
          clock.current.server + performance.now() - clock.current.monotonic,
        ),
      1000,
    );
    const online = () => {
      if (!blocked.current) void flush().catch(() => {});
    };
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (generation.current !== saved.current) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    const logout = (event: Event) =>
      (
        event as CustomEvent<{ waitUntil: (p: Promise<unknown>) => void }>
      ).detail.waitUntil(
        flush().catch(() => {
          throw new NavigationBlockedError();
        }),
      );
    window.addEventListener("online", online);
    window.addEventListener("beforeunload", beforeUnload);
    window.addEventListener(BEFORE_LOGOUT_EVENT, logout);
    return () => {
      clearInterval(tick);
      if (timer.current) clearTimeout(timer.current);
      window.removeEventListener("online", online);
      window.removeEventListener("beforeunload", beforeUnload);
      window.removeEventListener(BEFORE_LOGOUT_EVENT, logout);
    };
  }, []);
  useEffect(() => {
    if (remaining || finished) return;
    void lms
      .attempt(attempt.id)
      .then((value) => {
        receive(value);
        if (value.state !== "IN_PROGRESS") {
          latest.current = value.answers;
          setAnswers(value.answers);
          saved.current = generation.current;
          blocked.current = false;
          setConflict(false);
          setError("");
        }
      })
      .catch((caught) => setError(lmsError(caught, t)));
  }, [remaining, finished, attempt.id]);
  function answer(
    questionId: string,
    optionId: string,
    multiple: boolean,
    checked: boolean,
  ) {
    const current = latest.current[questionId] || [];
    const next = {
      ...latest.current,
      [questionId]: multiple
        ? checked
          ? [...current, optionId]
          : current.filter((id) => id !== optionId)
        : [optionId],
    };
    latest.current = next;
    generation.current++;
    setAnswers(next);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void flush().catch(() => {}), 300);
  }
  async function submit() {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await flush();
      receive(await lms.submit(attempt.id));
    } catch (caught) {
      setError(lmsError(caught, t));
    } finally {
      setBusy(false);
    }
  }
  async function reload() {
    try {
      const value = await lms.attempt(attempt.id);
      receive(value);
      setAnswers(value.answers);
      latest.current = value.answers;
      sequence.current = value.sequence;
      saved.current = generation.current;
      blocked.current = false;
      setConflict(false);
      setError("");
    } catch (caught) {
      setError(lmsError(caught, t));
    }
  }
  return (
    <section className="panel lms-panel">
      <div className="lms-exam-top">
        <strong>
          {t("Попытка", "Талпыныс")} {attempt.ordinal}
        </strong>
        {!finished && (
          <span role="timer" aria-label={t("Оставшееся время", "Қалған уақыт")}>
            {Math.floor(remaining / 60)}:
            {String(remaining % 60).padStart(2, "0")}
          </span>
        )}
        <span role="status">
          {saving
            ? t("Сохраняем ответы…", "Жауаптар сақталуда…")
            : !finished && !error
              ? t("Ответы сохранены", "Жауаптар сақталды")
              : ""}
        </span>
      </div>
      {error && (
        <Notice>
          {error}
          <button
            type="button"
            onClick={() =>
              conflict || remaining === 0
                ? void reload()
                : void flush().catch(() => {})
            }
          >
            {conflict
              ? t("Открыть сохранённые ответы", "Сақталған жауаптарды ашу")
              : t("Повторить", "Қайталау")}
          </button>
        </Notice>
      )}
      {finished ? (
        <div className="lms-panel">
          <h2>
            <Status
              value={
                attempt.result?.state ||
                attempt.result?.verdict ||
                "NEEDS_REVIEW"
              }
              t={t}
            />
          </h2>
          {attempt.result && (
            <>
              <p>
                <Status value={attempt.result.assessmentKind} t={t} />
              </p>
              {attempt.result.score != null && (
                <p>
                  {t("Правильных ответов", "Дұрыс жауаптар")}:{" "}
                  {attempt.result.score} / {attempt.result.maximum}
                </p>
              )}
            </>
          )}
          <button className="primary lms-primary" onClick={onFinished}>
            {t("Вернуться к курсу", "Курсқа оралу")}
          </button>
        </div>
      ) : (
        <>
          {attempt.questions.map((question, index) => (
            <fieldset
              className="lms-question"
              key={question.id}
              disabled={busy || conflict || remaining === 0}
            >
              <legend>
                {index + 1}. {t(question.promptRu, question.promptKz)}
              </legend>
              {question.options.map((option) => (
                <label className="lms-inline-label lms-answer" key={option.id}>
                  <input
                    type={question.multiple ? "checkbox" : "radio"}
                    name={question.id}
                    checked={answers[question.id]?.includes(option.id) || false}
                    onChange={(e) =>
                      answer(
                        question.id,
                        option.id,
                        question.multiple,
                        e.target.checked,
                      )
                    }
                  />
                  <span>{t(option.textRu, option.textKz)}</span>
                </label>
              ))}
            </fieldset>
          ))}
          <button
            className="primary lms-primary"
            disabled={busy || conflict || remaining === 0}
            onClick={() => void submit()}
          >
            {busy
              ? t("Проверяем…", "Тексерілуде…")
              : t("Завершить попытку", "Талпынысты аяқтау")}
          </button>
        </>
      )}
    </section>
  );
}
