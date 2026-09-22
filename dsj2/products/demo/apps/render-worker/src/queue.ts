import { PrismaClient, type GenerationJob } from "@demo/database";
import {
  ArtifactStore,
  MIME,
  RENDERER_VERSION,
  runRender,
  selectBundleJobs,
} from "@demo/printing";
import { randomUUID } from "node:crypto";

const LEASE_SECONDS = 30;
export class DeferredJob extends Error {}
export class LostLease extends Error {}
export async function claimJob(
  db: PrismaClient,
  owner: string,
  scopeTenantId?: string,
): Promise<GenerationJob | null> {
  // Every acquisition, including recovery after a crash, consumes an attempt and fences the old owner.
  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock_shared(1145392463)`;
    const rows = await tx.$queryRaw<GenerationJob[]>`
    UPDATE "GenerationJob" SET status='RUNNING',attempts=attempts+1,"leaseOwner"=${owner},
      "leaseUntil"=(clock_timestamp() AT TIME ZONE 'UTC')+interval '30 seconds',"heartbeatAt"=(clock_timestamp() AT TIME ZONE 'UTC'),
      "fencingToken"="fencingToken"+1,"updatedAt"=(clock_timestamp() AT TIME ZONE 'UTC'),"errorCode"=NULL,"errorMessage"=NULL
    WHERE id=(SELECT id FROM "GenerationJob" WHERE
      ((status IN ('PENDING','RETRY') AND "runAfter"<=(clock_timestamp() AT TIME ZONE 'UTC')) OR
       (status='RUNNING' AND "leaseUntil"<(clock_timestamp() AT TIME ZONE 'UTC'))) AND attempts<"maxAttempts"
      AND (${scopeTenantId ?? null}::text IS NULL OR "tenantId"=${scopeTenantId ?? null})
      ORDER BY "runAfter","createdAt" FOR UPDATE SKIP LOCKED LIMIT 1)
    RETURNING *`;
    return rows[0] || null;
  });
}
export async function heartbeat(
  db: PrismaClient,
  job: GenerationJob,
  owner: string,
): Promise<boolean> {
  const count =
    await db.$executeRaw`UPDATE "GenerationJob" SET "leaseUntil"=(clock_timestamp() AT TIME ZONE 'UTC')+interval '30 seconds',"heartbeatAt"=(clock_timestamp() AT TIME ZONE 'UTC')
    WHERE id=${job.id} AND "tenantId"=${job.tenantId} AND status='RUNNING' AND "leaseOwner"=${owner}
      AND "fencingToken"=${job.fencingToken} AND "leaseUntil">(clock_timestamp() AT TIME ZONE 'UTC')`;
  return count === 1;
}
export async function expireExhausted(db: PrismaClient): Promise<number> {
  return db.$executeRaw`UPDATE "GenerationJob" SET status='FAILED',"errorCode"='ATTEMPTS_EXHAUSTED',
    "leaseUntil"=NULL,"leaseOwner"=NULL,"updatedAt"=(clock_timestamp() AT TIME ZONE 'UTC')
    WHERE attempts>="maxAttempts" AND ((status='RUNNING' AND "leaseUntil"<(clock_timestamp() AT TIME ZONE 'UTC')) OR status IN ('PENDING','RETRY'))`;
}
async function docxDependency(db: PrismaClient, job: GenerationJob) {
  return db.generationJob.findFirst({
    where: { tenantId: job.tenantId, snapshotId: job.snapshotId, kind: "DOCX" },
  });
}
export async function executeJob(
  db: PrismaClient,
  store: ArtifactStore,
  job: GenerationJob,
  owner: string,
  signal: AbortSignal,
) {
  const snapshot = await db.renderInputSnapshot.findFirst({
    where: { id: job.snapshotId, tenantId: job.tenantId },
  });
  if (!snapshot) throw new Error("SNAPSHOT_MISSING");
  const input = snapshot.input as Record<string, unknown>;
  let output: { buffer: Buffer; metadata: Record<string, unknown> };
  if (job.kind === "DOCX") output = await runRender("docx", input, { signal });
  else if (job.kind === "PDF") {
    const dependency = await docxDependency(db, job);
    if (!dependency) throw new Error("SOURCE_DOCX_JOB_MISSING");
    if (dependency?.status === "FAILED") throw new Error("SOURCE_DOCX_FAILED");
    if (!dependency?.artifactId || dependency.status !== "SUCCEEDED")
      throw new DeferredJob();
    const artifact = await db.artifact.findFirst({
      where: { id: dependency.artifactId, tenantId: job.tenantId },
    });
    if (!artifact) throw new Error("SOURCE_DOCX_MISSING");
    const bytes = await store.read(artifact.storageKey, artifact.sha256);
    output = await runRender(
      "pdf",
      {},
      { signal, inputBytes: bytes, inputExtension: "docx" },
    );
  } else if (job.kind === "XLSX")
    output = await runRender("xlsx", input, { signal });
  else if (job.kind === "ZIP") {
    if (!job.issuanceId) throw new Error("BUNDLE_ISSUANCE_REQUIRED");
    const jobs = selectBundleJobs(
      await db.generationJob.findMany({
        where: {
          tenantId: job.tenantId,
          issuanceId: job.issuanceId,
          kind: { not: "ZIP" },
        },
      }),
    );
    if (jobs.some((j) => !["SUCCEEDED", "FAILED"].includes(j.status)))
      throw new DeferredJob();
    const artifacts = await db.artifact.findMany({
      where: {
        tenantId: job.tenantId,
        id: {
          in: jobs.flatMap((j) =>
            j.status === "SUCCEEDED" && j.artifactId ? [j.artifactId] : [],
          ),
        },
      },
    });
    output = await runRender(
      "zip",
      {
        artifacts,
        issuanceId: job.issuanceId,
        expectedCount: jobs.length,
        missing: jobs
          .filter((j) => j.status === "FAILED")
          .map((j) => ({
            jobId: j.id,
            documentId: j.documentId,
            format: j.kind,
            reason: j.errorCode || "FAILED",
          })),
      },
      { signal },
    );
  } else throw new Error("UNSUPPORTED_JOB_KIND");
  if (signal.aborted) throw new LostLease();
  const blob = await store.put(output.buffer, job.kind.toLowerCase());
  // Blob storage is immutable; only the lease owner may publish its pointer. Transaction rollback
  // leaves an unreferenced blob rather than corrupting a prior canonical artifact.
  return db.$transaction(async (tx) => {
    const owned = await tx.$queryRaw<
      Array<{ id: string }>
    >`SELECT id FROM "GenerationJob" WHERE id=${job.id} AND "tenantId"=${job.tenantId}
      AND status='RUNNING' AND "leaseOwner"=${owner} AND "fencingToken"=${job.fencingToken} AND "leaseUntil">(clock_timestamp() AT TIME ZONE 'UTC') FOR UPDATE`;
    if (!owned.length) throw new LostLease();
    const artifact = await tx.artifact.create({
      data: {
        id: randomUUID(),
        tenantId: job.tenantId,
        jobId: job.id,
        requestId: job.requestId,
        issuanceId: job.issuanceId,
        documentId: job.documentId,
        format: job.kind,
        ...blob,
        mimeType: MIME[job.kind] || "application/octet-stream",
        fileName: `${job.kind === "ZIP" && output.metadata.complete === false ? "PARTIAL-" : ""}${input.templateId || "registry"}-${job.documentId || job.requestId}.${job.kind.toLowerCase()}`,
        templateVersion:
          input.templateVersion == null ? null : String(input.templateVersion),
        rendererVersion: RENDERER_VERSION,
        inputHash: snapshot.inputHash,
        provenance:
          input.provenance === "RECONSTRUCTED"
            ? "RECONSTRUCTED"
            : input.mode === "draft-preview"
              ? "PREVIEW"
              : "ORIGINAL",
      },
    });
    await tx.generationJob.update({
      where: { id: job.id },
      data: {
        status: "SUCCEEDED",
        progress: 100,
        artifactId: artifact.id,
        leaseUntil: null,
        leaseOwner: null,
      },
    });
    await tx.auditEvent.create({
      data: {
        tenantId: job.tenantId,
        actorId: "system:render-worker",
        action: "artifact.created",
        entityId: artifact.id,
        metadata: {
          jobId: job.id,
          format: job.kind,
          sha256: artifact.sha256,
          fencingToken: job.fencingToken,
          ...(typeof input.restoreOfArtifactId === "string"
            ? {
                restoreOfArtifactId: input.restoreOfArtifactId,
                originalSha256: String(input.originalSha256 || ""),
                provenance: "RECONSTRUCTED",
              }
            : {}),
        },
        correlationId: job.correlationId,
      },
    });
    return artifact;
  });
}
export async function settleFailure(
  db: PrismaClient,
  job: GenerationJob,
  owner: string,
  error: unknown,
) {
  const deferred = error instanceof DeferredJob;
  const message = error instanceof Error ? error.message : "RENDER_FAILED";
  const code = /^[A-Z_]{1,80}$/.test(message) ? message : "RENDER_FAILED";
  return db.generationJob.updateMany({
    where: {
      id: job.id,
      tenantId: job.tenantId,
      status: "RUNNING",
      leaseOwner: owner,
      fencingToken: job.fencingToken,
    },
    data: {
      status: deferred
        ? "PENDING"
        : job.attempts >= job.maxAttempts
          ? "FAILED"
          : "RETRY",
      attempts: deferred ? { decrement: 1 } : undefined,
      runAfter: new Date(
        Date.now() +
          (deferred ? 1500 : Math.min(60_000, 1000 * 2 ** job.attempts)),
      ),
      errorCode: deferred ? null : code,
      errorMessage: deferred
        ? null
        : code === "PRINT_LAYOUT_OVERFLOW"
          ? "Поля не помещаются в форму. Проверьте текст в черновике и создайте новую редакцию."
          : "Не удалось создать файл. Повтор безопасен для номеров.",
      leaseOwner: null,
      leaseUntil: null,
    },
  });
}
export { LEASE_SECONDS };
