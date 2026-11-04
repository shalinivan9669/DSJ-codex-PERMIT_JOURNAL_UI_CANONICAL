import { syntheticPdf } from "../fixtures/pdf";
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { db, type Context } from "../../apps/api/src/core";
import { ArtifactStore } from "../../packages/printing/src";
import {
  tenantExportSnapshot,
  exportTenant,
} from "../../apps/api/src/tenant-export";
import { assertTestDatabase } from "./test-database";
import {
  exportOrderDossier,
  createOrderMilestone,
} from "../../apps/api/src/operator-value";

test("tenant export includes new data and verified files, excludes foreign tenant and all auth secrets, refuses partial archive", async () => {
  assertTestDatabase();
  const tenant = await db.tenant.create({
    data: { name: "Синтетический владелец выгрузки" },
  });
  const foreign = await db.tenant.create({
    data: { name: "Закрытый чужой центр" },
  });
  const user = await db.user.create({
    data: {
      tenantId: tenant.id,
      email: `export-${randomUUID()}@example.test`,
      displayName: "Владелец",
      role: "DIRECTOR",
      passwordHash: "SECRET_PASSWORD_HASH",
    },
  });
  await db.user.create({
    data: {
      tenantId: foreign.id,
      email: `secret-${randomUUID()}@example.test`,
      displayName: "FOREIGN_PERSON_PRIVATE",
      role: "ADMIN",
      passwordHash: "FOREIGN_SECRET",
    },
  });
  await db.session.create({
    data: {
      id: randomUUID(),
      tenantId: tenant.id,
      userId: user.id,
      csrfHash: "SESSION_SECRET",
      sessionVersion: 1,
      expiresAt: new Date(Date.now() + 60000),
    },
  });
  await db.mfaFactor.create({
    data: {
      tenantId: tenant.id,
      userId: user.id,
      secretCiphertext: "SYNTHETIC_MFA_SECRET_CIPHERTEXT",
      pendingCiphertext: "SYNTHETIC_MFA_PENDING_CIPHERTEXT",
    },
  });
  await db.mfaRecoveryCode.create({
    data: {
      tenantId: tenant.id,
      userId: user.id,
      codeHash: "SYNTHETIC_MFA_RECOVERY_HASH",
    },
  });
  await db.mfaChallenge.create({
    data: {
      id: "SYNTHETIC_CHALLENGE_HASH_" + randomUUID(),
      tenantId: tenant.id,
      userId: user.id,
      sessionVersion: 1,
      expiresAt: new Date(Date.now() + 60_000),
    },
  });
  await db.mfaReauth.create({
    data: {
      id: "SYNTHETIC_REAUTH_HASH_" + randomUUID(),
      tenantId: tenant.id,
      userId: user.id,
      sessionId: "synthetic-session",
      purpose: "synthetic",
      expiresAt: new Date(Date.now() + 60_000),
    },
  });
  const c: Context = {
    tenantId: tenant.id,
    userId: user.id,
    role: "DIRECTOR",
    sessionId: "test",
    csrfHash: "test",
    correlationId: randomUUID(),
  };
  const order = await db.serviceOrder.create({
    data: {
      tenantId: tenant.id,
      title: "Сохранённый рабочий заказ",
      createdBy: user.id,
    },
  });
  const bytes = syntheticPdf("SYNTHETIC_PRESERVED_BYTES");
  const stored = await new ArtifactStore().put(bytes, "pdf");
  const attachment = await db.valueAttachment.create({
    data: {
      tenantId: tenant.id,
      orderId: order.id,
      category: "SOURCE",
      source: "Синтетический исходник",
      ...stored,
      fileName: "source.pdf",
      mimeType: "application/pdf",
      createdBy: user.id,
    },
  });
  // Archive routing fixture only: these bytes are deliberately not a real EDS.
  const signatureBytes = Buffer.from("SYNTHETIC_ARCHIVE_SIGNATURE_BYTES");
  const signatureFile = await new ArtifactStore().put(signatureBytes, "p7s");
  const profile = await db.issuerProfileVersion.create({
    data: { tenantId: tenant.id, version: 1, profile: {}, createdBy: user.id },
  });
  const request = await db.printRequest.create({
    data: {
      tenantId: tenant.id,
      kind: "PERSON",
      draft: {},
      createdBy: user.id,
    },
  });
  const issuance = await db.issuance.create({
    data: {
      tenantId: tenant.id,
      requestId: request.id,
      sourceRevision: 0,
      snapshot: { fixtureOnly: true },
      inputHash: "1".repeat(64),
      profileVersionId: profile.id,
      createdBy: user.id,
    },
  });
  const renderInput = await db.renderInputSnapshot.create({
    data: {
      tenantId: tenant.id,
      requestId: request.id,
      issuanceId: issuance.id,
      revision: 0,
      profileVersionId: profile.id,
      input: { fixtureOnly: true },
      inputHash: issuance.inputHash,
    },
  });
  const job = await db.generationJob.create({
    data: {
      tenantId: tenant.id,
      requestId: request.id,
      issuanceId: issuance.id,
      snapshotId: renderInput.id,
      kind: "PDF",
      status: "SUCCEEDED",
      logicalKey: "synthetic-export-" + randomUUID(),
    },
  });
  const artifact = await db.artifact.create({
    data: {
      tenantId: tenant.id,
      requestId: request.id,
      issuanceId: issuance.id,
      jobId: job.id,
      ...stored,
      format: "PDF",
      mimeType: "application/pdf",
      fileName: "synthetic.pdf",
      rendererVersion: "archive-fixture",
      inputHash: issuance.inputHash,
    },
  });
  const binding = await db.signatoryBinding.create({
    data: {
      tenantId: tenant.id,
      userId: user.id,
      displayName: "Синтетический директор",
      kind: "DIRECTOR",
      iin: "000000000000",
      createdBy: user.id,
    },
  });
  const session = await db.signingSession.create({
    data: {
      tenantId: tenant.id,
      issuanceId: issuance.id,
      artifactId: artifact.id,
      bindingId: binding.id,
      provider: "NCALAYER",
      documentSha256: stored.sha256,
      inputHash: issuance.inputHash,
      expiresAt: new Date(Date.now() + 60_000),
      createdBy: user.id,
    },
  });
  const signature = await db.documentSignature.create({
    data: {
      tenantId: tenant.id,
      issuanceId: issuance.id,
      artifactId: artifact.id,
      bindingId: binding.id,
      signingSessionId: session.id,
      documentSha256: stored.sha256,
      signatureSha256: signatureFile.sha256,
      signatureStorageKey: signatureFile.storageKey,
      signerIin: "000000000000",
      certificateSerial: "SYNTHETIC",
      certificateFingerprint: "SYNTHETIC",
      provider: "TEST_ARCHIVE_FIXTURE",
      verification: { fixtureOnly: true },
      createdBy: user.id,
    },
  });
  const snapshot = await tenantExportSnapshot(c);
  assert.equal(snapshot.tables.ServiceOrder[0].id, order.id);
  assert.equal(snapshot.tables.ValueAttachment[0].id, attachment.id);
  assert.equal(snapshot.tables.DocumentSignature[0].id, signature.id);
  assert.ok("DocumentCorrectionRequest" in snapshot.tables);
  assert.ok("ServiceRuleVersion" in snapshot.tables);
  assert.ok("GroupDocumentMember" in snapshot.tables);
  const text = JSON.stringify(snapshot);
  assert.ok(!text.includes("SECRET_PASSWORD_HASH"));
  assert.ok(!text.includes("SESSION_SECRET"));
  assert.ok(!text.includes("SYNTHETIC_MFA_"));
  assert.ok(!text.includes("SYNTHETIC_CHALLENGE_HASH_"));
  assert.ok(!text.includes("SYNTHETIC_REAUTH_HASH_"));
  assert.ok(!text.includes("FOREIGN_PERSON_PRIVATE"));
  assert.ok(!text.includes(foreign.id));
  assert.equal(snapshot.tables.Session, undefined);
  for (const name of [
    "MfaFactor",
    "MfaRecoveryCode",
    "MfaChallenge",
    "MfaReauth",
  ])
    assert.equal(snapshot.tables[name], undefined);
  await assert.rejects(tenantExportSnapshot({ ...c, role: "OPERATOR" }));
  const exported = await exportTenant(c);
  const inspected = spawnSync(
    process.env.DEMO_PYTHON || "python",
    [
      "-c",
      "import sys,io,zipfile,json; z=zipfile.ZipFile(io.BytesIO(sys.stdin.buffer.read())); data=json.loads(z.read('tenant-data.json')); manifest=json.loads(z.read('manifest.json')); by_table={r['table']:f for f in data['files'] for r in f['references']}; print(json.dumps({'complete':manifest['complete'],'tables':list(data['tables']),'attachment':z.read(by_table['ValueAttachment']['fileName']).decode(),'signature':z.read(by_table['DocumentSignature']['fileName']).decode(),'count':len(data['files'])}))",
    ],
    { input: exported.buffer, encoding: "utf8", windowsHide: true },
  );
  assert.equal(inspected.status, 0, inspected.stderr);
  const contents = JSON.parse(inspected.stdout);
  assert.equal(contents.complete, true);
  assert.equal(contents.count, 2);
  assert.equal(contents.attachment, bytes.toString());
  assert.equal(contents.signature, signatureBytes.toString());
  assert.ok(contents.tables.includes("ServiceOrder"));
  await createOrderMilestone(c, order.id, {
    label: "Получить подписанный экземпляр",
    category: "EVIDENCE",
    source: "CONTRACT",
    sourceReference: "Согласованный тестовый комплект",
  });
  const dossier = await exportOrderDossier(c, order.id);
  const dossierProbe = spawnSync(
    process.env.DEMO_PYTHON || "python",
    [
      "-c",
      "import sys,io,zipfile,json; z=zipfile.ZipFile(io.BytesIO(sys.stdin.buffer.read())); m=json.loads(z.read('manifest.json')); print(json.dumps({'complete':m['complete'],'missing':len(m['missing']),'bytes':z.read(next(x for x in z.namelist() if x.startswith('evidence/'))).decode()}))",
    ],
    { input: dossier.buffer, encoding: "utf8", windowsHide: true },
  );
  assert.equal(dossierProbe.status, 0, dossierProbe.stderr);
  const dossierResult = JSON.parse(dossierProbe.stdout);
  assert.equal(dossierResult.complete, false);
  assert.ok(dossierResult.missing >= 2);
  assert.equal(dossierResult.bytes, bytes.toString());
  await db.valueAttachment.create({
    data: {
      tenantId: tenant.id,
      orderId: order.id,
      category: "SOURCE",
      source: "Синтетически отсутствующий исходник",
      storageKey: `objects/missing-${randomUUID()}.pdf`,
      sha256: "a".repeat(64),
      size: 10,
      fileName: "missing.pdf",
      mimeType: "application/pdf",
      createdBy: user.id,
    },
  });
  await assert.rejects(
    exportTenant(c),
    (error: unknown) =>
      typeof error === "object" &&
      error !== null &&
      "getResponse" in error &&
      (error as { getResponse(): { code: string } }).getResponse().code ===
        "TENANT_EXPORT_INCOMPLETE",
  );
  await db.$disconnect();
});
