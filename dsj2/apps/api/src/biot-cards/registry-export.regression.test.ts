import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { test } from "node:test";

function findWorkspaceRoot(start: string) {
  let current = resolve(start);
  while (!existsSync(resolve(current, "scripts/test_export_card_request_registry.py"))) {
    const parent = dirname(current);
    if (parent === current) throw new Error("Could not locate the registry export tests.");
    current = parent;
  }
  return current;
}

const workspaceRoot = findWorkspaceRoot(process.cwd());
const python = process.env.PYTHON_BIN?.trim() || "python3";
const probe = spawnSync(python, ["--version"], { cwd: workspaceRoot, encoding: "utf8" });

test("registry export writes untrusted values as literal text", {
  skip: probe.error || probe.status !== 0 ? "Python is unavailable" : false,
}, () => {
  const result = spawnSync(python, ["scripts/test_export_card_request_registry.py"], {
    cwd: workspaceRoot,
    encoding: "utf8",
  });
  if (result.error) throw result.error;
  assert.equal(result.status, 0, result.stderr || result.stdout);
});
