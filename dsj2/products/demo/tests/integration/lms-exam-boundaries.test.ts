import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { db, hash, json } from "../../apps/api/src/core";
import {
  createCourse,
  publishVersion,
  cloneVersion,
  updateVersion,
} from "../../apps/api/src/lms/courses";
import { assignEnrollments } from "../../apps/api/src/lms/enrollments";
import {
  getAttempt,
  saveAnswers,
  startAttempt,
  submitAttempt,
  expireLmsAttempts,
} from "../../apps/api/src/lms/exams";
import { gradeAnswers } from "../../apps/api/src/lms/engine";
import { lmsCourse, lmsLearner, lmsTenant } from "./lms-fixture";

test("E01: a published new bilingual multiple-answer bank cannot change an existing selected exam snapshot", async () => {
  const center = await lmsTenant("frozen question bank");
  const learner = await lmsLearner(center.tenant.id, "bank");
  const definition = lmsCourse({ required: false, questions: 9 });
  definition.content.exam.questionCount = 5;
  definition.content.exam.questions = definition.content.exam.questions.map(
    (question, i) => ({
      ...question,
      category: `category-${i % 2}`,
      multiple: true,
      correctOptionIds: ["a", "b"],
    }),
  );
  const course = await createCourse(center.context, definition);
  await publishVersion(center.context, course.version.id, { revision: 0 });
  const enrollment = (
    await assignEnrollments(center.context, {
      courseVersionId: course.version.id,
      recipientIds: [learner.recipient.id],
    })
  ).items[0];
  const first = await startAttempt(learner.context, enrollment.id);
  const storedBefore = await db.examAttempt.findUniqueOrThrow({
    where: { id: first.id },
  });
  assert.equal(first.questions.length, 5);
  assert.equal(new Set(first.questions.map((question) => question.id)).size, 5);
  assert.ok(
    first.questions.every(
      (question) => question.promptRu && question.promptKz && question.category,
    ),
  );
  const clone = await cloneVersion(center.context, course.course.id);
  const changed = structuredClone(definition);
  changed.content.exam.questions = changed.content.exam.questions.map(
    (question) => ({
      ...question,
      promptRu: `Новая редакция ${question.id}`,
      promptKz: `Жаңа редакция ${question.id}`,
      correctOptionIds: ["b"],
    }),
  );
  changed.content.exam.thresholdPercent = 100;
  await updateVersion(center.context, clone.id, { revision: 0, ...changed });
  await publishVersion(center.context, clone.id, { revision: 1 });
  await assert.rejects(
    updateVersion(center.context, course.version.id, {
      revision: 0,
      ...changed,
    }),
    (error: any) => error.getStatus() === 409,
  );
  const resumed = await getAttempt(learner.context, first.id);
  assert.deepEqual(resumed.questions, first.questions);
  assert.equal(resumed.deadlineAt.getTime(), first.deadlineAt.getTime());
  assert.equal(
    hash(
      (await db.examAttempt.findUniqueOrThrow({ where: { id: first.id } }))
        .snapshot,
    ),
    hash(storedBefore.snapshot),
  );
  await saveAnswers(learner.context, first.id, {
    sequence: 1,
    answers: Object.fromEntries(
      first.questions.map((question) => [question.id, ["b", "a"]]),
    ),
  });
  const finished = await submitAttempt(learner.context, first.id);
  assert.equal(finished.result?.score, 5);
  assert.equal(finished.result?.maximum, 5);
  assert.equal(finished.result?.verdict, "PASSED");
  const nextEnrollment = (
    await assignEnrollments(center.context, {
      courseVersionId: clone.id,
      recipientIds: [learner.recipient.id],
    })
  ).items[0];
  const next = await startAttempt(learner.context, nextEnrollment.id);
  assert.ok(
    next.questions.every(
      (question) =>
        question.promptRu.startsWith("Новая редакция") &&
        question.promptKz.startsWith("Жаңа редакция"),
    ),
  );
  assert.equal(
    (await db.examAttempt.findUniqueOrThrow({ where: { id: next.id } }))
      .courseVersionId,
    clone.id,
  );
});

test("E05: deadline worker racing submit finalizes once and a new process replays the same result", async () => {
  const center = await lmsTenant("deadline-submit-restart");
  const learner = await lmsLearner(center.tenant.id, "deadline");
  const course = await createCourse(
    center.context,
    lmsCourse({ sanitary: true, required: false }),
  );
  const published = await publishVersion(center.context, course.version.id, {
    revision: 0,
  });
  const enrollment = (
    await assignEnrollments(center.context, {
      courseVersionId: course.version.id,
      recipientIds: [learner.recipient.id],
    })
  ).items[0];
  const deadline = new Date(Date.now() - 1);
  // A synthetic historical attempt is born with its elapsed server deadline;
  // no immutable deadline or snapshot is rewritten to force expiration.
  const content = published.content;
  const attempt = await db.examAttempt.create({
    data: {
      tenantId: center.tenant.id,
      enrollmentId: enrollment.id,
      courseVersionId: published.id,
      regulatoryProfileVersionId: published.regulatoryProfileVersionId,
      assessmentKind: published.profile.assessmentKind,
      assessmentId: "FINAL",
      purpose: "FINAL",
      ordinal: 1,
      activeKey: `${center.tenant.id}:${enrollment.id}:FINAL`,
      startedAt: new Date(
        deadline.getTime() - content.exam.durationMinutes * 60000,
      ),
      deadlineAt: deadline,
      sequence: 1,
      snapshot: json({
        questions: content.exam.questions,
        policy: { ...content.exam, questions: [] },
        profile: published.profile,
      }),
      answers: json(
        Object.fromEntries(
          content.exam.questions.map((question) => [question.id, ["a"]]),
        ),
      ),
    },
  });
  await Promise.all([
    submitAttempt(learner.context, attempt.id),
    expireLmsAttempts(),
    submitAttempt(learner.context, attempt.id),
  ]);
  const result = await getAttempt(learner.context, attempt.id);
  assert.equal(result.finishedAt?.getTime(), deadline.getTime());
  assert.equal(
    await db.verifiedExamResult.count({ where: { attemptId: attempt.id } }),
    1,
  );
  assert.equal(
    await db.regulatoryOutbox.count({ where: { resultId: result.result!.id } }),
    1,
  );
  const script = fileURLToPath(
    new URL(
      "../../scripts/verification/lms-replay-attempt.ts",
      import.meta.url,
    ),
  );
  const fresh = spawnSync(
    process.execPath,
    [
      "node_modules/tsx/dist/cli.mjs",
      "--tsconfig",
      "tsconfig.base.json",
      script,
    ],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        LMS_REPLAY_INPUT: JSON.stringify({
          context: learner.context,
          attemptId: attempt.id,
          resultId: result.result!.id,
          deadlineAt: deadline.toISOString(),
        }),
      },
      encoding: "utf8",
      windowsHide: true,
      timeout: 20_000,
    },
  );
  assert.equal(fresh.status, 0, fresh.stdout + fresh.stderr);
  const replay = JSON.parse(fresh.stdout.trim());
  assert.equal(replay.resultId, result.result!.id);
  assert.equal(replay.resultCount, 1);
  assert.equal(replay.outboxCount, 1);
});

test("E06: exact fractional boundary and empty answers are graded without rounding or fabricated maximum", () => {
  const questions = Array.from({ length: 251 }, (_, i) => ({
    id: String(i),
    options: [{ id: "a" }, { id: "b" }],
    correctOptionIds: ["a"],
  }));
  const policy = { thresholdPercent: 80, comparison: "GT" as const };
  const answers = Object.fromEntries(
    questions.slice(0, 201).map((question) => [question.id, ["a"]]),
  );
  const above = gradeAnswers(questions, answers, policy);
  assert.equal(above.score, 201);
  assert.equal(above.maxScore, 251);
  assert.equal(Math.round(above.percent), 80);
  assert.equal(above.verdict, "PASSED");
  delete answers["200"];
  assert.equal(gradeAnswers(questions, answers, policy).verdict, "FAILED");
  assert.equal(
    gradeAnswers(questions.slice(0, 250), answers, policy).verdict,
    "FAILED",
  );
  const empty = gradeAnswers(questions, {}, policy);
  assert.equal(empty.score, 0);
  assert.equal(empty.maxScore, 251);
  assert.equal(empty.verdict, "FAILED");
});

test.after(async () => {
  await db.$disconnect();
});

test("E02: admission uses the profile calendar date across local midnight", async (t) => {
  const center = await lmsTenant("local midnight route");
  const learner = await lmsLearner(center.tenant.id, "midnight");
  const definition = lmsCourse({ required: false });
  definition.profile.effectiveFrom = "2026-10-16";
  definition.profile.effectiveUntil = "2026-10-16";
  definition.profile.timezone = "Asia/Qyzylorda";
  const course = await createCourse(center.context, definition);
  await publishVersion(center.context, course.version.id, { revision: 0 });
  const enrollment = (
    await assignEnrollments(center.context, {
      courseVersionId: course.version.id,
      recipientIds: [learner.recipient.id],
    })
  ).items[0];
  t.mock.timers.enable({ apis: ["Date"], now: Date.UTC(2026, 9, 15, 21) });
  try {
    const attempt = await startAttempt(learner.context, enrollment.id);
    assert.equal(attempt.state, "IN_PROGRESS");
    assert.equal(attempt.startedAt.toISOString(), "2026-10-15T21:00:00.000Z");
  } finally {
    t.mock.timers.reset();
  }
});
