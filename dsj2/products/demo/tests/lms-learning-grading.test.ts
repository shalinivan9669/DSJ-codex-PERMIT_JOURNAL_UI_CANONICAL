import test from "node:test";
import assert from "node:assert/strict";
import {
  lmsQuestionSchema,
  type LearningAnswers,
  type QuestionAnswerSpec,
} from "../packages/contracts/src/lms";
import {
  gradeLearningAnswers,
  publicQuestion,
  validateLearningAnswers,
} from "../apps/api/src/lms/assessment-grading";
import { gradeAnswers } from "../apps/api/src/lms/engine";
import { assertQuestionPublishable } from "../apps/api/src/lms/validation";
import { questionSemanticHash } from "../apps/api/src/lms/question-semantics";

function question(id: string, answerSpec?: QuestionAnswerSpec) {
  return lmsQuestionSchema.parse({
    id,
    promptRu: "Синтетический вопрос",
    promptKz: "Synthetic fixture",
    options: [
      { id: "a", textRu: "A", textKz: "A" },
      { id: "b", textRu: "B", textKz: "B" },
    ],
    correctOptionIds: ["a"],
    explanationRu: "PRIVATE EXPLANATION",
    answerSpec,
  });
}

const six = [
  question("single", { kind: "SINGLE", correctOptionIds: ["a"] }),
  question("multiple", { kind: "MULTIPLE", correctOptionIds: ["a", "b"] }),
  question("matching", {
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
  question("ordering", { kind: "ORDERING", correctOrderIds: ["b", "a"] }),
  question("text", {
    kind: "TEXT",
    mode: "EXACT",
    acceptedAnswers: ["Ответ один"],
    caseSensitive: false,
    collapseWhitespace: true,
  }),
  question("case", {
    kind: "CASE",
    contextRu: "Синтетическая ситуация",
    contextKz: "Synthetic situation",
    response: {
      kind: "TEXT",
      mode: "MANUAL",
      criteriaRu: "Явно обозначенный синтетический критерий",
      criteriaKz: "Explicit synthetic criterion",
    },
  }),
];
const answers: LearningAnswers = {
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
  text: { kind: "TEXT", text: "  ОТВЕТ \n один  " },
  case: { kind: "TEXT", text: "Синтетическая работа для ручной проверки" },
};

test("P03 six response modes share exact grading; a manual answer never passes before a decision", () => {
  const policy = { thresholdPercent: 80, comparison: "GTE" as const };
  const pending = gradeLearningAnswers(six, answers, policy);
  assert.equal(pending.algorithmVersion, "TYPED_EXACT_V2");
  assert.equal(pending.score, 5);
  assert.equal(pending.maxScore, 6);
  assert.equal(pending.verdict, "AWAITING_REVIEW");
  assert.deepEqual(pending.pendingQuestionIds, ["case"]);
  assert.equal(pending.questionScores.case, null);
  const accepted = gradeLearningAnswers(six, answers, policy, { case: 1 });
  assert.equal(accepted.score, 6);
  assert.equal(accepted.verdict, "PASSED");
  const declined = gradeLearningAnswers(
    six,
    answers,
    { thresholdPercent: 100, comparison: "GTE" },
    { case: 0 },
  );
  assert.equal(declined.verdict, "FAILED");
  assert.equal(declined.score, 5);
  assert.throws(
    () => gradeLearningAnswers(six, answers, policy, { unknown: 1 }),
    /MANUAL_SCORES_INVALID/,
  );
  assert.equal(
    gradeLearningAnswers(six, {}, policy).verdict,
    "FAILED",
    "blank answers earn zero; submission is not evidence of completion",
  );
});

test("P03 stable IDs, unique pairs/order, wrong discriminators and exact-text rules are enforced", () => {
  for (const invalid of [
    { unknown: ["a"] },
    { single: { kind: "SINGLE", optionIds: ["foreign"] } },
    { single: { kind: "SINGLE", optionIds: ["a", "a"] } },
    { ordering: { kind: "ORDERING", optionIds: ["a", "a"] } },
    { text: { kind: "SINGLE", optionIds: ["a"] } },
    {
      matching: {
        kind: "MATCHING",
        pairs: [
          { leftId: "a", rightId: "x" },
          { leftId: "a", rightId: "y" },
        ],
      },
    },
    {
      matching: {
        kind: "MATCHING",
        pairs: [
          { leftId: "a", rightId: "x" },
          { leftId: "b", rightId: "x" },
        ],
      },
    },
  ])
    assert.equal(
      validateLearningAnswers(six, invalid as LearningAnswers),
      false,
    );
  const wrong = gradeLearningAnswers(
    six,
    {
      ...answers,
      ordering: { kind: "ORDERING", optionIds: ["a", "b"] },
      text: { kind: "TEXT", text: "Ответ" },
    },
    { thresholdPercent: 80, comparison: "GTE" },
    { case: 1 },
  );
  assert.equal(wrong.score, 4);
  assert.equal(wrong.verdict, "FAILED");
  const legacy = question("legacy");
  const legacyAnswers = { legacy: ["a", "a"] };
  const policy = { thresholdPercent: 100, comparison: "GT" as const };
  const old = gradeAnswers([legacy], legacyAnswers, policy);
  const current = gradeLearningAnswers([legacy], legacyAnswers, policy);
  assert.equal(current.algorithmVersion, "LEGACY_CHOICES_V1");
  assert.equal(current.score, old.score);
  assert.equal(current.verdict, old.verdict);
});

test("P03 public questions remove nested keys until explicit reveal while keeping a public manual rubric", () => {
  for (const item of six) {
    const serialized = JSON.stringify(publicQuestion(item));
    assert.ok(!serialized.includes("correctOptionIds"));
    assert.ok(!serialized.includes("correctOrderIds"));
    assert.ok(!serialized.includes("acceptedAnswers"));
    assert.ok(!serialized.includes('"pairs"'));
    assert.ok(!serialized.includes("PRIVATE EXPLANATION"));
  }
  const manual = publicQuestion(six[5]);
  assert.ok(JSON.stringify(manual).includes("Explicit synthetic criterion"));
  assert.deepEqual(publicQuestion(six[2], true), six[2]);
  const nested = question("case-key", {
    kind: "CASE",
    contextRu: "Case",
    contextKz: "Case",
    response: {
      kind: "TEXT",
      mode: "EXACT",
      acceptedAnswers: ["EXACT_SECRET"],
      caseSensitive: true,
      collapseWhitespace: false,
    },
  });
  assert.ok(!JSON.stringify(publicQuestion(nested)).includes("EXACT_SECRET"));
});

test("P03 publish validation and revision meaning cover typed keys without confusing matching order with answer order", () => {
  six.forEach(assertQuestionPublishable);
  const matching = structuredClone(six[2]);
  if (matching.answerSpec?.kind !== "MATCHING") throw new Error("fixture");
  matching.answerSpec.pairs.reverse();
  matching.answerSpec.rightOptions.reverse();
  assert.equal(questionSemanticHash(matching), questionSemanticHash(six[2]));
  const ordering = structuredClone(six[3]);
  if (ordering.answerSpec?.kind !== "ORDERING") throw new Error("fixture");
  ordering.answerSpec.correctOrderIds.reverse();
  assert.notEqual(questionSemanticHash(ordering), questionSemanticHash(six[3]));
  matching.answerSpec.pairs[1].rightId = matching.answerSpec.pairs[0].rightId;
  assert.throws(() => assertQuestionPublishable(matching));
  const text = question("bad-text", {
    kind: "TEXT",
    mode: "EXACT",
    acceptedAnswers: ["   "],
    caseSensitive: false,
    collapseWhitespace: true,
  });
  assert.throws(() => assertQuestionPublishable(text));
  const manual = question("bad-manual", {
    kind: "TEXT",
    mode: "MANUAL",
    criteriaRu: "",
    criteriaKz: "",
  });
  assert.throws(() => assertQuestionPublishable(manual));
});
