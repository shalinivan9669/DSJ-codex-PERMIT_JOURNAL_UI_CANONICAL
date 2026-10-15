import test from "node:test";
import assert from "node:assert/strict";
import { db } from "../../apps/api/src/core";
import { bootstrap } from "../../apps/api/src/main";
import { createCourse, publishVersion } from "../../apps/api/src/lms/courses";
import { assignEnrollments } from "../../apps/api/src/lms/enrollments";
import { documentMetadata } from "../../apps/api/src/lms/document-metadata";
import {
  lmsCourse,
  lmsTenant,
  lmsLearner,
  lmsSession,
  lmsHttp,
  lmsJson,
} from "./lms-fixture";
import { syntheticPdf } from "../fixtures/pdf";

test("external date-only source and immutable date clarification reuse known fields and preserve exact provenance", async (t) => {
  process.env.PORT = "0";
  process.env.HOST = "127.0.0.1";
  process.env.DEMO_ORIGIN = "http://127.0.0.1:31995";
  process.env.DEMO_LMS_TEST_RUNTIME = "1";
  const center = await lmsTenant("external date precision");
  const foreign = await lmsTenant("external date foreign");
  const learner = await lmsLearner(center.tenant.id, "external date");
  const definition = lmsCourse({
    kind: "EXTERNAL_AUTHORIZED",
    sanitary: true,
    required: false,
  });
  definition.profile.externalEvidenceLevel = "DOCUMENT_REVIEWED";
  definition.profile.timezone = "Pacific/Kiritimati";
  const course = await createCourse(center.context, definition);
  await publishVersion(center.context, course.version.id, { revision: 0 });
  const enrollment = (
    await assignEnrollments(center.context, {
      courseVersionId: course.version.id,
      recipientIds: [learner.recipient.id],
    })
  ).items[0];
  const app = await bootstrap();
  try {
    const base = await app.getUrl();
    const headers = await lmsSession(base, center.user.email);
    const call = lmsHttp(base, headers);
    const other = lmsHttp(base, await lmsSession(base, foreign.user.email));
    const student = lmsHttp(base, await lmsSession(base, learner.user.email));
    async function upload(examDate?: string, examAt?: string) {
      const form = new FormData();
      form.set("issuer", definition.profile.issuer);
      form.set("sourceSystem", "Synthetic date source");
      form.set("documentNumber", "SYNTHETIC-DATE-SOURCE");
      form.set("documentDate", "2026-10-13");
      if (examDate) form.set("examDate", examDate);
      if (examAt) form.set("examAt", examAt);
      form.set(
        "file",
        new Blob(
          [Buffer.from(syntheticPdf("Synthetic external date evidence"))],
          { type: "application/pdf" },
        ),
        "synthetic-evidence.pdf",
      );
      return fetch(
        `${base}/lms/enrollments/${enrollment.id}/external-evidence`,
        { method: "POST", headers, body: form },
      );
    }
    let unknownId = "";
    await t.test(
      "actual upload freezes the source calendar date in the profile timezone without claiming an exact exam hour",
      async () => {
        const source = await lmsJson(await upload("2026-10-12"), 201);
        assert.equal(source.examDate, "2026-10-12");
        assert.equal(source.examAt, "2026-10-11T22:00:00.000Z");
        assert.equal(source.storageKey, undefined);
        await lmsJson(
          await call(`/lms/external-evidence/${source.id}/review`, "POST", {
            status: "DOCUMENT_REVIEWED",
            reviewMethod: "Synthetic calendar date confirmed from source",
            verdict: "PASSED",
          }),
          201,
        );
        const result = await db.verifiedExamResult.findFirstOrThrow({
          where: { externalEvidenceId: source.id },
        });
        const frozen = result.snapshot as {
          source: { datePrecision: string; examDate: string; timezone: string };
        };
        assert.equal(frozen.source.datePrecision, "DATE");
        assert.equal(frozen.source.examDate, "2026-10-12");
        assert.equal(frozen.source.timezone, "Pacific/Kiritimati");
        assert.equal(documentMetadata(result).examDate, "2026-10-12");
        assert.equal(result.score, null);
        assert.equal(result.attemptId, null);
        await lmsJson(await upload("2026-10-12", "2026-10-12T10:00:00Z"), 400);
        await lmsJson(await upload("2099-10-12"), 422);
        const sourcesBeforeInvalid = await db.lmsExternalEvidence.count({
          where: { tenantId: center.tenant.id, enrollmentId: enrollment.id },
        });
        await lmsJson(await upload(undefined, "2099-10-12T10:00:00Z"), 422);
        assert.equal(
          await db.lmsExternalEvidence.count({
            where: { tenantId: center.tenant.id, enrollmentId: enrollment.id },
          }),
          sourcesBeforeInvalid,
        );
        const unknown = await lmsJson(await upload(), 201);
        unknownId = unknown.id;
        assert.equal(unknown.examDate, null);
        await lmsJson(
          await call(`/lms/external-evidence/${unknownId}/date`, "POST", {
            examDate: "2026-10-12",
            reviewMethod: "Synthetic source date clarified",
          }),
          409,
        );
        await lmsJson(
          await call(`/lms/external-evidence/${unknownId}/review`, "POST", {
            status: "DOCUMENT_REVIEWED",
            reviewMethod: "Synthetic source reviewed, date initially unknown",
            verdict: "PASSED",
          }),
          201,
        );
      },
    );
    await t.test(
      "two concurrent director clarifications create one linked source/result with retained original bytes; changed retry is denied",
      async () => {
        const old = await db.verifiedExamResult.findFirstOrThrow({
          where: { externalEvidenceId: unknownId },
        });
        const original = await db.lmsExternalEvidence.findUniqueOrThrow({
          where: { id: unknownId },
        });
        const route = `/lms/external-evidence/${unknownId}/date`;
        const body = {
          examDate: "2026-10-12",
          reviewMethod: "Synthetic source date clarified",
        };
        await lmsJson(await other(route, "POST", body), 404);
        await lmsJson(await student(route, "POST", body), 403);
        await lmsJson(
          await call(route, "POST", { ...body, examDate: "2099-10-12" }),
          422,
        );
        const values = await Promise.all([
          call(route, "POST", body),
          call(route, "POST", body),
        ]);
        const first = await lmsJson(values[0], 201),
          second = await lmsJson(values[1], 201);
        assert.equal(first.id, second.id);
        assert.notEqual(first.id, unknownId);
        assert.equal(first.examDate, "2026-10-12");
        assert.equal(first.storageKey, undefined);
        const listed = await lmsJson(
          await call(`/lms/enrollments/${enrollment.id}/external-evidence`),
          200,
        );
        assert.equal(
          listed.items.find((item: { id: string }) => item.id === unknownId)
            .supersededByEvidenceId,
          first.id,
        );
        const revised = await db.lmsExternalEvidence.findUniqueOrThrow({
          where: { id: first.id },
        });
        assert.equal(revised.sha256, original.sha256);
        assert.equal(revised.storageKey, original.storageKey);
        assert.equal(revised.documentNumber, original.documentNumber);
        assert.equal(revised.documentDate, original.documentDate);
        assert.equal(revised.status, "DOCUMENT_REVIEWED");
        assert.deepEqual(
          await db.lmsExternalEvidence.findUniqueOrThrow({
            where: { id: unknownId },
          }),
          original,
        );
        assert.deepEqual(
          await db.verifiedExamResult.findUniqueOrThrow({
            where: { id: old.id },
          }),
          old,
        );
        const results = await db.verifiedExamResult.findMany({
          where: { supersedesResultId: old.id },
        });
        assert.equal(results.length, 1);
        assert.equal(results[0].externalEvidenceId, revised.id);
        assert.equal(results[0].revision, old.revision + 1);
        assert.equal(results[0].eligible, true);
        assert.equal(documentMetadata(results[0]).examDate, body.examDate);
        assert.equal(
          await db.lmsResultEvent.count({
            where: { resultId: old.id, kind: "SUPERSEDED" },
          }),
          1,
        );
        assert.equal(
          await db.regulatoryOutbox.count({
            where: { resultId: results[0].id },
          }),
          1,
        );
        assert.equal(
          await db.auditEvent.count({
            where: {
              entityId: unknownId,
              action: "LMS_EXTERNAL_DATE_CLARIFIED",
            },
          }),
          1,
        );
        await lmsJson(
          await call(route, "POST", { ...body, examDate: "2026-10-11" }),
          409,
        );
        await lmsJson(
          await call(route, "POST", {
            ...body,
            reviewMethod: "Another changed decision",
          }),
          409,
        );
        await lmsJson(
          await call(`/lms/external-evidence/${revised.id}/date`, "POST", body),
          409,
        );
      },
    );
  } finally {
    await app.close();
    await db.$disconnect();
  }
});
