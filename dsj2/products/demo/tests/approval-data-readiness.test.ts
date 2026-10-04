import test from "node:test";
import assert from "node:assert/strict";
import type { Prisma } from "@demo/database";
import {
  applyBusinessRules,
  draftSchema,
  profileSchema,
} from "../packages/contracts/src";
import { db, type Context } from "../apps/api/src/core";
import { decideProposal, submitApproval } from "../apps/api/src/approvals";
import { assertApprovalDataComplete } from "../apps/api/src/requests";

const context: Context = {
  tenantId: "synthetic-center",
  userId: "synthetic-director",
  role: "DIRECTOR",
  sessionId: "test",
  csrfHash: "test",
  correlationId: "test",
};

function fixture(complete: boolean) {
  const draft = applyBusinessRules(
    draftSchema.parse({
      kind: "PERSON",
      schemaVersion: 2,
      profileVersionId: "profile",
      items: Array.from({ length: 2 }, (_, index) => ({
        id: `row-${index}`,
        fullNameRu: `Синтетический Получатель ${index}`,
        assignments: [
          {
            id: `card-${index}`,
            templateId: "ptm-card",
            documentDate: "2026-10-01",
            protocolDate: "2026-10-01",
            trainingStart: "2026-09-29",
            trainingEnd: "2026-09-30",
            trainingSubject:
              complete || index === 0 ? "Синтетическая программа ПТМ" : "",
            result: complete ? "Сдал" : "",
            ...(complete
              ? {
                  outcome: {
                    status: "PASSED",
                    source: "Синтетическая ведомость",
                  },
                }
              : {}),
            ...(complete || index === 0
              ? {}
              : { fieldOrigins: { trainingSubject: "CLEARED" } }),
          },
        ],
      })),
    }),
  );
  const approved = draftSchema.parse({ kind: "PERSON", items: [] });
  const record = {
    id: "request",
    tenantId: context.tenantId,
    revision: 0,
    status: "DRAFT",
    draft: approved,
    archivedAt: null,
  };
  const proposal = {
    id: "proposal",
    requestId: record.id,
    status: "PENDING",
    revision: 1,
    baseRevision: 0,
    operation: "SAVE",
    payload: draft,
    proposalHash: "a".repeat(64),
  };
  const profile = profileSchema.parse({
    nameRu: "Синтетический центр",
    commission: Array.from({ length: 3 }, (_, index) => ({
      name: `Комиссия ${index}`,
      position: "Член комиссии",
    })),
    headName: "Синтетический руководитель",
    approved: true,
  });
  let writes = 0;
  const write = async () => {
    writes++;
    return {};
  };
  const tx = {
    $executeRaw: async () => 1,
    printRequest: { findFirst: async () => record, update: write },
    requestProposal: { findFirst: async () => proposal, update: write },
    proposalDecision: { create: write },
    issuanceAssignment: { findMany: async () => [] },
    recipient: { count: async () => 0 },
    customerOrganization: { count: async () => 0, findMany: async () => [] },
    issuerProfileVersion: {
      count: async () => 1,
      findFirst: async () => ({ id: "profile", profile }),
    },
    serviceRuleVersion: { count: async () => 0 },
    photoAsset: { count: async () => 0 },
    templateVersion: {
      findMany: async () =>
        ["ptm-card", "ptm-protocol"].map((templateId, index) => ({
          id: `template-${index}`,
          templateId,
          approved: true,
          contract: { ownerKind: "INDIVIDUAL" },
          createdAt: new Date("2026-10-01T00:00:00Z"),
        })),
    },
  } as unknown as Prisma.TransactionClient;
  return { tx, record, proposal, writes: () => writes };
}

test("director cannot approve missing confirmed results/programs or promote any part of the proposal", async (t) => {
  const f = fixture(false);
  const transactional = db as unknown as {
    $transaction: (
      run: (tx: Prisma.TransactionClient) => Promise<unknown>,
    ) => Promise<unknown>;
  };
  const previousTransaction = transactional.$transaction;
  const fakeTransaction = async (
    run: (tx: Prisma.TransactionClient) => Promise<unknown>,
  ) => run(f.tx);
  transactional.$transaction = fakeTransaction;
  t.after(() => {
    transactional.$transaction = previousTransaction;
  });
  assert.equal(transactional.$transaction, fakeTransaction);
  await assert.rejects(
    decideProposal(context, f.proposal.id, {
      decision: "APPROVE",
      reason: "Синтетическая проверка",
      expectedProposalHash: f.proposal.proposalHash,
    }),
    (error: unknown) => {
      const response = error as {
        getStatus: () => number;
        getResponse: () => {
          code: string;
          details: { code: string; path: string }[];
        };
      };
      assert.equal(response.getStatus(), 422);
      assert.equal(response.getResponse().code, "APPROVAL_DATA_INCOMPLETE");
      const errors = response.getResponse().details;
      assert.ok(
        errors.some(
          (issue) =>
            issue.code === "RESULT_REQUIRED" &&
            issue.path === "items.0.assignments.0.result",
        ),
      );
      assert.ok(
        errors.some(
          (issue) =>
            issue.code === "SUBJECT_REQUIRED" &&
            issue.path === "items.1.assignments.0.trainingSubject",
        ),
      );
      assert.ok(
        errors.some(
          (issue) =>
            issue.code === "RESULT_REQUIRED" &&
            issue.path === "items.1.assignments.1.result",
        ),
      );
      return true;
    },
  );
  assert.equal(f.writes(), 0);
  assert.equal(f.record.revision, 0);
  assert.equal(f.record.draft.items.length, 0);
  assert.equal(f.proposal.status, "PENDING");
});

test("complete PTM card/protocol data passes preapproval without rendering or changing approved storage", async () => {
  const f = fixture(true);
  await assert.doesNotReject(
    assertApprovalDataComplete(f.tx, context, f.record.id, f.proposal.revision),
  );
  assert.equal(f.writes(), 0);
  assert.equal(f.record.draft.items.length, 0);
  assert.equal(f.proposal.status, "PENDING");
});

test("explicit submission cannot promote incomplete saved input to PENDING", async (t) => {
  const f = fixture(false);
  f.record.draft = f.proposal.payload;
  f.record.revision = f.proposal.revision;
  f.proposal.status = "DRAFT";
  const transactionHost = db as unknown as {
    $transaction: (
      run: (tx: Prisma.TransactionClient) => Promise<unknown>,
    ) => Promise<unknown>;
  };
  const original = transactionHost.$transaction;
  transactionHost.$transaction = async (run) => run(f.tx);
  t.after(() => {
    transactionHost.$transaction = original;
  });
  await assert.rejects(
    submitApproval(context, f.record.id, {
      expectedRevision: f.record.revision,
    }),
    (error: unknown) => {
      assert.equal(
        (error as { getResponse: () => { code: string } }).getResponse().code,
        "APPROVAL_DATA_INCOMPLETE",
      );
      return true;
    },
  );
  assert.equal(f.writes(), 0);
  assert.equal(f.proposal.status, "DRAFT");
});

test("approval validates frozen proposal values even when current working data is complete", async () => {
  const f = fixture(true);
  const incomplete = structuredClone(f.proposal.payload);
  incomplete.items[0].assignments[0].result = "";
  incomplete.items[0].assignments[0].outcome = {
    status: "UNKNOWN",
    source: "",
  };
  await assert.rejects(
    assertApprovalDataComplete(
      f.tx,
      context,
      f.record.id,
      f.proposal.revision,
      undefined,
      incomplete,
    ),
  );
  assert.equal(f.writes(), 0);
  assert.equal(f.proposal.payload.items[0].assignments[0].result, "Сдал");
});
