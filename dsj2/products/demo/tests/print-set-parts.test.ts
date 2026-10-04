import test from "node:test";
import assert from "node:assert/strict";
import {
  PRINT_SET_PART_BYTES,
  printSetParts,
} from "../apps/api/src/print-sets";

test("saved originals partition by bytes preserving order and complete composition", () => {
  const files = Array.from({ length: 250 }, (_, index) => ({
    id: String(index),
    size: 1024 * 1024,
  }));
  const parts = printSetParts(files);
  assert.equal(parts.length, 4);
  assert.deepEqual(parts.flat(), files);
  assert.ok(
    parts.every(
      (part) =>
        part.reduce((sum, file) => sum + file.size, 0) <= PRINT_SET_PART_BYTES,
    ),
  );
  assert.deepEqual(printSetParts([{ id: "a", size: PRINT_SET_PART_BYTES }]), [
    [{ id: "a", size: PRINT_SET_PART_BYTES }],
  ]);
  assert.throws(
    () => printSetParts([{ id: "a", size: PRINT_SET_PART_BYTES + 1 }]),
    /Один оригинал/,
  );
  const smallOriginals = Array.from({ length: 1001 }, (_, index) => ({
    id: `saved-${index}`,
    size: 128,
  }));
  assert.deepEqual(printSetParts(smallOriginals), [smallOriginals]);
});
