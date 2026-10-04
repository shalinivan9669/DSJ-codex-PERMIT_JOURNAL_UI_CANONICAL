import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { assertTestDatabase } from "./test-database";
import { db, hash, type Context } from "../../apps/api/src/core";
import { provision } from "../../scripts/setup";
import { draftSchema } from "../../packages/contracts/src";
import { saveCustomer } from "../../apps/api/src/settings";
import {
  createRequest,
  finalize,
  preview,
  patchRequest,
  requestDetail,
  resolvedRequest,
} from "../../apps/api/src/requests";
import { createApprovalFixture } from "./live-approval-fixture";

type RenderInput = {
  templateId?: string;
  groupEvent?: unknown;
  items: {
    id?: string;
    workplaceRu?: string;
    workplaceKz?: string;
    employerBin?: string;
  }[];
};
function status(expected: number) {
  return (error: unknown) =>
    typeof error === "object" &&
    error !== null &&
    "getStatus" in error &&
    (error as { getStatus(): number }).getStatus() === expected;
}

test("structured organization names reach resolved data, group/individual/registry snapshots and preserve previous issuances", async (t) => {
  assertTestDatabase();
  const seeded = await provision({
    email: `organization-${randomUUID()}@example.test`,
    password: "Synthetic-Test-Password!",
    name: "Синтетический центр названий организаций",
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
  const foreign = await db.tenant.create({
    data: { name: "Другой центр организаций", demoOnly: true },
  });
  const foreignOrganization = await db.customerOrganization.create({
    data: { tenantId: foreign.id, nameRu: "Чужая организация" },
  });
  const customer = await saveCustomer(c, {
    legalForm: "TOO",
    ownNameRu: "«Заказчик»",
    ownNameKz: "«Тапсырыс беруші»",
    bin: "000000000011",
  });
  const employer = await saveCustomer(c, {
    legalForm: "IP",
    ownNameRu: "Әділ Қанат",
    nameRu: "Не использовать",
    bin: "000000000022",
  });
  const payer = await saveCustomer(c, {
    legalForm: "AO",
    ownNameRu: "«Плательщик»",
  });
  assert.equal(customer.nameRu, "ТОО «Заказчик»");
  assert.equal(customer.nameKz, "«Тапсырыс беруші» ЖШС");
  assert.equal(employer.nameRu, "ИП Әділ Қанат");
  assert.equal(employer.nameKz, "Әділ Қанат ЖК");
  assert.notEqual(payer.id, employer.id);
  assert.notEqual(customer.id, employer.id);
  const reloaded = await db.customerOrganization.findUniqueOrThrow({
    where: { id: customer.id },
  });
  assert.equal(reloaded.legalForm, "TOO");
  assert.equal(reloaded.ownNameRu, "«Заказчик»");
  const legacy = await saveCustomer(c, {
    nameRu: "ТОО-ЖШС  Исходная строка",
    nameKz: "ИП/ЖК исходное",
  });
  assert.equal(legacy.legalForm, null);
  assert.equal(legacy.nameRu, "ТОО-ЖШС  Исходная строка");
  const updatedLegacy = await saveCustomer(
    c,
    { nameRu: legacy.nameRu, nameKz: legacy.nameKz, addressRu: "Новый адрес" },
    legacy.id,
  );
  assert.equal(updatedLegacy.nameRu, legacy.nameRu);
  assert.equal(updatedLegacy.legalForm, null);
  await assert.rejects(
    saveCustomer(
      c,
      { legalForm: "TOO", ownNameRu: "Подмена" },
      foreignOrganization.id,
    ),
    status(404),
  );

  const eventId = randomUUID();
  const draft = draftSchema.parse({
    kind: "COMPANY",
    customerId: customer.id,
    schemaVersion: 2,
    events: [
      {
        id: eventId,
        title: "Проверка названий ПБ",
        protocolTemplateId: "pb-protocol",
        commonFields: {
          documentDate: "2026-09-25",
          protocolDate: "2026-09-24",
          trainingStart: "2026-09-21",
          trainingEnd: "2026-09-24",
          trainingSubject: "Промышленная безопасность",
        },
      },
    ],
    items: Array.from({ length: 3 }, (_, index) => ({
      id: `organization-row-${index}`,
      fullNameRu: `Проверочный Получатель ${index}`,
      fullNameKz: `Әділ Өмір ${index}`,
      positionRu: "Мастер",
      ...(index > 0 ? { employerId: employer.id } : {}),
      ...(index === 2
        ? {
            workplaceRu: "Импорт: ТОО-ЖШС исходное",
            workplaceKz: "Импорттағы бастапқы жол",
            employerBin: "000000000033",
          }
        : {}),
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
  const badDraft = structuredClone(draft);
  badDraft.items[0].employerId = foreignOrganization.id;
  await assert.rejects(createRequest(c, badDraft), status(404));
  const request = await createRequest(c, draft);
  const resolved = await resolvedRequest(c, request.id);
  assert.equal(resolved.draft.items[0].workplaceRu, customer.nameRu);
  assert.equal(resolved.draft.items[1].workplaceRu, employer.nameRu);
  assert.equal(resolved.draft.items[1].employerBin, employer.bin);
  assert.equal(resolved.draft.items[2].workplaceRu, draft.items[2].workplaceRu);
  assert.equal(resolved.draft.items[2].employerBin, "000000000033");
  assert.equal((await requestDetail(c, request.id)).items[1].workplaceRu, "");

  await preview(c, request.id, { expectedRevision: request.revision });
  const beforePreview = await db.renderInputSnapshot.findMany({
    where: { requestId: request.id, issuanceId: null },
  });
  assert.ok(beforePreview.length >= 4);
  const changedEmployer = await saveCustomer(
    c,
    { legalForm: "IP", ownNameRu: "Әділ Өмір", bin: employer.bin },
    employer.id,
  );
  await preview(c, request.id, { expectedRevision: request.revision });
  const frozenPreview = await db.renderInputSnapshot.findMany({
    where: { requestId: request.id, issuanceId: null },
  });
  assert.deepEqual(
    frozenPreview.sort((a, b) => a.id.localeCompare(b.id)),
    beforePreview.sort((a, b) => a.id.localeCompare(b.id)),
    "Changing the organization card does not silently refresh reference values in an existing proposal",
  );
  const refreshed = await patchRequest(c, request.id, {
    expectedRevision: request.revision,
    draft,
  });
  await preview(c, request.id, { expectedRevision: refreshed.revision });
  const afterPreview = await db.renderInputSnapshot.findMany({
    where: { requestId: request.id, issuanceId: null },
  });
  assert.equal(
    afterPreview.length,
    beforePreview.length * 2,
    "An explicitly saved proposal freezes the changed organization and gets fresh preview snapshots",
  );
  assert.deepEqual(
    afterPreview
      .filter((snapshot) => beforePreview.some((old) => old.id === snapshot.id))
      .sort((a, b) => a.id.localeCompare(b.id)),
    beforePreview.sort((a, b) => a.id.localeCompare(b.id)),
  );

  await approvals.approve(request.id);
  await finalize(
    c,
    request.id,
    { expectedRevision: refreshed.revision },
    randomUUID(),
  );
  const issued = await db.renderInputSnapshot.findMany({
    where: { requestId: request.id, issuanceId: { not: null } },
    orderBy: { id: "asc" },
  });
  assert.equal(
    issued.length,
    5,
    "Three individuals, one shared protocol, one registry aggregate",
  );
  for (const snapshot of issued) {
    assert.equal(snapshot.inputHash, hash(snapshot.input));
    const input = snapshot.input as unknown as RenderInput;
    for (const row of input.items.filter((item) => item.workplaceRu)) {
      if (row.id === "organization-row-0") {
        assert.equal(row.workplaceRu, customer.nameRu);
        assert.equal(row.workplaceKz, customer.nameKz);
      } else if (row.id === "organization-row-1") {
        assert.equal(row.workplaceRu, changedEmployer.nameRu);
        assert.equal(row.workplaceKz, changedEmployer.nameKz);
        assert.equal(row.employerBin, employer.bin);
      } else if (row.id === "organization-row-2") {
        assert.equal(row.workplaceRu, draft.items[2].workplaceRu);
        assert.equal(row.workplaceKz, draft.items[2].workplaceKz);
      }
    }
    if (input.groupEvent) assert.equal(input.items.length, 3);
  }
  const issuance = await db.issuance.findFirstOrThrow({
    where: { requestId: request.id },
  });
  const issuanceBefore = hash(issuance.snapshot);
  await saveCustomer(
    c,
    { legalForm: "TOO", ownNameRu: "Изменено после выдачи" },
    customer.id,
  );
  await saveCustomer(
    c,
    { legalForm: "IP", ownNameRu: "Новое имя после выдачи" },
    employer.id,
  );
  assert.equal(
    hash(
      (await db.issuance.findUniqueOrThrow({ where: { id: issuance.id } }))
        .snapshot,
    ),
    issuanceBefore,
  );
  assert.deepEqual(
    await db.renderInputSnapshot.findMany({
      where: { id: { in: issued.map((snapshot) => snapshot.id) } },
      orderBy: { id: "asc" },
    }),
    issued,
  );
  assert.equal(
    (
      await db.customerOrganization.findUniqueOrThrow({
        where: { id: payer.id },
      })
    ).nameRu,
    payer.nameRu,
  );
  // An older client editing a complete string explicitly returns to legacy mode.
  const legacyEdit = await saveCustomer(
    c,
    { nameRu: "Свободная строка ИП", nameKz: "Бастапқы жол" },
    employer.id,
  );
  assert.equal(legacyEdit.legalForm, null);
  assert.equal(legacyEdit.ownNameRu, null);
}).finally(() => db.$disconnect());
