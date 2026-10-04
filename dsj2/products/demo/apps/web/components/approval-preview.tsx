"use client";
import { useEffect, useState } from "react";
import { Notice } from "@demo/ui";
import { api, errorText, json } from "@/lib/api";
import { documentTitle, type Job, type Page } from "@/lib/types";
import { PdfPreview } from "./pdf-preview";

type Sample = { fullNameRu: string; templateId: string };
export function ApprovalPreview({
  requestId,
  proposalId,
  proposalHash,
  revision,
}: {
  requestId: string;
  proposalId: string;
  proposalHash: string;
  revision: number;
}) {
  const [jobIds, setJobIds] = useState<string[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [samples, setSamples] = useState<Sample[]>([]);
  const [selected, setSelected] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!jobIds.length) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    const load = async () => {
      try {
        const result = await api<Page<Job>>(
          `/jobs?requestId=${encodeURIComponent(requestId)}`,
        );
        if (!active) return;
        const selectedJobs = result.items.filter((job) =>
          jobIds.includes(job.id),
        );
        setJobs(selectedJobs);
        const ready = selectedJobs.find(
          (job) => job.kind === "PDF" && job.artifactId,
        );
        if (ready) setSelected((value) => value || ready.artifactId!);
        if (
          selectedJobs.some((job) =>
            ["PENDING", "QUEUED", "RUNNING", "RETRY"].includes(job.status),
          )
        )
          timer = setTimeout(() => void load(), 2500);
      } catch (caught) {
        if (active) {
          setError(errorText(caught));
          timer = setTimeout(() => void load(), 6000);
        }
      }
    };
    void load();
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [requestId, jobIds]);
  const pdfs = jobs.filter((job) => job.kind === "PDF" && job.artifactId);
  return (
    <section aria-label="PDF переданной редакции">
      <button
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError("");
          try {
            const result = await api<{ jobs: Job[]; samples: Sample[] }>(
              `/print-requests/${encodeURIComponent(requestId)}/preview`,
              {
                method: "POST",
                body: json({
                  expectedRevision: revision,
                  proposalId,
                  expectedProposalHash: proposalHash,
                }),
              },
            );
            setJobs(result.jobs);
            setSamples(result.samples || []);
            setJobIds(result.jobs.map((job) => job.id));
          } catch (caught) {
            setError(errorText(caught));
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy
          ? "Готовим предпросмотр…"
          : "Посмотреть образцы PDF и общие протоколы"}
      </button>
      <p className="muted">
        По одному реальному получателю для каждой формы и обучения; общие
        протоколы содержат весь переданный состав. Источник — эта сохранённая
        редакция.
      </p>
      {error && <Notice>{error}</Notice>}
      {!!samples.length && (
        <details>
          <summary>Получатели в образцах</summary>
          <ul>
            {samples.map((sample, index) => (
              <li key={index}>
                {sample.fullNameRu} · {documentTitle(sample.templateId)}
              </li>
            ))}
          </ul>
        </details>
      )}
      {!!jobIds.length && (
        <p role="status">
          Готово PDF: {pdfs.length} из{" "}
          {jobs.filter((job) => job.kind === "PDF").length}.
          {jobs.some((job) => job.status === "FAILED") &&
            " Не удалось подготовить часть файлов. Повторите проверку в разделе файлов заявки."}
        </p>
      )}
      {!!pdfs.length && (
        <label>
          Документ для просмотра
          <select
            value={selected}
            onChange={(event) => setSelected(event.target.value)}
          >
            {pdfs.map((job, index) => (
              <option key={job.id} value={job.artifactId}>
                {job.artifact?.fileName || `PDF ${index + 1}`}
              </option>
            ))}
          </select>
        </label>
      )}
      {selected && <PdfPreview artifactId={selected} />}
    </section>
  );
}
