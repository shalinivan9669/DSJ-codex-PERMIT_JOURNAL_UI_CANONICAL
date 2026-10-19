import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  db,
  hash,
  json,
  transaction,
  type Context,
} from "../../apps/api/src/core";
import {
  courseContentSchema,
  type CourseContent,
  type LmsQuestion,
  type LearningAnswers,
  type RegulatoryProfile,
} from "../../packages/contracts/src/lms";
import { lmsTenant, lmsLearner, lmsCourse } from "./lms-fixture";
import {
  startAttempt,
  saveAnswers,
  submitAttempt,
  finishAttempt,
  getAttempt,
} from "../../apps/api/src/lms/exams";
import { listAssessments } from "../../apps/api/src/lms/assessments";
import { listEnrollmentPage } from "../../apps/api/src/lms/enrollment-list";
import {
  saveSubmission,
  submitSubmission,
  submissionView,
  authorizedSubmissionAttachment,
  uploadSubmissionAttachment,
} from "../../apps/api/src/lms/submissions";
import {
  listReviews,
  reviewDetail,
  decideReview,
} from "../../apps/api/src/lms/manual-review";
import { finalizeLmsResult } from "../../apps/api/src/lms/result-finalization";
import { lmsStore, openPrivateStream } from "../../apps/api/src/lms/materials";
import {
  saveQuestion,
  listQuestions,
  questionRevisions,
  normalizeCourseQuestions,
} from "../../apps/api/src/lms/questions";
import { questionSemanticHash } from "../../apps/api/src/lms/question-semantics";

const code = (wanted: string) => (error: unknown) =>
  (error as { getResponse?: () => { code?: string } }).getResponse?.().code ===
  wanted;
const decisionInput = (
  detail: { revision: number; contentHash: string },
  decision: string,
  extra = {},
) => ({
  decisionKey: randomUUID(),
  revision: detail.revision,
  contentHash: detail.contentHash,
  decision,
  feedback: "Проверено по критериям",
  ...extra,
});
function typedQuestions() {
  const base = lmsCourse({ questions: 1 }).content.exam.questions[0];
  const q = (
    id: string,
    answerSpec: LmsQuestion["answerSpec"],
  ): LmsQuestion => ({ ...base, id, answerSpec, correctOptionIds: [] });
  return [
    q("single", { kind: "SINGLE", correctOptionIds: ["a"] }),
    q("multiple", { kind: "MULTIPLE", correctOptionIds: ["a", "b"] }),
    q("matching", {
      kind: "MATCHING",
      rightOptions: [
        { id: "x", textRu: "X", textKz: "X" },
        { id: "y", textRu: "Y", textKz: "Y" },
      ],
      pairs: [
        { leftId: "a", rightId: "y" },
        { leftId: "b", rightId: "x" },
      ],
    }),
    q("ordering", { kind: "ORDERING", correctOrderIds: ["b", "a"] }),
    q("text", {
      kind: "TEXT",
      mode: "EXACT",
      acceptedAnswers: ["Безопасно"],
      caseSensitive: false,
      collapseWhitespace: true,
    }),
    q("case", {
      kind: "CASE",
      contextRu: "Опишите действия",
      contextKz: "Әрекеттерді сипаттаңыз",
      response: {
        kind: "TEXT",
        mode: "MANUAL",
        criteriaRu: "Названы два действия",
        criteriaKz: "Екі әрекет көрсетілген",
      },
    }),
  ];
}
const correct: LearningAnswers = {
  single: { kind: "SINGLE", optionIds: ["a"] },
  multiple: { kind: "MULTIPLE", optionIds: ["b", "a"] },
  matching: {
    kind: "MATCHING",
    pairs: [
      { leftId: "b", rightId: "x" },
      { leftId: "a", rightId: "y" },
    ],
  },
  ordering: { kind: "ORDERING", optionIds: ["b", "a"] },
  text: { kind: "TEXT", text: " безопасно " },
  case: { kind: "TEXT", text: "Остановить работу, устранить опасность" },
};

/** Isolated service fixture deliberately pins published snapshots; author workflow has its own suite. */
async function pinned(
  c: Context,
  content: CourseContent,
  learner: Awaited<ReturnType<typeof lmsLearner>>,
  kind: "CENTER_EXAM" | "PRACTICE" = "CENTER_EXAM",
  sanitary = false,
  profileOverrides: Partial<RegulatoryProfile> = {},
) {
  const profile = {
    ...lmsCourse({ kind, sanitary }).profile,
    ...profileOverrides,
  };
  const course = await db.course.create({
    data: {
      tenantId: c.tenantId,
      titleRu: content.titleRu,
      titleKz: content.titleKz,
      createdBy: c.userId,
    },
  });
  const policy = await db.regulatoryProfileVersion.create({
    data: {
      tenantId: c.tenantId,
      courseId: course.id,
      version: 1,
      status: profile.status,
      definition: json(profile),
      snapshotHash: hash(profile),
    },
  });
  const version = await db.courseVersion.create({
    data: {
      tenantId: c.tenantId,
      courseId: course.id,
      version: 1,
      status: "PUBLISHED",
      content: json(content),
      regulatoryProfileVersionId: policy.id,
      snapshotHash: hash(content),
      publishedAt: new Date(),
      createdBy: c.userId,
    },
  });
  const enrollment = await db.enrollment.create({
    data: {
      tenantId: c.tenantId,
      courseVersionId: version.id,
      recipientId: learner.recipient.id,
      learnerUserId: learner.user.id,
      assignedBy: c.userId,
      dueAt: new Date(Date.now() + 86400000),
    },
  });
  return { course, policy, version, enrollment };
}

test("P03/P04: six types, intermediate isolation, immutable resubmissions, scoped concurrent review and nonofficial final", async (t) => {
  t.after(() => db.$disconnect());
  process.env.DEMO_LMS_TEST_RUNTIME = "1";
  const center = await lmsTenant("learning-assessments");
  const learner = await lmsLearner(center.tenant.id, "learner");
  const other = await lmsLearner(center.tenant.id, "other");
  const foreign = await lmsTenant("learning-assessments-foreign");
  const teacher = await db.user.create({
    data: {
      tenantId: center.tenant.id,
      email: `${randomUUID()}@example.test`,
      displayName: "Teacher",
      role: "TEACHER",
      passwordHash: "fixture",
    },
  });
  const reviewer = { ...center.context, role: "TEACHER", userId: teacher.id };
  const definition = lmsCourse({ questions: 1, required: false });
  const final = { ...typedQuestions()[5], id: "final-case" };
  const content = courseContentSchema.parse({
    ...definition.content,
    learningOutcome: "LEARNING",
    modules: [
      {
        ...definition.content.modules[0],
        lessons: [
          {
            id: "check",
            kind: "ASSESSMENT",
            titleRu: "Проверка",
            titleKz: "Тексеру",
            required: true,
            assessment: {
              ...definition.content.exam,
              questions: typedQuestions(),
              questionCount: 6,
              maxAttempts: 2,
            },
          },
          {
            id: "work",
            kind: "ASSIGNMENT",
            titleRu: "Практика",
            titleKz: "Тәжірибе",
            required: true,
            prerequisiteLessonIds: ["check"],
            assignment: {
              instructionsRu: "Решите задачу",
              instructionsKz: "Тапсырманы орындаңыз",
              criteriaRu: "Два действия",
              criteriaKz: "Екі әрекет",
              allowText: true,
              allowFiles: true,
              maxSubmissions: 3,
            },
          },
        ],
      },
    ],
    exam: { ...definition.content.exam, questions: [final], questionCount: 1 },
  });
  const fixture = await pinned(center.context, content, learner);
  const binding = await db.lmsTeachingBinding.create({
    data: {
      tenantId: center.tenant.id,
      courseId: fixture.course.id,
      userId: teacher.id,
      role: "TEACHER",
      permissions: ["READ", "REVIEW"],
      createdBy: center.user.id,
    },
  });
  await assert.rejects(
    startAttempt(learner.context, fixture.enrollment.id),
    code("LESSONS_REQUIRED"),
  );
  await assert.rejects(
    saveSubmission(learner.context, fixture.enrollment.id, "work", {
      sequence: 1,
      text: "early",
      attachmentIds: [],
    }),
    code("LESSON_UNAVAILABLE"),
  );
  const attempt = await startAttempt(
    learner.context,
    fixture.enrollment.id,
    "check",
  );
  assert.equal(
    (await startAttempt(learner.context, fixture.enrollment.id, "check")).id,
    attempt.id,
  );
  assert.equal(attempt.purpose, "INTERMEDIATE");
  assert.equal(attempt.ordinal, 1);
  assert.doesNotMatch(
    JSON.stringify(attempt.questions),
    /correctOptionIds|correctOrderIds|acceptedAnswers|"pairs"/,
  );
  await assert.rejects(
    saveAnswers(other.context, attempt.id, { sequence: 1, answers: correct }),
  );
  await assert.rejects(
    saveAnswers(learner.context, attempt.id, {
      sequence: 1,
      answers: { single: { kind: "SINGLE", optionIds: ["foreign"] } },
    }),
    code("ANSWERS_INVALID"),
  );
  await saveAnswers(learner.context, attempt.id, {
    sequence: 1,
    answers: correct,
  });
  await assert.rejects(
    saveAnswers(learner.context, attempt.id, { sequence: 1, answers: {} }),
    code("ANSWER_CONFLICT"),
  );
  const stale = await saveAnswers(learner.context, attempt.id, {
    sequence: 0,
    answers: {},
  });
  assert.equal(stale.sequence, 1);
  assert.deepEqual(stale.answers, correct);
  await db.$disconnect();
  const resumed = await getAttempt(learner.context, attempt.id);
  assert.equal(resumed.sequence, 1);
  assert.deepEqual(resumed.answers, correct);
  assert.equal(resumed.id, attempt.id);
  const waiting = await submitAttempt(learner.context, attempt.id);
  assert.equal(waiting.state, "AWAITING_REVIEW");
  assert.equal(waiting.result, null);
  assert.equal(
    (await startAttempt(learner.context, fixture.enrollment.id, "check")).id,
    attempt.id,
  );
  assert.equal(
    (await listAssessments(learner.context, fixture.enrollment.id)).items[0]
      .canStart,
    false,
  );
  assert.equal(
    await db.verifiedExamResult.count({
      where: { enrollmentId: fixture.enrollment.id },
    }),
    0,
  );
  assert.equal((await listReviews(reviewer, {})).total, 1);
  assert.equal((await listReviews(foreign.context, {})).total, 0);
  await assert.rejects(reviewDetail(foreign.context, "ATTEMPT", attempt.id));
  // A promoted account retains its learner identity; staff permission must not allow self-review.
  await assert.rejects(
    reviewDetail(
      { ...learner.context, role: "DIRECTOR" },
      "ATTEMPT",
      attempt.id,
    ),
    code("SELF_REVIEW_FORBIDDEN"),
  );
  const detail = await reviewDetail(reviewer, "ATTEMPT", attempt.id);
  await assert.rejects(
    decideReview(
      reviewer,
      "ATTEMPT",
      attempt.id,
      decisionInput(detail, "GRADE", { questionScores: {} }),
    ),
    code("MANUAL_SCORES_REQUIRED"),
  );
  await db.lmsTeachingBinding.update({
    where: { id: binding.id },
    data: { revokedAt: new Date(), revokedBy: center.user.id },
  });
  await assert.rejects(
    decideReview(
      reviewer,
      "ATTEMPT",
      attempt.id,
      decisionInput(detail, "GRADE", { questionScores: { case: 1 } }),
    ),
  );
  await db.lmsTeachingBinding.update({
    where: { id: binding.id },
    data: { revokedAt: null, revokedBy: null },
  });
  const decisions = await Promise.allSettled(
    [1, 2].map(() =>
      decideReview(
        reviewer,
        "ATTEMPT",
        attempt.id,
        decisionInput(detail, "GRADE", { questionScores: { case: 1 } }),
      ),
    ),
  );
  assert.equal(
    decisions.filter((item) => item.status === "fulfilled").length,
    1,
  );
  assert.equal(
    (await getAttempt(learner.context, attempt.id)).verdict,
    "PASSED",
  );
  assert.equal(
    (await listEnrollmentPage(learner.context, { pageSize: 100 })).items.find(
      (item) => item.id === fixture.enrollment.id,
    )?.progressPercent,
    50,
    "Paginated progress includes the completed intermediate assessment",
  );
  assert.equal(
    await db.verifiedExamResult.count({
      where: { enrollmentId: fixture.enrollment.id },
    }),
    0,
  );
  await assert.rejects(
    db.examAttempt.update({ where: { id: attempt.id }, data: { answers: {} } }),
  );
  const draft = await saveSubmission(
    learner.context,
    fixture.enrollment.id,
    "work",
    { sequence: 1, text: "Первый ответ", attachmentIds: [] },
  );
  await assert.rejects(
    saveSubmission(learner.context, fixture.enrollment.id, "work", {
      sequence: 1,
      text: "Другой ответ",
      attachmentIds: [],
    }),
    code("SUBMISSION_CONFLICT"),
  );
  const sent = await submitSubmission(
    learner.context,
    fixture.enrollment.id,
    "work",
    { sequence: draft.sequence },
  );
  assert.equal(sent.status, "SUBMITTED");
  const original = await db.lmsSubmissionRevision.findFirstOrThrow({
    where: { submissionId: sent.id! },
  });
  await assert.rejects(
    db.lmsSubmissionRevision.update({
      where: { id: original.id },
      data: { content: {} },
    }),
  );
  const workReview = await reviewDetail(reviewer, "SUBMISSION", sent.id!);
  await assert.rejects(
    decideReview(reviewer, "SUBMISSION", sent.id!, {
      ...decisionInput(workReview, "RETURNED"),
      feedback: "",
    }),
    code("REVIEW_FEEDBACK_REQUIRED"),
  );
  const returnedInput = decisionInput(workReview, "RETURNED");
  await decideReview(reviewer, "SUBMISSION", sent.id!, returnedInput);
  await decideReview(reviewer, "SUBMISSION", sent.id!, returnedInput);
  const revised = await saveSubmission(
    learner.context,
    fixture.enrollment.id,
    "work",
    {
      sequence: 2,
      text: "Исправленный ответ: остановить, устранить",
      attachmentIds: [],
    },
  );
  await submitSubmission(learner.context, fixture.enrollment.id, "work", {
    sequence: revised.sequence,
  });
  await assert.rejects(
    decideReview(
      reviewer,
      "SUBMISSION",
      sent.id!,
      decisionInput(workReview, "ACCEPTED"),
    ),
    code("REVIEW_CONFLICT"),
  );
  const latest = await reviewDetail(reviewer, "SUBMISSION", sent.id!);
  await decideReview(
    reviewer,
    "SUBMISSION",
    sent.id!,
    decisionInput(latest, "ACCEPTED"),
  );
  const accepted = await submissionView(
    learner.context,
    fixture.enrollment.id,
    "work",
  );
  assert.equal(accepted.history.length, 2);
  assert.equal(accepted.history[1].text, "Первый ответ");
  assert.equal(accepted.status, "ACCEPTED");
  assert.equal(
    (await listEnrollmentPage(learner.context, { pageSize: 100 })).items.find(
      (item) => item.id === fixture.enrollment.id,
    )?.progressPercent,
    100,
    "Paginated progress includes the accepted assignment revision",
  );
  assert.equal(
    (
      await db.lmsSubmissionRevision.findUniqueOrThrow({
        where: { id: original.id },
      })
    ).hash,
    original.hash,
  );
  const finalAttempt = await startAttempt(
    learner.context,
    fixture.enrollment.id,
  );
  assert.equal(finalAttempt.ordinal, 1);
  assert.equal(finalAttempt.purpose, "LEARNING_FINAL");
  await saveAnswers(learner.context, finalAttempt.id, {
    sequence: 1,
    answers: { "final-case": correct.case },
  });
  await submitAttempt(learner.context, finalAttempt.id);
  await db.enrollment.update({
    where: { id: fixture.enrollment.id },
    data: { dueAt: new Date(Date.now() - 1000) },
  });
  const finalDetail = await reviewDetail(reviewer, "ATTEMPT", finalAttempt.id);
  await decideReview(
    reviewer,
    "ATTEMPT",
    finalAttempt.id,
    decisionInput(finalDetail, "GRADE", {
      questionScores: { "final-case": 1 },
    }),
  );
  assert.equal(
    (await getAttempt(learner.context, finalAttempt.id)).verdict,
    "PASSED",
  );
  assert.equal(
    await db.verifiedExamResult.count({
      where: { enrollmentId: fixture.enrollment.id },
    }),
    0,
  );
  assert.equal(
    await db.lmsLearningCompletion.count({
      where: { enrollmentId: fixture.enrollment.id },
    }),
    1,
  );
  assert.equal(
    (
      await db.enrollment.findUniqueOrThrow({
        where: { id: fixture.enrollment.id },
      })
    ).status,
    "COMPLETED",
  );
  assert.equal(
    await db.regulatoryOutbox.count({ where: { tenantId: center.tenant.id } }),
    0,
  );
  await assert.rejects(
    transaction((tx) =>
      finalizeLmsResult(tx, center.context, {
        enrollmentId: fixture.enrollment.id,
        attemptId: finalAttempt.id,
        assessmentKind: "CENTER_EXAM",
        verdict: "PASSED",
        score: 1,
        maximum: 1,
        examAt: new Date(),
      }),
    ),
    code("ATTEMPT_NOT_FINAL"),
  );
  await assert.rejects(
    authorizedSubmissionAttachment(foreign.context, randomUUID()),
  );
});

test("P03: regulated manual final pins V1, timeout requires review and duplicate decision creates one official result", async (t) => {
  t.after(() => db.$disconnect());
  process.env.DEMO_LMS_TEST_RUNTIME = "1";
  const center = await lmsTenant("learning-final-manual");
  const learner = await lmsLearner(center.tenant.id, "manual");
  const definition = lmsCourse({ questions: 1, required: false });
  const content = courseContentSchema.parse({
    ...definition.content,
    exam: {
      ...definition.content.exam,
      questions: [{ ...typedQuestions()[5], id: "case" }],
    },
  });
  const fixture = await pinned(
    center.context,
    content,
    learner,
    "CENTER_EXAM",
    true,
  );
  const view = await startAttempt(learner.context, fixture.enrollment.id);
  await saveAnswers(learner.context, view.id, {
    sequence: 1,
    answers: { case: correct.case },
  });
  const attempt = await db.examAttempt.findUniqueOrThrow({
    where: { id: view.id },
  });
  await transaction((tx) =>
    finishAttempt(
      tx,
      learner.context,
      attempt,
      new Date(attempt.deadlineAt.getTime() + 1),
    ),
  );
  assert.equal(
    (await getAttempt(learner.context, view.id)).state,
    "AWAITING_REVIEW",
  );
  assert.equal(
    await db.verifiedExamResult.count({
      where: { enrollmentId: fixture.enrollment.id },
    }),
    0,
  );
  const changed = structuredClone(content);
  changed.exam.questions[0].promptRu = "Новая редакция";
  await db.courseVersion.create({
    data: {
      tenantId: center.tenant.id,
      courseId: fixture.course.id,
      version: 2,
      status: "PUBLISHED",
      content: json(changed),
      regulatoryProfileVersionId: fixture.policy.id,
      snapshotHash: hash(changed),
      publishedAt: new Date(),
      createdBy: center.user.id,
    },
  });
  await db.enrollment.update({
    where: { id: fixture.enrollment.id },
    data: { dueAt: new Date(Date.now() - 1000) },
  });
  const detail = await reviewDetail(center.context, "ATTEMPT", view.id);
  const input = decisionInput(detail, "GRADE", { questionScores: { case: 1 } });
  await decideReview(center.context, "ATTEMPT", view.id, input);
  await decideReview(center.context, "ATTEMPT", view.id, input);
  const final = await db.examAttempt.findUniqueOrThrow({
    where: { id: view.id },
  });
  assert.equal(hash(final.snapshot), hash(attempt.snapshot));
  assert.equal(final.finishedAt?.getTime(), attempt.deadlineAt.getTime());
  const result = await db.verifiedExamResult.findFirstOrThrow({
    where: { attemptId: view.id },
  });
  assert.equal(result.courseVersionId, fixture.version.id);
  assert.equal(result.eligible, true);
  assert.equal(
    await db.verifiedExamResult.count({ where: { attemptId: view.id } }),
    1,
  );
  assert.equal(
    await db.regulatoryOutbox.count({ where: { resultId: result.id } }),
    1,
  );
  await assert.rejects(
    db.examAttempt.update({ where: { id: view.id }, data: { score: 0 } }),
  );
});

test("P04 regulated practice requires explicitly permitted reviewed assignments and pins their immutable decisions", async (t) => {
  t.after(() => db.$disconnect());
  process.env.DEMO_LMS_TEST_RUNTIME = "1";
  const center = await lmsTenant("learning-regulated-practice");
  const learner = await lmsLearner(center.tenant.id, "reviewed-practice");
  const definition = lmsCourse({ questions: 1, required: false });
  const content = courseContentSchema.parse({
    ...definition.content,
    modules: [
      {
        id: "practice",
        titleRu: "Практика",
        titleKz: "Тәжірибе",
        lessons: ["work-a", "work-b"].map((id) => ({
          id,
          kind: "ASSIGNMENT",
          titleRu: id,
          titleKz: id,
          required: true,
          assignment: {
            instructionsRu: "Объясните решение",
            instructionsKz: "Шешімді түсіндіріңіз",
            criteriaRu: "Есть основание",
            criteriaKz: "Негіз бар",
            allowText: true,
            allowFiles: false,
            maxSubmissions: 2,
          },
        })),
      },
    ],
  });
  const online = {
    requiresPractice: true,
    practiceEvidenceMode: "REVIEWED_ASSIGNMENTS" as const,
  };
  const fixture = await pinned(
    center.context,
    content,
    learner,
    "CENTER_EXAM",
    true,
    online,
  );
  await assert.rejects(
    startAttempt(learner.context, fixture.enrollment.id),
    code("LESSONS_REQUIRED"),
  );
  const acceptWork = async (enrollmentId: string, elementId: string) => {
    await saveSubmission(learner.context, enrollmentId, elementId, {
      sequence: 1,
      text: "Проверяемое решение",
      attachmentIds: [],
    });
    const sent = await submitSubmission(
      learner.context,
      enrollmentId,
      elementId,
      { sequence: 1 },
    );
    const detail = await reviewDetail(center.context, "SUBMISSION", sent.id!);
    return decideReview(
      center.context,
      "SUBMISSION",
      sent.id!,
      decisionInput(detail, "ACCEPTED"),
    );
  };
  await acceptWork(fixture.enrollment.id, "work-a");
  await assert.rejects(
    startAttempt(learner.context, fixture.enrollment.id),
    code("LESSONS_REQUIRED"),
  );
  await saveSubmission(learner.context, fixture.enrollment.id, "work-b", {
    sequence: 1,
    text: "Ожидает проверки",
    attachmentIds: [],
  });
  const pending = await submitSubmission(
    learner.context,
    fixture.enrollment.id,
    "work-b",
    { sequence: 1 },
  );
  await assert.rejects(
    startAttempt(learner.context, fixture.enrollment.id),
    code("LESSONS_REQUIRED"),
  );
  const pendingDetail = await reviewDetail(
    center.context,
    "SUBMISSION",
    pending.id!,
  );
  await decideReview(
    center.context,
    "SUBMISSION",
    pending.id!,
    decisionInput(pendingDetail, "ACCEPTED"),
  );
  const attempt = await startAttempt(learner.context, fixture.enrollment.id);
  await saveAnswers(learner.context, attempt.id, {
    sequence: 1,
    answers: { [attempt.questions[0].id]: ["a"] },
  });
  const finished = await submitAttempt(learner.context, attempt.id);
  assert.equal(finished.result?.eligible, true);
  const result = await db.verifiedExamResult.findFirstOrThrow({
    where: { attemptId: attempt.id },
  });
  const snapshot = result.snapshot as {
    practiceRequirement: {
      satisfied: boolean;
      mode: string;
      requiredElementIds: string[];
      evidence: {
        elementId: string;
        submissionRevisionId: string;
        decisionId: string;
        contentHash: string;
        reviewedBy: string;
      }[];
    };
  };
  assert.equal(snapshot.practiceRequirement.satisfied, true);
  assert.equal(snapshot.practiceRequirement.mode, "REVIEWED_ASSIGNMENTS");
  assert.deepEqual(snapshot.practiceRequirement.requiredElementIds, [
    "work-a",
    "work-b",
  ]);
  assert.equal(snapshot.practiceRequirement.evidence.length, 2);
  for (const evidence of snapshot.practiceRequirement.evidence) {
    const decision = await db.lmsReviewDecision.findUniqueOrThrow({
      where: { id: evidence.decisionId },
    });
    const revision = await db.lmsSubmissionRevision.findUniqueOrThrow({
      where: { id: evidence.submissionRevisionId },
    });
    assert.equal(decision.decision, "ACCEPTED");
    assert.equal(decision.contentHash, revision.hash);
    assert.equal(evidence.contentHash, revision.hash);
    assert.equal(evidence.reviewedBy, center.user.id);
  }
  assert.equal(
    await db.regulatoryOutbox.count({ where: { resultId: result.id } }),
    1,
  );
  const variants: {
    name: string;
    profile: Partial<RegulatoryProfile>;
    content: CourseContent;
    accept: boolean;
  }[] = [
    {
      name: "old missing practice mode",
      profile: { requiresPractice: true },
      content,
      accept: true,
    },
    {
      name: "explicit unspecified mode",
      profile: { requiresPractice: true, practiceEvidenceMode: "UNSPECIFIED" },
      content,
      accept: true,
    },
    {
      name: "in-person evidence",
      profile: { requiresPractice: true, practiceEvidenceMode: "IN_PERSON" },
      content,
      accept: true,
    },
    {
      name: "unconnected proctoring",
      profile: { ...online, requiresProctoring: true },
      content,
      accept: true,
    },
    {
      name: "no assignment",
      profile: online,
      content: definition.content,
      accept: false,
    },
    {
      name: "only optional assignments",
      profile: online,
      content: courseContentSchema.parse({
        ...content,
        modules: content.modules.map((module) => ({
          ...module,
          lessons: module.lessons.map((lesson) => ({
            ...lesson,
            required: false,
          })),
        })),
      }),
      accept: true,
    },
    {
      name: "in-person course format",
      profile: online,
      content: courseContentSchema.parse({
        ...content,
        metadata: {
          goalRu: "",
          goalKz: "",
          audienceRu: "",
          audienceKz: "",
          format: "IN_PERSON",
          documentValidity: "",
          trainingRecurrence: "",
          parameterSource: "",
        },
      }),
      accept: true,
    },
  ];
  for (const variant of variants) {
    const denied = await pinned(
      center.context,
      variant.content,
      learner,
      "CENTER_EXAM",
      true,
      variant.profile,
    );
    if (variant.accept)
      for (const lesson of variant.content.modules.flatMap(
        (module) => module.lessons,
      ))
        if (lesson.kind === "ASSIGNMENT")
          await acceptWork(denied.enrollment.id, lesson.id);
    await assert.rejects(
      startAttempt(learner.context, denied.enrollment.id),
      code("ASSESSMENT_REQUIREMENT"),
      variant.name,
    );
    assert.equal(
      await db.examAttempt.count({
        where: { enrollmentId: denied.enrollment.id },
      }),
      0,
      variant.name,
    );
    // Finalization independently rechecks the gate even for a seeded, otherwise valid finished attempt.
    const at = new Date();
    const frozenProfile = {
      ...lmsCourse({ sanitary: true }).profile,
      ...variant.profile,
    };
    const seeded = await db.examAttempt.create({
      data: {
        tenantId: center.tenant.id,
        enrollmentId: denied.enrollment.id,
        courseVersionId: denied.version.id,
        regulatoryProfileVersionId: denied.policy.id,
        assessmentKind: "CENTER_EXAM",
        assessmentId: "FINAL",
        purpose: "FINAL",
        ordinal: 1,
        state: "FINISHED",
        startedAt: at,
        deadlineAt: new Date(at.getTime() + 1800000),
        submittedAt: at,
        gradedAt: at,
        finishedAt: at,
        score: 1,
        maximum: 1,
        verdict: "PASSED",
        answers: json({ [variant.content.exam.questions[0].id]: ["a"] }),
        snapshot: json({
          questions: variant.content.exam.questions,
          policy: { ...variant.content.exam, questions: [] },
          profile: frozenProfile,
        }),
      },
    });
    const prevented = await transaction((tx) =>
      finalizeLmsResult(tx, center.context, {
        enrollmentId: denied.enrollment.id,
        attemptId: seeded.id,
        assessmentKind: "CENTER_EXAM",
        verdict: "PASSED",
        score: 1,
        maximum: 1,
        examAt: at,
      }),
    );
    assert.equal(prevented.eligible, false, variant.name);
    assert.equal(
      await db.regulatoryOutbox.count({ where: { resultId: prevented.id } }),
      0,
      variant.name,
    );
  }
});

test("P03 compatibility: legacy choice final and PRACTICE retain their existing result semantics", async (t) => {
  t.after(() => db.$disconnect());
  process.env.DEMO_LMS_TEST_RUNTIME = "1";
  const center = await lmsTenant("learning-legacy");
  const learner = await lmsLearner(center.tenant.id, "legacy");
  for (const kind of ["CENTER_EXAM", "PRACTICE"] as const) {
    const definition = lmsCourse({ questions: 1, required: false, kind });
    const fixture = await pinned(
      center.context,
      definition.content,
      learner,
      kind,
    );
    const attempt = await startAttempt(learner.context, fixture.enrollment.id);
    await saveAnswers(learner.context, attempt.id, {
      sequence: 1,
      answers: { [attempt.questions[0].id]: ["a"] },
    });
    const finished = await submitAttempt(learner.context, attempt.id);
    assert.equal(finished.state, "FINISHED");
    assert.equal(finished.result?.verdict, "PASSED");
    assert.equal(finished.result?.eligible, kind === "CENTER_EXAM");
    assert.equal(
      await db.lmsLearningCompletion.count({
        where: { enrollmentId: fixture.enrollment.id },
      }),
      kind === "CENTER_EXAM" ? 1 : 0,
    );
  }
});

test("P04 private attachments validate bytes, exclude other owners and drafts, and cancellation stops new input", async (t) => {
  t.after(() => db.$disconnect());
  const center = await lmsTenant("learning-files");
  const learner = await lmsLearner(center.tenant.id, "files");
  const other = await lmsLearner(center.tenant.id, "files-other");
  const definition = lmsCourse({ questions: 1, required: false });
  const content = courseContentSchema.parse({
    ...definition.content,
    learningOutcome: "LEARNING",
    modules: [
      {
        ...definition.content.modules[0],
        lessons: [
          {
            id: "work",
            kind: "ASSIGNMENT",
            titleRu: "Файл",
            titleKz: "Файл",
            required: false,
            assignment: {
              instructionsRu: "Файл",
              instructionsKz: "Файл",
              criteriaRu: "Читается",
              criteriaKz: "Оқылады",
              allowText: true,
              allowFiles: true,
              maxSubmissions: 2,
            },
          },
        ],
      },
    ],
  });
  const fixture = await pinned(center.context, content, learner);
  const makeFile = async (bytes: string, mime = "application/pdf") => {
    const dir = join(lmsStore.root, "test-uploads");
    await mkdir(dir, { recursive: true });
    const path = join(dir, randomUUID());
    await writeFile(path, bytes);
    return {
      path,
      size: Buffer.byteLength(bytes),
      originalname: "synthetic.pdf",
      mimetype: mime,
    } as Express.Multer.File;
  };
  await assert.rejects(
    uploadSubmissionAttachment(
      learner.context,
      fixture.enrollment.id,
      "work",
      await makeFile("not pdf"),
    ),
    code("MATERIAL_SIGNATURE"),
  );
  await assert.rejects(
    uploadSubmissionAttachment(
      learner.context,
      fixture.enrollment.id,
      "work",
      await makeFile("%PDF-1.4", "application/zip"),
    ),
    code("MATERIAL_TYPE"),
  );
  const file = await uploadSubmissionAttachment(
    learner.context,
    fixture.enrollment.id,
    "work",
    await makeFile(
      "%PDF-1.4\nsynthetic signature-only attachment fixture\n%%EOF",
    ),
  );
  const record = await authorizedSubmissionAttachment(learner.context, file.id);
  const opened = await openPrivateStream(record, "bytes=0-4");
  assert.equal(opened.invalid, false);
  if (!opened.invalid) {
    assert.equal(opened.partial, true);
    const chunks = [];
    for await (const part of opened.stream) chunks.push(part);
    assert.equal(Buffer.concat(chunks).toString(), "%PDF-");
  }
  await assert.rejects(authorizedSubmissionAttachment(other.context, file.id));
  await assert.rejects(
    authorizedSubmissionAttachment(center.context, file.id),
    code("NOT_FOUND"),
  );
  const foreignFile = await db.lmsSubmissionAttachment.create({
    data: {
      tenantId: center.tenant.id,
      enrollmentId: fixture.enrollment.id,
      elementId: "work",
      storageKey: "objects/synthetic-not-read",
      sha256: "a".repeat(64),
      size: 1,
      mimeType: "application/pdf",
      originalName: "other.pdf",
      uploadedBy: other.user.id,
    },
  });
  await assert.rejects(
    saveSubmission(learner.context, fixture.enrollment.id, "work", {
      sequence: 1,
      text: "",
      attachmentIds: [foreignFile.id],
    }),
    code("ATTACHMENTS_INVALID"),
  );
  await saveSubmission(learner.context, fixture.enrollment.id, "work", {
    sequence: 1,
    text: "Файл",
    attachmentIds: [file.id],
  });
  await submitSubmission(learner.context, fixture.enrollment.id, "work", {
    sequence: 1,
  });
  assert.equal(
    (await authorizedSubmissionAttachment(center.context, file.id)).id,
    file.id,
  );
  const attempt = await startAttempt(learner.context, fixture.enrollment.id);
  await db.enrollment.update({
    where: { id: fixture.enrollment.id },
    data: { status: "CANCELLED" },
  });
  await assert.rejects(
    saveAnswers(learner.context, attempt.id, { sequence: 1, answers: {} }),
    code("ACCESS_CANCELLED"),
  );
  await assert.rejects(
    submitAttempt(learner.context, attempt.id),
    code("ACCESS_CANCELLED"),
  );
  await assert.rejects(
    uploadSubmissionAttachment(
      learner.context,
      fixture.enrollment.id,
      "work",
      await makeFile("%PDF-1.4"),
    ),
    code("ACCESS_EXPIRED"),
  );
  assert.equal(
    (await submissionView(learner.context, fixture.enrollment.id, "work"))
      .history.length,
    1,
  );
  assert.equal(
    (await getAttempt(learner.context, attempt.id)).state,
    "IN_PROGRESS",
  );
  await writeFile(lmsStore.path(record.storageKey), "%PDF-corrupted");
  await assert.rejects(openPrivateStream(record), code("MATERIAL_UNAVAILABLE"));
});

test("P03 question bank scopes standalone/intermediate authoring and preserves pinned revision meaning", async (t) => {
  t.after(() => db.$disconnect());
  const center = await lmsTenant("learning-question-bank");
  const learner = await lmsLearner(center.tenant.id, "bank");
  const definition = lmsCourse({ questions: 1, required: false });
  const content = courseContentSchema.parse({
    ...definition.content,
    modules: [
      {
        ...definition.content.modules[0],
        lessons: [
          {
            id: "check",
            kind: "ASSESSMENT",
            titleRu: "Тест",
            titleKz: "Тест",
            required: false,
            assessment: {
              ...definition.content.exam,
              questions: [typedQuestions()[2]],
            },
          },
        ],
      },
    ],
  });
  const one = await pinned(center.context, content, learner);
  const two = await pinned(center.context, definition.content, learner);
  const user = await db.user.create({
    data: {
      tenantId: center.tenant.id,
      email: `${randomUUID()}@example.test`,
      displayName: "Methodist",
      role: "METHODIST",
      passwordHash: "fixture",
    },
  });
  const methodist = { ...center.context, userId: user.id, role: "METHODIST" };
  const binding = await db.lmsTeachingBinding.create({
    data: {
      tenantId: center.tenant.id,
      courseId: one.course.id,
      userId: user.id,
      role: "METHODIST",
      permissions: ["READ", "EDIT"],
      createdBy: center.user.id,
    },
  });
  const standalone = await saveQuestion(methodist, {
    question: typedQuestions()[4],
    originCourseId: one.course.id,
  });
  const embedded = await saveQuestion(methodist, {
    question: content.modules[0].lessons[0].assessment!.questions[0],
    originCourseId: one.course.id,
    originQuestionId: "matching",
  });
  const secret = await saveQuestion(center.context, {
    question: typedQuestions()[0],
    originCourseId: two.course.id,
  });
  const legacy = await saveQuestion(center.context, {
    question: definition.content.exam.questions[0],
  });
  assert.equal((await listQuestions(methodist, {})).total, 2);
  assert.equal(
    (await listQuestions(methodist, { courseId: two.course.id })).total,
    0,
  );
  assert.equal((await listQuestions(center.context, {})).total, 4);
  await assert.rejects(
    questionRevisions(methodist, secret.question.id),
    code("LEARNING_PERMISSION_DENIED"),
  );
  await assert.rejects(
    questionRevisions(methodist, legacy.question.id),
    code("LEARNING_PERMISSION_DENIED"),
  );
  await assert.rejects(
    saveQuestion(methodist, { question: typedQuestions()[4] }),
    code("LEARNING_PERMISSION_DENIED"),
  );
  await assert.rejects(
    saveQuestion(
      methodist,
      { question: secret.question, expectedVersion: 1 },
      secret.question.id,
    ),
    code("LEARNING_PERMISSION_DENIED"),
  );
  const references = structuredClone(content);
  references.modules[0].lessons[0].assessment!.questions = [embedded.question];
  const normalized = await transaction((tx) =>
    normalizeCourseQuestions(tx, methodist, one.course.id, references, content),
  );
  assert.equal(
    normalized.modules[0].lessons[0].assessment!.questions[0].libraryRevisionId,
    embedded.id,
  );
  const unauthorized = structuredClone(content);
  unauthorized.modules[0].lessons[0].assessment!.questions = [secret.question];
  await assert.rejects(
    transaction((tx) =>
      normalizeCourseQuestions(
        tx,
        methodist,
        one.course.id,
        unauthorized,
        content,
      ),
    ),
    code("LEARNING_PERMISSION_DENIED"),
  );
  const revised = await saveQuestion(
    methodist,
    {
      question: {
        ...standalone.question,
        answerSpec: {
          kind: "TEXT",
          mode: "EXACT",
          acceptedAnswers: ["Иначе"],
          caseSensitive: false,
          collapseWhitespace: true,
        },
      },
      expectedVersion: 1,
    },
    standalone.question.id,
  );
  assert.equal(revised.version, 2);
  const history = await questionRevisions(methodist, standalone.question.id);
  assert.equal(history.revisions.length, 2);
  assert.notEqual(
    questionSemanticHash(history.revisions[0].question),
    questionSemanticHash(history.revisions[1].question),
  );
  await db.lmsTeachingBinding.update({
    where: { id: binding.id },
    data: { permissions: ["READ", "PUBLISH"] },
  });
  // Persisted legacy grants remain capped by the current METHODIST role: PUBLISH is not EDIT.
  assert.equal((await listQuestions(methodist, {})).total, 0);
  await assert.rejects(
    questionRevisions(methodist, standalone.question.id),
    code("LEARNING_PERMISSION_DENIED"),
  );
  await assert.rejects(
    saveQuestion(
      methodist,
      { question: revised.question, expectedVersion: 2 },
      revised.question.id,
    ),
    code("LEARNING_PERMISSION_DENIED"),
  );
  await db.lmsTeachingBinding.update({
    where: { id: binding.id },
    data: { permissions: ["READ", "REVIEW"] },
  });
  assert.equal((await listQuestions(methodist, {})).total, 0);
  await assert.rejects(
    questionRevisions(methodist, standalone.question.id),
    code("LEARNING_PERMISSION_DENIED"),
  );
});
