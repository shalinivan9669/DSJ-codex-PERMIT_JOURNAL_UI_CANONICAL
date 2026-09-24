import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { db } from "../../apps/api/src/core";
import { passwordHash } from "../../apps/api/src/auth";
import { ArtifactStore } from "../../packages/printing/src";

// This drill must preserve and restore the exact completed three-person UI case.
// Its dedicated principal is additive; existing accounts are never reset.
async function main() {
  assert.equal(
    new URL(process.env.DATABASE_URL!).pathname,
    "/demo_test_operator_browser",
  );
  const source = resolve(
    "docs/evidence/final-completion/delivery-three-v3/result.json",
  );
  const result = JSON.parse(await readFile(source, "utf8"));
  assert.equal(result.status, "PASS");
  assert.equal(result.requestId, "4bc699b5-cfaf-42a6-8e3c-d7465bfc8ebf");
  const tenantId = "331b1727-9f4c-45f8-990a-0d982e826d07";
  const tenant = await db.tenant.findUniqueOrThrow({ where: { id: tenantId } });
  assert.equal(tenant.demoOnly, true);
  const request = await db.printRequest.findFirstOrThrow({
    where: { tenantId, id: result.requestId },
  });
  assert.equal(request.status, "FINALIZED");
  const artifacts = await db.artifact.findMany({
    where: { tenantId, requestId: request.id },
  });
  assert.equal(artifacts.length, 8);
  assert.equal(result.originalFileHashes.length, 6);
  for (const expected of result.dossier.detail.artifacts) {
    const current = artifacts.find((a) => a.id === expected.id);
    assert.ok(current);
    assert.equal(current.sha256, expected.sha256);
    assert.equal(current.provenance, "ORIGINAL");
  }
  for (const expected of result.originalFileHashes)
    assert.equal(
      artifacts.find((a) => a.id === expected.id)?.sha256,
      expected.sha256,
    );
  const attachments = await db.valueAttachment.findMany({
    where: { tenantId, orderId: result.orderId },
  });
  assert.equal(attachments.length, 1);
  assert.equal(attachments[0].id, result.dossier.detail.attachments[0].id);
  assert.equal(
    attachments[0].sha256,
    result.dossier.detail.attachments[0].sha256,
  );
  assert.equal(attachments[0].category, "SOURCE");
  const photos = await db.photoAsset.findMany({ where: { tenantId } });
  assert.equal(photos.length, 1);
  const store = new ArtifactStore();
  for (const record of [...artifacts, ...attachments, ...photos])
    assert.equal(
      (await store.read(record.storageKey, record.sha256)).length,
      record.size,
    );
  assert.equal(result.dossier.detail.missing.length, 1);
  assert.equal(result.dossier.manifest.complete, false);
  assert.deepEqual(result.sourceOrder, ["000003", "000001", "000002"]);

  const authPath = resolve(".runtime/final-v12-restore-auth.json");
  let auth: {
    tenantId: string;
    userId: string;
    email: string;
    password: string;
  };
  const prior = await readFile(authPath, "utf8").catch(
    (error: NodeJS.ErrnoException) => {
      if (error.code !== "ENOENT") throw error;
      return null;
    },
  );
  if (prior) {
    auth = JSON.parse(prior);
    assert.equal(auth.tenantId, tenantId);
    const user = await db.user.findFirstOrThrow({
      where: { id: auth.userId, tenantId },
    });
    assert.equal(user.email, auth.email);
    assert.equal(user.role, "ADMIN");
  } else {
    const email = `final-v12-restore-${randomUUID()}@example.test`;
    const password = `Synthetic-${randomUUID()}!`;
    const user = await db.user.create({
      data: {
        tenantId,
        email,
        displayName: "Синтетическая проверка восстановления V12",
        role: "ADMIN",
        passwordHash: await passwordHash(password),
      },
    });
    auth = { tenantId, userId: user.id, email, password };
    await mkdir(resolve(".runtime"), { recursive: true });
    await writeFile(authPath, JSON.stringify(auth, null, 2), { flag: "wx" });
  }
  const fixture = {
    tenantId,
    requestId: request.id,
    orderId: result.orderId,
    sourceEvidence:
      "docs/evidence/final-completion/delivery-three-v3/result.json",
    artifacts: artifacts.map((a) => ({
      id: a.id,
      sha256: a.sha256,
      size: a.size,
      kind: a.format,
    })),
    photoIds: photos.map((p) => ({ id: p.id, sha256: p.sha256 })),
    attachments: attachments.map((a) => ({
      id: a.id,
      sha256: a.sha256,
      size: a.size,
    })),
    dossier: result.dossier,
    people: 3,
    sourceOrder: result.sourceOrder,
  };
  await writeFile(
    resolve(".runtime/final-v12-restore-fixture.json"),
    JSON.stringify(fixture, null, 2),
  );
  console.log(
    JSON.stringify({
      status: "PASS",
      action: "PREPARED_ONLY",
      tenantId,
      requestId: request.id,
      artifacts: artifacts.length,
      attachments: attachments.length,
      photos: photos.length,
      dedicatedAdminId: auth.userId,
      originalSixHashesMatch: true,
      missingSignedEvidence: 1,
      backupStarted: false,
      processesStopped: false,
    }),
  );
}
void main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
