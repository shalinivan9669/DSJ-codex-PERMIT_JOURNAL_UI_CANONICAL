import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { db, type Context } from "../../apps/api/src/core";
import { provision } from "../../scripts/setup";
import { saveUser } from "../../apps/api/src/settings";
import {
  createRequest,
  patchRequest,
  requestDetail,
} from "../../apps/api/src/requests";
import {
  createServiceOrder,
  serviceOrderDetail,
  createEmployerMembership,
  employerPortal,
} from "../../apps/api/src/operator-value";
import { draftSchema } from "../../packages/contracts/src";
import { assertTestDatabase } from "./test-database";

test("manager links a pending company request to its actual employer while private order details preserve approval and portal isolation", async (t) => {
  assertTestDatabase();
  t.after(() => db.$disconnect());
  const suffix = randomUUID();
  const who = await provision({
    email: `pending-order-${suffix}@example.test`,
    password: "Synthetic-pending-order!",
    name: "Синтетический центр заказа",
    sample: true,
  });
  const director: Context = {
    ...who,
    role: "DIRECTOR",
    csrfHash: "test",
    sessionId: "test",
    correlationId: suffix,
  };
  const managerUser = await saveUser(director, {
    email: `pending-manager-${suffix}@example.test`,
    displayName: "Синтетический менеджер",
    role: "OPERATOR",
    password: "Synthetic-pending-order!",
  });
  const manager: Context = {
    ...director,
    userId: managerUser.id,
    role: "OPERATOR",
  };
  const [customer, employer, otherEmployer] = await Promise.all(
    ["Заказчик", "Работодатель", "Другой работодатель"].map((nameRu) =>
      db.customerOrganization.create({
        data: { tenantId: who.tenantId, nameRu },
      }),
    ),
  );
  const eventId = randomUUID();
  const row = {
    id: randomUUID(),
    employerId: employer.id,
    fullNameRu: `UNAPPROVED_PERSON_${suffix}`,
    assignments: [
      {
        id: randomUUID(),
        templateId: "pb-card",
        eventId,
        protocolMode: "GROUP",
        outcome: { status: "UNKNOWN", source: "" },
      },
    ],
  };
  const draft = draftSchema.parse({
    kind: "COMPANY",
    customerId: customer.id,
    title: "Синтетический рабочий заказ",
    schemaVersion: 2,
    events: [
      {
        id: eventId,
        title: "Синтетическое мероприятие",
        protocolTemplateId: "pb-protocol",
        commonFields: {},
      },
    ],
    items: [row],
  });
  const request = await createRequest(manager, draft);
  const order = await createServiceOrder(manager, {
    title: draft.title,
    customerId: customer.id,
    requestIds: [request.id],
  });
  assert.equal(order.employerId, employer.id);
  let detail = await serviceOrderDetail(manager, order.id);
  assert.equal(detail.summary.people, 1);
  assert.equal(detail.summary.events, 1);
  assert.equal(detail.requests[0].itemCount, 1);
  assert.equal(detail.requests[0].revision, request.revision);
  assert.equal(detail.requests[0].title, draft.title);
  assert.deepEqual(
    detail.events.map((event) => event.id),
    [eventId],
  );
  assert.ok(
    detail.nextActions.some(
      (action) =>
        action.source === "RESULT_REVIEW" &&
        action.label.includes(row.fullNameRu),
    ),
  );
  const changed = await patchRequest(manager, request.id, {
    expectedRevision: request.revision,
    draft: {
      ...draft,
      items: [
        { ...row, positionRu: "Синтетическая новая должность" },
        {
          id: randomUUID(),
          employerId: otherEmployer.id,
          fullNameRu: "Другой синтетический участник",
          assignments: [],
        },
      ],
    },
  });
  detail = await serviceOrderDetail(director, order.id);
  assert.equal(detail.employerId, employer.id);
  assert.equal(detail.summary.people, 1);
  assert.equal(detail.requests[0].revision, changed.revision);
  const approvedRecord = await db.printRequest.findUniqueOrThrow({
    where: { id: request.id },
  });
  assert.equal(approvedRecord.revision, changed.revision);
  assert.equal(draftSchema.parse(approvedRecord.draft).items.length, 2);
  assert.equal(approvedRecord.approvedProposalId, null);
  assert.equal((await requestDetail(manager, request.id)).approvedRevision, 0);
  assert.equal(
    await db.proposalDecision.count({ where: { tenantId: who.tenantId } }),
    0,
  );

  const externalUser = await db.user.create({
    data: {
      tenantId: who.tenantId,
      email: `pending-employer-${suffix}@example.test`,
      displayName: "Синтетический заказчик",
      role: "EMPLOYER",
      passwordHash: "unused-fixture",
    },
  });
  await createEmployerMembership(director, {
    customerId: employer.id,
    userId: externalUser.id,
    permissions: ["READ"],
  });
  const portal = await employerPortal({
    ...director,
    userId: externalUser.id,
    role: "EMPLOYER",
  });
  assert.equal(JSON.stringify(portal).includes(row.fullNameRu), false);
  assert.equal(
    JSON.stringify(portal).includes("Синтетическая новая должность"),
    false,
  );
  await assert.rejects(
    serviceOrderDetail({ ...director, tenantId: randomUUID() }, order.id),
    (error: unknown) =>
      (error as { getResponse(): { code: string } }).getResponse().code ===
      "NOT_FOUND",
  );
});
