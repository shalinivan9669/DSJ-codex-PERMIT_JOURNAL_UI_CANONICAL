import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { assertTestDatabase } from "./test-database";
import { db, type Context } from "../../apps/api/src/core";
import { provision } from "../../scripts/setup";
import { createRequest } from "../../apps/api/src/requests";
import { clarificationRequest } from "../../apps/api/src/delivery-approval";
import { draftSchema } from "../../packages/contracts/src";

test("mixed-company clarification requires a recipient scope and excludes every other company's source rows", async () => {
  assertTestDatabase();
  const who = await provision({
    email: `clarification-${randomUUID()}@example.test`,
    password: "Synthetic-clarification-test!",
    name: "Synthetic clarification",
    sample: true,
  });
  const context: Context = {
    ...who,
    role: "ADMIN",
    sessionId: "test",
    csrfHash: "test",
    correlationId: randomUUID(),
  };
  try {
    const a = await db.customerOrganization.create({
      data: { tenantId: who.tenantId, nameRu: "A", nameKz: "A" },
    });
    const b = await db.customerOrganization.create({
      data: { tenantId: who.tenantId, nameRu: "B", nameKz: "B" },
    });
    const request = await createRequest(
      context,
      draftSchema.parse({
        kind: "COMPANY",
        customerId: a.id,
        title: "Synthetic two companies",
        demoMode: true,
        items: [
          {
            id: "a",
            employerId: a.id,
            sourceRow: 7,
            personnelNumber: "000007",
            fullNameRu: "",
            fullNameKz: "",
          },
          {
            id: "b",
            employerId: b.id,
            sourceRow: 19,
            personnelNumber: "000019",
            fullNameRu: "",
            fullNameKz: "",
          },
        ],
      }),
    );
    const internal = await clarificationRequest(context, request.id);
    assert.equal(internal.readyToCopy, false);
    const outputA = await clarificationRequest(context, request.id, a.id);
    const outputB = await clarificationRequest(context, request.id, b.id);
    assert.equal(outputA.readyToCopy, true);
    assert.ok(outputA.items.length > 0);
    assert.ok(
      outputA.items.every(
        (item) => item.sourceRow === 7 && item.personnelNumber === "000007",
      ),
    );
    assert.ok(!outputA.text.includes("000019"));
    assert.ok(!outputB.text.includes("000007"));
    assert.ok(outputB.items.every((item) => item.sourceRow === 19));
    assert.equal(outputA.sent, false);
    await assert.rejects(
      clarificationRequest(context, request.id, randomUUID()),
      /Заказчик не найден/,
    );
    await assert.rejects(
      clarificationRequest(
        { ...context, tenantId: randomUUID() },
        request.id,
        a.id,
      ),
      /не найдена/,
    );
    assert.equal(
      await db.numberReservation.count({ where: { tenantId: who.tenantId } }),
      0,
    );
  } finally {
    await db.$disconnect();
  }
});
