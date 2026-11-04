import assert from "node:assert/strict";
import { test } from "node:test";
import { submitExamSchema } from "@dsj/types";

test("exam answers are limited to the supported question count", () => {
  const answer = { questionId: "question", optionId: "option" };
  assert.equal(submitExamSchema.safeParse({ answers: [] }).success, false);
  assert.equal(submitExamSchema.safeParse({ answers: Array(10).fill(answer) }).success, true);
  assert.equal(submitExamSchema.safeParse({ answers: Array(11).fill(answer) }).success, false);
});
