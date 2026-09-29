import test from "node:test";
import assert from "node:assert/strict";
import { readyPreviewRevision } from "../lib/preview-readiness";
import type { Artifact, Job } from "../lib/types";

test("preview guidance waits for every current artifact, including failure and missing-file states", () => {
  const artifacts: Artifact[] = [
    { id: "docx", provenance: "PREVIEW", availability: "AVAILABLE" },
    { id: "pdf", provenance: "PREVIEW", availability: "AVAILABLE" },
  ];
  const jobs: Job[] = artifacts.map((artifact) => ({
    id: artifact.id,
    sourceRevision: 4,
    status: "SUCCEEDED",
    artifactId: artifact.id,
  }));
  assert.equal(readyPreviewRevision(4, [], artifacts), null);
  for (const status of ["QUEUED", "RUNNING", "FAILED", "RETRY"])
    assert.equal(
      readyPreviewRevision(4, [jobs[0], { ...jobs[1], status }], artifacts),
      null,
    );
  assert.equal(readyPreviewRevision(4, jobs, artifacts.slice(0, 1)), null);
  assert.equal(readyPreviewRevision(4, jobs, artifacts, ["pdf"]), null);
  assert.equal(
    readyPreviewRevision(
      4,
      jobs,
      artifacts.map((a) => ({ ...a, availability: "MISSING" })),
    ),
    null,
  );
  assert.equal(readyPreviewRevision(4, jobs, artifacts), 4);
  assert.equal(readyPreviewRevision(5, jobs, artifacts), null);
  assert.equal(
    readyPreviewRevision(
      4,
      jobs.map((job) => ({ ...job, issuanceId: "issued" })),
      artifacts,
    ),
    null,
  );
});
