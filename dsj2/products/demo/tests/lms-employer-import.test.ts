import test from "node:test";
import assert from "node:assert/strict";
import {
  employerImportRowSchema,
  importRowErrors,
  mapImportRows,
  reconcileEmployerRows,
} from "../apps/api/src/lms/employer-import-rules";
const row = (value: Record<string, unknown>) =>
  employerImportRowSchema.parse({ sourceRow: 1, ...value });
test("N03 weak identity produces explicit choices; no guessing or account merge", () => {
  const candidates = [
    { id: "one", data: { fullNameRu: "Иван Петров", email: "a@example.test" } },
  ];
  const weak = reconcileEmployerRows(
    [row({ fullNameRu: "Иван Петров" })],
    candidates,
  )[0];
  assert.deepEqual(weak.errors, ["MATCH_REQUIRED"]);
  assert.equal(weak.recipientId, null);
  assert.equal(
    reconcileEmployerRows(
      [row({ recipientId: "one", resolution: "REUSE" })],
      candidates,
    )[0].recipientId,
    "one",
  );
  assert.ok(
    reconcileEmployerRows(
      [row({ recipientId: "foreign", fullNameRu: "Other" })],
      candidates,
    )[0].errors.includes("RECIPIENT_UNAVAILABLE"),
  );
});
test("N03 duplicate rows and strong identifiers cannot be silently imported twice", () => {
  const result = reconcileEmployerRows(
    [
      row({ fullNameRu: "One", iin: "000000000001" }),
      row({ sourceRow: 2, fullNameRu: "Two", iin: "000000000001" }),
    ],
    [],
  );
  assert.ok(result.every((entry) => entry.errors.includes("DUPLICATE_ROW")));
  assert.equal(
    reconcileEmployerRows(
      [
        row({ fullNameRu: "One", iin: "000000000001" }),
        row({
          sourceRow: 2,
          fullNameRu: "Two",
          iin: "000000000001",
          resolution: "SKIP",
        }),
      ],
      [],
    )[0].errors.length,
    0,
  );
  assert.ok(
    reconcileEmployerRows(
      [row({ fullNameRu: "New", iin: "000000000001", resolution: "NEW" })],
      [{ id: "known", data: { iin: "000000000001" } }],
    )[0].errors.includes("MATCH_REQUIRED"),
  );
});
test("N03 source mapping preserves leading zeroes, formula errors and optional IIN", () => {
  const [mapped] = mapImportRows(
    ["ФИО", "ИИН"],
    [
      {
        rowNumber: 2,
        values: ["Synthetic", "000000000001"],
        errors: ["FORMULA_NOT_ALLOWED"],
      },
    ],
    { fullNameRu: "ФИО", iin: "ИИН" },
  );
  assert.equal(mapped.iin, "000000000001");
  assert.ok(importRowErrors(mapped).includes("FORMULA_NOT_ALLOWED"));
  assert.deepEqual(
    importRowErrors(
      row({ fullNameRu: "Synthetic", phone: "+7 (700) 000-00-00" }),
    ),
    [],
  );
  assert.ok(
    importRowErrors(row({ fullNameRu: "=HYPERLINK(x)" })).includes(
      "UNSAFE_CELL",
    ),
  );
  assert.ok(
    importRowErrors(row({ fullNameRu: "Synthetic", course: "Other" }), [
      "Allowed",
    ]).includes("COURSE_MISMATCH"),
  );
});
