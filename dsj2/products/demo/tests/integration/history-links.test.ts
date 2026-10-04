import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { provision } from "../../scripts/setup";
import { db, type Context } from "../../apps/api/src/core";
import {
  createRequest,
  correction,
  finalize,
  requestDetail,
} from "../../apps/api/src/requests";
import { assertTestDatabase } from "./test-database";
import { createApprovalFixture } from "./live-approval-fixture";

test("history readback links corrected and original requests within tenant, preserves snapshot and refuses foreign link targets", async (t) => {
  assertTestDatabase();
  try {
    async function center() {
      const user = await provision({
        email: `history-links-${randomUUID()}@example.test`,
        password: "Synthetic-history-links-password!",
        name: "History links test",
        sample: true,
      });
      const context = {
        ...user,
        role: "ADMIN",
        sessionId: "test",
        csrfHash: "test",
        correlationId: randomUUID(),
      } as Context;
      const approvals = await createApprovalFixture(context);
      t.after(() => approvals.close());
      return { context, approvals };
    }
    async function original(centerFixture: Awaited<ReturnType<typeof center>>) {
      const c = centerFixture.context;
      const request = await createRequest(c, {
        kind: "PERSON",
        demoMode: true,
        title: "History original",
        items: [
          {
            id: "person",
            fullNameRu: "Синтетический Получатель",
            fullNameKz: "Синтетикалық Тыңдаушы",
            positionRu: "Инженер",
            workplaceRu: "Тестовый центр",
            assignments: [
              {
                id: "assignment",
                templateId: "pb-card",
                protocolMode: "EXTERNAL_REFERENCE",
                externalBasisNumber: "TEST-HISTORY-001",
                documentDate: "2026-09-24",
                protocolDate: "2026-09-24",
                trainingSubject: "Синтетическая программа",
                result: "Сдал",
                outcome: {
                  status: "PASSED",
                  source: "Синтетическая ведомость",
                },
              },
            ],
          },
        ],
      });
      await centerFixture.approvals.approve(request.id);
      await finalize(
        c,
        request.id,
        { expectedRevision: request.revision },
        randomUUID(),
      );
      return requestDetail(c, request.id);
    }
    const ownCenter = await center();
    const own = ownCenter.context;
    const source = await original(ownCenter);
    const cause = "Синтетическое согласованное исправление";
    const changed = await correction(own, source.id, {
      expectedRevision: source.revision,
      reason: cause,
    });
    await ownCenter.approvals.approve(changed.id);
    await finalize(
      own,
      changed.id,
      { expectedRevision: changed.revision },
      randomUUID(),
    );
    const current = await requestDetail(own, changed.id);
    const old = await requestDetail(own, source.id);
    assert.equal(current.issuances[0].correctsRequestId, source.id);
    assert.equal(current.issuances[0].correctionReason, cause);
    assert.equal(
      old.issuanceEvents.filter((event) => event.kind === "REPLACED").length,
      0,
      "A generated correction does not replace the original before mandatory signatures",
    );
    assert.deepEqual(old.issuances[0].snapshot, source.issuances[0].snapshot);
    assert.deepEqual(old.documents, source.documents);
    const foreignCenter = await center();
    const foreign = foreignCenter.context;
    const foreignOriginal = await original(foreignCenter);
    await assert.rejects(requestDetail(foreign, source.id), /не найдена/);
    await assert.rejects(
      db.issuance.update({
        where: { id: current.issuances[0].id },
        data: { correctsIssuanceId: foreignOriginal.issuances[0].id },
      }),
      /DEMO_IMMUTABLE/,
    );
    await assert.rejects(
      db.issuanceEvent.create({
        data: {
          tenantId: own.tenantId,
          issuanceId: source.issuances[0].id,
          actorId: own.userId,
          kind: "REPLACED",
          reason: "Synthetic invalid historical reference",
          relatedIssuanceId: foreignOriginal.issuances[0].id,
        },
      }),
      /event_related_fk/,
    );
    assert.equal(
      (await requestDetail(own, current.id)).issuances[0].correctsRequestId,
      source.id,
    );
    const invalidEvent = (
      await requestDetail(own, source.id)
    ).issuanceEvents.find(
      (event) => event.relatedIssuanceId === foreignOriginal.issuances[0].id,
    );
    assert.equal(invalidEvent, undefined);
  } finally {
    await db.$disconnect();
  }
});
