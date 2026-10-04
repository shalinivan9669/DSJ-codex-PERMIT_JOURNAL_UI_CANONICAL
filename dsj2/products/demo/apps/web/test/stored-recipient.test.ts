import test from "node:test";
import assert from "node:assert/strict";
import { reuseRecipient, type StoredRecipient } from "../lib/stored-recipient";
import { newAssignment, newRecipient } from "../lib/types";

test("legacy partial recipient opens safely without assigning old training facts", () => {
  const record = {
    id: "saved-person",
    data: {
      id: "old-row",
      fullNameRu: "Историческая запись",
      workplaceRu: "ТОО Длинное название",
      externalId: "00123",
      photoAssetId: "confirmed-photo",
      importId: "old-import",
      sourceRow: 101,
      assignments: [
        {
          ...newAssignment(),
          outcome: { status: "PASSED", source: "старый акт" },
        },
      ],
    },
  } as StoredRecipient;
  const before = structuredClone(record);
  const reused = reuseRecipient(record);
  assert.equal(reused.positionRu, "");
  assert.equal(reused.positionKz, "");
  assert.equal(reused.fullNameKz, "");
  assert.equal(reused.workplaceKz, "");
  assert.equal(reused.fullNameRu, before.data.fullNameRu);
  assert.equal(reused.workplaceRu, before.data.workplaceRu);
  assert.equal(reused.externalId, "00123");
  assert.equal(reused.photoAssetId, "confirmed-photo");
  assert.equal(reused.recipientId, record.id);
  assert.notEqual(reused.id, before.data.id);
  assert.deepEqual(reused.assignments, []);
  assert.equal(reused.importId, undefined);
  assert.equal(reused.sourceRow, undefined);
  assert.equal(reused.employeeCategory, undefined);
  assert.deepEqual(record, before);
});

test("reuse preserves every existing personal value and creates independent row IDs", () => {
  const record = {
    id: "saved-complete-person",
    data: {
      ...newRecipient(),
      employeeCategory: "ITR" as const,
      fullNameRu: "Очень длинное ФИО " + "А".repeat(450),
      fullNameKz: "Қазақша аты",
      positionRu: "Инженер",
      workplaceKz: "Ұйым",
      employmentPeriod: "2023–2026",
      personnelNumber: "00001",
      sourceOrder: 99,
      personalMetadata: { original: "preserved" },
    },
  };
  const before = structuredClone(record);
  const first = reuseRecipient(record);
  const second = reuseRecipient(record);
  assert.notEqual(first.id, second.id);
  const { id: _oldId, assignments: _oldAssignments, ...personal } = before.data;
  const { id: _newId, assignments, recipientId, ...actual } = first;
  assert.deepEqual(actual, personal);
  assert.deepEqual(assignments, []);
  assert.equal(recipientId, record.id);
  assert.deepEqual(record, before);
});
