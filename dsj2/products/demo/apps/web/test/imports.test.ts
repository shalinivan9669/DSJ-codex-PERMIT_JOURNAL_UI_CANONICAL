import test from "node:test";
import assert from "node:assert/strict";
import {
  inferMapping,
  importedEmployeeCategory,
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

test("a mixed worker/ITR import chooses each person's BiOT form and retains explicit English fields", () => {
  const preview: ImportPreview = {
    importId: "mixed-live-import",
    columns: [
      "Табельный номер",
      "Категория сотрудника",
      "ФИО RU",
      "ФИО KZ",
      "ФИО EN",
      "Должность EN",
      "Место работы EN",
      "Программа / тема EN",
      "Результат / оценка EN",
    ],
    rows: [],
    total: 2,
  };
  const mapping = inferMapping(preview.columns);
  assert.deepEqual(mapping, [
    "personnelNumber",
    "employeeCategory",
    "fullNameRu",
    "fullNameKz",
    "fullNameEn",
    "positionEn",
    "workplaceEn",
    "trainingSubjectEn",
    "resultEn",
  ]);
  const worker = mapImportRow(
    preview,
    {
      sourceRow: 2,
      values: [
        "00001",
        "Рабочий",
        "Тест Один",
        "Тест Бір",
        "Test One",
        "Operator",
        "Synthetic company",
        "Safety course",
        "Passed",
      ],
    },
    mapping,
    "biot-worker-card",
    "WORKER",
  );
  const itr = mapImportRow(
    preview,
    {
      sourceRow: 3,
      values: [
        "00002",
        "ИТР",
        "Тест Два",
        "Тест Екі",
        "Test Two",
        "Engineer",
        "Synthetic company",
        "Safety course",
        "Passed",
      ],
    },
    mapping,
    "biot-worker-card",
    "WORKER",
  );
  assert.equal(worker.employeeCategory, "WORKER");
  assert.equal(itr.employeeCategory, "ITR");
  assert.equal(worker.assignments[0].templateId, "biot-worker-card");
  assert.equal(itr.assignments[0].templateId, "biot-itr-certificate");
  assert.equal(itr.assignments[0].biotCategory, "OHS_SPECIALIST_SPECIAL");
  assert.equal(itr.personnelNumber, "00002");
  assert.equal(itr.fullNameEn, "Test Two");
  assert.equal(itr.positionEn, "Engineer");
  assert.equal(itr.workplaceEn, "Synthetic company");
  assert.equal(itr.assignments[0].trainingSubjectEn, "Safety course");
  assert.equal(itr.assignments[0].fieldOrigins?.trainingSubjectEn, "IMPORTED");
  assert.equal(itr.assignments[0].resultEn, "Passed");
});

test("reviewed English employer and BiOT source fields remain on the right imported objects", () => {
  const columns = [
    "Подразделение EN",
    "Юридический адрес работодателя EN",
    "Отрасль специальных компетенций EN",
    "Фактический результат проверки знаний EN",
    "Фактический результат прокторинга EN",
    "Примечание к протоколу БиОТ EN",
  ];
  const mapping = inferMapping(columns);
  assert.deepEqual(mapping, [
    "departmentEn",
    "employerAddressEn",
    "biotIndustryEn",
    "biotKnowledgeResultEn",
    "biotProctoringResultEn",
    "biotNotesEn",
  ]);
  const item = mapImportRow(
    { importId: "english-source", columns, rows: [], total: 1 },
    {
      sourceRow: 2,
      values: [
        "Division",
        "Test address",
        "Industry",
        "Passed",
        "Confirmed",
        "Note",
      ],
    },
    mapping,
    "biot-itr-certificate",
  );
  assert.equal(item.departmentEn, "Division");
  assert.equal(item.employerAddressEn, "Test address");
  assert.equal(item.assignments[0].biotIndustryEn, "Industry");
  assert.equal(item.assignments[0].biotKnowledgeResultEn, "Passed");
  assert.equal(item.assignments[0].biotProctoringResultEn, "Confirmed");
  assert.equal(item.assignments[0].biotNotesEn, "Note");
  assert.equal(item.assignments[0].fieldOrigins?.biotIndustryEn, "IMPORTED");
});

test("invalid employee categories and contradictions with imported BiOT category require correction", () => {
  assert.equal(importedEmployeeCategory(" жұмысшы ", 2), "WORKER");
  assert.equal(importedEmployeeCategory("itr", 2), "ITR");
  assert.throws(
    () => importedEmployeeCategory("Инженер", 8),
    /Исходная строка 8/,
  );
  const preview = {
    importId: "invalid-category",
    columns: [],
    rows: [],
    total: 1,
  };
  assert.throws(
    () =>
      mapImportRow(
        preview,
        { sourceRow: 2, values: ["Рабочий", "OHS_SPECIALIST_SPECIAL"] },
        ["employeeCategory", "biotCategory"],
        "biot-worker-card",
      ),
    /не соответствует/,
  );
  const ptm = mapImportRow(
    preview,
    { sourceRow: 2, values: ["ITR", "Дизайнер"] },
    ["employeeCategory", "positionRu"],
    "ptm-card",
  );
  assert.equal(ptm.employeeCategory, "ITR");
  assert.equal(ptm.assignments[0].biotCategory, undefined);
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
