import assert from "node:assert/strict";
import test from "node:test";
import { applyBusinessRules, draftSchema, resolveDraft } from "@demo/contracts";
import {
  completeTrainingTopic,
  topicWouldReplaceInput,
  type TrainingTopic,
} from "../lib/training-topic-autofill";

const topic: TrainingTopic = {
  id: "one",
  origin: "SAVED",
  trainingSubject: "Слесарное дело",
  trainingSubjectKz: "Слесарь ісі",
  psGeneralSubjectRu: "Материалы",
  psGeneralSubjectKz: "Материалдар",
  psSpecialSubjectRu: "Обработка",
  psSpecialSubjectKz: "Өңдеу",
};

test("recognises an exact saved title and fills the group copy, preserving explicit and inherited exceptions", () => {
  const result = completeTrainingTopic(
    {
      psSpecialSubjectRu: "Ручная редакция",
      psSpecialSubjectKz: "",
      psGeneralSubjectRu: "Импорт",
      fieldOrigins: {
        psSpecialSubjectKz: "CLEARED",
        psGeneralSubjectRu: "IMPORTED",
      },
    },
    "ps-protocol",
    " слесарное   ДЕЛО ",
    [topic],
    [{ psGeneralSubjectKz: "Общий перевод" }],
  );
  assert.equal(result.trainingSubject, " слесарное   ДЕЛО ");
  assert.equal(result.trainingSubjectKz, topic.trainingSubjectKz);
  assert.equal(result.fieldOrigins?.trainingSubjectKz, "AUTO");
  assert.equal(result.psSpecialSubjectRu, "Ручная редакция");
  assert.equal(result.psSpecialSubjectKz, "");
  assert.equal(result.psGeneralSubjectRu, "Импорт");
  assert.equal(result.psGeneralSubjectKz, undefined);
});

test("ambiguous variants cannot overwrite data, changing or clearing the name removes only earlier completion", () => {
  const complete = completeTrainingTopic(
    {},
    "ps-protocol",
    "Слесарное дело",
    [topic],
    [],
  );
  const alternatives = [
    topic,
    {
      ...topic,
      trainingSubjectKz: "Второй вариант",
      psSpecialSubjectRu: undefined,
    },
  ];
  const mixed = completeTrainingTopic(
    complete,
    "ps-protocol",
    "Слесарное дело",
    alternatives,
    [],
  );
  assert.equal(mixed.trainingSubjectKz, undefined);
  assert.equal(mixed.psSpecialSubjectRu, undefined);
  assert.equal(mixed.psGeneralSubjectKz, "Материалдар");
  const cleared = completeTrainingTopic(
    {
      ...mixed,
      psGeneralSubjectRu: "Другая",
      fieldOrigins: { ...mixed.fieldOrigins, psGeneralSubjectRu: "MANUAL" },
    },
    "ps-protocol",
    "",
    alternatives,
    [],
  );
  assert.equal(cleared.psGeneralSubjectRu, "Другая");
  assert.equal(cleared.psGeneralSubjectKz, undefined);
  assert.equal(cleared.fieldOrigins?.trainingSubject, "CLEARED");
  assert.equal(
    completeTrainingTopic({}, "ps-protocol", "Слес", alternatives, [])
      .trainingSubjectKz,
    undefined,
  );
});

test("choosing a catalogue programme immediately fills new courses and reviews overwriting existing values", () => {
  assert.equal(
    topicWouldReplaceInput(topic, "ps-protocol", [
      { trainingSubject: "ПС", fieldOrigins: { trainingSubject: "COURSE" } },
    ]),
    false,
  );
  assert.equal(
    topicWouldReplaceInput(topic, "ps-protocol", [
      { trainingSubject: "Старое название" },
    ]),
    true,
  );
  assert.equal(
    topicWouldReplaceInput(topic, "ps-protocol", [
      {
        psGeneralSubjectRu: "",
        fieldOrigins: { psGeneralSubjectRu: "CLEARED" },
      },
    ]),
    true,
  );
  assert.equal(
    topicWouldReplaceInput(topic, "pb-protocol", [
      { psGeneralSubjectRu: "Другой курс" },
    ]),
    false,
  );
  assert.equal(
    completeTrainingTopic(
      {},
      "ptm-protocol",
      topic.trainingSubject!,
      [topic],
      [],
    ).psGeneralSubjectRu,
    undefined,
  );
});

test("saving and resolving a PS group carries the known subjects into the print data and preserves the individual exception", () => {
  const commonFields = completeTrainingTopic(
    {},
    "ps-protocol",
    topic.trainingSubject!,
    [topic],
    [],
  );
  const draft = draftSchema.parse({
    kind: "COMPANY",
    businessRuleVersion: "LIVE_V1",
    schemaVersion: 2,
    events: [
      {
        id: "event1",
        title: "Курс",
        protocolTemplateId: "ps-protocol",
        protocolMode: "GROUP",
        commonFields,
      },
    ],
    items: [
      {
        id: "person1",
        employeeCategory: "WORKER",
        assignments: [
          {
            id: "doc1",
            templateId: "ps-card",
            eventId: "event1",
            protocolMode: "GROUP",
            psSpecialSubjectKz: "Ручная дисциплина",
            fieldOrigins: { psSpecialSubjectKz: "IMPORTED" },
          },
        ],
      },
    ],
  });
  const resolved = resolveDraft(applyBusinessRules(draft));
  const copy = resolved.draft.items[0].assignments.find(
    (a) => a.id === "doc1",
  )!;
  assert.equal(copy.psGeneralSubjectKz, topic.psGeneralSubjectKz);
  assert.equal(copy.trainingSubjectKz, topic.trainingSubjectKz);
  assert.equal(copy.psSpecialSubjectKz, "Ручная дисциплина");
  assert.equal(
    resolved.draft.events![0].commonFields.psSpecialSubjectKz,
    topic.psSpecialSubjectKz,
  );
});
