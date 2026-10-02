import test from "node:test";
import assert from "node:assert/strict";
import type { Prisma } from "@demo/database";
import type { Context } from "../apps/api/src/core";
import { prepareSigningPolicy, signingState } from "../apps/api/src/signing";

const context: Context = {
  tenantId: "synthetic-center",
  userId: "synthetic-manager",
  role: "OPERATOR",
  correlationId: "unsigned-print-test",
  sessionId: "synthetic-session",
  csrfHash: "synthetic-csrf",
};

test("numbered PDFs without bound signers stay printable preparation and never become a signed or archived issuance", async () => {
  const records = [
    { id: "card", templateId: "pb-card", number: "PB-001" },
    { id: "protocol", templateId: "pb-protocol", number: "PB-002" },
  ];
  const statusWrites: unknown[] = [];
  const invalidSignatures = records.map((document) => ({
    artifactId: `pdf-${document.id}`,
    bindingId: "unrelated-binding",
  }));
  const fake = {
    signatoryBinding: { findMany: async () => [] },
    user: {
      findMany: async () => [
        { id: context.userId, role: "OPERATOR" },
        { id: "synthetic-director", role: "DIRECTOR" },
      ],
    },
    printRequest: {
      findFirst: async () => ({
        id: "request",
        status: "FINALIZED",
        archivedAt: null,
      }),
      update: async () => {
        throw new Error("Unsigned issuance must never archive its request");
      },
    },
    issuedDocument: { findMany: async () => records },
    artifact: {
      findMany: async () =>
        records.map((document) => ({
          id: `pdf-${document.id}`,
          documentId: document.id,
          format: "PDF",
          provenance: "ORIGINAL",
          sha256: "synthetic-file-hash",
          fileName: `${document.id}.pdf`,
        })),
    },
    documentSignature: { findMany: async () => invalidSignatures },
    generationJob: {
      findMany: async () =>
        records.map((document) => ({
          id: `job-${document.id}`,
          kind: "PDF",
          status: "SUCCEEDED",
          artifactId: `pdf-${document.id}`,
        })),
    },
    issuanceEvent: { findFirst: async () => null },
  };
  const policy = await prepareSigningPolicy(
    fake as unknown as Prisma.TransactionClient,
    context,
    {
      headName: "Синтетический директор",
      commission: [
        { name: "Синтетический председатель" },
        { name: "Синтетический член один" },
        { name: "Синтетический член два" },
      ],
    },
  );
  assert.equal(policy.commission.length, 3);
  assert.ok(policy.commission.every((signer) => !signer.bindingId));
  const tx = {
    ...fake,
    issuanceWorkflow: {
      findFirst: async () => ({
        id: "workflow",
        issuanceId: "issuance",
        requiredSigners: policy,
        status: "RENDERING",
        completedAt: null,
      }),
      update: async (value: unknown) => {
        statusWrites.push(value);
      },
    },
  } as unknown as Prisma.TransactionClient;
  const state = await signingState(context, "request", tx);
  assert.equal(state.status, "AWAITING_SIGNATURE");
  assert.equal(state.archived, false);
  assert.equal(state.documents.length, 2);
  assert.ok(
    state.documents.every(
      (document) => document.artifactId && !document.complete,
    ),
  );
  assert.ok(
    state.documents.every((document) =>
      document.requiredSigners.every(
        (signer) => !signer.signed && !signer.canSign,
      ),
    ),
  );
  assert.ok(state.missingBindings.includes("Синтетический председатель"));
  assert.deepEqual(statusWrites, [
    { where: { id: "workflow" }, data: { status: "AWAITING_SIGNATURE" } },
  ]);
});
