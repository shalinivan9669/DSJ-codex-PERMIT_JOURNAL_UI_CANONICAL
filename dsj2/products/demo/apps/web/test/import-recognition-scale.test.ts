import test from "node:test";
import assert from "node:assert/strict";
import { draftSchema, LIMITS } from "@demo/contracts";
import {
  inferMapping,
  mapImportRow,
  recognizedImportMapping,
  type ImportPreview,
} from "../lib/imports";
import {
  assignTrainingBundle,
  recipientForRequest,
} from "../lib/request-bundles";
import { newRecipient, type Draft } from "../lib/types";

test("saved mappings match reordered normalized headers without applying conflicting or duplicate-header rules", () => {
  const rule = {
    id: "saved",
    name: "Сотрудники центра",
    columns: ["Имя сотрудника", "Табельный код", "Служебная заметка"],
    mapping: {
      "Имя сотрудника": "fullNameRu",
      "Табельный код": "personnelNumber",
    },
  };
  const recognized = recognizedImportMapping(
    [" табельный код ", "ИМЯ СОТРУДНИКА", "Служебная заметка"],
    [rule],
  );
  assert.deepEqual(recognized.mapping, ["personnelNumber", "fullNameRu", ""]);
  assert.equal(recognized.savedName, rule.name);
  assert.equal(
    recognized.needsReview,
    false,
    "a deliberately ignored saved column does not need repeated confirmation",
  );
  const conflict = recognizedImportMapping(rule.columns, [
    rule,
    {
      ...rule,
      id: "other",
      mapping: { ...rule.mapping, "Имя сотрудника": "fullNameKz" },
    },
  ]);
  assert.equal(conflict.conflictingSavedRules, true);
  assert.equal(conflict.needsReview, true);
  assert.equal(conflict.savedName, "");
  assert.equal(
    recognizedImportMapping(["ФИО RU", "ФИО RU"], []).needsReview,
    true,
  );
  assert.equal(
    recognizedImportMapping(["ФИО RU", "Должность RU"], []).needsReview,
    false,
  );
  assert.equal(
    recognizedImportMapping(["ФИО RU", "Неизвестно"], []).needsReview,
    true,
  );
});

test("400 imported people retain all source IDs and inherit the request courses once without a per-person form ceiling", () => {
  const first = { ...newRecipient(), assignments: [] };
  let draft = {
    ...draftSchema.parse({ kind: "PERSON", schemaVersion: 2, items: [first] }),
    id: "scale",
    revision: 0,
    status: "DRAFT",
  } as Draft;
  for (const course of ["BIOT", "PTM", "PB", "PS"] as const)
    draft = assignTrainingBundle(draft, [first.id], course, "GROUP", true);
  const preview: ImportPreview = {
    importId: "synthetic-400",
    columns: ["ФИО RU", "Табельный номер", "Должность RU"],
    rows: Array.from({ length: 400 }, (_, index) => ({
      sourceRow: index + 2,
      values: [
        `Синтетический ${index + 1}`,
        String(index + 1).padStart(6, "0"),
        "Рабочий",
      ],
    })),
    total: 400,
  };
  const rows = preview.rows.map((row) =>
    recipientForRequest(
      draft,
      mapImportRow(preview, row, inferMapping(preview.columns), ""),
    ),
  );
  assert.equal(rows.length, 400);
  assert.equal(rows[399].personnelNumber, "000400");
  assert.equal(new Set(rows.map((row) => row.id)).size, 400);
  assert.ok(rows.every((row) => row.assignments.length === 4));
  assert.ok(
    rows.every((row) =>
      row.assignments.every(
        (assignment) => assignment.outcome?.status === "PASSED",
      ),
    ),
  );
  const combined = draftSchema.parse({
    kind: draft.kind,
    schemaVersion: draft.schemaVersion,
    businessRuleVersion: draft.businessRuleVersion,
    events: draft.events,
    trainingDefaults: draft.trainingDefaults,
    items: rows,
  });
  assert.ok(Buffer.byteLength(JSON.stringify(combined)) < LIMITS.jsonBytes);
});
