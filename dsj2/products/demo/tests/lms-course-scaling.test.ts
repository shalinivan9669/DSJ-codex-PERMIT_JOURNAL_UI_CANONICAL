import test from "node:test";
import assert from "node:assert/strict";
import {
  courseContentSchema,
  lmsQuestionSchema,
} from "../packages/contracts/src/lms";
import { examReadiness } from "../apps/api/src/lms/readiness";
import {
  embeddedQuestionId,
  questionSemanticHash,
} from "../apps/api/src/lms/question-semantics";
import { normalizeCourseQuestions } from "../apps/api/src/lms/questions";
import type { Prisma } from "../packages/database/src/index";
import type { Context } from "../apps/api/src/core";

test("V1 exact readiness preserves the 199/200 boundary and ignores optional lessons", () => {
  const content = courseContentSchema.parse({
    titleRu: "Synthetic",
    titleKz: "Synthetic",
    modules: [
      {
        id: "m",
        titleRu: "M",
        titleKz: "M",
        lessons: Array.from({ length: 201 }, (_, i) => ({
          id: String(i),
          kind: "TEXT",
          required: i < 200,
        })),
      },
    ],
    exam: { questions: [], questionCount: 1 },
  });
  const progress = Array.from({ length: 199 }, (_, i) => ({
    lessonId: String(i),
    completedAt: new Date(),
  }));
  assert.equal(Math.round((199 / 200) * 100), 100);
  assert.deepEqual(examReadiness(content, progress), {
    ready: false,
    requiredCount: 200,
    completedCount: 199,
    missingLessonIds: ["199"],
    reasonCode: "LESSONS_REQUIRED",
  });
  progress.push({ lessonId: "199", completedAt: new Date() });
  assert.equal(examReadiness(content, progress).ready, true);
  assert.equal(
    examReadiness(content, [{ lessonId: "199", completedAt: null }])
      .completedCount,
    0,
  );
});

test("V1 semantic revisions ignore supplied identity/order and preserve distinct course identities", () => {
  const q = lmsQuestionSchema.parse({
    id: "client",
    version: 800,
    promptRu: "Synthetic",
    promptKz: "Synthetic",
    options: [
      { id: "a", textRu: "A", textKz: "A" },
      { id: "b", textRu: "B", textKz: "B" },
    ],
    correctOptionIds: ["a"],
  });
  assert.equal(
    questionSemanticHash(q),
    questionSemanticHash({
      ...q,
      id: "forged",
      version: 999,
      options: [...q.options].reverse(),
      libraryRevisionId: "other",
    }),
  );
  assert.notEqual(
    questionSemanticHash(q),
    questionSemanticHash({ ...q, correctOptionIds: ["b"] }),
  );
  assert.notEqual(
    questionSemanticHash(q),
    questionSemanticHash({ ...q, explanationRu: "Human supplied explanation" }),
  );
  assert.notEqual(
    embeddedQuestionId("course-a", "question"),
    embeddedQuestionId("course-b", "question"),
  );
  assert.equal(
    lmsQuestionSchema.safeParse({ ...q, options: [], correctOptionIds: [] })
      .success,
    true,
  );
});

test("V1 a revised library question preserves the existing course-local revision lineage", async () => {
  const courseId = "synthetic-course";
  const libraryQuestionId = "synthetic-bank";
  const localId = embeddedQuestionId(courseId, libraryQuestionId);
  const libraryQuestion = lmsQuestionSchema.parse({
    id: libraryQuestionId,
    version: 3,
    libraryQuestionId,
    libraryRevisionId: "synthetic-revision",
    promptRu: "Library question",
    promptKz: "Library question",
    options: [
      { id: "a", textRu: "A", textKz: "A" },
      { id: "b", textRu: "B", textKz: "B" },
    ],
    correctOptionIds: ["a"],
  });
  const previous = courseContentSchema.parse({
    titleRu: "Synthetic",
    titleKz: "Synthetic",
    modules: [],
    exam: {
      questionCount: 1,
      questions: [
        {
          ...libraryQuestion,
          id: localId,
          version: 7,
          libraryQuestionId: null,
          libraryRevisionId: null,
          promptRu: "Earlier course-local wording",
        },
      ],
    },
  });
  const oldSnapshot = structuredClone(previous);
  const content = structuredClone(previous);
  content.exam.questions = [
    { ...libraryQuestion, promptRu: "New course-local wording" },
  ];
  const tx = {
    courseVersion: { findFirst: async () => ({ content: previous }) },
    questionRevision: {
      findMany: async () => [
        {
          id: libraryQuestion.libraryRevisionId,
          questionBankId: libraryQuestionId,
          version: libraryQuestion.version,
          definition: libraryQuestion,
          semanticHash: questionSemanticHash(libraryQuestion),
        },
      ],
    },
  } as unknown as Prisma.TransactionClient;
  // This lineage-only fixture represents the legacy staff author; scoped-bank access has dedicated integration coverage.
  const author = { tenantId: "synthetic-tenant", role: "DIRECTOR" } as Context;
  const normalized = await normalizeCourseQuestions(
    tx,
    author,
    courseId,
    content,
    content,
    true,
  );
  assert.equal(normalized.exam.questions[0].id, localId);
  assert.equal(normalized.exam.questions[0].version, 8);
  assert.equal(normalized.exam.questions[0].libraryRevisionId, null);
  const repeated = await normalizeCourseQuestions(
    tx,
    author,
    courseId,
    normalized,
    normalized,
    true,
  );
  assert.deepEqual(repeated, normalized);
  content.exam.questions[0].promptRu = previous.exam.questions[0].promptRu;
  const unchanged = await normalizeCourseQuestions(
    tx,
    author,
    courseId,
    content,
    content,
    true,
  );
  assert.equal(unchanged.exam.questions[0].version, 7);
  assert.deepEqual(previous, oldSnapshot);
});
