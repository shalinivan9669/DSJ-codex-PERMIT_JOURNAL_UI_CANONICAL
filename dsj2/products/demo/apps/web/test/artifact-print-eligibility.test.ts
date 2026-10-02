import test from "node:test";
import assert from "node:assert/strict";
import { artifactPrintEligibility } from "../lib/artifact-print-eligibility";

function fixture(): Parameters<typeof artifactPrintEligibility>[0] {
  const input: Parameters<typeof artifactPrintEligibility>[0] = {
    artifact: {
      id: "preview",
      provenance: "PREVIEW",
      availability: "AVAILABLE",
    },
    draft: {
      revision: 4,
      approvedRevision: 4,
      approval: {
        status: "APPROVED",
        proposalId: "proposal",
        proposalHash: "hash",
        baseRevision: 0,
        submittedBy: "manager",
        submittedAt: "2026-10-02T00:00:00Z",
      },
    },
    jobs: [
      {
        id: "job",
        status: "SUCCEEDED",
        artifactId: "preview",
        sourceRevision: 4,
      },
    ],
    issuances: [],
    previewPrintAllowed: true,
  };
  input.serverReview = structuredClone(input.draft);
  return input;
}

test("printing a preview requires the exact saved and approved revision with its completed job", () => {
  const input = fixture();
  assert.equal(artifactPrintEligibility(input).canPrint, true);
  assert.match(
    artifactPrintEligibility(input).label,
    /Предпросмотр без номера · редакция 4/,
  );
  input.jobs[0].sourceRevision = 3;
  assert.equal(artifactPrintEligibility(input).canPrint, false);
  input.jobs[0].sourceRevision = 4;
  for (const status of ["QUEUED", "RUNNING", "FAILED"]) {
    input.jobs[0].status = status;
    assert.equal(artifactPrintEligibility(input).canPrint, false);
  }
  input.jobs[0].status = "SUCCEEDED";
  input.previewPrintAllowed = false;
  assert.equal(artifactPrintEligibility(input).canPrint, false);
  input.previewPrintAllowed = true;
  input.draft.approvedRevision = 3;
  assert.equal(artifactPrintEligibility(input).canPrint, false);
  input.draft.approvedRevision = 4;
  input.draft.approval!.status = "PENDING";
  assert.equal(artifactPrintEligibility(input).canPrint, false);
  input.draft.approval!.status = "APPROVED";
  input.draft.archivedAt = "2026-10-02T00:00:00Z";
  assert.equal(artifactPrintEligibility(input).canPrint, false);
});

test("historical issued originals stay printable independently of a changed or archived draft", () => {
  const input = fixture();
  input.previewPrintAllowed = false;
  input.draft.approval!.status = "PENDING";
  input.draft.archived = true;
  input.artifact = {
    id: "original",
    provenance: "ORIGINAL",
    documentId: "document",
  };
  input.issuances = [
    {
      id: "issued",
      sourceRevision: 2,
      createdAt: "2026-10-01T00:00:00Z",
      documents: [{ id: "document", number: "PB-1", templateId: "pb-card" }],
    },
  ];
  assert.equal(artifactPrintEligibility(input).canPrint, true);
  assert.equal(artifactPrintEligibility(input).sourceRevision, 2);
  assert.match(artifactPrintEligibility(input).label, /Сохранённый оригинал/);
  input.artifact.provenance = "RECONSTRUCTED";
  assert.equal(artifactPrintEligibility(input).canPrint, true);
  assert.match(artifactPrintEligibility(input).label, /Восстановленная копия/);
  input.artifact.documentId = "unrelated";
  assert.equal(artifactPrintEligibility(input).canPrint, false);
});

test("preview provenance cannot inherit historical print permission and missing artifacts never print", () => {
  const input = fixture();
  input.previewPrintAllowed = false;
  input.artifact.issuanceId = "issued";
  input.issuances = [
    {
      id: "issued",
      sourceRevision: 3,
      createdAt: "2026-10-01T00:00:00Z",
      artifacts: [input.artifact],
    },
  ];
  assert.equal(artifactPrintEligibility(input).canPrint, false);
  input.previewPrintAllowed = true;
  input.artifact.availability = "MISSING";
  assert.equal(artifactPrintEligibility(input).canPrint, false);
  input.artifact.availability = "AVAILABLE";
  input.missing = [input.artifact.id];
  assert.equal(artifactPrintEligibility(input).canPrint, false);
  input.artifact.provenance = "ORIGINAL";
  assert.equal(artifactPrintEligibility(input).canPrint, false);
});

test("a server poll showing another pending, approved or archived revision withdraws stale preview printing", () => {
  const input = fixture();
  input.serverReview = null;
  assert.equal(artifactPrintEligibility(input).canPrint, false);
  input.serverReview = structuredClone(input.draft);
  assert.equal(artifactPrintEligibility(input).canPrint, true);
  input.serverReview.revision = 5;
  input.serverReview.approval!.status = "PENDING";
  assert.equal(artifactPrintEligibility(input).canPrint, false);
  input.serverReview.approvedRevision = 5;
  input.serverReview.approval!.status = "APPROVED";
  assert.equal(artifactPrintEligibility(input).canPrint, false);
  input.serverReview = structuredClone(input.draft);
  input.serverReview.archivedAt = "2026-10-02T00:00:00Z";
  assert.equal(artifactPrintEligibility(input).canPrint, false);
  input.serverReview = structuredClone(input.draft);
  input.serverReview.approval!.proposalHash = "different-proposal";
  assert.equal(artifactPrintEligibility(input).canPrint, false);
  input.artifact = {
    id: "original",
    provenance: "ORIGINAL",
    issuanceId: "issued",
  };
  input.issuances = [
    { id: "issued", sourceRevision: 3, createdAt: "2026-10-01T00:00:00Z" },
  ];
  assert.equal(artifactPrintEligibility(input).canPrint, true);
});
