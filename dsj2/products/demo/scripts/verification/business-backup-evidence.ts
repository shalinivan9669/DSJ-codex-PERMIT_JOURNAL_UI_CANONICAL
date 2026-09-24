import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const scope =
  "Separate previously executed database/file restore; this reference does not restore the newly created business-scenario tenant";
const remaining =
  "Actual backup/restore acceptance remains a separate execution and evidence requirement";
const digest = /^[a-f0-9]{64}$/i;

/** Optional external execution evidence; never infer a completed restore from a V12 API run. */
export async function businessBackupEvidence(path: string | undefined) {
  if (path === undefined)
    return { status: "NOT_PROVIDED" as const, scope, remaining };
  assert.ok(
    path.trim(),
    "DEMO_BUSINESS_BACKUP_EVIDENCE must name a report when provided",
  );
  const evidence = resolve(path);
  const bytes = await readFile(evidence);
  const report = JSON.parse(bytes.toString("utf8"));
  assert.equal(
    report.status,
    "PASS",
    "Backup evidence must report a completed PASS execution",
  );
  assert.equal(typeof report.sourceDatabase, "string");
  assert.equal(typeof report.restoreDatabase, "string");
  assert.ok(
    report.sourceDatabase &&
      report.restoreDatabase &&
      report.sourceDatabase !== report.restoreDatabase,
  );
  assert.equal(
    report.productionTouched,
    false,
    "Business verification accepts isolated restore evidence only",
  );
  assert.ok(
    Number.isFinite(report.restoreAndVerifyMs) && report.restoreAndVerifyMs > 0,
  );
  assert.equal(report.manifest?.product, "DEMO");
  assert.match(report.manifest.databaseSha256, digest);
  for (const section of ["databaseRowHashes", "files"]) {
    const values = report.manifest[section];
    assert.ok(values && typeof values === "object" && !Array.isArray(values));
    assert.ok(
      Object.keys(values).length > 0,
      `Backup evidence needs ${section}`,
    );
    for (const value of Object.values(values)) {
      assert.equal(typeof value, "string");
      assert.match(value as string, digest);
    }
  }
  return {
    status: "PASS" as const,
    evidence,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    scope,
    remaining,
  };
}
