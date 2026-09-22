import test from "node:test";
import assert from "node:assert/strict";
import { evaluateImageScan } from "./demo-image-gate.mjs";
const imageId = `sha256:${"a".repeat(64)}`;
const scan = {
  SchemaVersion: 2,
  ArtifactType: "container_image",
  Metadata: { ImageID: imageId },
  Results: [
    {
      Class: "os-pkgs",
      Type: "debian",
      Packages: [{ Name: "fixture", Version: "1.2.3" }],
      Vulnerabilities: [
        {
          VulnerabilityID: "CVE-2026-12345",
          PkgName: "fixture",
          InstalledVersion: "1.2.3",
          Severity: "HIGH",
        },
      ],
    },
  ],
};
const policy = {
  version: 1,
  reviewedImages: [
    {
      imageId,
      reviewedAt: "2026-09-22T00:00:00Z",
      expiresAt: "2026-10-22T00:00:00Z",
      findings: [
        {
          type: "debian",
          cve: "CVE-2026-12345",
          package: "fixture",
          version: "1.2.3",
          severity: "HIGH",
          disposition: "not_affected_in_declared_runtime",
          justification:
            "Synthetic test: required vulnerable optional module is absent in the exact inspected image.",
          evidence: ["synthetic-fixture-report.json"],
          primarySources: ["https://example.test/primary-fixture"],
        },
      ],
    },
  ],
};
const now = new Date("2026-09-22T12:00:00Z");
test("accepts an exact supported review while retaining the raw finding", () => {
  const result = evaluateImageScan(scan, policy, now);
  assert.equal(result.status, "PASS");
  assert.equal(result.rawHighCritical, 1);
  assert.equal(result.reviewedNotAffected, 1);
});
for (const field of [
  "VulnerabilityID",
  "PkgName",
  "InstalledVersion",
  "Severity",
]) {
  test(`fails a new or changed ${field}`, () => {
    const changed = structuredClone(scan);
    changed.Results[0].Vulnerabilities[0][field] =
      field === "Severity" ? "CRITICAL" : "UNREVIEWED";
    assert.equal(evaluateImageScan(changed, policy, now).status, "FAIL");
  });
}
test("fails a different immutable image", () => {
  const changed = structuredClone(scan);
  changed.Metadata.ImageID = `sha256:${"b".repeat(64)}`;
  assert.equal(evaluateImageScan(changed, policy, now).status, "FAIL");
});
test("fails expired and unsupported reviews", () => {
  assert.equal(
    evaluateImageScan(scan, policy, new Date("2026-10-23")).status,
    "FAIL",
  );
  const changed = structuredClone(policy);
  changed.reviewedImages[0].findings[0].justification = "";
  assert.equal(evaluateImageScan(scan, changed, now).status, "FAIL");
});
test("fails a known unresolved native input path even with matching CVE reviews", () => {
  const changed = structuredClone(policy);
  changed.reviewedImages[0].unresolvedFindings = [
    {
      id: "NATIVE_INPUT_NOT_REVIEWED",
      reason: "Synthetic unresolved reachable parser",
    },
  ];
  assert.equal(evaluateImageScan(scan, changed, now).status, "FAIL");
});
test("does not turn a malformed or failed scanner report into PASS", () => {
  assert.throws(() => evaluateImageScan({}, policy, now));
});
test("fails an empty scanner inventory rather than interpreting it as clean", () => {
  const changed = structuredClone(scan);
  changed.Results = [];
  assert.throws(() => evaluateImageScan(changed, policy, now));
});
test("fails a malformed severity instead of silently dropping the finding", () => {
  const changed = structuredClone(scan);
  changed.Results[0].Vulnerabilities[0].Severity = "MALFORMED";
  assert.throws(() => evaluateImageScan(changed, policy, now));
});
test("a real image report with no high/critical findings needs no exception", () => {
  const clean = structuredClone(scan);
  clean.Results[0].Vulnerabilities = [];
  assert.equal(
    evaluateImageScan(clean, { version: 1, reviewedImages: [] }, now).status,
    "PASS",
  );
});
