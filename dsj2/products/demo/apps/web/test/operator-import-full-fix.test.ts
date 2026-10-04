import test from "node:test";
import assert from "node:assert/strict";
import {
  validateMappedImportRow,
  applyImportCorrections,
  importedSourceRows,
  inferMapping,
  type ImportPreview,
} from "../lib/imports";
import { isBlankText } from "../lib/blank-text";
import { previewGridPaste } from "../lib/grid-paste";
import { previewBulk } from "../lib/bulk-edit";
import { newRecipient } from "../lib/types";
import { newAssignment } from "../lib/types";
import { recordQueryIsCurrent, recordQueryKey } from "../lib/record-query";

const source: ImportPreview = {
  importId: "partial-source",
  columns: ["ФИО RU", "Категория сотрудника", "Дата документа"],
  rows: [],
  total: 3,
};
const mapping = inferMapping(source.columns);

test("mapped preview identifies category and calendar cells before apply and accepts corrected incomplete drafts", () => {
  const invalid = validateMappedImportRow(
    source,
    { sourceRow: 2, values: ["Тест", "Инженер", "2026-02-30"] },
    mapping,
    "ptm-card",
  );
  assert.deepEqual(
    invalid.issues.map((issue) => issue.column),
    [1, 2],
  );
  assert.match(
    invalid.issues[0].message,
    /не определяет категорию автоматически/,
  );
  const corrected = validateMappedImportRow(
    source,
    { sourceRow: 2, values: ["Тест", "ITR", "2026-02-28"] },
    mapping,
    "ptm-card",
  );
  assert.equal(corrected.issues.length, 0);
  assert.equal(corrected.item?.employeeCategory, "ITR");
  assert.equal(
    corrected.item?.assignments[0].fieldOrigins?.documentDate,
    "IMPORTED",
  );
  const incomplete = validateMappedImportRow(
    source,
    { sourceRow: 3, values: ["", "WORKER", ""] },
    mapping,
    "ptm-card",
  );
  assert.equal(incomplete.issues.length, 0);
  assert.equal(incomplete.incomplete, true);
});

test("mapped preview rejects incompatible BiOT category, long identifiers and factual data without training", () => {
  const incompatible = validateMappedImportRow(
    source,
    { sourceRow: 8, values: ["Рабочий", "OHS_SPECIALIST_SPECIAL"] },
    ["employeeCategory", "biotCategory"],
    "biot-worker-card",
  );
  assert.equal(incompatible.issues[0].field, "biotCategory");
  const long = validateMappedImportRow(
    source,
    { sourceRow: 9, values: ["Тест", "0".repeat(101)] },
    ["fullNameRu", "personnelNumber"],
    "",
  );
  assert.equal(long.issues[0].column, 1);
  const factual = validateMappedImportRow(
    source,
    { sourceRow: 10, values: ["Тест", "Сдал"] },
    ["fullNameRu", "result"],
    "",
  );
  assert.equal(factual.issues[0].field, "result");
  assert.match(factual.issues[0].message, /выберите документ/);
  const formula = validateMappedImportRow(
    source,
    { sourceRow: 11, values: ["=1+1"], errors: ["FORMULA_NOT_ALLOWED"] },
    ["fullNameRu"],
    "",
  );
  assert.match(formula.issues[0].message, /не импортируется/);
});

test("partial import plan consumes only source rows of this source, preserving same-name people independently", () => {
  const people = [2, 3].map((sourceRow) => ({
    ...newRecipient(),
    importId: source.importId,
    sourceRow,
    fullNameRu: "Одинаковое ФИО",
  }));
  people.push({
    ...newRecipient(),
    importId: "other-source",
    sourceRow: 4,
    fullNameRu: "Одинаковое ФИО",
  });
  assert.deepEqual([...importedSourceRows(people, source.importId)], [2, 3]);
  assert.deepEqual([...importedSourceRows([], source.importId)], []);
  assert.equal(new Set(people.map((person) => person.id)).size, 3);
});

test("preview corrections mark manual and cleared origins without changing original imported source or confirming results", () => {
  const check = validateMappedImportRow(
    source,
    { sourceRow: 2, values: ["Тест", "ITR", "2026-02-28"] },
    mapping,
    "ptm-card",
  );
  assert.ok(check.item);
  const original = structuredClone(check.item);
  const corrected = applyImportCorrections(check.item, mapping, {
    2: "2026-02-28",
  });
  assert.equal(corrected.assignments[0].fieldOrigins?.documentDate, "MANUAL");
  assert.equal(original.assignments[0].fieldOrigins?.documentDate, "IMPORTED");
  assert.deepEqual(check.item, original);
  assert.equal(
    corrected.assignments[0].outcome?.status || "UNKNOWN",
    "UNKNOWN",
  );
  const cleared = applyImportCorrections(check.item, mapping, { 2: "" });
  assert.equal(cleared.assignments[0].fieldOrigins?.documentDate, "CLEARED");
});

test("EMPTY range accepts whitespace NBSP and invisible-only cells without changing meaningful spaced names", () => {
  for (const value of ["", "   ", "\u00a0", "\u200b\u2060\ufeff", "\n\t"])
    assert.equal(isBlankText(value), true);
  const items = ["", "   ", "\u00a0\u200b", "Анна Мария", "А\u200dБ"].map(
    (fullNameRu) => ({ ...newRecipient(), fullNameRu }),
  );
  const result = previewGridPaste(
    items,
    0,
    "fullNameRu",
    "Один\nДва\nТри\nЧетыре\nПять",
    "EMPTY",
    ["fullNameRu"],
  );
  assert.deepEqual(
    result.items.map((person) => person.fullNameRu),
    ["Один", "Два", "Три", "Анна Мария", "А\u200dБ"],
  );
  assert.equal(result.changes.length, 3);
  assert.equal(result.skippedFilled, 2);
  assert.equal(items[1].fullNameRu, "   ");
});

test("blank source rows are explicit creation operations; selected omission compacts and never silently truncates", () => {
  const text = "Первый\tМастер\tТОО\n\t\t\nТретий\tИнженер\tТОО\n\t\t";
  const kept = previewGridPaste(
    [],
    0,
    "fullNameRu",
    text,
    "EMPTY",
    ["fullNameRu", "positionRu", "workplaceRu"],
    "KEEP",
  );
  assert.equal(kept.added, 4);
  assert.deepEqual(
    kept.createdRows.map((row) => [row.sourceRow, row.row, row.blank]),
    [
      [1, 1, false],
      [2, 2, true],
      [3, 3, false],
      [4, 4, true],
    ],
  );
  assert.deepEqual(kept.blankRows, [2, 4]);
  const skipped = previewGridPaste(
    [],
    0,
    "fullNameRu",
    text,
    "EMPTY",
    ["fullNameRu", "positionRu", "workplaceRu"],
    "SKIP",
  );
  assert.equal(skipped.added, 2);
  assert.equal(skipped.items[1].fullNameRu, "Третий");
  assert.equal(skipped.skippedBlankRows, 2);
  assert.throws(
    () =>
      previewGridPaste(
        [],
        248,
        "fullNameRu",
        text,
        "EMPTY",
        ["fullNameRu", "positionRu", "workplaceRu"],
        "KEEP",
      ),
    /250/,
  );
  assert.throws(
    () =>
      previewGridPaste([], 0, "fullNameRu", "А\t" + "б".repeat(501), "EMPTY", [
        "fullNameRu",
        "positionRu",
      ]),
    /500/,
  );
});

test("bulk preview distinguishes effective company wording from empty individual fields and creates only explicit exceptions", () => {
  const raw = {
    ...newRecipient(),
    workplaceRu: "   ",
    workplaceKz: "",
    positionRu: "Инженер",
  };
  const effective = {
    ...raw,
    workplaceRu: "ТОО Общая компания",
    workplaceKz: "ТОО Общая компания",
  };
  const filled = previewBulk(
    [raw],
    [raw.id],
    "",
    { workplaceRu: "Индивидуальная компания" },
    "EMPTY",
    [effective],
  );
  assert.equal(filled.changes[0].before, "ТОО Общая компания");
  assert.equal(filled.changes[0].rawBefore, "   ");
  assert.equal(filled.changes[0].beforeSource, "EFFECTIVE");
  assert.equal(filled.items[0].workplaceKz, "");
  assert.equal(raw.workplaceRu, "   ");
  const inherited = previewBulk(
    [raw],
    [raw.id],
    "",
    { workplaceRu: "Новая" },
    "INHERITED",
    [effective],
  );
  assert.equal(inherited.changes.length, 0);
});

test("record response from a different query, page, type or failed request is never selectable", () => {
  const a = recordQueryKey("customers", "A", 1);
  for (const key of [
    recordQueryKey("customers", "B", 1),
    recordQueryKey("customers", "A", 2),
    recordQueryKey("recipients", "A", 1),
  ])
    assert.equal(recordQueryIsCurrent(key, a, undefined), false);
  assert.equal(recordQueryIsCurrent(a, a, a), false);
  assert.equal(recordQueryIsCurrent(a, undefined, undefined), false);
  assert.equal(recordQueryIsCurrent(a, a, undefined), true);
});

test("bulk document fields address one actual event and preserve other events, outcomes and origins", () => {
  const first = {
    ...newAssignment("ptm-card"),
    eventId: "event-a",
    hours: "8",
    fieldOrigins: { hours: "IMPORTED" as const },
    outcome: {
      status: "PASSED" as const,
      source: "Synthetic",
      confirmedBy: "operator",
      confirmedAt: "2026-10-03",
    },
  };
  const second = {
    ...newAssignment("ptm-card"),
    eventId: "event-b",
    hours: "40",
    fieldOrigins: { hours: "MANUAL" as const },
  };
  const person = { ...newRecipient(), assignments: [first, second] };
  const result = previewBulk(
    [person],
    [person.id],
    "ptm",
    { hours: "16" },
    "REPLACE",
    undefined,
    "event-a",
  );
  assert.equal(result.changes.length, 1);
  assert.equal(result.items[0].assignments[0].hours, "16");
  assert.deepEqual(result.items[0].assignments[0].outcome, first.outcome);
  assert.equal(result.items[0].assignments[1], second);
});
