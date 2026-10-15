"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Notice } from "@demo/ui";
import type { LmsLesson } from "@demo/contracts/src/lms";
import {
  lms,
  type Attempt,
  type Enrollment,
  type Learning,
  type LessonProgress,
  type Paged,
} from "@/lib/lms-api";
import { Exam } from "./exam";
import { LmsDocument } from "./documents";
import {
  LmsHeading,
  PageControls,
  Status,
  lmsError,
  type Translate,
} from "./common";

export function MyCourses({ t }: { t: Translate }) {
  const [data, setData] = useState<Paged<Enrollment>>({ items: [], total: 0 });
  const [page, setPage] = useState(1),
    [refresh, setRefresh] = useState(0);
  const [error, setError] = useState(""),
    [loading, setLoading] = useState(true);
  useEffect(() => {
    let alive = true;
    setLoading(true);
    void lms
      .enrollments(true, page)
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
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [page, refresh]);
  return (
    <>
      <LmsHeading title={t("Моё обучение", "Менің оқуым")} />
      {error && (
        <Notice>
          {error}
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
                {t("Продолжить", "Жалғастыру")}
              </Link>
            </li>
          ))}
        </ul>
        {!data.items.length && !loading && !error && (
          <p className="lms-empty">
            {t("Обучение ещё не назначено.", "Оқу әлі тағайындалмады.")}
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
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const [attempt, setAttempt] = useState<Attempt | null>(null);
  async function load() {
    try {
      const value = await lms.learning(id);
      setData(value);
      setError("");
      setLessonId(
        (current) =>
          current ||
          [...(value.progress || [])].sort((a, b) =>
            (b.updatedAt || "").localeCompare(a.updatedAt || ""),
          )[0]?.lessonId ||
          value.content.modules[0]?.lessons[0]?.id ||
          "",
      );
      const active = value.attempts.find((a) => a.state === "IN_PROGRESS");
      if (active) setAttempt(active);
    } catch (caught) {
      setError(lmsError(caught, t));
    }
  }
  useEffect(() => {
    void load();
  }, [id]);
  async function start() {
    if (busy) return;
    setBusy(true);
    try {
      setAttempt(await lms.startAttempt(id));
      setError("");
    } catch (caught) {
      setError(lmsError(caught, t));
    } finally {
      setBusy(false);
    }
  }
  if (!data)
    return (
      <section aria-busy={!error}>
        {error ? (
          <Notice>
            {error}
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
      {error && <Notice>{error}</Notice>}
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
          <div className="lms-learning-layout">
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
                      disabled={
                        item.locked ||
                        item.prerequisiteLessonIds.some(
                          (prerequisite) => !done(prerequisite),
                        )
                      }
                      aria-current={lessonId === item.id ? "step" : undefined}
                      onClick={() => setLessonId(item.id)}
                    >
                      {done(item.id) ? "✓ " : ""}
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
                progress={data.progress?.find((p) => p.lessonId === lesson.id)}
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
                      ? Math.round(
                          (100 *
                            required.filter((l) =>
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
                onNext={() => {
                  const next =
                    lessons[lessons.findIndex((l) => l.id === lesson.id) + 1];
                  if (next) setLessonId(next.id);
                }}
              />
            )}
          </div>
          <section className="panel lms-panel">
            <h2>{t("Результат обучения", "Оқу нәтижесі")}</h2>
            {data.results.map((result) => (
              <p key={result.id}>
                <Status value={result.state || result.verdict} t={t} /> ·{" "}
                <Status value={result.assessmentKind} t={t} />
                {result.score != null
                  ? ` · ${result.score}/${result.maximum}`
                  : ""}
              </p>
            ))}
            {data.profile.assessmentKind === "EXTERNAL_AUTHORIZED" ? (
              <p>
                {t(
                  "Ожидается результат внешнего экзамена.",
                  "Сыртқы емтихан нәтижесі күтілуде.",
                )}
              </p>
            ) : (
              <button
                className="primary lms-primary"
                disabled={
                  busy ||
                  data.progressPercent !== 100 ||
                  data.attempts.length >= data.content.exam.maxAttempts
                }
                onClick={() => void start()}
              >
                {busy
                  ? t("Открываем…", "Ашылуда…")
                  : data.attempts.length
                    ? t("Повторить попытку", "Қайта тапсыру")
                    : data.profile.assessmentKind === "PRACTICE"
                      ? t("Начать учебный тест", "Жаттығу тестін бастау")
                      : t("Начать экзамен", "Емтиханды бастау")}
              </button>
            )}
            {data.progressPercent !== 100 && (
              <p className="lms-save-state">
                {t(
                  "Сначала завершите обязательные уроки.",
                  "Алдымен міндетті сабақтарды аяқтаңыз.",
                )}
              </p>
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
              <LmsDocument key={document.id} id={document.id} learner t={t} />
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
  progress,
  t,
  onProgress,
  onNext,
  onReload,
}: {
  enrollmentId: string;
  lesson: LmsLesson;
  locked?: boolean;
  progress?: LessonProgress;
  t: Translate;
  onProgress: (value: LessonProgress) => void;
  onNext: () => void;
  onReload: () => Promise<void>;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const sequence = useRef(progress?.sequence || 0);
  const queue = useRef(Promise.resolve());
  const last = useRef(0);
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const [conflict, setConflict] = useState(false);
  useEffect(() => {
    if ((progress?.sequence || 0) > sequence.current) {
      sequence.current = progress!.sequence!;
      setConflict(false);
      setError("");
    }
  }, [progress?.sequence]);
  const completed = !!(progress?.completedAt || progress?.completed);
  function save(positionSeconds = 0, playing = false, acknowledge = false) {
    const task = async () => {
      try {
        const value = await lms.progress(enrollmentId, lesson.id, {
          sequence: sequence.current + 1,
          positionSeconds,
          playing,
          acknowledge,
        });
        sequence.current = value.sequence || sequence.current + 1;
        onProgress(value);
        setError("");
      } catch (caught) {
        if (
          caught instanceof Error &&
          "status" in caught &&
          caught.status === 409
        )
          setConflict(true);
        setError(lmsError(caught, t));
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
      {error && (
        <Notice>
          {error}
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
          {t(
            "Сначала завершите предыдущий обязательный урок.",
            "Алдымен алдыңғы міндетті сабақты аяқтаңыз.",
          )}
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
            if (video.current && progress?.positionSeconds)
              video.current.currentTime = progress.positionSeconds;
          }}
          onPlay={(event) =>
            void save(event.currentTarget.currentTime, false).catch(() => {})
          }
          onTimeUpdate={(event) => {
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
        />
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
      {!locked && (
        <div className="lms-prose">{t(lesson.textRu, lesson.textKz)}</div>
      )}
      <div className="lms-editor-actions">
        {locked ? null : completed ? (
          <>
            <Status value="COMPLETED" t={t} />
            <button className="primary lms-primary" onClick={onNext}>
              {t("Следующий урок", "Келесі сабақ")}
            </button>
          </>
        ) : lesson.kind !== "VIDEO" ? (
          <button
            className="primary lms-primary"
            disabled={busy}
            onClick={() => void acknowledge()}
          >
            {busy
              ? t("Сохраняем…", "Сақталуда…")
              : t("Изучено, дальше", "Оқыдым, келесі")}
          </button>
        ) : (
          <span className="lms-save-state">
            {t(
              "Просмотр сохраняется автоматически",
              "Көру барысы автоматты сақталады",
            )}
          </span>
        )}
      </div>
    </section>
  );
}
