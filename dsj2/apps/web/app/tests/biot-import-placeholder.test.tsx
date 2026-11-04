import assert from "node:assert/strict";
import { test } from "node:test";
import { canReuseImportPlaceholder } from "../../lib/biot-import-placeholder";

const fresh = {
  id: "new",
  fullName: "",
  photoDataUrl: "",
  isCertificateManual: false,
  certificateNumber: "AUTOMATIC-1",
  settings: { type: "BIOT", issueDate: "2026-11-04" },
};

test("reuses only a single untouched placeholder, even if its id differs", () => {
  assert.equal(canReuseImportPlaceholder([{ ...fresh, id: "old" }], fresh), true);
  assert.equal(canReuseImportPlaceholder([], fresh), false);
  assert.equal(canReuseImportPlaceholder([{ ...fresh }, { ...fresh }], fresh), false);
});

test("preserves entered information, manual numbers, photographs and different settings", () => {
  for (const changed of [
    { fullName: "Тестовый сотрудник" },
    { photoDataUrl: "data:image/png;base64,AA==" },
    { isCertificateManual: true },
    { settings: { type: "PS", issueDate: "2026-11-04" } },
  ]) {
    assert.equal(canReuseImportPlaceholder([{ ...fresh, ...changed }], fresh), false);
  }
});
