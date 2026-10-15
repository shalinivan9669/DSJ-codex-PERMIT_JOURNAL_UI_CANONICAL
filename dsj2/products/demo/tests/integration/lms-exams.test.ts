import test from "node:test";
import assert from "node:assert/strict";
import { db, type Context } from "../../apps/api/src/core";
import { bootstrap } from "../../apps/api/src/main";
import { createCourse, publishVersion } from "../../apps/api/src/lms/courses";
import {
  assignEnrollments,
  listEnrollments,
} from "../../apps/api/src/lms/enrollments";
import {
  saveLessonProgress,
  enrollmentDetail,
} from "../../apps/api/src/lms/learning";
import {
  startAttempt,
  saveAnswers,
  submitAttempt,
  getAttempt,
  expireLmsAttempts,
} from "../../apps/api/src/lms/exams";
import { reviewExternalEvidence } from "../../apps/api/src/lms/external";
import { lmsStore } from "../../apps/api/src/lms/materials";
import {
  lmsCourse,
  lmsTenant,
  lmsLearner,
  lmsSession,
  lmsHttp,
  lmsJson,
} from "./lms-fixture";

const status = (expected: number) => (error: unknown) => {
  assert.equal((error as { getStatus(): number }).getStatus(), expected);
  return true;
};

test("E02–E07: real PostgreSQL exams preserve scope, strict threshold, sequences, deadlines and exactly one final result", async (t) => {
  process.env.DEMO_LMS_TEST_RUNTIME = "1";
  const center = await lmsTenant("exam concurrency");
  const learner = await lmsLearner(center.tenant.id, "exam");
  const foreignCenter = await lmsTenant("exam foreign");
  const foreign = await lmsLearner(foreignCenter.tenant.id, "exam-foreign");
  const definition = lmsCourse({ sanitary: true });
  definition.profile.sources = [
    {
      title: "Synthetic engineering fixture; not an official norm",
      url: "https://example.test/synthetic",
      revision: "test-v1",
    },
  ];
  definition.profile.effectiveFrom = "2020-01-01";
  definition.profile.effectiveUntil = "2035-12-31";
  const created = await createCourse(center.context, definition);
  await publishVersion(center.context, created.version.id, { revision: 0 });
  const assigned = await assignEnrollments(center.context, {
    courseVersionId: created.version.id,
    recipientIds: [learner.recipient.id],
  });
  const enrollmentId = assigned.items[0].id;
  let attemptId = "";
  let secondId = "";
  try {
    await t.test(
      "required lessons and tenant/learner scope are enforced before start",
      async () => {
        await assert.rejects(
          startAttempt(learner.context, enrollmentId),
          status(409),
        );
        await assert.rejects(
          startAttempt(foreign.context, enrollmentId),
          status(404),
        );
        await assert.rejects(
          startAttempt(center.context, enrollmentId),
          status(403),
        );
        await saveLessonProgress(learner.context, enrollmentId, "lesson-1", {
          sequence: 1,
          acknowledge: true,
        });
      },
    );
    await t.test(
      "eight parallel starts create one active attempt; answer key stays private",
      async () => {
        const starts = await Promise.all(
          Array.from({ length: 8 }, () =>
            startAttempt(learner.context, enrollmentId),
          ),
        );
        assert.equal(new Set(starts.map((a) => a.id)).size, 1);
        attemptId = starts[0].id;
        assert.equal(starts[0].questions.length, 10);
        assert.equal(
          JSON.stringify(starts[0]).includes("correctOptionIds"),
          false,
        );
        assert.equal(
          await db.examAttempt.count({ where: { enrollmentId } }),
          1,
        );
        await assert.rejects(
          getAttempt(foreign.context, attemptId),
          status(404),
        );
      },
    );
    await t.test(
      "tampered score, invalid question and reordered autosave cannot overwrite newer answers",
      async () => {
        const answers = Object.fromEntries(
          Array.from({ length: 8 }, (_, i) => [`q-${i}`, ["a"]]),
        );
        const saved = await saveAnswers(learner.context, attemptId, {
          sequence: 3,
          answers,
        });
        await assert.rejects(
          saveAnswers(learner.context, attemptId, {
            sequence: 4,
            answers,
            score: 10,
            verdict: "PASSED",
          }),
          status(400),
        );
        await assert.rejects(
          saveAnswers(learner.context, attemptId, {
            sequence: 4,
            answers: { "q-999": ["a"] },
          }),
          status(400),
        );
        await assert.rejects(
          saveAnswers(learner.context, attemptId, { sequence: 3, answers: {} }),
          status(409),
        );
        const stale = await saveAnswers(learner.context, attemptId, {
          sequence: 2,
          answers: {},
        });
        assert.deepEqual(stale.answers, saved.answers);
        assert.equal(stale.sequence, 3);
      },
    );
    await t.test(
      "80 percent fails strict sanitary policy; parallel submit returns one immutable result",
      async () => {
        const submitted = await Promise.all(
          Array.from({ length: 8 }, () =>
            submitAttempt(learner.context, attemptId),
          ),
        );
        assert.equal(new Set(submitted.map((a) => a.result?.id)).size, 1);
        assert.equal(submitted[0].result?.score, 8);
        assert.equal(submitted[0].result?.verdict, "FAILED");
        assert.equal(submitted[0].result?.eligible, false);
        assert.equal(
          await db.verifiedExamResult.count({ where: { attemptId } }),
          1,
        );
        assert.equal(
          await db.regulatoryOutbox.count({
            where: { tenantId: center.tenant.id },
          }),
          0,
        );
        await assert.rejects(
          db.verifiedExamResult.update({
            where: { id: submitted[0].result!.id },
            data: { eligible: true },
          }),
        );
      },
    );
    await t.test(
      "retake 90 percent passes, outbox is transactional and replay does not duplicate it",
      async () => {
        const attempt = await startAttempt(learner.context, enrollmentId);
        secondId = attempt.id;
        assert.equal(attempt.ordinal, 2);
        await saveAnswers(learner.context, attempt.id, {
          sequence: 1,
          answers: Object.fromEntries(
            Array.from({ length: 9 }, (_, i) => [`q-${i}`, ["a"]]),
          ),
        });
        const completed = await submitAttempt(learner.context, attempt.id);
        assert.equal(completed.result?.verdict, "PASSED");
        assert.equal(completed.result?.eligible, true);
        await submitAttempt(learner.context, attempt.id);
        await saveAnswers(learner.context, attempt.id, {
          sequence: 99,
          answers: {},
        });
        const outbox = await db.regulatoryOutbox.findMany({
          where: { resultId: completed.result!.id },
        });
        assert.equal(outbox.length, 1);
        assert.equal(outbox[0].status, "PENDING");
        const saved = await getAttempt(learner.context, attempt.id);
        assert.equal(saved.result?.score, 9);
        assert.equal(saved.deadlineAt.getTime(), attempt.deadlineAt.getTime());
      },
    );
    await t.test(
      "closed-browser deadline worker finalizes saved answers once and attempt limit remains enforced",
      async () => {
        const third = await startAttempt(learner.context, enrollmentId);
        await saveAnswers(learner.context, third.id, {
          sequence: 1,
          answers: { "q-0": ["a"] },
        });
        const expiredAt = new Date(Date.now() - 1000);
        // Fixture-only clock advance; no API permits changing the immutable server deadline.
        await db.examAttempt.update({
          where: { id: third.id },
          data: { deadlineAt: expiredAt },
        });
        await Promise.all([expireLmsAttempts(), expireLmsAttempts()]);
        const result = await getAttempt(learner.context, third.id);
        assert.equal(result.state, "FINISHED");
        assert.equal(result.result?.score, 1);
        assert.equal(result.finishedAt!.getTime(), expiredAt.getTime());
        assert.equal(
          await db.verifiedExamResult.count({ where: { attemptId: third.id } }),
          1,
        );
        await assert.rejects(
          startAttempt(learner.context, enrollmentId),
          status(409),
        );
        assert.equal(
          await db.examAttempt.count({ where: { enrollmentId } }),
          3,
        );
      },
    );
    await t.test(
      "real HTTP rejects answer/score injection and foreign scopes after login",
      async () => {
        process.env.PORT = "0";
        process.env.HOST = "127.0.0.1";
        process.env.DEMO_ORIGIN = "http://127.0.0.1:31991";
        const app = await bootstrap();
        try {
          const base = await app.getUrl();
          const auth = await lmsSession(base, learner.user.email);
          const call = lmsHttp(base, auth);
          const fetched = await lmsJson(
            await call(`/learn/attempts/${secondId}`),
          );
          assert.equal(fetched.result.score, 9);
          assert.equal(
            JSON.stringify(fetched).includes("correctOptionIds"),
            false,
          );
          await lmsJson(
            await call(`/learn/attempts/${secondId}/answers`, "PUT", {
              sequence: 999,
              answers: {},
              score: 100,
            }),
            400,
          );
          await lmsJson(
            await call(
              `/learn/enrollments/${enrollmentId}/lessons/lesson-1/progress`,
              "POST",
              { sequence: 999, completion: 100 },
            ),
            400,
          );
          const foreignAuth = await lmsSession(base, foreign.user.email);
          await lmsJson(
            await lmsHttp(base, foreignAuth)(`/learn/attempts/${secondId}`),
            404,
          );
        } finally {
          await app.close();
        }
      },
    );
  } finally {
    await db.$disconnect();
  }
});

test("E02 E07: practice and unreviewed route never produce eligible official results", async (t) => {
  process.env.DEMO_LMS_TEST_RUNTIME = "1";
  const center = await lmsTenant("route gate");
  const learner = await lmsLearner(center.tenant.id, "route");
  const definition = lmsCourse({ kind: "PRACTICE", required: false });
  const course = await createCourse(center.context, definition);
  await publishVersion(center.context, course.version.id, { revision: 0 });
  const enrollment = (
    await assignEnrollments(center.context, {
      courseVersionId: course.version.id,
      recipientIds: [learner.recipient.id],
    })
  ).items[0];
  try {
    await t.test("practice pass remains ineligible", async () => {
      const attempt = await startAttempt(learner.context, enrollment.id);
      await saveAnswers(learner.context, attempt.id, {
        sequence: 1,
        answers: Object.fromEntries(
          Array.from({ length: 10 }, (_, i) => [`q-${i}`, ["a"]]),
        ),
      });
      const result = await submitAttempt(learner.context, attempt.id);
      assert.equal(result.result?.verdict, "PASSED");
      assert.equal(result.result?.eligible, false);
      assert.equal(
        await db.regulatoryOutbox.count({
          where: { resultId: result.result!.id },
        }),
        0,
      );
    });
    await t.test(
      "NEEDS_LEGAL_REVIEW and GENERAL competency cannot start an official center exam",
      async () => {
        const disputed = lmsCourse({ required: false });
        disputed.profile.status = "NEEDS_LEGAL_REVIEW";
        const saved = await createCourse(center.context, disputed);
        await publishVersion(center.context, saved.version.id, { revision: 0 });
        const e = (
          await assignEnrollments(center.context, {
            courseVersionId: saved.version.id,
            recipientIds: [learner.recipient.id],
          })
        ).items[0];
        await assert.rejects(startAttempt(learner.context, e.id), status(409));
        const general = lmsCourse();
        general.profile.competency = "GENERAL";
        const savedGeneral = await createCourse(center.context, general);
        await assert.rejects(
          publishVersion(center.context, savedGeneral.version.id, {
            revision: 0,
          }),
          status(400),
        );
      },
    );
  } finally {
    await db.$disconnect();
  }
});

test("E07: external source review has no fabricated attempt, score, machine verification or duplicate result", async (t) => {
  process.env.DEMO_LMS_TEST_RUNTIME = "1";
  const center = await lmsTenant("external review");
  const learner = await lmsLearner(center.tenant.id, "external");
  const definition = lmsCourse({
    kind: "EXTERNAL_AUTHORIZED",
    required: false,
  });
  definition.profile.externalEvidenceLevel = "DOCUMENT_REVIEWED";
  definition.profile.sources = [
    {
      title: "Synthetic source",
      url: "https://example.test/source",
      revision: "test",
    },
  ];
  definition.profile.effectiveFrom = "2020-01-01";
  const course = await createCourse(center.context, definition);
  await publishVersion(center.context, course.version.id, { revision: 0 });
  const enrollment = (
    await assignEnrollments(center.context, {
      courseVersionId: course.version.id,
      recipientIds: [learner.recipient.id],
    })
  ).items[0];
  const stored = await lmsStore.put(
    Buffer.from("%PDF-1.4\n% SYNTHETIC EXTERNAL EVIDENCE\n%%EOF"),
    "pdf",
  );
  const evidence = await db.lmsExternalEvidence.create({
    data: {
      tenantId: center.tenant.id,
      enrollmentId: enrollment.id,
      issuer: definition.profile.issuer,
      sourceSystem: "SYNTHETIC EXTERNAL SYSTEM",
      documentNumber: "SYNTHETIC-1",
      documentDate: "2026-10-15",
      examAt: new Date("2026-10-15T09:00:00Z"),
      storageKey: stored.storageKey,
      sha256: stored.sha256,
      mimeType: "application/pdf",
      originalName: "synthetic-source.pdf",
      createdBy: center.user.id,
    },
  });
  try {
    await t.test(
      "UNVERIFIED evidence cannot produce a local exam or machine verification",
      async () => {
        await assert.rejects(
          startAttempt(learner.context, enrollment.id),
          status(409),
        );
        assert.equal(
          await db.verifiedExamResult.count({
            where: { externalEvidenceId: evidence.id },
          }),
          0,
        );
        await assert.rejects(
          reviewExternalEvidence(center.context, evidence.id, {
            status: "MACHINE_VERIFIED",
            reviewMethod: "manual checkbox",
          }),
          status(400),
        );
        await assert.rejects(
          reviewExternalEvidence(learner.context, evidence.id, {
            status: "DOCUMENT_REVIEWED",
            reviewMethod: "manual review",
          }),
          status(403),
        );
      },
    );
    await t.test(
      "authorized document review preserves source and null score, repeated review is idempotent",
      async () => {
        await reviewExternalEvidence(center.context, evidence.id, {
          status: "DOCUMENT_REVIEWED",
          reviewMethod:
            "Synthetic reviewer compared document to profile source",
          verdict: "PASSED",
        });
        await reviewExternalEvidence(center.context, evidence.id, {
          status: "DOCUMENT_REVIEWED",
          reviewMethod: "Repeated same decision",
          verdict: "PASSED",
        });
        const results = await db.verifiedExamResult.findMany({
          where: { externalEvidenceId: evidence.id },
        });
        assert.equal(results.length, 1);
        assert.equal(results[0].attemptId, null);
        assert.equal(results[0].score, null);
        assert.equal(results[0].maximum, null);
        assert.equal(results[0].eligible, true);
        assert.equal(results[0].assessmentKind, "EXTERNAL_AUTHORIZED");
        assert.equal(
          (
            await db.lmsExternalEvidence.findUniqueOrThrow({
              where: { id: evidence.id },
            })
          ).status,
          "DOCUMENT_REVIEWED",
        );
        assert.equal(
          await db.examAttempt.count({
            where: { enrollmentId: enrollment.id },
          }),
          0,
        );
      },
    );
    await t.test("OPERATOR cannot review an external assessment", async () => {
      const context: Context = { ...center.context, role: "OPERATOR" };
      await assert.rejects(
        reviewExternalEvidence(context, evidence.id, {
          status: "DOCUMENT_REVIEWED",
          reviewMethod: "manual review",
        }),
        status(403),
      );
    });
    await t.test(
      "voided result is ineligible in list and learner detail without rewriting immutable history",
      async () => {
        const result = await db.verifiedExamResult.findFirstOrThrow({
          where: { externalEvidenceId: evidence.id },
        });
        await db.lmsResultEvent.create({
          data: {
            tenantId: center.tenant.id,
            resultId: result.id,
            kind: "VOIDED",
            reason: "Synthetic invalidation projection test",
            actorId: center.user.id,
            correlationId: center.context.correlationId,
          },
        });
        const list = await listEnrollments(learner.context, {});
        assert.equal(
          list.items.find((row) => row.id === enrollment.id)?.result?.eligible,
          false,
        );
        assert.equal(
          list.items.find((row) => row.id === enrollment.id)?.result?.state,
          "VOIDED",
        );
        const detail = await enrollmentDetail(learner.context, enrollment.id);
        assert.equal(detail.results[0].eligible, false);
        assert.equal(detail.results[0].state, "VOIDED");
        assert.equal(
          (
            await db.verifiedExamResult.findUniqueOrThrow({
              where: { id: result.id },
            })
          ).eligible,
          true,
        );
      },
    );
  } finally {
    await db.$disconnect();
  }
});
