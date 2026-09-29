import test from "node:test";
import assert from "node:assert/strict";
import { itemSchema } from "@demo/contracts";
import { matchBulkPhotos } from "../lib/bulk-photos";

test("photo batch accepts exactly 100 files/50 MiB and keeps all source rows when either limit is exceeded", () => {
  const items = Array.from({ length: 101 }, (_, index) =>
    itemSchema.parse({ id: `row-${index}`, externalId: `person-${index}` }),
  );
  const files = items.map((item) => ({
    name: `${item.externalId}.png`,
    size: (50 * 1024 * 1024) / 100,
    type: "image/png",
  }));
  const allowed = matchBulkPhotos(items, files.slice(0, 100), {
    mode: "EXTERNAL_ID",
  });
  assert.deepEqual(allowed.errors, []);
  assert.equal(allowed.matched, 100);
  const tooMany = matchBulkPhotos(items, files, { mode: "EXTERNAL_ID" });
  assert.ok(tooMany.errors.some((error) => error.includes("100")));
  assert.equal(tooMany.rows.length, 101);
  assert.equal(tooMany.rows.at(-1)?.rowId, "row-100");
  const tooLarge = files.slice(0, 100).map((file, index) => ({
    ...file,
    size: file.size + (index === 0 ? 1 : 0),
  }));
  const overSize = matchBulkPhotos(items, tooLarge, { mode: "EXTERNAL_ID" });
  assert.ok(overSize.errors.some((error) => error.includes("50 МиБ")));
  assert.equal(overSize.rows.length, 100);
});
