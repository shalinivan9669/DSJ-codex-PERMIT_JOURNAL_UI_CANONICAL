import assert from "node:assert/strict";
import { test } from "node:test";
import { ForbiddenException } from "@nestjs/common";
import type { AuthenticatedUser } from "../common/types/authenticated-user.type";
import { BiotCardsService } from "./biot-cards.service";

const superAdminUser: AuthenticatedUser = {
  userId: "super-admin-1",
  companyId: null,
  email: "super-admin@example.com",
  fullName: "Super Admin",
  role: "SUPER_ADMIN",
};

function createService() {
  return new BiotCardsService(
    {
      $transaction: async (callback: (transaction: object) => Promise<unknown>) =>
        callback({}),
    } as never,
    {
      log: async () => undefined,
    } as never,
  );
}

test("BIOT saved card export accepts an explicit company scope", async () => {
  const service = createService();
  const calls: Array<{ companyId: string; requestId: string }> = [];
  const internals = service as unknown as Record<string, any>;

  internals.exportRequestCardsForCompany = async (
    companyId: string,
    requestId: string,
  ) => {
    calls.push({ companyId, requestId });
    return {
      buffer: Buffer.from("docx"),
      contentType:
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      fileName: "cards.docx",
    };
  };

  const result = await service.exportRequestCards(superAdminUser, "request-1", {
    companyId: "company-1",
  });

  assert.equal(result.fileName, "cards.docx");
  assert.deepEqual(calls, [
    {
      companyId: "company-1",
      requestId: "request-1",
    },
  ]);
});

test("BIOT saved card export still rejects super admins without company scope", async () => {
  const service = createService();

  await assert.rejects(
    () => service.exportRequestCards(superAdminUser, "request-1"),
    (error) => error instanceof ForbiddenException,
  );
});

test("BIOT batch generation reuses the resolved company scope for immediate exports", async () => {
  const service = createService();
  const internals = service as unknown as Record<string, any>;
  const exportCalls: Array<{ companyId: string; requestId: string }> = [];

  internals.populateMissingBiotItrProtocolNumbers = async ({
    items,
  }: {
    items: unknown[];
  }) => items;
  internals.ensureNumbersAreAvailable = async () => undefined;
  internals.prepareItem = async () => ({
    certificateNumber: "DSJ-001",
    protocolNumber: "P-001",
  });
  internals.createRequestRecord = async ({
    companyId,
  }: {
    companyId: string;
  }) => {
    assert.equal(companyId, "company-1");
    return { id: "request-1" };
  };
  internals.logArtifacts = async () => undefined;
  internals.exportRequestCardsForCompany = async (
    companyId: string,
    requestId: string,
  ) => {
    exportCalls.push({ companyId, requestId });
    return {
      buffer: Buffer.from("docx"),
      contentType:
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      fileName: "cards.docx",
    };
  };

  const result = await service.generateBatch(superAdminUser, {
    biotDocumentKind: "WORKER_CARD",
    certificateType: "BIOT",
    companyId: "company-1",
    includeCard: true,
    includeProtocol: true,
    issueDate: "2026-06-05",
    requestMode: "REQUEST",
    seriesNumber: "DSJ",
    trainingSubject: "Безопасность и охрана труда",
    items: [
      {
        certificateNumber: "DSJ-001",
        fullName: "Aigerim Sadykova",
        issuedTo: "Aigerim Sadykova",
        positionKz: "Қауіпсіздік инженері",
        positionRu: "Инженер по безопасности",
        protocolNumber: "P-001",
        workplaceKz: "ЖШС Құрылыс",
        workplaceRu: "ТОО Строй",
      },
    ],
  } as never);

  assert.equal(result.requestId, "request-1");
  assert.deepEqual(exportCalls, [
    {
      companyId: "company-1",
      requestId: "request-1",
    },
  ]);
});
