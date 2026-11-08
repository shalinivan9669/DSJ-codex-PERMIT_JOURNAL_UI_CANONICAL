import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { db, hash, type Context } from "../../apps/api/src/core";
import { saveProfile } from "../../apps/api/src/settings";
import {
  createRequest,
  patchRequest,
  proposalDataReview,
  requestDetail,
} from "../../apps/api/src/requests";
import { draftSchema, type Draft } from "../../packages/contracts/src";
import { provision } from "../../scripts/setup";
import { assertTestDatabase } from "./test-database";

test("repairing commission settings requires explicit draft adoption and preserves independently pinned event profiles", async () => {
  assertTestDatabase();
  const seeded = await provision({
    email: `commission-repair-${randomUUID()}@example.test`,
    password: "Synthetic-Commission-Repair!",
    name: "Синтетический центр восстановления комиссии",
    sample: true,
  });
  const context: Context = {
    ...seeded,
    role: "DIRECTOR",
    sessionId: "test",
    csrfHash: "test",
    correlationId: randomUUID(),
  };
  try {
    const source = await db.issuerProfileVersion.findFirstOrThrow({
      where: { tenantId: context.tenantId },
      orderBy: { version: "desc" },
    });
    const separate = await saveProfile(context, {
      ...(source.profile as object),
      approved: true,
      commissionTitle: "Отдельная утверждённая комиссия",
      commission: [
        "Другой председатель",
        "Другой первый член",
        "Другой второй член",
      ].map((name) => ({ name, position: "" })),
    });
    const incomplete = await saveProfile(context, {
      ...(source.profile as object),
      approved: true,
      commission: [],
    });
    const previousVersions = hash([separate.profile, incomplete.profile]);
    const facts = {
      documentDate: "2026-11-08",
      protocolDate: "2026-11-08",
      trainingStart: "2026-11-06",
      trainingEnd: "2026-11-08",
      trainingSubject: "Синтетическая программа БиОТ",
      hours: "10",
      productionHours: "16",
      biotCategory: "WORKER" as const,
      biotCheckType: "PERIODIC" as const,
    };
    const events = [
      { id: randomUUID(), title: "Комиссия заявки" },
      {
        id: randomUUID(),
        title: "Закреплённый старый состав",
        profileVersionId: incomplete.id,
      },
      {
        id: randomUUID(),
        title: "Независимая комиссия",
        profileVersionId: separate.id,
      },
    ].map((event) => ({
      ...event,
      protocolTemplateId: "biot-protocol",
      commonFields: facts,
    }));
    const created = await createRequest(
      context,
      draftSchema.parse({
        kind: "PERSON",
        schemaVersion: 2,
        commonFields: facts,
        events,
        items: events.map((event, index) => ({
          id: randomUUID(),
          fullNameRu: `Синтетический участник ${index + 1}`,
          workplaceRu: "Синтетическое предприятие",
          positionRu: "Слесарь",
          assignments: [
            {
              id: randomUUID(),
              templateId: "biot-worker-card",
              protocolMode: "GROUP",
              eventId: event.id,
              ...facts,
              result: "Сдал",
              outcome: { status: "PASSED", source: "AUTO" },
            },
          ],
        })),
      }),
    );
    const original = draftSchema.parse(created.draft);
    assert.equal(original.profileVersionId, incomplete.id);
    const originalItems = hash(original.items);
    const originalEvents = hash(original.events);
    async function commissionIssues(draft: Draft) {
      return (
        await proposalDataReview(context, created.id, draft)
      ).issues.filter((issue) => issue.code === "BIOT_COMMISSION_REQUIRED");
    }
    const initialIssues = await commissionIssues(original);
    assert.ok(initialIssues.some((issue) => issue.eventId === events[0].id));
    assert.ok(initialIssues.some((issue) => issue.eventId === events[1].id));
    assert.ok(!initialIssues.some((issue) => issue.eventId === events[2].id));

    const repaired = await saveProfile(context, {
      ...(source.profile as object),
      approved: true,
      commission: [
        "Новый председатель",
        "Новый первый член",
        "Новый второй член",
      ].map((name) => ({ name, position: "" })),
    });
    const unchanged = await requestDetail(context, created.id);
    assert.equal(
      draftSchema.parse(unchanged.draft).profileVersionId,
      incomplete.id,
    );
    assert.deepEqual(await commissionIssues(original), initialIssues);

    await patchRequest(context, created.id, {
      expectedRevision: unchanged.revision,
      draft: { ...original, profileVersionId: repaired.id },
    });
    const rebound = await requestDetail(context, created.id);
    const reboundDraft = draftSchema.parse(rebound.draft);
    assert.equal(reboundDraft.profileVersionId, repaired.id);
    assert.equal(hash(reboundDraft.items), originalItems);
    assert.equal(hash(reboundDraft.events), originalEvents);
    const remaining = await commissionIssues(reboundDraft);
    assert.ok(remaining.length > 0);
    assert.ok(remaining.every((issue) => issue.eventId === events[1].id));

    await patchRequest(context, created.id, {
      expectedRevision: rebound.revision,
      draft: {
        ...reboundDraft,
        events: reboundDraft.events!.map((event) =>
          event.id === events[1].id
            ? { ...event, profileVersionId: repaired.id }
            : event,
        ),
      },
    });
    const repairedDetail = await requestDetail(context, created.id);
    const repairedDraft = draftSchema.parse(repairedDetail.draft);
    assert.deepEqual(await commissionIssues(repairedDraft), []);
    assert.equal(repairedDraft.events![2].profileVersionId, separate.id);
    assert.equal(hash(repairedDraft.items), originalItems);
    const preserved = await Promise.all(
      [separate.id, incomplete.id].map((id) =>
        db.issuerProfileVersion.findUniqueOrThrow({ where: { id } }),
      ),
    );
    assert.equal(
      hash(preserved.map((version) => version.profile)),
      previousVersions,
    );
    assert.equal(
      await db.numberReservation.count({
        where: { tenantId: context.tenantId },
      }),
      0,
    );
    await assert.rejects(
      patchRequest(context, created.id, {
        expectedRevision: rebound.revision,
        draft: reboundDraft,
      }),
      (error: unknown) => {
        assert.equal(
          (error as { getResponse(): { code: string } }).getResponse().code,
          "REVISION_CONFLICT",
        );
        return true;
      },
    );
  } finally {
    await db.$disconnect();
  }
});
