"use client";
import { useEffect, useRef, useState } from "react";
import { Notice } from "@demo/ui";
import type { PreviewTarget } from "@demo/contracts";
import { api, ApiError, errorText, json } from "@/lib/api";
import {
  documentTitle,
  type Draft,
  type Job,
  type Page,
  type Validation,
} from "@/lib/types";
import { PdfPreview } from "./pdf-preview";

export type PreviewSource = {
  revision: number;
  proposalId?: string;
  expectedProposalHash?: string;
};
const identity = (target?: PreviewTarget) => JSON.stringify(target || null);

/** One viewer for draft forms and immutable director proposals. */
export function DocumentPreview({
  requestId,
  draft,
  source,
  initialTarget,
  samples = false,
  onIssue,
}: {
  requestId: string;
  draft: Pick<Draft, "items" | "events">;
  source: PreviewSource;
  initialTarget?: PreviewTarget;
  samples?: boolean;
  onIssue?: (issue: Validation["errors"][number]) => void;
}) {
  const choices = draft.items
    .flatMap((row) =>
      row.assignments.map((assignment) => ({
        value: identity({
          kind: "ASSIGNMENT",
          rowId: row.id,
          assignmentId: assignment.id,
        }),
        label: `${row.fullNameRu || row.fullNameKz || "Без ФИО"} · ${documentTitle(assignment.templateId)}`,
      })),
    )
    .concat(
      (draft.events || [])
        .filter((event) =>
          draft.items.some((row) =>
            row.assignments.some(
              (assignment) =>
                assignment.eventId === event.id &&
                assignment.protocolMode === "GROUP",
            ),
          ),
        )
        .map((event) => ({
          value: identity({ kind: "GROUP_PROTOCOL", eventId: event.id }),
          label: `Общий протокол · ${event.title || documentTitle(event.protocolTemplateId)}`,
        })),
    );
  const [selection, setSelection] = useState(
    identity(initialTarget) === "null"
      ? choices[0]?.value || ""
      : identity(initialTarget),
  );
  const [jobs, setJobs] = useState<Job[]>([]);
  const [jobIds, setJobIds] = useState<string[]>([]);
  const [selectedPdf, setSelectedPdf] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [issues, setIssues] = useState<Validation["errors"]>([]);
  const [generation, setGeneration] = useState(0);
  const operation = useRef(0);
  const controller = useRef<AbortController | null>(null);
  const sourceKey = `${requestId}:${source.revision}:${source.proposalId || ""}:${source.expectedProposalHash || ""}`;
  useEffect(() => {
    operation.current++;
    controller.current?.abort();
    setJobs([]);
    setJobIds([]);
    setSelectedPdf("");
    setError("");
    setIssues([]);
    setBusy(false);
    return () => {
      operation.current++;
      controller.current?.abort();
    };
  }, [sourceKey, selection]);
  useEffect(() => {
    if (initialTarget) setSelection(identity(initialTarget));
  }, [initialTarget]);
  useEffect(() => {
    if (!jobIds.length) return;
    const serial = operation.current;
    let active = true;
    let failures = 0;
    let missing = 0;
    const started = Date.now();
    let timer: ReturnType<typeof setTimeout>;
    let statusController: AbortController | undefined;
    let statusTimeout: ReturnType<typeof setTimeout>;
    const poll = async () => {
      statusController = new AbortController();
      let timedOut = false;
      statusTimeout = setTimeout(() => {
        timedOut = true;
        statusController?.abort();
      }, 15_000);
      try {
        const result = await api<Page<Job>>(
          `/jobs?requestId=${encodeURIComponent(requestId)}&pageSize=250`,
          { signal: statusController.signal },
        );
        if (!active || serial !== operation.current) return;
        const current = result.items.filter((job) => jobIds.includes(job.id));
        setJobs(current);
        failures = 0;
        if (current.length !== jobIds.length) {
          if (++missing >= 3)
            throw new Error(
              "Задание предпросмотра не найдено. Создайте предпросмотр повторно.",
            );
        } else missing = 0;
        const ready = current.filter(
          (job) =>
            job.status === "SUCCEEDED" && job.kind === "PDF" && job.artifactId,
        );
        setSelectedPdf((value) =>
          ready.some((job) => job.artifactId === value)
            ? value
            : ready[0]?.artifactId || "",
        );
        if (current.some((job) => job.status === "FAILED")) {
          setError("Не удалось подготовить документ. Повторите подготовку.");
          return;
        }
        const pending =
          current.length !== jobIds.length ||
          current.some((job) =>
            ["PENDING", "QUEUED", "RUNNING", "RETRY"].includes(job.status),
          );
        if (!pending) {
          if (!ready.length)
            setError(
              "Задание завершено без PDF. Повторите подготовку документа.",
            );
          return;
        }
        if (Date.now() - started > 120_000) {
          setError(
            "Подготовка заняла больше двух минут. Проверьте состояние и повторите запрос.",
          );
          return;
        }
        timer = setTimeout(() => void poll(), 2000);
      } catch (caught) {
        if (!active || serial !== operation.current) return;
        if (++failures >= 3 || missing >= 3) {
          setError(
            timedOut
              ? "Не удалось получить состояние задания предпросмотра. Проверьте связь и повторите запрос."
              : errorText(caught),
          );
          return;
        }
        timer = setTimeout(() => void poll(), 3000);
      } finally {
        clearTimeout(statusTimeout);
      }
    };
    void poll();
    return () => {
      active = false;
      clearTimeout(timer);
      clearTimeout(statusTimeout);
      statusController?.abort();
    };
  }, [requestId, jobIds, generation]);

  async function generate(asSamples = false) {
    controller.current?.abort();
    const abort = new AbortController();
    controller.current = abort;
    const serial = ++operation.current;
    setBusy(true);
    setError("");
    setIssues([]);
    setSelectedPdf("");
    setJobs([]);
    setJobIds([]);
    const timeout = setTimeout(() => abort.abort(), 65_000);
    try {
      // The editor flushes the draft before opening this viewer; a director
      // supplies the immutable proposal identity and hash.
      for (const job of jobs.filter((entry) => entry.status === "FAILED"))
        await api(`/jobs/${job.id}/retry`, {
          method: "POST",
          body: "{}",
          signal: abort.signal,
        });
      const result = await api<{ jobs: Job[] }>(
        `/print-requests/${encodeURIComponent(requestId)}/preview`,
        {
          method: "POST",
          signal: abort.signal,
          body: json({
            expectedRevision: source.revision,
            proposalId: source.proposalId,
            expectedProposalHash: source.expectedProposalHash,
            ...(asSamples
              ? {}
              : { target: JSON.parse(selection) as PreviewTarget }),
          }),
        },
      );
      if (serial !== operation.current || abort.signal.aborted) return;
      if (!result.jobs.length)
        throw new Error(
          "Для выбранной формы не создано задание. Проверьте состав документов.",
        );
      setJobs(result.jobs);
      setJobIds(result.jobs.map((job) => job.id));
      setGeneration((value) => value + 1);
    } catch (caught) {
      if (serial === operation.current) {
        const details =
          caught instanceof ApiError
            ? (caught.details as { details?: unknown } | undefined)?.details
            : undefined;
        if (Array.isArray(details))
          setIssues(
            details.filter(
              (issue): issue is Exclude<Validation["errors"][number], string> =>
                !!issue &&
                typeof issue === "object" &&
                typeof issue.message === "string",
            ),
          );
        setError(
          abort.signal.aborted
            ? "Ожидание предпросмотра завершено. Повторите запрос."
            : errorText(caught),
        );
      }
    } finally {
      clearTimeout(timeout);
      if (serial === operation.current) setBusy(false);
    }
  }
  const pdfs = jobs.filter(
    (job) => job.status === "SUCCEEDED" && job.kind === "PDF" && job.artifactId,
  );
  const docxs = jobs.filter(
    (job) =>
      job.status === "SUCCEEDED" && job.kind === "DOCX" && job.artifactId,
  );
  const pending = !error && jobIds.length > 0 && !pdfs.length;
  return (
    <section
      className="stack document-preview"
      aria-label="Предпросмотр назначенных документов"
    >
      <label>
        Человек и форма документа
        <select
          aria-label="Человек и форма документа"
          value={selection}
          onChange={(event) => setSelection(event.target.value)}
        >
          {!choices.length && (
            <option value="">Сначала выберите курс и форму</option>
          )}
          {choices.map((choice) => (
            <option value={choice.value} key={choice.value}>
              {choice.label}
            </option>
          ))}
        </select>
      </label>
      <div className="toolbar-actions">
        <button
          disabled={busy || pending || !selection}
          onClick={() => void generate()}
        >
          {busy || pending
            ? "Готовится…"
            : error
              ? "Повторить предпросмотр"
              : pdfs.length
                ? "Обновить предпросмотр"
                : "Создать предпросмотр"}
        </button>
        {samples && (
          <button disabled={busy} onClick={() => void generate(true)}>
            Посмотреть образцы PDF и общие протоколы
          </button>
        )}
      </div>
      {error && <Notice>{error}</Notice>}
      {!!issues.length && (
        <ul aria-label="Что исправить для предпросмотра">
          {issues.map((issue, index) => (
            <li key={index}>
              {onIssue ? (
                <button onClick={() => onIssue(issue)}>
                  {typeof issue === "string" ? issue : issue.message}
                </button>
              ) : typeof issue === "string" ? (
                issue
              ) : (
                issue.message
              )}
            </li>
          ))}
        </ul>
      )}
      {pending && (
        <p role="status">Документ готовится. Можно выбрать другую форму.</p>
      )}
      {pdfs.length > 1 && (
        <label>
          Готовый PDF
          <select
            value={selectedPdf}
            onChange={(event) => setSelectedPdf(event.target.value)}
          >
            {pdfs.map((job) => (
              <option key={job.id} value={job.artifactId}>
                {job.artifact?.fileName || job.id}
              </option>
            ))}
          </select>
        </label>
      )}
      <div className="toolbar-actions">
        {pdfs.map((job) => (
          <a
            key={job.id}
            href={`/api/artifacts/${job.artifactId}?inline=1`}
            target="_blank"
            rel="noreferrer"
          >
            Открыть PDF
            {pdfs.length > 1 ? `: ${job.artifact?.fileName || "документ"}` : ""}
          </a>
        ))}
        {docxs.map((job) => (
          <a key={job.id} href={`/api/artifacts/${job.artifactId}`} download>
            Скачать DOCX
            {docxs.length > 1
              ? `: ${job.artifact?.fileName || "документ"}`
              : ""}
          </a>
        ))}
      </div>
      {selectedPdf && (
        <PdfPreview
          key={`${selectedPdf}:${generation}`}
          artifactId={selectedPdf}
        />
      )}
    </section>
  );
}
