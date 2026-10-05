import assert from "node:assert/strict";
import test from "node:test";
import {
  draftSchema,
  profileSchema,
  resolveDraft,
  type Draft,
} from "@demo/contracts";
import { draftReadiness, trainingOutcomeSummary } from "../lib/draft-readiness";
import { newAssignment, newRecipient } from "../lib/types";

test("result reminder counts the same unknown trainings and people when GROUP metadata is omitted, without counting known results or paired forms twice", () => {
  const people = [
    {
      ...newRecipient(),
      fullNameRu: "Ожидающий Получатель",
      assignments: [
        {
          ...newAssignment("pb-card"),
          protocolMode: "GROUP" as const,
          eventId: "PB",
          outcome: undefined,
        },
        {
          ...newAssignment("pb-protocol"),
          protocolMode: "GROUP" as const,
          eventId: "PB",
          outcome: undefined,
        },
        {
          ...newAssignment("ptm-card"),
          protocolMode: "GROUP" as const,
          eventId: "PTM",
          outcome: { status: "UNKNOWN" as const, source: "" },
        },
      ],
    },
    {
      ...newRecipient(),
      assignments: [
        {
          ...newAssignment("pb-card"),
          protocolMode: "GROUP" as const,
          eventId: "PB",
          outcome: {
            status: "PASSED" as const,
            source: "Known synthetic source",
          },
        },
        {
          ...newAssignment("ptm-card"),
          protocolMode: "GROUP" as const,
          eventId: "PTM",
          outcome: {
            status: "FAILED" as const,
            source: "Known synthetic failed attempt",
          },
        },
      ],
    },
    { ...newRecipient(), assignments: [] },
  ];
  const before = structuredClone(people);
  assert.deepEqual(trainingOutcomeSummary({ items: people }), {
    trainings: 2,
    recipients: 1,
  });
  assert.deepEqual(people, before);
  const large = Array.from({ length: 250 }, (_, index) => ({
    ...newRecipient(),
    fullNameRu: `Ожидающий Получатель ${index}`,
    assignments: [
      {
        ...newAssignment("pb-card"),
        protocolMode: "GROUP" as const,
        eventId: "PB",
        outcome: undefined,
      },
    ],
  }));
  assert.deepEqual(trainingOutcomeSummary({ items: large }), {
    trainings: 250,
    recipients: 250,
  });
});

const profile = profileSchema.parse({
  nameRu: "Синтетический центр",
  commission: [],
  approved: true,
  commonFields: { documentDate: "2026-10-02" },
});

function completedDraft(): Draft {
  return draftSchema.parse({
    kind: "PERSON",
    schemaVersion: 2,
    items: [
      {
        ...newRecipient(),
        fullNameRu: "Тестовый Получатель",
        assignments: [
          {
            ...newAssignment("ptm-card"),
            trainingSubject: "Пожарно-технический минимум",
            result: "Сдал",
          },
        ],
      },
    ],
  });
}

test("empty input has actionable local paths before any server command", () => {
  const input = draftSchema.parse({ kind: "COMPANY", items: [] });
  const readiness = draftReadiness(input, null);
  assert.equal(readiness.locallyComplete, false);
  assert.equal(readiness.requiresServerValidation, true);
  assert.deepEqual(
    new Set(readiness.issues.map((issue) => issue.code)),
    new Set(["ISSUER_NOT_APPROVED", "NO_RECIPIENTS", "CUSTOMER_REQUIRED"]),
  );
  assert.ok(readiness.fieldHints.customerId);
  assert.ok(readiness.fieldHints.items);
  assert.ok(readiness.fieldHints.profile);
});

test("hints clear and reappear from current unsaved input without cached review", () => {
  const input = completedDraft();
  input.items[0].fullNameRu = "";
  const before = draftReadiness(input, profile);
  assert.ok(before.fieldHints["items.0.fullNameRu"]);
  input.items[0].fullNameRu = "Исправленный Получатель";
  const after = draftReadiness(input, profile);
  assert.equal(after.fieldHints["items.0.fullNameRu"], undefined);
  assert.equal(after.locallyComplete, true);
  input.items[0].assignments = [];
  const removedTraining = draftReadiness(input, profile);
  assert.ok(removedTraining.fieldHints["items.0.assignments"]);
  assert.equal(removedTraining.locallyComplete, false);
});

test("inherited values resolve without mutating input or replacing explicit exceptions", () => {
  const input = completedDraft();
  const assignment = input.items[0].assignments[0];
  assignment.documentDate = "2026-02-30";
  assignment.fieldOrigins = { documentDate: "IMPORTED" };
  input.items[0].workplaceRu = "Импортированное название работодателя";
  const before = structuredClone(input);
  const withException = draftReadiness(input, profile);
  assert.ok(withException.fieldHints["items.0.assignments.0.documentDate"]);
  assert.deepEqual(input, before);
  assignment.documentDate = "";
  assignment.fieldOrigins = { documentDate: "INHERITED" };
  const inherited = draftReadiness(input, profile);
  assert.equal(
    inherited.fieldHints["items.0.assignments.0.documentDate"],
    undefined,
  );
  assert.equal(input.items[0].workplaceRu, before.items[0].workplaceRu);
  assert.equal(assignment.documentDate, "");
  assignment.fieldOrigins = { documentDate: "CLEARED" };
  assert.ok(
    draftReadiness(input, profile).fieldHints[
      "items.0.assignments.0.documentDate"
    ],
  );
});

test("group outcome and source issues retain the recipient and exact focus path", () => {
  const input = completedDraft();
  input.events = [
    {
      id: "training",
      title: "Синтетическое обучение",
      revision: 0,
      protocolTemplateId: "ptm-protocol",
      commonFields: {},
    },
  ];
  const assignment = input.items[0].assignments[0];
  assignment.protocolMode = "GROUP";
  assignment.eventId = "training";
  delete assignment.outcome;
  const missing = draftReadiness(input, profile);
  assert.ok(
    missing.issues.some(
      (issue) =>
        issue.code === "OUTCOME_REQUIRED" &&
        issue.rowId === input.items[0].id &&
        issue.path === "items.0.assignments.0.outcome",
    ),
  );
  assignment.outcome = { status: "PASSED", source: "" };
  const noSource = draftReadiness(input, profile);
  assert.ok(noSource.fieldHints["items.0.assignments.0.outcome.source"]);
  assignment.outcome.source = "Синтетическая ведомость от 02.10.2026";
  const confirmed = draftReadiness(input, profile);
  assert.equal(
    confirmed.issues.some((issue) => issue.code.startsWith("OUTCOME_")),
    false,
  );
});

test("supplied current resolution is used and exact duplicate hints are coalesced", () => {
  const input = completedDraft();
  input.items[0].fullNameRu = "";
  const resolved = resolveDraft(input, profile.commonFields);
  resolved.draft.items[0].fullNameRu = "Сведения текущей редакции";
  const issue = {
    code: "EVENT_INCOMPATIBLE",
    path: "items.0.assignments.0",
    rowId: input.items[0].id,
    message: "Выберите совместимое обучение",
  };
  resolved.issues.push(issue, issue);
  const before = structuredClone(resolved);
  const result = draftReadiness(input, profile, resolved);
  assert.equal(result.fieldHints["items.0.fullNameRu"], undefined);
  assert.equal(
    result.issues.filter((entry) => entry.code === issue.code).length,
    1,
  );
  assert.equal(result.fieldHints[issue.path], issue.message);
  assert.deepEqual(resolved, before);
});

test("complete local fields cannot establish full readiness or hide a missing profile", () => {
  const input = completedDraft();
  const complete = draftReadiness(input, profile);
  assert.equal(complete.locallyComplete, true);
  assert.equal(complete.requiresServerValidation, true);
  const resolved = resolveDraft(input, profile.commonFields);
  const missingProfile = draftReadiness(input, null, resolved);
  assert.equal(missingProfile.locallyComplete, false);
  assert.ok(
    missingProfile.issues.some((issue) => issue.code === "ISSUER_NOT_APPROVED"),
  );
});

function groupedItrDraft(): Draft {
  const input = completedDraft();
  input.businessRuleVersion = "LIVE_V1";
  input.events = [
    {
      id: "itr-training",
      title: "Специальные компетенции ИТР",
      revision: 0,
      protocolMode: "GROUP",
      protocolTemplateId: "biot-itr-protocol",
      commonFields: {
        biotCheckType: "PERIODIC",
        biotCategory: "OHS_SPECIALIST_SPECIAL",
      },
    },
  ];
  // An unrelated first row and assignment expose accidental local index reuse.
  input.items.push({
    ...newRecipient(),
    employeeCategory: "ITR",
    fullNameRu: "Второй Получатель",
    positionRu: "Инженер",
    workplaceRu: "ТОО Синтетический работодатель",
    assignments: [
      {
        ...newAssignment("ptm-card"),
        trainingSubject: "Пожарно-технический минимум",
        result: "Сдал",
        outcome: { status: "PASSED", source: "Тестовая ведомость" },
      },
      {
        ...newAssignment("biot-itr-certificate"),
        biotCategory: "OHS_SPECIALIST_SPECIAL",
        eventId: "itr-training",
        protocolMode: "GROUP",
        trainingSubject: "Специальные компетенции",
        biotIndustryRu: "Строительство",
        result: "Сдал",
        outcome: { status: "PASSED", source: "Тестовая ведомость" },
      },
    ],
  });
  return input;
}

const itrProfile = profileSchema.parse({
  ...profile,
  headName: "Тестовый Руководитель",
  bin: "123456789012",
  commission: [
    { name: "Председатель", position: "Председатель комиссии" },
    { name: "Первый член", position: "Член комиссии" },
    { name: "Второй член", position: "Член комиссии" },
  ],
});

test("virtual ITR group protocol exposes missing employer and results at the original row and assignment", () => {
  const input = groupedItrDraft();
  const before = structuredClone(input);
  const result = draftReadiness(input, itrProfile);
  const paths = [
    "items.1.employerBin",
    "items.1.employerAddressRu",
    "items.1.assignments.1.biotKnowledgeResult",
    "items.1.assignments.1.biotProctoringResult",
  ];
  for (const path of paths) {
    assert.ok(result.fieldHints[path], path);
    assert.ok(
      result.issues.some(
        (issue) => issue.path === path && issue.rowId === input.items[1].id,
      ),
      path,
    );
  }
  assert.equal(
    result.issues.some((issue) => issue.code === "BIOT_UNIQUE_NUMBER_REQUIRED"),
    false,
    "the paired certificate remains visible to the protocol validator",
  );
  assert.equal(result.locallyComplete, false);
  assert.deepEqual(input, before);
  input.items[1].employerBin = "987654321098";
  input.items[1].employerAddressRu = "Тестовый адрес";
  input.items[1].assignments[1].biotKnowledgeResult =
    "Подтверждённый результат";
  input.items[1].assignments[1].biotProctoringResult =
    "Подтверждённый прокторинг";
  const corrected = draftReadiness(input, itrProfile);
  for (const path of paths) assert.equal(corrected.fieldHints[path], undefined);
});

test("virtual protocol date errors target the protocol date without replacing the personal issue date", () => {
  const input = groupedItrDraft();
  input.events![0].commonFields.protocolDate = "2026-02-30";
  const current = resolveDraft(input, itrProfile.commonFields);
  const before = structuredClone(current);
  const result = draftReadiness(input, itrProfile, current);
  assert.ok(
    result.issues.some(
      (issue) =>
        issue.code === "DATE_INVALID" &&
        issue.path === "items.1.assignments.1.protocolDate" &&
        issue.rowId === input.items[1].id,
    ),
  );
  assert.equal(
    result.fieldHints["items.1.assignments.1.documentDate"],
    undefined,
  );
  assert.deepEqual(current, before);
});

test("virtual protocols retain confirmed negative and unknown outcomes instead of requiring a pass", () => {
  for (const status of ["UNKNOWN", "FAILED", "ABSENT"] as const) {
    const input = completedDraft();
    input.events = [
      {
        id: "ptm-training",
        title: "ПТМ",
        revision: 0,
        protocolTemplateId: "ptm-protocol",
        commonFields: {},
      },
    ];
    Object.assign(input.items[0].assignments[0], {
      eventId: "ptm-training",
      protocolMode: "GROUP",
      result: "",
      outcome: {
        status,
        source: status === "UNKNOWN" ? "" : "Тестовая ведомость",
      },
    });
    const result = draftReadiness(input, profile);
    assert.equal(result.locallyComplete, true, JSON.stringify(result.issues));
    assert.equal(result.requiresServerValidation, true);
  }
});

test("a separately pinned event profile is not judged using the request's commission", () => {
  const input = groupedItrDraft();
  input.profileVersionId = "request-profile";
  input.events![0].profileVersionId = "event-profile";
  const requestProfile = { ...itrProfile, commission: [] };
  const separate = draftReadiness(input, requestProfile);
  assert.equal(separate.fieldHints["issuer.commission"], undefined);
  assert.equal(separate.requiresServerValidation, true);
  assert.ok(separate.fieldHints["items.1.employerBin"]);
  input.events![0].profileVersionId = "request-profile";
  const same = draftReadiness(input, requestProfile);
  assert.ok(same.fieldHints["issuer.commission"]);
});
