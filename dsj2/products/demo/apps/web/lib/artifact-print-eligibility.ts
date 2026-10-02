import type { Artifact, Draft, Issuance, Job } from "./types";

export type PrintReviewState = Pick<
  Draft,
  "revision" | "approvedRevision" | "approval" | "archived" | "archivedAt"
>;

export function previewReviewMatches(
  local: PrintReviewState,
  server?: PrintReviewState | null,
) {
  return !!(
    server &&
    !local.archived &&
    !local.archivedAt &&
    !server.archived &&
    !server.archivedAt &&
    local.approval?.status === "APPROVED" &&
    server.approval?.status === "APPROVED" &&
    local.revision === local.approvedRevision &&
    server.revision === server.approvedRevision &&
    local.revision === server.revision &&
    local.approval.proposalId === server.approval.proposalId &&
    local.approval.proposalHash === server.approval.proposalHash
  );
}

type PrintInput = {
  artifact: Artifact;
  draft: PrintReviewState;
  serverReview?: PrintReviewState | null;
  jobs: Job[];
  issuances: Issuance[];
  previewPrintAllowed: boolean;
  missing?: string[];
};

/** Only immutable issued files or the exact approved preview can offer printing. */
export function artifactPrintEligibility({
  artifact,
  draft,
  serverReview,
  jobs,
  issuances,
  previewPrintAllowed,
  missing = [],
}: PrintInput) {
  const isPreview = artifact.provenance === "PREVIEW";
  const previewJob = jobs.find(
    (job) =>
      !job.issuanceId &&
      job.artifactId === artifact.id &&
      ["READY", "COMPLETED", "SUCCEEDED"].includes(job.status),
  );
  const sourceRevision = isPreview ? previewJob?.sourceRevision : undefined;
  const issuance =
    !isPreview &&
    issuances.find(
      (issued) =>
        artifact.issuanceId === issued.id ||
        issued.artifacts?.some((file) => file.id === artifact.id) ||
        issued.documents?.some(
          (document) =>
            document.id === artifact.documentId ||
            document.artifacts?.some((file) => file.id === artifact.id),
        ) ||
        jobs.some(
          (job) =>
            job.issuanceId === issued.id && job.artifactId === artifact.id,
        ),
    );
  const currentApprovedPreview =
    isPreview &&
    previewPrintAllowed &&
    previewReviewMatches(draft, serverReview) &&
    sourceRevision === draft.approvedRevision;
  const available =
    artifact.availability !== "MISSING" && !missing.includes(artifact.id);
  return {
    canPrint: available && (!!issuance || currentApprovedPreview),
    isPreview,
    sourceRevision: issuance ? issuance.sourceRevision : sourceRevision,
    label: isPreview
      ? `Предпросмотр без номера${sourceRevision == null ? "" : ` · редакция ${sourceRevision}`}`
      : issuance
        ? `${artifact.provenance === "RECONSTRUCTED" ? "Восстановленная копия" : "Сохранённый оригинал"} · редакция ${issuance.sourceRevision}`
        : "Файл без подтверждённой редакции выпуска",
  };
}
