import test from "node:test";
import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { draftSchema } from "../../packages/contracts/src";
import { db, hash, type Context } from "../../apps/api/src/core";
import { createRequest, finalize } from "../../apps/api/src/requests";
import { bootstrapSuperAdmin } from "../../apps/api/src/settings";
import {
  completeSigning,
  signingState,
  startSigning,
} from "../../apps/api/src/signing";
import { readArtifact, registryExport, store } from "../../apps/api/src/files";
import { assertArtifactDownloadAllowed } from "../../apps/api/src/artifact-access";
import {
  signaturePrintCopy,
  signaturePrintInfo,
} from "../../apps/api/src/signature-print-copy";
import { buildPrintSet } from "../../apps/api/src/print-sets";
import { openArtifact } from "../../apps/api/src/storage";
import {
  createVerificationLink,
  publicVerificationRecord,
} from "../../apps/api/src/public-verification";
import {
  claimJob,
  DeferredJob,
  executeJob,
  heartbeat,
  settleFailure,
} from "../../apps/render-worker/src/queue";
import { provision } from "../../scripts/setup";
import { createApprovalFixture } from "./live-approval-fixture";
import { assertTestDatabase } from "./test-database";

const rejectedCode = (expected: string) => (error: unknown) => {
  assert.equal(
    (error as { getResponse(): { code: string } }).getResponse().code,
    expected,
  );
  return true;
};

test("local CMS rehearsal preserves real bytes, three roles and explicit unverified provenance; scope and replay remain guarded", async (t) => {
  assertTestDatabase();
  const overrides = {
    NODE_ENV: "test",
    HOST: "127.0.0.1",
    DEMO_LOCAL_SIGNATURE_MOCK: "1",
    DEMO_ORIGIN: "http://localhost:3119",
    DEMO_API_ORIGIN: "http://127.0.0.1:4119",
    DEMO_SIGNATURE_VERIFIER_URL: "",
    DEMO_SIGNATURE_VERIFIER_TOKEN: "",
    DEMO_EGOV_SIGNING_CONNECTOR_URL: "",
    DEMO_EGOV_SIGNING_CONNECTOR_TOKEN: "",
  };
  const previous = Object.fromEntries(
    Object.keys(overrides).map((key) => [key, process.env[key]]),
  );
  Object.assign(process.env, overrides);
  t.after(async () => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await db.$disconnect();
  });
  const suffix = randomUUID();
  const password = `Synthetic-local-signing-${suffix}!`;
  const seeded = await provision({
    email: `local-mock-${suffix}@example.test`,
    password,
    name: "СИНТЕТИЧЕСКИЙ локальный тест подписания",
    sample: true,
  });
  const director: Context = {
    ...seeded,
    role: "DIRECTOR",
    sessionId: "synthetic-local-mock",
    csrfHash: "synthetic-local-mock",
    correlationId: randomUUID(),
  };
  await bootstrapSuperAdmin(director, {
    currentPassword: password,
    confirm: true,
  });
  const admin: Context = { ...director, role: "SUPER_ADMIN" };
  const approvals = await createApprovalFixture(admin);
  t.after(() => approvals.close());
  const draft = draftSchema.parse({
    kind: "PERSON",
    demoMode: true,
    schemaVersion: 2,
    title: "СИНТЕТИЧЕСКИЙ локальный CMS, не документы человека",
    items: [
      {
        id: randomUUID(),
        employeeCategory: "WORKER",
        fullNameRu: "Синтетический Получатель",
        fullNameKz: "Сынақ Алушы",
        positionRu: "Слесарь",
        workplaceRu: "Синтетическая организация",
        assignments: [
          {
            id: randomUUID(),
            templateId: "pb-card",
            protocolMode: "INDIVIDUAL",
            documentDate: "2026-11-10",
            protocolDate: "2026-11-10",
            trainingStart: "2026-11-09",
            trainingEnd: "2026-11-10",
            trainingSubject: "Синтетическая программа ПБ",
            hours: "40",
            result: "Сдал",
            outcome: {
              status: "PASSED",
              source: "Синтетический сценарий, не реальный экзамен",
            },
          },
        ],
      },
    ],
  });
  const request = await createRequest(admin, draft);
  await approvals.approve(request.id);
  const issued = await finalize(
    admin,
    request.id,
    { expectedRevision: request.revision },
    randomUUID(),
  );
  const owner = `local-mock-render-${suffix}`;
  for (let iteration = 0; ; iteration++) {
    assert.ok(iteration < 60, "ordinary scoped render queue must finish");
    const remaining = await db.generationJob.count({
      where: {
        tenantId: admin.tenantId,
        issuanceId: issued.issuanceId,
        status: { not: "SUCCEEDED" },
      },
    });
    if (!remaining) break;
    const job = await claimJob(db, owner, admin.tenantId);
    if (!job) {
      await new Promise((resolve) => setTimeout(resolve, 250));
      continue;
    }
    const controller = new AbortController();
    const pulse = setInterval(() => {
      void heartbeat(db, job, owner)
        .then((owned) => {
          if (!owned) controller.abort();
        })
        .catch(() => controller.abort());
    }, 5000);
    try {
      await executeJob(
        db,
        store,
        job,
        owner,
        AbortSignal.any([controller.signal, AbortSignal.timeout(210000)]),
      );
    } catch (error) {
      await settleFailure(db, job, owner, error);
      if (!(error instanceof DeferredJob)) throw error;
    } finally {
      clearInterval(pulse);
    }
  }
  const initial = await signingState(approvals.directorContext, request.id);
  assert.equal(initial.status, "AWAITING_SIGNATURE");
  assert.equal(initial.localMock, true);
  assert.equal(initial.providers.NCALAYER.available, true);
  assert.equal(initial.providers.EGOV_QR.available, false);
  assert.equal(initial.documents.length, 2);
  for (const document of initial.documents)
    assert.deepEqual(
      document.requiredSigners.map((signer) => signer.kind),
      ["DIRECTOR", "CHAIR", "TEACHER"],
    );
  const pdf = initial.documents[0];
  const directorBinding = pdf.requiredSigners.find(
    (signer) => signer.kind === "DIRECTOR",
  )!;
  const startInput = {
    provider: "NCALAYER",
    artifactId: pdf.artifactId,
    bindingId: directorBinding.bindingId,
  };
  process.env.NODE_ENV = "production";
  await assert.rejects(
    startSigning(approvals.directorContext, request.id, startInput),
    rejectedCode("SIGNING_PROVIDER_UNAVAILABLE"),
  );
  process.env.NODE_ENV = "test";
  // An ordinary tenant must remain outside the rehearsal even when an
  // individual request explicitly uses synthetic document mode.
  const ordinary = await provision({
    email: `ordinary-local-${suffix}@example.test`,
    password,
    name: "Синтетическая проверка обычного центра",
    sample: false,
  });
  const ordinaryContext: Context = {
    ...director,
    ...ordinary,
    role: "DIRECTOR",
  };
  for (const demoMode of [false, true]) {
    const ordinaryRequest = await createRequest(ordinaryContext, {
      ...draft,
      demoMode,
    });
    const denied = await signingState(ordinaryContext, ordinaryRequest.id);
    assert.equal(ordinaryRequest.demoMode, demoMode);
    assert.equal(denied.localMock, false);
    assert.equal(denied.providers.NCALAYER.available, false);
  }
  const run = promisify(execFile);
  const openssl = process.env.DEMO_TEST_OPENSSL || "openssl";
  const folder = await mkdtemp(join(tmpdir(), "demo-local-cms-regression-"));
  const key = join(folder, "synthetic.key");
  const certificate = join(folder, "synthetic.pem");
  async function documentText(buffer: Buffer, format: "PDF" | "DOCX") {
    const file = join(
      folder,
      `display-${randomUUID()}.${format.toLowerCase()}`,
    );
    await writeFile(file, buffer);
    const output = await run(
      process.env.DEMO_PYTHON || "python",
      [
        "-c",
        format === "PDF"
          ? "import sys; from pypdf import PdfReader; print('\\n'.join(p.extract_text() or '' for p in PdfReader(sys.argv[1]).pages))"
          : "import sys, zipfile, xml.etree.ElementTree as E; z=zipfile.ZipFile(sys.argv[1]); root=E.fromstring(z.read('word/document.xml')); print('\\n'.join(e.text or '' for e in root.iter() if e.tag.endswith('}t')))",
        file,
      ],
      { encoding: "utf8", env: { ...process.env, PYTHONIOENCODING: "utf-8" } },
    );
    return output.stdout;
  }
  const originals = await db.artifact.findMany({
    where: {
      tenantId: admin.tenantId,
      issuanceId: issued.issuanceId,
      provenance: "ORIGINAL",
    },
  });
  const originalBytes = new Map(
    await Promise.all(
      originals.map(
        async (file) =>
          [file.id, await store.read(file.storageKey, file.sha256)] as const,
      ),
    ),
  );
  let partialSignatureSetHash: string | undefined;
  let partialCopySha256: string | undefined;
  await run(openssl, [
    "req",
    "-x509",
    "-newkey",
    "rsa:2048",
    "-nodes",
    "-keyout",
    key,
    "-out",
    certificate,
    "-days",
    "1",
    "-sha256",
    "-subj",
    "/CN=LOCAL_SYNTHETIC_KEY_NOT_ROLE_ID/O=DEMO TEST ONLY",
  ]);
  let first: { context: Context; id: string; signatureId: string } | undefined;
  for (const document of initial.documents) {
    const artifact = await readArtifact(admin, document.artifactId!);
    assert.equal(artifact.buffer.subarray(0, 5).toString(), "%PDF-");
    const file = join(folder, `${document.documentId}.pdf`);
    const cmsFile = file + ".p7s";
    await writeFile(file, artifact.buffer);
    await run(openssl, [
      "cms",
      "-sign",
      "-binary",
      "-in",
      file,
      "-signer",
      certificate,
      "-inkey",
      key,
      "-outform",
      "DER",
      "-out",
      cmsFile,
      "-md",
      "sha256",
    ]);
    await run(openssl, [
      "cms",
      "-verify",
      "-binary",
      "-inform",
      "DER",
      "-in",
      cmsFile,
      "-content",
      file,
      "-CAfile",
      certificate,
      "-purpose",
      "any",
      "-out",
      file + ".verified",
    ]);
    assert.deepEqual(await readFile(file + ".verified"), artifact.buffer);
    const cms = await readFile(cmsFile);
    for (const signer of document.requiredSigners) {
      const user = await db.user.findUniqueOrThrow({
        where: { id: signer.userId! },
      });
      const context: Context = {
        ...admin,
        userId: user.id,
        role: user.role,
      };
      const session = await startSigning(context, request.id, {
        provider: "NCALAYER",
        artifactId: artifact.id,
        bindingId: signer.bindingId,
      });
      assert.equal(session.localMock, true);
      assert.ok("ncalayerRequest" in session);
      assert.equal("iin" in session.ncalayerRequest.args.signerParams, false);
      assert.equal("bin" in session.ncalayerRequest.args.signerParams, false);
      const savedSession = await db.signingSession.findUniqueOrThrow({
        where: { id: session.id },
      });
      assert.equal(savedSession.provider, "NCALAYER");
      assert.equal(savedSession.providerReference, "NCALAYER_LOCAL_TEST");
      if (!first)
        await assert.rejects(
          completeSigning(context, session.id, {
            signatureBase64: Buffer.alloc(150, 65).toString("base64"),
          }),
          rejectedCode("SIGNATURE_INVALID"),
        );
      const result = await completeSigning(context, session.id, {
        signatureBase64: cms.toString("base64"),
      });
      assert.equal(result.status, "VERIFIED");
      assert.equal(result.localMock, true);
      assert.ok(result.signatureId);
      const signature = await db.documentSignature.findUniqueOrThrow({
        where: { id: result.signatureId },
      });
      assert.equal(signature.provider, "NCALAYER_LOCAL_TEST");
      assert.equal(signature.documentSha256, artifact.sha256);
      assert.equal(
        signature.signatureSha256,
        createHash("sha256").update(cms).digest("hex"),
      );
      assert.deepEqual(
        await store.read(
          signature.signatureStorageKey,
          signature.signatureSha256,
        ),
        cms,
      );
      const verification = signature.verification as Record<string, unknown>;
      assert.equal(verification.authority, "LOCAL_TEST_MOCK");
      assert.equal(verification.valid, false);
      assert.equal(verification.chainValid, false);
      assert.equal(verification.revocationStatus, "NOT_CHECKED");
      assert.equal(verification.acceptedForLocalTest, true);
      const identity = verification.certificateDisplayIdentity as {
        displayName: string;
        identityVerified: boolean;
      };
      assert.equal(identity.displayName, "LOCAL_SYNTHETIC_KEY_NOT_ROLE_ID");
      assert.equal(identity.identityVerified, false);
      if (document === initial.documents[0]) {
        const info = await signaturePrintInfo(admin, artifact.id);
        assert.ok(info);
        assert.equal(info.sourcePdfSha256, artifact.sha256);
        assert.equal(info.localTest, true);
        assert.ok(
          info.signers.every(
            (entry) => entry.displayName === "LOCAL_SYNTHETIC_KEY_NOT_ROLE_ID",
          ),
        );
        assert.ok(
          info.signers.every((entry) =>
            /не проверено/.test(entry.identityNote),
          ),
        );
        if (!first) {
          assert.equal(info.signers.length, 1);
          assert.equal(info.pendingRoles.length, 2);
          partialSignatureSetHash = info.signatureSetHash;
          const copy = await signaturePrintCopy(admin, artifact);
          assert.ok(copy);
          assert.equal(copy.provenance, "SIGNATURE_PRINT_COPY");
          assert.equal(copy.signatureEvidence.sourcePdfSha256, artifact.sha256);
          assert.equal(copy.signatureEvidence.signatures.length, 1);
          assert.equal(copy.signatureEvidence.pendingRoles.length, 2);
          partialCopySha256 = copy.sha256;
          assert.notEqual(copy.sha256, artifact.sha256);
          const text = await documentText(copy.buffer, "PDF");
          assert.match(text, /LOCAL_SYNTHETIC_KEY_NOT_ROLE_ID/);
          assert.match(text, /локальн[а-я]+ тест/i);
          assert.match(text, /не проверен[а-я]*/i);
          assert.deepEqual(
            (await signaturePrintCopy(admin, artifact))?.buffer,
            copy.buffer,
            "same signature set reuses the same derivative",
          );
          const docx = originals.find(
            (file) =>
              file.documentId === document.documentId && file.format === "DOCX",
          )!;
          const word = await signaturePrintCopy(admin, docx);
          assert.ok(word);
          assert.equal(word.signatureEvidence.sourcePdfSha256, artifact.sha256);
          assert.equal(word.signatureEvidence.sourceArtifactId, docx.id);
          assert.match(
            await documentText(word.buffer, "DOCX"),
            /LOCAL_SYNTHETIC_KEY_NOT_ROLE_ID/,
          );
          await assert.rejects(
            signaturePrintInfo(ordinaryContext, artifact.id),
            rejectedCode("NOT_FOUND"),
          );
          await assert.rejects(
            signaturePrintCopy(ordinaryContext, artifact),
            rejectedCode("NOT_FOUND"),
          );
        } else if (info.signers.length === 2) {
          assert.notEqual(
            info.signatureSetHash,
            partialSignatureSetHash,
            "adding a signature invalidates the metadata/cache key",
          );
          const copy = await signaturePrintCopy(admin, artifact);
          assert.ok(copy);
          assert.notEqual(copy.sha256, partialCopySha256);
          assert.equal(copy.signatureEvidence.signatures.length, 2);
          assert.equal(copy.signatureEvidence.pendingRoles.length, 1);
        }
      }
      first ||= { context, id: session.id, signatureId: signature.id };
    }
  }
  assert.ok(first);
  const final = await signingState(approvals.directorContext, request.id);
  assert.equal(final.status, "ISSUED");
  assert.ok(final.documents.every((document) => document.complete));
  for (const document of initial.documents) {
    const original = originals.find((file) => file.id === document.artifactId)!;
    const info = await signaturePrintInfo(admin, original.id);
    assert.ok(info);
    assert.equal(info.signers.length, 3);
    assert.deepEqual(info.pendingRoles, []);
    const marked = await signaturePrintCopy(admin, original);
    assert.ok(marked);
    const text = await documentText(marked.buffer, "PDF");
    assert.match(text, /LOCAL_SYNTHETIC_KEY_NOT_ROLE_ID/);
    assert.match(text, /локальн[а-я]+ тест/i);
    assert.match(text, /Директор/);
    assert.match(text, /Председатель комиссии/);
    assert.match(text, /Преподаватель/);
  }
  const merged = await buildPrintSet(admin, request.id, { format: "PDF" });
  const combined = await readArtifact(admin, merged.artifact.id);
  assert.equal(combined.provenance, "PRINT_SET_DERIVATIVE");
  const combinedText = await documentText(combined.buffer, "PDF");
  assert.ok(
    (combinedText.match(/LOCAL_SYNTHETIC_KEY_NOT_ROLE_ID/g) || []).length >= 6,
    "card and protocol in a combined PDF each retain all three signer marks",
  );
  assert.match(combinedText, /локальн[а-я]+ тест/i);
  for (const original of originals) {
    // The pre-signature ZIP stays immutable but is intentionally not served;
    // the fresh ZIP export includes the detached signatures alongside originals.
    const raw =
      original.format === "ZIP"
        ? { buffer: await store.read(original.storageKey, original.sha256) }
        : await readArtifact(admin, original.id);
    assert.deepEqual(
      raw.buffer,
      originalBytes.get(original.id),
      "signed original bytes never change",
    );
    assert.equal(
      createHash("sha256").update(raw.buffer).digest("hex"),
      original.sha256,
    );
    assert.equal(
      (await db.artifact.findUniqueOrThrow({ where: { id: original.id } }))
        .sha256,
      original.sha256,
    );
  }
  assert.equal(
    await db.documentSignature.count({ where: { tenantId: admin.tenantId } }),
    6,
  );
  assert.equal(
    (await completeSigning(first.context, first.id, {})).signatureId,
    first.signatureId,
  );
  const archive = await registryExport(admin, { format: "ZIP" }, request.id);
  const archiveFile = join(folder, "local-test-signatures.zip");
  await writeFile(archiveFile, archive.buffer);
  const manifestResult = await run(process.env.DEMO_PYTHON || "python", [
    "-c",
    "import sys, zipfile, json, hashlib; z=zipfile.ZipFile(sys.argv[1]); print(json.dumps({'signatureManifest':json.loads(z.read('signatures.json')),'manifest':json.loads(z.read('manifest.json')),'hashes':{n:hashlib.sha256(z.read(n)).hexdigest() for n in z.namelist()}}))",
    archiveFile,
  ]);
  const zip = JSON.parse(manifestResult.stdout) as {
    signatureManifest: {
      signatures: Array<Record<string, unknown>>;
      printCopies: Array<{
        fileName: string;
        sourceArtifactId: string;
        sourceSha256: string;
        sourcePdfSha256: string;
        sha256: string;
        provenance: string;
      }>;
    };
    manifest: { files: Array<{ id: string; file: string; sha256: string }> };
    hashes: Record<string, string>;
  };
  const manifest = zip.signatureManifest;
  assert.equal(manifest.signatures.length, 6);
  for (const signature of manifest.signatures) {
    assert.equal(signature.provider, "NCALAYER_LOCAL_TEST");
    assert.equal(signature.verificationMode, "LOCAL_TEST_MOCK");
    assert.equal(signature.verified, false);
    assert.equal(typeof signature.acceptedAt, "string");
    assert.equal("verifiedAt" in signature, false);
    assert.equal(
      zip.hashes[String(signature.fileName)],
      signature.signatureSha256,
    );
  }
  assert.equal(
    manifest.printCopies.length,
    4,
    "one PDF and DOCX display copy per card/protocol",
  );
  for (const copy of manifest.printCopies) {
    assert.match(copy.fileName, /^print-copies\//);
    assert.equal(copy.provenance, "SIGNATURE_PRINT_COPY");
    assert.equal(zip.hashes[copy.fileName], copy.sha256);
    const original = originals.find(
      (file) => file.id === copy.sourceArtifactId,
    )!;
    assert.ok(original);
    assert.equal(copy.sourceSha256, original.sha256);
    assert.notEqual(copy.sha256, original.sha256);
    assert.equal(
      copy.sourcePdfSha256,
      originals.find(
        (file) =>
          file.documentId === original.documentId && file.format === "PDF",
      )!.sha256,
    );
  }
  for (const original of zip.manifest.files)
    assert.equal(
      zip.hashes[original.file],
      originals.find((file) => file.id === original.id)!.sha256,
      "archive retains the immutable original next to the display copy",
    );
  await assert.rejects(
    createVerificationLink(admin, {
      documentId: initial.documents[0].documentId,
      publicationConfirmed: true,
    }),
    rejectedCode("LOCAL_TEST_PUBLICATION_DENIED"),
  );
  // A previously persisted publication link must not expose the test issuance.
  const legacyToken = randomBytes(32).toString("hex");
  await db.publicDocumentVerification.create({
    data: {
      tenantId: admin.tenantId,
      documentId: initial.documents[0].documentId,
      tokenHash: hash(legacyToken),
      createdBy: admin.userId,
      active: true,
    },
  });
  await assert.rejects(
    publicVerificationRecord(legacyToken),
    rejectedCode("RECORD_UNAVAILABLE"),
  );
  process.env.DEMO_LOCAL_SIGNATURE_MOCK = "0";
  const signedOriginal = originals.find((file) => file.id === pdf.artifactId)!;
  await assert.rejects(
    signaturePrintCopy(admin, signedOriginal),
    rejectedCode("LOCAL_TEST_EXPORT_ONLY"),
  );
  await assert.rejects(
    signaturePrintInfo(admin, signedOriginal.id),
    rejectedCode("LOCAL_TEST_EXPORT_ONLY"),
  );
  await assert.rejects(
    buildPrintSet(admin, request.id, { format: "PDF" }),
    rejectedCode("LOCAL_TEST_EXPORT_ONLY"),
  );
  await assert.rejects(
    readArtifact(admin, merged.artifact.id),
    rejectedCode("LOCAL_TEST_EXPORT_ONLY"),
  );
  await assert.rejects(
    openArtifact(admin, merged.artifact.id),
    rejectedCode("LOCAL_TEST_EXPORT_ONLY"),
  );
  await assert.rejects(
    assertArtifactDownloadAllowed(admin, {
      ...merged.artifact,
      issuanceId: null,
    }),
    rejectedCode("LOCAL_TEST_EXPORT_ONLY"),
  );
  await assert.rejects(
    completeSigning(first.context, first.id, {}),
    rejectedCode("LOCAL_SIGNING_MOCK_DENIED"),
  );
  await assert.rejects(
    registryExport(admin, { format: "XLSX" }, request.id),
    rejectedCode("LOCAL_TEST_EXPORT_ONLY"),
  );
  await assert.rejects(
    assertArtifactDownloadAllowed(admin, {
      format: "XLSX",
      issuanceId: issued.issuanceId,
    }),
    rejectedCode("LOCAL_TEST_EXPORT_ONLY"),
  );
  process.env.DEMO_LOCAL_SIGNATURE_MOCK = "1";
  assert.equal(
    await db.auditEvent.count({
      where: {
        tenantId: admin.tenantId,
        action: "LOCAL_TEST_SIGNATURE_ACCEPTED",
      },
    }),
    6,
  );
  assert.equal(
    await db.auditEvent.count({
      where: { tenantId: admin.tenantId, action: "SIGNATURE_VERIFIED" },
    }),
    0,
  );
});
