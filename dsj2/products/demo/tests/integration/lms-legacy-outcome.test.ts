import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { bootstrap } from "../../apps/api/src/main";
import { db } from "../../apps/api/src/core";
import { lmsHttp, lmsJson, lmsSession, lmsTenant } from "./lms-fixture";

test("E12: ordinary PASSED/AUTO assignment cannot become an eligible LMS result or create a document link", async () => {
  process.env.PORT = "0";
  process.env.DEMO_ORIGIN = "http://localhost:3159";
  const app = await bootstrap();
  const tenant = await lmsTenant("legacy AUTO is not exam evidence");
  const rowId = randomUUID();
  const assignmentId = randomUUID();
  try {
    const director = lmsHttp(
      await app.getUrl(),
      await lmsSession(await app.getUrl(), tenant.user.email),
    );
    const request = await lmsJson(
      await director("/print-requests", "POST", {
        kind: "PERSON",
        schemaVersion: 2,
        title: "Synthetic ordinary AUTO outcome",
        items: [
          {
            id: rowId,
            fullNameRu: "Синтетический обычный получатель",
            assignments: [
              {
                id: assignmentId,
                templateId: "pb-card",
                outcome: { status: "PASSED", source: "AUTO" },
                fieldOrigins: { outcome: "AUTO" },
              },
            ],
          },
        ],
      }),
      201,
    );
    const before = await lmsJson(
      await director(`/print-requests/${request.id}`),
    );
    const initialAssignment = before.draft.items[0].assignments[0];
    assert.equal(initialAssignment.outcome.status, "PASSED");
    assert.equal(initialAssignment.outcome.source, "AUTO");
    assert.equal(initialAssignment.fieldOrigins.outcome, "AUTO");
    const rejected = await lmsJson(
      await director("/lms/results/documents", "POST", {
        resultIds: [request.id, assignmentId],
      }),
      201,
    );
    assert.equal(rejected.items.length, 0);
    assert.equal(rejected.errors.length, 2);
    assert.deepEqual(
      new Set(
        rejected.errors.map((item: { resultId: string }) => item.resultId),
      ),
      new Set([request.id, assignmentId]),
    );
    const after = await lmsJson(
      await director(`/print-requests/${request.id}`),
    );
    assert.deepEqual(after.draft.items[0].assignments[0], initialAssignment);
    assert.equal(after.revision, before.revision);
    const where = { tenantId: tenant.tenant.id };
    const counts = {
      results: await db.verifiedExamResult.count({ where }),
      outbox: await db.regulatoryOutbox.count({ where }),
      documentLinks: await db.lmsDocumentLink.count({ where }),
      jobs: await db.generationJob.count({ where }),
      documents: await db.issuedDocument.count({ where }),
      numbers: await db.numberReservation.count({ where }),
    };
    assert.deepEqual(counts, {
      results: 0,
      outbox: 0,
      documentLinks: 0,
      jobs: 0,
      documents: 0,
      numbers: 0,
    });
    const folder = resolve("docs/evidence/lms-one-run-20261015/agent-c");
    await mkdir(folder, { recursive: true });
    await writeFile(
      resolve(folder, "LEGACY_AUTO_BOUNDARY_ACCEPTANCE.json"),
      JSON.stringify(
        {
          status: "PASS",
          checkedAt: new Date().toISOString(),
          actualHttp: true,
          ordinaryOutcomePreserved: "PASSED/AUTO",
          ordinaryRevisionUnchanged: true,
          legacyIdsRejectedAsResults: 2,
          ...counts,
          scope:
            "Synthetic ordinary request created through the actual API; no renderer or ordinary print issuance requested by this negative boundary test.",
        },
        null,
        2,
      ),
    );
  } finally {
    await app.close();
    await db.$disconnect();
  }
});
