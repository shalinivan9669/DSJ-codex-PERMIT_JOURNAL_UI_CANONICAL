import test from "node:test";
import assert from "node:assert/strict";
import {
  reportKinds,
  reportDefinitions,
  reportCell,
  reportCreateSchema,
} from "../apps/api/src/lms/report-definitions";
import { safeCsvCell } from "../apps/api/src/lms/results-export";

test("report schemas preserve eight semantic reports and safe string values", () => {
  assert.equal(reportKinds.length, 8);
  assert.equal(
    new Set(reportKinds.map((k) => reportDefinitions[k].rowRu)).size,
    8,
  );
  for (const kind of reportKinds)
    for (const format of ["PDF", "XLSX", "CSV"]) {
      assert.equal(
        reportCreateSchema.parse({
          kind,
          format,
          requestKey: "00000000-0000-4000-8000-000000000001",
        }).kind,
        kind,
      );
      assert.ok(reportDefinitions[kind].columns.length >= 6);
    }
  assert.equal(
    reportCell({ bin: "001234567890" }, "bin", "ru"),
    "001234567890",
  );
  assert.equal(
    reportCell({ validUntil: null }, "validUntil", "kz"),
    "Белгісіз",
  );
  assert.equal(
    reportCell({ status: "UNKNOWN_VALIDITY" }, "status", "ru"),
    "Срок действия неизвестен",
  );
  for (const unsafe of ["=2+2", " +SUM(A1)", "\uFEFF@x", "-1"]) {
    assert.ok(safeCsvCell(unsafe).startsWith("\"'"));
  }
  assert.throws(() =>
    reportCreateSchema.parse({ kind: "SQL", format: "CSV", requestKey: "x" }),
  );
});
