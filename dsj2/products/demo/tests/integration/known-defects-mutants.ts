/** Controlled test-only mutations of prior decisions; never imported by product code. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { writeFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import { bootstrap } from "../../apps/api/src/main";
import { DemoController } from "../../apps/api/src/controller";
import { db, ctx, json, type Context } from "../../apps/api/src/core";
import { registryExport, store } from "../../apps/api/src/files";
import { createRequest, finalize } from "../../apps/api/src/requests";
import { passwordHash } from "../../apps/api/src/auth";
import { provision } from "../../scripts/setup";
import {
  buildZip,
  PRODUCT_ROOT,
  RENDERER_VERSION,
} from "../../packages/printing/src";
import { assertTestDatabase } from "./test-database";

async function main() {
  assertTestDatabase();
  process.env.PORT = "0";
  process.env.DEMO_ORIGIN = "http://localhost:3100";
  const who = await provision({
    email: `mutant-${randomUUID()}@example.test`,
    password: "Synthetic-Mutation-Password!",
    name: "Synthetic isolated regression mutations",
    sample: true,
  });
  const viewer = await db.user.create({
    data: {
      tenantId: who.tenantId,
      email: `mutant-viewer-${randomUUID()}@example.test`,
      displayName: "Synthetic viewer",
      role: "VIEWER",
      passwordHash: await passwordHash("Synthetic-Mutation-Password!"),
    },
  });
  const corrected = DemoController.prototype.password;
  const previous = function (
    this: DemoController,
    ...args: Parameters<typeof corrected>
  ) {
    ctx(args[0], true); // Original defect: viewing role may not change own credential.
    return corrected.apply(this, args);
  };
  for (const key of Reflect.getMetadataKeys(corrected))
    Reflect.defineMetadata(key, Reflect.getMetadata(key, corrected), previous);
  const statuses: number[] = [];
  for (const implementation of [previous, corrected]) {
    DemoController.prototype.password = implementation;
    const app = await bootstrap();
    try {
      const url = await app.getUrl();
      const response = await fetch(url + "/auth/login", {
        method: "POST",
        headers: {
          origin: process.env.DEMO_ORIGIN,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          email: viewer.email,
          password: "Synthetic-Mutation-Password!",
        }),
      });
      assert.equal(response.status, 201);
      const session = await response.json();
      const changed = await fetch(url + "/auth/password", {
        method: "POST",
        headers: {
          origin: process.env.DEMO_ORIGIN,
          "content-type": "application/json",
          cookie: response.headers
            .getSetCookie()
            .map((cookie) => cookie.split(";")[0])
            .join("; "),
          "x-csrf-token": session.csrfToken,
        },
        body: JSON.stringify({
          currentPassword: "Synthetic-Mutation-Password!",
          newPassword: "Changed-Synthetic-Mutation-Password!",
        }),
      });
      statuses.push(changed.status);
    } finally {
      await app.close();
    }
  }
  assert.deepEqual(statuses, [403, 201]);
  const context: Context = {
    ...who,
    role: "ADMIN",
    sessionId: "fixture",
    csrfHash: "fixture",
    correlationId: randomUUID(),
  };
  const request = await createRequest(context, {
    kind: "PERSON",
    items: [
      {
        id: randomUUID(),
        fullNameRu: "Синтетический Архив",
        assignments: [
          {
            id: randomUUID(),
            templateId: "biot-worker-card",
            documentDate: "2026-09-22",
            biotCategory: "WORKER",
            hours: "10",
            productionHours: "16",
            validUntil: "2027-09-22",
            trainingSubject: "Синтетическая программа",
            result: "Синтетический результат",
          },
        ],
      },
    ],
  });
  await finalize(context, request.id, { expectedRevision: 0 }, randomUUID());
  const jobs = await db.generationJob.findMany({
    where: { requestId: request.id, kind: { not: "ZIP" } },
  });
  const artifacts = [];
  for (const job of jobs) {
    // Tiny synthetic opaque bytes are sufficient to reproduce ZIP completeness;
    // the separate ZIP test uses actual DOCX/PDF/XLSX bytes from the renderer.
    const blob = await store.put(
      Buffer.from(`Synthetic archive file ${job.kind}`),
      job.kind.toLowerCase(),
    );
    const artifact = await db.artifact.create({
      data: {
        ...blob,
        tenantId: who.tenantId,
        requestId: request.id,
        issuanceId: job.issuanceId,
        documentId: job.documentId,
        jobId: job.id,
        format: job.kind,
        mimeType: "application/octet-stream",
        fileName: `synthetic.${job.kind.toLowerCase()}`,
        rendererVersion: RENDERER_VERSION,
        inputHash: "synthetic-mutation",
      },
    });
    await db.generationJob.update({
      where: { id: job.id },
      data: { status: "SUCCEEDED", artifactId: artifact.id },
    });
    artifacts.push(artifact);
  }
  await unlink(store.path(artifacts[0].storageKey));
  const oldBundle = await buildZip(artifacts, jobs[0].issuanceId!, jobs.length);
  const previousDecision =
    artifacts.length < jobs.length ? "DEMO-PARTIAL.zip" : "DEMO-complete.zip";
  assert.equal(previousDecision, "DEMO-complete.zip");
  assert.equal(oldBundle.metadata.complete, false);
  await assert.rejects(
    registryExport(context, { format: "ZIP" }, request.id),
    (error: any) => error.getStatus() === 409,
  );
  const repaired = await registryExport(
    context,
    { format: "ZIP", allowPartial: true },
    request.id,
  );
  assert.equal(repaired.fileName, "DEMO-PARTIAL.zip");
  const result = {
    mutation:
      "test-only reconstruction of prior guard and row-count naming decisions",
    viewerPassword: { before: statuses[0], after: statuses[1] },
    missingOriginalZip: {
      databaseArtifacts: artifacts.length,
      expected: jobs.length,
      beforeFileName: previousDecision,
      beforeManifestComplete: oldBundle.metadata.complete,
      afterWithoutConsent: 409,
      afterWithConsentFileName: repaired.fileName,
    },
    status: "PASS",
  };
  await writeFile(
    join(
      PRODUCT_ROOT,
      "docs/evidence/commercial-acceptance/security/known-defects-before-after.json",
    ),
    JSON.stringify(json(result), null, 2),
  );
  console.log(JSON.stringify(result));
}
void main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
