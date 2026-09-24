import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { db, type Context } from "../../apps/api/src/core";
import { createRequest, patchRequest } from "../../apps/api/src/requests";
import { draftSchema } from "../../packages/contracts/src";
import * as value from "../../apps/api/src/operator-value";
import { assertTestDatabase } from "./test-database";

test("order progress uses scoped factual results and counts people/events instead of output forms", async (t) => {
  assertTestDatabase();
  t.after(() => db.$disconnect());
  const tenant = await db.tenant.create({
    data: { name: "Progress synthetic center" },
  });
  const user = await db.user.create({
    data: {
      tenantId: tenant.id,
      email: `${randomUUID()}@example.test`,
      displayName: "Operator",
      role: "OPERATOR",
      passwordHash: "unused",
    },
  });
  const c: Context = {
    tenantId: tenant.id,
    userId: user.id,
    role: user.role,
    sessionId: "test",
    csrfHash: "test",
    correlationId: randomUUID(),
  };
  const [customer, other] = await Promise.all(
    ["Own customer", "Other customer"].map((nameRu) =>
      db.customerOrganization.create({ data: { tenantId: tenant.id, nameRu } }),
    ),
  );
  const people = await Promise.all(
    Array.from({ length: 9 }, (_, i) =>
      db.recipient.create({
        data: { tenantId: tenant.id, data: { fullNameRu: `Person ${i + 1}` } },
      }),
    ),
  );
  const eventIds = [randomUUID(), randomUUID(), randomUUID()];
  const draft = draftSchema.parse({
    schemaVersion: 2,
    kind: "COMPANY",
    title: "Eight people and two events",
    customerId: customer.id,
    events: eventIds.map((id, i) => ({
      id,
      title: i === 2 ? "FOREIGN EVENT" : `Event ${i + 1}`,
      protocolTemplateId: "pb-protocol",
      commonFields: { trainingSubject: "Synthetic program" },
    })),
    items: people.map((person, i) => ({
      id: randomUUID(),
      recipientId: person.id,
      employerId: i === 8 ? other.id : customer.id,
      fullNameRu: i === 8 ? "FOREIGN PERSON" : `Person ${i + 1}`,
      assignments: [
        {
          id: randomUUID(),
          templateId: "pb-card",
          protocolMode: "GROUP",
          eventId: eventIds[i === 8 ? 2 : i < 4 ? 0 : 1],
          result: i >= 7 ? "" : "Сдал",
          outcome: {
            status: i >= 7 ? "UNKNOWN" : "PASSED",
            source: i >= 7 ? "" : "Synthetic signed result",
          },
        },
      ],
    })),
  });
  // Two output forms for the same person/event remain one service.
  draft.items[0].assignments.push({
    ...draft.items[0].assignments[0],
    id: randomUUID(),
    templateId: "pb-protocol",
  });
  const request = await createRequest(c, draft);
  const order = await value.createServiceOrder(c, {
    title: "Scoped order",
    customerId: customer.id,
    requestIds: [request.id],
    ownerId: user.id,
  });
  const material = await value.createOrderMilestone(c, order.id, {
    category: "TRANSFER",
    label: "Agreed materials not transferred",
    source: "CONTRACT",
    sourceReference: "Synthetic agreed scope",
  });
  let detail = await value.serviceOrderDetail(c, order.id);
  assert.deepEqual(detail.summary, {
    people: 8,
    events: 2,
    personEventServices: 8,
    legacyAssignments: 0,
  });
  assert.equal(detail.completion.training, false);
  assert.equal(detail.completion.documents, false);
  assert.equal(detail.completion.transfer, false);
  const results = detail.nextActions.filter(
    (a) => a.source === "RESULT_REVIEW",
  );
  assert.equal(results.length, 1);
  assert.match(results[0].label, /Person 8 — Event 2/);
  const dataIssues = detail.nextActions.filter(
    (action) =>
      action.source === "DATA_REVIEW" &&
      action.label.includes("Дата оформления"),
  );
  assert.equal(
    dataIssues.length,
    8,
    "One missing event date per person, not per output form",
  );
  assert.ok(
    dataIssues.some((action) => action.label.includes("Person 1 (Event 1)")),
  );
  assert.ok(dataIssues.every((action) => !action.label.includes("FOREIGN")));
  assert.equal(JSON.stringify(detail).includes("FOREIGN PERSON"), false);
  assert.equal(JSON.stringify(detail).includes("FOREIGN EVENT"), false);
  await value.patchOrderMilestone(c, order.id, material.id, {
    status: "DONE",
    evidence: "Synthetic receiver confirmation",
  });
  detail = await value.serviceOrderDetail(c, order.id);
  assert.equal(detail.completion.transfer, true);
  assert.equal(
    detail.completion.training,
    false,
    "Delivery never supplies an unknown result",
  );
  draft.items[7].assignments[0].outcome = {
    status: "PASSED",
    source: "Actual synthetic result from signed sheet",
  };
  draft.items[7].assignments[0].result = "Сдал";
  await patchRequest(c, request.id, { expectedRevision: 0, draft });
  detail = await value.serviceOrderDetail(c, order.id);
  assert.equal(detail.completion.training, true);
  assert.equal(detail.completion.documents, false);
  assert.equal(
    detail.nextActions.some((a) => a.source === "RESULT_REVIEW"),
    false,
  );
  assert.deepEqual(detail.summary, {
    people: 8,
    events: 2,
    personEventServices: 8,
    legacyAssignments: 0,
  });
  draft.events![0].commonFields.documentDate = "2026-09-24";
  await patchRequest(c, request.id, { expectedRevision: 1, draft });
  const inheritedDate = await value.serviceOrderDetail(c, order.id);
  assert.equal(
    inheritedDate.nextActions.filter(
      (action) =>
        action.source === "DATA_REVIEW" &&
        action.label.includes("Дата оформления"),
    ).length,
    4,
    "Event inheritance uses the canonical resolver; the first four people need no duplicated date input",
  );

  await t.test(
    "identical names without linked recipients remain distinct and legacy assignments are explicit",
    async () => {
      const legacy = await createRequest(
        c,
        draftSchema.parse({
          kind: "COMPANY",
          customerId: customer.id,
          items: [1, 2].map((i) => ({
            id: `row-${i}`,
            fullNameRu: "Same name",
            assignments: [
              {
                id: `assignment-${i}`,
                templateId: "pb-card",
                result: "Historical result",
              },
            ],
          })),
        }),
      );
      const legacyOrder = await value.createServiceOrder(c, {
        title: "Legacy identities",
        customerId: customer.id,
        requestIds: [legacy.id],
      });
      const result = await value.serviceOrderDetail(c, legacyOrder.id);
      assert.deepEqual(result.summary, {
        people: 2,
        events: 0,
        personEventServices: 0,
        legacyAssignments: 2,
      });
      assert.equal(result.completion.training, true);
    },
  );
});
