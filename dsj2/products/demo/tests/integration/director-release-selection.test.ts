import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { provision } from "../../scripts/setup";
import { db, type Context } from "../../apps/api/src/core";
import {
  createRequest,
  patchRequest,
  requestDetail,
  finalize,
} from "../../apps/api/src/requests";
import {
  approvalDetail,
  submitApproval,
  decideProposal,
  requireApproved,
} from "../../apps/api/src/approvals";
import { draftSchema } from "../../packages/contracts/src";
import { assertTestDatabase } from "./test-database";

test("director release preparation is pinned to the selected proposal and its own issuance", async () => {
  assertTestDatabase();
  const seed = await provision({
    email: `director-release-${randomUUID()}@example.test`,
    password: "Synthetic-release-pass!",
    name: "СИНТЕТИЧЕСКИЙ центр выпуска директора",
    sample: true,
  });
  const c: Context = {
    ...seed,
    role: "DIRECTOR",
    sessionId: "synthetic",
    csrfHash: "synthetic",
    correlationId: randomUUID(),
  };
  try {
    const request = await createRequest(
      c,
      draftSchema.parse({
        kind: "PERSON",
        schemaVersion: 2,
        demoMode: true,
        title: "Синтетическая проверка редакции",
        items: [
          {
            id: randomUUID(),
            fullNameRu: "Синтетический Получатель",
            positionRu: "Рабочий",
            employeeCategory: "WORKER",
            assignments: [
              {
                id: randomUUID(),
                templateId: "ptm-card",
                documentDate: "2026-11-10",
                protocolDate: "2026-11-10",
                trainingStart: "2026-11-01",
                trainingEnd: "2026-11-09",
                trainingSubject: "Синтетическая программа",
                hours: "16",
                result: "Сдал",
                outcome: {
                  status: "PASSED",
                  source: "Синтетическая ведомость",
                },
              },
            ],
          },
        ],
      }),
    );
    async function approve(revision: number) {
      const submitted = await submitApproval(c, request.id, {
        expectedRevision: revision,
      });
      await decideProposal(c, submitted.approval.proposalId, {
        decision: "APPROVE",
        reason: "Синтетическая проверка",
        expectedProposalHash: submitted.approval.proposalHash,
      });
      return submitted;
    }
    const first = await approve(request.revision);
    const firstDetail = await approvalDetail(c, first.approval.proposalId);
    assert.equal(firstDetail.issuance, null);
    const current = await requestDetail(c, request.id);
    const changed = draftSchema.parse(current.draft);
    changed.items[0].fullNameRu = "Синтетический Получатель — исправлено";
    const saved = await patchRequest(c, request.id, {
      expectedRevision: current.revision,
      draft: changed,
    });
    const second = await approve(saved.revision);
    const assignments = second.approval.assignments;
    const oldSelection = {
      expectedRevision: second.revision,
      assignments,
      expectedProposalId: first.approval.proposalId,
    };
    await assert.rejects(
      finalize(c, request.id, oldSelection, randomUUID()),
      /согласованы директором/,
    );
    assert.equal(
      await db.issuance.count({
        where: { tenantId: c.tenantId, requestId: request.id },
      }),
      0,
    );
    assert.equal(
      (
        await requireApproved(
          c,
          request.id,
          second.revision,
          db,
          assignments,
          second.approval.proposalId,
        )
      ).id,
      second.approval.proposalId,
    );

    // Read-only cabinet mapping must not pick the newest workflow of a request.
    const currentSelection = {
      ...oldSelection,
      expectedProposalId: second.approval.proposalId,
    };
    const result = (await finalize(
      c,
      request.id,
      currentSelection,
      randomUUID(),
    )) as { issuanceId: string };
    assert.equal(
      (await approvalDetail(c, first.approval.proposalId)).issuance,
      null,
    );
    assert.equal(
      (await approvalDetail(c, second.approval.proposalId)).issuance?.id,
      result.issuanceId,
    );
    await assert.rejects(
      finalize(c, request.id, oldSelection, randomUUID()),
      /другой редакции/,
    );
    const replay = await finalize(
      c,
      request.id,
      currentSelection,
      randomUUID(),
    );
    assert.deepEqual(replay, result);
    await assert.rejects(
      approvalDetail(
        { ...c, tenantId: randomUUID() },
        second.approval.proposalId,
      ),
      /не найдена/,
    );
  } finally {
    await db.$disconnect();
  }
});
