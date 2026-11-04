import test from "node:test";
import assert from "node:assert/strict";
import {
  TENANT_EXPORT_EXCLUDED_MODELS,
  tenantExportFileReferences,
  tenantExportSelect,
} from "../apps/api/src/tenant-export-policy";

test("owner exports omit MFA state and credential columns before reading records", () => {
  for (const name of [
    "Session",
    "MfaFactor",
    "MfaRecoveryCode",
    "MfaChallenge",
    "MfaReauth",
  ])
    assert.equal(TENANT_EXPORT_EXCLUDED_MODELS.has(name), true);
  const fields = [
    "id",
    "displayName",
    "passwordHash",
    "tokenHash",
    "verificationTokenHash",
    "csrfHash",
    "secretHash",
    "codeHash",
    "secretCiphertext",
    "pendingCiphertext",
    "documentSha256",
    "signatureSha256",
    "verification",
  ].map((name) => ({ name, kind: "scalar" }));
  assert.deepEqual(
    tenantExportSelect([...fields, { name: "sessions", kind: "object" }]),
    {
      id: true,
      displayName: true,
      documentSha256: true,
      signatureSha256: true,
      verification: true,
    },
  );
});

test("signature archives validate the signature digest independently of the signed document", () => {
  assert.deepEqual(
    tenantExportFileReferences({
      signatureStorageKey: "objects/synthetic.p7s",
      signatureSha256: "signature-digest",
      documentSha256: "document-digest",
    }),
    [
      {
        field: "signatureStorageKey",
        key: "objects/synthetic.p7s",
        expectedHash: "signature-digest",
        expectedSize: undefined,
      },
    ],
  );
});

test("original photos use their own bytes, without the normalized image size or digest", () => {
  assert.deepEqual(
    tenantExportFileReferences({
      storageKey: "objects/normalized.png",
      originalStorageKey: "objects/original.jpg",
      sha256: "normalized-digest",
      size: 42,
    }),
    [
      {
        field: "storageKey",
        key: "objects/normalized.png",
        expectedHash: "normalized-digest",
        expectedSize: 42,
      },
      {
        field: "originalStorageKey",
        key: "objects/original.jpg",
        expectedHash: undefined,
        expectedSize: undefined,
      },
    ],
  );
  assert.deepEqual(tenantExportFileReferences({ storageKey: null }), []);
});
