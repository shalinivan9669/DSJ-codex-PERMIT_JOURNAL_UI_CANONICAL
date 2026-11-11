import test from "node:test";
import assert from "node:assert/strict";
import {
  localSigningMockEnabled,
  localSigningMockAllowed,
  localMockVerification,
} from "../apps/api/src/local-signing-mock";

const env = {
  NODE_ENV: "development",
  DEMO_LOCAL_SIGNATURE_MOCK: "1",
  HOST: "127.0.0.1",
  DATABASE_URL: "postgresql://test@127.0.0.1:55490/demo_test_local",
  DEMO_ORIGIN: "http://localhost:3170",
  DEMO_API_ORIGIN: "http://127.0.0.1:4170",
};

test("local signing mock requires explicit local development and synthetic scope", () => {
  assert.equal(
    localSigningMockAllowed({ demoOnly: true, demoMode: true }, env),
    true,
  );
  for (const override of [
    { DEMO_LOCAL_SIGNATURE_MOCK: "0" },
    { NODE_ENV: "production" },
    { NODE_ENV: "" },
    { HOST: "0.0.0.0" },
    { DATABASE_URL: "postgresql://test@db.example.test/demo_test_local" },
    { DATABASE_URL: "postgresql://test@localhost/real_center" },
    { DEMO_ORIGIN: "https://example.test" },
    { DEMO_API_ORIGIN: "https://example.test" },
    { DEMO_API_ORIGIN: "" },
  ])
    assert.equal(
      localSigningMockEnabled({ ...env, ...override }),
      false,
      JSON.stringify(override),
    );
  assert.equal(
    localSigningMockAllowed({ demoOnly: false, demoMode: true }, env),
    false,
  );
  assert.equal(
    localSigningMockAllowed({ demoOnly: true, demoMode: false }, env),
    false,
  );
});

test("mock receipt explicitly denies certificate and cryptographic verification", () => {
  // A structural CMS-shaped fixture, intentionally not a cryptographic signature.
  const cms = Buffer.concat([
    Buffer.from("30818006092a864886f70d010702a0", "hex"),
    Buffer.alloc(116),
  ]);
  const receipt = localMockVerification(cms.toString("base64"), {
    documentSha256: "a".repeat(64),
    iin: "000000000001",
    bin: null,
  });
  assert.equal(receipt.valid, false);
  assert.equal(receipt.authority, "LOCAL_TEST_MOCK");
  assert.equal(receipt.chainValid, false);
  assert.equal(receipt.revocationStatus, "NOT_CHECKED");
  assert.equal(
    receipt.identitySource,
    "SYNTHETIC_ROLE_BINDING_NOT_CERTIFICATE",
  );
  assert.equal(receipt.certificateFingerprint, "NOT_VERIFIED_LOCAL_TEST");
  const ber = Buffer.concat([
    Buffer.from("3080", "hex"),
    cms.subarray(3),
    Buffer.from([0, 0]),
  ]);
  assert.equal(
    localMockVerification(ber.toString("base64"), {
      documentSha256: "a".repeat(64),
      iin: "000000000001",
      bin: null,
    }).authority,
    "LOCAL_TEST_MOCK",
  );
  assert.throws(
    () =>
      localMockVerification(Buffer.alloc(200).toString("base64"), {
        documentSha256: "a".repeat(64),
        iin: "000000000001",
        bin: null,
      }),
    /LOCAL_TEST_CMS_REQUIRED/,
  );
});
