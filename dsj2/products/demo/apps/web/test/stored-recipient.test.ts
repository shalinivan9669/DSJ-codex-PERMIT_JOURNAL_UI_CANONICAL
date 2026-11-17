import test from "node:test";
import assert from "node:assert/strict";
import {
  fillFromStoredRecipient,
  reuseRecipient,
  undoStoredRecipient,
  type StoredRecipient,
} from "../lib/stored-recipient";
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

test("selecting a saved individual fills the existing empty row and ignores past assignments", () => {
  const row = {
    ...newRecipient(),
    fullNameRu: "Сер",
    assignments: [],
    email: "new@example.test",
  };
  const record = {
    id: "saved",
    data: {
      ...newRecipient(),
      fullNameRu: "Серик Али",
      fullNameKz: "Серік Әли",
      iin: "000000000015",
      positionRu: "Инженер",
      positionKz: "Инженер",
      employeeCategory: "ITR" as const,
      employerId: "one",
      workplaceRu: "Монтаж",
      personnelNumber: "17",
      photoAssetId: "photo1",
      email: "old@example.test",
    },
  };
  const before = structuredClone(row);
  const chosen = fillFromStoredRecipient(row, record, true);
  assert.equal(chosen.id, row.id);
  assert.equal(chosen.recipientId, record.id);
  assert.equal(chosen.fullNameRu, "Серик Али");
  assert.equal(chosen.fullNameKz, "Серік Әли");
  assert.equal(chosen.positionRu, "Инженер");
  assert.equal(chosen.employeeCategory, "ITR");
  assert.equal(chosen.employerId, "one");
  assert.equal(chosen.photoAssetId, "photo1");
  assert.equal(chosen.personnelNumber, "17");
  assert.equal(chosen.iin, "000000000015");
  assert.equal(chosen.email, row.email);
  assert.deepEqual(chosen.assignments, []);
  assert.deepEqual(row, before);
  assert.deepEqual(
    undoStoredRecipient({ ...chosen, positionRu: "Мастер" }, row, chosen),
    { ...row, positionRu: "Мастер" },
  );
  assert.equal(
    fillFromStoredRecipient(row, record, false).employeeCategory,
    "WORKER",
  );
  const manual = fillFromStoredRecipient(
    { ...row, positionRu: "Мастер" },
    record,
    true,
  );
  assert.equal(manual.positionRu, "Мастер");
  assert.equal(manual.positionKz, "");
  assert.equal(manual.employeeCategory, "WORKER");
  const differentEmployer = fillFromStoredRecipient(
    { ...row, employerId: "other" },
    record,
    true,
  );
  assert.equal(differentEmployer.employerId, "other");
  assert.equal(differentEmployer.personnelNumber, undefined);
  assert.equal(differentEmployer.positionRu, "");
  assert.equal(differentEmployer.photoAssetId, "photo1");
  for (const fixed of [
    { ...row, recipientId: "linked" },
    { ...row, iin: "000000000016" },
  ]) {
    assert.equal(fillFromStoredRecipient(fixed, record, true), fixed);
  }
});

test("selecting the directory entry for an imported row retains the existing programme, results and selected category", () => {
  const course = {
    ...newAssignment("pb-card"),
    hours: "15",
    protocolDate: "2026-06-15",
  };
  const row = {
    ...newRecipient(),
    fullNameRu: "Серик Али",
    sourceRow: 4,
    importId: "file-1",
    assignments: [course],
  };
  const chosen = fillFromStoredRecipient(
    row,
    {
      id: "saved",
      data: {
        ...newRecipient(),
        fullNameRu: "Серик Али",
        positionRu: "Инженер",
        employeeCategory: "ITR",
        assignments: [newAssignment("ptm-card")],
      },
    },
    true,
  );
  assert.equal(chosen.sourceRow, 4);
  assert.equal(chosen.importId, "file-1");
  assert.equal(chosen.employeeCategory, row.employeeCategory);
  assert.equal(chosen.positionRu, "Инженер");
  assert.equal(chosen.assignments, row.assignments);
  const edited = { ...chosen, assignments: [{ ...course, hours: "24" }] };
  const undone = undoStoredRecipient(edited, row, chosen);
  assert.equal(undone.recipientId, undefined);
  assert.equal(undone.assignments, edited.assignments);
});
