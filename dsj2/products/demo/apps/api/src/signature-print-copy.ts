import { createHash } from "node:crypto";
import type { Artifact } from "@demo/database";
import { ArtifactStore, runRender } from "@demo/printing";
import { db, fail, hash, type Context } from "./core";
import {
  assertArtifactDownloadAllowed,
  assertLocalMockIssuancesAllowed,
} from "./artifact-access";
import { signingMockModeForProvider } from "./local-signing-mock";
import { readCmsSignerIdentity } from "./signature-display-metadata";

const store = new ArtifactStore();
const roleLabels: Record<string, string> = {
  DIRECTOR: "Директор",
  CHAIR: "Председатель комиссии",
  TEACHER: "Преподаватель",
  MEMBER: "Член комиссии",
};
const cache = new Map<string, Buffer>();
const CACHE_BYTES = 32 * 1024 * 1024;
function remember(key: string, value: Buffer) {
  if (value.length > CACHE_BYTES) return;
  cache.set(key, value);
  while (
    cache.size > 24 ||
    [...cache.values()].reduce((size, entry) => size + entry.length, 0) >
      CACHE_BYTES
  )
    cache.delete(cache.keys().next().value!);
}
function receiptTime(date: Date) {
  return (
    new Intl.DateTimeFormat("ru-RU", {
      timeZone: "Asia/Almaty",
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).format(date) + " (UTC+5)"
  );
}
async function verifiedBytes(artifact: Artifact) {
  try {
    const bytes = await store.read(artifact.storageKey, artifact.sha256);
    if (bytes.length !== artifact.size) throw new Error("SIZE");
    return bytes;
  } catch {
    fail(
      503,
      "ARTIFACT_UNAVAILABLE",
      "Исходный файл отсутствует или повреждён. Копия с отметками не создана",
    );
  }
}

/** A display derivative only. Detached signatures always belong to the unchanged
 * source PDF. Raw downloads and signing never pass through this function. */
async function signaturePrintData(c: Context, source: Artifact) {
  if (source.tenantId !== c.tenantId) fail(404, "NOT_FOUND", "Файл не найден");
  if (
    source.provenance !== "ORIGINAL" ||
    !source.documentId ||
    !source.issuanceId ||
    !["PDF", "DOCX"].includes(source.format)
  )
    return null;
  const sourceJob = await db.generationJob.findFirst({
    where: { tenantId: c.tenantId, id: source.jobId },
  });
  if (!sourceJob) return null;
  const pdfJob =
    source.format === "PDF"
      ? sourceJob
      : await db.generationJob.findFirst({
          where: {
            tenantId: c.tenantId,
            snapshotId: sourceJob.snapshotId,
            kind: "PDF",
          },
        });
  const pdf =
    source.format === "PDF"
      ? source
      : pdfJob?.artifactId
        ? await db.artifact.findFirst({
            where: {
              tenantId: c.tenantId,
              id: pdfJob.artifactId,
              documentId: source.documentId,
              issuanceId: source.issuanceId,
              provenance: "ORIGINAL",
              format: "PDF",
            },
          })
        : null;
  if (!pdf) return null;
  const signatures = await db.documentSignature.findMany({
    where: {
      tenantId: c.tenantId,
      artifactId: pdf.id,
      issuanceId: source.issuanceId,
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
  if (!signatures.length) return null;
  await assertLocalMockIssuancesAllowed(c, [source.issuanceId]);
  const [document, workflow, bindings, docxJob] = await Promise.all([
    db.issuedDocument.findFirst({
      where: {
        tenantId: c.tenantId,
        id: source.documentId,
        issuanceId: source.issuanceId,
      },
    }),
    db.issuanceWorkflow.findFirst({
      where: { tenantId: c.tenantId, issuanceId: source.issuanceId },
    }),
    db.signatoryBinding.findMany({
      where: {
        tenantId: c.tenantId,
        id: { in: signatures.map((s) => s.bindingId) },
      },
    }),
    source.format === "DOCX"
      ? sourceJob
      : db.generationJob.findFirst({
          where: {
            tenantId: c.tenantId,
            snapshotId: sourceJob.snapshotId,
            kind: "DOCX",
          },
        }),
  ]);
  if (!document || !workflow)
    fail(
      409,
      "SIGNATURE_COPY_SOURCE",
      "Не найден сохранённый состав подписантов документа",
    );
  const docx =
    source.format === "DOCX"
      ? source
      : docxJob?.artifactId
        ? await db.artifact.findFirst({
            where: {
              tenantId: c.tenantId,
              id: docxJob.artifactId,
              documentId: source.documentId,
              issuanceId: source.issuanceId,
              provenance: "ORIGINAL",
              format: "DOCX",
            },
          })
        : null;
  if (!docx)
    fail(
      409,
      "SIGNATURE_COPY_SOURCE",
      "Для копии с отметками нужен сохранённый DOCX этого документа",
    );
  const docxBytes = await verifiedBytes(docx);
  await verifiedBytes(pdf);
  const { signersFor } = await import("./signing");
  const required = signersFor(
    workflow.requiredSigners as unknown as Parameters<typeof signersFor>[0],
    document.templateId,
    document.assignmentId,
    document.groupEventId,
  );
  const mockMode =
    signatures
      .map((signature) => signingMockModeForProvider(signature.provider))
      .find(Boolean) || null;
  // Legacy render contract uses localTest for every unverified test signature.
  const localTest = !!mockMode;
  const signers = [];
  for (const signature of signatures) {
    if (signature.documentSha256 !== pdf.sha256)
      fail(
        409,
        "SIGNATURE_BINDING_MISMATCH",
        "Подпись относится к другой версии оригинала",
      );
    const binding = bindings.find((b) => b.id === signature.bindingId);
    const frozenSigner = required.find(
      (s) => s.bindingId === signature.bindingId,
    );
    if (!binding || !frozenSigner)
      fail(
        409,
        "SIGNATURE_COPY_BINDING",
        "Не найдено назначение подписанта сохранённого документа",
      );
    let cms: Buffer;
    try {
      cms = await store.read(
        signature.signatureStorageKey,
        signature.signatureSha256,
      );
    } catch {
      fail(
        503,
        "SIGNATURE_UNAVAILABLE",
        "Сохранённая подпись недоступна. Копия с отметками не создана",
      );
    }
    const identity = readCmsSignerIdentity(cms);
    const isMock = !!signingMockModeForProvider(signature.provider);
    signers.push({
      role: roleLabels[frozenSigner.kind] || frozenSigner.kind,
      displayName:
        identity?.displayName ||
        (isMock
          ? "Имя владельца сертификата не определено"
          : frozenSigner.displayName),
      receivedAt: receiptTime(signature.createdAt),
      receivedAtIso: signature.createdAt.toISOString(),
      identityNote: identity
        ? isMock
          ? "Имя из сертификата, не проверено"
          : "Имя из сертификата"
        : isMock
          ? "Тестовая роль в центре"
          : "Имя из назначения подписанта",
    });
  }
  const pendingRoles = required
    .filter(
      (s) =>
        !signatures.some((signature) => signature.bindingId === s.bindingId),
    )
    .map((s) => roleLabels[s.kind] || s.kind);
  const payload = {
    format: source.format,
    templateId: document.templateId,
    documentNumber: document.number,
    sourcePdfSha256: pdf.sha256,
    sourcePdfArtifactId: pdf.id,
    localTest,
    testMode: !!mockMode,
    mockMode,
    signers,
    pendingRoles,
    timezone: "Asia/Almaty",
    verificationUrl: new URL(
      `/signature-evidence/${pdf.id}`,
      process.env.DEMO_ORIGIN || "http://localhost:3100",
    ).href,
  };
  const evidence = {
    sourceArtifactId: source.id,
    sourceSha256: source.sha256,
    sourceDocxArtifactId: docx.id,
    sourceDocxSha256: docx.sha256,
    sourcePdfArtifactId: pdf.id,
    sourcePdfSha256: pdf.sha256,
    signatures: signatures.map((s) => ({
      id: s.id,
      sha256: s.signatureSha256,
      acceptedAt: s.createdAt.toISOString(),
    })),
    localTest,
    testMode: !!mockMode,
    mockMode,
    pendingRoles,
    signatureSetHash: hash(
      signatures.map((s) => ({ id: s.id, sha256: s.signatureSha256 })),
    ),
  };
  return { source, docxBytes, payload, evidence };
}

export async function signaturePrintInfo(c: Context, id: string) {
  const source = await db.artifact.findFirst({
    where: { tenantId: c.tenantId, id },
  });
  if (!source) fail(404, "NOT_FOUND", "Файл не найден");
  await assertArtifactDownloadAllowed(c, source);
  const data = await signaturePrintData(c, source);
  if (!data)
    fail(
      404,
      "SIGNATURES_NOT_FOUND",
      "Для этого оригинала пока нет сохранённых ЭЦП",
    );
  return {
    artifactId: data.evidence.sourcePdfArtifactId,
    requestId: source.requestId,
    documentNumber: data.payload.documentNumber,
    templateId: data.payload.templateId,
    sourcePdfSha256: data.evidence.sourcePdfSha256,
    localTest: data.payload.localTest,
    testMode: data.payload.testMode,
    mockMode: data.payload.mockMode,
    signers: data.payload.signers.map(({ receivedAtIso, ...signer }) => ({
      ...signer,
      receivedAt: receivedAtIso,
    })),
    pendingRoles: data.payload.pendingRoles,
    signatureSetHash: data.evidence.signatureSetHash,
    originalDownloadUrl: `/artifacts/${data.evidence.sourcePdfArtifactId}`,
  };
}

export async function signaturePrintCopy(c: Context, source: Artifact) {
  const data = await signaturePrintData(c, source);
  if (!data) return null;
  const { docxBytes, payload, evidence } = data;
  const cacheKey = hash({
    version: 1,
    tenantId: c.tenantId,
    payload,
    evidence,
  });
  let buffer = cache.get(cacheKey);
  if (!buffer) {
    try {
      buffer = (
        await runRender("signature-copy", payload, {
          inputBytes: docxBytes,
          inputExtension: "docx",
          timeoutMs: 210_000,
        })
      ).buffer;
    } catch {
      fail(
        503,
        "SIGNATURE_COPY_UNAVAILABLE",
        "Не удалось подготовить копию с отметками ЭЦП. Исходный PDF доступен отдельно",
      );
    }
    remember(cacheKey, buffer);
  }
  return {
    ...source,
    buffer,
    fileName: source.fileName.replace(/\.(pdf|docx)$/i, " — отметки ЭЦП.$1"),
    size: buffer.length,
    sha256: createHash("sha256").update(buffer).digest("hex"),
    provenance: "SIGNATURE_PRINT_COPY",
    signatureEvidence: evidence,
  };
}
