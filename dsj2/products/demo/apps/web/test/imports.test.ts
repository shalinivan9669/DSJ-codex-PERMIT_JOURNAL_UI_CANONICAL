import test from "node:test";
import assert from "node:assert/strict";
import {
  inferMapping,
  importApplyErrorText,
  importedEmployeeCategory,
  initialImportTemplate,
  importIssueText,
  mapImportRow,
  type ImportPreview,
} from "../lib/imports";
import { trainingEventSchema } from "@demo/contracts";
import { ApiError } from "../lib/api";

test("retained starter row-limit error explains recovery without masking unrelated failures", () => {
  const error = new ApiError(
    422,
    "Максимум 250 получателей; строки не обрезаны",
    { code: "ROW_LIMIT" },
    "trace-import",
  );
  const message = importApplyErrorText(error, true);
  assert.match(message, /Ранее заполненная, затем очищенная строка/);
  assert.match(message, /Состав сохранён/);
  assert.match(message, /администратору центра/);
  assert.match(message, /trace-import/);
  assert.doesNotMatch(importApplyErrorText(error, false), /очищенная строка/);
  assert.equal(
    importApplyErrorText(
      new ApiError(409, "Заявка изменена", { code: "REVISION_CONFLICT" }),
      true,
    ),
    "Заявка изменена",
  );
});

test("an import without selected training creates only recipients and keeps their source identity", () => {
  assert.equal(initialImportTemplate(), "");
  const preview: ImportPreview = {
    importId: "people-only",
    columns: [
      "ФИО RU",
      "Должность RU",
      "Категория сотрудника",
      "Табельный номер",
    ],
    rows: [],
    total: 1,
  };
  const item = mapImportRow(
    preview,
    { sourceRow: 2, values: ["Тест Импорта", "Инженер", "ITR", "000042"] },
    inferMapping(preview.columns),
    "",
  );
  assert.equal(item.fullNameRu, "Тест Импорта");
  assert.equal(item.positionRu, "Инженер");
  assert.equal(item.employeeCategory, "ITR");
  assert.equal(item.personnelNumber, "000042");
  assert.equal(item.importId, "people-only");
  assert.equal(item.sourceRow, 2);
  assert.deepEqual(item.assignments, []);
});

test("an explicitly selected training or existing BiOT group remains selected during import", () => {
  for (const [protocol, card] of [
    ["biot-protocol", "biot-worker-card"],
    ["biot-itr-protocol", "biot-itr-certificate"],
  ]) {
    const event = trainingEventSchema.parse({
      id: "group",
      title: "Группа",
      protocolTemplateId: protocol,
      commonFields: {},
    });
    assert.equal(initialImportTemplate(event), card);
  }
  const preview: ImportPreview = {
    importId: "selected-ptm",
    columns: ["ФИО RU"],
    rows: [],
    total: 1,
  };
  assert.equal(
    mapImportRow(
      preview,
      { sourceRow: 2, values: ["Тест"] },
      ["fullNameRu"],
      "ptm-card",
    ).assignments[0].templateId,
    "ptm-card",
  );
});

test("recipient-only import never silently discards mapped factual training data", () => {
  const preview: ImportPreview = {
    importId: "factual-result",
    columns: ["ФИО RU", "Результат / оценка"],
    rows: [],
    total: 1,
  };
  assert.throws(
    () =>
      mapImportRow(
        preview,
        { sourceRow: 2, values: ["Тест", "Сдал"] },
        ["fullNameRu", "result"],
        "",
      ),
    /выберите документ/,
  );
  const empty = mapImportRow(
    preview,
    { sourceRow: 2, values: ["Тест", ""] },
    ["fullNameRu", "result"],
    "",
  );
  assert.deepEqual(empty.assignments, []);
});

test("explicit imported waiting and negative result words override positive defaults while grades and free text stay independent", () => {
  const preview: ImportPreview = {
    importId: "explicit-import-outcomes",
    columns: ["ФИО RU", "Результат / оценка"],
    rows: [],
    total: 1,
  };
  const cases = [
    ["Не сдал", "FAILED", "Тапсырмады"],
    ["Тапсырмады", "FAILED", "Тапсырмады"],
    [" НЕ СДАЛ / ТАПСЫРМАДЫ ", "FAILED", "Тапсырмады"],
    ["Не явился", "ABSENT", "Келмеді"],
    ["Келмеді", "ABSENT", "Келмеді"],
    ["Не явился/Келмеді", "ABSENT", "Келмеді"],
    ["Не подтверждено", "UNKNOWN", "Расталмаған"],
    ["Расталмаған", "UNKNOWN", "Расталмаған"],
    ["Не подтверждено / Расталмаған", "UNKNOWN", "Расталмаған"],
  ] as const;
  for (const template of ["biot-worker-card", "ptm-card", "pb-card"] as const) {
    for (const [result, status, resultKz] of cases) {
      const sourceRow = { sourceRow: 8, values: ["Тест исключения", result] };
      const originalSource = structuredClone(sourceRow);
      const assignment = mapImportRow(
        preview,
        sourceRow,
        ["fullNameRu", "result"],
        template,
      ).assignments[0];
      assert.equal(assignment.result, result);
      assert.equal(assignment.resultKz, resultKz);
      assert.deepEqual(assignment.outcome, {
        status,
        source: "Импортированный результат, строка 8",
      });
      assert.equal(assignment.fieldOrigins?.result, "IMPORTED");
      assert.equal(assignment.fieldOrigins?.outcome, "IMPORTED");
      assert.deepEqual(sourceRow, originalSource);
    }
  }
  for (const result of ["", "\u00a0\u200b"]) {
    const assignment = mapImportRow(
      preview,
      { sourceRow: 9, values: ["Тест", result] },
      ["fullNameRu", "result"],
      "pb-card",
    ).assignments[0];
    assert.equal(assignment.result, result);
    assert.equal(assignment.outcome?.status, "UNKNOWN");
    assert.equal(assignment.fieldOrigins?.result, "CLEARED");
    assert.equal(assignment.fieldOrigins?.outcome, "IMPORTED");
  }
  for (const result of [
    "62 балла",
    "Сдал",
    "Проверка не завершена",
    "Не сдал / Келмеді",
    "constructor",
  ]) {
    const assignment = mapImportRow(
      preview,
      { sourceRow: 10, values: ["Тест", result] },
      ["fullNameRu", "result"],
      "ptm-card",
    ).assignments[0];
    assert.equal(assignment.result, result);
    assert.equal(assignment.outcome?.status, "PASSED");
    assert.equal(
      assignment.outcome?.source,
      "Стандартный положительный результат при создании назначения",
    );
    assert.equal(assignment.fieldOrigins?.result, "IMPORTED");
  }
});
test("structured server row-limit issue becomes operator text rather than a React child object", () => {
  assert.equal(
    importIssueText({ code: "ROW_LIMIT", count: 101, limit: 100 }),
    "В исходном листе 101 строк. Технический объём одной заявки — 100 получателей. Строки не обрезаны; обратитесь к администратору центра.",
  );
  assert.equal(
    importIssueText("Ошибка исходной строки"),
    "Ошибка исходной строки",
  );
});

test("a mixed worker/ITR import chooses each person's BiOT form and ignores removed English columns", () => {
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
    "",
    "",
    "",
    "",
    "",
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
  assert.equal(itr.assignments[0].biotCategory, "ITR_STANDARD");
  assert.equal(itr.personnelNumber, "00002");
  assert.equal(itr.fullNameEn, undefined);
  assert.equal(itr.positionEn, undefined);
  assert.equal(itr.workplaceEn, undefined);
  assert.equal(itr.assignments[0].trainingSubjectEn, undefined);
  assert.equal(itr.assignments[0].fieldOrigins?.trainingSubjectEn, undefined);
  assert.equal(itr.assignments[0].resultEn, undefined);
});

test("removed English employer and BiOT columns cannot be imported through old mappings", () => {
  const columns = [
    "Подразделение EN",
    "Юридический адрес работодателя EN",
    "Отрасль специальных компетенций EN",
    "Фактический результат проверки знаний EN",
    "Фактический результат прокторинга EN",
    "Примечание к протоколу БиОТ EN",
  ];
  const mapping = inferMapping(columns);
  assert.deepEqual(mapping, Array(6).fill(""));
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
  assert.equal(item.departmentEn, undefined);
  assert.equal(item.employerAddressEn, undefined);
  assert.equal(item.assignments[0].biotIndustryEn, undefined);
  assert.equal(item.assignments[0].biotKnowledgeResultEn, undefined);
  assert.equal(item.assignments[0].biotProctoringResultEn, undefined);
  assert.equal(item.assignments[0].biotNotesEn, undefined);
  assert.equal(item.assignments[0].fieldOrigins?.biotIndustryEn, undefined);
  assert.deepEqual(
    inferMapping(["fullNameEn", "positionEn", "ФИО английский"]),
    ["", "", ""],
  );
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
  assert.equal(value.assignments[0].result, "Сдал/Тапсырды");
  assert.equal(value.assignments[0].resultKz, "Тапсырды");
  assert.deepEqual(value.assignments[0].outcome, {
    status: "PASSED",
    source: "Стандартный положительный результат при создании назначения",
  });
  assert.equal(value.assignments[0].fieldOrigins?.outcome, "AUTO");
  assert.equal(value.assignments[0].fieldOrigins?.result, "COURSE");
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

test("unmapped placeholders retain positive defaults while explicit empty mapped facts stay cleared", () => {
  const preview: ImportPreview = {
    importId: "origin-boundary",
    columns: ["ФИО", "Результат", "Дата", "Программа KZ"],
    rows: [],
    total: 1,
  };
  const row = {
    sourceRow: 2,
    values: ["Синтетический Получатель", "", "", "Өз бағдарламасы"],
  };
  const missing = mapImportRow(preview, row, ["fullNameRu"], "pb-card")
    .assignments[0];
  const placeholder = mapImportRow(
    preview,
    row,
    ["fullNameRu", "", "", "trainingSubjectKz"],
    "pb-card",
  ).assignments[0];
  const cleared = mapImportRow(
    preview,
    row,
    ["fullNameRu", "result", "documentDate", "trainingSubjectKz"],
    "pb-card",
  ).assignments[0];
  assert.equal(missing.outcome?.status, "PASSED");
  assert.equal(placeholder.outcome?.status, "PASSED");
  assert.equal(placeholder.trainingSubjectKz, "Өз бағдарламасы");
  assert.equal(placeholder.fieldOrigins?.trainingSubjectKz, "IMPORTED");
  assert.equal(cleared.outcome?.status, "UNKNOWN");
  assert.equal(cleared.fieldOrigins?.result, "CLEARED");
  assert.equal(cleared.fieldOrigins?.documentDate, "CLEARED");
});

test("imported waiting and explicit enum outcomes never inherit a positive default", () => {
  const preview: ImportPreview = {
    importId: "status-boundary",
    columns: [],
    rows: [],
    total: 1,
  };
  for (const [value, status] of [
    ["Ожидает сдачи", "UNKNOWN"],
    ["UNKNOWN", "UNKNOWN"],
    ["FAILED", "FAILED"],
    ["ABSENT", "ABSENT"],
    ["Не сдал", "FAILED"],
    ["Не явился", "ABSENT"],
  ]) {
    const a = mapImportRow(
      preview,
      { sourceRow: 2, values: [value, "Өз нәтижесі"] },
      ["result", "resultKz"],
      "ps-card",
    ).assignments[0];
    assert.equal(a.outcome?.status, status, value);
    assert.equal(a.resultKz, "Өз нәтижесі");
    assert.equal(a.fieldOrigins?.resultKz, "IMPORTED");
  }
});
