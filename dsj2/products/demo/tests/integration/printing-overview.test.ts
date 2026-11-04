import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { db, type Context } from "../../apps/api/src/core";
import { printingOverview } from "../../apps/api/src/printing-overview";
import { assertTestDatabase } from "./test-database";

test("printing overview counts all authorized center requests and keeps foreign data out", async () => {
  assertTestDatabase();
  const tenant = await db.tenant.create({
    data: { name: "Синтетическая сводка" },
  });
  const foreign = await db.tenant.create({
    data: { name: "Другой центр сводки" },
  });
  const user = await db.user.create({
    data: {
      tenantId: tenant.id,
      email: `${randomUUID()}@example.test`,
      displayName: "Оператор",
      role: "OPERATOR",
      passwordHash: "SYNTHETIC",
    },
  });
  const c: Context = {
    tenantId: tenant.id,
    userId: user.id,
    role: "OPERATOR",
    sessionId: "test",
    csrfHash: "test",
    correlationId: randomUUID(),
  };
  assert.deepEqual(await printingOverview(c), {
    requests: 0,
    active: 0,
    archived: 0,
    documents: 0,
  });
  await db.printRequest.createMany({
    data: [
      { tenantId: tenant.id, kind: "PERSON", draft: {}, createdBy: user.id },
      {
        tenantId: tenant.id,
        kind: "PERSON",
        status: "CANCELLED",
        draft: {},
        createdBy: user.id,
      },
      {
        tenantId: tenant.id,
        kind: "PERSON",
        status: "FINALIZED",
        archivedAt: new Date(),
        draft: {},
        createdBy: user.id,
      },
      { tenantId: foreign.id, kind: "PERSON", draft: {}, createdBy: user.id },
    ],
  });
  assert.deepEqual(await printingOverview(c), {
    requests: 3,
    active: 1,
    archived: 1,
    documents: 0,
  });
  await assert.rejects(
    printingOverview({ ...c, role: "LEARNER" }),
    (error: unknown) => (error as { getStatus(): number }).getStatus() === 403,
  );
});
test.after(async () => {
  await db.$disconnect();
});
