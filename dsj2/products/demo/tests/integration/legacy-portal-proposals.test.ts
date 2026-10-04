import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { draftSchema } from "../../packages/contracts/src";
import { db, type Context } from "../../apps/api/src/core";
import { createRequest } from "../../apps/api/src/requests";
import { submitApproval, workingRequest } from "../../apps/api/src/approvals";
import {
  createEmployerMembership,
  createServiceOrder,
  employerPortal,
  resolveEmployerProposal,
  submitEmployerProposal,
} from "../../apps/api/src/operator-value";
import { provision } from "../../scripts/setup";
import { newAssignment, newRecipient } from "../../apps/web/lib/types";
import { createApprovalFixture } from "./live-approval-fixture";
import { assertTestDatabase } from "./test-database";

function code(expected: string) {
  return (error: unknown) =>
    (error as { getResponse(): { code: string } }).getResponse().code ===
    expected;
}

test("legacy pending employer commands recover only their historical public scope, preserving revision, hash and current grants", async (t) => {
  assertTestDatabase();
  const suffix = randomUUID();
  const who = await provision({
    email: `legacy-portal-${suffix}@example.test`,
    password: "Synthetic-legacy-portal!",
    name: "Синтетическая проверка прежних предложений",
    sample: true,
  });
  const admin: Context = {
    ...who,
    role: "ADMIN",
    csrfHash: "test",
    sessionId: "test",
    correlationId: suffix,
  };
  const approvals = await createApprovalFixture(admin);
  t.after(async () => {
    await approvals.close();
    await db.$disconnect();
  });
  const customer = await db.customerOrganization.create({
    data: { tenantId: admin.tenantId, nameRu: "Прежний работодатель" },
  });
  const user = await db.user.create({
    data: {
      tenantId: admin.tenantId,
      email: `legacy-member-${suffix}@example.test`,
      displayName: "Синтетический представитель",
      role: "EMPLOYER",
      passwordHash: "unused-synthetic-password",
    },
  });
  const employer: Context = { ...admin, userId: user.id, role: "EMPLOYER" };
  const membership = await createEmployerMembership(admin, {
    customerId: customer.id,
    userId: user.id,
    permissions: ["READ", "PROPOSE", "APPROVE_DATA"],
  });
  const first = {
    ...newRecipient(),
    fullNameRu: "Согласованный человек",
    positionRu: "Оператор",
    employerId: customer.id,
    workplaceRu: customer.nameRu,
    assignments: [
      {
        ...newAssignment("pb-card"),
        documentDate: "2026-10-01",
        protocolDate: "2026-09-30",
        validUntil: "2029-10-01",
        hours: "40",
        outcome: {
          status: "PASSED",
          source: "Синтетическая фактическая ведомость",
        },
      },
      {
        ...newAssignment("ptm-card"),
        trainingSubject: "ЧАСТНЫЙ_ОЖИДАЮЩИЙ_КУРС",
      },
    ],
  };
  const waiting = {
    ...newRecipient(),
    fullNameRu: "ЧАСТНЫЙ_ОЖИДАЮЩИЙ_ЧЕЛОВЕК",
    positionRu: "Оператор",
    employerId: customer.id,
    workplaceRu: customer.nameRu,
    assignments: [newAssignment("pb-card")],
  };
  const request = await createRequest(
    admin,
    draftSchema.parse({
      kind: "COMPANY",
      customerId: customer.id,
      title: "Прежняя область",
      items: [first, waiting],
    }),
  );
  await submitApproval(admin, request.id, {
    expectedRevision: request.revision,
    assignments: [{ rowId: first.id, assignmentId: first.assignments[0].id }],
  });
  await approvals.approve(request.id);
  const working = await workingRequest(admin, request.id);
  const draft = draftSchema.parse(working.draft);
  const order = await createServiceOrder(admin, {
    title: "Прежний заказ",
    customerId: customer.id,
    employerId: customer.id,
    requestIds: [request.id],
  });
  const approval = await db.requestProposal.findFirstOrThrow({
    where: {
      tenantId: admin.tenantId,
      requestId: request.id,
      status: "APPROVED",
    },
  });
  const decision = await db.proposalDecision.findFirstOrThrow({
    where: { tenantId: admin.tenantId, proposalId: approval.id },
  });
  const makeOld = (
    options: {
      createdAt?: Date;
      requestRevision?: number;
      kind?: string;
      changes?: { rowId: string; fullNameRu: string }[];
      message?: string;
    } = {},
  ) =>
    db.portalProposal.create({
      data: {
        tenantId: admin.tenantId,
        orderId: order.id,
        membershipId: membership.id,
        requestId: request.id,
        requestRevision: options.requestRevision ?? working.revision,
        kind: options.kind || "UPDATE_LIST",
        message: options.message || "Синтетическое прежнее предложение",
        changes: options.changes || [],
        ...(options.createdAt ? { createdAt: options.createdAt } : {}),
      },
    });
  const accept = (proposalId: string) =>
    resolveEmployerProposal(admin, order.id, proposalId, {
      status: "ACCEPTED",
      resolution: "Проверена историческая область",
    });

  await t.test(
    "a later director decision cannot prove an earlier command; rejection then resubmission produces a new valid item",
    async () => {
      const message = "Прежнее предложение до решения директора";
      const old = await makeOld({
        createdAt: new Date(decision.createdAt.getTime() - 1),
        kind: "CONFIRM_LIST",
        message,
      });
      await assert.rejects(accept(old.id), code("PROPOSAL_SOURCE_REQUIRED"));
      const visible = (await employerPortal(employer)).orders[0].requests[0];
      const same = await submitEmployerProposal(employer, order.id, {
        requestId: request.id,
        requestRevision: visible.revision,
        kind: "CONFIRM_LIST",
        message,
      });
      assert.equal(
        same.id,
        old.id,
        "Deduplication must be explained by the refusal action",
      );
      await resolveEmployerProposal(admin, order.id, old.id, {
        status: "REJECTED",
        resolution:
          "Источник возник после прежней отправки; нужна новая команда",
      });
      const fresh = await submitEmployerProposal(employer, order.id, {
        requestId: request.id,
        requestRevision: visible.revision,
        kind: "CONFIRM_LIST",
        message,
      });
      assert.notEqual(fresh.id, old.id);
      assert.equal((await accept(fresh.id)).status, "ACCEPTED");
    },
  );
  await t.test("the original working revision remains mandatory", async () => {
    const old = await makeOld({ requestRevision: working.revision - 1 });
    await assert.rejects(accept(old.id), code("REVISION_CONFLICT"));
  });
  await t.test(
    "a waiting person cannot be added to the recovered public scope",
    async () => {
      const old = await makeOld({
        changes: [{ rowId: waiting.id, fullNameRu: "Недопустимая замена" }],
      });
      await assert.rejects(accept(old.id), code("PROPOSAL_SCOPE_CHANGED"));
    },
  );
  await t.test(
    "revoked, expired and removed permissions refuse a historical command",
    async () => {
      const old = await makeOld();
      for (const denied of [
        { active: false },
        { expiresAt: new Date("2020-01-01T00:00:00Z") },
        { permissions: ["READ"] },
      ]) {
        await db.employerMembership.update({
          where: { id: membership.id },
          data: denied,
        });
        try {
          await assert.rejects(accept(old.id), code("PROPOSAL_SCOPE_CHANGED"));
        } finally {
          await db.employerMembership.update({
            where: { id: membership.id },
            data: {
              active: true,
              expiresAt: null,
              permissions: ["READ", "PROPOSE", "APPROVE_DATA"],
            },
          });
        }
      }
    },
  );
  await t.test(
    "a proved historical approval accepts the existing item without resubmission and preserves private waiting data",
    async () => {
      const old = await makeOld({
        changes: [{ rowId: first.id, fullNameRu: "Принятая прежняя правка" }],
      });
      const result = await accept(old.id);
      assert.equal(result.id, old.id);
      assert.equal(result.status, "ACCEPTED");
      const changed = draftSchema.parse(
        (await workingRequest(admin, request.id)).draft,
      );
      assert.equal(changed.items[0].fullNameRu, "Принятая прежняя правка");
      assert.deepEqual(changed.items[1], draft.items[1]);
      assert.ok(
        changed.items[0].assignments.some(
          (assignment) => assignment.templateId === "ptm-card",
        ),
      );
      const recovered = await db.auditEvent.findFirstOrThrow({
        where: {
          tenantId: admin.tenantId,
          action: "EMPLOYER_PROPOSAL_SOURCE_RECOVERED",
          entityId: order.id,
          metadata: { path: ["proposalId"], equals: old.id },
        },
      });
      assert.equal(
        (recovered.metadata as { approvalId: string }).approvalId,
        approval.id,
      );
      assert.ok(
        !JSON.stringify(recovered.metadata).includes("ЧАСТНЫЙ_ОЖИДАЮЩИЙ"),
      );
    },
  );
  await t.test(
    "matching working revision alone cannot prove selected values changed after the historical approval",
    async () => {
      const current = await workingRequest(admin, request.id);
      assert.notEqual(current.revision, working.revision);
      const old = await makeOld({ requestRevision: current.revision });
      assert.equal(old.requestRevision, current.revision);
      await assert.rejects(accept(old.id), code("PROPOSAL_SOURCE_REQUIRED"));
    },
  );
});
