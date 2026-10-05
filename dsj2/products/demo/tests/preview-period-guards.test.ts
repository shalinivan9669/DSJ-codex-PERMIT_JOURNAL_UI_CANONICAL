import assert from "node:assert/strict";
import test from "node:test";
import {
  draftSchema,
  profileSchema,
  resolveDraft,
  validateDraft,
} from "../packages/contracts/src";
import { db, hash, type Context } from "../apps/api/src/core";
import { preview } from "../apps/api/src/requests";

test("preview date guards cover draft and immutable proposal, with target and without target, while preserving optional and legacy periods", async (t) => {
  const context: Context = {
    tenantId: "synthetic-center",
    userId: "synthetic-director",
    role: "DIRECTOR",
    sessionId: "test",
    csrfHash: "test",
    correlationId: "test",
  };
  const profile = profileSchema.parse({
    nameRu: "Синтетический центр",
    approved: true,
    headName: "Директор",
    commission: Array.from({ length: 3 }, (_, i) => ({
      name: `Комиссия ${i}`,
      position: "Член комиссии",
    })),
  });
  const host = db as any;
  const previous = host.$transaction;
  try {
    for (const scenario of [
      "impossible",
      "reversed",
      "strict-schedule",
      "optional-empty",
      "optional-partial",
      "cleared-with-schedule",
      "legacy-no-schedule",
    ] as const) {
      const source = draftSchema.parse({
        kind: "PERSON",
        schemaVersion: 2,
        profileVersionId: "profile",
        commonFields: {
          documentDate: "2026-10-04",
          protocolDate: "2026-10-03",
        },
        items: [
          {
            id: "person",
            fullNameRu: "Синтетический Участник",
            positionRu: "Рабочий",
            assignments: [
              {
                id: "witness",
                templateId: "ps-witness",
                documentDate: "2026-10-04",
                protocolDate: "2026-10-03",
                trainingStart: "2026-09-01",
                trainingEnd: "2026-09-30",
                trainingSubject: "Синтетический курс",
                hours: "40",
                result: "Сдал",
                outcome: {
                  status: "PASSED",
                  source: "Синтетическая ведомость",
                },
                fieldOrigins: {
                  trainingStart: "MANUAL",
                  trainingEnd: "IMPORTED",
                },
              },
            ],
          },
        ],
      });
      const assignment = source.items[0].assignments[0];
      if (scenario === "impossible") assignment.trainingStart = "2026-02-30";
      if (scenario === "reversed") assignment.trainingStart = "2026-10-05";
      if (
        scenario === "strict-schedule" ||
        scenario === "cleared-with-schedule"
      ) {
        assignment.trainingStart = "2026-10-04";
        assignment.trainingEnd = "2026-10-04";
        source.commonFields!.trainingDateRule = {
          hoursPerDay: 8,
          hoursSource: "THEORY",
          calendar: "CALENDAR",
          anchor: "DOCUMENT_AFTER_TRAINING",
          protocolDate: "MANUAL",
          source: "Явно подтверждённый синтетический график",
        };
      }
      if (
        scenario === "optional-empty" ||
        scenario === "cleared-with-schedule"
      ) {
        assignment.trainingStart = "";
        assignment.trainingEnd = "";
        assignment.fieldOrigins = {
          trainingStart: "CLEARED",
          trainingEnd: "CLEARED",
        };
      }
      if (scenario === "optional-partial") assignment.trainingEnd = "";
      if (scenario === "legacy-no-schedule") {
        assignment.trainingStart = "2027-09-01";
        assignment.trainingEnd = "2027-09-30";
      }
      const resolved = resolveDraft(source, profile.commonFields);
      const codes = [
        ...resolved.issues,
        ...validateDraft(resolved.draft, profile),
      ].map((issue) => issue.code);
      for (const sourceKind of ["draft", "proposal"] as const)
        for (const targeted of [false, true])
          await t.test(
            `${scenario}/${sourceKind}/${targeted ? "target" : "general"}`,
            async () => {
              const record = {
                id: "request",
                tenantId: context.tenantId,
                status: "DRAFT",
                revision: 2,
                workingRevision: 2,
                draft: source,
                archivedAt: null,
              };
              const proposal = {
                id: "proposal",
                requestId: record.id,
                status: "PENDING",
                revision: 1,
                baseRevision: 0,
                operation: "SAVE",
                payload: source,
                proposalHash: "a".repeat(64),
                assignments: [{ rowId: "person", assignmentId: "witness" }],
              };
              const snapshots: any[] = [],
                jobs: any[] = [];
              const tx = {
                $executeRaw: async () => 1,
                printRequest: { findFirst: async () => record },
                requestProposal: {
                  findFirst: async () =>
                    sourceKind === "proposal" ? proposal : null,
                },
                recipient: { count: async () => 0 },
                customerOrganization: {
                  count: async () => 0,
                  findMany: async () => [],
                },
                issuerProfileVersion: {
                  count: async () => 1,
                  findFirst: async () => ({ id: "profile", profile }),
                },
                serviceRuleVersion: { count: async () => 0 },
                photoAsset: { count: async () => 0, findMany: async () => [] },
                templateVersion: {
                  findMany: async () => [
                    {
                      id: "template",
                      templateId: "ps-witness",
                      approved: true,
                      createdAt: new Date(),
                      contract: { ownerKind: "INDIVIDUAL" },
                      storageKey: "synthetic",
                      checksum: "synthetic",
                      version: 15,
                    },
                  ],
                },
                renderInputSnapshot: {
                  create: async ({ data }: any) => {
                    snapshots.push(data);
                    return { id: `snapshot-${snapshots.length}` };
                  },
                },
                generationJob: {
                  findMany: async () => [],
                  create: async ({ data }: any) => {
                    jobs.push(data);
                    return { id: `job-${jobs.length}`, ...data };
                  },
                },
                auditEvent: { create: async () => ({}) },
              };
              host.$transaction = async (run: any) => run(tx);
              const before = hash({ source, record, proposal });
              let outcome: {
                accepted: boolean;
                code?: string;
                issues?: Array<{ code: string; path: string }>;
                jobCount?: number;
                snapshotPeriod?: unknown;
              };
              try {
                const response = await preview(context, record.id, {
                  expectedRevision: sourceKind === "proposal" ? 1 : 2,
                  ...(sourceKind === "proposal"
                    ? {
                        proposalId: proposal.id,
                        expectedProposalHash: proposal.proposalHash,
                      }
                    : {}),
                  ...(targeted
                    ? {
                        target: {
                          kind: "ASSIGNMENT",
                          rowId: "person",
                          assignmentId: "witness",
                        },
                      }
                    : {}),
                });
                outcome = {
                  accepted: true,
                  jobCount: response.jobs.length,
                  snapshotPeriod: snapshots[0]?.input?.items?.[0]?.assignment
                    ? [
                        snapshots[0].input.items[0].assignment.trainingStart,
                        snapshots[0].input.items[0].assignment.trainingEnd,
                      ]
                    : null,
                };
              } catch (error: any) {
                const response = error.getResponse?.();
                outcome = {
                  accepted: false,
                  code: response?.code || error.message,
                  issues: response?.details?.map((issue: any) => ({
                    code: issue.code,
                    path: issue.path,
                  })),
                };
              }
              assert.equal(hash({ source, record, proposal }), before);
              const expectedCode =
                scenario === "impossible"
                  ? "DATE_INVALID"
                  : scenario === "reversed"
                    ? "DATE_ORDER"
                    : scenario === "strict-schedule"
                      ? "TRAINING_BEFORE_DOCUMENT"
                      : null;
              if (expectedCode) {
                assert.ok(
                  codes.includes(expectedCode),
                  "fixture must reach the real validation rule",
                );
                assert.equal(
                  outcome.accepted,
                  false,
                  `${scenario} must not enqueue preview artifacts`,
                );
                assert.equal(outcome.code, "PREVIEW_VALIDATION");
                assert.ok(
                  outcome.issues?.some(
                    (issue) =>
                      issue.code === expectedCode &&
                      issue.path ===
                        `items.0.assignments.0.${scenario === "reversed" ? "trainingEnd" : "trainingStart"}`,
                  ),
                );
                assert.equal(jobs.length, 0);
                assert.equal(snapshots.length, 0);
              } else {
                assert.deepEqual(
                  codes,
                  [],
                  "optional and legacy data must not acquire a new rule",
                );
                assert.equal(outcome.accepted, true, JSON.stringify(outcome));
                assert.equal(jobs.length, 2);
                assert.equal(snapshots.length, 1);
                assert.deepEqual(outcome.snapshotPeriod, [
                  assignment.trainingStart,
                  assignment.trainingEnd,
                ]);
              }
            },
          );
    }
  } finally {
    host.$transaction = previous;
  }
});
