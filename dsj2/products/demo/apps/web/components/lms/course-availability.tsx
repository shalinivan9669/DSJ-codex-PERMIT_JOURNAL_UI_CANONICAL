"use client";
import { useState } from "react";
import { api, json } from "@/lib/api";
import type { Course } from "@/lib/lms-api";
import { LmsErrorDiagnostic, lmsError, type Translate } from "./common";

export const regulatoryStates = [
  ["CURRENT", "Актуален", "Өзекті"],
  ["CHANGES_EXPECTED", "Ожидаются изменения", "Өзгерістер күтілуде"],
  ["CHANGED", "Изменён", "Өзгертілген"],
  ["REPEALED", "Утратил силу", "Күші жойылған"],
  ["REVIEW_REQUIRED", "Требуется проверка", "Тексеру қажет"],
] as const;

export function CourseAvailability({
  course,
  onChange,
  t,
}: {
  course: Course;
  onChange: (course: Course) => void;
  t: Translate;
}) {
  const [status, setStatus] = useState(course.currentReview?.status || "");
  const [note, setNote] = useState(course.currentReview?.note || "");
  const [reason, setReason] = useState(course.assignmentPauseReason || "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const allowed = course.allowedActions || [];
  async function saveReview() {
    if (!status) return;
    setBusy(true);
    setError(null);
    try {
      const review = await api<NonNullable<Course["currentReview"]>>(
        `/lms/courses/${course.id}/regulatory-review`,
        { method: "POST", body: json({ status, note }) },
      );
      onChange({ ...course, currentReview: review });
    } catch (caught) {
      setError(caught);
    } finally {
      setBusy(false);
    }
  }
  async function pause() {
    setBusy(true);
    setError(null);
    try {
      const value = await api<Course>(`/lms/courses/${course.id}/pause`, {
        method: "POST",
        body: json({ paused: !course.assignmentPaused, reason }),
      });
      onChange({ ...course, ...value });
    } catch (caught) {
      setError(caught);
    } finally {
      setBusy(false);
    }
  }
  async function archive() {
    setBusy(true);
    setError(null);
    try {
      const value = await api<Course>(`/lms/courses/${course.id}/archive`, {
        method: "POST",
        body: json({ archived: !course.archived, reason }),
      });
      onChange({ ...course, ...value });
    } catch (caught) {
      setError(caught);
    } finally {
      setBusy(false);
    }
  }
  return (
    <details className="panel lms-panel">
      <summary>
        {t(
          "Актуальность и новые назначения",
          "Өзектілік және жаңа тағайындаулар",
        )}
        {course.assignmentPaused ? ` · ${t("На паузе", "Тоқтатылған")}` : ""}
        {course.archived ? ` · ${t("В архиве", "Мұрағатта")}` : ""}
        {course.currentReview && course.currentReview.status !== "CURRENT"
          ? ` · ${t("Нужна актуализация", "Өзектендіру қажет")}`
          : ""}
      </summary>
      {!!error && (
        <>
          <p role="alert">{lmsError(error, t)}</p>
          <LmsErrorDiagnostic error={error} t={t} />
        </>
      )}
      {allowed.includes("reviewRegulatory") && (
        <>
          <div className="lms-fields">
            <label>
              {t("Текущая проверка основания", "Негіздің ағымдағы тексеруі")}
              <select
                value={status}
                onChange={(event) => setStatus(event.target.value)}
              >
                <option value="">{t("Не проверено", "Тексерілмеген")}</option>
                {regulatoryStates.map(([value, ru, kz]) => (
                  <option key={value} value={value}>
                    {t(ru, kz)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              {t("Примечание к проверке", "Тексеру туралы ескертпе")}
              <textarea
                value={note}
                onChange={(event) => setNote(event.target.value)}
              />
            </label>
          </div>
          <button
            type="button"
            disabled={
              busy ||
              !status ||
              (status === course.currentReview?.status &&
                note === (course.currentReview?.note || ""))
            }
            onClick={() => void saveReview()}
          >
            {t("Сохранить проверку", "Тексеруді сақтау")}
          </button>
        </>
      )}
      {(allowed.includes("pause") || allowed.includes("archive")) && (
        <>
          <div className="lms-fields">
            <label>
              {t(
                "Причина изменения доступности",
                "Қолжетімділікті өзгерту себебі",
              )}
              <input
                value={reason}
                onChange={(event) => setReason(event.target.value)}
              />
            </label>
          </div>
          {allowed.includes("pause") && (
            <button
              type="button"
              disabled={busy || !reason.trim()}
              onClick={() => void pause()}
            >
              {course.assignmentPaused
                ? t(
                    "Возобновить новые назначения",
                    "Жаңа тағайындауларды жалғастыру",
                  )
                : t(
                    "Приостановить новые назначения",
                    "Жаңа тағайындауларды тоқтату",
                  )}
            </button>
          )}
          {allowed.includes("archive") && (
            <button
              type="button"
              disabled={busy || !reason.trim()}
              onClick={() => void archive()}
            >
              {course.archived
                ? t("Вернуть курс из архива", "Курсты мұрағаттан қайтару")
                : t("Архивировать курс", "Курсты мұрағаттау")}
            </button>
          )}
          <p className="muted">
            {t(
              "История опубликованных версий и обучения сохраняется.",
              "Жарияланған нұсқалар мен оқу тарихы сақталады.",
            )}
          </p>
        </>
      )}
    </details>
  );
}
