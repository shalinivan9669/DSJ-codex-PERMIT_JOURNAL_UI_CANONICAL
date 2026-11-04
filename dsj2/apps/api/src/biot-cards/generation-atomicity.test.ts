import assert from "node:assert/strict";
import { test } from "node:test";
import { AuditService } from "../audit/audit.service";
import type { AuthenticatedUser } from "../common/types/authenticated-user.type";
import { BiotCardsService } from "./biot-cards.service";

const user: AuthenticatedUser = {
  userId: "synthetic-user", companyId: "synthetic-company",
  email: "user@example.test", fullName: "Synthetic user", role: "COMPANY_ADMIN",
};

function fixture({ failAuditAt, failRender = false }: { failAuditAt?: number; failRender?: boolean } = {}) {
  let state: { requests: any[]; events: any[] } = { requests: [], events: [] };
  let renderCalls = 0;
  let timeout = 0;
  const prisma: any = {
    $transaction: async (callback: (transaction: any) => Promise<unknown>, options: { timeout: number }) => {
      timeout = options.timeout;
      const staged = structuredClone(state);
      const transaction = {
        cardGenerationRequest: { create: async ({ data }: any) => {
          const record = { ...data, id: "synthetic-request" };
          staged.requests.push(record);
          return record;
        } },
        auditLog: { create: async ({ data }: any) => {
          if (staged.events.length + 1 === failAuditAt) throw new Error("synthetic audit failure");
          staged.events.push(data);
          return data;
        } },
      };
      const result = await callback(transaction);
      state = staged;
      return result;
    },
  };
  const service = new BiotCardsService(prisma, new AuditService(prisma));
  const internals: any = service;
  internals.populateMissingBiotItrProtocolNumbers = async ({ items }: any) => items;
  internals.ensureUniqueBatchValues = () => {};
  internals.ensureNumbersAreAvailable = async () => {};
  internals.prepareItem = async ({ item, certificateType, biotDocumentKind, trainingSubject }: any) => ({
    ...item, certificateType, biotDocumentKind, trainingSubject,
    employeeId: null, trainingAssignmentId: null, photo: null,
  });
  internals.exportRequestCardsForCompany = async () => {
    renderCalls += 1;
    if (failRender) throw new Error("synthetic render failure");
    return { buffer: Buffer.from("docx"), fileName: "test.docx", contentType: "application/test" };
  };
  const input = (count: number) => ({
    certificateType: "BIOT" as const, biotDocumentKind: "WORKER_CARD" as const,
    requestMode: "REQUEST" as const, issueDate: "2026-11-04", seriesNumber: "1",
    trainingSubject: "Synthetic training", includeCard: true,
    items: Array.from({ length: count }, (_, index) => ({
      fullName: `Synthetic employee ${index}`, positionRu: "Worker",
      certificateNumber: `CERT-${index}`, protocolNumber: `PROTO-${index}`,
    })),
  });
  return { service, input, snapshot: () => state, renderCalls: () => renderCalls, timeout: () => timeout };
}

test("one transaction commits the request and one existing audit event for every employee", async () => {
  const f = fixture();
  const result = await f.service.generateBatch(user, f.input(100));
  assert.equal(result.requestId, "synthetic-request");
  assert.equal(f.snapshot().requests.length, 1);
  assert.equal(f.snapshot().requests[0].items.create.length, 100);
  assert.equal(f.snapshot().events.length, 100);
  assert.ok(f.snapshot().events.every((event) => event.action === "biot_card.generated" &&
    event.entityType === "BiotCardTemplate" && event.metadata.requestId === result.requestId &&
    event.companyId === user.companyId && event.actorUserId === user.userId));
  assert.equal(f.timeout(), 30_000);
  assert.equal(f.renderCalls(), 1);
});

for (const failAuditAt of [1, 2, 100]) {
  test(`audit failure at employee ${failAuditAt} rolls back the request and all prior events`, async () => {
    const f = fixture({ failAuditAt });
    await assert.rejects(() => f.service.generateBatch(user, f.input(100)), /synthetic audit failure/);
    assert.deepEqual(f.snapshot(), { requests: [], events: [] });
    assert.equal(f.renderCalls(), 0);
  });
}

test("render failure occurs after the request and its complete audit have committed", async () => {
  const f = fixture({ failRender: true });
  await assert.rejects(() => f.service.generateBatch(user, f.input(2)), /synthetic render failure/);
  assert.equal(f.snapshot().requests.length, 1);
  assert.equal(f.snapshot().events.length, 2);
  assert.ok(f.snapshot().events.every((event) => event.metadata.requestId === "synthetic-request"));
  assert.equal(f.renderCalls(), 1);
});
