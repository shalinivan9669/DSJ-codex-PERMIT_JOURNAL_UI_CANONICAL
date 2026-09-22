import test from "node:test";
import assert from "node:assert/strict";
import { newAssignment } from "../lib/types";
import {
  biotCategoriesForTemplate,
  updateAssignment,
} from "../lib/assignment-presets";
import { mapImportRow } from "../lib/imports";
import { assignmentSchema } from "@demo/contracts";

test("worker and ITR use distinct theory/production presets and calendar expiry", () => {
  const worker = updateAssignment(newAssignment(), {
    documentDate: "2028-02-29",
  });
  assert.equal(worker.biotCategory, "WORKER");
  assert.equal(worker.hours, "10");
  assert.equal(worker.productionHours, "16");
  assert.equal(worker.validUntil, "2029-02-28");
  const itr = updateAssignment(worker, { templateId: "biot-itr-certificate" });
  assert.equal(itr.biotCategory, "OHS_SPECIALIST_SPECIAL");
  assert.equal(itr.hours, "40");
  assert.equal(itr.productionHours, "");
  assert.equal(itr.validUntil, "2031-02-28");
  const manager = updateAssignment(itr, { biotCategory: "MANAGER_GENERAL" });
  assert.equal(manager.hours, "16");
  assert.equal(manager.validUntil, "2031-02-28");
  const council = updateAssignment(manager, {
    biotCategory: "COUNCIL_GENERAL",
  });
  assert.equal(council.hours, "24");
  assert.equal(council.validUntil, "");
  assert.deepEqual(biotCategoriesForTemplate("biot-worker-card"), ["WORKER"]);
  assert.equal(
    biotCategoriesForTemplate("biot-itr-certificate").includes("WORKER"),
    false,
  );
  assert.deepEqual(biotCategoriesForTemplate("biot-protocol"), ["WORKER"]);
  assert.equal(biotCategoriesForTemplate("biot-itr-protocol").length, 7);
  assert.equal(
    newAssignment("biot-itr-protocol").biotCategory,
    "OHS_SPECIALIST_SPECIAL",
  );
  assert.equal(worker.biotCheckType, "PERIODIC");
  const itrProtocol = newAssignment("biot-itr-protocol");
  assert.equal(itrProtocol.biotCheckType, "PERIODIC");
  assert.equal(itrProtocol.result, "");
  assert.equal(itrProtocol.biotKnowledgeResult, undefined);
  assert.equal(itrProtocol.biotProctoringResult, undefined);
});

test("new ITR protocol import retains employer identity and actual results without claiming a pass", () => {
  const preview = { importId: "itr-fields", columns: [], rows: [], total: 1 };
  const row = mapImportRow(
    preview,
    {
      sourceRow: 8,
      values: [
        "000123456789",
        "Цех Ә",
        "Адрес Қ",
        "Повторная",
        "62 балла",
        "Проверка не завершена",
        "000071",
        "2028-02-29",
      ],
    },
    [
      "employerBin",
      "departmentKz",
      "employerAddressKz",
      "biotCheckType",
      "biotKnowledgeResult",
      "biotProctoringResult",
      "biotUniqueNumber",
      "documentDate",
    ],
    "biot-itr-protocol",
  );
  assert.equal(row.employerBin, "000123456789");
  assert.equal(row.departmentKz, "Цех Ә");
  assert.equal(row.employerAddressKz, "Адрес Қ");
  const assignment = row.assignments[0];
  assert.equal(assignment.biotCheckType, "REPEAT");
  assert.equal(assignment.biotKnowledgeResult, "62 балла");
  assert.equal(assignment.biotProctoringResult, "Проверка не завершена");
  assert.equal(assignment.biotUniqueNumber, "000071");
  assert.equal(assignment.result, "");
  assert.equal(assignment.validUntil, "2031-02-28");
});

test("category and date transitions preserve manually supplied hours and expiry", () => {
  const worker = {
    ...newAssignment(),
    documentDate: "2028-02-29",
    hours: "48",
    productionHours: "24",
    validUntil: "2028-12-31",
  };
  const itr = updateAssignment(worker, { templateId: "biot-itr-certificate" });
  assert.equal(itr.hours, "48");
  assert.equal(itr.productionHours, "24");
  assert.equal(itr.validUntil, "2028-12-31");
  assert.equal(
    updateAssignment(itr, { documentDate: "2028-03-01" }).validUntil,
    "2028-12-31",
  );
  const trackedManual = updateAssignment(
    assignmentSchema.parse(
      JSON.parse(
        JSON.stringify(
          updateAssignment(worker, {
            hours: "10",
            productionHours: "16",
            validUntil: "2029-02-28",
          }),
        ),
      ),
    ),
    { templateId: "biot-itr-certificate" },
  );
  assert.equal(trackedManual.hours, "10");
  assert.equal(trackedManual.productionHours, "16");
  assert.equal(trackedManual.validUntil, "2029-02-28");
  assert.deepEqual(trackedManual.biotManualFields, [
    "hours",
    "productionHours",
    "validUntil",
  ]);
});

test("editing other values leaves legacy category-less records unchanged; moving out of BIOT removes only defaults", () => {
  const legacy = newAssignment();
  delete legacy.biotCategory;
  delete legacy.productionHours;
  legacy.hours = "72";
  legacy.validUntil = "2030-04-10";
  assert.deepEqual(updateAssignment(legacy, { result: "Проверено" }), {
    ...legacy,
    result: "Проверено",
  });
  const worker = updateAssignment(newAssignment(), {
    documentDate: "2028-02-29",
  });
  const other = updateAssignment(worker, { templateId: "pb-card" });
  assert.equal(other.biotCategory, undefined);
  assert.equal(other.hours, "");
  assert.equal(other.productionHours, "");
  assert.equal(other.validUntil, "");
  assert.equal(
    updateAssignment(
      { ...worker, validUntil: "2028-12-31" },
      { templateId: "pb-card" },
    ).validUntil,
    "2028-12-31",
  );
});

test("bulk document dates recompute only derived dates and preserve explicit date patches", () => {
  const worker = updateAssignment(newAssignment(), {
    documentDate: "2028-02-29",
  });
  assert.equal(
    updateAssignment(worker, { documentDate: "2029-03-01" }).validUntil,
    "2030-03-01",
  );
  assert.equal(
    updateAssignment(worker, {
      documentDate: "2029-03-01",
      validUntil: "2029-10-01",
    }).validUntil,
    "2029-10-01",
  );
  assert.equal(updateAssignment(worker, { documentDate: "" }).validUntil, "");
});

test("import category is resolved before independent columns and never overwrites source hours/dates", () => {
  const preview = { importId: "biot-import", columns: [], rows: [], total: 1 };
  const result = mapImportRow(
    preview,
    {
      sourceRow: 2,
      values: ["2028-02-29", "48", "2029-12-31", "OHS_SPECIALIST_SPECIAL"],
    },
    ["documentDate", "hours", "validUntil", "biotCategory"],
    "biot-itr-certificate",
  );
  assert.equal(result.assignments[0].hours, "48");
  assert.equal(result.assignments[0].validUntil, "2029-12-31");
  const calculated = mapImportRow(
    preview,
    { sourceRow: 3, values: ["2028-02-29"] },
    ["documentDate"],
    "biot-worker-card",
  );
  assert.equal(calculated.assignments[0].validUntil, "2029-02-28");
  assert.equal(calculated.assignments[0].productionHours, "16");
  const blank = mapImportRow(
    preview,
    { sourceRow: 4, values: ["2028-02-29", "", ""] },
    ["documentDate", "hours", "validUntil"],
    "biot-worker-card",
  );
  assert.equal(blank.assignments[0].hours, "");
  assert.equal(blank.assignments[0].validUntil, "");
  assert.deepEqual(blank.assignments[0].biotManualFields, [
    "hours",
    "validUntil",
  ]);
  const sameDefault = mapImportRow(
    preview,
    { sourceRow: 6, values: ["2028-02-29", "10", "2029-02-28"] },
    ["documentDate", "hours", "validUntil"],
    "biot-worker-card",
  );
  const reloaded = assignmentSchema.parse(
    JSON.parse(JSON.stringify(sameDefault.assignments[0])),
  );
  const changedCategory = updateAssignment(reloaded, {
    templateId: "biot-itr-certificate",
  });
  assert.equal(changedCategory.hours, "10");
  assert.equal(changedCategory.validUntil, "2029-02-28");
  assert.throws(
    () =>
      mapImportRow(
        preview,
        { sourceRow: 5, values: ["MANAGER_GENERAL"] },
        ["biotCategory"],
        "biot-worker-card",
      ),
    /Исходная строка 5/,
  );
});
