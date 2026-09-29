import { test } from "node:test";
import assert from "node:assert/strict";
import { previewBulk } from "../lib/bulk-edit";
import { newRecipient } from "../lib/types";

test("shared workplace fills selected empty people while preserving individual values and documents", () => {
  const items = [
    {
      ...newRecipient(),
      id: "empty",
      fullNameKz: "Әбдірахманов Нұрсұлтан",
      workplaceRu: "",
      positionRu: "Мастер",
    },
    {
      ...newRecipient(),
      id: "exception",
      workplaceRu: "Индивидуальная организация",
    },
    { ...newRecipient(), id: "unselected", workplaceRu: "" },
  ];
  const result = previewBulk(
    items,
    ["empty", "exception"],
    "",
    { workplaceRu: "Общая организация" },
    "EMPTY",
  );
  assert.equal(result.people, 1);
  assert.equal(result.assignments, 0);
  assert.equal(result.changes.length, 1);
  assert.equal(result.changes[0].name, "Әбдірахманов Нұрсұлтан");
  assert.equal(result.items[0].workplaceRu, "Общая организация");
  assert.equal(result.items[0].workplaceKz, items[0].workplaceKz);
  assert.equal(result.items[0].positionRu, "Мастер");
  assert.deepEqual(result.items[0].assignments, items[0].assignments);
  assert.equal(result.items[1].workplaceRu, "Индивидуальная организация");
  assert.equal(result.items[2], items[2]);
  assert.equal(items[0].workplaceRu, "");
});

test("replacement changes only explicit selected fields, including explicit clear", () => {
  const items = [
    {
      ...newRecipient(),
      id: "a",
      workplaceRu: "Старая",
      workplaceKz: "Бөлек",
      positionRu: "Инженер",
    },
    { ...newRecipient(), id: "b", workplaceRu: "Другая" },
  ];
  const result = previewBulk(
    items,
    ["a"],
    "",
    { workplaceRu: "Новая", positionRu: "" },
    "REPLACE",
  );
  assert.equal(result.changes.length, 2);
  assert.equal(result.items[0].workplaceRu, "Новая");
  assert.equal(result.items[0].positionRu, "");
  assert.equal(result.items[0].workplaceKz, "Бөлек");
  assert.equal(result.items[1], items[1]);
});

test("inherited mode never treats person fields as document defaults", () => {
  const items = [
    {
      ...newRecipient(),
      id: "a",
      workplaceRu: "",
      positionRu: "Индивидуальная",
    },
  ];
  const result = previewBulk(
    items,
    ["a"],
    "",
    { workplaceRu: "Общая", positionRu: "Замена" },
    "INHERITED",
  );
  assert.equal(result.changes.length, 0);
  assert.deepEqual(result.items, items);
});

test("mixed person and document mask preserves other directions and counts assignments only once", () => {
  const first = newRecipient();
  const second = newRecipient();
  first.id = "first";
  second.id = "second";
  first.assignments[0].templateId = "ptm-card";
  second.assignments[0].templateId = "pb-card";
  const result = previewBulk(
    [first, second],
    [first.id, second.id],
    "ptm",
    { workplaceRu: "Организация", trainingSubject: "ПТМ" },
    "REPLACE",
  );
  assert.equal(result.people, 2);
  assert.equal(result.assignments, 1);
  assert.equal(result.changes.length, 3);
  assert.equal(result.items[0].assignments[0].trainingSubject, "ПТМ");
  assert.deepEqual(result.items[1].assignments, second.assignments);
});
