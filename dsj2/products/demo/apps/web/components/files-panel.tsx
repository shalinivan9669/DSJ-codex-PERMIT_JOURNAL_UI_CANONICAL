"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Icon, Modal, Notice } from "@demo/ui";
import {
  api,
  ApiError,
  downloadArtifact,
  downloadExport,
  errorText,
  json,
} from "@/lib/api";
import {
  templateLabels,
  documentTitle,
  type Artifact,
  type Draft,
  type Issuance,
  type Job,
  type Page,
} from "@/lib/types";
import { dateTime, Status } from "./request-list";
import { VerificationLink } from "./verification-link";
import { SavedPrintSet } from "./saved-print-set";
import { filePollingRetryDelay } from "@/lib/file-polling";
import { readyPreviewRevision } from "@/lib/preview-readiness";
import { PdfPreview, printPdfArtifact } from "./pdf-preview";
import {
  artifactPrintEligibility,
  previewReviewMatches,
  type PrintReviewState,
} from "@/lib/artifact-print-eligibility";

export function FilesPanel({
  requestId,
  draft,
  refresh,
  previewStale,
  readonly,
  canManage,
  allowPrint = true,
  previewPrintAllowed = false,
  onChanged,
  onPreviewReady,
}: {
  requestId: string;
  draft: Draft;
  refresh: number;
  previewStale: boolean;
  readonly: boolean;
  canManage: boolean;
  allowPrint?: boolean;
  previewPrintAllowed?: boolean;
  onChanged: () => void;
  onPreviewReady?: (revision: number | null) => void;
}) {
  const [missing, setMissing] = useState<string[]>([]);
  const [restoreArtifact, setRestoreArtifact] = useState<Artifact | null>(null);
  const [restoreReason, setRestoreReason] = useState("");
  const router = useRouter();
  const [jobs, setJobs] = useState<Job[]>([]);
  const [issuances, setIssuances] = useState<Issuance[]>(draft.issuances || []);
  const [artifacts, setArtifacts] = useState<Artifact[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const [dialog, setDialog] = useState<"correct" | "cancel" | null>(null);
  const [reason, setReason] = useState("");
  const [viewArtifact, setViewArtifact] = useState<Artifact | null>(null);
  const [printing, setPrinting] = useState(false);
  const [serverReview, setServerReview] = useState<PrintReviewState | null>(
    null,
  );
  const [printError, setPrintError] = useState("");
  const [reload, setReload] = useState(0);
  useEffect(() => {
    onPreviewReady?.(
      readyPreviewRevision(draft.revision, jobs, artifacts, missing),
    );
  }, [draft.revision, jobs, artifacts, missing, onPreviewReady]);
  useEffect(() => {
    let active = true;
    setServerReview(null);
    let failures = 0;
    let timer: ReturnType<typeof setTimeout>;
    async function load() {
      try {
        const [result, detail] = await Promise.all([
          api<Page<Job>>(`/jobs?requestId=${encodeURIComponent(requestId)}`),
          api<
            Draft & {
              artifacts?: Artifact[];
              documents?: (NonNullable<Issuance["documents"]>[number] & {
                issuanceId: string;
              })[];
              issuanceEvents?: {
                issuanceId: string;
                kind: string;
                reason: string;
                createdAt: string;
                relatedRequestId?: string | null;
              }[];
            }
          >(`/print-requests/${requestId}`),
        ]);
        if (!active) return;
        failures = 0;
        setServerReview(detail);
        setJobs(result.items);
        setIssuances(
          (detail.issuances || []).map((issuance) => ({
            ...issuance,
            documents: detail.documents?.filter(
              (document) => document.issuanceId === issuance.id,
            ),
            events: detail.issuanceEvents?.filter(
              (event) => event.issuanceId === issuance.id,
            ),
            status: detail.issuanceEvents?.some(
              (event) =>
                event.issuanceId === issuance.id && event.kind === "CANCELLED",
            )
              ? "CANCELLED"
              : detail.issuanceEvents?.some(
                    (event) =>
                      event.issuanceId === issuance.id &&
                      event.kind === "REPLACED",
                  )
                ? "REPLACED"
                : detail.lifecycle || "LEGACY_ISSUED",
          })),
        );
        setArtifacts(detail.artifacts || []);
        setMissing((values) => [
          ...new Set([
            ...values,
            ...(detail.artifacts || [])
              .filter((artifact) => artifact.availability === "MISSING")
              .map((artifact) => artifact.id),
          ]),
        ]);
        setError("");
        if (
          result.items.some((job) =>
            ["PENDING", "QUEUED", "RUNNING", "RETRY"].includes(job.status),
          )
        )
          timer = setTimeout(() => void load(), 2500);
      } catch (caught) {
        if (!active) return;
        setServerReview(null);
        setError(errorText(caught));
        const delay = filePollingRetryDelay(caught, ++failures);
        if (delay !== null) timer = setTimeout(() => void load(), delay);
      }
    }
    void load();
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [
    requestId,
    refresh,
    reload,
    draft.status,
    draft.revision,
    draft.approvedRevision,
    draft.approval?.proposalId,
    draft.approval?.status,
  ]);
  async function retry(id: string) {
    setBusy(id);
    setError("");
    try {
      await api(`/jobs/${id}/retry`, { method: "POST", body: "{}" });
      setReload((value) => value + 1);
    } catch (caught) {
      setError(errorText(caught));
    } finally {
      setBusy("");
    }
  }
  async function download(artifact: Artifact) {
    setBusy(artifact.id);
    setError("");
    try {
      await downloadArtifact(
        artifact.id,
        artifact.fileName ||
          artifact.filename ||
          artifact.name ||
          "DEMO-document",
      );
    } catch (caught) {
      setError(errorText(caught));
      if (caught instanceof ApiError && caught.status === 503)
        setMissing((values) => [...new Set([...values, artifact.id])]);
    } finally {
      setBusy("");
    }
  }
  async function restore() {
    if (!restoreArtifact) return;
    setBusy("restore");
    setError("");
    try {
      await api(`/artifacts/${restoreArtifact.id}/restore`, {
        method: "POST",
        body: json({ reason: restoreReason }),
      });
      setRestoreArtifact(null);
      setRestoreReason("");
      setReload((value) => value + 1);
    } catch (caught) {
      setError(errorText(caught));
    } finally {
      setBusy("");
    }
  }
  async function changeHistory() {
    if (!dialog) return;
    setBusy(dialog);
    setError("");
    try {
      const result = await api<Draft>(
        `/print-requests/${requestId}/${dialog}`,
        {
          method: "POST",
          body: json({ reason, expectedRevision: draft.revision }),
        },
      );
      setDialog(null);
      setReason("");
      if (dialog === "correct") router.push(`/requests/${result.id}/edit`);
      else onChanged();
    } catch (caught) {
      setError(errorText(caught));
    } finally {
      setBusy("");
    }
  }
  const complete = jobs.filter((job) =>
    ["READY", "COMPLETED", "SUCCEEDED"].includes(job.status),
  ).length;
  const issuedJobs = jobs.filter(
    (job) => !!job.issuanceId && job.kind !== "ZIP",
  );
  const bundleGroups = Map.groupBy(
    issuedJobs,
    (job) => `${job.documentId || "registry"}:${job.kind}`,
  );
  const partialBundle = [...bundleGroups.values()].some(
    (group) =>
      !group.some(
        (job) =>
          ["READY", "COMPLETED", "SUCCEEDED"].includes(job.status) &&
          !!job.artifactId &&
          !missing.includes(job.artifactId),
      ),
  );
  const lastPreviewRevision = jobs
    .filter((job) => !job.issuanceId && job.sourceRevision != null)
    .reduce((revision, job) => Math.max(revision, job.sourceRevision!), -1);
  function artifactTitle(artifact: Artifact) {
    const document = issuances
      .flatMap((issuance) => issuance.documents || [])
      .find((document) => document.id === artifact.documentId);
    if (document)
      return `${documentTitle(document.templateId, !document.rowId)} · № ${document.number}`;
    if (artifact.format === "XLSX") return "Реестр документов";
    if (artifact.format === "ZIP") return "Комплект документов";
    const name = artifact.fileName || artifact.filename || artifact.name || "";
    const templateId = Object.keys(templateLabels).find((id) =>
      name.startsWith(id + "-"),
    );
    return templateId
      ? `${documentTitle(templateId)} · ${artifact.provenance === "PREVIEW" ? "предпросмотр" : "печатная форма"}`
      : name || "Печатный документ";
  }
  const allArtifacts = [
    ...artifacts,
    ...jobs.flatMap((job) => [
      ...(job.artifacts || []),
      ...(job.artifact ? [job.artifact] : []),
    ]),
    ...issuances.flatMap((issuance) => [
      ...(issuance.artifacts || []),
      ...(issuance.documents || []).flatMap(
        (document) => document.artifacts || [],
      ),
    ]),
  ].filter(
    (artifact, index, rows) =>
      rows.findIndex((item) => item.id === artifact.id) === index,
  );
  const awaitingSignatures = issuances.some((issuance) =>
    ["RENDERING", "AWAITING_SIGNATURE"].includes(issuance.status || ""),
  );
  const printState = (artifact: Artifact) =>
    artifactPrintEligibility({
      artifact,
      draft,
      serverReview,
      jobs,
      issuances,
      previewPrintAllowed,
      missing,
    });
  const viewPrintState = viewArtifact ? printState(viewArtifact) : null;
  const panelTitle = allowPrint
    ? "Документы и печать"
    : "Предпросмотр документов";
  if (!jobs.length && !issuances.length && !error)
    return draft.kind === "PERSON" && draft.items.length === 1 ? null : (
      <section id="request-files" className="files-empty">
        <Icon name={allowPrint ? "print" : "search"} />
        <p>
          После предпросмотра или оформления здесь появятся задания и файлы.
        </p>
      </section>
    );
  return (
    <section
      id="request-files"
      className="panel files-panel"
      aria-label={panelTitle}
    >
      {canManage &&
        !awaitingSignatures &&
        issuances.some((i) => i.documents?.length) && (
          <VerificationLink
            documents={issuances.flatMap((i) => i.documents || [])}
          />
        )}
      <div className="section-heading">
        <div>
          <h2>{panelTitle}</h2>
          <p className="muted">
            Готово {complete} из {jobs.length}. Повторяется только генерация;
            номера сохраняются.
            {!allowPrint &&
              " Предпросмотр можно открыть и скачать. Печать станет доступна после согласования заявки."}
            {missing.length > 0 && (
              <strong className="danger-text">
                {" "}
                Недоступных оригиналов: {missing.length}. Требуется
                восстановление.
              </strong>
            )}
          </p>
        </div>
        <div className="file-actions">
          <button
            disabled={!!busy || awaitingSignatures}
            title={
              awaitingSignatures
                ? "Реестр выданных документов доступен после всех подписей"
                : undefined
            }
            onClick={() => {
              setBusy("registry");
              void downloadExport(
                `/print-requests/${requestId}/export`,
                { format: "XLSX" },
                "DEMO-registry.xlsx",
              )
                .catch((caught) => setError(errorText(caught)))
                .finally(() => setBusy(""));
            }}
          >
            Реестр XLSX
          </button>
          {readonly && (
            <button
              disabled={!!busy || awaitingSignatures}
              title={
                awaitingSignatures
                  ? "Официальный комплект доступен после всех подписей"
                  : undefined
              }
              onClick={() => {
                setBusy("zip");
                void downloadExport(
                  `/print-requests/${requestId}/export`,
                  { format: "ZIP", allowPartial: partialBundle },
                  partialBundle ? "DEMO-PARTIAL.zip" : "DEMO-complete.zip",
                )
                  .catch((caught) => setError(errorText(caught)))
                  .finally(() => setBusy(""));
              }}
            >
              {partialBundle ? "Скачать неполный ZIP" : "Скачать ZIP"}
            </button>
          )}
          <button onClick={() => setReload((value) => value + 1)}>
            Обновить
          </button>
        </div>
      </div>
      {error && <Notice>{error}</Notice>}
      {awaitingSignatures && (
        <Notice kind="info">
          {allowPrint
            ? "Готовые PDF можно просмотреть и распечатать кнопкой «Печать»."
            : "Готовые PDF можно просмотреть и скачать."}{" "}
          Комплект ожидает электронных подписей; официальный ZIP и реестр выдачи
          станут доступны после их проверки.
        </Notice>
      )}
      {allowPrint && (
        <SavedPrintSet
          draft={draft}
          issuances={issuances}
          artifacts={allArtifacts}
        />
      )}
      {(previewStale ||
        (lastPreviewRevision >= 0 &&
          lastPreviewRevision !== draft.revision)) && (
        <Notice kind="info">
          {draft.status === "FINALIZED"
            ? "Предпросмотры относятся к прежней редакции. Для печати подготовленного комплекта используйте сохранённые оригиналы с номерами."
            : "Данные изменились после создания предпросмотра. Сформируйте новый макет перед оформлением."}
        </Notice>
      )}
      {allArtifacts.length > 0 && (
        <div className="artifact-list">
          {allArtifacts
            .filter(
              (artifact) =>
                !(
                  (draft.approval || draft.businessRuleVersion === "LIVE_V1") &&
                  artifact.format?.toUpperCase() === "ZIP"
                ),
            )
            .map((artifact) => {
              const print = printState(artifact);
              return (
                <article key={artifact.id}>
                  <span className="file-type">
                    {artifact.format ||
                      artifact.filename?.split(".").pop()?.toUpperCase() ||
                      artifact.name?.split(".").pop()?.toUpperCase() ||
                      "Файл"}
                  </span>
                  <div>
                    <strong>{artifactTitle(artifact)}</strong>
                    <small>
                      {print.label} ·{" "}
                      {missing.includes(artifact.id)
                        ? "Оригинал недоступен · "
                        : ""}
                      {artifact.size != null
                        ? `${Math.ceil(artifact.size / 1024)} КБ`
                        : "Сохранённый файл"}{" "}
                      · {dateTime(artifact.createdAt)}
                    </small>
                    {artifact.sha256 && (
                      <details>
                        <summary>Контрольная сумма</summary>
                        <span className="hash">SHA-256: {artifact.sha256}</span>
                      </details>
                    )}
                  </div>
                  <div className="file-actions">
                    {(artifact.mimeType === "application/pdf" ||
                      artifact.format?.toLowerCase() === "pdf" ||
                      artifact.fileName?.endsWith(".pdf") ||
                      artifact.filename?.endsWith(".pdf")) && (
                      <button
                        className="primary"
                        disabled={missing.includes(artifact.id)}
                        onClick={() => {
                          setPrintError("");
                          setViewArtifact(artifact);
                        }}
                      >
                        <Icon name={print.canPrint ? "print" : "search"} />{" "}
                        {print.canPrint
                          ? print.isPreview
                            ? "Печать макета"
                            : "Печать"
                          : "Просмотр PDF"}
                      </button>
                    )}
                    <a
                      className="button"
                      href={`/api/artifacts/${artifact.id}`}
                      download
                      aria-disabled={
                        !!busy ||
                        (awaitingSignatures &&
                          ["ZIP", "XLSX"].includes(
                            (artifact.format || "").toUpperCase(),
                          ))
                      }
                      onClick={(event) => {
                        event.preventDefault();
                        if (
                          !busy &&
                          !(
                            awaitingSignatures &&
                            ["ZIP", "XLSX"].includes(
                              (artifact.format || "").toUpperCase(),
                            )
                          )
                        )
                          void download(artifact);
                      }}
                    >
                      <Icon name="download" />
                      {awaitingSignatures &&
                      ["ZIP", "XLSX"].includes(
                        (artifact.format || "").toUpperCase(),
                      )
                        ? "После подписания"
                        : "Скачать"}
                    </a>
                    {canManage &&
                      missing.includes(artifact.id) &&
                      artifact.provenance === "PRINT_SET_DERIVATIVE" && (
                        <button
                          disabled={!!busy}
                          onClick={() => {
                            const savedSet = window.document.getElementById(
                              "saved-print-set",
                            ) as HTMLDetailsElement | null;
                            if (savedSet) {
                              savedSet.open = true;
                              savedSet.scrollIntoView({
                                block: "center",
                                behavior: "smooth",
                              });
                              savedSet
                                .querySelector<HTMLButtonElement>("button")
                                ?.focus();
                            }
                          }}
                        >
                          Получить комплект снова
                        </button>
                      )}
                    {canManage &&
                      missing.includes(artifact.id) &&
                      artifact.provenance !== "PRINT_SET_DERIVATIVE" && (
                        <button
                          disabled={!!busy}
                          onClick={() => {
                            setRestoreReason("");
                            setRestoreArtifact(artifact);
                          }}
                        >
                          Восстановить файл
                        </button>
                      )}
                  </div>
                </article>
              );
            })}
        </div>
      )}
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Задание</th>
              <th>Состояние</th>
              <th>Попытки</th>
              <th>Обновлено</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {jobs.map((job, index) => (
              <tr key={job.id}>
                <td>
                  {!job.issuanceId ? "Предпросмотр" : "Документ"} · {job.kind}{" "}
                  {index + 1}
                  {job.sourceRevision != null && (
                    <small>Редакция {job.sourceRevision}</small>
                  )}
                </td>
                <td>
                  {job.status === "PENDING" ? (
                    <span className="status">В очереди</span>
                  ) : (
                    <Status value={job.status} />
                  )}
                  {job.errorCode && <small>{job.errorCode}</small>}
                </td>
                <td>{job.attempts ?? 0}</td>
                <td>{dateTime(job.updatedAt || job.createdAt)}</td>
                <td>
                  {canManage && ["FAILED", "PARTIAL"].includes(job.status) && (
                    <button
                      disabled={!!busy}
                      onClick={() => void retry(job.id)}
                    >
                      {busy === job.id ? "Повторяем…" : "Повторить неготовые"}
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {issuances.map((issuance) => (
        <details className="issuance-details" key={issuance.id}>
          <summary>
            Зарегистрированная редакция {issuance.sourceRevision} ·{" "}
            {dateTime(issuance.createdAt)}{" "}
            <Status value={issuance.status || "REGISTERED"} />
          </summary>
          {(issuance.reason || issuance.correctionReason) && (
            <p>Причина: {issuance.reason || issuance.correctionReason}</p>
          )}
          {(issuance.correctionOfId || issuance.correctsIssuanceId) && (
            <p>
              {issuance.correctsRequestId ? (
                <Link href={`/requests/${issuance.correctsRequestId}`}>
                  Открыть исходный выпуск
                </Link>
              ) : (
                <>
                  Исправление выпуска{" "}
                  {issuance.correctionOfId || issuance.correctsIssuanceId}
                </>
              )}
            </p>
          )}
          {issuance.events?.map((event, index) => (
            <p key={index}>
              {event.kind === "REPLACED"
                ? "Выпуск заменён"
                : event.kind === "CANCELLED"
                  ? "Выпуск отменён"
                  : event.kind}
              {" · "}
              {dateTime(event.createdAt)}. Причина: {event.reason}
              {event.relatedRequestId && (
                <>
                  {" "}
                  ·{" "}
                  <Link href={`/requests/${event.relatedRequestId}`}>
                    Открыть исправленный выпуск
                  </Link>
                </>
              )}
            </p>
          ))}
          <ul>
            {issuance.documents?.map((document) => (
              <li key={document.id}>
                {documentTitle(document.templateId, !document.rowId)} —{" "}
                <strong>№ {document.number}</strong>
                {document.registrationNumber
                  ? ` · регистрационный № ${document.registrationNumber}`
                  : ""}
              </li>
            ))}
          </ul>
        </details>
      ))}
      {readonly &&
        draft.status !== "DRAFT" &&
        draft.status !== "CANCELLED" &&
        canManage && (
          <div className="history-actions">
            <p>Оригиналы сохраняются. Исправление и отмена требуют причины.</p>
            <button onClick={() => setDialog("correct")}>
              Создать исправление
            </button>
            <button className="danger-text" onClick={() => setDialog("cancel")}>
              Отменить выпуск
            </button>
          </div>
        )}
      {dialog && (
        <Modal
          title={
            dialog === "correct"
              ? "Создать связанную заявку на исправление"
              : "Отменить выпуск"
          }
          onClose={() => {
            if (!busy) setDialog(null);
          }}
        >
          <p>
            {dialog === "correct"
              ? "Будет создан новый черновик. Зарегистрированная редакция, номера и оригинальные файлы останутся в истории."
              : "Запрос на аннулирование будет отправлен директору. После согласования решение появится в истории; номера и файлы сохранятся."}
          </p>
          {error && <Notice>{error}</Notice>}
          <label>
            Причина
            <textarea
              autoFocus
              required
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              minLength={3}
            />
          </label>
          <div className="modal-actions">
            <button disabled={!!busy} onClick={() => setDialog(null)}>
              Вернуться
            </button>
            <button
              className="primary"
              disabled={!!busy || reason.trim().length < 3}
              onClick={() => void changeHistory()}
            >
              {busy
                ? "Сохраняем…"
                : dialog === "correct"
                  ? "Создать исправление"
                  : "Зафиксировать отмену"}
            </button>
          </div>
        </Modal>
      )}
      {restoreArtifact && (
        <Modal
          title="Восстановить недоступный файл"
          onClose={() => {
            if (!busy) setRestoreArtifact(null);
          }}
        >
          <p>
            Будет создана отдельная восстановленная копия из зарегистрированной
            редакции. Исходная запись и контрольная сумма останутся в истории.
            Номера документов сохранятся.
          </p>
          {error && <Notice>{error}</Notice>}
          <label>
            Причина восстановления
            <textarea
              autoFocus
              value={restoreReason}
              onChange={(event) => setRestoreReason(event.target.value)}
              minLength={3}
            />
          </label>
          <div className="modal-actions">
            <button disabled={!!busy} onClick={() => setRestoreArtifact(null)}>
              Вернуться
            </button>
            <button
              className="primary"
              disabled={!!busy || restoreReason.trim().length < 3}
              onClick={() => void restore()}
            >
              {busy ? "Восстанавливаем…" : "Создать восстановленную копию"}
            </button>
          </div>
        </Modal>
      )}
      {viewArtifact && (
        <Modal
          title={
            viewPrintState?.canPrint
              ? "Просмотр и печать PDF"
              : "Предпросмотр PDF"
          }
          onClose={() => setViewArtifact(null)}
          wide
        >
          <p>
            <strong>{artifactTitle(viewArtifact)}</strong>
          </p>
          <p>
            {viewPrintState?.label}.{" "}
            {viewPrintState?.canPrint
              ? viewPrintState.isPreview
                ? "Это макет без присвоенного номера. Для комплекта с номерами подготовьте документы согласованной заявки. Печатайте в масштабе 100%."
                : "Печатайте в масштабе 100% («Фактический размер»)."
              : viewPrintState?.isPreview
                ? "Печать макета доступна только для текущей сохранённой и согласованной редакции. После изменения данных создайте новый предпросмотр."
                : "Редакция выпуска этого файла не подтверждена; доступен просмотр."}{" "}
            {awaitingSignatures
              ? "PDF подготовлен, электронные подписи ещё не получены."
              : ""}
          </p>
          {printError && <Notice>{printError}</Notice>}
          <PdfPreview artifactId={viewArtifact.id} />
          <div className="modal-actions">
            {viewPrintState?.canPrint && (
              <button
                className="primary"
                disabled={printing}
                onClick={async () => {
                  setPrinting(true);
                  setPrintError("");
                  try {
                    if (viewPrintState.isPreview) {
                      let latest: Draft;
                      try {
                        latest = await api<Draft>(
                          `/print-requests/${requestId}`,
                        );
                      } catch (caught) {
                        setServerReview(null);
                        setPrintError(
                          `Не удалось проверить согласованную редакцию: ${errorText(caught)}`,
                        );
                        return;
                      }
                      setServerReview(latest);
                      if (!previewReviewMatches(draft, latest)) {
                        setPrintError(
                          "Заявка изменилась в другом окне. Обновите её состояние и сформируйте предпросмотр согласованной редакции.",
                        );
                        return;
                      }
                    }
                    await printPdfArtifact(viewArtifact.id);
                  } catch {
                    setPrintError(
                      "Этот браузер не открыл диалог печати. Откройте PDF в отдельной вкладке или скачайте его и нажмите Ctrl+P.",
                    );
                  } finally {
                    setPrinting(false);
                  }
                }}
              >
                <Icon name="print" />{" "}
                {printing
                  ? "Подготовка печати…"
                  : viewPrintState.isPreview
                    ? "Печать макета PDF"
                    : "Печать PDF"}
              </button>
            )}
            <a
              className="button"
              href={`/api/artifacts/${viewArtifact.id}?inline=1`}
              target="_blank"
              rel="noreferrer"
            >
              Открыть PDF отдельно
            </a>
            <a
              className="button"
              href={`/api/artifacts/${viewArtifact.id}`}
              download
            >
              Скачать PDF
            </a>
            <button onClick={() => setViewArtifact(null)}>Закрыть</button>
          </div>
        </Modal>
      )}
    </section>
  );
}
