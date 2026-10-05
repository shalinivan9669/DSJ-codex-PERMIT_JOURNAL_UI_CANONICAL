import test from "node:test";
import assert from "node:assert/strict";
import {
  applyBusinessRules,
  draftSchema,
  trainingEventContext,
} from "@demo/contracts";
import { prepareConflictCopy } from "../lib/conflict-copy";
import {
  draftPayload,
  newAssignment,
  newRecipient,
  type Draft,
} from "../lib/types";

function source(): Draft {
  return {
    id: "source",
    revision: 7,
    status: "DRAFT",
    kind: "COMPANY",
    title: "Ручной ввод",
    customerId: "customer",
    demoMode: true,
    events: [
      {
        id: "root",
        title: "Рабочие",
        protocolTemplateId: "biot-protocol",
        revision: 4,
        commonFields: {
          trainingSubject: "Сохранённая программа",
          fieldOrigins: { trainingSubject: "IMPORTED" },
        },
      },
      {
        id: "derived",
        rootEventId: "root",
        title: "ИТР",
        protocolTemplateId: "biot-itr-protocol",
        revision: 2,
        derivedCategory: "ITR",
        lineageContext: "saved lineage",
        lineageOwnContext: "saved own context",
        commonFields: {
          trainingSubject: "Личная программа",
          fieldOrigins: { trainingSubject: "MANUAL" },
        },
      },
    ],
    trainingDefaults: [{ direction: "BIOT", eventIds: ["root", "derived"] }],
    items: [
      {
        ...newRecipient(),
        id: "row1",
        recipientId: "directory-person",
        employerId: "directory-employer",
        photoAssetId: "saved-photo",
        fullNameRu: "Синтетический Рабочий",
        assignments: [
          {
            ...newAssignment("biot-worker-card"),
            id: "assignment1",
            eventId: "root",
            result: "",
            fieldOrigins: { result: "CLEARED", trainingSubject: "IMPORTED" },
            trainingSubject: "Индивидуальная программа",
            retakeOf: {
              requestId: "historical-request",
              rowId: "historical-row",
              assignmentId: "historical-assignment",
              reason: "Подтверждённая историческая связь",
            },
            outcome: {
              status: "PASSED",
              source: "Сохранённый источник ведомости",
              confirmedBy: "historical-actor",
              confirmedAt: "2026-10-01T08:00:00.000Z",
            },
          },
        ],
      },
      {
        ...newRecipient(),
        id: "row2",
        fullNameRu: "Синтетический Инженер",
        assignments: [
          {
            ...newAssignment("biot-itr-certificate"),
            id: "assignment2",
            eventId: "derived",
          },
        ],
      },
    ],
  };
}

test("conflict copy renews all event identities and internal references without rewriting raw facts or source", () => {
  const draft = source(),
    before = structuredClone(draft);
  let sequence = 0;
  const attempt = prepareConflictCopy(
    draft,
    3,
    null,
    () => `fresh-${++sequence}`,
  );
  const copied = JSON.parse(attempt.body);
  assert.deepEqual(draft, before);
  assert.deepEqual(
    copied.events.map((event: { id: string }) => event.id),
    ["fresh-1", "fresh-2"],
  );
  assert.equal(copied.events[1].rootEventId, "fresh-1");
  assert.deepEqual(copied.trainingDefaults[0].eventIds, ["fresh-1", "fresh-2"]);
  assert.deepEqual(
    copied.items.map(
      (row: Draft["items"][number]) => row.assignments[0].eventId,
    ),
    ["fresh-1", "fresh-2"],
  );
  const normalized = structuredClone(copied);
  normalized.events[0].id = "root";
  normalized.events[1].id = "derived";
  normalized.events[1].rootEventId = "root";
  normalized.trainingDefaults[0].eventIds = ["root", "derived"];
  normalized.items[0].assignments[0].eventId = "root";
  normalized.items[1].assignments[0].eventId = "derived";
  assert.deepEqual(normalized.items, JSON.parse(JSON.stringify(before.items)));
  assert.deepEqual(normalized.events, before.events);
  assert.equal(copied.customerId, before.customerId);
  assert.equal(copied.items[0].recipientId, "directory-person");
  assert.equal(copied.items[0].employerId, "directory-employer");
  assert.equal(copied.items[0].photoAssetId, "saved-photo");
  assert.deepEqual(
    copied.items[0].assignments[0].retakeOf,
    before.items[0].assignments[0].retakeOf,
  );
  assert.deepEqual(
    copied.items[0].assignments[0].outcome,
    before.items[0].assignments[0].outcome,
  );
  assert.equal(copied.items[0].assignments[0].fieldOrigins.result, "CLEARED");
});

test("a lost response retry reuses byte-identical payload/key, while a later local edit starts an independent copy", () => {
  const draft = source();
  let sequence = 0;
  const next = () => `fresh-${++sequence}`;
  const first = prepareConflictCopy(draft, 3, null, next);
  const retry = prepareConflictCopy(draft, 3, first, next);
  assert.equal(retry, first);
  assert.equal(retry.body, first.body);
  assert.equal(retry.key, first.key);
  const savedBody = first.body;
  draft.items[0].positionRu = "Новая локальная должность";
  const later = prepareConflictCopy(draft, 4, first, next);
  assert.notEqual(later.key, first.key);
  assert.notEqual(
    JSON.parse(later.body).events[0].id,
    JSON.parse(first.body).events[0].id,
  );
  assert.equal(first.body, savedBody);
  assert.equal(
    JSON.parse(later.body).items[0].positionRu,
    "Новая локальная должность",
  );
});

test("legacy suffix lineage and explicit category lineage reuse the copied root and existing derived course", () => {
  for (const explicit of [false, true]) {
    const input = draftSchema.parse({
      kind: "COMPANY",
      demoMode: true,
      schemaVersion: 2,
      events: [
        {
          id: "legacy-root",
          title: "Рабочие",
          protocolTemplateId: "biot-protocol",
          protocolMode: "GROUP",
          commonFields: {
            hours: "10",
            productionHours: "16",
            biotCategory: "WORKER",
          },
        },
        {
          id: "legacy-root-ITR",
          title: "ИТР",
          protocolTemplateId: "biot-itr-protocol",
          protocolMode: "GROUP",
          commonFields: {
            hours: "40",
            productionHours: "",
            biotCategory: "ITR_STANDARD",
          },
        },
      ],
      trainingDefaults: [
        { direction: "BIOT", eventIds: ["legacy-root", "legacy-root-ITR"] },
      ],
      items: [1, 2].map((index) => ({
        id: `person-${index}`,
        fullNameRu: `Синтетический Участник ${index}`,
        employeeCategory: "ITR",
        assignments: [
          {
            id: `credential-${index}`,
            templateId: "biot-itr-certificate",
            eventId: "legacy-root-ITR",
            protocolMode: "GROUP",
            outcome: {
              status: "PASSED",
              source: "Синтетическая подтверждённая ведомость",
            },
          },
        ],
      })),
    });
    if (explicit) input.events![1].rootEventId = input.events![0].id;
    input.events![1].lineageContext = trainingEventContext(input.events![0]);
    input.events![1].lineageOwnContext = trainingEventContext(input.events![1]);
    const normalized = applyBusinessRules(input);
    let sequence = 0;
    const copied: typeof normalized = JSON.parse(
      prepareConflictCopy(
        { ...normalized, id: "source", revision: 3, status: "DRAFT" },
        1,
        null,
        () => `fresh-${++sequence}`,
      ).body,
    );
    const [rootId, derivedId] = copied.events!.map(
      (event: { id: string }) => event.id,
    );
    assert.equal(derivedId, `${rootId}-ITR`);
    assert.equal(copied.events![1].rootEventId, explicit ? rootId : undefined);
    assert.equal(
      copied.events![1].lineageContext,
      normalized.events![1].lineageContext,
    );
    assert.equal(
      copied.events![1].lineageOwnContext,
      normalized.events![1].lineageOwnContext,
    );
    copied.items[0].employeeCategory = "WORKER";
    const returned = applyBusinessRules(copied);
    assert.ok(
      returned.items[0].assignments.every(
        (assignment) => assignment.eventId === rootId,
      ),
    );
    assert.deepEqual(
      returned.events!.map((event) => event.id),
      [rootId, derivedId],
    );
    returned.items[0].employeeCategory = "ITR";
    const reused = applyBusinessRules(returned);
    assert.ok(
      reused.items[0].assignments.every(
        (assignment) => assignment.eventId === derivedId,
      ),
    );
    assert.deepEqual(
      reused.events!.map((event) => event.id),
      [rootId, derivedId],
    );
  }
});

function edgeDraft(ids: string[]): Draft {
  return {
    ...draftSchema.parse({
      kind: "COMPANY",
      demoMode: true,
      events: ids.map((id) => ({
        id,
        title: "Синтетическое событие",
        protocolTemplateId: "biot-protocol",
        commonFields: {},
      })),
      trainingDefaults: [{ direction: "BIOT", eventIds: ids }],
    }),
    id: "edge-source",
    revision: 1,
    status: "DRAFT",
  };
}

test("long legacy IDs compact under the schema limit without stealing canonical or normal nested identities", () => {
  const longId = "r" + "-ITR".repeat(19);
  const draft = edgeDraft([longId, "r-ITR-ITR", "r-WORKER", "r", "r-ITR"]);
  const before = structuredClone(draft);
  const copied = draftSchema.parse(
    JSON.parse(prepareConflictCopy(draft, 1, null).body),
  );
  const ids = copied.events!.map((event) => event.id);
  const root = ids[3];
  assert.equal(ids[1], root + "-ITR-ITR");
  assert.equal(ids[2], root + "-WORKER");
  assert.equal(ids[4], root + "-ITR");
  assert.ok(ids[0].length <= 80);
  assert.equal(ids[0].replace(/(?:-(?:ITR|WORKER))+$/, ""), root);
  assert.notEqual(ids[0], root + "-ITR");
  assert.notEqual(ids[0], root + "-WORKER");
  assert.equal(new Set(ids).size, ids.length);
  assert.equal(copied.events![0].rootEventId, undefined);
  assert.deepEqual(copied.trainingDefaults![0].eventIds, ids);
  assert.deepEqual(draft, before);
});

test("reciprocal explicit canonical roots preserve their references without recursive suffix mapping", () => {
  const prefix = "P".repeat(64);
  const draft = edgeDraft([prefix + "-ITR", prefix + "-WORKER"]);
  draft.events![0].rootEventId = draft.events![1].id;
  draft.events![1].rootEventId = draft.events![0].id;
  const before = structuredClone(draft);
  assert.equal(draftSchema.safeParse(draftPayload(draft)).success, true);
  const copied = draftSchema.parse(
    JSON.parse(prepareConflictCopy(draft, 1, null).body),
  );
  assert.notEqual(copied.events![0].id, copied.events![1].id);
  assert.equal(copied.events![0].rootEventId, copied.events![1].id);
  assert.equal(copied.events![1].rootEventId, copied.events![0].id);
  assert.deepEqual(draft, before);
});

test("exhausting bounded legacy suffix space fails before a payload can be posted and retains the source", () => {
  const suffixes = ["-ITR", "-WORKER"];
  for (let index = 0; index < suffixes.length; index++)
    for (const tail of ["-ITR", "-WORKER"])
      if (suffixes[index].length + tail.length <= 44)
        suffixes.push(suffixes[index] + tail);
  const draft = edgeDraft([
    "r",
    ...suffixes.map((suffix) => "r" + suffix),
    "r" + "-ITR".repeat(19),
  ]);
  const before = structuredClone(draft);
  assert.throws(
    () => prepareConflictCopy(draft, 1, null),
    /слишком много связанных вариантов обучения/,
  );
  assert.deepEqual(draft, before);
});
