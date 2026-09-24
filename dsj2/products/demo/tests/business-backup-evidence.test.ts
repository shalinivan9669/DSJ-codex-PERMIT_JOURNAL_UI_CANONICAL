import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { businessBackupEvidence } from "../scripts/verification/business-backup-evidence";

const reportFixture = () => ({
  status: "PASS",
  sourceDatabase: "demo_test_source",
  restoreDatabase: "demo_test_restore",
  productionTouched: false,
  restoreAndVerifyMs: 42,
  manifest: {
    product: "DEMO",
    databaseSha256: "a".repeat(64),
    databaseRowHashes: { PrintRequest: "b".repeat(64) },
    files: { "objects/synthetic.pdf": "c".repeat(64) },
  },
});

test("no external report explicitly records NOT_PROVIDED without touching a default file", async () => {
  const result = await businessBackupEvidence(undefined);
  assert.equal(result.status, "NOT_PROVIDED");
  assert.match(result.remaining, /separate execution/);
  assert.equal("sha256" in result, false);
});

test("an explicitly supplied missing, failed or malformed report fails closed", async () => {
  const directory = await mkdtemp(
    join(tmpdir(), "demo-backup-evidence-invalid-"),
  );
  await assert.rejects(
    businessBackupEvidence(join(directory, "missing.json")),
    { code: "ENOENT" },
  );
  await assert.rejects(businessBackupEvidence(""));
  const path = join(directory, "report.json");
  for (const input of [
    "{",
    JSON.stringify({ ...reportFixture(), status: "FAIL" }),
    JSON.stringify({
      ...reportFixture(),
      manifest: { product: "DEMO", databaseSha256: "not-a-hash" },
    }),
  ]) {
    await writeFile(path, input);
    await assert.rejects(businessBackupEvidence(path));
  }
});

test("a supplied persisted valid report is attributed to its exact bytes, never to the new V12 tenant", async () => {
  const directory = await mkdtemp(
    join(tmpdir(), "demo-backup-evidence-valid-"),
  );
  const path = join(directory, "report.json");
  // This is a unit parser fixture, not a claim that a backup was restored here.
  const bytes = Buffer.from(JSON.stringify(reportFixture(), null, 2));
  await writeFile(path, bytes);
  const result = await businessBackupEvidence(path);
  assert.equal(result.status, "PASS");
  assert.equal(result.sha256, createHash("sha256").update(bytes).digest("hex"));
  assert.equal(result.evidence, path);
  assert.match(result.scope, /does not restore/);
  assert.match(result.remaining, /separate execution/);
});
