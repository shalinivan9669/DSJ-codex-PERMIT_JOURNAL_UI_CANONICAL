import test from "node:test";
import assert from "node:assert/strict";
import { draftSchema } from "@demo/contracts";
import { draftPayload, personRequestName, type Draft } from "../lib/types";

const request = (kind: "PERSON" | "COMPANY"): Draft => ({
  ...draftSchema.parse({
    kind,
    title: "Старое название",
    items: [{ id: "one", fullNameRu: "Тестов Оператор" }],
  }),
  id: "request",
  revision: 1,
  status: "DRAFT",
});

test("person payload persists its person's name and updates when the operator changes it", () => {
  const draft = request("PERSON");
  assert.equal(draftPayload(draft).title, "Тестов Оператор");
  draft.items[0].fullNameRu = "Тестов Новый";
  assert.equal(draftPayload(draft).title, "Тестов Новый");
  assert.equal(draftPayload(draft).customerId, null);
});

test("company title is independent from employee names and explicit translations survive save", () => {
  const draft = request("COMPANY");
  draft.customerId = "company";
  draft.items[0].fullNameKz = "Тестұлы Оператор";
  assert.equal(personRequestName(draft), "");
  const payload = draftPayload(draft);
  assert.equal(payload.title, "Старое название");
  assert.equal(payload.customerId, "company");
  assert.equal(payload.items[0].fullNameKz, "Тестұлы Оператор");
});
