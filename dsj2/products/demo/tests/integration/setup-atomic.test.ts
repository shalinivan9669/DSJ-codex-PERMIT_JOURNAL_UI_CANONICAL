import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { db } from "../../apps/api/src/core";
import { ArtifactStore } from "../../packages/printing/src";
import { provision } from "../../scripts/setup";
import { assertTestDatabase } from "./test-database";

test("provisioning is atomic on storage failure and converges on concurrent retries", async () => {
  assertTestDatabase();
  const suffix = randomUUID();
  const input = {
    email: `setup-${suffix}@example.test`,
    password: `Local-Setup-${suffix}`,
    name: `Синтетическая настройка ${suffix}`,
  };
  const put = ArtifactStore.prototype.put;
  let writes = 0;
  ArtifactStore.prototype.put = async function (...args) {
    if (++writes === 2) throw new Error("SYNTHETIC_STORAGE_FAILURE");
    return put.apply(this, args);
  };
  try {
    await assert.rejects(provision(input), /SYNTHETIC_STORAGE_FAILURE/);
  } finally {
    ArtifactStore.prototype.put = put;
  }
  assert.equal(await db.user.count({ where: { email: input.email } }), 0);
  assert.equal(await db.tenant.count({ where: { name: input.name } }), 0);

  const results = await Promise.all([provision(input), provision(input)]);
  assert.equal(results[0].tenantId, results[1].tenantId);
  assert.equal(results[0].userId, results[1].userId);
  const tenantId = results[0].tenantId;
  assert.equal(await db.tenant.count({ where: { name: input.name } }), 1);
  const templates = await db.templateVersion.findMany({ where: { tenantId } });
  assert.ok(templates.length >= 11);
  assert.ok(templates.every((template) => !template.approved));
  assert.equal(await db.printRequest.count({ where: { tenantId } }), 0);
  assert.equal(await db.issuerProfileVersion.count({ where: { tenantId } }), 0);
  const original = await db.user.findUniqueOrThrow({
    where: { id: results[0].userId },
  });
  writes = 0;
  ArtifactStore.prototype.put = async function (...args) {
    writes++;
    return put.apply(this, args);
  };
  try {
    await provision({ ...input, password: `Different-${suffix}` });
  } finally {
    ArtifactStore.prototype.put = put;
  }
  assert.equal(
    writes,
    0,
    "retry must reuse installed immutable template files",
  );
  assert.equal(
    (await db.user.findUniqueOrThrow({ where: { id: original.id } }))
      .passwordHash,
    original.passwordHash,
  );
  await assert.rejects(
    provision({ ...input, sample: true }),
    /EXISTING_PRODUCTION_TENANT_CANNOT_BECOME_DEMO/,
  );
  assert.equal(
    (await db.tenant.findUniqueOrThrow({ where: { id: tenantId } })).demoOnly,
    false,
  );
});

test.after(async () => {
  await db.$disconnect();
});
