import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { assertTestDatabase } from "./test-database";
import { db, type Context } from "../../apps/api/src/core";
import { provision } from "../../scripts/setup";
import { saveCustomer } from "../../apps/api/src/settings";

test("company continuation retries and concurrent HTTP-equivalent commands create exactly one directory card", async () => {
  assertTestDatabase();
  const seeded = await provision({
    email: `company-retry-${randomUUID()}@example.test`,
    password: "Synthetic-Test-Password!",
    name: "Синтетический центр компаний",
    sample: true,
  });
  const context: Context = {
    ...seeded,
    role: "ADMIN",
    sessionId: "test",
    csrfHash: "test",
    correlationId: randomUUID(),
  };
  const key = randomUUID();
  const input = {
    legalForm: "TOO",
    ownNameRu: "«Без дубля»",
    ownNameKz: "«Қайталанбайды»",
  };
  const before = await db.customerOrganization.count({
    where: { tenantId: context.tenantId },
  });
  const results = await Promise.all([
    saveCustomer(context, input, undefined, key),
    saveCustomer(context, input, undefined, key),
  ]);
  assert.equal(results[0].id, results[1].id);
  const replay = await saveCustomer(context, input, undefined, key);
  assert.equal(replay.id, results[0].id);
  assert.equal(
    await db.customerOrganization.count({
      where: { tenantId: context.tenantId },
    }),
    before + 1,
  );
  assert.equal(replay.nameRu, "ТОО «Без дубля»");
  assert.equal(replay.nameKz, "«Қайталанбайды» ЖШС");
  await assert.rejects(
    saveCustomer(context, { ...input, ownNameRu: "Иное" }, undefined, key),
    (error: unknown) =>
      !!error &&
      typeof error === "object" &&
      "getStatus" in error &&
      (error as { getStatus(): number }).getStatus() === 409,
  );
  const otherSeeded = await provision({
    email: `company-tenant-${randomUUID()}@example.test`,
    password: "Synthetic-Test-Password!",
    name: "Другой синтетический центр",
    sample: true,
  });
  const otherContext: Context = { ...context, ...otherSeeded };
  const other = await saveCustomer(otherContext, input, undefined, key);
  assert.notEqual(other.id, replay.id);
  assert.equal(
    await db.idempotencyOperation.count({
      where: {
        tenantId: context.tenantId,
        command: "CREATE_CUSTOMER",
        idempotencyKey: key,
      },
    }),
    1,
  );
});
