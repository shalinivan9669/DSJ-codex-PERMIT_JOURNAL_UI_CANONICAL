import test from "node:test";
import assert from "node:assert/strict";
import {
  inferMapping,
  importIssueText,
  mapImportRow,
  type ImportPreview,
} from "../lib/imports";
test("structured server row-limit issue becomes operator text rather than a React child object", () => {
  assert.equal(
    importIssueText({ code: "ROW_LIMIT", count: 101, limit: 100 }),
    "В исходном листе 101 строк. Для одной заявки выберите не более 100 получателей.",
  );
  assert.equal(
    importIssueText("Ошибка исходной строки"),
    "Ошибка исходной строки",
  );
});
test("mapping keeps independent RU/KZ, leading zeros, Unicode and partial source rows", () => {
  const preview: ImportPreview = {
    importId: "sha-fixed",
    columns: ["ФИО RU", "ФИО KZ", "Место работы RU"],
    rows: [],
    total: 1,
  };
  const row = { sourceRow: 12, values: ["00123", "Ә Ғ Қ Ң Ө Ұ Ү Һ І", ""] };
  const value = mapImportRow(
    preview,
    row,
    inferMapping(preview.columns),
    "ps-witness",
  );
  assert.equal(value.fullNameRu, "00123");
  assert.equal(value.fullNameKz, "Ә Ғ Қ Ң Ө Ұ Ү Һ І");
  assert.equal(value.sourceRow, 12);
  assert.equal(value.assignments[0].result, "");
  assert.equal(value.assignments[0].documentDate, "");
  assert.equal(
    mapImportRow(preview, row, inferMapping(preview.columns), "ps-witness").id,
    value.id,
  );
});
test("formula-looking text is preserved as data and ambiguous duplicate mapping is not inferred", () => {
  const preview: ImportPreview = {
    importId: "safe",
    columns: ["ФИО RU", "ФИО RU", "Должность KZ"],
    rows: [],
    total: 1,
  };
  const mapping = inferMapping(preview.columns);
  assert.deepEqual(mapping, ["fullNameRu", "", "positionKz"]);
  const value = mapImportRow(
    preview,
    { sourceRow: 2, values: ["=1+1", "ignored", "Қызмет"] },
    mapping,
    "pb-card",
  );
  assert.equal(value.fullNameRu, "=1+1");
  assert.equal(value.positionKz, "Қызмет");
});
