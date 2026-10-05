import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { provision } from "../../scripts/setup";
import { db, type Context } from "../../apps/api/src/core";
import { createRequest, listRequests } from "../../apps/api/src/requests";
import {
  approvalDetail,
  listApprovals,
  submitApproval,
} from "../../apps/api/src/approvals";
import { draftSchema } from "../../packages/contracts/src";
import { assertTestDatabase } from "./test-database";

test("director queue and detail display frozen identities, preserve custom titles and do not rewrite submitted data after a directory rename", async () => {
  assertTestDatabase();
  const seed = await provision({
    email: `approval-display-${randomUUID()}@example.test`,
    password: "Synthetic-display-pass!",
    name: "СИНТЕТИЧЕСКИЙ центр заголовков",
    sample: true,
  });
  const c: Context = {
    tenantId: seed.tenantId,
    userId: seed.userId,
    role: "DIRECTOR",
    sessionId: "synthetic",
    csrfHash: "synthetic",
    correlationId: randomUUID(),
  };
  try {
    const customer = await db.customerOrganization.create({
      data: {
        tenantId: c.tenantId,
        nameRu: "ТОО Зафиксированная компания",
        nameKz: "Бекітілген компания ЖШС",
      },
    });
    const cases = [
      {
        kind: "COMPANY",
        title: "Новая заявка организации",
        expected: customer.nameRu,
      },
      {
        kind: "COMPANY",
        title: "  Историческое название № 7  ",
        expected: "  Историческое название № 7  ",
      },
      {
        kind: "PERSON",
        title: "Новая заявка на человека",
        expected: "Синтетический Получатель",
      },
    ] as const;
    const submitted = [];
    for (const entry of cases) {
      const draft = draftSchema.parse({
        kind: entry.kind,
        title: entry.title,
        schemaVersion: 2,
        demoMode: true,
        customerId: entry.kind === "COMPANY" ? customer.id : null,
        commonFields: { documentDate: "2026-10-05" },
        items: [
          {
            id: randomUUID(),
            employeeCategory: "WORKER",
            fullNameRu: "Синтетический Получатель",
            fullNameKz: "Синтетикалық Алушы",
            positionRu: "Монтажник",
            positionKz: "Монтажшы",
            assignments: [
              {
                id: randomUUID(),
                templateId: "ptm-card",
                documentDate: "2026-10-05",
                protocolDate: "2026-10-05",
                trainingStart: "2026-10-01",
                trainingEnd: "2026-10-04",
                trainingSubject: "Синтетическая программа ПТМ",
                hours: "16",
                result: "Сдал",
                outcome: { status: "PASSED", source: "Синтетическая проверка" },
              },
            ],
          },
        ],
      });
      const request = await createRequest(c, draft);
      const proposal = await submitApproval(c, request.id, {
        expectedRevision: request.revision,
      });
      submitted.push({
        ...entry,
        requestId: request.id,
        proposalId: proposal.approval.proposalId,
        originalProposal: await db.requestProposal.findUniqueOrThrow({
          where: { id: proposal.approval.proposalId },
        }),
        originalRequest: await db.printRequest.findUniqueOrThrow({
          where: { id: request.id },
        }),
      });
    }
    await db.customerOrganization.update({
      where: { id: customer.id },
      data: {
        nameRu: "Переименованная организация в справочнике",
        nameKz: "Анықтамалықтағы басқа атау",
      },
    });
    const queue = await listApprovals(c, { status: "PENDING" });
    const requests = await listRequests(c, {});
    for (const entry of submitted) {
      assert.equal(
        queue.items.find((item) => item.id === entry.proposalId)?.title,
        entry.expected,
      );
      const detail = await approvalDetail(c, entry.proposalId);
      assert.equal(detail.request.title, entry.expected);
      assert.equal(
        requests.items.find((item) => item.id === entry.requestId)?.title,
        entry.expected,
      );
      assert.equal(detail.proposalHash, entry.originalProposal.proposalHash);
      assert.deepEqual(detail.payload, entry.originalProposal.payload);
      assert.deepEqual(
        await db.requestProposal.findUniqueOrThrow({
          where: { id: entry.proposalId },
        }),
        entry.originalProposal,
      );
      assert.deepEqual(
        await db.printRequest.findUniqueOrThrow({
          where: { id: entry.requestId },
        }),
        entry.originalRequest,
      );
      assert.equal(
        draftSchema.parse(entry.originalProposal.payload).title,
        entry.title,
      );
    }
    const foreign = { ...c, tenantId: randomUUID() };
    assert.deepEqual((await listApprovals(foreign, {})).items, []);
    await assert.rejects(
      approvalDetail(foreign, submitted[0].proposalId),
      (error: unknown) => {
        assert.equal(
          (error as { getResponse(): { code: string } }).getResponse().code,
          "NOT_FOUND",
        );
        return true;
      },
    );
  } finally {
    await db.$disconnect();
  }
});
