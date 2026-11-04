import assert from "node:assert/strict";
import { test } from "node:test";
import { buildQuestionsPayload } from "../../lib/exam-form";

function makeQuestion(options: string[], selected: string) {
  const form = new FormData();
  form.set("questionCount", "1");
  form.set("questionPrompt_0", "Какой ответ правильный?");
  options.forEach((value, index) => form.set(`questionOption_0_${index}`, value));
  form.set("questionCorrectIndex_0", selected);
  return form;
}

test("preserves the selected answer when optional slots are empty", () => {
  const form = makeQuestion(["Первый", "Второй", "", "Четвёртый"], "3");
  const [question] = buildQuestionsPayload(form);
  assert.deepEqual(question.options, ["Первый", "Второй", "Четвёртый"]);
  assert.equal(question.options[question.correctOptionIndex], "Четвёртый");
  assert.equal(question.correctOptionIndex, 2);
});

test("does not silently assign a different answer when the selected slot is empty", () => {
  const form = makeQuestion(["Первый", "Второй", "", "Четвёртый"], "2");
  assert.throws(() => buildQuestionsPayload(form), /заполненный правильный вариант/);
});

test("keeps the exact selected slot even when option text is duplicated", () => {
  const form = makeQuestion(["Да", "Да", "", "Нет"], "1");
  assert.equal(buildQuestionsPayload(form)[0].correctOptionIndex, 1);
});

test("rejects incomplete questions instead of omitting them from the exam", () => {
  const form = makeQuestion(["Один", "", "", ""], "0");
  assert.throws(() => buildQuestionsPayload(form), /не менее двух вариантов/);
});

test("rejects absent or malformed selected slots and unreasonable counts", () => {
  for (const selected of ["", "-1", "1.5", "4"]) {
    assert.throws(() => buildQuestionsPayload(makeQuestion(["Один", "Два"], selected)));
  }
  const form = makeQuestion(["Один", "Два"], "0");
  form.set("questionCount", "1000000");
  assert.throws(() => buildQuestionsPayload(form), /от 1 до 10/);
});
