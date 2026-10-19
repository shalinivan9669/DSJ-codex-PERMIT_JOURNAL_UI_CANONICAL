"use client";
import { useEffect, useId, useRef, useState } from "react";
import { Notice } from "@demo/ui";
import {
  ApiError,
  BEFORE_LOGOUT_EVENT,
  NavigationBlockedError,
} from "@/lib/api";
import {
  learningApi,
  type LearnerSubmission,
  type SubmissionAttachment,
} from "@/lib/learning-api";
import { LmsErrorDiagnostic, lmsError, type Translate } from "./common";
import { useLmsSaveNavigation } from "./use-save-navigation";

export function LearnerSubmissionForm({
  enrollmentId,
  lessonId,
  allowText = true,
  allowFiles = false,
  t,
  onSubmitted,
}: {
  enrollmentId: string;
  lessonId: string;
  allowText?: boolean;
  allowFiles?: boolean;
  t: Translate;
  onSubmitted: () => void;
}) {
  const answerId = useId();
  const [data, setData] = useState<LearnerSubmission | null>(null),
    [text, setText] = useState(""),
    [attachments, setAttachments] = useState<SubmissionAttachment[]>([]),
    [error, setError] = useState<unknown>(null),
    [saving, setSaving] = useState(false),
    [busy, setBusy] = useState(false),
    [conflict, setConflict] = useState(false);
  const [recovery, setRecovery] = useState<{ text: string; attachments: SubmissionAttachment[] } | null>(null);
  const latest = useRef({
      text: "",
      attachments: [] as SubmissionAttachment[],
    }),
    sequence = useRef(0),
    generation = useRef(0),
    saved = useRef(0),
    flight = useRef<Promise<void> | null>(null),
    loadVersion = useRef(0),
    blocked = useRef(false),
    timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const editable = !!data && (data.canEdit || data.canRevise);
  function receive(value: LearnerSubmission) {
    setData(value);
    sequence.current = value.sequence;
  }
  async function load(notify = false) {
    const request = ++loadVersion.current;
    const capturedGeneration = generation.current;
    try {
      const value = await learningApi.submission(enrollmentId, lessonId);
      if (
        request !== loadVersion.current ||
        generation.current !== capturedGeneration
      )
        return;
      receive(value);
      setText(value.text);
      setAttachments(value.attachments);
      latest.current = { text: value.text, attachments: value.attachments };
      saved.current = generation.current;
      blocked.current = false;
      setConflict(false);
      setError(null);
      if (notify && data && data.status !== value.status) onSubmitted();
    } catch (caught) {
      if (request === loadVersion.current) setError(caught);
    }
  }
  async function flush(): Promise<void> {
    if (blocked.current) throw new NavigationBlockedError();
    if (flight.current) {
      await flight.current;
      return flush();
    }
    if (saved.current === generation.current) return;
    const snapshot = structuredClone(latest.current),
      captured = generation.current;
    setSaving(true);
    flight.current = (async () => {
      try {
        const value = await learningApi.saveSubmission(enrollmentId, lessonId, {
          sequence: sequence.current + 1,
          text: snapshot.text,
          attachmentIds: snapshot.attachments.map((file) => file.id),
        });
        receive(value);
        saved.current = captured;
        setError(null);
      } catch (caught) {
        if (caught instanceof ApiError && caught.status === 409) {
          blocked.current = true;
          setConflict(true);
        }
        setError(caught);
        throw caught;
      } finally {
        flight.current = null;
        setSaving(false);
      }
    })();
    await flight.current;
    if (saved.current !== generation.current) await flush();
  }
  useLmsSaveNavigation(
    `submission:${enrollmentId}:${lessonId}`,
    () => saved.current !== generation.current,
    flush,
    setError,
  );
  useEffect(() => {
    void load();
    const unload = (event: BeforeUnloadEvent) => {
      if (saved.current !== generation.current) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    const online = () => void flush().catch(() => {});
    const logout = (event: Event) =>
      (
        event as CustomEvent<{ waitUntil: (p: Promise<unknown>) => void }>
      ).detail.waitUntil(flush());
    window.addEventListener("beforeunload", unload);
    window.addEventListener("online", online);
    window.addEventListener(BEFORE_LOGOUT_EVENT, logout);
    return () => {
      loadVersion.current++;
      if (timer.current) clearTimeout(timer.current);
      window.removeEventListener("beforeunload", unload);
      window.removeEventListener("online", online);
      window.removeEventListener(BEFORE_LOGOUT_EVENT, logout);
    };
  }, [enrollmentId, lessonId]);
  useEffect(() => {
    if (data?.status !== "SUBMITTED") return;
    const refresh = () => { if (document.visibilityState === "visible") void load(true); };
    const polling = setInterval(refresh, 15000);
    window.addEventListener("focus", refresh);
    return () => { clearInterval(polling); window.removeEventListener("focus", refresh); };
  }, [enrollmentId, lessonId, data?.status]);
  function change(next: typeof latest.current) {
    latest.current = next;
    setText(next.text);
    setAttachments(next.attachments);
    generation.current++;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void flush().catch(() => {}), 500);
  }
  async function upload(file: File) {
    setBusy(true);
    try {
      const added = await learningApi.upload(enrollmentId, lessonId, file);
      change({
        ...latest.current,
        attachments: [...latest.current.attachments, added],
      });
      await flush();
    } catch (caught) {
      setError(caught);
    } finally {
      setBusy(false);
    }
  }
  async function submit() {
    setBusy(true);
    try {
      await flush();
      receive(
        await learningApi.submit(enrollmentId, lessonId, sequence.current),
      );
      setError(null);
      onSubmitted();
    } catch (caught) {
      setError(caught);
    } finally {
      setBusy(false);
    }
  }
  const status = data?.status;
  return (
    <section className="lms-panel">
      {error != null && (
        <Notice>
          {lmsError(error, t)}
          <LmsErrorDiagnostic error={error} t={t} />
          <button
            type="button"
            onClick={() =>
              conflict ? (setRecovery(structuredClone(latest.current)), void load()) : !data ? void load() : void flush().catch(() => {})
            }
          >
            {conflict
              ? t("Открыть сохранённую работу", "Сақталған жұмысты ашу")
              : t("Повторить сохранение", "Сақтауды қайталау")}
          </button>
        </Notice>
      )}
      {recovery && !conflict && <Notice>
        {t("Ваш ввод сохранён отдельно от актуальной работы.", "Сіздің енгізгеніңіз ағымдағы жұмыстан бөлек сақталды.")}
        {editable && <button type="button" onClick={() => { change(recovery); setRecovery(null); }}>{t("Вернуть мой черновик для правки", "Түзету үшін менің жобамды қайтару")}</button>}
        <details><summary>{t("Мой текст", "Менің мәтінім")}</summary><p className="lms-prose">{recovery.text}</p></details>
      </Notice>}
      {!data && !error && (
        <p role="status">{t("Загружаем работу…", "Жұмыс жүктелуде…")}</p>
      )}
      {data && (
        <>
          <div className="lms-prose">
            {t(data.instructionsRu, data.instructionsKz)}
          </div>
          <details>
            <summary>{t("Критерии проверки", "Тексеру критерийлері")}</summary>
            <div className="lms-prose">
              {t(data.criteriaRu, data.criteriaKz)}
            </div>
          </details>
          <p role="status">
            {status === "SUBMITTED"
              ? t(
                  "Работа отправлена. Ожидаем преподавателя.",
                  "Жұмыс жіберілді. Оқытушыны күтеміз.",
                )
              : status === "ACCEPTED"
                ? t("Работа принята", "Жұмыс қабылданды")
                : status === "RETURNED"
                  ? t(
                      "Верните работу после исправления замечаний.",
                      "Ескертулерді түзеткеннен кейін жұмысты қайта жіберіңіз.",
                    )
                  : status === "REJECTED"
                    ? t("Работа отклонена", "Жұмыс қабылданбады")
                    : saving || generation.current !== saved.current
                      ? t("Сохраняем черновик…", "Жоба сақталуда…")
                      : error
                        ? ""
                        : t("Черновик сохранён", "Жоба сақталды")}
          </p>
          {data.feedback && <blockquote>{data.feedback}</blockquote>}
          {allowText && (
            <label htmlFor={answerId}>
              {t("Ответ", "Жауап")}
              <textarea
                id={answerId}
                rows={8}
                maxLength={100000}
                disabled={!editable || busy || conflict}
                value={text}
                onChange={(event) =>
                  change({ ...latest.current, text: event.target.value })
                }
              />
            </label>
          )}
          {attachments.map((file) => (
            <div key={file.id} className="lms-toolbar">
              <a
                href={file.downloadUrl}
                target="_blank"
                rel="noopener noreferrer"
              >
                {file.name}
              </a>
              {editable && (
                <button
                  type="button"
                  disabled={busy || conflict}
                  onClick={() =>
                    change({
                      ...latest.current,
                      attachments: latest.current.attachments.filter(
                        (entry) => entry.id !== file.id,
                      ),
                    })
                  }
                >
                  {t("Убрать вложение", "Тіркемені алып тастау")}
                </button>
              )}
            </div>
          ))}
          {allowFiles && editable && (
            <label>
              {t("Добавить файл", "Файл қосу")}
              <input
                type="file"
                disabled={busy || conflict}
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) void upload(file);
                  event.target.value = "";
                }}
              />
            </label>
          )}
          {editable && (
            <button
              className="primary lms-primary"
              disabled={
                busy || conflict || (!text.trim() && !attachments.length) ||
                (status === "RETURNED" && saved.current === generation.current)
              }
              onClick={() => void submit()}
            >
              {status === "RETURNED" && saved.current === generation.current
                ? t("Сначала исправьте работу", "Алдымен жұмысты түзетіңіз")
                : busy
                ? t("Отправляем…", "Жіберілуде…")
                : t("Отправить на проверку", "Тексеруге жіберу")}
            </button>
          )}
          {!!data.history.length && (
            <details>
              <summary>
                {t("История подачи и проверки", "Жіберу және тексеру тарихы")}
              </summary>
              {data.history.map((item) => (
                <article key={item.revision}>
                  <strong>
                    {t("Версия", "Нұсқа")} {item.revision}
                  </strong>
                  <p>
                    {item.submittedAt?.slice(0, 16).replace("T", " ")}{" "}
                    {item.reviewerName}
                  </p>
                  <div className="lms-prose">{item.text}</div>
                  {item.attachments.map((file) => (
                    <p key={file.id}>
                      <a
                        href={file.downloadUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        {file.name}
                      </a>
                    </p>
                  ))}
                  {item.feedback && <blockquote>{item.feedback}</blockquote>}
                </article>
              ))}
            </details>
          )}
        </>
      )}
    </section>
  );
}
