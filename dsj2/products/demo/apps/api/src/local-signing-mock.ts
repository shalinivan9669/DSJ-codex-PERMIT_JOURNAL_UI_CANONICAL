import { createHash } from "node:crypto";
import { isIP } from "node:net";
import { readCmsSignerIdentity } from "./signature-display-metadata";

export const LOCAL_SIGNING_MOCK_PROVIDER = "NCALAYER_LOCAL_TEST";
export const HOSTED_SIGNING_MOCK_PROVIDER = "NCALAYER_HOSTED_TEST";
export const SIGNING_MOCK_PROVIDERS = [
  LOCAL_SIGNING_MOCK_PROVIDER,
  HOSTED_SIGNING_MOCK_PROVIDER,
];
export type SigningMockMode = "LOCAL_TEST_MOCK" | "HOSTED_TEST_MOCK";
type MockScope = { tenantId: string; demoOnly: boolean; demoMode: boolean };

function publicHttpsOrigin(value: string | undefined) {
  try {
    const url = new URL(value || "");
    const host = url.hostname.replace(/^\[|\]$/g, "");
    return (
      value === url.origin &&
      url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      url.pathname === "/" &&
      !url.search &&
      !url.hash &&
      !isIP(host) &&
      host.includes(".") &&
      /^[a-z0-9.-]+$/i.test(host) &&
      !/(^|\.)(localhost|local|internal|lan)\.?$/i.test(host)
    );
  } catch {
    return false;
  }
}

/** Separate, explicitly allowlisted hosted rehearsal. This does not relax any
 * local development guard and never grants test mode to ordinary tenants. */
export function hostedSigningMockEnabled(env: NodeJS.ProcessEnv = process.env) {
  return (
    env.DEMO_HOSTED_SIGNATURE_MOCK === "1" &&
    ["production", "test"].includes(env.NODE_ENV || "") &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      env.DEMO_HOSTED_SIGNATURE_MOCK_TENANT_ID || "",
    ) &&
    publicHttpsOrigin(env.DEMO_ORIGIN) &&
    publicHttpsOrigin(env.DEMO_API_ORIGIN)
  );
}
export function hostedSigningMockAllowed(
  scope: MockScope,
  env: NodeJS.ProcessEnv = process.env,
) {
  return (
    scope.demoOnly &&
    scope.demoMode &&
    scope.tenantId === env.DEMO_HOSTED_SIGNATURE_MOCK_TENANT_ID &&
    hostedSigningMockEnabled(env)
  );
}
export function signingMockMode(
  scope: MockScope,
  env: NodeJS.ProcessEnv = process.env,
): SigningMockMode | null {
  if (localSigningMockAllowed(scope, env)) return "LOCAL_TEST_MOCK";
  if (hostedSigningMockAllowed(scope, env)) return "HOSTED_TEST_MOCK";
  return null;
}
export function signingMockProvider(mode: SigningMockMode) {
  return mode === "LOCAL_TEST_MOCK"
    ? LOCAL_SIGNING_MOCK_PROVIDER
    : HOSTED_SIGNING_MOCK_PROVIDER;
}
export function signingMockModeForProvider(
  provider: string | null | undefined,
): SigningMockMode | null {
  return provider === LOCAL_SIGNING_MOCK_PROVIDER
    ? "LOCAL_TEST_MOCK"
    : provider === HOSTED_SIGNING_MOCK_PROVIDER
      ? "HOSTED_TEST_MOCK"
      : null;
}

/** Opt-in development rehearsal only. Never a substitute for NCA verification. */
export function localSigningMockEnabled(env: NodeJS.ProcessEnv = process.env) {
  if (
    env.DEMO_LOCAL_SIGNATURE_MOCK !== "1" ||
    !["development", "test"].includes(env.NODE_ENV || "") ||
    !["127.0.0.1", "localhost", "::1"].includes(env.HOST || "127.0.0.1")
  )
    return false;
  try {
    const database = new URL(env.DATABASE_URL || "");
    const origins = [env.DEMO_ORIGIN, env.DEMO_API_ORIGIN].map(
      (value) => new URL(value || ""),
    );
    return (
      ["postgres:", "postgresql:"].includes(database.protocol) &&
      ["127.0.0.1", "localhost", "[::1]"].includes(database.hostname) &&
      /^demo_test_[a-zA-Z0-9_-]+$/.test(database.pathname.slice(1)) &&
      origins.every(
        (url) =>
          ["http:", "https:"].includes(url.protocol) &&
          ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) &&
          !url.username &&
          !url.password,
      )
    );
  } catch {
    return false;
  }
}

export function localSigningMockAllowed(
  scope: { demoOnly: boolean; demoMode: boolean },
  env: NodeJS.ProcessEnv = process.env,
) {
  return scope.demoOnly && scope.demoMode && localSigningMockEnabled(env);
}

/** Accept a CMS envelope for a labelled mock rehearsal, without asserting trust,
 * identity, revocation, or cryptographic validity. Keep the actual CMS bytes. */
export function localMockVerification(
  signatureBase64: string,
  expected: { documentSha256: string; iin: string; bin: string | null },
) {
  return testMockVerification(signatureBase64, expected, "LOCAL_TEST_MOCK");
}
export function testMockVerification(
  signatureBase64: string,
  expected: { documentSha256: string; iin: string; bin: string | null },
  mode: SigningMockMode,
) {
  const cms = Buffer.from(signatureBase64, "base64");
  const signedDataOid = Buffer.from("06092a864886f70d010702", "hex");
  let offset = 2;
  let length = cms[1];
  const indefinite = length === 0x80;
  if (indefinite) {
    // CMS permits BER as well as DER; NCALayer's crypto library may use either.
    length = cms.length - offset;
    if (cms[cms.length - 1] !== 0 || cms[cms.length - 2] !== 0)
      throw new Error("LOCAL_TEST_CMS_REQUIRED");
  } else if (length & 0x80) {
    const count = length & 0x7f;
    if (!count || count > 4 || cms.length < count + 2)
      throw new Error("LOCAL_TEST_CMS_REQUIRED");
    length = 0;
    for (let index = 0; index < count; index++)
      length = length * 256 + cms[2 + index];
    offset += count;
  }
  if (
    cms.length < 100 ||
    cms[0] !== 0x30 ||
    offset + length !== cms.length ||
    !cms
      .subarray(offset, offset + signedDataOid.length)
      .equals(signedDataOid) ||
    cms[offset + signedDataOid.length] !== 0xa0
  )
    throw new Error("LOCAL_TEST_CMS_REQUIRED");
  return {
    valid: false,
    ...(mode === "LOCAL_TEST_MOCK"
      ? { acceptedForLocalTest: true }
      : { acceptedForHostedTest: true }),
    acceptedForTest: true,
    authority: mode,
    chainValid: false,
    revocationStatus: "NOT_CHECKED",
    purpose:
      mode === "LOCAL_TEST_MOCK"
        ? "LOCAL_WORKFLOW_REHEARSAL"
        : "HOSTED_WORKFLOW_REHEARSAL",
    contentSha256: expected.documentSha256,
    signatureSha256: createHash("sha256").update(cms).digest("hex"),
    signerIin: expected.iin,
    signerBin: expected.bin,
    identitySource: "SYNTHETIC_ROLE_BINDING_NOT_CERTIFICATE",
    certificateDisplayIdentity: readCmsSignerIdentity(cms),
    certificateSerial:
      mode === "LOCAL_TEST_MOCK"
        ? "NOT_VERIFIED_LOCAL_TEST"
        : "NOT_VERIFIED_HOSTED_TEST",
    certificateFingerprint:
      mode === "LOCAL_TEST_MOCK"
        ? "NOT_VERIFIED_LOCAL_TEST"
        : "NOT_VERIFIED_HOSTED_TEST",
    notice: `${mode === "LOCAL_TEST_MOCK" ? "Local" : "Hosted"} mock acceptance only; CMS cryptography, certificate identity, NCA trust and revocation were not verified.`,
  };
}
