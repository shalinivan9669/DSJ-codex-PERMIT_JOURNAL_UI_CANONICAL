import test from "node:test";
import assert from "node:assert/strict";
import {
  applyBusinessRules,
  courseProgramDefaults,
  courseResultText,
  draftSchema,
  documentPlan,
  LEGACY_PB_PROGRAM,
  DEFAULT_POSITIVE_OUTCOME_SOURCE,
  resolveDraft,
} from "../packages/contracts/src";
import { newAssignment, newRecipient } from "../apps/web/lib/types";
import { assignTrainingBundle } from "../apps/web/lib/request-bundles";
import { applyEventOutcomes } from "../apps/web/lib/event-outcomes";
import { updateAssignment } from "../apps/web/lib/assignment-presets";

for (const kind of ["PERSON", "COMPANY"] as const)
  for (const mode of ["GROUP", "INDIVIDUAL"] as const)
    test(`${kind} ${mode}: each course has its own program, truthful outcome and linked forms`, () => {
      const base = draftSchema.parse({
        kind,
        schemaVersion: 2,
        events: [],
        items: [newRecipient(), newRecipient()].map((row) => ({
          ...row,
          fullNameRu: "Синтетический получатель",
          assignments: [],
        })),
      });
      let draft = { ...base, id: "request", revision: 0, status: "DRAFT" };
      for (const direction of ["BIOT", "PTM", "PB", "PS"] as const)
        draft = assignTrainingBundle(
          draft,
          draft.items.map((row) => row.id),
          direction,
          mode,
        );
      const created = resolveDraft(draft);
      for (const item of created.draft.items)
        for (const assignment of item.assignments) {
          assert.equal(assignment.outcome?.status, "PASSED");
          assert.equal(
            assignment.outcome?.source,
            DEFAULT_POSITIVE_OUTCOME_SOURCE,
          );
          assert.equal(assignment.fieldOrigins?.outcome, "AUTO");
        }
      for (const event of draft.events || [])
        draft.items = applyEventOutcomes(
          draft,
          event.id,
          draft.items.map((row) => row.id),
          { status: "UNKNOWN", source: "Явно ожидает сдачи" },
        );
      const unknown = resolveDraft(draft);
      assert.equal(
        documentPlan(unknown.draft).individuals.some(
          (entry) => !entry.assignment.templateId.endsWith("-protocol"),
        ),
        false,
      );
      for (const event of draft.events || [])
        draft.items = applyEventOutcomes(
          draft,
          event.id,
          draft.items.map((row) => row.id),
          { status: "PASSED", source: "Проверенная ведомость" },
        );
      const resolved = resolveDraft(draft);
      for (const item of resolved.draft.items)
        for (const assignment of item.assignments) {
          assert.equal(
            assignment.trainingSubject,
            courseProgramDefaults(assignment.templateId).trainingSubject,
          );
          assert.equal(
            assignment.result,
            courseResultText(assignment.templateId, "PASSED"),
          );
          assert.equal(
            resolved.provenance[`${item.id}:${assignment.id}`].trainingSubject,
            "COURSE",
          );
          assert.equal(assignment.outcome?.source, "Проверенная ведомость");
          assert.equal(
            assignment.documentDate,
            "",
            "choosing a program never invents a date",
          );
          if (assignment.templateId.startsWith("ps-")) {
            assert.equal(assignment.psGeneralSubjectRu, "Общепроф. курс");
            assert.equal(assignment.psSpecialSubjectKz, "арнайы курс");
            assert.equal(assignment.result.includes("Хорошо"), false);
          }
        }
      assert.equal(
        resolved.draft.events?.find(
          (event) => event.protocolTemplateId === "pb-protocol",
        )?.commonFields.trainingSubject,
        LEGACY_PB_PROGRAM,
      );
    });

test("COURSE → centre → preset → request → event → MANUAL/IMPORTED/CLEARED priority survives reload and a second course", () => {
  let draft = draftSchema.parse({
    kind: "PERSON",
    schemaVersion: 2,
    presetFields: { trainingSubject: "Профиль" },
    commonFields: { trainingSubject: "Заявка" },
    events: [
      {
        id: "biot",
        title: "Курс",
        protocolTemplateId: "biot-protocol",
        protocolMode: "INDIVIDUAL",
        commonFields: { trainingSubject: "Событие" },
      },
    ],
    items: [
      {
        ...newRecipient(),
        assignments: [{ ...newAssignment(), eventId: "biot" }],
      },
    ],
  });
  const original = structuredClone(draft);
  assert.equal(
    resolveDraft(draft, { trainingSubject: "Центр" }).draft.items[0]
      .assignments[0].trainingSubject,
    "Событие",
  );
  for (const origin of ["MANUAL", "IMPORTED", "CLEARED"] as const) {
    draft = structuredClone(original);
    Object.assign(draft.items[0].assignments[0], {
      trainingSubject: origin === "CLEARED" ? "" : "Собственная тема",
      trainingSubjectKz: "Өз тақырыбы",
      fieldOrigins: { trainingSubject: origin, trainingSubjectKz: "MANUAL" },
    });
    const normalized = applyBusinessRules(JSON.parse(JSON.stringify(draft)));
    normalized.items[0].assignments.push(newAssignment("ptm-card"));
    const result = resolveDraft(applyBusinessRules(normalized));
    assert.equal(
      result.draft.items[0].assignments[0].trainingSubject,
      origin === "CLEARED" ? "" : "Собственная тема",
    );
    assert.equal(
      result.draft.items[0].assignments[0].trainingSubjectKz,
      "Өз тақырыбы",
    );
  }
  assert.deepEqual(
    original.items[0].assignments[0].trainingSubject,
    courseProgramDefaults("biot-worker-card").trainingSubject,
  );
});

test("three WORKER → ITR → WORKER cycles refresh automatic program and retain explicit facts", () => {
  let draft = applyBusinessRules(
    draftSchema.parse({ kind: "PERSON", items: [newRecipient()] }),
  );
  for (let cycle = 0; cycle < 3; cycle++) {
    draft.items[0].employeeCategory = "ITR";
    draft = applyBusinessRules(draft);
    const itr = resolveDraft(draft).draft.items[0].assignments[0];
    assert.equal(itr.trainingSubject, "Безопасность и охрана труда");
    assert.equal(
      itr.trainingSubjectKz,
      "Еңбек қауіпсіздігі және еңбекті қорғау",
    );
    draft.items[0].employeeCategory = "WORKER";
    draft = applyBusinessRules(draft);
    assert.equal(
      resolveDraft(draft).draft.items[0].assignments[0].trainingSubject,
      "Еқ және ЕҚ/БиОТ",
    );
  }
  draft.items[0].assignments[0] = updateAssignment(
    draft.items[0].assignments[0],
    {
      trainingSubject: "Ручная программа",
      result: "Подтверждённый особый текст",
      resultKz: "Расталған ерекше мәтін",
    },
  );
  draft.items[0].assignments[0].outcome = {
    status: "PASSED",
    source: "Источник",
  };
  draft.items[0].employeeCategory = "ITR";
  const actual = resolveDraft(applyBusinessRules(draft)).draft.items[0]
    .assignments[0];
  assert.equal(actual.trainingSubject, "Ручная программа");
  assert.equal(actual.result, "Подтверждённый особый текст");
  assert.equal(actual.resultKz, "Расталған ерекше мәтін");
});

test("non-passed outcomes replace every stale positive phrase even in individual protocol forms", () => {
  for (const status of ["UNKNOWN", "FAILED", "ABSENT"] as const) {
    const draft = applyBusinessRules(
      draftSchema.parse({
        kind: "PERSON",
        items: [
          {
            ...newRecipient(),
            assignments: [
              {
                ...newAssignment("ps-card"),
                result: "Хорошо / Жақсы",
                resultKz: "Жақсы",
                outcome: { status, source: "Ведомость" },
              },
            ],
          },
        ],
      }),
    );
    const actual = resolveDraft(draft).draft;
    for (const assignment of actual.items[0].assignments) {
      assert.equal(
        assignment.result,
        courseResultText(assignment.templateId, status),
      );
      assert.ok(!assignment.resultKz?.includes("Жақсы"));
    }
    assert.equal(
      documentPlan(actual).individuals.some(
        (entry) => !entry.assignment.templateId.endsWith("-protocol"),
      ),
      false,
    );
  }
});

test("automatic resolved events retain COURSE provenance and accept later profile changes without modifying input", () => {
  const draft = draftSchema.parse({
    kind: "PERSON",
    schemaVersion: 2,
    events: [
      {
        id: "ptm",
        title: "ПТМ",
        protocolTemplateId: "ptm-protocol",
        commonFields: {},
      },
    ],
    items: [
      {
        ...newRecipient(),
        assignments: [{ ...newAssignment("ptm-card"), eventId: "ptm" }],
      },
    ],
  });
  const first = resolveDraft(draft).draft;
  assert.equal(
    first.events?.[0].commonFields.fieldOrigins?.trainingSubject,
    "COURSE",
  );
  const second = resolveDraft(first, {
    trainingSubject: "Обновлённая программа центра",
  });
  assert.equal(
    second.draft.events?.[0].commonFields.trainingSubject,
    "Обновлённая программа центра",
  );
  assert.equal(first.events?.[0].commonFields.trainingSubject, "ПТМ");
});

test("a factual failed score remains saved while stale positive template grades are removed", () => {
  const draft = applyBusinessRules(
    draftSchema.parse({
      kind: "PERSON",
      items: [
        {
          ...newRecipient(),
          assignments: [
            {
              ...newAssignment("ps-card"),
              result: "30/100",
              fieldOrigins: { result: "MANUAL" },
              outcome: { status: "FAILED", source: "Фактическая ведомость" },
            },
          ],
        },
      ],
    }),
  );
  const actual = resolveDraft(draft).draft;
  assert.equal(actual.items[0].assignments[0].result, "30/100");
  assert.equal(actual.items[0].assignments[0].outcome?.status, "FAILED");
  assert.equal(
    documentPlan(actual).individuals.some(
      (entry) => entry.assignment.templateId === "ps-card",
    ),
    false,
  );
});

test("mixed courses preserve shared job, PS profession and separately awarded witness qualification after reload", () => {
  const ps = updateAssignment(newAssignment("ps-card"), {
    professionRu: "Машинист крана",
    professionKz: "Кран машинисі",
    psQualificationRu: "Машинист крана 5 разряда",
    psQualificationKz: "5 дәрежелі кран машинисі",
  });
  const draft = applyBusinessRules(
    draftSchema.parse({
      kind: "PERSON",
      items: [
        {
          ...newRecipient(),
          positionRu: "Инженер",
          positionKz: "Инженер",
          assignments: [ps, newAssignment("ptm-card")],
        },
      ],
    }),
  );
  const actual = resolveDraft(JSON.parse(JSON.stringify(draft))).draft;
  assert.equal(actual.items[0].positionRu, "Инженер");
  for (const assignment of actual.items[0].assignments) {
    if (assignment.templateId.startsWith("ps-")) {
      assert.equal(assignment.professionRu, "Машинист крана");
      assert.equal(assignment.psQualificationRu, "Машинист крана 5 разряда");
    } else {
      assert.equal(assignment.professionRu, undefined);
      assert.equal(assignment.psQualificationRu, undefined);
    }
  }
});
