import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { db, type Context } from "../../apps/api/src/core";
import { bootstrap } from "../../apps/api/src/main";
import { lmsSession } from "../../tests/integration/lms-fixture";
import {
  prepareDocumentBundle,
  documentBundleStatus,
} from "../../apps/api/src/lms/document-bundles";
import {
  changeResult,
  prepareResultDocuments,
  advanceLmsDocuments,
  documentView,
} from "../../apps/api/src/lms/document-bridge";
import { queryReport } from "../../apps/api/src/lms/report-query";
import { applicationOrderSummary } from "../../apps/api/src/lms/application-workflow";
import { approve, renderAll } from "./lms-pass02-chain";

async function main() {
  const url = new URL(process.env.DATABASE_URL!);
  assert.equal(url.hostname, "127.0.0.1");
  assert.equal(url.port, "55479");
  assert.equal(url.pathname, "/demo_test_lms_pass02_restored");
  assert.equal(process.env.DEMO_LMS_TEST_RUNTIME, "1");
  const f = JSON.parse(
    await readFile(
      resolve(".runtime/lms-pass02-operations-20261018/chain-fixture.json"),
      "utf8",
    ),
  );
  const c: Context = {
    tenantId: f.tenantId,
    userId: f.director.userId,
    role: "DIRECTOR",
    sessionId: "invalidation-harness",
    csrfHash: "",
    correlationId: randomUUID(),
  };
  const learner = { ...c, userId: f.learner.userId, role: "LEARNER" };
  assert.equal(
    await db.lmsResultEvent.count({ where: { resultId: f.resultId } }),
    0,
    "Use the unmodified restored chain",
  );
  const originalBundle = await prepareDocumentBundle(learner, {
    documentIds: [f.documentId],
    format: "PDF",
  });
  await renderAll(c.tenantId);
  assert.equal(
    (await documentBundleStatus(learner, originalBundle.id)).status,
    "READY",
  );
  const originalFiles = await db.artifact.findMany({
    where: { requestId: f.documentRequestId, format: { in: ["PDF", "DOCX"] } },
  });
  const before = await queryReport(learner, {
    kind: "DOCUMENTS",
    filters: { courseVersionId: f.courseVersionId },
  });
  process.env.PORT = "0";
  const app = await bootstrap();
  const checks: object[] = [];
  try {
    const base = await app.getUrl(),
      headers = await lmsSession(base, f.learner.email);
    const bundleURL = `${base}/learn/documents/bundles/${originalBundle.id}/parts/0`;
    const allowed = await fetch(bundleURL, { headers });
    assert.equal(allowed.status, 200);
    const bytes = Buffer.from(await allowed.arrayBuffer());
    assert.equal(bytes.subarray(0, 2).toString(), "PK");
    checks.push({
      scenario: "original allowed bundle",
      status: 200,
      size: bytes.length,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    });
    const revised = await changeResult(
      c,
      f.resultId,
      {
        reason:
          "SYNTHETIC AC33 explicit replacement with immutable new revision",
      },
      true,
    );
    assert.ok(revised.replacementResultId);
    assert.equal(
      (await documentView(learner, f.documentId)).status,
      "SUPERSEDED",
    );
    for (const a of originalFiles) {
      const r = await fetch(`${base}/learn/artifacts/${a.id}`, { headers });
      assert.equal(r.status, 409);
      checks.push({
        scenario: "superseded original",
        artifactId: a.id,
        status: r.status,
      });
    }
    assert.equal((await fetch(bundleURL, { headers })).status, 409);
    checks.push({
      scenario: "previously allowed bundle after replacement",
      status: 409,
    });
    const prepared = await prepareResultDocuments(c, {
      resultIds: [revised.replacementResultId!],
    });
    assert.deepEqual(prepared.errors, []);
    const link = prepared.items[0];
    await approve(c, link.requestId);
    await advanceLmsDocuments();
    await renderAll(c.tenantId);
    await advanceLmsDocuments();
    assert.equal((await documentView(learner, link.id)).status, "ISSUED");
    const replacementBundle = await prepareDocumentBundle(learner, {
      documentIds: [link.id],
      format: "PDF",
    });
    await renderAll(c.tenantId);
    const replacementURL = `${base}/learn/documents/bundles/${replacementBundle.id}/parts/0`;
    assert.equal((await fetch(replacementURL, { headers })).status, 200);
    const replacementFiles = await db.artifact.findMany({
      where: { requestId: link.requestId, format: { in: ["PDF", "DOCX"] } },
    });
    await changeResult(
      c,
      revised.replacementResultId!,
      {
        reason:
          "SYNTHETIC AC33 explicit cancellation, no original-file mutation",
      },
      false,
    );
    assert.equal((await documentView(learner, link.id)).status, "VOIDED");
    for (const a of replacementFiles) {
      const r = await fetch(`${base}/learn/artifacts/${a.id}`, { headers });
      assert.equal(r.status, 409);
      checks.push({
        scenario: "voided original",
        artifactId: a.id,
        status: r.status,
      });
    }
    assert.equal((await fetch(replacementURL, { headers })).status, 409);
    checks.push({
      scenario: "previously allowed bundle after cancellation",
      status: 409,
    });
    const after = await queryReport(learner, {
      kind: "DOCUMENTS",
      filters: { courseVersionId: f.courseVersionId },
    });
    assert.equal(after.summary.completedAssignments, 1);
    assert.equal(after.summary.activeAssignments, 0);
    assert.equal(after.summary.issuedDocuments, 2);
    assert.equal(after.summary.supersededDocuments, 1);
    assert.equal(after.summary.voidedDocuments, 1);
    assert.equal(after.summary.validDocuments, 0);
    const order = await applicationOrderSummary(c, f.applicationId);
    assert.equal(order.completed, 1);
    assert.equal(order.documentsReady, 0);
    await writeFile(
      resolve(
        "docs/evidence/lms-full-tz-pass-02-operations-20261018/CHAIN_INVALIDATION_AC33.json",
      ),
      JSON.stringify(
        {
          status: "PASS",
          originalResultId: f.resultId,
          replacementResultId: revised.replacementResultId,
          before: before.summary,
          after: after.summary,
          order,
          checks,
          limits: [
            "Restored synthetic copy only",
            "Completion remains historical; current document readiness becomes zero",
            "Previously saved originals are retained for audit; nonstaff access and saved bundle access are rechecked",
            "No real signatures or production credentials",
          ],
        },
        null,
        2,
      ),
    );
    console.log(JSON.stringify({ status: "PASS", checks: checks.length }));
  } finally {
    await app.close();
  }
}
main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
