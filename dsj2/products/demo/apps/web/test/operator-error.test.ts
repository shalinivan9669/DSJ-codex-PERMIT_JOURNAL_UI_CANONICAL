import assert from "node:assert/strict";
import test from "node:test";
import { operatorErrorParts } from "../lib/operator-error";

test("support ID is retained separately from actionable Russian and Kazakh errors", () => {
  const id = "11111111-2222-4333-8444-555555555555";
  for (const label of ["Код обращения", "Өтініш коды"]) {
    assert.deepEqual(
      operatorErrorParts(
        `Не удалось скачать. Повторите попытку. ${label}: ${id}`,
      ),
      {
        message: "Не удалось скачать. Повторите попытку.",
        correlationId: id,
      },
    );
  }
});

test("ordinary validation and nonterminal support wording are preserved", () => {
  for (const message of [
    "Укажите ФИО.",
    "Код обращения: нужен для поддержки.",
    "Поле 1\nПоле 2",
  ]) {
    assert.deepEqual(operatorErrorParts(message), {
      message,
      correlationId: null,
    });
  }
});
