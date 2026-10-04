import test from "node:test";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { unlink, writeFile } from "node:fs/promises";
import { db, type Context } from "../../apps/api/src/core";
import { store, registryExport, readArtifact } from "../../apps/api/src/files";
import { createRequest, finalize } from "../../apps/api/src/requests";
import {
  claimJob,
  executeJob,
  heartbeat,
} from "../../apps/render-worker/src/queue";
import { provision } from "../../scripts/setup";
import { assertTestDatabase } from "./test-database";
import { createApprovalFixture } from "./live-approval-fixture";
import { buildZip } from "@demo/printing";

function inspectZip(bytes: Buffer) {
  return JSON.parse(
    execFileSync(
      process.env.DEMO_PYTHON || "python",
      [
        "-I",
        "-c",
        "import sys,io,zipfile,json,hashlib; z=zipfile.ZipFile(io.BytesIO(sys.stdin.buffer.read())); m=json.loads(z.read('manifest.json')); print(json.dumps({'manifest':m,'hashes':{n:hashlib.sha256(z.read(n)).hexdigest() for n in z.namelist()}}))",
      ],
      { input: bytes, windowsHide: true, encoding: "utf8" },
    ),
  ) as {
    manifest: {
      complete: boolean;
      expectedCount: number;
      files: Array<{ id: string; file: string; sha256: string }>;
      missing: Array<{ id?: string; jobId?: string; reason: string }>;
    };
    hashes: Record<string, string>;
  };
}

test("ZIP manifests validate actual original bytes and every missing/failed file; unsigned public export remains blocked", async (t) => {
  assertTestDatabase();
  const who = await provision({
    email: `zip-${randomUUID()}@example.test`,
    password: "Synthetic-ZIP-Password!",
    name: "Synthetic ZIP centre",
    sample: true,
  });
  const c: Context = {
    ...who,
    role: "ADMIN",
    sessionId: "fixture",
    csrfHash: "fixture",
    correlationId: randomUUID(),
  };
  const approvals = await createApprovalFixture(c);
  t.after(() => approvals.close());
  try {
    const request = await createRequest(c, {
      kind: "PERSON",
      items: [
        {
          id: randomUUID(),
          fullNameRu: "Синтетический Проверяемый Архив",
          fullNameKz: "Ә Ғ Қ Ң Ө Ұ Ү Һ І",
          positionRu: "Инженер",
          workplaceRu: "Синтетическое предприятие",
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
    await approvals.approve(request.id);
    await finalize(
      c,
      request.id,
      { expectedRevision: request.revision },
      randomUUID(),
    );
    for (let index = 0; index < 20; index++) {
      const job = await claimJob(db, "zip-acceptance", c.tenantId);
      if (!job) break;
      const controller = new AbortController();
      const pulse = setInterval(() => {
        void heartbeat(db, job, "zip-acceptance")
          .then((owned) => {
            if (!owned) controller.abort();
          })
          .catch(() => controller.abort());
      }, 5000);
      try {
        await executeJob(db, store, job, "zip-acceptance", controller.signal);
      } finally {
        clearInterval(pulse);
      }
    }
    // The renderer/manifest boundary is verified without manufacturing a CMS
    // signature or changing workflow status. The public endpoint must continue
    // denying an unsigned official bundle, including explicit partial consent.
    for (const allowPartial of [false, true])
      await assert.rejects(
        registryExport(c, { format: "ZIP", allowPartial }, request.id),
        (error: any) => error.getResponse().code === "ISSUANCE_NOT_COMPLETE",
      );
    async function assembled() {
      const jobs = await db.generationJob.findMany({
        where: {
          tenantId: c.tenantId,
          requestId: request.id,
          kind: { not: "ZIP" },
        },
      });
      const artifacts = await db.artifact.findMany({
        where: {
          tenantId: c.tenantId,
          requestId: request.id,
          id: {
            in: jobs.flatMap((job) =>
              job.status === "SUCCEEDED" && job.artifactId
                ? [job.artifactId]
                : [],
            ),
          },
        },
      });
      return buildZip(
        artifacts,
        jobs[0].issuanceId!,
        jobs.length,
        jobs
          .filter(
            (job) =>
              !artifacts.some((artifact) => artifact.id === job.artifactId),
          )
          .map((job) => ({
            jobId: job.id,
            documentId: job.documentId,
            format: job.kind,
            reason: job.errorCode || job.status,
          })),
      );
    }
    const original = await assembled();
    const complete = inspectZip(original.buffer);
    assert.equal(complete.manifest.complete, true);
    assert.equal(
      complete.manifest.expectedCount,
      5,
      "LIVE mandatory credential + protocol each have DOCX/PDF, plus registry",
    );
    for (const file of complete.manifest.files) {
      const artifact = await db.artifact.findUniqueOrThrow({
        where: { id: file.id },
      });
      const downloaded =
        artifact.format === "XLSX"
          ? { buffer: await store.read(artifact.storageKey, artifact.sha256) }
          : await readArtifact(c, file.id);
      assert.equal(
        createHash("sha256").update(downloaded.buffer).digest("hex"),
        file.sha256,
      );
      assert.equal(complete.hashes[file.file], file.sha256);
    }
    const jobs = await db.generationJob.findMany({
      where: { tenantId: c.tenantId, requestId: request.id },
    });
    const pdf = jobs.find((job) => job.kind === "PDF")!;
    await db.generationJob.update({
      where: { id: pdf.id },
      data: { status: "FAILED", errorCode: "CONVERTER_INTERRUPTED" },
    });
    await assert.rejects(
      registryExport(c, { format: "ZIP" }, request.id),
      /обязательных подписей/,
    );
    const failed = await assembled();
    assert.equal(inspectZip(failed.buffer).manifest.complete, false);
    assert.deepEqual(
      inspectZip(failed.buffer).manifest.missing.map(({ jobId, reason }) => ({
        jobId,
        reason,
      })),
      [{ jobId: pdf.id, reason: "CONVERTER_INTERRUPTED" }],
    );
    await db.generationJob.update({
      where: { id: pdf.id },
      data: { status: "SUCCEEDED", errorCode: null },
    });
    const pdfArtifact = await db.artifact.findUniqueOrThrow({
      where: { id: pdf.artifactId! },
    });
    // Only delete a generated synthetic original in this explicitly isolated test store.
    await unlink(store.path(pdfArtifact.storageKey));
    await assert.rejects(
      registryExport(c, { format: "ZIP" }, request.id),
      /обязательных подписей/,
    );
    const missing = await assembled();
    assert.equal(inspectZip(missing.buffer).manifest.complete, false);
    assert.ok(
      inspectZip(missing.buffer).manifest.missing.some(
        (entry) =>
          entry.id === pdfArtifact.id && entry.reason === "FILE_MISSING",
      ),
    );
    const docx = await db.artifact.findUniqueOrThrow({
      where: { id: jobs.find((job) => job.kind === "DOCX")!.artifactId! },
    });
    await writeFile(store.path(docx.storageKey), "synthetic corruption drill");
    const corrupted = await assembled();
    assert.equal(inspectZip(corrupted.buffer).manifest.complete, false);
    assert.ok(
      inspectZip(corrupted.buffer).manifest.missing.some(
        (entry) => entry.id === docx.id && entry.reason === "HASH_MISMATCH",
      ),
    );
    assert.equal(
      await db.issuance.count({ where: { requestId: request.id } }),
      1,
    );
  } finally {
    await db.$disconnect();
  }
});
