import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { db, hash, type Context } from "../../apps/api/src/core";
import { provision } from "../../scripts/setup";
import { saveProfile, saveUser } from "../../apps/api/src/settings";
import { saveSignatory } from "../../apps/api/src/signing";
import {
  createRequest,
  finalize,
  correction,
  requestDetail,
} from "../../apps/api/src/requests";
import { draftSchema } from "../../packages/contracts/src";
import { assertTestDatabase } from "./test-database";
import { createApprovalFixture } from "./live-approval-fixture";

test("named commissions are pinned per distinct event across credentials/protocol, correction gets new events and old snapshots persist", async (t) => {
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
  const approvals = await createApprovalFixture(c);
  t.after(() => approvals.close());
  try {
    const source = await db.issuerProfileVersion.findFirstOrThrow({
      where: { tenantId: c.tenantId },
    });
    const versions = await Promise.all(
      ["Первая комиссия ПБ", "Вторая комиссия ПБ"].map((title) =>
        saveProfile(c, {
          ...(source.profile as object),
          commissionTitle: title,
          commission: Array.from({ length: 3 }, (_, index) => ({
            name: `${title} ${index}`,
            position: index ? "Член комиссии" : "Председатель",
          })),
        }),
      ),
    );
    for (const version of versions) {
      const profile = version.profile as {
        commission: { name: string; position: string }[];
      };
      for (const [index, member] of profile.commission.entries()) {
        const user = await saveUser(c, {
          email: `event-signer-${randomUUID()}@example.test`,
          password: "Synthetic-event-signer!",
          displayName: member.name,
          role: "OPERATOR",
        });
        await saveSignatory(c, {
          userId: user.id,
          displayName: member.name,
          role: index ? "MEMBER" : "CHAIR",
          iin: `00000000000${index + 2}`,
        });
      }
    }
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
    await approvals.approve(request.id);
    await finalize(
      c,
      request.id,
      { expectedRevision: request.revision },
      randomUUID(),
    );
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
    // The working event may prepare another day's batch; frozen issuances keep
    // their original commission, roster and bytes independently of this record.
    await db.trainingEvent.update({
      where: { id: events[0].id },
      data: { title: "Подготовка следующего состава" },
    });
    assert.equal(
      hash(
        (
          await db.renderInputSnapshot.findMany({
            where: { requestId: request.id, templateVersionId: { not: null } },
          })
        ).map((snapshot) => snapshot.input),
      ),
      before,
    );
    await assert.rejects(
      createRequest(c, draft),
      /событи|заявк/i,
      "A saved request cannot reuse an event identity owned by another request",
    );
    const corrected = await correction(c, request.id, {
      reason: "Синтетическая проверка отдельного исправления",
      expectedRevision: (
        await db.printRequest.findUniqueOrThrow({ where: { id: request.id } })
      ).revision,
    });
    const copied = draftSchema.parse(
      (await requestDetail(c, corrected.id)).draft,
    );
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
