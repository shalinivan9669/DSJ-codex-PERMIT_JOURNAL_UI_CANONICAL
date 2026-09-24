import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PRODUCT_ROOT } from "@demo/printing";
import { validateRasterAttachment } from "../apps/api/src/pdf-attachment";

const fixture = (name: string) =>
  readFileSync(join(PRODUCT_ROOT, "tests/fixtures", name));
const code = (expected: string) => (error: unknown) =>
  (error as { getResponse(): { code: string } }).getResponse().code ===
  expected;

test("attachment PNG and JPEG are fully decoded without modifying accepted bytes", async () => {
  for (const name of ["source.png", "source.jpeg"]) {
    const original = fixture(name);
    const bytes = Buffer.from(original);
    await validateRasterAttachment(bytes);
    assert.deepEqual(bytes, original);
  }
});

test("attachment raster validation fails closed on false signatures, truncation, CRC, appended payload and animation", async (t) => {
  const png = fixture("source.png");
  const badCrc = Buffer.from(png);
  badCrc[badCrc.length - 1] ^= 1;
  const cases = [
    ["PNG signature only", png.subarray(0, 8)],
    ["PNG truncated scan", png.subarray(0, -14)],
    ["PNG invalid CRC", badCrc],
    [
      "PNG appended markup",
      Buffer.concat([png, Buffer.from("<svg onload='void 0'/>")]),
    ],
    ["JPEG signature only", Buffer.from([255, 216, 255, 217])],
    [
      "JPEG truncated entropy",
      Buffer.concat([
        fixture("source.jpeg").subarray(0, 22),
        Buffer.from([255, 217]),
      ]),
    ],
    ["animated PNG", fixture("animated.png")],
  ] as const;
  for (const [name, bytes] of cases)
    await t.test(name, () =>
      assert.rejects(validateRasterAttachment(bytes), code("IMAGE_INVALID")),
    );
});

test("attachment raster validation refuses excessive pixel allocation before decoding", async () => {
  await assert.rejects(
    validateRasterAttachment(fixture("oversized.png")),
    code("IMAGE_RESOURCE_LIMIT"),
  );
});
