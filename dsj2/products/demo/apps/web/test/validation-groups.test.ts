import assert from "node:assert/strict";
import { test } from "node:test";
import { groupValidationIssues } from "../lib/validation-groups";
import { newRecipient } from "../lib/types";

test("review separates common issues and distinct people, retaining document context and field paths", () => {
  const people = [newRecipient(), newRecipient()];
  people[0].fullNameRu = "Первый";
  people[1].fullNameKz = "Екінші";
  const first = {
    path: "items.0.assignments.0.documentDate",
    message: "Укажите дату",
  };
  const groups = groupValidationIssues(
    [
      first,
      first,
      { path: "profile.cityRu", message: "Укажите город центра" },
      { path: "items.1.assignments.0.documentDate", message: "Укажите дату" },
      {
        itemId: people[0].id,
        path: "items.0.positionRu",
        message: "Укажите должность",
      },
    ],
    people,
  );
  assert.equal(groups.length, 3);
  assert.equal(groups[0].key, "common");
  assert.equal(groups[1].title, "Первый");
  assert.equal(groups[1].issues.length, 2);
  assert.match(groups[1].issues[0].document, /БиОТ/);
  assert.deepEqual(groups[1].issues[0].issue, first);
  assert.equal(groups[2].title, "Екінші");
  assert.equal(groups[2].issues.length, 1);
});

test("server rowId assigns non-indexed validation issues to the correct person", () => {
  const people = [newRecipient(), newRecipient()];
  people[0].fullNameRu = "Первый";
  people[1].fullNameRu = "Второй";
  const duplicate = {
    code: "DUPLICATE_EVENT_ASSIGNMENT",
    path: "items",
    rowId: people[1].id,
    message: "Набор уже назначен участнику этого события",
  };
  const groups = groupValidationIssues(
    [duplicate, { path: "profile", message: "Настройте центр" }],
    people,
  );
  assert.deepEqual(
    groups.map((group) => group.key),
    ["common", people[1].id],
  );
  assert.equal(groups[1].title, "Второй");
  assert.equal(groups[1].issues[0].issue, duplicate);
  assert.equal(groups[1].issues[0].document, "");
});

test("server rowId takes precedence over legacy itemId and indexed path for grouping", () => {
  const people = [newRecipient(), newRecipient()];
  const groups = groupValidationIssues(
    [
      {
        rowId: people[1].id,
        itemId: people[0].id,
        path: "items.0.positionRu",
        message: "Укажите должность",
      },
    ],
    people,
  );
  assert.equal(groups.length, 1);
  assert.equal(groups[0].key, people[1].id);
});
