import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { db, type Context } from "../../apps/api/src/core";
import { createRequest, patchRequest } from "../../apps/api/src/requests";
import * as value from "../../apps/api/src/operator-value";
import { portalEvidence } from "../../apps/api/src/portal-evidence";
import { tenantExportSnapshot } from "../../apps/api/src/tenant-export";
import { draftSchema } from "../../packages/contracts/src";
import { provision } from "../../scripts/setup";
import { assertTestDatabase } from "./test-database";

const code = (expected: string) => (error: unknown) => {
  assert.equal(
    (error as { getResponse(): { code: string } }).getResponse().code,
    expected,
  );
  return true;
};

test("distinct contractual customer, payer and persisted participant employer preserve scopes and history", async (t) => {
  assertTestDatabase();
  t.after(() => db.$disconnect());
  const who = await provision({
    email: `parties-${randomUUID()}@example.test`,
    password: `Synthetic-${randomUUID()}!`,
    name: "Three-party scope regression",
    sample: true,
  });
  const c: Context = {
    ...who,
    role: "ADMIN",
    sessionId: "test",
    csrfHash: "test",
    correlationId: randomUUID(),
  };
  const [a, b, employer, other] = await Promise.all(
    ["Contract customer A", "Payer B", "Employer C", "Employer D"].map(
      (nameRu) =>
        db.customerOrganization.create({
          data: { tenantId: c.tenantId, nameRu },
        }),
    ),
  );
  const foreignTenant = await db.tenant.create({
    data: { name: "Other isolated tenant", demoOnly: true },
  });
  const foreign = await db.customerOrganization.create({
    data: {
      tenantId: foreignTenant.id,
      nameRu: "Foreign private organization",
    },
  });
  const rule = async (suffix: string) =>
    value.createServiceRule(c, {
      serviceKey: `scope-${suffix}`,
      title: `Scope rule ${suffix}`,
      status: "APPROVED",
      source: "Synthetic agreed source",
      applicability: "Synthetic regression",
      checkedOn: "2026-09-25",
      definition: {
        programVersion: "1",
        category: "PB",
        compatibleTemplateIds: ["pb-card", "pb-protocol"],
        requirements: [
          {
            key: `evidence-${suffix}`,
            label: `Agreed evidence ${suffix}`,
            source: "CONTRACT",
            stage: "EVIDENCE",
          },
        ],
      },
    });
  const [ruleA, ruleC] = await Promise.all([rule("A"), rule("C")]);
  const person = async (
    organization: string,
    suffix: string,
    ruleId?: string,
  ) => {
    const recipient = await db.recipient.create({
      data: { tenantId: c.tenantId, data: { fullNameRu: `Person ${suffix}` } },
    });
    const eventId = randomUUID();
    return {
      event: {
        id: eventId,
        title: `Event ${suffix}`,
        protocolTemplateId: "pb-protocol",
        ...(ruleId ? { serviceRuleVersionId: ruleId } : {}),
        commonFields: { trainingSubject: `Training ${suffix}` },
      },
      row: {
        id: randomUUID(),
        recipientId: recipient.id,
        employerId: organization,
        fullNameRu: `Person ${suffix}`,
        assignments: [
          {
            id: randomUUID(),
            templateId: "pb-card",
            protocolMode: "GROUP",
            eventId,
            result: "",
            outcome: { status: "UNKNOWN", source: "" },
          },
        ],
      },
    };
  };
  const personC = await person(employer.id, "C", ruleC.id);
  let draft = draftSchema.parse({
    kind: "COMPANY",
    schemaVersion: 2,
    customerId: a.id,
    title: "A orders, B pays, C employs",
    demoMode: true,
    // An explicitly cleared date remains missing; omitted dates now correctly
    // receive the center's calendar day when a new draft is created.
    commonFields: { documentDate: "" },
    events: [personC.event],
    items: [personC.row],
  });
  const request = await createRequest(c, draft);
  const order = await value.createServiceOrder(c, {
    title: draft.title,
    customerId: a.id,
    payerId: b.id,
    requestIds: [request.id],
  });
  let revision = order.revision;
  const resultActions = (
    detail: Awaited<ReturnType<typeof value.serviceOrderDetail>>,
  ) => detail.nextActions.filter((item) => item.source === "RESULT_REVIEW");

  await t.test(
    "one different employer is pinned; factual result, event, missing data and rule obligations stay visible",
    async () => {
      assert.equal(order.employerId, employer.id);
      const detail = await value.serviceOrderDetail(c, order.id);
      assert.equal(detail.customerId, a.id);
      assert.equal(detail.payerId, b.id);
      assert.equal(detail.employer?.nameRu, employer.nameRu);
      assert.equal(detail.payer?.nameRu, b.nameRu);
      assert.equal(detail.customer?.nameRu, a.nameRu);
      assert.deepEqual(detail.summary, {
        people: 1,
        events: 1,
        personEventServices: 1,
        legacyAssignments: 0,
      });
      assert.equal(detail.requests[0].itemCount, 1);
      assert.equal(resultActions(detail).length, 1);
      assert.ok(
        detail.nextActions.some(
          (item) =>
            item.source === "DATA_REVIEW" && item.label.includes("Person C"),
        ),
      );
      assert.equal(detail.completion.training, false);
      assert.equal(detail.milestones.length, 1);
      assert.equal(detail.milestones[0].label, "Agreed evidence C");
    },
  );

  const personA = await person(a.id, "A", ruleA.id);
  draft = draftSchema.parse({
    ...draft,
    events: [...draft.events!, personA.event],
    items: [...draft.items, personA.row],
  });
  const changed = await patchRequest(c, request.id, {
    expectedRevision: 0,
    draft,
  });
  await t.test(
    "later mixed rows never recompute the saved employer scope; export preserves all three party IDs",
    async () => {
      const detail = await value.serviceOrderDetail(c, order.id);
      assert.equal(detail.employerId, employer.id);
      assert.equal(detail.summary.people, 1);
      assert.deepEqual(
        detail.events.map((event) => event.id),
        [personC.event.id],
      );
      assert.equal(detail.requests[0].itemCount, 1);
      assert.equal(resultActions(detail).length, 1);
      assert.ok(resultActions(detail)[0].label.includes("Person C"));
      const snapshot = await tenantExportSnapshot(c);
      const saved = snapshot.tables.ServiceOrder.find(
        (row) => row.id === order.id,
      )!;
      assert.equal(saved.customerId, a.id);
      assert.equal(saved.payerId, b.id);
      assert.equal(saved.employerId, employer.id);
    },
  );

  const memberContext = async (organization: string) => {
    const user = await db.user.create({
      data: {
        tenantId: c.tenantId,
        email: `member-${randomUUID()}@example.test`,
        displayName: "Synthetic employer",
        role: "EMPLOYER",
        passwordHash: "unused-service-fixture",
      },
    });
    await value.createEmployerMembership(c, {
      userId: user.id,
      customerId: organization,
      permissions: ["READ", "DOWNLOAD", "PROPOSE", "APPROVE_DATA"],
    });
    return { ...c, userId: user.id, role: "EMPLOYER" as const };
  };
  const [memberA, memberC] = await Promise.all([
    memberContext(a.id),
    memberContext(employer.id),
  ]);
  await t.test(
    "portal and evidence intersect membership with the saved order scope",
    async () => {
      const portalA = await value.employerPortal(memberA);
      assert.equal(
        portalA.orders.some((item) => item.id === order.id),
        false,
      );
      const portalC = await value.employerPortal(memberC);
      const visible = portalC.orders.find((item) => item.id === order.id)!;
      assert.ok(visible);
      assert.deepEqual(
        visible.requests[0].rows.map((row) => row.id),
        [personC.row.id],
      );
      assert.equal(JSON.stringify(visible).includes("Person A"), false);
      assert.deepEqual(
        (await portalEvidence(memberC, employer.id)).programs.map(
          (item) => item.id,
        ),
        [ruleC.id],
      );
      assert.equal(
        (await portalEvidence(memberA, a.id)).programs.some(
          (item) => item.id === ruleC.id,
        ),
        false,
      );
      await assert.rejects(
        value.submitEmployerProposal(memberA, order.id, {
          requestId: request.id,
          requestRevision: changed.revision,
          kind: "CLARIFICATION",
          message: "Forbidden C order",
          changes: [],
        }),
        code("NOT_FOUND"),
      );
    },
  );
  const proposal = await value.submitEmployerProposal(memberC, order.id, {
    requestId: request.id,
    requestRevision: changed.revision,
    kind: "UPDATE_LIST",
    message: "Earlier C scope",
    changes: [{ rowId: personC.row.id, positionRu: "Proposed position C" }],
  });
  await t.test(
    "an explicit scope change validates existing links, retains agreed evidence and adds new applicable requirements once",
    async () => {
      const oldMilestone = await db.orderMilestone.findFirstOrThrow({
        where: { orderId: order.id },
      });
      await value.patchOrderMilestone(c, order.id, oldMilestone.id, {
        status: "DONE",
        evidence: "Synthetic evidence already received",
      });
      const before = await db.orderMilestone.findUniqueOrThrow({
        where: { id: oldMilestone.id },
      });
      const updated = await value.patchServiceOrder(c, order.id, {
        expectedRevision: revision,
        employerId: a.id,
        payerId: employer.id,
      });
      revision = updated.revision;
      const detail = await value.serviceOrderDetail(c, order.id);
      assert.equal(detail.summary.people, 1);
      assert.deepEqual(
        detail.events.map((event) => event.id),
        [personA.event.id],
      );
      assert.equal(detail.milestones.length, 2);
      assert.equal(
        detail.milestones.filter((item) => item.label === "Agreed evidence A")
          .length,
        1,
      );
      assert.deepEqual(
        await db.orderMilestone.findUniqueOrThrow({ where: { id: before.id } }),
        before,
      );
      assert.equal(
        (await value.employerPortal(memberC)).orders.some(
          (item) => item.id === order.id,
        ),
        false,
      );
      const visible = (await value.employerPortal(memberA)).orders.find(
        (item) => item.id === order.id,
      )!;
      assert.deepEqual(
        visible.requests[0].rows.map((row) => row.id),
        [personA.row.id],
      );
      await assert.rejects(
        value.resolveEmployerProposal(c, order.id, proposal.id, {
          status: "ACCEPTED",
          resolution: "Cannot apply old employer scope",
        }),
        code("PROPOSAL_SCOPE_CHANGED"),
      );
      const relinked = await value.patchServiceOrder(c, order.id, {
        expectedRevision: revision,
        requestIds: [request.id],
      });
      revision = relinked.revision;
      assert.equal(
        (await value.serviceOrderDetail(c, order.id)).milestones.length,
        2,
      );
    },
  );

  await t.test(
    "mixed A/C defaults to A; no matching employer among multiple choices returns an actionable conflict",
    async () => {
      const mixed = await value.createServiceOrder(c, {
        title: "Default mixed control",
        customerId: a.id,
        payerId: b.id,
        requestIds: [request.id],
      });
      assert.equal(mixed.employerId, null);
      const detail = await value.serviceOrderDetail(c, mixed.id);
      assert.equal(detail.summary.people, 1);
      assert.ok(resultActions(detail)[0].label.includes("Person A"));
      const c2 = await person(employer.id, "C2");
      const d2 = await person(other.id, "D2");
      const ambiguous = await createRequest(
        c,
        draftSchema.parse({
          kind: "COMPANY",
          schemaVersion: 2,
          customerId: a.id,
          demoMode: true,
          events: [c2.event, d2.event],
          items: [c2.row, d2.row],
        }),
      );
      await assert.rejects(
        value.createServiceOrder(c, {
          title: "Choose participant employer",
          customerId: a.id,
          requestIds: [ambiguous.id],
        }),
        code("EMPLOYER_SCOPE_REQUIRED"),
      );
      const legacy = await db.serviceOrder.create({
        data: {
          tenantId: c.tenantId,
          title: "Legacy ambiguous employer scope",
          customerId: a.id,
          createdBy: c.userId,
        },
      });
      await db.serviceOrderRequest.create({
        data: {
          tenantId: c.tenantId,
          orderId: legacy.id,
          requestId: ambiguous.id,
        },
      });
      const legacyDetail = await value.serviceOrderDetail(c, legacy.id);
      assert.equal(legacyDetail.summary.people, 0);
      assert.ok(
        legacyDetail.nextActions.some(
          (action) =>
            action.source === "PARTICIPANT_SCOPE" &&
            action.label.includes("Выберите работодателя"),
        ),
      );
      const explicit = await value.createServiceOrder(c, {
        title: "Explicit C",
        customerId: a.id,
        employerId: employer.id,
        requestIds: [ambiguous.id],
      });
      assert.equal(
        (await value.serviceOrderDetail(c, explicit.id)).summary.people,
        1,
      );
    },
  );

  await t.test(
    "foreign payer/employer IDs are denied by services and employer tenant FK",
    async () => {
      for (const field of ["payerId", "employerId"] as const) {
        await assert.rejects(
          value.createServiceOrder(c, {
            title: "Foreign denied",
            customerId: a.id,
            [field]: foreign.id,
          }),
          code("CUSTOMER_NOT_FOUND"),
        );
        await assert.rejects(
          value.patchServiceOrder(c, order.id, {
            expectedRevision: revision,
            [field]: foreign.id,
          }),
          code("CUSTOMER_NOT_FOUND"),
        );
      }
      await assert.rejects(
        db.serviceOrder.update({
          where: { id: order.id },
          data: { employerId: foreign.id },
        }),
      );
      assert.equal(
        (await value.serviceOrderDetail(c, order.id)).revision,
        revision,
      );
    },
  );

  await t.test(
    "a scope change with no matching participant rolls back instead of creating a zero-person order",
    async () => {
      const only = await person(employer.id, "Only C");
      const req = await createRequest(
        c,
        draftSchema.parse({
          kind: "COMPANY",
          customerId: a.id,
          demoMode: true,
          events: [only.event],
          items: [only.row],
        }),
      );
      const pinned = await value.createServiceOrder(c, {
        title: "Only C",
        customerId: a.id,
        requestIds: [req.id],
      });
      await assert.rejects(
        value.patchServiceOrder(c, pinned.id, {
          expectedRevision: 0,
          employerId: a.id,
        }),
        code("EMPLOYER_SCOPE_MISMATCH"),
      );
      const unchanged = await value.serviceOrderDetail(c, pinned.id);
      assert.equal(unchanged.employerId, employer.id);
      assert.equal(unchanged.revision, 0);
      assert.equal(unchanged.summary.people, 1);
    },
  );

  await t.test(
    "closed orders require reopening with a reason before changing either party",
    async () => {
      const cancelled = await value.patchServiceOrder(c, order.id, {
        expectedRevision: revision,
        status: "CANCELLED",
        reason: "Synthetic cancellation",
      });
      revision = cancelled.revision;
      for (const change of [{ employerId: employer.id }, { payerId: b.id }])
        await assert.rejects(
          value.patchServiceOrder(c, order.id, {
            expectedRevision: revision,
            ...change,
          }),
          code("ORDER_REOPEN_REQUIRED"),
        );
      await assert.rejects(
        value.patchServiceOrder(c, order.id, {
          expectedRevision: revision,
          payerId: b.id,
          status: "OPEN",
        }),
        code("ORDER_REOPEN_REQUIRED"),
      );
      const reopened = await value.patchServiceOrder(c, order.id, {
        expectedRevision: revision,
        employerId: employer.id,
        payerId: b.id,
        status: "OPEN",
        reason: "Confirmed participant employer change",
      });
      assert.equal(reopened.status, "OPEN");
      assert.equal(reopened.employerId, employer.id);
      assert.equal(reopened.payerId, b.id);
      assert.equal(
        (await value.serviceOrderDetail(c, order.id)).milestones.length,
        2,
      );
    },
  );
});
