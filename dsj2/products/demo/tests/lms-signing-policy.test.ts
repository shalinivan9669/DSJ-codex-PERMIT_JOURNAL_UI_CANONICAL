import test from "node:test";
import assert from "node:assert/strict";
import type { Prisma } from "@demo/database";
import type { Assignment } from "@demo/contracts";
import type { Context } from "../apps/api/src/core";
import {
  prepareSigningPolicy,
  signersFor,
  assertSigningPolicy,
  signingState,
} from "../apps/api/src/signing";

const context: Context = {
  tenantId: "synthetic-lms-signing",
  userId: "operator",
  role: "OPERATOR",
  sessionId: "test",
  csrfHash: "test",
  correlationId: "lms-signing-policy-test",
};
const binding = {
  id: "chair-binding",
  kind: "CHAIR",
  userId: "chair",
  displayName: "Синтетический председатель",
  iin: "000000000001",
  bin: null,
};
const fake = {
  signatoryBinding: { findMany: async () => [binding] },
  user: { findMany: async () => [{ id: "chair", role: "OPERATOR" }] },
} as unknown as Prisma.TransactionClient;
function assignment(
  legalForm: NonNullable<Assignment["lms"]>["legalForm"],
  requiredSignatures: string[] = [],
) {
  return {
    id: "assignment",
    templateId: "lms-certificate",
    lms: {
      resultId: "11111111-1111-4111-8111-111111111111",
      resultRevision: 1,
      profileVersionId: "22222222-2222-4222-8222-222222222222",
      assessmentKind: "CENTER_EXAM",
      eligible: true,
      legalForm,
      requiredSignatures,
      course: {
        titleRu: "Синтетический курс",
        titleKz: "Синтетикалық курс",
        hours: 1,
      },
      issuer: "Синтетический центр",
      examiner: "Синтетическая комиссия",
      examAt: null,
      verdict: "PASSED",
      score: 1,
      maximum: 1,
      source: {},
      signatureState: "PREPARED",
      synthetic: true,
      originalReference: null,
    } as NonNullable<Assignment["lms"]>,
  };
}
const errorCode = (code: string) => (error: unknown) => {
  assert.equal(
    (error as { getResponse: () => { code: string } }).getResponse().code,
    code,
  );
  return true;
};
test("LMS binds only explicit course signers and never imports DEMO director or commission defaults", async () => {
  const policy = await prepareSigningPolicy(
    fake,
    context,
    { commission: [{ name: "Чужая комиссия" }] },
    [],
    [assignment("ELECTRONIC_ORIGINAL", [binding.displayName])],
  );
  assert.deepEqual(
    signersFor(policy, "lms-certificate", "assignment").map(
      (signer) => signer.bindingId,
    ),
    [binding.id],
  );
  assert.equal(policy.signers.length, 0);
  assert.equal(policy.commission.length, 0);
  assert.doesNotThrow(() =>
    assertSigningPolicy(policy, [
      { templateId: "lms-certificate", assignmentId: "assignment" },
    ]),
  );
  assert.throws(
    () => signersFor(policy, "lms-certificate", "another"),
    errorCode("LMS_SIGNING_POLICY_REQUIRED"),
  );
});
test("an electronic original cannot omit signers and an absent LMS policy cannot use legacy defaults", async () => {
  await assert.rejects(
    prepareSigningPolicy(
      fake,
      context,
      {},
      [],
      [assignment("ELECTRONIC_ORIGINAL")],
    ),
    errorCode("LMS_ELECTRONIC_SIGNATURE_REQUIRED"),
  );
  await assert.rejects(
    prepareSigningPolicy(
      fake,
      context,
      {},
      [],
      [{ id: "assignment", templateId: "lms-certificate" }],
    ),
    errorCode("LMS_SIGNING_POLICY_REQUIRED"),
  );
  const legacy = await prepareSigningPolicy(fake, context, {});
  assert.throws(
    () => signersFor(legacy, "lms-protocol", "assignment"),
    errorCode("LMS_SIGNING_POLICY_REQUIRED"),
  );
});
test("only explicit information-card or copy policy grants a zero-signature exemption", async () => {
  for (const legalForm of ["INFORMATION_CARD", "COPY_OF_ORIGINAL"] as const) {
    const policy = await prepareSigningPolicy(
      fake,
      context,
      {},
      [],
      [assignment(legalForm)],
    );
    assert.deepEqual(signersFor(policy, "lms-certificate", "assignment"), []);
    assert.equal(policy.lmsUnsignedExempt?.assignment, true);
    assert.doesNotThrow(() =>
      assertSigningPolicy(policy, [
        { templateId: "lms-certificate", assignmentId: "assignment" },
      ]),
    );
  }
  const paper = await prepareSigningPolicy(
    fake,
    context,
    {},
    [],
    [assignment("PAPER_ORIGINAL")],
  );
  assert.equal(paper.lmsUnsignedExempt?.assignment, undefined);
  assert.throws(
    () =>
      assertSigningPolicy(paper, [
        { templateId: "lms-certificate", assignmentId: "assignment" },
      ]),
    errorCode("LMS_SIGNATURE_EVIDENCE_REQUIRED"),
  );
  assert.throws(
    () =>
      assertSigningPolicy(
        { ...paper, lmsUnsignedExempt: { assignment: true } },
        [{ templateId: "lms-certificate", assignmentId: "assignment" }],
      ),
    errorCode("LMS_SIGNATURE_EVIDENCE_REQUIRED"),
  );
});
test("unbound explicit LMS signer remains required; an unrelated signer never substitutes", async () => {
  const policy = await prepareSigningPolicy(
    fake,
    context,
    {},
    [],
    [assignment("INFORMATION_CARD", ["Иной подписант"])],
  );
  const signers = signersFor(policy, "lms-certificate", "assignment");
  assert.equal(signers.length, 1);
  assert.equal(signers[0].displayName, "Иной подписант");
  assert.equal(signers[0].bindingId, null);
  assert.equal(policy.lmsUnsignedExempt?.assignment, undefined);
  assert.throws(
    () =>
      assertSigningPolicy(policy, [
        { templateId: "lms-certificate", assignmentId: "assignment" },
      ]),
    errorCode("SIGNATORY_CONFIGURATION_REQUIRED"),
  );
});
test("an unsigned paper original remains preparation after PDF completion and cannot archive", async () => {
  const policy = await prepareSigningPolicy(
    fake,
    context,
    {},
    [],
    [assignment("PAPER_ORIGINAL")],
  );
  const updates: unknown[] = [];
  const tx = {
    printRequest: {
      findFirst: async () => ({
        id: "request",
        tenantId: context.tenantId,
        status: "FINALIZED",
        archivedAt: null,
      }),
      update: async () => {
        throw new Error("Unsigned paper must not archive");
      },
    },
    issuanceWorkflow: {
      findFirst: async () => ({
        id: "workflow",
        issuanceId: "issuance",
        status: "RENDERING",
        completedAt: null,
        requiredSigners: policy,
      }),
      update: async (value: unknown) => {
        updates.push(value);
      },
    },
    issuedDocument: {
      findMany: async () => [
        {
          id: "document",
          templateId: "lms-certificate",
          assignmentId: "assignment",
          number: "LOCAL-001",
        },
      ],
    },
    artifact: {
      findMany: async () => [
        {
          id: "pdf",
          documentId: "document",
          format: "PDF",
          fileName: "local.pdf",
          sha256: "synthetic",
        },
      ],
    },
    documentSignature: { findMany: async () => [] },
    auditEvent: { findMany: async () => [] },
    generationJob: {
      findMany: async () => [
        { id: "job", kind: "PDF", status: "SUCCEEDED", artifactId: "pdf" },
      ],
    },
    issuanceEvent: { findFirst: async () => null },
    signatoryBinding: { findMany: async () => [] },
  } as unknown as Prisma.TransactionClient;
  const state = await signingState(context, "request", tx);
  assert.equal(state.status, "AWAITING_SIGNATURE");
  assert.equal(state.archived, false);
  assert.equal(state.documents[0].complete, false);
  assert.equal(state.documents[0].signatureExempt, false);
  assert.deepEqual(updates, [
    { where: { id: "workflow" }, data: { status: "AWAITING_SIGNATURE" } },
  ]);
});
test("mixed LMS and existing DEMO documents preserve legacy signer slots", async () => {
  const policy = await prepareSigningPolicy(
    fake,
    context,
    {},
    [],
    [
      assignment("INFORMATION_CARD"),
      { id: "legacy", templateId: "pb-protocol" },
    ],
  );
  assert.equal(signersFor(policy, "lms-certificate", "assignment").length, 0);
  assert.equal(signersFor(policy, "pb-protocol", "legacy").length, 4);
  assert.equal(
    signersFor(policy, "pb-protocol", "legacy").filter(
      (signer) => !signer.bindingId,
    ).length,
    4,
  );
});
