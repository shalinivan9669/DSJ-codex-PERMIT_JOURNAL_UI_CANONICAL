import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { db } from "../../apps/api/src/core";
import { bootstrap } from "../../apps/api/src/main";
import { store } from "../../apps/api/src/files";
import { lmsSession } from "../../tests/integration/lms-fixture";

async function main() {
  const database = new URL(process.env.DATABASE_URL!);
  assert.equal(database.hostname, "127.0.0.1");
  assert.equal(database.port, "55479");
  assert.equal(database.pathname, "/demo_test_lms_pass01_governance");
  assert.equal(process.env.DEMO_LMS_TEST_RUNTIME, "1");
  const fixture = JSON.parse(
    await readFile(resolve(process.env.DEMO_LMS_SCALING_FIXTURE!), "utf8"),
  );
  const artifacts = await db.artifact.findMany({
    where: { tenantId: fixture.tenantId, requestId: fixture.ordinaryRequestId },
    orderBy: [{ format: "asc" }, { fileName: "asc" }],
  });
  assert.equal(artifacts.length, 6);
  const jobs = await db.generationJob.findMany({
    where: { tenantId: fixture.tenantId, requestId: fixture.ordinaryRequestId },
    select: { id: true, status: true, attempts: true, errorCode: true },
  });
  assert.equal(jobs.length, 6);
  assert.ok(jobs.every((job) => job.status === "SUCCEEDED"));
  process.env.PORT = "0";
  const app = await bootstrap();
  try {
    const base = await app.getUrl();
    const headers = await lmsSession(base, fixture.director.email);
    const signingResponse = await fetch(
      `${base}/print-requests/${fixture.ordinaryRequestId}/signing`,
      { headers },
    );
    assert.equal(signingResponse.status, 200);
    const signing = (await signingResponse.json()) as { status: string };
    assert.equal(signing.status, "AWAITING_SIGNATURE");
    const workflow = await db.issuanceWorkflow.findFirstOrThrow({
      where: {
        tenantId: fixture.tenantId,
        issuanceId: fixture.ordinaryPrint.issuanceId,
      },
      select: { id: true, status: true },
    });
    const readbacks = [];
    for (const artifact of artifacts) {
      const stored = await store.read(artifact.storageKey, artifact.sha256);
      assert.equal(stored.length, artifact.size);
      assert.equal(
        createHash("sha256").update(stored).digest("hex"),
        artifact.sha256,
      );
      const magic = artifact.format === "PDF" ? "%PDF-" : "PK";
      assert.equal(stored.subarray(0, magic.length).toString("ascii"), magic);
      const response = await fetch(`${base}/artifacts/${artifact.id}`, {
        headers,
      });
      const gated =
        ["XLSX", "ZIP"].includes(artifact.format) &&
        workflow &&
        workflow.status !== "ISSUED";
      let downloadError: string | null = null;
      if (gated) {
        assert.equal(response.status, 409);
        downloadError = ((await response.json()) as { code: string }).code;
        assert.equal(downloadError, "ISSUANCE_NOT_COMPLETE");
        assert.equal(response.headers.get("x-content-sha256"), null);
      } else {
        assert.equal(response.status, 200);
        const bytes = Buffer.from(await response.arrayBuffer());
        assert.deepEqual(bytes, stored);
        assert.equal(response.headers.get("x-content-sha256"), artifact.sha256);
        assert.equal(
          Number(response.headers.get("content-length")),
          artifact.size,
        );
        assert.equal(response.headers.get("content-type"), artifact.mimeType);
      }
      readbacks.push({
        id: artifact.id,
        format: artifact.format,
        fileName: artifact.fileName,
        storagePath: store.path(artifact.storageKey),
        sha256: artifact.sha256,
        size: artifact.size,
        header: magic,
        storedIntegrity: "PASS",
        authenticatedHttpStatus: response.status,
        httpBytesEqualStored: gated ? null : true,
        expectedGate: downloadError,
      });
    }
    const evidence = {
      status: "PASS",
      scenario: "AC32 ordinary PASSED/AUTO document queue regression",
      database: database.pathname.slice(1),
      fixturePath: resolve(process.env.DEMO_LMS_SCALING_FIXTURE!),
      requestId: fixture.ordinaryRequestId,
      issuanceId: fixture.ordinaryPrint.issuanceId,
      outcome: fixture.ordinaryPrint.outcome,
      outcomeOrigin: fixture.ordinaryPrint.outcomeOrigin,
      workflow,
      applicationHttp:
        "Real local Nest app on ephemeral loopback port; authenticated director session",
      rendering:
        "Actual shipping claimJob/executeJob queue with local Python/LibreOffice; no PDF fixture substitution",
      jobs,
      artifacts: readbacks,
      limits: [
        "Synthetic local application data only",
        "Header and integrity checks do not prove visual layout or physical print",
        "Unsigned ordinary workflow is preserved: XLSX/ZIP HTTP409 is a verified gate, not a successful full bundle download",
        "No external service or production access",
      ],
    };
    const output = resolve(
      "docs/evidence/lms-full-tz-pass-01-20261018/AGENT_A_ORDINARY_PRINT.json",
    );
    await writeFile(output, JSON.stringify(evidence, null, 2) + "\n");
    console.log(
      JSON.stringify({
        status: "PASS",
        jobs: jobs.length,
        artifacts: readbacks.length,
        evidence: output,
      }),
    );
  } finally {
    await app.close();
  }
}
main().finally(() => db.$disconnect());
