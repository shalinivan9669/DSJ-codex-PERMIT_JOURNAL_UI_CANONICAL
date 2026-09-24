import { db } from "../../apps/api/src/core";
import { ArtifactStore } from "../../packages/printing/src";
import {
  claimJob,
  executeJob,
  heartbeat,
  settleFailure,
  expireExhausted,
} from "../../apps/render-worker/src/queue";
import { assertTestDatabase } from "../../tests/integration/test-database";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile, copyFile, readFile } from "node:fs/promises";
import assert from "node:assert/strict";

async function main() {
  assertTestDatabase();
  const tenant = await db.tenant.findFirstOrThrow({
    where: { name: "OT Center — G2 — синтетические данные" },
    orderBy: { createdAt: "desc" },
  });
  const request = await db.printRequest.findFirstOrThrow({
    where: { tenantId: tenant.id, status: "FINALIZED" },
    orderBy: { createdAt: "desc" },
  });
  const before = await db.numberReservation.count({
    where: { tenantId: tenant.id },
  });
  const store = new ArtifactStore(),
    failures: Array<unknown> = [],
    start = performance.now();
  console.log(
    JSON.stringify({
      resumeRequest: request.id,
      tenant: tenant.id,
      reservations: before,
    }),
  );
  await expireExhausted(db);
  await Promise.all(
    Array.from({ length: 4 }, async (_, index) => {
      const owner = "golden-resume-" + index + "-" + randomUUID();
      for (;;) {
        const job = await claimJob(db, owner, tenant.id);
        if (!job) {
          const pending = await db.generationJob.count({
            where: {
              tenantId: tenant.id,
              status: { in: ["PENDING", "RUNNING", "RETRY"] },
            },
          });
          if (!pending) break;
          await new Promise((r) => setTimeout(r, 750));
          continue;
        }
        const timer = setInterval(() => {
          void heartbeat(db, job, owner).catch(() => {});
        }, 5000);
        try {
          await executeJob(db, store, job, owner, new AbortController().signal);
        } catch (error) {
          await settleFailure(db, job, owner, error);
          failures.push({
            jobId: job.id,
            error: error instanceof Error ? error.message : "UNKNOWN",
          });
        } finally {
          clearInterval(timer);
        }
      }
    }),
  );
  const documents = await db.issuedDocument.findMany({
    where: { requestId: request.id },
  });
  const jobs = await db.generationJob.findMany({
    where: { requestId: request.id },
  });
  const artifacts = await db.artifact.findMany({
    where: { requestId: request.id },
  });
  const expected = JSON.parse(
    await readFile(
      "tests/fixtures/operator-value/EXPECTED_FIXTURES.json",
      "utf8",
    ),
  ).G2;
  const directory = "docs/evidence/operator-value/golden";
  await mkdir(directory + "/G2", { recursive: true });
  const evidence = {
    scenario: "G2",
    synthetic: true,
    tenantId: tenant.id,
    requestId: request.id,
    documents: documents.length,
    groupProtocols: documents.filter((d) => d.ownerKind === "GROUP").length,
    jobs: jobs.length,
    artifacts: artifacts.length,
    jobStates: jobs.reduce(
      (r, j) => ({ ...r, [j.status]: (r[j.status] || 0) + 1 }),
      {} as Record<string, number>,
    ),
    numberIncrements: await db.numberSequence.findMany({
      where: { tenantId: tenant.id },
      select: { namespace: true, value: true },
    }),
    resumedAfterLocalProcessInterruption: true,
    resumeDurationMs: performance.now() - start,
    totalGenerationMs: null,
    measurementScope:
      "Original worker stopped when local PostgreSQL process ended; resumed same durable jobs and issuance. No uninterrupted total-duration claim.",
    failures,
    files: artifacts.map((a) => ({
      id: a.id,
      documentId: a.documentId,
      format: a.format,
      sha256: a.sha256,
      size: a.size,
    })),
  };
  await writeFile(directory + "/G2.json", JSON.stringify(evidence, null, 2));
  for (const a of artifacts.filter(
    (a) =>
      a.format === "ZIP" ||
      a.format === "XLSX" ||
      documents.some((d) => d.ownerKind === "GROUP" && d.id === a.documentId),
  ))
    await copyFile(
      store.path(a.storageKey),
      directory +
        "/G2/" +
        (a.documentId || "G2") +
        "." +
        a.format.toLowerCase(),
    );
  assert.equal(documents.length, expected.registeredDocuments);
  assert.equal(artifacts.length, expected.canonicalJobsAndArtifacts);
  assert.ok(jobs.every((j) => j.status === "SUCCEEDED"));
  assert.equal(
    await db.numberReservation.count({ where: { tenantId: tenant.id } }),
    before,
  );
  console.log(
    JSON.stringify({
      status: "PASS",
      request: request.id,
      documents: documents.length,
      artifacts: artifacts.length,
    }),
  );
}
main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
