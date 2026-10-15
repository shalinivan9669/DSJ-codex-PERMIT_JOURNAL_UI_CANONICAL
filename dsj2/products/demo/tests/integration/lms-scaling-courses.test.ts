import test from "node:test";
import assert from "node:assert/strict";
import { db } from "../../apps/api/src/core";
import {
  createCourse,
  publishVersion,
  cloneVersion,
  updateVersion,
  listCourses,
  setRegulatoryReview,
} from "../../apps/api/src/lms/courses";
import {
  saveQuestion,
  listQuestions,
  questionRevisions,
} from "../../apps/api/src/lms/questions";
import { enrollmentDetail } from "../../apps/api/src/lms/learning";
import {
  startAttempt,
  saveAnswers,
  submitAttempt,
} from "../../apps/api/src/lms/exams";
import { lmsCourse, lmsTenant, lmsLearner } from "./lms-fixture";
import { courseContentSchema } from "../../packages/contracts/src/lms";

test("V1 F1/F2/A2: exact admission, repairable drafts and explicitly pinned shared question revisions", async (t) => {
  t.after(() => db.$disconnect());
  process.env.DEMO_LMS_TEST_RUNTIME = "1";
  const center = await lmsTenant("scaling-courses");
  const foreign = await lmsTenant("scaling-courses-foreign");
  const learner = await lmsLearner(center.tenant.id, "scaling");
  const definition = lmsCourse({ questions: 1 });
  const library = await saveQuestion(center.context, {
    question: definition.content.exam.questions[0],
  });
  const libraryAgain = await saveQuestion(
    center.context,
    { question: library.question, expectedVersion: 1 },
    library.question.id,
  );
  assert.equal(library.id, libraryAgain.id);
  definition.content.exam.questions = [library.question];
  const baseLesson = definition.content.modules[0].lessons[0];
  definition.content.modules[0].lessons = Array.from(
    { length: 201 },
    (_, i) => ({ ...baseLesson, id: `lesson-${i}`, required: i < 200 }),
  );
  const created = await createCourse(center.context, definition);
  const published = await publishVersion(center.context, created.version.id, {
    revision: 0,
  });
  const second = await createCourse(center.context, {
    content: { ...definition.content, titleRu: "Second course" },
    profile: definition.profile,
  });
  await publishVersion(center.context, second.version.id, { revision: 0 });
  const enrollment = await db.enrollment.create({
    data: {
      tenantId: center.tenant.id,
      courseVersionId: published.id,
      recipientId: learner.recipient.id,
      learnerUserId: learner.user.id,
      assignedBy: center.user.id,
      dueAt: new Date(Date.now() + 86400000),
    },
  });
  await db.lessonProgress.createMany({
    data: Array.from({ length: 199 }, (_, i) => ({
      tenantId: center.tenant.id,
      enrollmentId: enrollment.id,
      lessonId: `lesson-${i}`,
      completedAt: new Date(),
    })),
  });
  const blocked = await enrollmentDetail(learner.context, enrollment.id);
  assert.equal(blocked.progressPercent, 100);
  assert.equal(blocked.examReadiness.ready, false);
  await assert.rejects(
    startAttempt(learner.context, enrollment.id),
    (error: unknown) =>
      (error as { getResponse(): { code: string } }).getResponse().code ===
      "LESSONS_REQUIRED",
  );
  assert.equal(
    await db.examAttempt.count({ where: { enrollmentId: enrollment.id } }),
    0,
  );
  await db.lessonProgress.create({
    data: {
      tenantId: center.tenant.id,
      enrollmentId: enrollment.id,
      lessonId: "lesson-199",
      completedAt: new Date(),
    },
  });
  const attempt = await startAttempt(learner.context, enrollment.id);
  assert.equal("correctOptionIds" in attempt.questions[0], false);
  assert.equal("explanationRu" in attempt.questions[0], false);
  const pinnedAttempt = await db.examAttempt.findUniqueOrThrow({
    where: { id: attempt.id },
  });
  const revised = await saveQuestion(
    center.context,
    {
      question: {
        ...library.question,
        promptRu: "Human revised synthetic question",
        correctOptionIds: ["b"],
        explanationRu: "Synthetic explanation",
      },
      expectedVersion: 1,
    },
    library.question.id,
  );
  assert.equal(revised.version, 2);
  assert.equal(
    (await questionRevisions(center.context, library.question.id)).revisions
      .length,
    2,
  );
  assert.equal((await listQuestions(foreign.context, {})).total, 0);
  await assert.rejects(listQuestions(learner.context, {}));
  await assert.rejects(questionRevisions(foreign.context, library.question.id));
  const draft = await cloneVersion(center.context, created.course.id);
  const broken = structuredClone(draft.content);
  broken.modules[0].titleKz = "";
  broken.exam.questions[0] = {
    ...broken.exam.questions[0],
    options: [],
    correctOptionIds: [],
  };
  const saved = await updateVersion(center.context, draft.id, {
    revision: 0,
    content: broken,
    profile: draft.profile,
  });
  await assert.rejects(
    publishVersion(center.context, draft.id, { revision: saved.revision }),
  );
  const repaired = structuredClone(saved.content);
  repaired.modules[0].titleKz = "Модуль";
  repaired.exam.questions = [revised.question];
  const repairedVersion = await updateVersion(center.context, draft.id, {
    revision: saved.revision,
    content: repaired,
    profile: definition.profile,
  });
  const republished = await publishVersion(center.context, draft.id, {
    revision: repairedVersion.revision,
  });
  assert.equal(republished.content.exam.questions[0].version, 2);
  assert.deepEqual(
    (await db.examAttempt.findUniqueOrThrow({ where: { id: attempt.id } }))
      .snapshot,
    pinnedAttempt.snapshot,
  );
  assert.deepEqual(
    courseContentSchema.parse(
      (
        await db.courseVersion.findUniqueOrThrow({
          where: { id: second.version.id },
        })
      ).content,
    ).exam.questions[0].correctOptionIds,
    ["a"],
  );
  await saveAnswers(learner.context, attempt.id, {
    sequence: 1,
    answers: { [attempt.questions[0].id]: ["a"] },
  });
  const finished = await submitAttempt(learner.context, attempt.id);
  assert.equal(finished.result?.verdict, "PASSED");
  assert.equal(finished.result?.eligible, true);
  await setRegulatoryReview(center.context, created.course.id, {
    status: "CHANGED",
    note: "Manual synthetic review",
  });
  const listed = await listCourses(center.context, {
    pageSize: 1,
    search: "Синтетическая",
  });
  assert.equal(listed.total, 1);
  assert.equal(
    (listed.items[0].currentReview as { status: string }).status,
    "CHANGED",
  );
  assert.equal(
    "modules" in
      (listed.items[0].latestVersion as { content: Record<string, unknown> })
        .content,
    false,
  );
});
