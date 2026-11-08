import test from "node:test";
import assert from "node:assert/strict";
import type { Prisma } from "@demo/database";
import type { Context } from "../apps/api/src/core";
import { signingState } from "../apps/api/src/signing";

const context = {
  tenantId: "synthetic-signing-state",
  userId: "director-user",
  role: "DIRECTOR",
} as Context;
const issuanceId = "670e8c54-969b-4719-9e39-9e3eb0efe868";
const documentId = "5e5a21aa-c62f-4e1b-b028-bf04d7f2862a";
const sha256 = "a".repeat(64);

function fixture() {
  const director = {
    kind: "DIRECTOR" as const,
    displayName: "Совмещающий роли",
    bindingId: "director-binding" as string | null,
    userId: context.userId,
    iin: null,
    bin: null,
  };
  const chair = {
    ...director,
    kind: "CHAIR" as const,
    bindingId: "chair-binding" as string | null,
  };
  const teacher = {
    ...director,
    kind: "TEACHER" as const,
    displayName: "Преподаватель",
    bindingId: "teacher-binding" as string | null,
    userId: "teacher-user",
  };
  const policy = {
    version: 3 as const,
    signers: [director],
    head: director,
    commission: [chair],
    teacher,
  };
  const documents = [{ id: documentId, templateId: "pb-protocol" }];
  const artifacts = [
    {
      id: "pdf",
      documentId,
      format: "PDF",
      fileName: "synthetic.pdf",
      sha256,
      storageKey: "synthetic-signing-state/not-a-real-artifact.pdf",
      size: 123,
    },
  ];
  const bindings = [director, chair, teacher].map((signer) => ({
    id: signer.bindingId!,
    userId: signer.userId,
  }));
  const signatures: {
    artifactId: string;
    bindingId: string;
    documentSha256: string;
  }[] = [];
  const records: {
    entityId: string;
    actorId: string;
    createdAt: Date;
    metadata: unknown;
  }[] = [];
  const jobs = [{ status: "SUCCEEDED", artifactId: "pdf" }];
  const workflow = {
    id: "workflow",
    issuanceId,
    status: "AWAITING_SIGNATURE",
    completedAt: null as Date | null,
    requiredSigners: policy,
  };
  const request = {
    id: "request",
    tenantId: context.tenantId,
    status: "FINALIZED",
    archivedAt: null,
  };
  const state = { invalid: null as { kind: string } | null };
  const tx = {
    printRequest: { findFirst: async () => request },
    issuanceWorkflow: {
      findFirst: async () => workflow,
      update: async () => {},
    },
    issuedDocument: { findMany: async () => documents },
    artifact: { findMany: async () => artifacts },
    documentSignature: { findMany: async () => signatures },
    generationJob: { findMany: async () => jobs },
    issuanceEvent: { findFirst: async () => state.invalid },
    signatoryBinding: { findMany: async () => bindings },
    auditEvent: { findMany: async () => records },
  } as unknown as Prisma.TransactionClient;
  return {
    tx,
    policy,
    artifacts,
    documents,
    bindings,
    signatures,
    records,
    jobs,
    workflow,
    request,
    state,
  };
}

test("missing signer messages deduplicate documents, preserve distinct roles, and never bind by name", async () => {
  const f = fixture();
  f.policy.head.bindingId = null;
  f.policy.commission[0].bindingId = null;
  f.documents.push({ id: "second-document", templateId: "pb-card" });
  f.artifacts.push({
    ...f.artifacts[0],
    id: "second-pdf",
    documentId: "second-document",
  });
  const frozen = JSON.stringify(f.policy);
  const state = await signingState(context, "request", f.tx);
  assert.deepEqual(state.missingBindings, ["Совмещающий роли"]);
  assert.deepEqual(state.unavailableSigners, [
    {
      kind: "DIRECTOR",
      displayName: "Совмещающий роли",
      bindingState: "MISSING",
      recovery: "NEW_ISSUANCE_REQUIRED",
    },
    {
      kind: "CHAIR",
      displayName: "Совмещающий роли",
      bindingState: "MISSING",
      recovery: "NEW_ISSUANCE_REQUIRED",
    },
  ]);
  assert.equal(JSON.stringify(f.policy), frozen);
  assert.equal(state.documents[0].requiredSigners[0].canSign, false);
});

test("replacing a binding does not silently restore the frozen binding; verified old signatures remain valid", async () => {
  const f = fixture();
  f.bindings[0].id = "new-director-binding";
  let state = await signingState(context, "request", f.tx);
  assert.deepEqual(state.missingBindings, []);
  assert.equal(state.unavailableSigners[0].bindingState, "REVOKED");
  assert.equal(state.documents[0].requiredSigners[0].canSign, false);
  f.signatures.push({
    artifactId: "pdf",
    bindingId: "director-binding",
    documentSha256: sha256,
  });
  state = await signingState(context, "request", f.tx);
  assert.equal(state.documents[0].requiredSigners[0].signed, true);
  assert.deepEqual(state.unavailableSigners, []);
});

test("signing actions require the rendered document, current role, unsigned slot and ready workflow", async () => {
  const f = fixture();
  let state = await signingState(context, "request", f.tx);
  assert.equal(state.documents[0].requiredSigners[0].canSign, true);
  assert.equal(state.documents[0].requiredSigners[1].canSign, true);
  state = await signingState({ ...context, role: "OPERATOR" }, "request", f.tx);
  assert.equal(state.documents[0].requiredSigners[0].canSign, false);
  assert.equal(state.documents[0].requiredSigners[1].canSign, true);
  f.signatures.push({
    artifactId: "pdf",
    bindingId: "chair-binding",
    documentSha256: sha256,
  });
  state = await signingState(context, "request", f.tx);
  assert.equal(state.documents[0].requiredSigners[1].canSign, false);
  f.jobs[0].status = "PENDING";
  state = await signingState(context, "request", f.tx);
  assert.equal(state.status, "RENDERING");
  assert.ok(
    state.documents[0].requiredSigners.every((signer) => !signer.canSign),
  );
  f.artifacts.length = 0;
  state = await signingState(context, "request", f.tx);
  assert.ok(
    state.documents[0].requiredSigners.every((signer) => !signer.canSign),
  );
  assert.equal(state.documents[0].canAttestPaper, false);
});

test("a signature of another content hash does not satisfy the frozen PDF", async () => {
  const f = fixture();
  f.signatures.push({
    artifactId: "pdf",
    bindingId: "director-binding",
    documentSha256: "b".repeat(64),
  });
  const state = await signingState(context, "request", f.tx);
  assert.equal(state.documents[0].requiredSigners[0].signed, false);
  assert.equal(state.documents[0].complete, false);
  assert.equal(state.status, "AWAITING_SIGNATURE");
});

test("digitally completed documents offer neither repeated signing nor paper attestation", async () => {
  const f = fixture();
  f.workflow.completedAt = new Date("2026-01-01T00:00:00Z");
  f.signatures.push(
    ...f.bindings.map((binding) => ({
      artifactId: "pdf",
      bindingId: binding.id,
      documentSha256: sha256,
    })),
  );
  const state = await signingState(context, "request", f.tx);
  assert.equal(state.status, "ISSUED");
  assert.equal(state.failureReason, null);
  assert.equal(state.documents[0].complete, true);
  assert.equal(state.documents[0].canAttestPaper, false);
  assert.ok(
    state.documents[0].requiredSigners.every((signer) => !signer.canSign),
  );
});

test("attested paper completes only its exact PDF, without claiming electronic signatures or missing setup", async () => {
  const f = fixture();
  f.workflow.completedAt = new Date("2026-01-01T00:00:00Z");
  f.policy.head.bindingId = null;
  f.records.push({
    entityId: documentId,
    actorId: context.userId,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    metadata: {
      documentId,
      issuanceId,
      artifactSha256: sha256,
      signedAt: "2026-01-01",
      signerNames: ["Совмещающий роли", "Совмещающий роли", "Преподаватель"],
      reason: "Бумажные подписи проверены",
      category: "OPERATOR_ATTESTED",
      allRequiredSignaturesPresent: true,
    },
  });
  let state = await signingState(context, "request", f.tx);
  assert.equal(state.status, "ISSUED");
  assert.equal(state.documents[0].canAttestPaper, false);
  assert.ok(
    state.documents[0].requiredSigners.every(
      (signer) => !signer.signed && !signer.canSign,
    ),
  );
  assert.deepEqual(state.unavailableSigners, []);
  assert.deepEqual(state.missingBindings, []);
  f.artifacts[0].sha256 = "b".repeat(64);
  state = await signingState(context, "request", f.tx);
  assert.equal(state.documents[0].paperSignature, null);
  assert.equal(state.documents[0].complete, false);
  assert.equal(state.unavailableSigners.length, 1);
});

test("failure reasons distinguish replaced, cancelled, ineligible, generation and integrity failures", async () => {
  const f = fixture();
  for (const kind of ["REPLACED", "CANCELLED"]) {
    f.state.invalid = { kind };
    const state = await signingState(context, "request", f.tx);
    assert.equal(state.status, "FAILED");
    assert.equal(state.failureReason, `ISSUANCE_${kind}`);
    assert.equal(state.documents[0].canAttestPaper, false);
    assert.ok(
      state.documents[0].requiredSigners.every((signer) => !signer.canSign),
    );
  }
  f.state.invalid = null;
  f.request.status = "CANCELLED";
  assert.equal(
    (await signingState(context, "request", f.tx)).failureReason,
    "ISSUANCE_CANCELLED",
  );
  f.request.status = "SUBMITTED";
  assert.equal(
    (await signingState(context, "request", f.tx)).failureReason,
    "REQUEST_INELIGIBLE",
  );
  f.request.status = "FINALIZED";
  f.jobs[0].status = "FAILED";
  assert.equal(
    (await signingState(context, "request", f.tx)).failureReason,
    "GENERATION_FAILED",
  );
  f.jobs[0].status = "SUCCEEDED";
  f.signatures.push(
    ...f.bindings.map((binding) => ({
      artifactId: "pdf",
      bindingId: binding.id,
      documentSha256: sha256,
    })),
  );
  const corrupted = await signingState(context, "request", f.tx);
  assert.equal(corrupted.status, "FAILED");
  assert.equal(corrupted.failureReason, "ARTIFACT_INTEGRITY_FAILED");
});
