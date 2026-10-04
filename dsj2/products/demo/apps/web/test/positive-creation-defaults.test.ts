import test from "node:test";
import assert from "node:assert/strict";
import {
  applyBusinessRules,
  draftSchema,
  isTechnicalBlankRow,
  resolveDraft,
  DEFAULT_POSITIVE_OUTCOME_SOURCE,
} from "@demo/contracts";
import { newAssignment, newRecipient } from "../lib/types";
import {
  assignTrainingBundle,
  newRequestBundle,
  recipientForRequest,
} from "../lib/request-bundles";
import { updateAssignment } from "../lib/assignment-presets";
import { eligibleForEvent, joinEventAssignment } from "../lib/event-assignment";

for (const [template, result, resultKz] of [
  ["biot-worker-card", "Өтті/прошел", "Өтті"],
  ["biot-itr-certificate", "Өтті/прошел", "Өтті"],
  ["ptm-card", "Прошел/ Өтті", "Өтті"],
  ["pb-card", "Тапсырды/сдал", "Тапсырды"],
  ["ps-card", "Сдал/Тапсырды", "Тапсырды"],
  ["ps-witness", "Сдал/Тапсырды", "Тапсырды"],
] as const) {
  test(`${template}: new positive result has honest provenance and survives resolution/reload`, () => {
    const assignment = newAssignment(template);
    assert.equal(assignment.result, result);
    assert.equal(assignment.resultKz, resultKz);
    assert.deepEqual(assignment.outcome, {
      status: "PASSED",
      source: DEFAULT_POSITIVE_OUTCOME_SOURCE,
    });
    assert.equal(assignment.fieldOrigins?.outcome, "AUTO");
    assert.equal(assignment.fieldOrigins?.result, "COURSE");
    assert.equal(assignment.fieldOrigins?.resultKz, "COURSE");
    assert.equal(assignment.documentDate, "");
    assert.equal(assignment.externalBasisNumber, "");
    const draft = draftSchema.parse({
      kind: "PERSON",
      items: [
        {
          ...newRecipient(),
          fullNameRu: "Синтетический Получатель",
          assignments: [assignment],
        },
      ],
    });
    const resolved = resolveDraft(draft).draft;
    assert.equal(resolved.items[0].assignments[0].result, result);
    assert.equal(resolved.items[0].assignments[0].resultKz, resultKz);
    assert.deepEqual(
      draftSchema.parse(JSON.parse(JSON.stringify(draft))).items[0]
        .assignments[0].outcome,
      assignment.outcome,
    );
  });
}

test("automatic positive metadata does not make an empty spare row substantive; manual outcomes and texts do", () => {
  const row = newRecipient();
  assert.equal(isTechnicalBlankRow(row), true);
  row.assignments[0].outcome = {
    ...row.assignments[0].outcome!,
    confirmedBy: "manager",
    confirmedAt: "2026-10-04T00:00:00Z",
  };
  assert.equal(isTechnicalBlankRow(row), true);
  assert.equal(eligibleForEvent(row.assignments[0], "biot-worker-card"), true);
  assert.equal(
    isTechnicalBlankRow({
      ...row,
      assignments: [
        updateAssignment(row.assignments[0], {
          outcome: { status: "UNKNOWN", source: "" },
        }),
      ],
    }),
    false,
  );
  assert.equal(
    isTechnicalBlankRow({
      ...row,
      assignments: [
        updateAssignment(row.assignments[0], {
          result: "Индивидуальная оценка 85/100",
        }),
      ],
    }),
    false,
  );
  assert.equal(
    isTechnicalBlankRow({
      ...row,
      assignments: [
        {
          ...row.assignments[0],
          result: "Особый импортированный результат",
          fieldOrigins: { result: "IMPORTED" },
        },
      ],
    }),
    false,
  );
});

for (const status of ["UNKNOWN", "FAILED", "ABSENT"] as const) {
  test(`existing ${status} appointments are preserved when adding another course or recipient`, () => {
    const seed = newRequestBundle("WORKER");
    const previous = updateAssignment(seed.items[0].assignments[0], {
      outcome: {
        status,
        source:
          status === "UNKNOWN" ? "" : "Фактическая синтетическая ведомость",
      },
      result: "Особый сохранённый текст",
      resultKz: "Сақталған мәтін",
    });
    let draft = {
      ...draftSchema.parse({
        kind: "PERSON",
        ...seed,
        items: [
          {
            ...seed.items[0],
            fullNameRu: "Синтетический Получатель",
            assignments: [previous],
          },
        ],
      }),
      id: "request",
      revision: 1,
      status: "DRAFT",
    };
    draft = applyBusinessRules(draft);
    const before = structuredClone(draft.items[0].assignments);
    const added = assignTrainingBundle(
      draft,
      [draft.items[0].id],
      "PTM",
      "INDIVIDUAL",
      true,
    );
    assert.deepEqual(
      added.items[0].assignments.filter((a) =>
        before.some((old) => old.id === a.id),
      ),
      before,
    );
    assert.deepEqual(
      recipientForRequest(added, added.items[0]),
      added.items[0],
    );
    assert.equal(
      joinEventAssignment(previous, "another-event").outcome?.status,
      status,
    );
    assert.equal(
      updateAssignment(previous, { trainingSubject: "Новая программа" }).outcome
        ?.status,
      status,
    );
    const rawNew = recipientForRequest(added);
    assert.ok(
      rawNew.assignments.every(
        (a) =>
          a.outcome?.status === "PASSED" &&
          a.outcome.source === DEFAULT_POSITIVE_OUTCOME_SOURCE,
      ),
    );
  });
}
