import test from "node:test";
import assert from "node:assert/strict";
import {
  draftSchema,
  resolveDraft,
  documentPlan,
  commonFieldsSchema,
  resolveRecipientText,
} from "../packages/contracts/src";

test("one supplied spelling resolves both print languages without changing the raw draft or inventing English", () => {
  const draft = draftSchema.parse({
    kind: "PERSON",
    items: [
      {
        id: "one",
        fullNameRu: "Тестов Оператор",
        positionRu: "Инженер",
        workplaceRu: "Тестовая компания",
      },
    ],
  });
  const result = resolveDraft(draft).draft.items[0];
  assert.equal(result.fullNameKz, "Тестов Оператор");
  assert.equal(result.positionKz, "Инженер");
  assert.equal(result.workplaceKz, "Тестовая компания");
  assert.equal(draft.items[0].fullNameKz, "");
  assert.equal(draft.items[0].positionKz, "");
  assert.equal(result.fullNameEn, undefined);
});

test("explicit language spellings stay intact and a supplied Kazakh name can be reused verbatim", () => {
  const item = draftSchema.parse({
    kind: "PERSON",
    items: [
      {
        id: "one",
        fullNameRu: "Тестов",
        fullNameKz: "Тестұлы",
        positionRu: "Рабочий",
        positionKz: "Жұмысшы",
        workplaceRu: "ТОО Тест",
        workplaceKz: "Тест ЖШС",
      },
    ],
  }).items[0];
  assert.deepEqual(resolveRecipientText(item), item);
  assert.equal(
    resolveRecipientText({ ...item, fullNameRu: "" }).fullNameRu,
    "Тестұлы",
  );
});

const fixture = () =>
  draftSchema.parse({
    kind: "PERSON",
    schemaVersion: 2,
    commonFields: {
      documentDate: "2026-09-24",
      trainingSubject: "Программа заявки",
    },
    events: [
      {
        id: "event",
        title: "ПБ",
        protocolTemplateId: "pb-protocol",
        commonFields: { trainingSubject: "Программа события" },
      },
    ],
    items: [
      {
        id: "row",
        fullNameRu: "Тестовый человек",
        assignments: [
          {
            id: "card",
            templateId: "pb-card",
            eventId: "event",
            protocolMode: "GROUP",
            outcome: { status: "PASSED", source: "Подтверждённая ведомость" },
            result: "Сдал",
          },
        ],
      },
    ],
  });

test("inherited BIOT date uses existing category expiry policy, preserving every explicit exception", () => {
  const draft = draftSchema.parse({
    kind: "PERSON",
    schemaVersion: 2,
    commonFields: { documentDate: "2028-02-29" },
    items: [
      {
        id: "row",
        fullNameRu: "Тест",
        assignments: [
          {
            id: "card",
            templateId: "biot-worker-card",
            biotCategory: "WORKER",
          },
        ],
      },
    ],
  });
  const result = resolveDraft(draft);
  assert.equal(result.draft.items[0].assignments[0].validUntil, "2029-02-28");
  assert.equal(result.provenance["row:card"].validUntil, "PRESET");
  assert.equal(result.draft.items[0].assignments[0].result, "");
  assert.equal(result.draft.items[0].assignments[0].trainingStart, "");
  assert.equal(draft.items[0].assignments[0].validUntil, "");
  for (const origin of ["MANUAL", "IMPORTED", "CLEARED"] as const) {
    draft.items[0].assignments[0].fieldOrigins = { validUntil: origin };
    assert.equal(
      resolveDraft(draft).draft.items[0].assignments[0].validUntil,
      "",
    );
  }
  draft.items[0].assignments[0].fieldOrigins = { validUntil: "MANUAL" };
  draft.items[0].assignments[0].validUntil = "2028-12-31";
  assert.equal(
    resolveDraft(draft).draft.items[0].assignments[0].validUntil,
    "2028-12-31",
  );
  draft.items[0].assignments[0].fieldOrigins = {};
  draft.items[0].assignments[0].validUntil = "";
  draft.schemaVersion = undefined;
  assert.equal(
    resolveDraft(draft).draft.items[0].assignments[0].validUntil,
    "",
  );
});

test("common fields resolve with provenance; individual outcomes and raw saved draft remain independent", () => {
  const input = fixture();
  const resolved = resolveDraft(input, { documentDate: "2026-01-01" });
  assert.equal(
    resolved.draft.items[0].assignments[0].documentDate,
    "2026-09-24",
  );
  assert.equal(
    resolved.draft.items[0].assignments[0].trainingSubject,
    "Программа события",
  );
  assert.equal(input.items[0].assignments[0].documentDate, "");
  assert.equal(resolved.provenance["row:card"].trainingSubject, "EVENT");
  assert.equal(resolved.issues.length, 0);
  assert.throws(() => commonFieldsSchema.parse({ result: "Сдал" }));
  assert.throws(() => commonFieldsSchema.parse({ number: "1" }));
});
test("group common override is blocked; explicit clear does not silently inherit; same text preserves manual origin", () => {
  const draft = fixture();
  const a = draft.items[0].assignments[0];
  a.trainingSubject = "Иная программа";
  a.fieldOrigins = { trainingSubject: "MANUAL", documentDate: "CLEARED" };
  const value = resolveDraft(draft);
  assert.equal(value.draft.items[0].assignments[0].documentDate, "");
  assert.equal(value.issues[0].code, "GROUP_COMMON_OVERRIDE");
  a.trainingSubject = "Программа события";
  assert.equal(
    resolveDraft(draft).provenance["row:card"].trainingSubject,
    "MANUAL",
  );
});
test("one group protocol with failed/absent/unknown members and no positive credentials for them", () => {
  const draft = fixture();
  draft.items = Array.from({ length: 4 }, (_, i) => ({
    ...draft.items[0],
    id: `person-${i}`,
    assignments: [
      {
        ...draft.items[0].assignments[0],
        outcome: {
          status: (["PASSED", "FAILED", "ABSENT", "UNKNOWN"] as const)[i],
          source: "Ведомость",
        },
      },
    ],
  }));
  const plan = documentPlan(resolveDraft(draft).draft);
  assert.equal(plan.individuals.length, 1);
  assert.equal(plan.groups.length, 1);
  assert.equal(plan.groups[0].members.length, 4);
  assert.equal(plan.documentCount, 2);
});
