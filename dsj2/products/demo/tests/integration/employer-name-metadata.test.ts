import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { draftSchema, itemSchema } from "@demo/contracts";
import { db, type Context } from "../../apps/api/src/core";
import {
  createRequest,
  patchRequest,
  requestDetail,
} from "../../apps/api/src/requests";
import { recipientDetail, saveRecipient } from "../../apps/api/src/recipients";
import { provision } from "../../scripts/setup";
import { assertTestDatabase } from "./test-database";

test("explicit employer naming round-trips through request autosave and recipient JSON while manual names stay authoritative", async (t) => {
  assertTestDatabase();
  const center = await provision({
    email: `employer-naming-${randomUUID()}@example.test`,
    password: "Synthetic-employer-naming-password!",
    name: "Синтетический центр названий работодателя",
    sample: false,
  });
  const c: Context = {
    ...center,
    role: "DIRECTOR",
    sessionId: "test",
    csrfHash: "test",
    correlationId: randomUUID(),
  };
  t.after(() => db.$disconnect());
  const legacy = draftSchema.parse({
    kind: "PERSON",
    items: [
      {
        id: "person",
        fullNameRu: "Синтетический Получатель",
        workplaceRu: "Импорт ИП/ЖК",
        workplaceKz: "Бастапқы жол",
      },
    ],
  });
  const created = await createRequest(c, legacy);
  assert.equal(
    "workplaceNaming" in (await requestDetail(c, created.id)).items[0],
    false,
  );
  const naming = {
    version: 1 as const,
    legalForm: "IP" as const,
    ownNameRu: "Северный сервис",
    ownNameKz: "Солтүстік қызмет",
  };
  const draft = draftSchema.parse(legacy);
  draft.items[0] = {
    ...draft.items[0],
    workplaceRu: "ИП Северный сервис",
    workplaceKz: "Солтүстік қызмет ЖК",
    employerBin: "000000000099",
    workplaceNaming: naming,
  };
  const saved = await patchRequest(c, created.id, {
    expectedRevision: created.revision,
    draft,
  });
  const reloaded = await requestDetail(c, created.id);
  assert.deepEqual(reloaded.items[0].workplaceNaming, naming);
  assert.equal(reloaded.items[0].workplaceRu, "ИП Северный сервис");
  assert.equal(reloaded.items[0].workplaceKz, "Солтүстік қызмет ЖК");
  const recipient = await saveRecipient(c, draft.items[0]);
  assert.deepEqual(
    itemSchema.parse((await recipientDetail(c, recipient.id)).data)
      .workplaceNaming,
    naming,
  );
  draft.items[0] = {
    ...draft.items[0],
    workplaceRu: "Ручное название",
    workplaceKz: "",
  };
  await patchRequest(c, created.id, {
    expectedRevision: saved.revision,
    draft,
  });
  const manuallyChanged = (await requestDetail(c, created.id)).items[0];
  assert.equal(manuallyChanged.workplaceRu, "Ручное название");
  assert.equal(manuallyChanged.workplaceKz, "");
  assert.equal(manuallyChanged.employerBin, "000000000099");
  assert.deepEqual(
    manuallyChanged.workplaceNaming,
    naming,
    "metadata is an inert hint after an independent manual edit",
  );
  await saveRecipient(c, manuallyChanged, recipient.id);
  const savedManual = itemSchema.parse(
    (await recipientDetail(c, recipient.id)).data,
  );
  assert.equal(savedManual.workplaceRu, "Ручное название");
  assert.equal(savedManual.workplaceKz, "");
  assert.deepEqual(savedManual.workplaceNaming, naming);
});
