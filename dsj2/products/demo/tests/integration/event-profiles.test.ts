import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { db, hash, type Context } from "../../apps/api/src/core";
import { provision } from "../../scripts/setup";
import { saveProfile } from "../../apps/api/src/settings";
import {
  createRequest,
  finalize,
  correction,
} from "../../apps/api/src/requests";
import { draftSchema } from "../../packages/contracts/src";
import { assertTestDatabase } from "./test-database";

test("named commissions are pinned per distinct event across credentials/protocol, correction gets new events and old snapshots persist", async () => {
  assertTestDatabase();
  const seeded = await provision({
    email: `profiles-${randomUUID()}@example.test`,
    password: "Synthetic-Profile-Password!",
    name: "Синтетический центр комиссий",
    sample: true,
  });
  const c: Context = {
    ...seeded,
    role: "ADMIN",
    sessionId: "test",
    csrfHash: "test",
    correlationId: randomUUID(),
  };
  try {
    const source = await db.issuerProfileVersion.findFirstOrThrow({
      where: { tenantId: c.tenantId },
    });
    const versions = await Promise.all(
      ["Первая комиссия ПБ", "Вторая комиссия ПБ"].map((title) =>
        saveProfile(c, {
          ...(source.profile as object),
          commissionTitle: title,
          commission: [{ name: title, position: "Председатель" }],
        }),
      ),
    );
    const events = versions.map((p, i) => ({
      id: randomUUID(),
      title: "Одинаковое название " + i,
      profileVersionId: p.id,
      protocolTemplateId: "pb-protocol",
      commonFields: {
        documentDate: "2026-09-24",
        protocolDate: "2026-09-24",
        trainingSubject: "Синтетическая программа",
        trainingStart: "2026-09-23",
        trainingEnd: "2026-09-24",
      },
    }));
    const draft = draftSchema.parse({
      kind: "PERSON",
      schemaVersion: 2,
      events,
      items: events.map((event, i) => ({
        id: "row" + i,
        fullNameRu: "Синтетический участник " + i,
        positionRu: "Инженер",
        assignments: [
          {
            id: "assignment" + i,
            templateId: "pb-card",
            protocolMode: "GROUP",
            eventId: event.id,
            result: "Сдал",
            outcome: { status: "PASSED", source: "Тестовая ведомость" },
          },
        ],
      })),
    });
    const request = await createRequest(c, draft);
    await finalize(c, request.id, { expectedRevision: 0 }, randomUUID());
    const docs = await db.issuedDocument.findMany({
      where: { requestId: request.id },
    });
    assert.equal(docs.filter((d) => d.ownerKind === "GROUP").length, 2);
    const snapshots = await db.renderInputSnapshot.findMany({
      where: { requestId: request.id, templateVersionId: { not: null } },
    });
    assert.equal(snapshots.length, 4);
    const before = hash(snapshots.map((s) => s.input));
    for (const snapshot of snapshots) {
      const data = snapshot.input as any;
      const eventId = data.groupEvent?.id || data.items[0].assignment.eventId;
      const index = events.findIndex((e) => e.id === eventId);
      assert.ok(index >= 0);
      assert.equal(
        data.issuer.commissionTitle,
        (versions[index].profile as any).commissionTitle,
      );
      assert.equal(
        data.issuer.commission[0].name,
        (versions[index].profile as any).commission[0].name,
      );
    }
    await saveProfile(c, {
      ...(source.profile as object),
      commissionTitle: "Новая версия после выдачи",
      commission: [{ name: "Другой председатель", position: "Председатель" }],
    });
    assert.equal(
      hash(
        (
          await db.renderInputSnapshot.findMany({
            where: { requestId: request.id, templateVersionId: { not: null } },
          })
        ).map((s) => s.input),
      ),
      before,
    );
    await assert.rejects(
      db.trainingEvent.update({
        where: { id: events[0].id },
        data: { title: "Нельзя менять выданное событие" },
      }),
    );
    await assert.rejects(createRequest(c, draft));
    const corrected = await correction(c, request.id, {
      reason: "Синтетическая проверка отдельного исправления",
      expectedRevision: (
        await db.printRequest.findUniqueOrThrow({ where: { id: request.id } })
      ).revision,
    });
    const copy = await db.printRequest.findUniqueOrThrow({
      where: { id: corrected.id },
    });
    const copied = draftSchema.parse(copy.draft);
    assert.equal(copied.events?.length, 2);
    assert.ok(
      copied.events!.every((e) => !events.some((old) => old.id === e.id)),
    );
    assert.equal(
      await db.numberReservation.count({ where: { tenantId: c.tenantId } }),
      4,
    );
  } finally {
    await db.$disconnect();
  }
});
