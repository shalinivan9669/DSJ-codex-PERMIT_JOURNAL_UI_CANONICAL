import assert from "node:assert/strict";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";

const root = "docs/evidence/operator-value";
const read = async (file) => JSON.parse(await readFile(file, "utf8"));
const matrix = await read(`${root}/acceptance-matrix.json`);
const features = await read(`${root}/feature-matrix.json`);
const scenarios = await read(`${root}/business-scenarios.json`);
const original = JSON.parse(
  execFileSync(
    "git",
    [
      "show",
      "47e8f0ad9d8b28ad1639fff9788b6ae76e2c7ab7:dsj2/products/demo/docs/evidence/operator-value/acceptance-matrix.json",
    ],
    { encoding: "utf8", windowsHide: true },
  ),
);
assert.equal(matrix.tests.length, 184);
assert.equal(features.features.length, 32);
assert.equal(scenarios.scenarios.length, 12);
assert.equal(new Set(matrix.tests.map((test) => test.id)).size, 184);
assert.equal(new Set(features.features.map((feature) => feature.id)).size, 32);
const stableFields = [
  "id",
  "title",
  "preconditions",
  "action",
  "expected",
  "required_evidence",
  "feature_ids",
  "business_scenario_id",
];
for (const criterion of matrix.tests) {
  const source = original.tests.find((test) => test.id === criterion.id);
  assert.ok(source, criterion.id);
  for (const field of stableFields)
    assert.deepEqual(
      criterion[field],
      source[field],
      `${criterion.id}.${field} must retain the supplied acceptance requirement`,
    );
  assert.ok(
    [
      "PASS",
      "PARTIAL",
      "NOT_RUN",
      "FAIL",
      "BLOCKED",
      "BLOCKED_EXTERNAL",
    ].includes(criterion.status),
    criterion.id,
  );
  assert.ok(criterion.evidence.length > 0, `${criterion.id}: missing evidence`);
  for (const file of criterion.evidence)
    assert.ok(existsSync(file), `${criterion.id}: ${file}`);
  assert.equal(criterion.tested_commit, matrix.tested_commit);
}
const links = features.features.map((feature) => {
  assert.ok(
    existsSync(feature.implementation_path),
    `${feature.id}: missing implementation`,
  );
  assert.ok(feature.evidence.length, `${feature.id}: missing evidence`);
  const criteria = matrix.tests.filter((test) =>
    test.feature_ids?.includes(feature.id),
  );
  assert.ok(
    criteria.length,
    `${feature.id}: missing linked acceptance criteria`,
  );
  const codeOrTestEvidence = feature.evidence.filter((file) =>
    /^(apps|packages|tests|scripts)\//.test(file),
  );
  return {
    id: feature.id,
    implementation: feature.implementation_path,
    criteria: criteria.map((test) => test.id),
    evidenceCount: feature.evidence.length,
    codeOrTestEvidence,
    acceptanceCounts: feature.acceptance_counts,
  };
});
const evidence = path.resolve("docs/evidence/final-completion/traceability");
await mkdir(evidence, { recursive: true });
const report = {
  status: "PASS",
  sourceCommit: matrix.tested_commit,
  executedAt: new Date().toISOString(),
  criteria: 184,
  features: 32,
  scenarios: 12,
  suppliedRequirementsUnchanged: true,
  allEvidencePathsExist: true,
  counts: matrix.counts,
  links,
  boundary:
    "This validates maintained requirement identity and concrete source/evidence linkage, not blanket PASS of every functional or commercial requirement. Per-criterion statuses remain authoritative.",
};
await writeFile(
  path.join(evidence, "result.json"),
  JSON.stringify(report, null, 2) + "\n",
);
console.log(
  JSON.stringify({
    status: report.status,
    criteria: report.criteria,
    features: report.features,
    counts: report.counts,
  }),
);
