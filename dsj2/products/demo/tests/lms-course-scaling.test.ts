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
