import test from "node:test";
import assert from "node:assert/strict";
import { applyBusinessRules, documentPlan } from "@demo/contracts";
import { editTrainingAssignment } from "../lib/training-assignment-edit";
import { newAssignment, newRecipient } from "../lib/types";

test("editing a companion keeps common values after normalization and leaves other trainings intact", () => {
  const person = {
    ...newRecipient(),
    employeeCategory: "WORKER" as const,
    assignments: [
      { ...newAssignment("ps-card"), id: "card", eventId: "ps" },
      { ...newAssignment("ps-witness"), id: "witness", eventId: "ps" },
      {
        ...newAssignment("ptm-card"),
        id: "ptm",
        eventId: "ptm",
        trainingSubject: "Другая программа",
      },
    ],
  };
  const edited = editTrainingAssignment(
    person,
    "witness",
    {
      trainingSubject: "Дизайнер",
      trainingSubjectEn: "Designer",
      documentDate: "2026-10-01",
    },
    true,
  );
  const draft = applyBusinessRules({
    title: "",
    kind: "PERSON" as const,
    customerId: null,
    demoMode: true,
    items: [edited],
  });
  for (const assignment of draft.items[0].assignments.filter(
    (entry) => entry.eventId === "ps" && !entry.templateId.endsWith("protocol"),
  )) {
    assert.equal(assignment.trainingSubject, "Дизайнер");
    assert.equal(assignment.trainingSubjectEn, undefined);
    assert.equal(assignment.documentDate, "2026-10-01");
  }
  assert.equal(
    draft.items[0].assignments.find((entry) => entry.id === "ptm")
      ?.trainingSubject,
    "Другая программа",
  );
});

test("editing protocol document date preserves personal issue date", () => {
  const person = {
    ...newRecipient(),
    assignments: [
      {
        ...newAssignment("ptm-card"),
        id: "card",
        eventId: "training",
        documentDate: "2026-10-01",
      },
      { ...newAssignment("ptm-protocol"), id: "protocol", eventId: "training" },
    ],
  };
  const result = editTrainingAssignment(
    person,
    "protocol",
    { documentDate: "2026-09-30" },
    true,
  );
  assert.equal(result.assignments[0].documentDate, "2026-10-01");
  assert.equal(result.assignments[0].protocolDate, "2026-09-30");
  assert.equal(result.assignments[1].protocolDate, "2026-09-30");
});

test("editing individual PTM protocol result and subject updates its card and survives normalization", () => {
  const person = {
    ...newRecipient(),
    assignments: [
      { ...newAssignment("ptm-card"), id: "card", eventId: "ptm" },
      { ...newAssignment("ptm-protocol"), id: "protocol", eventId: "ptm" },
      {
        ...newAssignment("pb-card"),
        id: "pb",
        eventId: "pb",
        result: "Отдельная оценка",
      },
    ],
  };
  const other = {
    ...newRecipient(),
    assignments: [
      { ...newAssignment("ptm-card"), id: "other-card", eventId: "ptm" },
    ],
  };
  const edited = editTrainingAssignment(
    person,
    "protocol",
    {
      result: "Подтверждённая оператором оценка",
      trainingSubject: "Введённая оператором программа",
    },
    true,
  );
  const draft = applyBusinessRules({
    title: "",
    kind: "COMPANY" as const,
    customerId: null,
    demoMode: true,
    items: [edited, other],
  });
  for (const assignment of draft.items[0].assignments.filter(
    (a) => a.eventId === "ptm",
  )) {
    assert.equal(assignment.result, "Подтверждённая оператором оценка");
    assert.equal(assignment.trainingSubject, "Введённая оператором программа");
    assert.equal(assignment.protocolMode, "INDIVIDUAL");
  }
  assert.equal(
    draft.items[0].assignments.find((a) => a.id === "pb")?.result,
    "Отдельная оценка",
  );
  assert.equal(
    draft.items[1].assignments[0].result,
    other.assignments[0].result,
  );
  assert.equal(
    draft.items[1].assignments[0].trainingSubject,
    "ПТМ",
    "the untouched recipient keeps its course default without gaining the edited program",
  );
});

test("explicit individual PTM outcome and source unlock the card without inventing a result", () => {
  const person = {
    ...newRecipient(),
    assignments: [
      {
        ...newAssignment("ptm-card"),
        id: "card",
        eventId: "ptm",
        outcome: { status: "UNKNOWN" as const, source: "" },
        result: "",
        resultKz: "",
      },
      {
        ...newAssignment("ptm-protocol"),
        id: "protocol",
        eventId: "ptm",
        outcome: { status: "UNKNOWN" as const, source: "" },
        result: "",
        resultKz: "",
      },
    ],
  };
  const original = {
    title: "",
    kind: "PERSON" as const,
    customerId: null,
    demoMode: true,
    items: [person],
  };
  assert.equal(
    documentPlan(applyBusinessRules(original)).individuals.some(
      (row) => row.assignment.templateId === "ptm-card",
    ),
    false,
  );
  const changed = editTrainingAssignment(
    person,
    "protocol",
    {
      outcome: {
        status: "PASSED",
        source: "Ведомость оператора от 01.10.2026",
      },
    },
    true,
  );
  const draft = applyBusinessRules({ ...original, items: [changed] });
  for (const assignment of draft.items[0].assignments) {
    assert.equal(assignment.outcome?.status, "PASSED");
    assert.equal(
      assignment.outcome?.source,
      "Ведомость оператора от 01.10.2026",
    );
    assert.equal(assignment.result, "");
  }
  assert.deepEqual(
    documentPlan(draft).individuals.map((row) => row.assignment.templateId),
    ["ptm-card", "ptm-protocol"],
  );
  assert.equal(person.assignments[0].outcome.status, "UNKNOWN");
  assert.equal(person.assignments[0].outcome.source, "");
});
