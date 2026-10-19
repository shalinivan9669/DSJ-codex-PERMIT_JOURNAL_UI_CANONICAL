import test from "node:test";
import assert from "node:assert/strict";
import { lmsQuestionSchema } from "../packages/contracts/src/lms";
import { protocolQuestion } from "../apps/api/src/lms/document-protocol";
import { assignmentSchema } from "../packages/contracts/src";

const base = {
  id: "question-1",
  promptRu: "Вопрос",
  promptKz: "Сұрақ",
  options: [
    { id: "a", textRu: "Первый", textKz: "Бірінші" },
    { id: "b", textRu: "Второй", textKz: "Екінші" },
  ],
  correctOptionIds: ["a"],
};

test("protocol preserves the actual answer independently of the correct choice and later bank edits", () => {
  const question = lmsQuestionSchema.parse(base);
  const row = protocolQuestion(question, ["b"], 0);
  question.options[0].textRu = "Позднейшее исправление";
  assert.equal(row.correctAnswerRu, "Первый");
  assert.equal(row.responseRu, "Второй");
  assert.equal(row.correctAnswerKz, "Бірінші");
  assert.equal(row.score, 0);
});

test("matching and ordering print labels with their distinct original order and relation", () => {
  const matching = lmsQuestionSchema.parse({
    ...base,
    answerSpec: {
      kind: "MATCHING",
      pairs: [
        { leftId: "a", rightId: "x" },
        { leftId: "b", rightId: "y" },
      ],
      rightOptions: [
        { id: "x", textRu: "Альфа", textKz: "Альфа" },
        { id: "y", textRu: "Бета", textKz: "Бета" },
      ],
    },
  });
  const matchRow = protocolQuestion(
    matching,
    {
      kind: "MATCHING",
      pairs: [
        { leftId: "a", rightId: "y" },
        { leftId: "b", rightId: "x" },
      ],
    },
    0,
  );
  assert.equal(matchRow.correctAnswerRu, "Первый → Альфа; Второй → Бета");
  assert.equal(matchRow.responseRu, "Первый → Бета; Второй → Альфа");
  const ordering = lmsQuestionSchema.parse({
    ...base,
    answerSpec: { kind: "ORDERING", correctOrderIds: ["b", "a"] },
  });
  assert.equal(
    protocolQuestion(ordering, { kind: "ORDERING", optionIds: ["a", "b"] }, 0)
      .correctAnswerRu,
    "1. Второй; 2. Первый",
  );
});

test("case text evidence retains context and manual criteria without inventing a correct free-text response", () => {
  const question = lmsQuestionSchema.parse({
    ...base,
    answerSpec: {
      kind: "CASE",
      contextRu: "Исходная ситуация",
      contextKz: "Бастапқы жағдай",
      response: {
        kind: "TEXT",
        mode: "MANUAL",
        criteriaRu: "Назвать два безопасных действия",
        criteriaKz: "Екі қауіпсіз әрекетті атау",
      },
    },
  });
  const row = protocolQuestion(
    question,
    { kind: "TEXT", text: "Действие один и действие два" },
    1,
  );
  assert.equal(row.promptRu, "Исходная ситуация\nВопрос");
  assert.equal(row.correctAnswerRu, "Назвать два безопасных действия");
  assert.equal(row.responseRu, "Действие один и действие два");
  assert.equal(row.score, 1);
});

test("protocol accepts the full published bounds for text alternatives and matching labels without truncation", () => {
  const rowSchema = assignmentSchema.shape.lms.unwrap().shape.protocol.unwrap()
    .shape.questions.element;
  const exact = lmsQuestionSchema.parse({
    ...base,
    answerSpec: {
      kind: "TEXT",
      mode: "EXACT",
      acceptedAnswers: Array.from({ length: 100 }, () => "а".repeat(10000)),
      caseSensitive: false,
      collapseWhitespace: true,
    },
  });
  const exactRow = protocolQuestion(
    exact,
    { kind: "TEXT", text: "а".repeat(10000) },
    1,
  );
  assert.equal(exactRow.correctAnswerRu.length, 1000000 + 99 * 3);
  assert.deepEqual(rowSchema.parse(exactRow), exactRow);
  const options = Array.from({ length: 20 }, (_, i) => ({
    id: `left-${i}`,
    textRu: "л".repeat(1000),
    textKz: "с".repeat(1000),
  }));
  const rightOptions = Array.from({ length: 20 }, (_, i) => ({
    id: `right-${i}`,
    textRu: "п".repeat(1000),
    textKz: "о".repeat(1000),
  }));
  const pairs = options.map((option, i) => ({
    leftId: option.id,
    rightId: rightOptions[i].id,
  }));
  const matching = lmsQuestionSchema.parse({
    ...base,
    options,
    answerSpec: { kind: "MATCHING", pairs, rightOptions },
  });
  const matchingRow = protocolQuestion(
    matching,
    { kind: "MATCHING", pairs },
    1,
  );
  assert.ok(matchingRow.responseRu.length > 40000);
  assert.deepEqual(rowSchema.parse(matchingRow), matchingRow);
});
