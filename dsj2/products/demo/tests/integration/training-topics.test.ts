import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { assertTestDatabase } from "./test-database";
import { db, json, type Context } from "../../apps/api/src/core";
import { trainingTopics } from "../../apps/api/src/training-topics";
import { newAssignment, newRecipient } from "../../apps/web/lib/types";
import {
  draftSchema,
  courseProgramDefaults,
} from "../../packages/contracts/src";

test("saved course topics are persisted, deduplicated and tenant/category scoped; no old facts transfer", async (t) => {
  assertTestDatabase();
  t.after(() => db.$disconnect());
  const own = await db.tenant.create({
    data: { name: "Синтетические темы своего центра", demoOnly: true },
  });
  const foreign = await db.tenant.create({
    data: { name: "Синтетические темы чужого центра", demoOnly: true },
  });
  const c: Context = {
    tenantId: own.id,
    userId: randomUUID(),
    role: "OPERATOR",
    correlationId: randomUUID(),
    csrfHash: "test",
    sessionId: "test",
  };
  for (const [tenantId, templateId, subject] of [
    [own.id, "ptm-card", "Пользовательская тема ПТМ"],
    [own.id, "ptm-card", "Пользовательская тема ПТМ"],
    [own.id, "pb-card", "Другая программа ПБ"],
    [own.id, "biot-worker-card", "Тема рабочего"],
    [own.id, "biot-itr-certificate", "Тема ИТР"],
    [foreign.id, "ptm-card", "НЕ ВЫДАВАТЬ ЧУЖУЮ ТЕМУ"],
  ] as const) {
    const payload = draftSchema.parse({
      kind: "PERSON",
      items: [
        {
          ...newRecipient(),
          employeeCategory: templateId.startsWith("biot-itr")
            ? "ITR"
            : "WORKER",
          assignments: [
            {
              ...newAssignment(templateId),
              trainingSubject: subject,
              trainingSubjectKz: "Сақталған тақырып",
              documentDate: "2026-10-01",
              result: "Закрытая оценка 93",
              externalBasisNumber: "НЕ ПЕРЕНОСИТЬ-777",
              outcome: { status: "PASSED", source: "НЕ ПЕРЕНОСИТЬ ИСТОЧНИК" },
              fieldOrigins: {
                trainingSubject: "MANUAL",
                trainingSubjectKz: "MANUAL",
              },
            },
          ],
        },
      ],
    });
    await db.printRequest.create({
      data: {
        tenantId,
        createdBy: c.userId,
        kind: "PERSON",
        demoMode: true,
        draft: json(payload),
      },
    });
  }
  for (const optionalFields of [
    {},
    { trainingSubjectKz: "", psGeneralSubjectRu: "  " },
  ]) {
    const payload = draftSchema.parse({
      kind: "PERSON",
      items: [
        {
          ...newRecipient(),
          assignments: [
            {
              ...newAssignment("pb-card"),
              trainingSubject: "Одна тема с отсутствующим или пустым KZ",
              ...optionalFields,
              fieldOrigins: { trainingSubject: "MANUAL" },
            },
          ],
        },
      ],
    });
    await db.printRequest.create({
      data: {
        tenantId: own.id,
        createdBy: c.userId,
        kind: "PERSON",
        demoMode: true,
        draft: json(payload),
      },
    });
  }
  const result = await trainingTopics(c, { direction: "PTM" });
  assert.equal(
    result.items.filter(
      (topic) => topic.trainingSubject === "Пользовательская тема ПТМ",
    ).length,
    1,
  );
  assert.deepEqual(
    result.items[0].trainingSubject,
    courseProgramDefaults("ptm-card").trainingSubject,
  );
  const chosen = result.items.find((topic) => topic.origin === "SAVED")!;
  assert.equal(chosen.trainingSubjectKz, "Сақталған тақырып");
  for (const topic of result.items)
    assert.ok(
      Object.keys(topic).every((key) =>
        [
          "id",
          "origin",
          "trainingSubject",
          "trainingSubjectKz",
          "psGeneralSubjectRu",
          "psGeneralSubjectKz",
          "psSpecialSubjectRu",
          "psSpecialSubjectKz",
        ].includes(key),
      ),
    );
  assert.ok(!JSON.stringify(result).includes("НЕ ПЕРЕНОСИТЬ"));
  assert.ok(!JSON.stringify(result).includes("НЕ ВЫДАВАТЬ"));
  assert.ok(!JSON.stringify(result).includes("Другая программа ПБ"));
  const worker = await trainingTopics(c, {
    direction: "BIOT",
    category: "WORKER",
  });
  assert.ok(
    worker.items.some((topic) => topic.trainingSubject === "Тема рабочего"),
  );
  assert.ok(
    !worker.items.some((topic) => topic.trainingSubject === "Тема ИТР"),
  );
  const itr = await trainingTopics(c, { direction: "BIOT", category: "ITR" });
  assert.ok(itr.items.some((topic) => topic.trainingSubject === "Тема ИТР"));
  assert.ok(
    !itr.items.some((topic) => topic.trainingSubject === "Тема рабочего"),
  );
  const pb = await trainingTopics(c, { direction: "PB" });
  assert.equal(
    pb.items.filter(
      (topic) =>
        topic.trainingSubject === "Одна тема с отсутствующим или пустым KZ",
    ).length,
    1,
  );
  for (const role of ["EMPLOYER", "VIEWER"])
    await assert.rejects(trainingTopics({ ...c, role }, { direction: "PTM" }));
  await assert.rejects(
    trainingTopics(c, { direction: "PTM", tenantId: foreign.id }),
  );
});
