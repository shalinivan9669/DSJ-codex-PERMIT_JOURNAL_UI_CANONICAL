import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PRODUCT_ROOT, RENDERER_VERSION } from "../packages/printing/src";

test("worker expects the renderer version implemented by Python", () => {
  const source = readFileSync(
    join(PRODUCT_ROOT, "scripts/render/renderer.py"),
    "utf8",
  );
  const actual = /^RENDERER_VERSION\s*=\s*['"]([^'"]+)['"]/m.exec(source)?.[1];
  assert.ok(actual, "Python renderer must declare its runtime version");
  assert.equal(RENDERER_VERSION, actual);
});
