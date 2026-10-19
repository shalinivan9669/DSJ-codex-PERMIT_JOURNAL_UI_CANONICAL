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
  const result = await db.verifiedExamResult.findUniqueOrThrow({
    where: { id: fixture.resultId },
  });
  assert.equal(result.tenantId, fixture.tenantId);
  assert.equal(result.eligible, true);
  assert.equal(result.verdict, "PASSED");
  assert.equal(result.assessmentKind, "CENTER_EXAM");
  const links = await db.lmsDocumentLink.findMany({
    where: { tenantId: fixture.tenantId, resultId: result.id },
  });
  assert.equal(links.length, 1);
  assert.equal(links[0].requestId, fixture.documentRequestId);
  const artifacts = await db.artifact.findMany({
    where: {
      tenantId: fixture.tenantId,
      requestId: fixture.documentRequestId,
      format: { in: ["PDF", "DOCX"] },
    },
    orderBy: { format: "asc" },
  });
  assert.equal(artifacts.length, 2);
  const jobs = await db.generationJob.findMany({
    where: { tenantId: fixture.tenantId, requestId: fixture.documentRequestId },
    select: { id: true, status: true, attempts: true, errorCode: true },
  });
  assert.ok(
    jobs.length >= 2 && jobs.every((job) => job.status === "SUCCEEDED"),
  );
  const outbox = await db.regulatoryOutbox.findMany({
    where: { tenantId: fixture.tenantId, resultId: result.id },
    select: { id: true, status: true, kind: true },
  });
  assert.equal(
    outbox.length,
    0,
    "This existing fixture is non-sanitary, not an outbox consumption proof",
  );
  process.env.PORT = "0";
  const app = await bootstrap();
  try {
    const base = await app.getUrl();
    const staff = await lmsSession(base, fixture.director.email);
    const learner = await lmsSession(base, fixture.people[0].email);
    const signingResponse = await fetch(
      `${base}/print-requests/${fixture.documentRequestId}/signing`,
      { headers: staff },
    );
    assert.equal(signingResponse.status, 200);
    const signing = (await signingResponse.json()) as {
      status: string;
      documents: { requiredSigners: string[] }[];
      signatures: unknown[];
    };
    assert.equal(signing.status, "ISSUED");
    assert.ok(signing.documents.length > 0);
    assert.ok(
      signing.documents.every(
        (document) => document.requiredSigners.length === 0,
      ),
    );
    assert.equal(signing.signatures.length, 0);
    const workflow = await db.issuanceWorkflow.findFirstOrThrow({
      where: { tenantId: fixture.tenantId, issuanceId: links[0].issuanceId! },
      select: { id: true, status: true, completedAt: true },
    });
    assert.equal(workflow.status, "ISSUED");
    const documentResponse = await fetch(
      `${base}/learn/documents/${links[0].id}`,
      {
        headers: learner,
      },
    );
    assert.equal(documentResponse.status, 200);
    assert.equal(
      ((await documentResponse.json()) as { status: string }).status,
      "ISSUED",
    );
    const readbacks = [];
    for (const artifact of artifacts) {
      const stored = await store.read(artifact.storageKey, artifact.sha256);
      const magic = artifact.format === "PDF" ? "%PDF-" : "PK";
      assert.equal(stored.length, artifact.size);
      assert.equal(
        createHash("sha256").update(stored).digest("hex"),
        artifact.sha256,
      );
      assert.equal(stored.subarray(0, magic.length).toString("ascii"), magic);
      const response = await fetch(`${base}/learn/artifacts/${artifact.id}`, {
        headers: learner,
      });
      assert.equal(response.status, 200);
      assert.deepEqual(Buffer.from(await response.arrayBuffer()), stored);
      assert.equal(response.headers.get("content-type"), artifact.mimeType);
      assert.equal(
        Number(response.headers.get("content-length")),
        artifact.size,
      );
      readbacks.push({
        id: artifact.id,
        format: artifact.format,
        fileName: artifact.fileName,
        storagePath: store.path(artifact.storageKey),
        sha256: artifact.sha256,
        size: artifact.size,
        header: magic,
        storedIntegrity: "PASS",
        learnerHttpStatus: 200,
        httpBytesEqualStored: true,
      });
    }
    const output = resolve(
      "docs/evidence/lms-full-tz-pass-01-20261018/AGENT_A_LMS_RENDER.json",
    );
    await writeFile(
      output,
      JSON.stringify(
        {
          status: "PASS",
          scenario:
            "Eligible CENTER_EXAM result through explicit prepare, director approval and actual local rendering queue",
          database: database.pathname.slice(1),
          fixturePath: resolve(process.env.DEMO_LMS_SCALING_FIXTURE!),
          result: {
            id: result.id,
            eligible: result.eligible,
            verdict: result.verdict,
            snapshotHash: result.snapshotHash,
          },
          requestId: fixture.documentRequestId,
          issuanceId: links[0].issuanceId,
          workflow,
          requiredSigners: [],
          signaturesCreated: 0,
          jobs,
          artifacts: readbacks,
          outbox,
          limits: [
            "Synthetic local profile and qualification only; no external signatures or services",
            "ISSUED is the application's natural state for this template with zero required signers; no gate bypass",
            "This non-sanitary automatic-choice fixture does not prove regulatory outbox consumption or a combined manual/practice render chain",
            "Manual finalization and accepted-practice outbox receipts are separately proven in integration tests",
            "No visual layout or physical print claim",
          ],
        },
        null,
        2,
      ) + "\n",
    );
    console.log(
      JSON.stringify({
        status: "PASS",
        artifacts: readbacks.length,
        workflow: workflow.status,
        evidence: output,
      }),
    );
  } finally {
    await app.close();
  }
}

main().finally(() => db.$disconnect());
