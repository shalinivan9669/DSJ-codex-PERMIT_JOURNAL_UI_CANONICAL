import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  itemSchema,
  assignmentSchema,
  protocolTemplateFor,
} from "../packages/contracts/src";
import { compareImportedRows } from "../apps/api/src/imports";
import {
  customerExportProfileSchema,
  projectCustomerRegistry,
  safeTsvCell,
  safeFilePart,
  deliveryFileNames,
  registryTsv,
} from "../apps/api/src/delivery";

const fixture = (name: string) =>
  (
    JSON.parse(readFileSync(join(__dirname, "fixtures", name), "utf8"))
      .people as Record<string, string>[]
  ).map((person, index) => {
    const { externalPersonKey, ...fields } = person;
    return itemSchema.parse({
      ...fields,
      id: externalPersonKey,
      externalId: externalPersonKey,
      sourceRow: index + 2,
      importId: name,
    });
  });
test("actual revised 100-person fixture produces 2 added / 3 changed / 2 missing / 95 unchanged and retains 102", () => {
  const original = fixture("ot-people.json");
  const revised = fixture("ot-people-revised.json");
  const result = compareImportedRows(original, revised);
  assert.deepEqual(result.counts, {
    added: 2,
    changed: 3,
    unchanged: 95,
    missing: 2,
    ambiguous: 0,
  });
  assert.equal(result.retainedTotal, 102);
  assert.deepEqual(
    result.rows
      .filter((row) => row.category === "changed")
      .map((row) => row.targetId),
    ["DEMO-P003", "DEMO-P010", "DEMO-P020"],
  );
  assert.equal(original[0].personnelNumber, "000001");
  assert.deepEqual(
    result.rows
      .filter((row) => row.category === "missing")
      .map((row) => row.targetId),
    ["DEMO-P099", "DEMO-P100"],
  );
});
test("names never auto-merge; duplicated source IDs are ambiguous; personnel numbers stay employer scoped", () => {
  const existing = [
    itemSchema.parse({
      id: "a",
      fullNameRu: "Одинаковое Имя",
      personnelNumber: "0007",
      employerId: "employer-a",
    }),
  ];
  const incoming = (values: object) =>
    itemSchema.parse({
      id: "source",
      fullNameRu: "Одинаковое Имя",
      sourceRow: 2,
      ...values,
    });
  assert.equal(
    compareImportedRows(existing, [incoming({})]).counts.ambiguous,
    1,
  );
  assert.equal(
    compareImportedRows(existing, [
      incoming({ personnelNumber: "0007", employerId: "employer-b" }),
    ]).counts.added,
    1,
  );
  assert.equal(
    compareImportedRows(existing, [
      incoming({ personnelNumber: "0007", employerId: "employer-a" }),
    ]).counts.unchanged,
    1,
  );
  const repeated = compareImportedRows(existing, [
    incoming({ externalId: "same" }),
    incoming({ externalId: "same", sourceRow: 3 }),
  ]);
  assert.equal(repeated.counts.ambiguous, 2);
});
test("blank retention and field mask never copy list assignments or assessment results", () => {
  const before = itemSchema.parse({
    id: "p",
    externalId: "stable",
    fullNameRu: "Имя",
    positionRu: "Мастер",
    assignments: [
      assignmentSchema.parse({
        id: "a",
        templateId: "pb-card",
        result: "Факт",
      }),
    ],
  });
  const incoming = itemSchema.parse({
    id: "source",
    externalId: "stable",
    fullNameRu: "",
    positionRu: "Инженер",
  });
  const result = compareImportedRows([before], [incoming], {
    fieldMask: ["fullNameRu", "positionRu"],
  });
  assert.deepEqual(
    result.rows[0].changes.map((change) => change.field),
    ["positionRu"],
  );
  assert.equal(before.assignments[0].result, "Факт");
  assert.equal(
    compareImportedRows([before], [incoming], {
      fieldMask: ["fullNameRu"],
      blankMode: "CLEAR",
    }).rows[0].changes[0].newValue,
    "",
  );
});

test("reconciliation exposes explicit employee category and supplied English corrections without overwriting assessment facts", () => {
  const existing = itemSchema.parse({
    id: "existing",
    externalId: "stable-en",
    employeeCategory: "WORKER",
    fullNameRu: "Тест",
    fullNameEn: "Test Old",
    positionEn: "Operator",
    workplaceEn: "Original Company",
    assignments: [
      assignmentSchema.parse({
        id: "assessment",
        templateId: "ptm-card",
        result: "Подтверждённый факт",
      }),
    ],
  });
  const incoming = itemSchema.parse({
    id: "incoming",
    externalId: "stable-en",
    employeeCategory: "ITR",
    fullNameRu: "Тест",
    fullNameEn: "Test New",
    positionEn: "Engineer",
    workplaceEn: "",
    assignments: [
      assignmentSchema.parse({
        id: "untrusted-assessment",
        templateId: "ptm-card",
        result: "Подмена",
      }),
    ],
  });
  const diff = compareImportedRows([existing], [incoming]);
  assert.equal(diff.counts.changed, 1);
  assert.deepEqual(
    diff.rows[0].changes.map((change) => change.field),
    ["employeeCategory", "fullNameEn", "positionEn"],
  );
  assert.equal(existing.assignments[0].result, "Подтверждённый факт");
  assert.equal(existing.workplaceEn, "Original Company");
});
const profile = customerExportProfileSchema.parse({
  name: "Реестр заказчика",
  columns: [
    { field: "personnelNumber", title: "Табельный номер" },
    { field: "fullNameRu", title: "ФИО" },
    { field: "documentNumber", title: "Документ" },
    { field: "documentDate", title: "Дата", type: "DATE_ONLY" },
  ],
});
test("customer export follows source ordering and exact column order, dates and text IDs", () => {
  const rows = [
    {
      id: "b",
      requestId: "r",
      sourceRow: 4,
      personnelNumber: "000002",
      fullNameRu: "Я",
      number: "PB-002",
      assignment: { documentDate: "2026-09-22" },
    },
    {
      id: "a",
      requestId: "r",
      sourceRow: 2,
      personnelNumber: "000001",
      fullNameRu: "=1+1",
      number: "PB-001",
      assignment: { documentDate: "2026-09-21" },
    },
  ];
  const result = projectCustomerRegistry(rows, {
    ...profile,
    dateFormat: "DD.MM.YYYY",
  });
  assert.deepEqual(Object.values(result.items[0]), [
    "000001",
    "=1+1",
    "PB-001",
    "21.09.2026",
  ]);
  assert.match(registryTsv(result), /000001\t'=1\+1\tPB-001/);
  assert.equal(rows[1].fullNameRu, "=1+1");
  for (const unsafe of ["=1+1", "+1", "-1", "@SUM()", " \t=1"])
    assert.match(safeTsvCell(unsafe), /^"?'/);
});
test("person summary rejects two events in one number cell instead of joining or dropping numbers", () => {
  assert.throws(
    () =>
      projectCustomerRegistry(
        [
          { requestId: "r", id: "p", number: "001" },
          { requestId: "r", id: "p", number: "002" },
        ],
        { ...profile, rowMode: "PER_PERSON" },
      ),
    /несколько значений/,
  );
});
test("RU/KZ file names resist traversal, Windows reserved paths, collisions and preserve source values", () => {
  for (const input of ["../CON", "NUL", "LPT1.txt", "../../Аты:жөні\u0000"]) {
    const name = safeFilePart(input);
    assert.ok(!name.includes(".."));
    assert.ok(!/[\\/:\p{Cc}]/u.test(name));
    assert.ok(!/^(CON|NUL|LPT1)(\.|$)/i.test(name));
  }
  const row = {
    documentId: "d",
    fullNameRu: "Ә Ғ Қ Ң Ө Ұ Ү Һ І",
    personnelNumber: "000001",
    number: "002",
    assignment: { templateId: "pb-card" },
  };
  const artifacts = [
    { id: "a", documentId: "d", format: "PDF", fileName: "old.pdf" },
    { id: "b", documentId: "d", format: "PDF", fileName: "old.pdf" },
  ];
  const named = deliveryFileNames(artifacts, [row], profile);
  assert.equal(new Set(named.map((file) => file.fileName)).size, 2);
  assert.match(named[0].fileName, /000001 — Ә Ғ Қ Ң Ө Ұ Ү Һ І/);
  assert.deepEqual(
    named,
    deliveryFileNames([...artifacts].reverse(), [row], profile),
  );
  assert.equal(artifacts[0].fileName, "old.pdf");
});
test("mixed worker/ITR registry protocol resolver distinguishes their actual form", () => {
  const protocols = [
    { templateId: "biot-protocol", number: "WORKER-001" },
    { templateId: "biot-itr-protocol", number: "ITR-002" },
  ];
  assert.equal(
    protocols.find(
      (document) =>
        document.templateId === protocolTemplateFor("biot-worker-card"),
    )?.number,
    "WORKER-001",
  );
  assert.equal(
    protocols.find(
      (document) =>
        document.templateId === protocolTemplateFor("biot-itr-certificate"),
    )?.number,
    "ITR-002",
  );
});
