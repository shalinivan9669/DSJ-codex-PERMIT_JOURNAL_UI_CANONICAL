import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { PRODUCT_ROOT, templateManifest } from "../../packages/printing/src";
import { db, hash } from "../../apps/api/src/core";
import { store } from "../../apps/api/src/files";
import {
  completeSigning,
  signingState,
  startSigning,
} from "../../apps/api/src/signing";
import {
  completeSigningBatch,
  startSigningBatch,
} from "../../apps/api/src/signing-batch";
import { HOSTED_SIGNING_MOCK_PROVIDER } from "../../apps/api/src/local-signing-mock";
import {
  signaturePrintCopy,
  signaturePrintInfo,
} from "../../apps/api/src/signature-print-copy";
import { assertArtifactDownloadAllowed } from "../../apps/api/src/artifact-access";
import {
  createVerificationLink,
  publicVerificationRecord,
} from "../../apps/api/src/public-verification";
import { buildPrintSet } from "../../apps/api/src/print-sets";
import { assertTestDatabase } from "./test-database";
import { mockCms, signingFixture } from "./signing-fixture";

const rejectedCode = (expected: string) => (error: unknown) => {
  assert.equal(
    (error as { getResponse(): { code: string } }).getResponse().code,
    expected,
  );
  return true;
};

test("hosted rehearsal stays scoped, explicitly unverified and inaccessible after opt-out", async (t) => {
  assertTestDatabase();
  const overrides = {
    NODE_ENV: "production",
    HOST: "0.0.0.0",
    DEMO_LOCAL_SIGNATURE_MOCK: "0",
    DEMO_HOSTED_SIGNATURE_MOCK: "1",
    DEMO_HOSTED_SIGNATURE_MOCK_TENANT_ID: "",
    DEMO_ORIGIN: "https://synthetic-web.up.railway.app",
    DEMO_API_ORIGIN: "https://synthetic-api.up.railway.app",
    DEMO_SIGNATURE_VERIFIER_URL: "",
    DEMO_SIGNATURE_VERIFIER_TOKEN: "",
    DEMO_EGOV_SIGNING_CONNECTOR_URL: "",
    DEMO_EGOV_SIGNING_CONNECTOR_TOKEN: "",
    DEMO_PYTHON: process.env.DEMO_PYTHON || "python",
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

  await t.test(
    "single and bulk persist hosted provenance, metadata remains unverified and public links stay denied",
    async () => {
      const manifest = await templateManifest();
      const template = [
        ...manifest.templates,
        ...(manifest.specialTemplates || []),
      ].find((entry) => entry.id === "pb-protocol")!;
      assert.ok(template);
      const docxBytes = await readFile(
        join(PRODUCT_ROOT, "assets/templates", String(template.file)),
      );
      const f = await signingFixture({ docxBytes, templateId: "pb-protocol" });
      process.env.DEMO_HOSTED_SIGNATURE_MOCK_TENANT_ID = f.c.tenantId;
      const issued = await f.issuance();
      const original = issued.artifacts[0];
      const start = await startSigning(f.c, f.request.id, {
        provider: "NCALAYER",
        artifactId: original.id,
        bindingId: f.bindings[0].id,
      });
      assert.equal(start.localMock, false);
      assert.equal(start.testMode, true);
      assert.equal(start.mockMode, "HOSTED_TEST_MOCK");
      assert.ok("ncalayerRequest" in start);
      assert.equal("iin" in start.ncalayerRequest.args.signerParams, false);
      assert.equal("bin" in start.ncalayerRequest.args.signerParams, false);
      assert.equal(
        (await db.signingSession.findUniqueOrThrow({ where: { id: start.id } }))
          .providerReference,
        HOSTED_SIGNING_MOCK_PROVIDER,
      );
      await assert.rejects(
        completeSigning(f.c, start.id, {
          signatureBase64: Buffer.alloc(150, 65).toString("base64"),
        }),
        rejectedCode("SIGNATURE_INVALID"),
      );
      const signature = mockCms();
      const single = await completeSigning(f.c, start.id, {
        signatureBase64: signature,
      });
      assert.equal(single.status, "VERIFIED");
      assert.equal(single.mockMode, "HOSTED_TEST_MOCK");
      const receipt = await db.documentSignature.findUniqueOrThrow({
        where: { id: single.signatureId! },
      });
      assert.equal(receipt.provider, HOSTED_SIGNING_MOCK_PROVIDER);
      assert.equal(receipt.documentSha256, original.sha256);
      const evidence = receipt.verification as Record<string, unknown>;
      assert.equal(evidence.valid, false);
      assert.equal(evidence.chainValid, false);
      assert.equal(evidence.revocationStatus, "NOT_CHECKED");
      assert.equal(evidence.authority, "HOSTED_TEST_MOCK");
      assert.equal(evidence.acceptedForHostedTest, true);
      assert.notEqual(evidence.acceptedForLocalTest, true);
      assert.deepEqual(
        await store.read(receipt.signatureStorageKey, receipt.signatureSha256),
        Buffer.from(signature, "base64"),
      );

      const batch = await startSigningBatch(f.c, f.request.id, {
        issuanceId: issued.id,
        operationKey: randomUUID(),
      });
      assert.equal(batch.mockMode, "HOSTED_TEST_MOCK");
      assert.equal(batch.localMock, false);
      assert.equal(batch.entries.length, 5);
      const entries = batch.entries.map((entry) => ({
        sessionId: entry.sessionId,
        signatureBase64: mockCms(),
      }));
      const complete = await completeSigningBatch(f.c, batch.batchId, {
        entries,
      });
      assert.equal(complete.completedCount, 5);
      assert.equal(complete.failedCount, 0);
      const receipts = await db.documentSignature.findMany({
        where: { tenantId: f.c.tenantId },
      });
      assert.equal(receipts.length, 6);
      assert.ok(
        receipts.every(
          (value) => value.provider === HOSTED_SIGNING_MOCK_PROVIDER,
        ),
      );
      const state = await signingState(f.c, f.request.id, db, issued.id);
      assert.equal(state.status, "ISSUED");
      assert.equal(state.testMode, true);
      assert.equal(state.localMock, false);
      assert.equal(state.mockMode, "HOSTED_TEST_MOCK");
      assert.equal(
        await db.auditEvent.count({
          where: { tenantId: f.c.tenantId, action: "SIGNATURE_VERIFIED" },
        }),
        0,
      );

      const info = await signaturePrintInfo(f.c, original.id);
      assert.equal(info.testMode, true);
      assert.equal(info.mockMode, "HOSTED_TEST_MOCK");
      assert.equal(info.signers.length, 3);
      assert.ok(
        info.signers.every((signer) =>
          /Тестовая роль|не проверено/.test(signer.identityNote),
        ),
      );
      await assert.rejects(
        createVerificationLink(f.c, {
          documentId: original.documentId!,
          publicationConfirmed: true,
        }),
        rejectedCode("HOSTED_TEST_PUBLICATION_DENIED"),
      );
      const token = randomBytes(32).toString("hex");
      await db.publicDocumentVerification.create({
        data: {
          tenantId: f.c.tenantId,
          documentId: original.documentId!,
          tokenHash: hash(token),
          createdBy: f.c.userId,
          active: true,
        },
      });
      await assert.rejects(
        publicVerificationRecord(token),
        rejectedCode("RECORD_UNAVAILABLE"),
      );

      // One DOCX-only derivative warms the real cache, without PDF rendering.
      assert.ok(original.docx);
      const copy = await signaturePrintCopy(f.c, original.docx);
      assert.ok(copy);
      assert.equal(copy.signatureEvidence.testMode, true);
      assert.equal(copy.signatureEvidence.mockMode, "HOSTED_TEST_MOCK");
      const python = process.env.DEMO_PYTHON;
      process.env.DEMO_PYTHON = join(
        PRODUCT_ROOT,
        "synthetic-renderer-must-not-run.exe",
      );
      try {
        assert.deepEqual(
          (await signaturePrintCopy(f.c, original.docx))?.buffer,
          copy.buffer,
        );
        process.env.DEMO_HOSTED_SIGNATURE_MOCK = "0";
        await assert.rejects(
          signaturePrintCopy(f.c, original.docx),
          rejectedCode("HOSTED_TEST_EXPORT_ONLY"),
        );
        await assert.rejects(
          signaturePrintInfo(f.c, original.id),
          rejectedCode("HOSTED_TEST_EXPORT_ONLY"),
        );
        await assert.rejects(
          assertArtifactDownloadAllowed(f.c, {
            format: "XLSX",
            issuanceId: issued.id,
          }),
          rejectedCode("HOSTED_TEST_EXPORT_ONLY"),
        );
        await assert.rejects(
          buildPrintSet(f.c, f.request.id, { format: "PDF" }),
          rejectedCode("HOSTED_TEST_EXPORT_ONLY"),
        );
        await assert.rejects(
          completeSigning(f.c, start.id, { signatureBase64: signature }),
          rejectedCode("HOSTED_SIGNING_MOCK_DENIED"),
        );
        await assert.rejects(
          completeSigningBatch(f.c, batch.batchId, { entries }),
          rejectedCode("HOSTED_SIGNING_MOCK_DENIED"),
        );
        // Enabling the local mode cannot authorize evidence created in hosted mode.
        Object.assign(process.env, {
          NODE_ENV: "test",
          HOST: "127.0.0.1",
          DEMO_LOCAL_SIGNATURE_MOCK: "1",
          DEMO_ORIGIN: "http://localhost:3119",
          DEMO_API_ORIGIN: "http://127.0.0.1:4119",
        });
        await assert.rejects(
          signaturePrintCopy(f.c, original.docx),
          rejectedCode("HOSTED_TEST_EXPORT_ONLY"),
        );
        await assert.rejects(
          completeSigning(f.c, start.id, { signatureBase64: signature }),
          rejectedCode("HOSTED_SIGNING_MOCK_DENIED"),
        );
      } finally {
        Object.assign(process.env, overrides, {
          DEMO_HOSTED_SIGNATURE_MOCK_TENANT_ID: f.c.tenantId,
          DEMO_PYTHON: python,
        });
      }
      assert.deepEqual(
        await store.read(original.storageKey, original.sha256),
        original.bytes,
      );
      assert.deepEqual(
        await store.read(original.docx.storageKey, original.docx.sha256),
        docxBytes,
      );
      assert.equal(
        await db.documentSignature.count({ where: { tenantId: f.c.tenantId } }),
        6,
      );
    },
  );

  await t.test(
    "allowlisting alone never enables ordinary tenants or ordinary requests",
    async () => {
      for (const options of [{ demoOnly: false }, { demoMode: false }, {}]) {
        const f = await signingFixture(options);
        process.env.DEMO_HOSTED_SIGNATURE_MOCK_TENANT_ID = Object.keys(options)
          .length
          ? f.c.tenantId
          : randomUUID();
        const issued = await f.issuance(1);
        const state = await signingState(f.c, f.request.id, db, issued.id);
        assert.equal(state.testMode, false);
        assert.equal(state.mockMode, null);
        assert.equal(state.providers.NCALAYER.available, false);
        await assert.rejects(
          startSigning(f.c, f.request.id, {
            provider: "NCALAYER",
            artifactId: issued.artifacts[0].id,
            bindingId: f.bindings[0].id,
          }),
          rejectedCode("SIGNING_PROVIDER_UNAVAILABLE"),
        );
        await assert.rejects(
          startSigningBatch(f.c, f.request.id, {
            issuanceId: issued.id,
            operationKey: randomUUID(),
          }),
          rejectedCode("SIGNING_PROVIDER_UNAVAILABLE"),
        );
        assert.equal(
          await db.signingSession.count({ where: { tenantId: f.c.tenantId } }),
          0,
        );
      }
    },
  );

  await t.test(
    "a pending or historical real session cannot reuse a hosted test receipt",
    async (st) => {
      const f = await signingFixture();
      process.env.DEMO_HOSTED_SIGNATURE_MOCK_TENANT_ID = f.c.tenantId;
      process.env.DEMO_HOSTED_SIGNATURE_MOCK = "0";
      process.env.DEMO_SIGNATURE_VERIFIER_URL =
        "https://synthetic-verifier.example.test";
      process.env.DEMO_SIGNATURE_VERIFIER_TOKEN = "synthetic-not-a-real-token";
      const issued = await f.issuance(1);
      const original = issued.artifacts[0];
      let verifierCalls = 0;
      // Synthetic verifier contract only; these bytes are not a trusted certificate.
      st.mock.method(globalThis, "fetch", async () => {
        verifierCalls++;
        return new Response(
          JSON.stringify({
            valid: true,
            authority: "NCA_RK",
            chainValid: true,
            revocationStatus: "GOOD",
            revocationCheckedAt: new Date().toISOString(),
            purpose: "SIGNATURE",
            contentSha256: original.sha256,
            signerIin: f.bindings[0].iin,
            signerBin: null,
            certificateSerial: "SYNTHETIC-VERIFIER-ONLY",
            certificateFingerprint: "a".repeat(64),
            notBefore: "2020-01-01T00:00:00.000Z",
            notAfter: "2099-01-01T00:00:00.000Z",
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      });
      try {
        const input = {
          provider: "NCALAYER",
          artifactId: original.id,
          bindingId: f.bindings[0].id,
        };
        const real = await startSigning(f.c, f.request.id, input);
        assert.equal(real.mockMode, null);
        process.env.DEMO_HOSTED_SIGNATURE_MOCK = "1";
        const hosted = await startSigning(f.c, f.request.id, input);
        await completeSigning(f.c, hosted.id, { signatureBase64: mockCms() });
        assert.equal(verifierCalls, 0);
        process.env.DEMO_HOSTED_SIGNATURE_MOCK = "0";
        await assert.rejects(
          completeSigning(f.c, real.id, { signatureBase64: mockCms() }),
          rejectedCode("SIGNATURE_MODE_MISMATCH"),
        );
        assert.equal(verifierCalls, 1);
        assert.equal(
          (
            await db.signingSession.findUniqueOrThrow({
              where: { id: real.id },
            })
          ).status,
          "PENDING",
        );
        await assert.rejects(
          startSigning(f.c, f.request.id, input),
          rejectedCode("SIGNATURE_MODE_MISMATCH"),
        );
        await assert.rejects(
          startSigningBatch(f.c, f.request.id, {
            issuanceId: issued.id,
            operationKey: randomUUID(),
          }),
          rejectedCode("SIGNATURE_MODE_MISMATCH"),
        );
        // Historical fixture representing an older incorrectly finalized session.
        await db.signingSession.update({
          where: { id: real.id },
          data: { status: "VERIFIED" },
        });
        await assert.rejects(
          completeSigning(f.c, real.id, {}),
          rejectedCode("SIGNATURE_MODE_MISMATCH"),
        );
        assert.equal(verifierCalls, 1);
        const receipts = await db.documentSignature.findMany({
          where: { tenantId: f.c.tenantId },
        });
        assert.equal(receipts.length, 1);
        assert.equal(receipts[0].provider, HOSTED_SIGNING_MOCK_PROVIDER);
        assert.equal(
          await db.auditEvent.count({
            where: { tenantId: f.c.tenantId, action: "SIGNATURE_VERIFIED" },
          }),
          0,
        );
      } finally {
        process.env.DEMO_HOSTED_SIGNATURE_MOCK = "1";
        process.env.DEMO_SIGNATURE_VERIFIER_URL = "";
        process.env.DEMO_SIGNATURE_VERIFIER_TOKEN = "";
      }
    },
  );

  await t.test(
    "ordinary production signing still requires the real verifier and never falls back to mock",
    async (st) => {
      const f = await signingFixture({ demoOnly: false });
      process.env.DEMO_HOSTED_SIGNATURE_MOCK_TENANT_ID = f.c.tenantId;
      process.env.DEMO_SIGNATURE_VERIFIER_URL =
        "https://synthetic-verifier.example.test";
      process.env.DEMO_SIGNATURE_VERIFIER_TOKEN = "synthetic-not-a-real-token";
      let calls = 0;
      st.mock.method(
        globalThis,
        "fetch",
        async (_url: unknown, init?: RequestInit) => {
          calls++;
          assert.equal(
            (JSON.parse(String(init?.body)) as { checkRevocation: boolean })
              .checkRevocation,
            true,
          );
          return new Response(JSON.stringify({ valid: false }), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        },
      );
      try {
        const issued = await f.issuance(1);
        const start = await startSigning(f.c, f.request.id, {
          provider: "NCALAYER",
          artifactId: issued.artifacts[0].id,
          bindingId: f.bindings[0].id,
        });
        assert.equal(start.testMode, false);
        assert.equal(start.mockMode, null);
        assert.ok("ncalayerRequest" in start);
        assert.equal(
          start.ncalayerRequest.args.signerParams.iin,
          f.bindings[0].iin,
        );
        assert.equal(
          (
            await db.signingSession.findUniqueOrThrow({
              where: { id: start.id },
            })
          ).providerReference,
          null,
        );
        await assert.rejects(
          completeSigning(f.c, start.id, { signatureBase64: mockCms() }),
          rejectedCode("SIGNATURE_INVALID"),
        );
        assert.equal(calls, 1);
        assert.equal(
          await db.documentSignature.count({
            where: { tenantId: f.c.tenantId },
          }),
          0,
        );
      } finally {
        process.env.DEMO_SIGNATURE_VERIFIER_URL = "";
        process.env.DEMO_SIGNATURE_VERIFIER_TOKEN = "";
      }
    },
  );
});
