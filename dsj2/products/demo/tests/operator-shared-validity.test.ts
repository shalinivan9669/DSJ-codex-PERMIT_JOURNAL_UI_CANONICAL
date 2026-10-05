import test from "node:test";
import assert from "node:assert/strict";
import {
  BIOT_CATEGORIES,
  applyBusinessRules,
  biotCategoryIds,
  businessValidUntil,
  draftSchema,
  eventProtocolAssignment,
  resolveDraft,
  validateBusinessRules,
  type CommonFields,
  type TrainingDateRule,
} from "../packages/contracts/src";

const schedule: TrainingDateRule = {
  hoursPerDay: 8,
  hoursSource: "THEORY",
  calendar: "CALENDAR",
  anchor: "DOCUMENT_AFTER_TRAINING",
  protocolDate: "DOCUMENT_DATE",
  source: "Синтетический график центра для теста наследования",
};

function source(commonFields: CommonFields = {}, grouped = false) {
  return draftSchema.parse({
    kind: "PERSON",
    schemaVersion: 2,
    commonFields: { documentDate: "2028-02-29" },
    events: [
      {
        id: "course",
        title: "БиОТ ИТР",
        protocolTemplateId: "biot-itr-protocol",
        protocolMode: grouped ? "GROUP" : "INDIVIDUAL",
        commonFields,
      },
    ],
    items: [
      {
        id: "person",
        fullNameRu: "Синтетический Получатель",
        employeeCategory: "ITR",
        assignments: [
          {
            id: "card",
            templateId: "biot-itr-certificate",
            eventId: "course",
            protocolMode: grouped ? "GROUP" : "INDIVIDUAL",
            hours: "40",
            biotCategory: "INSPECTOR_SPECIAL",
            fieldOrigins: { hours: "AUTO", biotCategory: "AUTO" },
            outcome: { status: "PASSED", source: "Стандартный исход теста" },
            result: "Сдал",
          },
        ],
      },
    ],
  });
}

test("the confirmed LIVE policy uses 1/3 years for every BiOT category across normalizer, resolver and group projection", () => {
  for (const biotCategory of biotCategoryIds)
    for (const grouped of [false, true]) {
      const input = source({}, grouped);
      const category = BIOT_CATEGORIES[biotCategory].form;
      input.items[0].employeeCategory = category;
      Object.assign(input.items[0].assignments[0], {
        templateId:
          category === "WORKER" ? "biot-worker-card" : "biot-itr-certificate",
        biotCategory,
      });
      input.events![0].protocolTemplateId =
        category === "WORKER" ? "biot-protocol" : "biot-itr-protocol";
      const before = structuredClone(input);
      const saved = applyBusinessRules(input);
      const result = resolveDraft(
        draftSchema.parse(JSON.parse(JSON.stringify(saved))),
      );
      const forms = [...result.draft.items[0].assignments];
      if (grouped)
        forms.push(
          eventProtocolAssignment(result.draft.events![0], forms[0], true),
        );
      for (const assignment of forms) {
        assert.equal(
          assignment.validUntil,
          businessValidUntil(assignment.documentDate, category),
        );
        assert.equal(assignment.fieldOrigins?.validUntil, "AUTO");
      }
      assert.deepEqual(validateBusinessRules(result.draft), []);
      assert.deepEqual(
        input,
        before,
        "no saved input or historical payload was mutated",
      );
    }
});

test("assignment validity exceptions and legacy manual markers survive normalization, issue-date changes and reload", () => {
  for (const origin of ["MANUAL", "IMPORTED", "CLEARED"] as const) {
    const input = source();
    Object.assign(input.items[0].assignments[0], {
      validUntil: origin === "CLEARED" ? "" : "2035-12-31",
      fieldOrigins: { validUntil: origin },
    });
    let saved = applyBusinessRules(input);
    saved.commonFields!.documentDate = "2029-01-31";
    saved = draftSchema.parse(
      JSON.parse(JSON.stringify(applyBusinessRules(saved))),
    );
    const result = resolveDraft(saved);
    for (const assignment of result.draft.items[0].assignments) {
      assert.equal(
        assignment.validUntil,
        origin === "CLEARED" ? "" : "2035-12-31",
      );
      assert.equal(
        result.provenance[`person:${assignment.id}`].validUntil,
        origin,
      );
    }
    assert.equal(
      validateBusinessRules(result.draft).some(
        (i) => i.code === "BUSINESS_VALIDITY_MISMATCH",
      ),
      origin === "CLEARED",
    );
  }
  const legacy = source();
  Object.assign(legacy.items[0].assignments[0], {
    validUntil: "2034-01-01",
    biotManualFields: ["validUntil"],
    fieldOrigins: { validUntil: "AUTO" },
  });
  assert.equal(
    resolveDraft(applyBusinessRules(legacy)).draft.items[0].assignments[0]
      .validUntil,
    "2034-01-01",
  );
});

test("explicit shared expiry is inherited at every context level without overwriting individual exceptions", () => {
  for (const scope of ["center", "preset", "request", "event"] as const)
    for (const origin of ["MANUAL", "IMPORTED", "CLEARED"] as const) {
      const input = source();
      const shared: CommonFields = {
        validUntil: origin === "CLEARED" ? "" : "2032-01-31",
        dateOrigins: { validUntil: origin },
      };
      if (scope === "preset") input.presetFields = shared;
      if (scope === "request") Object.assign(input.commonFields!, shared);
      if (scope === "event") input.events![0].commonFields = shared;
      const saved = applyBusinessRules(input);
      const result = resolveDraft(saved, scope === "center" ? shared : {});
      for (const assignment of result.draft.items[0].assignments)
        assert.equal(
          assignment.validUntil,
          shared.validUntil,
          `${scope} ${origin}`,
        );
      assert.equal(
        validateBusinessRules(result.draft).some(
          (i) => i.code === "BUSINESS_VALIDITY_MISMATCH",
        ),
        origin === "CLEARED",
      );
      Object.assign(saved.items[0].assignments[0], {
        validUntil: "2036-01-01",
        fieldOrigins: { validUntil: "MANUAL" },
      });
      assert.equal(
        resolveDraft(saved, scope === "center" ? shared : {}).draft.items[0]
          .assignments[0].validUntil,
        "2036-01-01",
      );
    }
});

test("unprotected expiry recalculates at leap, month and year boundaries, and a restored explicit expiry returns to AUTO", () => {
  const input = source();
  const saved = applyBusinessRules(input);
  for (const [date, expected] of [
    ["2028-02-29", "2031-02-28"],
    ["2026-01-31", "2029-01-31"],
    ["2026-12-31", "2029-12-31"],
  ]) {
    saved.commonFields!.documentDate = date;
    for (const assignment of saved.items[0].assignments) {
      assignment.validUntil = "";
      assignment.fieldOrigins = {
        ...assignment.fieldOrigins,
        validUntil: "AUTO",
      };
    }
    assert.equal(
      resolveDraft(saved).draft.items[0].assignments[0].validUntil,
      expected,
    );
  }
});

test("factual ITR text is entered once, individual facts and clears stay distinct, and new English fields are discarded", () => {
  const input = source(
    {
      biotKnowledgeResult: "Сдал",
      biotKnowledgeResultEn: "Passed",
      biotProctoringResult: "Проверено по фактической ведомости",
      biotProctoringResultEn: "Reviewed against source",
      biotIndustryRu: "Указанная оператором отрасль",
      fieldOrigins: {
        biotKnowledgeResult: "MANUAL",
        biotProctoringResult: "MANUAL",
      },
    },
    true,
  );
  input.items.push({ ...structuredClone(input.items[0]), id: "exception" });
  Object.assign(input.items[1].assignments[0], {
    biotKnowledgeResult: "92 из 100",
    biotKnowledgeResultEn: "92 of 100",
    biotProctoringResult: "",
    fieldOrigins: {
      biotKnowledgeResult: "IMPORTED",
      biotKnowledgeResultEn: "IMPORTED",
      biotProctoringResult: "CLEARED",
    },
  });
  const result = resolveDraft(applyBusinessRules(input));
  assert.deepEqual(result.issues, []);
  assert.equal(
    result.draft.items[0].assignments[0].biotKnowledgeResult,
    "Сдал",
  );
  const exception = result.draft.items[1].assignments[0];
  assert.equal(exception.biotKnowledgeResult, "92 из 100");
  assert.equal(exception.biotKnowledgeResultEn, undefined);
  assert.equal(exception.biotProctoringResult, "");
  const projected = eventProtocolAssignment(
    result.draft.events![0],
    exception,
    true,
  );
  assert.equal(projected.biotKnowledgeResult, "92 из 100");
  assert.equal(projected.biotProctoringResult, "");
  assert.equal(
    resolveDraft(applyBusinessRules(source())).draft.items[0].assignments[0]
      .biotProctoringResult,
    undefined,
    "never fabricate proctoring",
  );
});

test("saved centre schedule automatically drives linked forms; an explicit disabled rule remains disabled", () => {
  const input = source();
  const result = resolveDraft(applyBusinessRules(input), {
    trainingDateRule: schedule,
  });
  for (const assignment of result.draft.items[0].assignments) {
    assert.equal(assignment.trainingStart, "2028-02-24");
    assert.equal(assignment.trainingEnd, "2028-02-28");
    assert.equal(assignment.protocolDate, "2028-02-29");
    assert.equal(assignment.validUntil, "2031-02-28");
  }
  input.events![0].commonFields.trainingDateRule = null;
  assert.equal(
    resolveDraft(applyBusinessRules(input), { trainingDateRule: schedule })
      .draft.items[0].assignments[0].trainingStart,
    "",
  );
});

test("a shared assessment does not supply positive facts to failed absent or pending recipients", () => {
  for (const status of ["FAILED", "ABSENT", "UNKNOWN"] as const) {
    const input = source(
      {
        biotKnowledgeResult: "Сдал",
        biotKnowledgeResultEn: "Passed",
        biotProctoringResult: "Проверен",
        biotProctoringResultEn: "Verified",
      },
      true,
    );
    input.items[0].assignments[0].outcome = {
      status,
      source: "Явное исключение",
    };
    const result = resolveDraft(applyBusinessRules(input)).draft.items[0]
      .assignments[0];
    for (const key of [
      "biotKnowledgeResult",
      "biotKnowledgeResultEn",
      "biotProctoringResult",
      "biotProctoringResultEn",
    ] as const)
      assert.equal(result[key], key.endsWith("En") ? undefined : "");
    Object.assign(input.items[0].assignments[0], {
      biotKnowledgeResult: "30 из 100",
      fieldOrigins: { biotKnowledgeResult: "IMPORTED" },
    });
    assert.equal(
      resolveDraft(applyBusinessRules(input)).draft.items[0].assignments[0]
        .biotKnowledgeResult,
      "30 из 100",
    );
  }
});

test("PS uses one course profession and qualification across its three forms without conflating explicit values", () => {
  const input = draftSchema.parse({
    kind: "PERSON",
    schemaVersion: 2,
    commonFields: { documentDate: "2026-10-04" },
    events: [
      {
        id: "ps",
        title: "ПС",
        protocolTemplateId: "ps-protocol",
        protocolMode: "INDIVIDUAL",
        commonFields: {
          professionRu: "Машинист",
          professionKz: "Машинист",
          psQualificationRu: "Машинист 4 разряда",
          psQualificationKz: "4 разрядты машинист",
          fieldOrigins: { professionRu: "MANUAL", psQualificationRu: "MANUAL" },
        },
      },
    ],
    items: [
      {
        id: "person",
        employeeCategory: "WORKER",
        positionRu: "Другая исходная должность",
        assignments: [
          {
            id: "ps-card",
            templateId: "ps-card",
            eventId: "ps",
            outcome: { status: "PASSED", source: "Стандарт теста" },
          },
        ],
      },
    ],
  });
  const result = resolveDraft(applyBusinessRules(input)).draft;
  assert.equal(result.items[0].assignments.length, 3);
  for (const assignment of result.items[0].assignments) {
    assert.equal(assignment.professionRu, "Машинист");
    assert.equal(assignment.psQualificationRu, "Машинист 4 разряда");
    assert.equal(assignment.validityMode, "UNLIMITED");
    assert.equal(assignment.validUntil, "");
  }
  assert.equal(result.items[0].positionRu, "Другая исходная должность");
});
