import test from "node:test";
import assert from "node:assert/strict";
import { exportRegistry, parseImport } from "../../packages/printing/src";
import {
  applyBusinessRules,
  draftSchema,
  resolveDraft,
  validateBusinessRules,
} from "../../packages/contracts/src";
import {
  inferMapping,
  mapImportRow,
  type ImportPreview,
} from "../../apps/web/lib/imports";

test("real XLSX export/import retains per-person category and English fields through the LIVE_V1 draft contract", async () => {
  const columns = [
    { field: "personnelNumber", title: "Табельный номер" },
    { field: "employeeCategory", title: "Категория сотрудника" },
    { field: "fullNameRu", title: "ФИО RU" },
    { field: "fullNameKz", title: "ФИО KZ" },
    { field: "fullNameEn", title: "ФИО EN" },
    { field: "positionEn", title: "Должность EN" },
    { field: "workplaceEn", title: "Место работы EN" },
    { field: "trainingSubjectEn", title: "Программа / тема EN" },
    { field: "resultEn", title: "Результат / оценка EN" },
    { field: "departmentEn", title: "Подразделение EN" },
    { field: "employerAddressEn", title: "Юридический адрес работодателя EN" },
    { field: "biotIndustryEn", title: "Отрасль специальных компетенций EN" },
    {
      field: "biotKnowledgeResultEn",
      title: "Фактический результат проверки знаний EN",
    },
    {
      field: "biotProctoringResultEn",
      title: "Фактический результат прокторинга EN",
    },
    { field: "biotNotesEn", title: "Примечание к протоколу БиОТ EN" },
    { field: "documentDate", title: "Дата документа" },
  ];
  const source = [
    {
      personnelNumber: "00001",
      employeeCategory: "WORKER",
      fullNameRu: "Синтетический Один",
      fullNameKz: "Синтетикалық Бір",
      fullNameEn: "Synthetic One",
      positionEn: "Operator",
      workplaceEn: "Synthetic Company",
      trainingSubjectEn: "Safety course",
      resultEn: "Passed",
      departmentEn: "Operations",
      employerAddressEn: "Test address, 1",
      biotIndustryEn: "Industry",
      biotKnowledgeResultEn: "Passed",
      biotProctoringResultEn: "Confirmed",
      biotNotesEn: "Synthetic note",
      documentDate: "2026-10-01",
    },
    {
      personnelNumber: "00002",
      employeeCategory: "ITR",
      fullNameRu: "Синтетический Два",
      fullNameKz: "Синтетикалық Екі",
      fullNameEn: "Synthetic Two",
      positionEn: "Engineer",
      workplaceEn: "Synthetic Company",
      trainingSubjectEn: "Safety course",
      resultEn: "Passed",
      departmentEn: "Engineering",
      employerAddressEn: "Test address, 2",
      biotIndustryEn: "Industry",
      biotKnowledgeResultEn: "Passed",
      biotProctoringResultEn: "Confirmed",
      biotNotesEn: "Synthetic note",
      documentDate: "2026-10-03",
    },
  ];
  const exported = await exportRegistry(source, columns);
  assert.ok(exported.buffer.length > 1000);
  const parsed = await parseImport(
    exported.buffer,
    "xlsx",
    Object.fromEntries(columns.map((column) => [column.title, column.field])),
  );
  assert.equal(parsed.count, 2);
  assert.equal(parsed.canApply, true);
  const parsedRows = parsed.rows as { values: Record<string, string> }[];
  assert.equal(parsedRows[1].values.employeeCategory, "ITR");
  assert.equal(parsedRows[1].values.fullNameEn, "Synthetic Two");
  assert.equal(parsedRows[1].values.departmentEn, "Engineering");
  assert.equal(parsedRows[1].values.biotNotesEn, "Synthetic note");
  const preview: ImportPreview = {
    importId: "xlsx-live-contract",
    columns: parsed.headers as string[],
    total: 2,
    rows: (
      parsed.rawRows as {
        rowNumber: number;
        values: string[];
        errors: string[];
      }[]
    ).map((row) => ({
      sourceRow: row.rowNumber,
      values: row.values,
      errors: row.errors,
    })),
  };
  const mapping = inferMapping(preview.columns);
  const recipients = preview.rows.map((row) =>
    mapImportRow(preview, row, mapping, "biot-worker-card", "WORKER"),
  );
  const draft = resolveDraft(
    applyBusinessRules(
      draftSchema.parse({
        kind: "PERSON",
        schemaVersion: 2,
        englishAppendix: true,
        commonFields: {
          trainingSubject: "Проверочная программа",
          protocolDate: "2026-09-30",
        },
        items: recipients,
      }),
    ),
  ).draft;
  assert.equal(draft.items[0].personnelNumber, "00001");
  assert.equal(draft.items[1].personnelNumber, "00002");
  assert.equal(draft.items[1].employerAddressEn, "Test address, 2");
  assert.equal(
    draft.items[1].assignments[0].biotProctoringResultEn,
    "Confirmed",
  );
  assert.equal(draft.items[0].assignments[0].templateId, "biot-worker-card");
  assert.equal(
    draft.items[1].assignments[0].templateId,
    "biot-itr-certificate",
  );
  assert.equal(draft.items[0].assignments[0].validUntil, "2027-10-01");
  assert.equal(draft.items[1].assignments[0].validUntil, "2029-10-03");
  assert.equal(draft.items[0].assignments[1].documentDate, "2026-09-30");
  assert.equal(draft.items[1].assignments[1].documentDate, "2026-09-30");
  assert.deepEqual(validateBusinessRules(draft), []);
  assert.deepEqual(
    draftSchema.parse(JSON.parse(JSON.stringify(draft))),
    JSON.parse(JSON.stringify(draft)),
  );
});
