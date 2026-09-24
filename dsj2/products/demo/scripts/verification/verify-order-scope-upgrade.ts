import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { db, type Context } from "../../apps/api/src/core";
import { serviceOrderDetail } from "../../apps/api/src/operator-value";
import { assertTestDatabase } from "../../tests/integration/test-database";

async function main() {
  assertTestDatabase();
  const before = JSON.parse(await readFile(process.argv[2], "utf8"));
  assert.equal(before.status, "DEFECT_CONFIRMED");
  assert.equal(
    new URL(process.env.DATABASE_URL!).pathname,
    `/${before.database}`,
  );
  const user = await db.user.findFirstOrThrow({
    where: { tenantId: before.tenantId, role: "ADMIN", active: true },
  });
  const c: Context = {
    tenantId: user.tenantId,
    userId: user.id,
    role: "ADMIN",
    sessionId: "upgrade-readback",
    csrfHash: "not-used",
    correlationId: "upgrade-readback",
  };
  const triple = await serviceOrderDetail(c, before.triple.orderId);
  const mixed = await serviceOrderDetail(
    c,
    before.mixedEmployerControl.orderId,
  );
  assert.equal(triple.customerId, before.parties.orderingCustomer);
  assert.equal(triple.payerId, before.parties.payer);
  assert.equal(triple.employerId, before.parties.employer);
  assert.equal(triple.summary.people, 1);
  assert.equal(triple.summary.events, 1);
  assert.equal(triple.requests[0].itemCount, 1);
  assert.equal(
    triple.nextActions.filter((item) => item.source === "RESULT_REVIEW").length,
    1,
  );
  assert.ok(
    triple.nextActions.some(
      (item) =>
        item.source === "DATA_REVIEW" &&
        item.label.includes("Synthetic person"),
    ),
  );
  assert.equal(mixed.employerId, null);
  assert.equal(mixed.summary.people, 1);
  assert.equal(mixed.summary.events, 1);
  const result = {
    status: "PASS",
    migration: "202609250013_order_employer_scope",
    database: before.database,
    tenantId: before.tenantId,
    originalProbe: process.argv[2],
    triple: {
      orderId: triple.id,
      customerId: triple.customerId,
      payerId: triple.payerId,
      employerId: triple.employerId,
      before: before.triple.observed.summary,
      after: triple.summary,
      unknownResultsVisible: 1,
      missingRowDataVisible: true,
    },
    mixed: {
      orderId: mixed.id,
      employerId: mixed.employerId,
      before: before.mixedEmployerControl.observed.summary,
      after: mixed.summary,
    },
    mutationByVerifier: false,
    note: "Readback of the exact pre-013 defect fixture after the actual deployed migration, not a recreated replacement. SQL backfill leaves mixed employer scope unchanged.",
  };
  await writeFile(process.argv[3], JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
}
void main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
