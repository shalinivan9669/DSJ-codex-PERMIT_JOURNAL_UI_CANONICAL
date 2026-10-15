import { BUNDLE_PART_BYTES, partitionSavedArtifacts } from "@demo/printing";
import { z } from "@demo/contracts";
import {
  db,
  fail,
  hash,
  json,
  parse,
  transaction,
  audit,
  type Context,
} from "../core";
import { Prisma, type Artifact } from "@demo/database";
import {
  enrollmentJoins,
  enrollmentPredicate,
  parseEnrollmentQuery,
} from "./enrollment-query";

const selectionSchema = z
  .object({
    documentIds: z.array(z.string().uuid()).min(1).max(30000),
    format: z.enum(["PDF", "DOCX"]).default("PDF"),
  })
  .strict();
type Selection = ReturnType<typeof selectionSchema.parse>;

async function bundleSources(c: Context, selection: Selection) {
  const scope = enrollmentPredicate(c, parseEnrollmentQuery({}));
  const rows = await db.$queryRaw<
    Array<{
      documentId: string;
      state: string | null;
      revoked: boolean;
      artifact: Artifact | null;
    }>
  >(Prisma.sql`
    SELECT dl.id AS "documentId",iw.status AS state,
      EXISTS (SELECT 1 FROM "LmsResultEvent" ev WHERE ev."tenantId"=e."tenantId" AND ev."resultId"=dl."resultId" AND ev.kind IN ('VOIDED','SUPERSEDED')) AS revoked,
      CASE WHEN a.id IS NOT NULL THEN row_to_json(a) END AS artifact
    ${enrollmentJoins}
    JOIN "VerifiedExamResult" vr ON vr."tenantId"=e."tenantId" AND vr."enrollmentId"=e.id
    JOIN "LmsDocumentLink" dl ON dl."tenantId"=e."tenantId" AND dl."resultId"=vr.id
    LEFT JOIN "IssuanceWorkflow" iw ON iw."tenantId"=e."tenantId" AND iw."issuanceId"=dl."issuanceId"
    LEFT JOIN "IssuedDocument" d ON d."tenantId"=e."tenantId" AND d."issuanceId"=dl."issuanceId" AND d."assignmentId"=vr.id||'-'||dl."documentType" AND d."rowId"=vr."recipientId"
    LEFT JOIN LATERAL (SELECT a.* FROM "Artifact" a WHERE a."tenantId"=e."tenantId" AND a."documentId"=d.id AND a.format=${selection.format} ORDER BY a."createdAt" DESC,a.id DESC LIMIT 1) a ON true
    WHERE ${scope} AND dl.id IN (${Prisma.join(selection.documentIds)}) ORDER BY dl.id`);
  if (rows.length !== selection.documentIds.length)
    fail(404, "NOT_FOUND", "Документ недоступен");
  if (rows.some((r) => r.revoked))
    fail(409, "RESULT_INELIGIBLE", "Выберите действующие документы");
  if (rows.some((r) => r.state !== "ISSUED" || !r.artifact))
    fail(
      409,
      "DOCUMENT_NOT_READY",
      "Дождитесь готовности файлов и обязательных подписей",
    );
  return rows.map((r) => r.artifact!).sort((a, b) => a.id.localeCompare(b.id));
}

/** The durable render queue builds each bounded part once. No archive bytes pass through this operation. */
export async function prepareDocumentBundle(c: Context, input: unknown) {
  const request = parse(
    selectionSchema
      .partial({ documentIds: true })
      .extend({ groupId: z.string().uuid().optional() })
      .refine((data) => !!data.groupId !== !!data.documentIds?.length),
    input,
  );
  let documentIds = request.documentIds;
  if (request.groupId) {
    const scope = enrollmentPredicate(
      c,
      parseEnrollmentQuery({ groupId: request.groupId }),
    );
    const rows = await db.$queryRaw<Array<{ id: string }>>(
      Prisma.sql`SELECT dl.id ${enrollmentJoins} JOIN "LmsDocumentLink" dl ON dl."tenantId"=e."tenantId" AND dl."resultId"=latest.id JOIN "IssuanceWorkflow" iw ON iw."tenantId"=e."tenantId" AND iw."issuanceId"=dl."issuanceId" WHERE ${scope} AND iw.status='ISSUED' AND NOT EXISTS (SELECT 1 FROM "LmsResultEvent" ev WHERE ev."tenantId"=e."tenantId" AND ev."resultId"=latest.id AND ev.kind IN ('VOIDED','SUPERSEDED')) ORDER BY dl.id LIMIT 30001`,
    );
    if (rows.length > 30000)
      fail(
        422,
        "BUNDLE_SELECTION_LIMIT",
        "В группе слишком много документов для одного комплекта",
      );
    documentIds = rows.map((r) => r.id);
  }
  if (!documentIds?.length)
    fail(
      409,
      "DOCUMENT_NOT_READY",
      "В выбранном составе ещё нет готовых документов",
    );
  const selection = { documentIds, format: request.format };
  selection.documentIds = [...new Set(selection.documentIds)].sort();
  const files = await bundleSources(c, selection);
  const directFiles = files.filter((f) => f.size > BUNDLE_PART_BYTES);
  const parts = partitionSavedArtifacts(
    files.filter((f) => f.size <= BUNDLE_PART_BYTES),
  );
  const identity = hash({
    tenantId: c.tenantId,
    selection,
    files: files.map((f) => [f.id, f.sha256]),
  });
  const job = await transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${"lms-bundle:" + identity},0))`;
    const existing = await tx.generationJob.findUnique({
      where: { logicalKey: `lms-bundle:${identity}` },
    });
    if (existing) {
      if (existing.status === "FAILED")
        await tx.generationJob.update({
          where: { id: existing.id },
          data: {
            status: "PENDING",
            attempts: 0,
            runAfter: new Date(),
            errorCode: null,
            errorMessage: null,
          },
        });
      return existing;
    }
    const sourceJob = await tx.generationJob.findFirstOrThrow({
      where: { tenantId: c.tenantId, id: files[0].jobId },
    });
    const sourceSnapshot = await tx.renderInputSnapshot.findFirstOrThrow({
      where: { tenantId: c.tenantId, id: sourceJob.snapshotId },
    });
    const input = {
      mode: "lms-bundle",
      selection,
      sourceArtifactIds: files.map((f) => f.id),
      directArtifactIds: directFiles.map((f) => f.id),
      parts: parts.map((p) => p.map((f) => f.id)),
    };
    const snapshot = await tx.renderInputSnapshot.create({
      data: {
        tenantId: c.tenantId,
        requestId: files[0].requestId,
        revision: sourceSnapshot.revision,
        profileVersionId: sourceSnapshot.profileVersionId,
        input: json(input),
        inputHash: hash(input),
      },
    });
    const created = await tx.generationJob.create({
      data: {
        tenantId: c.tenantId,
        requestId: files[0].requestId,
        snapshotId: snapshot.id,
        kind: "ZIP",
        logicalKey: `lms-bundle:${identity}`,
        status: parts.length ? "PENDING" : "SUCCEEDED",
        correlationId: c.correlationId,
        progress: parts.length ? 0 : 100,
      },
    });
    await audit(tx, c, "LMS_DOCUMENT_BUNDLE_REQUESTED", created.id, {
      documentIds: selection.documentIds,
      format: selection.format,
      partCount: parts.length,
      directFiles: directFiles.length,
    });
    return created;
  });
  return documentBundleStatus(c, job.id);
}

export async function documentBundleStatus(c: Context, id: string) {
  const job = await db.generationJob.findFirst({
    where: {
      tenantId: c.tenantId,
      id,
      kind: "ZIP",
      logicalKey: { startsWith: "lms-bundle:" },
    },
  });
  if (!job) fail(404, "NOT_FOUND", "Комплект не найден");
  const snapshot = await db.renderInputSnapshot.findFirstOrThrow({
    where: { tenantId: c.tenantId, id: job.snapshotId },
  });
  const input = snapshot.input as {
    selection: Selection;
    sourceArtifactIds: string[];
    directArtifactIds: string[];
    parts: string[][];
  };
  const sources = await bundleSources(c, input.selection);
  if (
    sources.length !== input.sourceArtifactIds.length ||
    sources.some((f) => !input.sourceArtifactIds.includes(f.id))
  )
    fail(
      409,
      "BUNDLE_SOURCE_CHANGED",
      "Состав файлов обновился. Подготовьте комплект ещё раз",
    );
  const artifacts = await db.artifact.findMany({
    where: { tenantId: c.tenantId, jobId: job.id },
    orderBy: { fileName: "asc" },
  });
  return {
    id: job.id,
    status:
      job.status === "SUCCEEDED"
        ? "READY"
        : job.status === "FAILED"
          ? "FAILED"
          : "PREPARING",
    error:
      job.status === "FAILED"
        ? {
            code: "BUNDLE_PREPARATION_FAILED",
            params: {},
            message: "Не удалось подготовить комплект. Повторите подготовку",
            correlationId: job.correlationId,
          }
        : null,
    partCount: input.parts.length,
    parts: artifacts.map((a, index) => ({
      index,
      artifactId: a.id,
      fileName: a.fileName,
      size: a.size,
    })),
    directFiles: sources
      .filter((f) => input.directArtifactIds.includes(f.id))
      .map((f) => ({ id: f.id, fileName: f.fileName, size: f.size })),
  };
}

export async function documentBundlePart(
  c: Context,
  id: string,
  index: number,
) {
  const state = await documentBundleStatus(c, id);
  if (state.status !== "READY")
    fail(409, "DOCUMENT_NOT_READY", "Комплект ещё готовится");
  const part = state.parts[index];
  if (!part) fail(404, "NOT_FOUND", "Часть комплекта не найдена");
  return part.artifactId;
}
