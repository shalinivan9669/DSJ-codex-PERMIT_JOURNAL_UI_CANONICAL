import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { provision } from "../../scripts/setup";
import { db, type Context } from "../../apps/api/src/core";
import { createCourse, publishVersion } from "../../apps/api/src/lms/courses";
import { assignEnrollments } from "../../apps/api/src/lms/enrollments";
import {
  startAttempt,
  saveAnswers,
  submitAttempt,
} from "../../apps/api/src/lms/exams";
import {
  prepareResultDocuments,
  advanceLmsDocuments,
} from "../../apps/api/src/lms/document-bridge";
import { decideProposal } from "../../apps/api/src/approvals";
import {
  claimJob,
  executeJob,
  heartbeat,
  settleFailure,
  DeferredJob,
} from "../../apps/render-worker/src/queue";
import { store } from "../../apps/api/src/files";
import { lmsCourse, lmsLearner, LMS_PASSWORD } from "./lms-fixture";

test(
  "document scheduling crosses blocked pages without bypassing approval or rendering",
  { timeout: 300_000 },
  async (t) => {
    process.env.DEMO_LMS_TEST_RUNTIME = "1";
    const seeded = await provision({
      email: `document-scheduling-${randomUUID()}@example.test`,
      password: LMS_PASSWORD,
      name: "СИНТЕТИЧЕСКАЯ проверка очереди LMS",
      sample: true,
    });
    const c: Context = {
      tenantId: seeded.tenantId,
      userId: seeded.userId,
      role: "DIRECTOR",
      sessionId: "synthetic",
      csrfHash: "synthetic",
      correlationId: randomUUID(),
    };
    const definition = lmsCourse({ required: false, questions: 1 });
    definition.profile.documentTypes = ["CERTIFICATE"];
    const course = await createCourse(c, definition);
    await publishVersion(c, course.version.id, { revision: 0 });
    const learners = [];
    for (let i = 0; i < 33; i++)
      learners.push(await lmsLearner(c.tenantId, `Очередь ${i + 1}`));
    const enrolled = await assignEnrollments(c, {
      courseVersionId: course.version.id,
      recipientIds: learners.map((learner) => learner.recipient.id),
    });
    const resultIds = [];
    for (const learner of learners) {
      const enrollment = enrolled.items.find(
        (item) => item.recipientId === learner.recipient.id,
      )!;
      const attempt = await startAttempt(learner.context, enrollment.id);
      await saveAnswers(learner.context, attempt.id, {
        sequence: 1,
        answers: { "q-0": ["a"] },
      });
      const finished = await submitAttempt(learner.context, attempt.id);
      assert.equal(finished.result!.eligible, true);
      resultIds.push(finished.result!.id);
    }
    const prepared = await prepareResultDocuments(c, { resultIds });
    assert.deepEqual(prepared.errors, []);
    assert.equal(prepared.items.length, 33);
    const ownIds = prepared.items.map((item) => item.id);
    const approve = async (requestId: string) => {
      const proposal = await db.requestProposal.findFirstOrThrow({
        where: { tenantId: c.tenantId, requestId, status: "PENDING" },
        orderBy: { revision: "desc" },
      });
      await decideProposal(c, proposal.id, {
        decision: "APPROVE",
        reason: "Синтетическая проверка справедливого обхода",
        expectedProposalHash: proposal.proposalHash,
      });
    };
    try {
      await t.test(
        "32 older unapproved requests cannot starve the later director-approved request",
        async () => {
          const later = prepared.items.at(-1)!;
          await approve(later.requestId);
          const total = await db.lmsDocumentLink.count({
            where: { issuanceId: null, status: "PREPARED" },
          });
          for (let tick = 0; tick < Math.ceil(total / 30) + 2; tick++) {
            await advanceLmsDocuments();
            if (
              (
                await db.lmsDocumentLink.findUniqueOrThrow({
                  where: { id: later.id },
                })
              ).issuanceId
            )
              break;
          }
          assert.ok(
            (
              await db.lmsDocumentLink.findUniqueOrThrow({
                where: { id: later.id },
              })
            ).issuanceId,
          );
          assert.equal(
            await db.lmsDocumentLink.count({
              where: { id: { in: ownIds }, issuanceId: null },
            }),
            32,
            "unapproved requests must remain without issuance",
          );
          assert.equal(
            await db.numberReservation.count({
              where: { tenantId: c.tenantId },
            }),
            1,
          );
        },
      );
      await t.test(
        "more than 30 incomplete render requests cannot starve a later actual completed document",
        async () => {
          for (const link of prepared.items.slice(0, -1))
            await approve(link.requestId);
          const pendingCount = await db.lmsDocumentLink.count({
            where: { issuanceId: null, status: "PREPARED" },
          });
          for (let tick = 0; tick < Math.ceil(pendingCount / 30) + 2; tick++) {
            await advanceLmsDocuments();
            if (
              !(await db.lmsDocumentLink.count({
                where: { id: { in: ownIds }, issuanceId: null },
              }))
            )
              break;
          }
          assert.equal(
            await db.lmsDocumentLink.count({
              where: { id: { in: ownIds }, issuanceId: null },
            }),
            0,
          );
          // Choose a real request outside the former first-page-only query.
          const formerPage = await db.lmsDocumentLink.findMany({
            where: { issuanceId: { not: null }, status: "PREPARED" },
            distinct: ["requestId"],
            take: 30,
          });
          const ready = prepared.items.find(
            (item) =>
              !formerPage.some((row) => row.requestId === item.requestId),
          )!;
          assert.ok(ready);
          // Only scheduling time is delayed. No issuance, workflow, artifact or job
          // success is fabricated; the selected request runs the real worker below.
          await db.generationJob.updateMany({
            where: {
              tenantId: c.tenantId,
              requestId: { not: ready.requestId },
            },
            data: { runAfter: new Date("2099-01-01T00:00:00Z") },
          });
          const owner = `scheduling-${randomUUID()}`;
          for (let n = 0; n < 40; n++) {
            if (
              !(await db.generationJob.count({
                where: {
                  tenantId: c.tenantId,
                  requestId: ready.requestId,
                  status: { not: "SUCCEEDED" },
                },
              }))
            )
              break;
            const job = await claimJob(db, owner, c.tenantId);
            if (!job) {
              await new Promise((done) => setTimeout(done, 250));
              continue;
            }
            assert.equal(job.requestId, ready.requestId);
            const beat = setInterval(() => {
              void heartbeat(db, job, owner);
            }, 5000);
            try {
              await executeJob(
                db,
                store,
                job,
                owner,
                AbortSignal.timeout(210_000),
              );
            } catch (error) {
              await settleFailure(db, job, owner, error);
              if (!(error instanceof DeferredJob)) throw error;
            } finally {
              clearInterval(beat);
            }
          }
          assert.equal(
            await db.generationJob.count({
              where: {
                tenantId: c.tenantId,
                requestId: ready.requestId,
                status: { not: "SUCCEEDED" },
              },
            }),
            0,
          );
          assert.equal(
            await db.artifact.count({
              where: {
                tenantId: c.tenantId,
                requestId: ready.requestId,
                format: "PDF",
              },
            }),
            1,
          );
          const total = await db.lmsDocumentLink.count({
            where: { issuanceId: { not: null }, status: "PREPARED" },
          });
          for (let tick = 0; tick < Math.ceil(total / 30) + 2; tick++) {
            await advanceLmsDocuments();
            if (
              (
                await db.lmsDocumentLink.findUniqueOrThrow({
                  where: { id: ready.id },
                })
              ).status === "ISSUED"
            )
              break;
          }
          assert.equal(
            (
              await db.lmsDocumentLink.findUniqueOrThrow({
                where: { id: ready.id },
              })
            ).status,
            "ISSUED",
          );
          assert.equal(
            await db.lmsDocumentLink.count({
              where: { id: { in: ownIds }, status: "PREPARED" },
            }),
            32,
            "the other real requests still wait for rendering",
          );
        },
      );
    } finally {
      await db.$disconnect();
    }
  },
);
