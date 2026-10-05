import test from "node:test";
import assert from "node:assert/strict";
import {
  applyBusinessRules,
  draftSchema,
  hasEnglishDraftValues,
  normalizeNewDraftLanguages,
  resolveDraft,
} from "../packages/contracts/src";

function historicalDraft() {
  return draftSchema.parse({
    kind: "PERSON",
    schemaVersion: 2,
    englishAppendix: true,
    commonFields: {
      documentDate: "2026-10-05",
      trainingSubjectEn: "Historical program",
      fieldOrigins: { trainingSubjectEn: "IMPORTED" },
    },
    presetFields: { reasonEn: "Historical reason" },
    events: [
      {
        id: "old-event",
        title: "ПТМ",
        protocolTemplateId: "ptm-protocol",
        commonFields: { educationEn: "Historical education" },
        lineageContext: JSON.stringify({
          commonFields: {
            trainingSubject: "Программа",
            trainingSubjectEn: "Historical program",
          },
        }),
      },
    ],
    items: [
      {
        id: "old-person",
        fullNameRu: "Тестовый Получатель",
        fullNameKz: "Тест Алушы",
        fullNameEn: "Historical Person",
        positionEn: "Historical role",
        assignments: [
          {
            id: "old-card",
            templateId: "ptm-card",
            eventId: "old-event",
            trainingSubject: "ПТМ",
            trainingSubjectKz: "ӨТМ",
            trainingSubjectEn: "Historical course",
            result: "Прошел",
            resultKz: "Өтті",
            resultEn: "Passed",
            fieldOrigins: { resultEn: "IMPORTED", trainingSubjectEn: "MANUAL" },
            outcome: { status: "PASSED", source: "Сохранённый исход" },
          },
        ],
      },
    ],
  });
}

test("all new working values are RU/KZ while old source JSON remains byte-for-byte unchanged", () => {
  const historical = historicalDraft();
  const original = JSON.stringify(historical);
  const next = applyBusinessRules(historical);
  assert.equal(JSON.stringify(historical), original);
  assert.equal(next.languagePolicy, "RU_KZ");
  assert.equal(next.englishAppendix, false);
  assert.equal(hasEnglishDraftValues(next), false);
  assert.equal(next.items[0].fullNameRu, historical.items[0].fullNameRu);
  assert.equal(next.items[0].fullNameKz, historical.items[0].fullNameKz);
  assert.equal(
    next.items[0].assignments[0].outcome?.source,
    "Сохранённый исход",
  );
  assert.equal(
    next.events![0].lineageContext?.includes("trainingSubjectEn"),
    false,
  );
  const reloaded = draftSchema.parse(JSON.parse(JSON.stringify(next)));
  assert.equal(hasEnglishDraftValues(reloaded), false);
  assert.equal(reloaded.languagePolicy, "RU_KZ");
});

test("new resolver cannot reintroduce English from an existing centre profile or provenance", () => {
  const next = applyBusinessRules(historicalDraft());
  const resolved = resolveDraft(next, {
    trainingSubject: "Программа центра",
    trainingSubjectEn: "Old centre program",
    reasonEn: "Old centre reason",
  });
  assert.equal(hasEnglishDraftValues(resolved.draft), false);
  assert.equal(hasEnglishDraftValues(resolved.provenance), false);
  assert.equal(resolved.draft.englishAppendix, false);
  assert.equal(resolved.draft.items[0].assignments[0].trainingSubject, "ПТМ");
});

test("viewing historical English fields does not convert their language policy or mutate their data", () => {
  const historical = historicalDraft();
  const original = JSON.stringify(historical);
  const read = resolveDraft(historical).draft;
  assert.equal(read.englishAppendix, true);
  assert.equal(read.items[0].fullNameEn, "Historical Person");
  assert.equal(read.items[0].assignments[0].resultEn, "Passed");
  assert.equal(JSON.stringify(historical), original);
  assert.equal(hasEnglishDraftValues(read), true);
});

test("an explicit new edit clears an old freeze instead of silently rewriting its frozen data", () => {
  const historical = historicalDraft();
  const frozen = {
    ...historical,
    frozenResolution: {
      version: 1 as const,
      resolvedAt: "2026-10-05T00:00:00.000Z",
      draft: historical,
      provenance: { "old-person:old-card": { resultEn: "IMPORTED" as const } },
    },
  };
  const original = JSON.stringify(frozen);
  const next = normalizeNewDraftLanguages(frozen);
  assert.equal(next.frozenResolution, undefined);
  assert.equal(hasEnglishDraftValues(next), false);
  assert.equal(JSON.stringify(frozen), original);
});
