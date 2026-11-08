"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Notice } from "@demo/ui";
import { api, ApiError, errorText, json } from "@/lib/api";
import { type Draft, type Validation } from "@/lib/types";
import { validationErrors } from "@/lib/validation-errors";
import { approvalIssueGroups } from "@/lib/approval-issues";
import { pendingCourses } from "@/lib/pending-courses";
import {
  batchAssignments,
  batchFeedbackKey,
  matchingBatchApproval,
  parseBatchSelection,
} from "@/lib/batch-submission";
import "./batch-ready-panel.css";

export type BatchAssignment = { rowId: string; assignmentId: string };
type Feedback = {
  kind: "blocked" | "error" | "unknown" | "conflict" | "success";
  requestId: string;
  key: string;
  issues: Validation["errors"];
  message?: string;
  correlationId?: string;
  saved?: boolean;
};
export function BatchReadyPanel({
  draft,
  onSave,
  onRefresh,
  selectionStorageKey,
  disabled = false,
  dirty = false,
  onBusyChange,
}: {
  draft: Draft;
  onSave: () => Promise<number>;
  onRefresh: () => Promise<void>;
  selectionStorageKey: string;
  disabled?: boolean;
  dirty?: boolean;
  onBusyChange: (busy: boolean) => void;
}) {
  const [selected, setSelected] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState("");
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [refreshError, setRefreshError] = useState("");
  const [selectionReady, setSelectionReady] = useState(false);
  const [selectionError, setSelectionError] = useState("");
  const feedbackRef = useRef<HTMLDivElement>(null);
  const inFlight = useRef(false);
  const latestDraft = useRef(draft);
  latestDraft.current = draft;
  const courses = pendingCourses(draft);
  const ready = courses.filter((course) => !course.issued && course.passed);
  const chosen = ready.filter(
    (course) => selected === null || selected.includes(course.key),
  );
  const selectedKeys = chosen.map((course) => course.key);
  const key = useMemo(
    () => batchFeedbackKey(draft, selected),
    [draft, selected],
  );
  const currentFeedback =
    feedback?.requestId === draft.id &&
    (feedback.kind === "unknown" ||
      feedback.kind === "conflict" ||
      feedback.key === key)
      ? feedback
      : null;
  const needsRefresh =
    currentFeedback?.kind === "unknown" || currentFeedback?.kind === "conflict";
  const staleFeedback = feedback?.kind === "blocked" && !currentFeedback;
  const issues = currentFeedback?.issues || [];
  const blocked = currentFeedback?.kind === "blocked";
  const transferred =
    !dirty && matchingBatchApproval(draft, batchAssignments(draft, selected));
  const controlsDisabled = busy || disabled || !selectionReady;
  useEffect(() => {
    setSelectionReady(false);
    setSelected(null);
    setSelectionError("");
    setFeedback(null);
    setRefreshError("");
    try {
      setSelected(
        parseBatchSelection(sessionStorage.getItem(selectionStorageKey)),
      );
    } catch {
      setSelectionError(
        "Не удалось восстановить выбор курсов. Проверьте состав перед передачей.",
      );
    }
    setSelectionReady(true);
  }, [selectionStorageKey]);
  function select(value: string[]) {
    setSelected(value);
    try {
      sessionStorage.setItem(selectionStorageKey, JSON.stringify(value));
      setSelectionError("");
    } catch {
      setSelectionError(
        "Выбор курсов действует на этой странице. После перехода в настройки проверьте состав ещё раз.",
      );
    }
  }
  useEffect(() => {
    if (!currentFeedback || busy) return;
    feedbackRef.current?.focus({ preventScroll: true });
    feedbackRef.current?.scrollIntoView({ block: "nearest" });
  }, [feedback, busy]);
  useEffect(() => {
    setSelected((before) =>
      before === null
        ? null
        : before.filter((key) =>
            courses.some((course) => course.key === key && !course.issued),
          ),
    );
    // Keep operator selection stable through ordinary autosave and reload metadata.
  }, [draft.id, JSON.stringify(draft.issuedAssignments)]);
  async function submit() {
    if (inFlight.current || controlsDisabled) return;
    inFlight.current = true;
    setBusy(true);
    onBusyChange(true);
    setFeedback(null);
    setRefreshError("");
    let attemptKey = key;
    let posting = false;
    try {
      setStage("Сохраняем состав заявки…");
      const savedRevision = await onSave();
      const saved = await api<Draft>(`/print-requests/${draft.id}`);
      if (saved.revision !== savedRevision)
        throw new ApiError(
          409,
          "Заявка изменилась в другом окне. Обновите состояние и проверьте состав перед передачей.",
        );
      // flush may create a company, apply a staged outcome or complete a kit.
      // Select from the saved composition, never from the pre-flush closure.
      const savedChosen = pendingCourses(saved).filter(
        (course) =>
          !course.issued &&
          course.passed &&
          (selected === null || selected.includes(course.key)),
      );
      if (!savedChosen.length)
        throw new Error("Выберите хотя бы одно готовое обучение для передачи.");
      const assignments = batchAssignments(saved, selected);
      attemptKey = batchFeedbackKey(latestDraft.current, selected);
      setStage("Проверяем выбранный состав и передаём директору…");
      posting = true;
      await api(`/print-requests/${draft.id}/approval/submit`, {
        method: "POST",
        body: json({ expectedRevision: saved.revision, assignments }),
      });
      setFeedback({
        kind: "success",
        requestId: draft.id,
        key: attemptKey,
        issues: [],
      });
      try {
        await onRefresh();
      } catch {
        setRefreshError(
          "Состав передан директору, но не удалось обновить состояние страницы.",
        );
      }
    } catch (caught) {
      const addressed = validationErrors(caught);
      setFeedback({
        kind: addressed.length
          ? "blocked"
          : caught instanceof ApiError && caught.status === 409
            ? "conflict"
            : posting &&
                caught instanceof ApiError &&
                (caught.status === 0 || caught.status >= 500)
              ? "unknown"
              : "error",
        key: attemptKey,
        requestId: draft.id,
        issues: addressed,
        saved: posting,
        message:
          caught instanceof ApiError ? caught.message : errorText(caught),
        correlationId:
          caught instanceof ApiError ? caught.correlationId : undefined,
      });
    } finally {
      inFlight.current = false;
      setBusy(false);
      onBusyChange(false);
      setStage("");
    }
  }
  function focusIssue(issue: Validation["errors"][number]) {
    if (typeof issue === "string") return;
    window.dispatchEvent(
      new CustomEvent("demo:focus-issue", { detail: issue }),
    );
  }
  async function refresh() {
    if (inFlight.current || controlsDisabled) return;
    setRefreshError("");
    setBusy(true);
    inFlight.current = true;
    onBusyChange(true);
    try {
      await onRefresh();
      setFeedback(null);
    } catch {
      setRefreshError(
        "Не удалось обновить состояние. Проверьте связь и повторите попытку.",
      );
    } finally {
      setBusy(false);
      inFlight.current = false;
      onBusyChange(false);
    }
  }
  if (draft.status !== "DRAFT" || !courses.length) return null;
  return (
    <section
      className="outcome-entry batch-ready-panel"
      id="request-transfer"
      aria-label="Готовность и состав следующего выпуска"
    >
      <h3>Передача директору</h3>
      <p aria-live="polite">
        Готовы к передаче: {ready.length} из{" "}
        {courses.filter((course) => !course.issued).length} курсов.
      </p>
      {selectionError && <Notice kind="info">{selectionError}</Notice>}
      {staleFeedback && (
        <p className="batch-recheck" role="status">
          Данные изменены. Повторите проверку и передачу выбранного состава.
        </p>
      )}
      {currentFeedback && (
        <div ref={feedbackRef} tabIndex={-1} className="batch-feedback">
          <Notice
            kind={currentFeedback.kind === "success" ? "success" : "error"}
          >
            <strong>
              {blocked
                ? currentFeedback.saved
                  ? "Выбранный состав не передан директору"
                  : "Не удалось сохранить изменения"
                : currentFeedback.kind === "success"
                  ? "Выбранный состав передан директору"
                  : currentFeedback.kind === "unknown"
                    ? "Не удалось подтвердить передачу"
                    : currentFeedback.kind === "conflict"
                      ? "Перед передачей обновите заявку"
                      : "Не удалось передать выбранный состав"}
            </strong>
            <p>
              {blocked
                ? currentFeedback.saved
                  ? "Черновик сохранён. Исправьте замечания ниже и повторите передачу."
                  : "Данные остались на странице. Исправьте замечания ниже и повторите передачу."
                : currentFeedback.kind === "success"
                  ? "Дождитесь согласования директора."
                  : currentFeedback.kind === "unknown"
                    ? "Ответ сервера не получен. Состав мог быть передан. Обновите состояние перед повторной попыткой."
                    : currentFeedback.message}
            </p>
            {!!issues.length &&
              approvalIssueGroups(issues, draft).map((group) => (
                <div key={group.key} className="batch-issue-group">
                  <strong>{group.title}</strong>
                  <ul>
                    {group.entries.map(({ issue, key: issueKey }) => (
                      <li key={issueKey}>
                        {typeof issue === "string" ? (
                          issue
                        ) : (
                          <button
                            className="text-button"
                            onClick={() => focusIssue(issue)}
                          >
                            {issue.message} — исправить
                          </button>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            {currentFeedback.correlationId && (
              <details className="batch-error-details">
                <summary>Данные для поддержки</summary>
                <p>Код обращения: {currentFeedback.correlationId}</p>
              </details>
            )}
          </Notice>
        </div>
      )}
      {refreshError && (
        <Notice kind="info">
          {refreshError}
          <button disabled={controlsDisabled} onClick={() => void refresh()}>
            Обновить состояние
          </button>
        </Notice>
      )}
      {busy && (
        <p role="status" aria-live="polite">
          {stage}
        </p>
      )}
      <label className="checkbox">
        <input
          type="checkbox"
          disabled={controlsDisabled || !ready.length}
          checked={
            !!ready.length &&
            ready.every((course) => selectedKeys.includes(course.key))
          }
          onChange={(event) =>
            select(
              event.target.checked ? ready.map((course) => course.key) : [],
            )
          }
        />
        Все подтверждённые ещё не оформленные курсы ({ready.length})
      </label>
      <details>
        <summary>Состав по людям и курсам — выбрано {chosen.length}</summary>
        {courses.map((course) => (
          <label className="checkbox" key={course.key}>
            <input
              type="checkbox"
              disabled={controlsDisabled || course.issued || !course.passed}
              checked={selectedKeys.includes(course.key)}
              onChange={(event) =>
                select(
                  event.target.checked
                    ? [...selectedKeys, course.key]
                    : selectedKeys.filter((key) => key !== course.key),
                )
              }
            />
            {course.row.fullNameRu} · {course.course} ·{" "}
            {course.issued
              ? "Оформлено"
              : course.passed
                ? "Сдача подтверждена"
                : course.failed
                  ? "Не сдал / не явился"
                  : "Ожидает сдачи"}
          </label>
        ))}
      </details>
      {!chosen.length && (
        <p className="fine-print" role="status">
          {ready.length
            ? "Выберите хотя бы один готовый курс для передачи директору."
            : "Пока нет готовых курсов для передачи. Заполните данные и результаты обучения."}
        </p>
      )}
      {transferred && !needsRefresh ? (
        <p role="status">
          <strong>
            {draft.approval?.status === "APPROVED"
              ? "Выбранный состав согласован"
              : "Выбранный состав на согласовании"}
          </strong>{" "}
          <Link
            href={`/approvals?proposal=${encodeURIComponent(draft.approval!.proposalId)}`}
          >
            Посмотреть согласование
          </Link>
        </p>
      ) : currentFeedback?.kind === "success" ? null : (
        <div className="batch-submit-actions">
          <button
            type="button"
            className={
              draft.approval?.status === "APPROVED" ? undefined : "primary"
            }
            disabled={controlsDisabled || (!needsRefresh && !chosen.length)}
            onClick={() =>
              needsRefresh
                ? void refresh()
                : blocked && issues.some((issue) => typeof issue !== "string")
                  ? focusIssue(
                      issues.find((issue) => typeof issue !== "string")!,
                    )
                  : void submit()
            }
          >
            {busy
              ? "Проверяем и передаём…"
              : needsRefresh
                ? currentFeedback.kind === "unknown"
                  ? "Проверить состояние передачи"
                  : "Обновить заявку и проверить состав"
                : blocked && issues.some((issue) => typeof issue !== "string")
                  ? typeof issues[0] !== "string" &&
                    /^(profile|issuer)\.commission/.test(
                      String(issues[0]?.path || ""),
                    )
                    ? "Исправить комиссию"
                    : "Исправить первое замечание"
                  : `Проверить и передать директору (${chosen.length} назначений, ${new Set(chosen.map((course) => course.row.id)).size} человек)`}
          </button>
          {blocked && (
            <button
              className="text-button"
              disabled={controlsDisabled || !chosen.length}
              onClick={() => void submit()}
            >
              Проверить и передать повторно
            </button>
          )}
        </div>
      )}
    </section>
  );
}
