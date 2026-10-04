import test from "node:test";
import assert from "node:assert/strict";
import { draftSchema, type TrainingDirection } from "@demo/contracts";
import {
  draftPayload,
  newRecipient,
  type Assignment,
  type Draft,
} from "../lib/types";
import { assignTrainingBundle } from "../lib/request-bundles";
import { trainingRemovalTarget } from "../lib/training-removal";

function fixture(direction: TrainingDirection = "BIOT"): Draft {
  const draft: Draft = {
    ...draftSchema.parse({
      kind: "PERSON",
      schemaVersion: 2,
      items: ["one", "two"].map((id) => ({
        ...newRecipient(),
        id,
        assignments: [],
      })),
    }),
    id: "request",
    revision: 0,
    status: "DRAFT",
  };
  return assignTrainingBundle(draft, ["one", "two"], direction);
}
const target = (draft: Draft, direction: TrainingDirection = "BIOT") =>
  trainingRemovalTarget(draft, direction, ["one", "two"], false);

for (const direction of ["BIOT", "PTM", "PB", "PS"] as const)
  test(`${direction}: untouched standard positive defaults do not protect an otherwise empty training group`, () => {
    const draft = fixture(direction);
    assert.equal(draft.items[0].assignments[0].outcome?.status, "PASSED");
    assert.equal(target(draft, direction).protected, false);
    const saved = draftSchema.parse(
      JSON.parse(JSON.stringify(draftPayload(draft))),
    );
    assert.equal(target({ ...draft, ...saved }, direction).protected, false);
  });

test("server attribution of an automatic default remains distinguishable from a recorded result", () => {
  const draft = fixture();
  draft.items[0].assignments[0].outcome = {
    ...draft.items[0].assignments[0].outcome!,
    confirmedBy: "operator",
    confirmedAt: "2026-10-04T00:00:00Z",
  };
  assert.equal(target(draft).protected, false);
  draft.items[0].assignments[0].fieldOrigins!.outcome = "MANUAL";
  assert.equal(target(draft).protected, true);
});

test("recorded/imported outcomes, custom assessments and real BiOT fields retain removal protection", () => {
  const patches: Partial<Assignment>[] = [
    { outcome: { status: "PASSED", source: "Реальная ведомость" } },
    { outcome: { status: "FAILED", source: "Реальная ведомость" } },
    { outcome: { status: "ABSENT", source: "Реальная ведомость" } },
    { result: "30/100" },
    { resultKz: "Нақты баға" },
    { resultEn: "Actual assessment" },
    { biotKnowledgeResult: "62 балла" },
    { biotProctoringResult: "Реальный результат прокторинга" },
    { biotUniqueNumber: "000071" },
    { biotNotes: "Введённое примечание" },
    { externalBasisNumber: "Ведомость-7" },
    { trainingSubject: "Индивидуальная программа" },
  ];
  for (const patch of patches) {
    const draft = fixture();
    Object.assign(draft.items[0].assignments[0], patch);
    assert.equal(target(draft).protected, true, JSON.stringify(patch));
  }
  for (const origin of ["MANUAL", "IMPORTED", "CLEARED"] as const) {
    const draft = fixture();
    draft.items[0].assignments[0].fieldOrigins!.outcome = origin;
    assert.equal(target(draft).protected, true, origin);
  }
});

test("manual text equal to the standard wording and explicitly cleared values are still protected", () => {
  for (const origin of ["MANUAL", "IMPORTED", "CLEARED"] as const) {
    const draft = fixture();
    draft.items[0].assignments[0].fieldOrigins!.result = origin;
    if (origin === "CLEARED") draft.items[0].assignments[0].result = "";
    assert.equal(target(draft).protected, true);
  }
});

test("explicit common hours and legacy manual hour markers remain protected even when equal to defaults", () => {
  const cleared = fixture();
  cleared.events![0].commonFields.hours = "";
  cleared.events![0].commonFields.fieldOrigins = { hours: "CLEARED" };
  assert.equal(target(cleared).protected, true);
  const legacy = fixture();
  legacy.items[0].assignments[0].biotManualFields = ["hours"];
  assert.equal(legacy.items[0].assignments[0].hours, "10");
  assert.equal(target(legacy).protected, true);
});
