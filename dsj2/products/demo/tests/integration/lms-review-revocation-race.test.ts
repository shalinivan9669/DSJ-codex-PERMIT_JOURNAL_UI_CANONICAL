import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { db, transaction } from "../../apps/api/src/core";
import { lmsTenant, lmsLearner, lmsCourse } from "./lms-fixture";
import { createCourse, publishVersion } from "../../apps/api/src/lms/courses";
import { assignEnrollments } from "../../apps/api/src/lms/enrollments";
import {
  createTeachingBinding,
  revokeTeachingBinding,
} from "../../apps/api/src/lms/teaching-bindings";
import {
  saveSubmission,
  submitSubmission,
} from "../../apps/api/src/lms/submissions";
import {
  reviewDetail,
  decideReview,
} from "../../apps/api/src/lms/manual-review";

function signal<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => (resolve = done));
  return { promise, resolve };
}

// Observe actual PostgreSQL waiters, not a timing assumption about async calls.
async function waitForBindingLock(kind: "REVIEW" | "REVOKE", excludePid = 0) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const rows = await db.$queryRaw<{ pid: number; query: string }[]>`
      SELECT pid,query FROM pg_stat_activity
      WHERE datname=current_database() AND pid<>pg_backend_pid()
      AND wait_event_type='Lock' AND cardinality(pg_blocking_pids(pid))>0`;
    const waiter = rows.find(
      (row) =>
        row.pid !== excludePid &&
        row.query.includes('"LmsTeachingBinding"') &&
        row.query.includes("FOR UPDATE") &&
        row.query.includes("ORDER BY id") === (kind === "REVIEW"),
    );
    if (waiter) return waiter.pid;
    await delay(20);
  }
  assert.fail(`Expected actual blocked ${kind} binding lock`);
}

test("AC11: actual binding row locks serialize revocation against review in both commit orders", async (t) => {
  t.after(() => db.$disconnect());
  process.env.DEMO_LMS_TEST_RUNTIME = "1";
  for (const first of ["REVOKE", "REVIEW"] as const) {
    const center = await lmsTenant(`review-revocation-${first}`);
    const learner = await lmsLearner(center.tenant.id, first);
    const teacher = await db.user.create({
      data: {
        tenantId: center.tenant.id,
        email: `${randomUUID()}@example.test`,
        displayName: "Synthetic concurrent reviewer",
        role: "TEACHER",
        passwordHash: "synthetic-no-login",
      },
    });
    const reviewer = { ...center.context, role: "TEACHER", userId: teacher.id };
    const definition = lmsCourse({ questions: 1, required: false });
    definition.content.modules[0].lessons = [
      {
        id: "work",
        kind: "ASSIGNMENT",
        titleRu: "Работа",
        titleKz: "Жұмыс",
        required: true,
        assignment: {
          instructionsRu: "Обоснуйте решение",
          instructionsKz: "Шешімді негіздеңіз",
          criteriaRu: "Есть основание",
          criteriaKz: "Негіз бар",
          allowText: true,
          allowFiles: false,
          maxSubmissions: 2,
        },
      },
    ];
    const course = await createCourse(center.context, definition);
    await publishVersion(center.context, course.version.id, { revision: 0 });
    const binding = await createTeachingBinding(center.context, {
      userId: teacher.id,
      role: "TEACHER",
      courseId: course.course.id,
    });
    const enrollment = (
      await assignEnrollments(center.context, {
        courseVersionId: course.version.id,
        recipientIds: [learner.recipient.id],
      })
    ).items[0];
    await saveSubmission(learner.context, enrollment.id, "work", {
      sequence: 1,
      text: "Синтетическое обоснование",
      attachmentIds: [],
    });
    const submitted = await submitSubmission(
      learner.context,
      enrollment.id,
      "work",
      {
        sequence: 1,
      },
    );
    const detail = await reviewDetail(reviewer, "SUBMISSION", submitted.id!);
    const input = {
      decisionKey: randomUUID(),
      revision: detail.revision,
      contentHash: detail.contentHash,
      decision: "ACCEPTED",
      feedback: "Проверено до отзыва полномочия",
    };
    const held = signal<void>();
    const release = signal<void>();
    const barrier = transaction(async (tx) => {
      await tx.$executeRaw`SELECT id FROM "LmsTeachingBinding" WHERE "tenantId"=${center.tenant.id} AND id=${binding.id} FOR UPDATE`;
      held.resolve();
      await release.promise;
    });
    await held.promise;
    let review!: Promise<Awaited<ReturnType<typeof decideReview>>>;
    let revoke!: Promise<Awaited<ReturnType<typeof revokeTeachingBinding>>>;
    const startReview = () =>
      (review = decideReview(reviewer, "SUBMISSION", submitted.id!, input));
    const startRevoke = () =>
      (revoke = revokeTeachingBinding(center.context, binding.id, {
        reason: "Synthetic controlled concurrency",
      }));
    let queueProof: number[];
    try {
      if (first === "REVOKE") startRevoke();
      else startReview();
      const firstPid = await waitForBindingLock(first);
      if (first === "REVOKE") startReview();
      else startRevoke();
      const secondPid = await waitForBindingLock(
        first === "REVOKE" ? "REVIEW" : "REVOKE",
        firstPid,
      );
      queueProof = [firstPid, secondPid];
    } finally {
      release.resolve();
      await barrier;
    }
    const [reviewed, revoked] = await Promise.allSettled([review, revoke]);
    assert.equal(revoked.status, "fulfilled");
    const decisions = await db.lmsReviewDecision.findMany({
      where: { tenantId: center.tenant.id, targetId: submitted.id! },
    });
    if (first === "REVOKE") {
      assert.equal(reviewed.status, "rejected");
      const error = (reviewed as PromiseRejectedResult).reason;
      assert.equal(error.getStatus(), 403);
      assert.equal(error.getResponse().code, "LEARNING_PERMISSION_DENIED");
      assert.equal(decisions.length, 0);
      assert.equal(
        (
          await db.lmsSubmission.findUniqueOrThrow({
            where: { id: submitted.id! },
          })
        ).state,
        "SUBMITTED",
      );
    } else {
      assert.equal(reviewed.status, "fulfilled");
      assert.equal(decisions.length, 1);
      assert.equal(decisions[0].contentHash, detail.contentHash);
      assert.equal(decisions[0].actorId, teacher.id);
      await assert.rejects(
        db.lmsReviewDecision.update({
          where: { id: decisions[0].id },
          data: { feedback: "Forbidden rewrite" },
        }),
      );
    }
    await assert.rejects(
      decideReview(reviewer, "SUBMISSION", submitted.id!, input),
    );
    assert.ok(
      (
        await db.lmsTeachingBinding.findUniqueOrThrow({
          where: { id: binding.id },
        })
      ).revokedAt,
    );
    t.diagnostic(
      `${first} first; actual blocked PostgreSQL pids=${queueProof.join(",")}; immutable decisions=${decisions.length}; subsequent request denied`,
    );
  }
});
