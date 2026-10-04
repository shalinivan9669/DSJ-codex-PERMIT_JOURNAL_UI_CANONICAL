"use client";
import { useEffect, useState } from "react";
import { Notice } from "@demo/ui";
import { trainingDirection, isTechnicalBlankRow } from "@demo/contracts";
import { api, errorText, json } from "@/lib/api";
import { documentTitle, type Draft, type Validation } from "@/lib/types";
import { validationErrors } from "@/lib/validation-errors";

export type BatchAssignment = { rowId: string; assignmentId: string };
export function BatchReadyPanel({
  draft,
  onSave,
  onRefresh,
}: {
  draft: Draft;
  onSave: () => Promise<unknown>;
  onRefresh: () => Promise<void>;
}) {
  const [selected, setSelected] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [issues, setIssues] = useState<Validation["errors"]>([]);
  const issued = new Set(
    (draft.issuedAssignments || []).map(
      (entry) => entry.rowId + ":" + entry.assignmentId,
    ),
  );
  const courses = draft.items
    .filter((row) => !isTechnicalBlankRow(row))
    .flatMap((row) => {
      const groups = new Map<string, typeof row.assignments>();
      for (const assignment of row.assignments) {
        const key =
          assignment.eventId || trainingDirection(assignment.templateId);
        groups.set(key, [...(groups.get(key) || []), assignment]);
      }
      return [...groups.entries()].map(([key, assignments]) => ({
        key: row.id + ":" + key,
        row,
        assignments,
        course:
          draft.events?.find((event) => event.id === key)?.title ||
          documentTitle(assignments[0].templateId).replace(/ — .*/, ""),
        issued: assignments.every((assignment) =>
          issued.has(row.id + ":" + assignment.id),
        ),
        passed: assignments.some(
          (assignment) => assignment.outcome?.status === "PASSED",
        ),
        failed: assignments.some((assignment) =>
          ["FAILED", "ABSENT"].includes(assignment.outcome?.status || ""),
        ),
      }));
    });
  const ready = courses.filter((course) => !course.issued && course.passed);
  const chosen = ready.filter(
    (course) => selected === null || selected.includes(course.key),
  );
  const selectedKeys = chosen.map((course) => course.key);
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
    setBusy(true);
    setError("");
    setNotice("");
    setIssues([]);
    try {
      setStage("Сохраняем состав заявки…");
      await onSave();
      const saved = await api<Draft>(`/print-requests/${draft.id}`);
      const assignments = chosen.flatMap((course) =>
        course.assignments
          .filter(
            (assignment) => !issued.has(course.row.id + ":" + assignment.id),
          )
          .map((assignment) => ({
            rowId: course.row.id,
            assignmentId: assignment.id,
          })),
      );
      setStage(
        `Проверяем данные и макеты: ${new Set(chosen.map((course) => course.row.id)).size} человек, ${chosen.length} назначений. Большой состав обрабатывается автоматически по частям.`,
      );
      const validation = await api<Validation>(
        `/print-requests/${draft.id}/validate`,
        {
          method: "POST",
          body: json({ expectedRevision: saved.revision, assignments }),
        },
      );
      if (!validation.valid) {
        setIssues(validation.errors || []);
        throw new Error(
          "Исправьте данные выбранного состава перед передачей директору",
        );
      }
      setStage("Передаём проверенную редакцию директору…");
      await api(`/print-requests/${draft.id}/approval/submit`, {
        method: "POST",
        body: json({ expectedRevision: saved.revision, assignments }),
      });
      setNotice(
        "Выбранный состав проверен и передан директору. Остальные назначения продолжают сохраняться как рабочий черновик.",
      );
      await onRefresh();
    } catch (caught) {
      setError(errorText(caught));
      const addressed = validationErrors(caught);
      if (addressed.length) setIssues(addressed);
    } finally {
      setBusy(false);
      setStage("");
    }
  }
  if (draft.status !== "DRAFT" || !courses.length) return null;
  return (
    <section
      className="outcome-entry"
      aria-label="Готовность и состав следующего выпуска"
    >
      <h3>Следующий выпуск в этой заявке</h3>
      <p aria-live="polite">
        Назначения: оформлено {courses.filter((course) => course.issued).length}
        ; подтверждена сдача {ready.length}; ожидает сдачи{" "}
        {
          courses.filter(
            (course) => !course.issued && !course.passed && !course.failed,
          ).length
        }
        ; не сдал или не явился{" "}
        {courses.filter((course) => !course.issued && course.failed).length}.
      </p>
      <p className="fine-print">
        Все сданные ещё не оформленные курсы выбраны автоматически. При
        необходимости измените состав. Несданные курсы остаются в этой же
        заявке. Передача директору проверяет выбранные данные и обязательные
        поля.
      </p>
      {error && <Notice>{error}</Notice>}
      {notice && <Notice kind="success">{notice}</Notice>}
      {busy && (
        <p role="status" aria-live="polite">
          {stage}
        </p>
      )}
      {!!issues.length && (
        <ul>
          {issues.map((issue, index) => (
            <li key={index}>
              {typeof issue === "string" ? (
                issue
              ) : (
                <button
                  onClick={() =>
                    window.dispatchEvent(
                      new CustomEvent("demo:focus-issue", { detail: issue }),
                    )
                  }
                >
                  {
                    draft.items.find(
                      (row) =>
                        row.id === (issue as { rowId?: string }).rowId ||
                        row.id === issue.itemId,
                    )?.fullNameRu
                  }{" "}
                  · {issue.message} — исправить поле
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      <label className="checkbox">
        <input
          type="checkbox"
          disabled={busy || !ready.length}
          checked={
            !!ready.length &&
            ready.every((course) => selectedKeys.includes(course.key))
          }
          onChange={(event) =>
            setSelected(
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
              disabled={busy || course.issued || !course.passed}
              checked={selectedKeys.includes(course.key)}
              onChange={(event) =>
                setSelected(
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
      <button disabled={busy || !chosen.length} onClick={() => void submit()}>
        {busy
          ? "Проверяем и передаём…"
          : `Проверить и передать директору (${chosen.length} назначений, ${new Set(chosen.map((course) => course.row.id)).size} человек)`}
      </button>
    </section>
  );
}
