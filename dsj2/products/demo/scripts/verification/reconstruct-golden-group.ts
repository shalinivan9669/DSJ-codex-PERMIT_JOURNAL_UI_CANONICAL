import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { db, type Context } from "../../apps/api/src/core";
import { readArtifact, restoreArtifact, store } from "../../apps/api/src/files";
import {
  claimJob,
  executeJob,
  heartbeat,
} from "../../apps/render-worker/src/queue";
import { PRODUCT_ROOT } from "../../packages/printing/src";
import { assertTestDatabase } from "../../tests/integration/test-database";

// Explicit reconstruction of synthetic G1 output after the group ordinal fix.
// Keep original artifact bytes and numbers; the new files expose their provenance.
async function main() {
  assertTestDatabase();
  const directory = join(
    PRODUCT_ROOT,
    "docs/evidence/operator-value/golden/G1",
  );
  const scenario = JSON.parse(await readFile(directory + ".json", "utf8"));
  assert.equal(scenario.synthetic, true);
  const user = await db.user.findFirstOrThrow({
    where: { tenantId: scenario.tenantId },
  });
  const c: Context = {
    tenantId: scenario.tenantId,
    userId: user.id,
    role: "ADMIN",
    sessionId: "verification",
    csrfHash: "verification",
    correlationId: randomUUID(),
  };
  const document = await db.issuedDocument.findFirstOrThrow({
    where: {
      tenantId: c.tenantId,
      requestId: scenario.requestId,
      ownerKind: "GROUP",
    },
  });
  const original = await db.artifact.findFirstOrThrow({
    where: {
      tenantId: c.tenantId,
      documentId: document.id,
      format: "PDF",
      provenance: "ORIGINAL",
    },
  });
  const beforeBytes = (await readArtifact(c, original.id)).buffer;
  const beforeNumbers = await db.numberReservation.count({
    where: { tenantId: c.tenantId },
  });
  const restoration = await restoreArtifact(c, original.id, {
    reason:
      "Синтетическая проверка G1: отдельная реконструкция после исправления переноса порядкового номера 100. Исходный файл сохранён.",
  });
  const owner = "golden-group-reconstruction-" + randomUUID();
  for (const planned of restoration.jobs) {
    const existing = await db.generationJob.findUniqueOrThrow({
      where: { id: planned.id },
    });
    if (existing.status === "SUCCEEDED") continue;
    const job = await claimJob(db, owner, c.tenantId);
    assert.ok(job);
    assert.ok(restoration.jobs.some((j) => j.id === job.id));
    const beat = setInterval(() => {
      void heartbeat(db, job, owner);
    }, 5000);
    try {
      await executeJob(db, store, job, owner, new AbortController().signal);
    } finally {
      clearInterval(beat);
    }
  }
  const reconstructed = await db.artifact.findMany({
    where: {
      tenantId: c.tenantId,
      jobId: { in: restoration.jobs.map((j) => j.id) },
    },
    orderBy: { format: "asc" },
  });
  assert.equal(reconstructed.length, 2);
  assert.deepEqual((await readArtifact(c, original.id)).buffer, beforeBytes);
  assert.equal(
    await db.numberReservation.count({ where: { tenantId: c.tenantId } }),
    beforeNumbers,
  );
  await mkdir(join(directory, "reconstructed"), { recursive: true });
  for (const artifact of reconstructed) {
    assert.equal(artifact.provenance, "RECONSTRUCTED");
    await copyFile(
      store.path(artifact.storageKey),
      join(
        directory,
        "reconstructed",
        `${artifact.id}.${artifact.format.toLowerCase()}`,
      ),
    );
  }
  const evidence = {
    synthetic: true,
    sourceRequestId: scenario.requestId,
    documentId: document.id,
    documentNumber: document.number,
    originalArtifactId: original.id,
    originalSha256: original.sha256,
    originalUnchanged: true,
    reservationsBefore: beforeNumbers,
    reservationsAfter: beforeNumbers,
    provenance: "RECONSTRUCTED",
    reason:
      "Group ordinal column now shows 100 on one line; original retained.",
    files: reconstructed.map((a) => ({
      id: a.id,
      format: a.format,
      sha256: a.sha256,
      provenance: a.provenance,
      size: a.size,
    })),
  };
  await writeFile(
    join(directory, "reconstruction.json"),
    JSON.stringify(evidence, null, 2),
  );
  console.log(JSON.stringify(evidence));
}
main().finally(() => db.$disconnect());
