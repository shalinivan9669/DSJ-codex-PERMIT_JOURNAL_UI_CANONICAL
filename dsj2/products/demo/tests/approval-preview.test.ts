import test from "node:test";
import assert from "node:assert/strict";
import type { Prisma } from "@demo/database";
import { draftSchema, profileSchema } from "../packages/contracts/src";
import { db, hash, type Context } from "../apps/api/src/core";
import { preview } from "../apps/api/src/requests";

test("director preview binds immutable proposal hash, samples forms once and retains the full 400-person group", async (t) => {
  const context: Context = {
    tenantId: "synthetic-center",
    userId: "synthetic-director",
    role: "DIRECTOR",
    sessionId: "test",
    csrfHash: "test",
    correlationId: "test",
  };
  const submitted = draftSchema.parse({
    kind: "PERSON",
    schemaVersion: 2,
    businessRuleVersion: "LIVE_V1",
    profileVersionId: "profile",
    commonFields: {
      documentDate: "2026-10-04",
      protocolDate: "2026-10-04",
      trainingStart: "2026-10-01",
      trainingEnd: "2026-10-03",
    },
    events: [
      {
        id: "course",
        title: "Проверка ПТМ",
        protocolTemplateId: "ptm-protocol",
        protocolMode: "GROUP",
        commonFields: {},
      },
    ],
    items: Array.from({ length: 400 }, (_, index) => ({
      id: `row-${index}`,
      fullNameRu: `Синтетический Участник ${index}`,
      positionRu: "Рабочий",
      assignments: [
        {
          id: "card",
          templateId: "ptm-card",
          eventId: "course",
          protocolMode: "GROUP",
          result: "Сдал",
          outcome: { status: "PASSED", source: "Стандарт курса" },
        },
      ],
    })),
  });
  const live = structuredClone(submitted);
  live.items[0].fullNameRu = "Иное актуальное имя";
  live.commonFields!.documentDate = "2026-10-09";
  const proposal = {
    id: "proposal",
    requestId: "request",
    status: "PENDING",
    revision: 2,
    baseRevision: 1,
    operation: "SAVE",
    payload: submitted,
    proposalHash: "a".repeat(64),
    assignments: submitted.items.map((row) => ({
      rowId: row.id,
      assignmentId: "card",
    })),
  };
  const record = {
    id: "request",
    tenantId: context.tenantId,
    status: "DRAFT",
    revision: 3,
    workingRevision: 3,
    draft: live,
    archivedAt: null,
  };
  const originalHash = hash({ proposal, record });
  const profile = profileSchema.parse({
    nameRu: "Синтетический центр",
    approved: true,
    headName: "Директор",
    commission: Array.from({ length: 3 }, (_, index) => ({
      name: `Комиссия ${index}`,
      position: "Член комиссии",
    })),
  });
  const snapshots: Array<{
    input: {
      items: Array<{
        fullNameRu: string;
        assignment: { documentDate: string };
      }>;
    };
    revision: number;
  }> = [];
  const jobs: Array<Record<string, unknown>> = [];
  const tx = {
    $executeRaw: async () => 1,
    printRequest: { findFirst: async () => record },
    requestProposal: { findFirst: async () => proposal },
    recipient: { count: async () => 0 },
    customerOrganization: { count: async () => 0, findMany: async () => [] },
    issuerProfileVersion: {
      count: async () => 1,
      findFirst: async () => ({ id: "profile", profile }),
    },
    serviceRuleVersion: { count: async () => 0 },
    photoAsset: { count: async () => 0, findMany: async () => [] },
    templateVersion: {
      findMany: async () =>
        ["ptm-card", "ptm-protocol"].map((templateId, index) => ({
          id: `t-${index}`,
          templateId,
          approved: true,
          createdAt: new Date(),
          contract: { ownerKind: index ? "GROUP" : "INDIVIDUAL" },
          storageKey: "synthetic",
          checksum: "synthetic",
          version: 1,
        })),
    },
    renderInputSnapshot: {
      create: async ({ data }: { data: (typeof snapshots)[number] }) => {
        snapshots.push(data);
        return { id: `snapshot-${snapshots.length}` };
      },
    },
    generationJob: {
      findMany: async () => [],
      create: async ({ data }: { data: Record<string, unknown> }) => {
        jobs.push(data);
        return { id: `job-${jobs.length}`, ...data };
      },
    },
    auditEvent: { create: async () => ({}) },
  } as unknown as Prisma.TransactionClient;
  const host = db as unknown as {
    $transaction: (
      run: (tx: Prisma.TransactionClient) => Promise<unknown>,
    ) => Promise<unknown>;
  };
  const previous = host.$transaction;
  host.$transaction = async (run) => run(tx);
  t.after(() => {
    host.$transaction = previous;
  });
  await assert.rejects(
    preview(context, record.id, {
      expectedRevision: 2,
      proposalId: proposal.id,
      expectedProposalHash: "b".repeat(64),
    }),
  );
  assert.equal(snapshots.length, 0);
  const result = await preview(context, record.id, {
    expectedRevision: 2,
    proposalId: proposal.id,
    expectedProposalHash: proposal.proposalHash,
  });
  assert.equal(result.jobs.length, 4);
  assert.equal(snapshots.length, 2);
  assert.equal(snapshots[0].input.items.length, 1);
  assert.equal(snapshots[1].input.items.length, 400);
  assert.equal(
    snapshots[0].input.items[0].fullNameRu,
    submitted.items[0].fullNameRu,
  );
  assert.equal(
    snapshots[0].input.items[0].assignment.documentDate,
    "2026-10-04",
  );
  assert.equal(snapshots[0].revision, 2);
  assert.ok(
    jobs.every((job) => String(job.logicalKey).includes(proposal.proposalHash)),
  );
  assert.equal(hash({ proposal, record }), originalHash);
});
