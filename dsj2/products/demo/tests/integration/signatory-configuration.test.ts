import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { db, type Context } from "../../apps/api/src/core";
import {
  prepareSigningPolicy,
  saveSignatory,
} from "../../apps/api/src/signing";
import { provision } from "../../scripts/setup";
import { assertTestDatabase } from "./test-database";

const errorCode = (expected: string) => (error: unknown) => {
  assert.equal(
    (error as { getResponse(): { code: string } }).getResponse().code,
    expected,
  );
  return true;
};

test("signatory configuration retries preserve identities and exact withdrawal remains safe after replacement, demotion or disabling", async (t) => {
  assertTestDatabase();
  const center = await provision({
    email: `signatory-config-${randomUUID()}@example.test`,
    password: "Synthetic-signatory-config-password!",
    name: "Синтетический центр настроек подписантов",
    sample: false,
  });
  const c: Context = {
    ...center,
    role: "DIRECTOR",
    sessionId: "test",
    csrfHash: "test",
    correlationId: randomUUID(),
  };
  t.after(() => db.$disconnect());
  const target = await db.user.create({
    data: {
      tenantId: c.tenantId,
      email: `signatory-target-${randomUUID()}@example.test`,
      displayName: "Синтетический подписант",
      role: "DIRECTOR",
      passwordHash: "SYNTHETIC_UNUSED_PASSWORD_HASH",
    },
  });
  const input = {
    userId: target.id,
    displayName: target.displayName,
    role: "DIRECTOR",
    iin: "000000000099",
    active: true,
  };
  const concurrent = await Promise.all(
    Array.from({ length: 4 }, () => saveSignatory(c, input)),
  );
  const original = concurrent[0];
  assert.ok(concurrent.every((entry) => entry.id === original.id));
  const bindingCount = () =>
    db.signatoryBinding.count({ where: { tenantId: c.tenantId } });
  const auditCount = () =>
    db.auditEvent.count({
      where: { tenantId: c.tenantId, action: "SIGNATORY_CONFIGURED" },
    });
  assert.equal(await bindingCount(), 1);
  assert.equal(await auditCount(), 1);
  const frozen = await prepareSigningPolicy(db, c, {
    headName: target.displayName,
  });
  assert.equal(frozen.head?.bindingId, original.id);
  assert.equal((await saveSignatory(c, input)).id, original.id);
  assert.equal(
    (
      await db.signatoryBinding.findUniqueOrThrow({
        where: { id: original.id },
      })
    ).active,
    true,
  );
  assert.equal(
    await auditCount(),
    1,
    "lost-response retry does not revoke a frozen issuance identity",
  );

  const replacementInput = { ...input, iin: "000000000098" };
  const replacement = await saveSignatory(c, replacementInput);
  assert.notEqual(replacement.id, original.id);
  assert.equal(await bindingCount(), 2);
  assert.equal(await auditCount(), 2);
  assert.equal(
    (
      await db.signatoryBinding.findUniqueOrThrow({
        where: { id: original.id },
      })
    ).active,
    false,
  );
  const staleRevoke = await saveSignatory(c, {
    ...input,
    bindingId: original.id,
    active: false,
  });
  assert.equal(staleRevoke.id, original.id);
  assert.equal(staleRevoke.active, false);
  assert.equal(
    (
      await db.signatoryBinding.findUniqueOrThrow({
        where: { id: replacement.id },
      })
    ).active,
    true,
  );
  assert.equal(
    await auditCount(),
    2,
    "withdrawing an already superseded version does not touch its replacement",
  );
  await assert.rejects(
    saveSignatory(c, { ...input, bindingId: replacement.id, active: false }),
    errorCode("SIGNATORY_TARGET_CHANGED"),
  );
  await assert.rejects(
    saveSignatory(c, { ...input, active: false }),
    errorCode("SIGNATORY_BINDING_REQUIRED"),
  );
  await assert.rejects(
    saveSignatory(
      { ...c, tenantId: randomUUID() },
      { ...replacementInput, bindingId: replacement.id, active: false },
    ),
    errorCode("NOT_FOUND"),
  );
  await assert.rejects(
    saveSignatory(
      { ...c, role: "OPERATOR" },
      { ...replacementInput, bindingId: replacement.id, active: false },
    ),
    errorCode("ROLE_DENIED"),
  );

  await db.user.update({
    where: { id: target.id },
    data: { role: "OPERATOR" },
  });
  await assert.rejects(
    saveSignatory(c, replacementInput),
    errorCode("SIGNATORY_ROLE"),
  );
  const withdrawn = await saveSignatory(c, {
    ...replacementInput,
    bindingId: replacement.id,
    active: false,
  });
  assert.equal(withdrawn.id, replacement.id);
  assert.equal(withdrawn.active, false);
  assert.equal(await auditCount(), 3);
  assert.equal(
    (
      await saveSignatory(c, {
        ...replacementInput,
        bindingId: replacement.id,
        active: false,
      })
    ).id,
    replacement.id,
  );
  assert.equal(await auditCount(), 3);
  assert.equal(
    await bindingCount(),
    2,
    "revocation never manufactures another binding",
  );

  const chairInput = { ...input, role: "CHAIR" };
  const chair = await saveSignatory(c, chairInput);
  await db.user.update({ where: { id: target.id }, data: { active: false } });
  await assert.rejects(
    saveSignatory(c, chairInput),
    errorCode("SIGNATORY_ROLE"),
  );
  assert.equal(
    (
      await saveSignatory(c, {
        ...chairInput,
        bindingId: chair.id,
        active: false,
      })
    ).id,
    chair.id,
  );
  assert.equal(
    (await db.signatoryBinding.findUniqueOrThrow({ where: { id: chair.id } }))
      .active,
    false,
  );
  assert.equal(
    await db.signatoryBinding.count({
      where: { tenantId: c.tenantId, active: true },
    }),
    0,
  );
  assert.equal(await bindingCount(), 3);
  assert.equal(await auditCount(), 5);
});
