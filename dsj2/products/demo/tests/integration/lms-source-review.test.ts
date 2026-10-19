import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { db } from "../../apps/api/src/core";
import { bootstrap } from "../../apps/api/src/main";
import { createCourse, publishVersion } from "../../apps/api/src/lms/courses";
import { assignEnrollments } from "../../apps/api/src/lms/enrollments";
import { enrollmentDetail } from "../../apps/api/src/lms/learning";
import { listEnrollmentPage } from "../../apps/api/src/lms/enrollment-list";
import { reviewExternalEvidence } from "../../apps/api/src/lms/external";
import { documentMetadata } from "../../apps/api/src/lms/document-metadata";
import { lmsStore } from "../../apps/api/src/lms/materials";
import { prepareClaimedEvent } from "../../apps/api/src/regulatory-results/preparation";
import {
  lmsCourse,
  lmsTenant,
  lmsLearner,
  lmsSession,
  lmsHttp,
  lmsJson,
} from "./lms-fixture";
import { syntheticPdf } from "../fixtures/pdf";

test("S03/S09: unknown external exam date stays null, prepares internal review list, and protected manual file proves only operator attestation", async (t) => {
  process.env.DEMO_LMS_TEST_RUNTIME = "1";
  const center = await lmsTenant("external missing date");
  const foreign = await lmsTenant("manual file foreign");
  const learner = await lmsLearner(center.tenant.id, "unknown external date");
  const definition = lmsCourse({
    sanitary: true,
    kind: "EXTERNAL_AUTHORIZED",
    required: false,
  });
  definition.profile.externalEvidenceLevel = "DOCUMENT_REVIEWED";
  const course = await createCourse(center.context, definition);
  await publishVersion(center.context, course.version.id, { revision: 0 });
  const enrollment = (
    await assignEnrollments(center.context, {
      courseVersionId: course.version.id,
      recipientIds: [learner.recipient.id],
    })
  ).items[0];
  const stored = await lmsStore.put(
    syntheticPdf("Synthetic external source with no known exam date"),
    "pdf",
  );
  const evidence = await db.lmsExternalEvidence.create({
    data: {
      tenantId: center.tenant.id,
      enrollmentId: enrollment.id,
      issuer: definition.profile.issuer,
      sourceSystem: "SYNTHETIC SOURCE",
      documentNumber: "SYNTHETIC-UNKNOWN-DATE",
      documentDate: "2026-10-15",
      examAt: null,
      storageKey: stored.storageKey,
      sha256: stored.sha256,
      mimeType: "application/pdf",
      originalName: "synthetic-external.pdf",
      createdBy: center.user.id,
    },
  });
  let deliveryId = "";
  try {
    await t.test(
      "verified source prepares immediately without inventing exam date, score or attempt; documents remain gated",
      async () => {
        await reviewExternalEvidence(center.context, evidence.id, {
          status: "DOCUMENT_REVIEWED",
          reviewMethod: "Synthetic source checked; exam date absent",
          verdict: "PASSED",
        });
        const result = await db.verifiedExamResult.findFirstOrThrow({
          where: {
            tenantId: center.tenant.id,
            externalEvidenceId: evidence.id,
          },
        });
        assert.equal(result.eligible, true);
        assert.equal(result.examAt, null);
        assert.equal(result.attemptId, null);
        assert.equal(result.score, null);
        assert.deepEqual(
          (result.snapshot as { reviewReasons: string[] }).reviewReasons,
          ["EXAM_DATE_UNKNOWN"],
        );
        assert.equal(
          (result.snapshot as { documentEligible: boolean }).documentEligible,
          false,
        );
        assert.throws(
          () => documentMetadata(result),
          (error: unknown) =>
            (error as { getStatus(): number }).getStatus() === 409,
        );
        const detail = await enrollmentDetail(learner.context, enrollment.id);
        assert.equal(detail.results[0].state, "NEEDS_REVIEW");
        assert.equal(detail.results[0].documentEligible, false);
        assert.equal(
          (await listEnrollmentPage(center.context, { view: "NEEDS_REVIEW" }))
            .total,
          1,
        );
        assert.equal(
          (
            await listEnrollmentPage(center.context, {
              view: "WAITING_DOCUMENTS",
            })
          ).total,
          0,
        );
        const event = await db.regulatoryOutbox.findFirstOrThrow({
          where: { tenantId: center.tenant.id, resultId: result.id },
        });
        await db.regulatoryOutbox.update({
          where: { id: event.id },
          data: {
            status: "PROCESSING",
            leaseToken: 1,
            lockedUntil: new Date(Date.now() + 30000),
          },
        });
        const prepared = await prepareClaimedEvent(event.id, 1);
        const batch = await db.regulatoryBatch.findUniqueOrThrow({
          where: { id: prepared.batchId! },
        });
        assert.equal(batch.state, "NEEDS_REVIEW");
        assert.equal(batch.dueAt, null);
        assert.equal(batch.dueDate, null);
        const item = await db.regulatoryBatchItem.findFirstOrThrow({
          where: { tenantId: center.tenant.id, resultId: result.id },
        });
        assert.equal((item.snapshot as { examAt: string | null }).examAt, null);
        const delivery = await db.integrationDelivery.findFirstOrThrow({
          where: { tenantId: center.tenant.id, resultId: result.id },
        });
        deliveryId = delivery.id;
        assert.equal(delivery.lmkState, "NOT_CONFIRMED");
      },
    );
    await t.test(
      "manual PDF upload/download preserves SHA, tenant scope and original delivery/LMK states",
      async () => {
        process.env.PORT = "0";
        process.env.HOST = "127.0.0.1";
        process.env.DEMO_ORIGIN = "http://127.0.0.1:31994";
        const app = await bootstrap();
        try {
          const base = await app.getUrl();
          const staff = await lmsSession(base, center.user.email);
          const other = await lmsSession(base, foreign.user.email);
          const student = await lmsSession(base, learner.user.email);
          const original = syntheticPdf(
            "Synthetic operator attestation, no machine receipt",
          );
          const before = await db.integrationDelivery.findUniqueOrThrow({
            where: { id: deliveryId },
          });
          const form = () => {
            const value = new FormData();
            value.set("source", "SYNTHETIC OPERATOR SOURCE");
            value.set("reference", "SYNTHETIC-ATTESTED-1");
            value.set(
              "file",
              new Blob([Buffer.from(original)], { type: "application/pdf" }),
              "synthetic-confirmation.pdf",
            );
            return value;
          };
          const uploaded = await lmsJson(
            await fetch(
              `${base}/lms/sanitary/deliveries/${deliveryId}/evidence`,
              { method: "POST", headers: staff, body: form() },
            ),
            201,
          );
          assert.equal(uploaded.category, "OPERATOR_ATTESTED");
          assert.equal(uploaded.storageKey, undefined);
          const row = await db.regulatoryManualEvidence.findUniqueOrThrow({
            where: { id: uploaded.id },
          });
          assert.equal(
            row.sha256,
            createHash("sha256").update(original).digest("hex"),
          );
          const route = `/lms/sanitary/evidence/${uploaded.id}/file`;
          const downloaded = await lmsHttp(base, staff)(route);
          assert.equal(downloaded.status, 200);
          assert.match(downloaded.headers.get("cache-control")!, /private/);
          assert.match(
            downloaded.headers.get("content-disposition")!,
            /attachment/,
          );
          assert.deepEqual(
            Buffer.from(await downloaded.arrayBuffer()),
            original,
          );
          await lmsJson(await lmsHttp(base, other)(route), 404);
          await lmsJson(await lmsHttp(base, student)(route), 403);
          await lmsJson(
            await fetch(
              `${base}/lms/sanitary/deliveries/${deliveryId}/evidence`,
              { method: "POST", headers: other, body: form() },
            ),
            404,
          );
          const after = await db.integrationDelivery.findUniqueOrThrow({
            where: { id: deliveryId },
          });
          assert.equal(after.state, before.state);
          assert.equal(after.lmkState, "NOT_CONFIRMED");
          assert.equal(
            await db.integrationReceipt.count({ where: { deliveryId } }),
            0,
          );
        } finally {
          await app.close();
        }
      },
    );
    await t.test(
      "a newly verified dated source creates the next result revision and leaves unknown-date history unchanged",
      async () => {
        const datedFile = await lmsStore.put(
          syntheticPdf(
            "Synthetic replacement source confirms exam date 2026-10-15",
          ),
          "pdf",
        );
        const dated = await db.lmsExternalEvidence.create({
          data: {
            tenantId: center.tenant.id,
            enrollmentId: enrollment.id,
            issuer: definition.profile.issuer,
            sourceSystem: "SYNTHETIC SOURCE",
            documentNumber: "SYNTHETIC-CONFIRMED-DATE",
            documentDate: "2026-10-16",
            examAt: new Date("2026-10-15T09:00:00Z"),
            storageKey: datedFile.storageKey,
            sha256: datedFile.sha256,
            mimeType: "application/pdf",
            originalName: "synthetic-dated-source.pdf",
            createdBy: center.user.id,
          },
        });
        await reviewExternalEvidence(center.context, dated.id, {
          status: "DOCUMENT_REVIEWED",
          reviewMethod: "Synthetic new source confirms actual exam date",
          verdict: "PASSED",
        });
        const prior = await db.verifiedExamResult.findFirstOrThrow({
          where: {
            tenantId: center.tenant.id,
            externalEvidenceId: evidence.id,
          },
        });
        const current = await db.verifiedExamResult.findFirstOrThrow({
          where: { tenantId: center.tenant.id, externalEvidenceId: dated.id },
        });
        assert.equal(prior.examAt, null);
        assert.equal(current.revision, prior.revision + 1);
        assert.equal(current.eligible, true);
        assert.equal(current.score, null);
        assert.equal(current.attemptId, null);
        assert.equal(documentMetadata(current).examDate, "2026-10-15");
        const detail = await enrollmentDetail(learner.context, enrollment.id);
        assert.equal(detail.results[0].id, current.id);
        assert.equal(detail.results[0].documentEligible, true);
      },
    );
  } finally {
    await db.$disconnect();
  }
});
