import test from "node:test";
import assert from "node:assert/strict";
import {
  applyBusinessRules,
  calculateDates,
  draftSchema,
  resolveDraft,
  validateBusinessRules,
  stableValidationIssue,
  eventProtocolAssignment,
  isBlankText,
  validateDraft,
  commonFieldKeys,
  type Draft,
  type TrainingDateRule,
} from "../packages/contracts/src";
import { restoreTrainingAssignmentField } from "../apps/web/lib/training-assignment-edit";

test("invisible-only names are blank, bilingual fallback uses significant text and raw values remain intact", () => {
  const invisible = "\u00A0\u200B\u200C\u200D\u2060\uFEFF";
  assert.equal(isBlankText(invisible), true);
  assert.equal(isBlankText(`\u200BИмя\u200C`), false);
  const raw = draftSchema.parse({
    kind: "PERSON",
    items: [{ id: "blank-name", fullNameRu: invisible, fullNameKz: invisible }],
  });
  assert.ok(
    validateDraft(resolveDraft(raw).draft, null).some(
      (issue) => issue.code === "NAME_REQUIRED" && issue.rowId === "blank-name",
    ),
  );
  raw.items[0].fullNameKz = "Әділ Өмір";
  assert.equal(resolveDraft(raw).draft.items[0].fullNameRu, "Әділ Өмір");
  assert.equal(raw.items[0].fullNameRu, invisible);
});

const fixture = (): Draft =>
  applyBusinessRules(
    draftSchema.parse({
      kind: "PERSON",
      schemaVersion: 2,
      commonFields: { documentDate: "2026-10-03" },
      events: [
        {
          id: "original-event",
          title: "Синтетическая группа",
          protocolTemplateId: "biot-protocol",
          protocolMode: "GROUP",
          protocolModeSource: "AUTO",
          commonFields: {
            trainingSubject: "Общая программа",
            documentDate: "2026-10-03",
            hours: "10",
            productionHours: "16",
            biotCategory: "WORKER",
          },
        },
      ],
      items: [1, 2].map((number) => ({
        id: `recipient-${number}`,
        employeeCategory: "WORKER",
        fullNameRu: `Синтетический ${number}`,
        assignments: [
          {
            id: `credential-${number}`,
            templateId: "biot-worker-card",
            eventId: "original-event",
            protocolMode: "GROUP",
            fieldOrigins: {
              trainingSubject: "INHERITED",
              hours: "INHERITED",
              productionHours: "INHERITED",
              documentDate: "MANUAL",
            },
            documentDate: "2026-10-04",
            outcome: {
              status: "PASSED",
              source: "Синтетическая ведомость",
              confirmedBy: "original-actor",
              confirmedAt: "2026-10-01T00:00:00.000Z",
            },
          },
        ],
      })),
    }),
  );
const rule: TrainingDateRule = {
  hoursPerDay: 4,
  hoursSource: "THEORY",
  calendar: "CALENDAR",
  anchor: "DOCUMENT_IS_END",
  protocolDate: "TRAINING_END",
  source: "Синтетический график",
};

test("category corrections return to the original identity and remove untouched empty derived events", () => {
  let draft = fixture();
  const original = structuredClone(draft.items[0].assignments[0]);
  for (let cycle = 0; cycle < 3; cycle++) {
    draft.items[0].employeeCategory = "ITR";
    draft = applyBusinessRules(draft);
    assert.equal(draft.events?.length, 2);
    assert.equal(draft.items[0].assignments[0].id, original.id);
    assert.equal(draft.items[0].assignments[0].eventId, "original-event-ITR");
    draft.items[0].employeeCategory = "WORKER";
    draft = applyBusinessRules(draft);
    assert.equal(draft.events?.length, 1);
    assert.equal(draft.items[0].assignments[0].eventId, "original-event");
    assert.equal(draft.items[0].assignments.length, 1);
    assert.deepEqual(draft.items[0].assignments[0].outcome, original.outcome);
    assert.equal(
      draft.items[0].assignments[0].documentDate,
      original.documentDate,
    );
  }
});

test("independent same-title events and empty events with facts are never merged or deleted", () => {
  let draft = fixture();
  draft.events!.push({
    ...structuredClone(draft.events![0]),
    id: "independent",
    commonFields: { trainingSubject: "Независимый факт" },
  });
  draft.items[0].employeeCategory = "ITR";
  draft = applyBusinessRules(draft);
  draft.events!.find(
    (event) => event.id === "original-event-ITR",
  )!.commonFields.reason = "Самостоятельное основание";
  draft.items[0].employeeCategory = "WORKER";
  draft = applyBusinessRules(draft);
  assert.equal(draft.items[0].assignments[0].eventId, "original-event");
  assert.equal(
    draft.events?.find((event) => event.id === "independent")?.commonFields
      .trainingSubject,
    "Независимый факт",
  );
  assert.equal(
    draft.events?.find((event) => event.id === "original-event-ITR")
      ?.commonFields.reason,
    "Самостоятельное основание",
  );
});

test("a changed original context cannot silently receive an old confirmed fact from a derived category", () => {
  let draft = fixture();
  const outcome = structuredClone(draft.items[0].assignments[0].outcome);
  draft.items[0].employeeCategory = "ITR";
  draft = applyBusinessRules(draft);
  draft.events!.find(
    (event) => event.id === "original-event",
  )!.commonFields.trainingSubject = "Новая программа другой редакции";
  draft.items[0].employeeCategory = "WORKER";
  draft = applyBusinessRules(draft);
  assert.equal(draft.items[0].assignments[0].eventId, "original-event-ITR");
  assert.deepEqual(draft.items[0].assignments[0].outcome, outcome);
  const issue = validateBusinessRules(draft).find(
    (entry) => entry.code === "CATEGORY_LINEAGE_CONFLICT",
  );
  assert.equal(issue?.recipientId, "recipient-1");
  assert.equal(issue?.eventId, "original-event-ITR");
});

test("every form restores linked program, hours and dates without changing another training or result", () => {
  for (const selectedTemplate of [
    "biot-worker-card",
    "biot-protocol",
  ] as const) {
    const draft = fixture();
    draft.events![0].protocolMode = "INDIVIDUAL";
    draft.events![0].protocolModeSource = "MANUAL";
    let normalized = applyBusinessRules(draft);
    const person = normalized.items[0];
    for (const assignment of person.assignments) {
      assignment.trainingSubject = "Ручное исключение";
      assignment.hours = "99";
      assignment.trainingStart = "2026-09-01";
      assignment.fieldOrigins = {
        ...assignment.fieldOrigins,
        trainingSubject: "MANUAL",
        hours: "IMPORTED",
        trainingStart: "CLEARED",
      };
    }
    const selected = person.assignments.find(
      (entry) => entry.templateId === selectedTemplate,
    )!;
    const outcome = structuredClone(person.assignments[0].outcome);
    let restored = restoreTrainingAssignmentField(
      person,
      selected.id,
      "trainingSubject",
      true,
    );
    restored = restoreTrainingAssignmentField(
      restored,
      selected.id,
      "hours",
      true,
    );
    restored = restoreTrainingAssignmentField(
      restored,
      selected.id,
      "trainingStart",
      true,
    );
    normalized.items[0] = restored;
    normalized = applyBusinessRules(normalized);
    const resolved = resolveDraft(normalized);
    for (const assignment of resolved.draft.items[0].assignments) {
      assert.equal(assignment.trainingSubject, "Общая программа");
      assert.equal(assignment.hours, "10");
      assert.equal(
        normalized.items[0].assignments.find(
          (entry) => entry.id === assignment.id,
        )?.fieldOrigins?.trainingSubject,
        "INHERITED",
      );
      assert.deepEqual(assignment.outcome, outcome);
    }
  }
});

test("resetting a protocol date keeps inheritance after normalization and follows the changed common date", () => {
  const raw = fixture();
  raw.events![0].protocolMode = "INDIVIDUAL";
  raw.events![0].protocolModeSource = "MANUAL";
  raw.events![0].commonFields.protocolDate = "2026-10-02";
  raw.items[0].assignments[0].protocolDate = "2026-09-29";
  raw.items[0].assignments[0].fieldOrigins = { ...raw.items[0].assignments[0].fieldOrigins, protocolDate: "IMPORTED" };
  const normalized = applyBusinessRules(raw);
  const before = structuredClone(normalized.items[0].assignments);
  const protocol = before.find((assignment) => assignment.templateId === "biot-protocol")!;
  normalized.items[0] = restoreTrainingAssignmentField(normalized.items[0], protocol.id, "documentDate", true);
  const restored = applyBusinessRules(normalized);
  for (const assignment of restored.items[0].assignments) {
    assert.equal(assignment.fieldOrigins?.protocolDate, "INHERITED");
    if (assignment.templateId.endsWith("-protocol")) assert.equal(assignment.fieldOrigins?.documentDate, "INHERITED");
    assert.deepEqual(assignment.outcome, before.find((entry) => entry.id === assignment.id)!.outcome);
  }
  assert.equal(resolveDraft(restored).draft.items[0].assignments.find((assignment) => assignment.id === protocol.id)!.documentDate, "2026-10-02");
  const serialized = draftSchema.parse(JSON.parse(JSON.stringify(restored)));
  serialized.events![0].commonFields.protocolDate = "2026-10-03";
  const updated = resolveDraft(applyBusinessRules(serialized));
  assert.equal(updated.draft.items[0].assignments.find((assignment) => assignment.id === protocol.id)!.documentDate, "2026-10-03");
  assert.equal(updated.provenance[`recipient-1:${protocol.id}`].protocolDate, "EVENT");
});

test("resetting an independent document basis preserves the companion basis and every confirmed fact", () => {
  const draft = fixture();
  draft.events![0].protocolMode = "INDIVIDUAL";
  draft.events![0].protocolModeSource = "MANUAL";
  const person = applyBusinessRules(draft).items[0];
  for (const [index, assignment] of person.assignments.entries()) {
    assignment.externalBasisNumber = `INDEPENDENT-${index}`;
    assignment.fieldOrigins = { ...assignment.fieldOrigins, externalBasisNumber: "IMPORTED" };
  }
  const before = structuredClone(person);
  const changed = restoreTrainingAssignmentField(person, person.assignments[0].id, "externalBasisNumber", true);
  assert.equal(changed.assignments[0].fieldOrigins?.externalBasisNumber, "INHERITED");
  assert.deepEqual(changed.assignments[1], before.assignments[1]);
  assert.deepEqual(changed.assignments[0].outcome, before.assignments[0].outcome);
  assert.equal(changed.assignments[0].id, before.assignments[0].id);
});

test("calculation causes point at hours, production, rule or calendar independently", () => {
  for (const hours of ["8 ч", "", "0"])
    assert.equal(
      calculateDates({ documentDate: "2026-10-03", hours }, rule)
        .problemDetails[0]?.field,
      "hours",
    );
  assert.equal(
    calculateDates(
      { documentDate: "2026-10-03", hours: "8", productionHours: "bad" },
      { ...rule, hoursSource: "THEORY_AND_PRODUCTION" },
    ).problemDetails[0]?.field,
    "productionHours",
  );
  assert.equal(
    calculateDates(
      { documentDate: "2026-10-03", hours: "8" },
      { ...rule, hoursPerDay: 25 },
    ).problemDetails[0]?.field,
    "trainingDateRule.hoursPerDay",
  );
  assert.equal(
    calculateDates({ documentDate: "2026-02-31", hours: "8" }, rule)
      .problemDetails[0]?.field,
    "documentDate",
  );
  assert.equal(
    calculateDates({ documentDate: "2026-10-03", hours: "99999" }, rule)
      .problemDetails[0]?.code,
    "TRAINING_PERIOD_LIMIT",
  );
  const draft = fixture();
  draft.events![0].commonFields.trainingDateRule = rule;
  draft.events![0].commonFields.hours = "8 ч";
  const issue = resolveDraft(draft).issues.find(
    (entry) => entry.code === "TRAINING_HOURS_INVALID",
  )!;
  assert.equal(issue.recipientId, "recipient-1");
  assert.equal(issue.assignmentId, "credential-1");
  assert.equal(issue.eventId, "original-event");
  assert.equal(issue.path, "items.0.assignments.0.hours");
});

test("stable validation addresses follow recipient and assignment IDs across reorder", () => {
  const draft = fixture();
  const issue = stableValidationIssue(draft, {
    code: "NAME_REQUIRED",
    rowId: "recipient-2",
    path: "items.0.fullNameRu",
    message: "Missing",
  });
  assert.equal(issue.recipientId, "recipient-2");
  assert.equal(issue.field, "fullNameRu");
  assert.equal(issue.path, "items.1.fullNameRu");
  draft.items[1].assignments.unshift({ ...structuredClone(draft.items[1].assignments[0]), id: "other-independent-assignment" });
  const addressed = [...commonFieldKeys, "outcome.source", "biotKnowledgeResult", "biotProctoringResult", "templateId"].map((field) => stableValidationIssue(draft, {
    code: "FIELD_ERROR", recipientId: "recipient-2", assignmentId: "credential-2", eventId: "original-event", field,
    path: `items.0.assignments.0.${field}`, message: "Synthetic field issue",
  }));
  for (const issue of addressed) {
    assert.equal(issue.recipientId, "recipient-2");
    assert.equal(issue.assignmentId, "credential-2");
    assert.equal(issue.eventId, "original-event");
    assert.equal(issue.path, `items.1.assignments.1.${issue.field}`);
  }
});

test("LIVE grouped protocols retain resolved employee-category validity instead of a conflicting category preset", () => {
  const raw = draftSchema.parse({
    kind: "PERSON",
    businessRuleVersion: "LIVE_V1",
    schemaVersion: 2,
    commonFields: { documentDate: "2026-10-03" },
    events: [
      {
        id: "itr-event",
        title: "Синтетический инспектор",
        protocolTemplateId: "biot-itr-protocol",
        protocolMode: "GROUP",
        protocolModeSource: "MANUAL",
        commonFields: {
          documentDate: "2026-10-03",
          validUntil: "2027-10-03",
          biotCategory: "INSPECTOR_SPECIAL",
          hours: "40",
        },
      },
    ],
    items: [
      {
        id: "inspector",
        employeeCategory: "ITR",
        assignments: [
          {
            id: "itr-certificate",
            eventId: "itr-event",
            templateId: "biot-itr-certificate",
            protocolMode: "GROUP",
            fieldOrigins: {
              documentDate: "INHERITED",
              biotCategory: "INHERITED",
              validUntil: "AUTO",
            },
            outcome: { status: "UNKNOWN", source: "" },
          },
        ],
      },
    ],
  });
  const resolved = resolveDraft(applyBusinessRules(raw)).draft;
  const member = resolved.items[0].assignments[0];
  assert.equal(member.validUntil, "2029-10-03");
  assert.equal(
    eventProtocolAssignment(resolved.events![0], member, true).validUntil,
    "2029-10-03",
  );
  assert.equal(
    eventProtocolAssignment(resolved.events![0], member).validUntil,
    "2027-10-03",
    "Legacy snapshots retain their previous contract",
  );
});
