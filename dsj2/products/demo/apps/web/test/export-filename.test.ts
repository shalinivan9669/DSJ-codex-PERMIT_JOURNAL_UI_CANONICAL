import assert from "node:assert/strict";
import test from "node:test";
import { exportFileName } from "../lib/api";
test("customer partial bundle preserves server UTF-8 incompleteness label", () => {
  const name = "Организация Б — НЕПОЛНЫЙ.zip";
  assert.equal(
    exportFileName(
      `attachment; filename="_.zip"; filename*=UTF-8''${encodeURIComponent(name)}`,
      "Комплект заказчика.zip",
    ),
    name,
  );
});
test("server file names retain ordinary ASCII names without path segments", () => {
  assert.equal(
    exportFileName('attachment; filename="registry.xlsx"', "fallback.xlsx"),
    "registry.xlsx",
  );
  assert.equal(
    exportFileName('attachment; filename="../registry.xlsx"', "fallback.xlsx"),
    "registry.xlsx",
  );
});
test("missing and malformed filename headers use the supplied fallback", () => {
  assert.equal(exportFileName(null, "fallback.zip"), "fallback.zip");
  assert.equal(
    exportFileName("attachment; filename*=UTF-8''%ZZ", "fallback.zip"),
    "fallback.zip",
  );
});
