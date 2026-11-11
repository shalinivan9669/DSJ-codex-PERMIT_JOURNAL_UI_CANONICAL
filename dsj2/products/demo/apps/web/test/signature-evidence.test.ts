import assert from "node:assert/strict";
import test from "node:test";
import {
  signatureEvidenceOriginalUrl,
  signatureEvidenceReceivedAt,
} from "../lib/signature-evidence";

test("the evidence original link stays raw and never follows a remote or print-copy URL", () => {
  assert.equal(
    signatureEvidenceOriginalUrl("/artifacts/source-pdf-id"),
    "/api/artifacts/source-pdf-id",
  );
  for (const url of [
    "https://example.test/artifacts/source-pdf-id",
    "//example.test/artifacts/source-pdf-id",
    "/artifacts/source-pdf-id?copy=signature-print",
    "/artifacts/../other",
    "/artifacts/encoded%2Fid",
  ])
    assert.equal(signatureEvidenceOriginalUrl(url), null);
});

test("signature receipt time uses the center timezone explicitly, including day rollover", () => {
  const actual = signatureEvidenceReceivedAt(
    "2026-11-10T20:15:30.000Z",
    "Asia/Qyzylorda",
  );
  assert.match(actual, /11\.11\.2026/);
  assert.match(actual, /01:15:30/);
  assert.match(actual, /\(Asia\/Qyzylorda\)$/);
  assert.equal(signatureEvidenceReceivedAt("invalid", "Asia/Qyzylorda"), "—");
  const fallback = signatureEvidenceReceivedAt(
    "2026-11-10T20:15:30.000Z",
    "Unknown/Zone",
  );
  assert.match(fallback, /10\.11\.2026/);
  assert.match(fallback, /20:15:30 \(UTC\)$/);
});
