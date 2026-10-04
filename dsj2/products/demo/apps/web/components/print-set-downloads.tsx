"use client";
import { useState } from "react";
import { Notice } from "@demo/ui";
import { api, downloadArtifact, errorText, json } from "@/lib/api";
import type { Artifact } from "@/lib/types";
import { printPdfArtifact } from "./pdf-preview";

type Plan = {
  issuanceId?: string;
  format: string;
  limitBytes: number;
  parts: {
    index: number;
    artifactIds: string[];
    bytes: number;
    fileCount: number;
  }[];
  files: {
    id: string;
    personIds?: string[];
    personNames?: string[];
    documentTitle?: string;
    courseTitle?: string;
    document?: { number: string; templateId: string; rowId?: string };
  }[];
};
export function PrintSetDownloads({
  requestId,
  artifactIds,
  issuanceId,
  compact = false,
}: {
  requestId: string;
  artifactIds?: string[];
  issuanceId?: string;
  compact?: boolean;
}) {
  const [plan, setPlan] = useState<Plan | null>(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [generated, setGenerated] = useState<
    Record<number, { artifact: Artifact; pages?: number }>
  >({});
  const selection = {
    ...(artifactIds ? { artifactIds } : {}),
    ...(issuanceId ? { issuanceId } : {}),
  };
  async function prepare(format: "PDF" | "DOCX" | "ZIP") {
    setBusy("plan");
    setError("");
    setPlan(null);
    setGenerated({});
    try {
      setPlan(
        await api<Plan>(`/print-requests/${requestId}/print-set/plan`, {
          method: "POST",
          body: json({ ...selection, format }),
        }),
      );
    } catch (caught) {
      setError(errorText(caught));
    } finally {
      setBusy("");
    }
  }
  async function obtain(part: number, print: boolean) {
    if (!plan) return;
    setBusy(String(part));
    setError("");
    try {
      const result =
        generated[part] ||
        (await api<{ artifact: Artifact; pages?: number }>(
          `/print-requests/${requestId}/print-set`,
          {
            method: "POST",
            body: json({
              format: plan.format,
              artifactIds: plan.files.map((file) => file.id),
              part,
            }),
          },
        ));
      setGenerated((before) => ({ ...before, [part]: result }));
      if (print) await printPdfArtifact(result.artifact.id);
      else
        await downloadArtifact(
          result.artifact.id,
          result.artifact.fileName ||
            `DEMO-комплект.${plan.format.toLowerCase()}`,
        );
    } catch (caught) {
      setError(errorText(caught));
    } finally {
      setBusy("");
    }
  }
  return (
    <div className="print-set-downloads">
      <div className="toolbar">
        <button
          disabled={!!busy || (!!artifactIds && !artifactIds.length)}
          onClick={() => void prepare("PDF")}
        >
          {busy === "plan"
            ? "Проверяем комплект…"
            : compact
              ? "PDF последнего выпуска"
              : "Единый PDF выбранных документов"}
        </button>
        {!compact && (
          <>
            <button
              disabled={!!busy || (!!artifactIds && !artifactIds.length)}
              onClick={() => void prepare("DOCX")}
            >
              Общий DOCX одной формы
            </button>
            <button
              disabled={!!busy || (!!artifactIds && !artifactIds.length)}
              onClick={() => void prepare("ZIP")}
            >
              Оригиналы ZIP по частям
            </button>
          </>
        )}
      </div>
      {error && <Notice>{error}</Notice>}
      {plan && (
        <div aria-live="polite">
          <p>
            Выпуск {plan.issuanceId?.slice(0, 8) || "выбранный состав"}:{" "}
            {plan.files.length} файлов,{" "}
            {
              new Set(
                plan.files.flatMap(
                  (file) =>
                    file.personIds ||
                    (file.document?.rowId ? [file.document.rowId] : []),
                ),
              ).size
            }{" "}
            человек, частей {plan.parts.length}. Размер части до{" "}
            {Math.round(plan.limitBytes / 1024 / 1024)} МиБ. Страницы сохраняют
            исходный размер.
          </p>
          <details>
            <summary>Проверить состав</summary>
            <ul>
              {plan.files.map((file) => (
                <li key={file.id}>
                  {file.personNames?.join(", ")} ·{" "}
                  {file.courseTitle ? `${file.courseTitle} · ` : ""}
                  {file.documentTitle} · № {file.document?.number}
                </li>
              ))}
            </ul>
          </details>
          {plan.parts.map((part) => (
            <div className="toolbar" key={part.index}>
              <span>
                Часть {part.index + 1}: {part.fileCount} файлов
                {generated[part.index]?.pages
                  ? `, ${generated[part.index].pages} страниц`
                  : ""}
              </span>
              <button
                disabled={!!busy}
                onClick={() => void obtain(part.index, false)}
              >
                {busy === String(part.index)
                  ? "Собираем сохранённые файлы…"
                  : `Скачать ${plan.format}`}
              </button>
              {plan.format === "PDF" && (
                <button
                  disabled={!!busy}
                  onClick={() => void obtain(part.index, true)}
                >
                  Напечатать эту часть
                </button>
              )}
            </div>
          ))}
          <p className="fine-print">
            Комплект — копия оригиналов для печати. Проверяемые подписи
            относятся к отдельным исходным файлам. Для принтера выберите
            «Фактический размер».
          </p>
        </div>
      )}
    </div>
  );
}
