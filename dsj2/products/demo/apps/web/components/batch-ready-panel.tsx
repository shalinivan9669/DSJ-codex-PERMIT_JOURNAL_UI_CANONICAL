"use client";
import { useEffect, useState } from "react";
import { Notice } from "@demo/ui";
import { api, errorText, json } from "@/lib/api";
import { type Draft, type Validation } from "@/lib/types";
import { validationErrors } from "@/lib/validation-errors";
import { approvalIssueGroups } from "@/lib/approval-issues";
import { pendingCourses } from "@/lib/pending-courses";

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
  const courses = pendingCourses(draft);
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
      const alreadyIssued = new Set(
        (saved.issuedAssignments || []).map(
          (entry) => entry.rowId + ":" + entry.assignmentId,
        ),
      );
      const assignments = savedChosen.flatMap((course) =>
        course.assignments
          .filter(
            (assignment) =>
              !alreadyIssued.has(course.row.id + ":" + assignment.id),
          )
          .map((assignment) => ({
            rowId: course.row.id,
            assignmentId: assignment.id,
          })),
      );
      setStage("Проверяем выбранный состав и передаём директору…");
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
      {(draft.kind !== "PERSON" || draft.items.length !== 1) && (
        <p className="fine-print">
          Все сданные ещё не оформленные курсы выбраны автоматически. При
          необходимости измените состав. Несданные курсы остаются в этой же
          заявке. Передача директору проверяет выбранные данные и обязательные
          поля.
        </p>
      )}
      {error && <Notice>{error}</Notice>}
      {notice && <Notice kind="success">{notice}</Notice>}
      {busy && (
        <p role="status" aria-live="polite">
          {stage}
        </p>
      )}
      {!!issues.length && (
        <div role="alert">
          {approvalIssueGroups(issues, draft).map((group) => (
            <div key={group.key}>
              <strong>{group.title}</strong>
              <ul>
                {group.entries.map(({ issue }, index) => (
                  <li key={index}>
                    {typeof issue === "string" ? (
                      issue
                    ) : (
                      <button
                        className="text-button"
                        onClick={() =>
                          window.dispatchEvent(
                            new CustomEvent("demo:focus-issue", {
                              detail: issue,
                            }),
                          )
                        }
                      >
                        {issue.message} — исправить
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
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
