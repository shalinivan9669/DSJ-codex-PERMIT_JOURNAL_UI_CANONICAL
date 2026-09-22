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

test("ZIP validates actual original bytes, requires partial consent and names every missing/failed file", async () => {
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
  try {
    const request = await createRequest(c, {
      kind: "PERSON",
      items: [
        {
          id: randomUUID(),
          fullNameRu: "Синтетический Проверяемый Архив",
          fullNameKz: "Ә Ғ Қ Ң Ө Ұ Ү Һ І",
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
    await finalize(c, request.id, { expectedRevision: 0 }, randomUUID());
    for (let index = 0; index < 4; index++) {
      const job = await claimJob(db, "zip-acceptance", c.tenantId);
      assert.ok(job);
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
    const original = await registryExport(c, { format: "ZIP" }, request.id);
    assert.equal(original.fileName, "DEMO-complete.zip");
    const complete = inspectZip(original.buffer);
    assert.equal(complete.manifest.complete, true);
    assert.equal(complete.manifest.expectedCount, 3);
    for (const file of complete.manifest.files) {
      const downloaded = await readArtifact(c, file.id);
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
      /неполный/,
    );
    const failed = await registryExport(
      c,
      { format: "ZIP", allowPartial: true },
      request.id,
    );
    assert.equal(failed.fileName, "DEMO-PARTIAL.zip");
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
      /недоступны/,
    );
    const missing = await registryExport(
      c,
      { format: "ZIP", allowPartial: true },
      request.id,
    );
    assert.equal(missing.fileName, "DEMO-PARTIAL.zip");
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
    const corrupted = await registryExport(
      c,
      { format: "ZIP", allowPartial: true },
      request.id,
    );
    assert.equal(corrupted.fileName, "DEMO-PARTIAL.zip");
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
