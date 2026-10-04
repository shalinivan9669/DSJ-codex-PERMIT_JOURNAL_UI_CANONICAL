import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { assertVerification } from "../apps/api/src/signing";

/** Genuine cryptographic drill. It never asserts NCA RK authority or writes a signature/workflow record. */
async function main() {
  const openssl =
    process.env.DEMO_OPENSSL || "C:/Program Files/Git/usr/bin/openssl.exe";
  const privateRoot = resolve(
    ".runtime/operator-flow-full-fix/cms-local-crypto",
  );
  const evidence = resolve(
    "docs/evidence/operator-flow-full-fix-20261003/domain/cms-local-crypto.json",
  );
  await mkdir(privateRoot, { recursive: true });
  const call = (args: string[], success = true) => {
    const result = spawnSync(openssl, args, {
      encoding: "utf8",
      windowsHide: true,
    });
    if (success) assert.equal(result.status, 0, result.stderr);
    else
      assert.notEqual(
        result.status,
        0,
        "Invalid content or an untrusted certificate must fail verification",
      );
    return result;
  };
  const key = join(privateRoot, "synthetic.key.pem"),
    cert = join(privateRoot, "synthetic.cert.pem"),
    otherKey = join(privateRoot, "other.key.pem"),
    otherCert = join(privateRoot, "other.cert.pem"),
    document = join(privateRoot, "synthetic-content.txt"),
    signature = join(privateRoot, "synthetic.p7s"),
    verified = join(privateRoot, "verified-content.txt"),
    tampered = join(privateRoot, "tampered-content.txt");
  const bytes = Buffer.from(
    "СИНТЕТИЧЕСКИЙ локальный CMS drill. Это не подпись НУЦ РК и не официальный документ.\n",
    "utf8",
  );
  await writeFile(document, bytes);
  await writeFile(
    tampered,
    Buffer.from("СИНТЕТИЧЕСКОЕ изменённое содержимое\n", "utf8"),
  );
  call([
    "req",
    "-x509",
    "-newkey",
    "rsa:2048",
    "-nodes",
    "-days",
    "1",
    "-subj",
    "/CN=SYNTHETIC LOCAL CRYPTO ONLY",
    "-keyout",
    key,
    "-out",
    cert,
  ]);
  call([
    "req",
    "-x509",
    "-newkey",
    "rsa:2048",
    "-nodes",
    "-days",
    "1",
    "-subj",
    "/CN=OTHER SYNTHETIC LOCAL ROOT",
    "-keyout",
    otherKey,
    "-out",
    otherCert,
  ]);
  call([
    "cms",
    "-sign",
    "-binary",
    "-in",
    document,
    "-signer",
    cert,
    "-inkey",
    key,
    "-outform",
    "DER",
    "-out",
    signature,
  ]);
  call([
    "cms",
    "-verify",
    "-binary",
    "-inform",
    "DER",
    "-in",
    signature,
    "-content",
    document,
    "-CAfile",
    cert,
    "-purpose",
    "any",
    "-out",
    verified,
  ]);
  assert.deepEqual(await readFile(verified), bytes);
  call(
    [
      "cms",
      "-verify",
      "-binary",
      "-inform",
      "DER",
      "-in",
      signature,
      "-content",
      tampered,
      "-CAfile",
      cert,
      "-purpose",
      "any",
      "-out",
      join(privateRoot, "rejected-tamper.txt"),
    ],
    false,
  );
  call(
    [
      "cms",
      "-verify",
      "-binary",
      "-inform",
      "DER",
      "-in",
      signature,
      "-content",
      document,
      "-CAfile",
      otherCert,
      "-purpose",
      "any",
      "-out",
      join(privateRoot, "rejected-chain.txt"),
    ],
    false,
  );
  const contentSha256 = createHash("sha256").update(bytes).digest("hex");
  let rejection: string | undefined;
  try {
    assertVerification(
      {
        valid: true,
        authority: "SYNTHETIC_LOCAL_CA",
        chainValid: true,
        revocationStatus: "GOOD",
        revocationCheckedAt: new Date().toISOString(),
        purpose: "SIGNATURE",
        contentSha256,
        signerIin: "000000000001",
        certificateSerial: "SYNTHETIC",
        certificateFingerprint: "0".repeat(64),
        notBefore: new Date(Date.now() - 1000).toISOString(),
        notAfter: new Date(Date.now() + 86400000).toISOString(),
      },
      { documentSha256: contentSha256, iin: "000000000001", bin: null },
    );
  } catch (error) {
    rejection = (error as { getResponse(): { code: string } }).getResponse()
      .code;
  }
  assert.equal(rejection, "SIGNATURE_INVALID");
  const report = {
    capturedAt: new Date().toISOString(),
    openssl: call(["version"]).stdout.trim(),
    authority: "SYNTHETIC_LOCAL_CA",
    legalApproval: false,
    ncaRkAuthorityVerified: false,
    validDetachedCms: true,
    verifiedExactBytes: true,
    tamperedContentRejected: true,
    untrustedRootRejected: true,
    productRejection: rejection,
    contentSha256,
    signatureSha256: createHash("sha256")
      .update(await readFile(signature))
      .digest("hex"),
    workflowRecordsWritten: 0,
    systemTrustStoreChanged: false,
    limitation:
      "A local synthetic certificate cannot satisfy the product's strict NCA_RK authority and current revocation requirements. Genuine NCA RK certificates plus the configured verifier/connector are required for official ISSUED state and bundle downloads.",
  };
  await mkdir(resolve(evidence, ".."), { recursive: true });
  await writeFile(evidence, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
}
void main();
