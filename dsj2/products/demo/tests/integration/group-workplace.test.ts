import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { assertTestDatabase } from "./test-database";
import { db, type Context } from "../../apps/api/src/core";
import { provision } from "../../scripts/setup";
import { draftSchema } from "../../packages/contracts/src";
import { createRequest, finalize, preview } from "../../apps/api/src/requests";

test("preview and issuance freeze the same factual mixed-employer heading without changing participant names", async () => {
  assertTestDatabase();
  const who = await provision({
    email: `group-workplace-${randomUUID()}@example.test`,
    password: "Synthetic-Group-Workplace-Only!",
    name: "Синтетическая проверка заголовка",
    sample: true,
  });
  const c: Context = {
    ...who,
    role: "ADMIN",
    sessionId: "test",
    csrfHash: "test",
    correlationId: randomUUID(),
  };
  try {
    const eventId = randomUUID();
    const draft = draftSchema.parse({
      kind: "PERSON",
      schemaVersion: 2,
      demoMode: true,
      events: [
        {
          id: eventId,
          title: "Проверка ПБ",
          protocolTemplateId: "pb-protocol",
          commonFields: {
            documentDate: "2026-09-29",
            protocolDate: "2026-09-28",
            trainingSubject: "Промышленная безопасность",
          },
        },
      ],
      items: [
        ["ТОО «Первый завод»", "«Бірінші зауыт» ЖШС"],
        ["ИП Второй подрядчик", "Екінші мердігер ЖК"],
        ["ТОО «Первый завод»", "«Бірінші зауыт» ЖШС"],
      ].map(([workplaceRu, workplaceKz], index) => ({
        id: `row-${index}`,
        fullNameRu: `Синтетический Слушатель ${index}`,
        workplaceRu,
        workplaceKz,
        assignments: [
          {
            id: `card-${index}`,
            templateId: "pb-card",
            protocolMode: "GROUP",
            eventId,
            result: "Сдал",
            outcome: { status: "PASSED", source: "Синтетическая ведомость" },
          },
        ],
      })),
    });
    const created = await createRequest(c, draft);
    await preview(c, created.id, { expectedRevision: 0 });
    await finalize(c, created.id, { expectedRevision: 0 }, randomUUID());
    const snapshots = await db.renderInputSnapshot.findMany({
      where: { requestId: created.id },
    });
    const groups = snapshots.filter((s) => (s.input as any).groupEvent);
    assert.equal(groups.length, 2);
    const expected = {
      version: 1,
      workplaceRu: "ТОО «Первый завод»; ИП Второй подрядчик",
      workplaceKz: "«Бірінші зауыт» ЖШС; Екінші мердігер ЖК",
    };
    for (const snapshot of groups) {
      const input = snapshot.input as any;
      assert.deepEqual(input.groupHeaderWorkplace, expected);
      assert.deepEqual(
        input.items.map((item: any) => [item.workplaceRu, item.workplaceKz]),
        draft.items.map((item) => [item.workplaceRu, item.workplaceKz]),
      );
    }
    const individual = snapshots.filter(
      (s) => (s.input as any).templateId === "pb-card",
    );
    assert.equal(individual.length, 6);
    assert.ok(individual.every((s) => !(s.input as any).groupHeaderWorkplace));
    await assert.rejects(
      db.renderInputSnapshot.update({
        where: { id: groups.find((s) => s.issuanceId)!.id },
        data: { input: { changed: true } },
      }),
    );
  } finally {
    await db.$disconnect();
  }
});
