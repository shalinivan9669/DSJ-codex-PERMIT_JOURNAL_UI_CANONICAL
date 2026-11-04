import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { draftSchema } from "@demo/contracts";
import { db, type Context } from "../../apps/api/src/core";
import { provision } from "../../scripts/setup";
import { bootstrapSuperAdmin } from "../../apps/api/src/settings";
import {
  createRequest,
  finalize,
  requestDetail,
} from "../../apps/api/src/requests";
import {
  attestPaperSignatures,
  signingState,
  saveSignatory,
} from "../../apps/api/src/signing";
import { store } from "../../apps/api/src/files";
import { createApprovalFixture } from "./live-approval-fixture";
import { assertTestDatabase } from "./test-database";
import { syntheticPdf } from "../fixtures/pdf";

const errorCode = (code: string) => (error: unknown) => {
  assert.equal(
    (error as { getResponse(): { code: string } }).getResponse().code,
    code,
  );
  return true;
};

test("BIOT, PB and PTM paper signatures complete one shared protocol per group with immutable, repeatable and tenant-scoped evidence", async (t) => {
  assertTestDatabase();
  const password = "Synthetic-Paper-Fixture-Only!";
  const seeded = await provision({
    email: `paper-${randomUUID()}@example.test`,
    password,
    name: "Синтетический бумажный контур",
    sample: true,
  });
  const c: Context = {
    ...seeded,
    role: "DIRECTOR",
    sessionId: "test",
    csrfHash: "test",
    correlationId: randomUUID(),
  };
  await bootstrapSuperAdmin(c, { currentPassword: password, confirm: true });
  c.role = "SUPER_ADMIN";
  const approvals = await createApprovalFixture(c);
  t.after(async () => {
    await approvals.close();
    await db.$disconnect();
  });
  const expert = await db.user.create({
    data: {
      tenantId: c.tenantId,
      email: `paper-expert-${randomUUID()}@example.test`,
      displayName: "Синтетический эксперт LMS",
      role: "EXPERT",
      passwordHash: "SYNTHETIC_UNUSED_PASSWORD_HASH",
    },
  });
  await assert.rejects(
    saveSignatory(approvals.directorContext, {
      userId: expert.id,
      displayName: expert.displayName,
      role: "TEACHER",
      iin: "000000000099",
    }),
    errorCode("SIGNATORY_ROLE"),
  );
  // No active EDS binding is required to print or attest the paper originals.
  await db.signatoryBinding.updateMany({
    where: { tenantId: c.tenantId },
    data: { active: false },
  });
  const programs = [
    { card: "biot-worker-card", protocol: "biot-protocol", title: "БиОТ" },
    { card: "pb-card", protocol: "pb-protocol", title: "ПБ" },
    { card: "ptm-card", protocol: "ptm-protocol", title: "ПТМ" },
  ].map((program) => ({ ...program, groupId: randomUUID() }));
  const draft = draftSchema.parse({
    kind: "PERSON",
    demoMode: true,
    events: programs.map((program) => ({
      id: program.groupId,
      title: `Синтетическая программа ${program.title}`,
      protocolTemplateId: program.protocol,
      protocolMode: "GROUP",
      commonFields: {
        documentDate: "2026-10-04",
        protocolDate: "2026-10-04",
        trainingStart: "2026-10-01",
        trainingEnd: "2026-10-03",
        trainingSubject: `Синтетическая программа ${program.title}`,
        hours: program.title === "БиОТ" ? "10" : "40",
        ...(program.title === "БиОТ"
          ? {
              productionHours: "16",
              biotCategory: "WORKER",
              biotCheckType: "PERIODIC",
            }
          : {}),
      },
    })),
    items: [0, 1].map((index) => ({
      id: `person-${index}`,
      fullNameRu: `Синтетический Получатель ${index}`,
      positionRu: "Оператор",
      employeeCategory: "WORKER",
      workplaceRu: "Синтетическое предприятие",
      assignments: programs.map((program) => ({
        id: `${program.card}-${index}`,
        templateId: program.card,
        protocolMode: "GROUP",
        eventId: program.groupId,
        outcome: {
          status: "PASSED",
          source: "Синтетический факт внешней проверки",
        },
      })),
    })),
  });
  const created = await createRequest(c, draft);
  await approvals.approve(created.id);
  const current = await requestDetail(c, created.id);
  const issued = await finalize(
    c,
    created.id,
    { expectedRevision: current.revision },
    randomUUID(),
  );
  // The API creates real immutable rows; local PDF fixtures isolate the paper
  // attestation lifecycle from layout and LibreOffice tests.
  for (const job of await db.generationJob.findMany({
    where: {
      tenantId: c.tenantId,
      issuanceId: issued.issuanceId,
      kind: { not: "ZIP" },
    },
  })) {
    const bytes = syntheticPdf(`SYNTHETIC ${job.kind} ${job.id}`);
    const asset = await store.put(bytes, job.kind.toLowerCase());
    const artifact = await db.artifact.create({
      data: {
        tenantId: c.tenantId,
        requestId: created.id,
        issuanceId: issued.issuanceId,
        jobId: job.id,
        documentId: job.documentId,
        ...asset,
        format: job.kind,
        mimeType: "application/pdf",
        fileName: `synthetic-${job.id}.${job.kind.toLowerCase()}`,
        provenance: "ORIGINAL",
        rendererVersion: "synthetic-paper-fixture",
        inputHash: job.snapshotId,
      },
    });
    await db.generationJob.update({
      where: { id: job.id },
      data: { status: "SUCCEEDED", artifactId: artifact.id },
    });
  }
  const before = await signingState(approvals.directorContext, created.id);
  assert.equal(before.status, "AWAITING_SIGNATURE");
  assert.equal(before.documents.length, 9);
  for (const program of programs) {
    assert.equal(
      before.documents.filter(
        (document) => document.templateId === program.protocol,
      ).length,
      1,
    );
    assert.equal(
      before.documents.filter(
        (document) => document.templateId === program.card,
      ).length,
      2,
    );
  }
  assert.ok(
    before.documents.every(
      (document) =>
        document.paperAllowed &&
        document.canAttestPaper &&
        document.requiredSigners.length === 3,
    ),
  );
  assert.ok(
    before.documents.every((document) =>
      document.requiredSigners.every((signer) => !signer.bindingId),
    ),
  );
  const input = {
    documentIds: before.documents.map((document) => document.documentId),
    signedAt: "2026-10-04",
    signerNames: [
      "Синтетический Директор",
      "Синтетический Председатель",
      "Синтетический Преподаватель",
    ],
    allRequiredSignaturesPresent: true,
    reason: "Синтетическая проверка подписанного бумажного оригинала",
  };
  await assert.rejects(
    attestPaperSignatures(
      { ...approvals.directorContext, role: "OPERATOR" },
      created.id,
      input,
    ),
    errorCode("ROLE_DENIED"),
  );
  await assert.rejects(
    attestPaperSignatures(
      { ...approvals.directorContext, tenantId: randomUUID() },
      created.id,
      input,
    ),
    errorCode("NOT_FOUND"),
  );
  await assert.rejects(
    attestPaperSignatures(approvals.directorContext, created.id, {
      ...input,
      signerNames: ["Один подписант"],
    }),
    errorCode("PAPER_SIGNERS_REQUIRED"),
  );
  const first = await attestPaperSignatures(
    approvals.directorContext,
    created.id,
    input,
  );
  assert.equal(first.items.length, 9);
  const repeated = await attestPaperSignatures(
    approvals.directorContext,
    created.id,
    input,
  );
  assert.ok(repeated.items.every((entry) => entry.duplicate));
  const after = await signingState(approvals.directorContext, created.id);
  assert.equal(after.status, "ISSUED");
  assert.ok(
    after.documents.every(
      (document) =>
        document.complete &&
        document.paperSignature &&
        !document.canAttestPaper,
    ),
  );
  assert.ok(
    after.documents.every((document) =>
      document.requiredSigners.every((signer) => !signer.signed),
    ),
  );
  assert.equal(
    await db.documentSignature.count({ where: { tenantId: c.tenantId } }),
    0,
  );
  assert.equal(
    await db.auditEvent.count({
      where: { tenantId: c.tenantId, action: "PRINT_PAPER_SIGNATURE_ATTESTED" },
    }),
    9,
  );
  await assert.rejects(
    attestPaperSignatures(approvals.directorContext, created.id, {
      ...input,
      reason: "Попытка перезаписи",
    }),
    errorCode("PAPER_SIGNATURE_ALREADY_RECORDED"),
  );
});
