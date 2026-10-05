import { createHash } from "node:crypto";
import { open, realpath } from "node:fs/promises";
import { isAbsolute, relative } from "node:path";
import type { GenerationJob, Prisma } from "@demo/database";
import { ArtifactStore } from "@demo/printing";
import { audit, fail, type Context } from "./core";

/** Bounded memory/time verification only for the two explicitly selected files. */
async function intact(storageKey: string, size: number, sha256: string) {
  const store = new ArtifactStore();
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    const actual = await realpath(store.path(storageKey));
    const root = await realpath(store.root);
    const rel = relative(root, actual);
    if (rel.startsWith("..") || isAbsolute(rel)) return false;
    handle = await open(actual, "r");
    const metadata = await handle.stat();
    if (!metadata.isFile() || metadata.size !== size) return false;
    const digest = createHash("sha256");
    for await (const chunk of handle.createReadStream({
      autoClose: false,
      highWaterMark: 64 * 1024,
      signal: AbortSignal.timeout(5000),
    }))
      digest.update(chunk);
    return digest.digest("hex") === sha256;
  } catch (error) {
    if ((error as Error).name === "AbortError")
      fail(
        503,
        "PREVIEW_VERIFICATION_TIMEOUT",
        "Проверка сохранённого предпросмотра заняла слишком долго. Повторите открытие.",
      );
    return false;
  } finally {
    await handle?.close();
  }
}

/** Re-render only preview jobs; retain every old artifact and its provenance. */
export async function recoverPreviewArtifacts(
  tx: Prisma.TransactionClient,
  c: Context,
  jobs: GenerationJob[],
) {
  const result: GenerationJob[] = [];
  for (const job of jobs) {
    if (job.status !== "SUCCEEDED" || job.issuanceId || job.documentId) {
      result.push(job);
      continue;
    }
    const artifact = job.artifactId
      ? await tx.artifact.findFirst({
          where: {
            id: job.artifactId,
            tenantId: c.tenantId,
            requestId: job.requestId,
            jobId: job.id,
            issuanceId: null,
            documentId: null,
          },
        })
      : null;
    if (
      artifact &&
      (await intact(artifact.storageKey, artifact.size, artifact.sha256))
    ) {
      result.push(job);
      continue;
    }
    const snapshot = await tx.renderInputSnapshot.findFirst({
      where: {
        id: job.snapshotId,
        tenantId: c.tenantId,
        requestId: job.requestId,
        issuanceId: null,
      },
    });
    if (
      !snapshot ||
      (snapshot.input as { mode?: string }).mode !== "draft-preview"
    )
      fail(
        409,
        "PREVIEW_SOURCE_INVALID",
        "Не удалось подтвердить исходную редакцию предпросмотра",
      );
    await tx.generationJob.updateMany({
      where: {
        id: job.id,
        tenantId: c.tenantId,
        status: "SUCCEEDED",
        artifactId: job.artifactId,
        issuanceId: null,
        documentId: null,
      },
      data: {
        status: "PENDING",
        artifactId: null,
        attempts: 0,
        progress: 0,
        runAfter: new Date(),
        leaseUntil: null,
        leaseOwner: null,
        heartbeatAt: null,
        errorCode: null,
        errorMessage: null,
      },
    });
    await audit(tx, c, "PREVIEW_ARTIFACT_RECOVERY", job.id, {
      previousArtifactId: job.artifactId,
      reason: artifact ? "MISSING_OR_CORRUPT_STORAGE" : "MISSING_ARTIFACT",
    });
    result.push(
      await tx.generationJob.findFirstOrThrow({
        where: { id: job.id, tenantId: c.tenantId },
      }),
    );
  }
  return result;
}
