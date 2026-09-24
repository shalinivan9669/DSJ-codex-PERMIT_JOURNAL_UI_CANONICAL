import test from "node:test";
import assert from "node:assert/strict";
import { itemSchema } from "@demo/contracts";
import { matchBulkPhotos, photoEmployerScope } from "../lib/bulk-photos";

test("100 photos match stable IDs without opening person panels or matching equal names", () => {
  const items = Array.from({ length: 100 }, (_, n) =>
    itemSchema.parse({
      id: String(n),
      externalId: `DEMO-P${String(n + 1).padStart(3, "0")}`,
      fullNameRu: "Одинаковое Имя",
    }),
  );
  const files = items.map((item) => ({
    name: item.externalId + ".png",
    type: "image/png",
    size: 4000,
  }));
  const result = matchBulkPhotos(items, files, { mode: "EXTERNAL_ID" });
  assert.equal(result.matched, 100);
  assert.equal(result.missing.length, 0);
  assert.equal(result.ambiguous, 0);
  const nameOnly = matchBulkPhotos(
    items,
    [{ name: "Одинаковое Имя.png", type: "image/png", size: 4000 }],
    { mode: "EXTERNAL_ID" },
  );
  assert.equal(nameOnly.matched, 0);
});
test("personnel filenames preserve zeroes and require explicit employer and period scope", () => {
  const a = itemSchema.parse({
    id: "a",
    personnelNumber: "000007",
    employerId: "employer-a",
    employmentPeriod: "2026",
  });
  const b = itemSchema.parse({
    id: "b",
    personnelNumber: "000007",
    employerId: "employer-b",
    employmentPeriod: "2026",
  });
  const files = [{ name: "000007.jpg", size: 20, type: "image/jpeg" }];
  const result = matchBulkPhotos([a, b], files, {
    mode: "PERSONNEL_NUMBER",
    employerScope: photoEmployerScope(a),
  });
  assert.equal(result.rows[0].rowId, "a");
  assert.equal(result.matched, 1);
  assert.ok(
    matchBulkPhotos([a, b], files, { mode: "PERSONNEL_NUMBER" }).errors.length,
  );
  assert.equal(
    matchBulkPhotos([a], [{ ...files[0], name: "7.jpg" }], {
      mode: "PERSONNEL_NUMBER",
      employerScope: photoEmployerScope(a),
    }).matched,
    0,
  );
});
test("duplicate keys/files and invalid images are explicit and never applied arbitrarily", () => {
  const item = itemSchema.parse({ id: "a", externalId: "stable" });
  const file = { name: "stable.png", size: 100, type: "image/png" };
  const duplicateFiles = matchBulkPhotos(
    [item],
    [file, { ...file, name: "stable.jpg", type: "image/jpeg" }],
    { mode: "EXTERNAL_ID" },
  );
  assert.equal(duplicateFiles.ambiguous, 2);
  assert.equal(duplicateFiles.matched, 0);
  assert.equal(
    matchBulkPhotos([item, { ...item, id: "b" }], [file], {
      mode: "EXTERNAL_ID",
    }).ambiguous,
    1,
  );
  assert.equal(
    matchBulkPhotos(
      [item],
      [{ ...file, name: "stable.svg", type: "image/svg+xml" }],
      { mode: "EXTERNAL_ID" },
    ).rows[0].category,
    "invalid",
  );
  assert.ok(
    matchBulkPhotos(
      [item],
      Array.from({ length: 101 }, () => file),
      { mode: "EXTERNAL_ID" },
    ).errors.length,
  );
});
