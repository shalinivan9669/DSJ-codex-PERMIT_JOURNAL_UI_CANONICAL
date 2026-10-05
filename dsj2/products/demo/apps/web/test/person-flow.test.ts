import assert from "node:assert/strict";
import test from "node:test";
import { applyBusinessRules, resolveDraft } from "@demo/contracts";
import {
  initialPersonStage,
  personStageForField,
  trainingPeriodErrors,
} from "../lib/person-flow";
import { editTrainingAssignment } from "../lib/training-assignment-edit";
import { recipientCourses } from "../lib/recipient-course-context";
import { newAssignment, newRecipient } from "../lib/types";

test("PERSON resumes from existing data and accepts the separately saved Kazakh variant", () => {
  const person = { ...newRecipient(), assignments: [] };
  assert.equal(initialPersonStage(person), "identity");
  assert.equal(
    initialPersonStage({ ...person, fullNameRu: "Тест Имя", positionRu: "" }),
    "identity",
  );
  const named = { ...person, fullNameKz: "Тест Аты", positionKz: "Слесарь" };
  assert.equal(
    initialPersonStage({ ...named, employeeCategory: undefined }),
    "category",
  );
  assert.equal(initialPersonStage(named), "courses");
  assert.equal(
    initialPersonStage({ ...named, assignments: [newAssignment("ps-card")] }),
    "summary",
  );
  assert.equal(named.fullNameRu, "");
});

test("PERSON field routing opens only the relevant step", () => {
  assert.equal(personStageForField("fullNameKz"), "identity");
  assert.equal(personStageForField("positionRu"), "identity");
  assert.equal(personStageForField("employeeCategory"), "category");
  assert.equal(personStageForField("assignments"), "courses");
  assert.equal(personStageForField("photoAssetId"), "courses");
  assert.equal(personStageForField("employerBin"), "courses");
});

test("PS period permits an omitted period but rejects impossible dates and reversed order", () => {
  assert.deepEqual(trainingPeriodErrors({}), {});
  assert.deepEqual(
    trainingPeriodErrors({ trainingStart: "", trainingEnd: "" }),
    {},
  );
  assert.ok(
    trainingPeriodErrors({ trainingStart: "2026-02-30" }).trainingStart,
  );
  assert.ok(
    trainingPeriodErrors({
      trainingStart: "2026-10-04",
      trainingEnd: "2026-10-03",
    }).trainingEnd,
  );
  assert.deepEqual(
    trainingPeriodErrors({
      trainingStart: "2026-09-01",
      trainingEnd: "2026-09-30",
    }),
    {},
  );
});

test("PS course period reaches every related form, stays distinct from protocol and issue, and survives changed hours and category", () => {
  const raw = {
    ...newRecipient(),
    fullNameRu: "Тест Периода",
    fullNameKz: "Сохраненное Имя",
    positionRu: "Сварщик",
    assignments: [
      {
        ...newAssignment("ps-card"),
        id: "card",
        eventId: "training",
        documentDate: "2026-10-05",
        protocolDate: "2026-10-04",
      },
    ],
  };
  const base = applyBusinessRules({
    kind: "PERSON" as const,
    title: "PS",
    demoMode: true,
    customerId: null,
    items: [raw],
    events: [
      {
        id: "training",
        title: "ПС",
        revision: 0,
        protocolTemplateId: "ps-protocol" as const,
        commonFields: {
          trainingStart: "2026-08-01",
          trainingEnd: "2026-08-20",
        },
      },
    ],
  });
  const edited = editTrainingAssignment(
    base.items[0],
    "card",
    { trainingStart: "2026-09-01", trainingEnd: "2026-09-30" },
    true,
  );
  const next = applyBusinessRules({
    ...base,
    items: [
      {
        ...editTrainingAssignment(edited, "card", { hours: "72" }, true),
        employeeCategory: "ITR" as const,
      },
    ],
  });
  const resolved = resolveDraft(next).draft.items[0];
  assert.equal(recipientCourses(resolved).length, 1);
  for (const assignment of resolved.assignments) {
    assert.equal(assignment.trainingStart, "2026-09-01");
    assert.equal(assignment.trainingEnd, "2026-09-30");
    assert.equal(assignment.fieldOrigins?.trainingStart, "MANUAL");
    assert.equal(assignment.protocolDate, "2026-10-04");
    if (!assignment.templateId.endsWith("protocol"))
      assert.equal(assignment.documentDate, "2026-10-05");
  }
  assert.equal(next.items[0].fullNameKz, "Сохраненное Имя");
});
