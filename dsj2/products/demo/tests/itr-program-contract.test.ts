import test from "node:test";
import assert from "node:assert/strict";
import {
  applyBusinessRules,
  draftSchema,
  profileSchema,
  resolveDraft,
  validateDraft,
  isSpecialBiotCategory,
} from "../packages/contracts/src";
import { newAssignment, newRecipient } from "../apps/web/lib/types";
import {
  updateAssignment,
  updateCommonBiotCategory,
} from "../apps/web/lib/assignment-presets";
import { newRequestBundle } from "../apps/web/lib/request-bundles";

const profile = profileSchema.parse({
  nameRu: "Учебный центр для синтетической проверки",
  cityRu: "Тестовый город",
  approved: true,
  commission: ["Председатель", "Первый член", "Второй член"].map((name) => ({
    name,
    position: "Член комиссии",
  })),
});

function ordinaryItr(kind: "PERSON" | "COMPANY" = "PERSON") {
  return draftSchema.parse({
    kind,
    schemaVersion: 2,
    customerId: kind === "COMPANY" ? "synthetic-customer" : undefined,
    commonFields: { documentDate: "2026-10-05" },
    items: [
      {
        ...newRecipient(),
        fullNameRu: "Синтетический Получатель",
        positionRu: "Инженер",
        workplaceRu: "Синтетический работодатель",
        employeeCategory: "ITR",
        assignments: [newAssignment("biot-itr-certificate")],
      },
    ],
  });
}

for (const kind of ["PERSON", "COMPANY"] as const)
  test(`${kind}: ordinary ITR is complete without special industry, employer BIN/address or assessment facts`, () => {
    const raw = ordinaryItr(kind);
    const saved = draftSchema.parse(
      JSON.parse(JSON.stringify(applyBusinessRules(raw))),
    );
    const before = structuredClone(saved);
    const resolved = resolveDraft(saved);
    assert.deepEqual(saved, before);
    assert.deepEqual(validateDraft(resolved.draft, profile), []);
    assert.equal(resolved.draft.items[0].assignments.length, 2);
    for (const assignment of resolved.draft.items[0].assignments) {
      assert.equal(assignment.biotCategory, "ITR_STANDARD");
      assert.equal(isSpecialBiotCategory(assignment.biotCategory), false);
      assert.equal(assignment.hours, "40");
      assert.equal(assignment.outcome?.status, "PASSED");
      assert.equal(assignment.trainingSubject, "Безопасность и охрана труда");
      assert.equal(
        assignment.trainingSubjectKz,
        "Еңбек қауіпсіздігі және еңбекті қорғау",
      );
      assert.equal(assignment.resultKz, "Өтті");
      assert.equal(assignment.biotKnowledgeResult, undefined);
      assert.equal(assignment.biotProctoringResult, undefined);
    }
  });

test("explicit SPECIAL remains special and direct contract validation still demands its real facts", () => {
  const raw = ordinaryItr();
  Object.assign(raw.items[0].assignments[0], {
    biotCategory: "OHS_SPECIALIST_SPECIAL",
    fieldOrigins: { biotCategory: "MANUAL", hours: "AUTO" },
  });
  const resolved = resolveDraft(applyBusinessRules(raw));
  assert.ok(
    resolved.draft.items[0].assignments.every(
      (a) => a.biotCategory === "OHS_SPECIALIST_SPECIAL",
    ),
  );
  const issues = validateDraft(resolved.draft, profile);
  for (const field of [
    "biotIndustryRu",
    "employerBin",
    "employerAddressRu",
    "biotKnowledgeResult",
    "biotProctoringResult",
  ])
    assert.ok(
      issues.some((issue) => issue.path.endsWith(`.${field}`)),
      field,
    );
  assert.ok(issues.some((issue) => issue.path === "issuer.bin"));
  assert.ok(issues.some((issue) => issue.path === "issuer.headName"));
});

test("legacy saved SPECIAL and every actual outcome survive category normalization and linked-form creation", () => {
  for (const status of ["UNKNOWN", "FAILED", "ABSENT"] as const) {
    const raw = ordinaryItr();
    Object.assign(raw.items[0].assignments[0], {
      biotCategory: "OHS_SPECIALIST_SPECIAL",
      fieldOrigins: { biotCategory: "AUTO", outcome: "IMPORTED" },
      outcome: { status, source: "Сохранённый источник" },
    });
    const resolved = resolveDraft(applyBusinessRules(raw));
    for (const assignment of resolved.draft.items[0].assignments) {
      assert.equal(assignment.biotCategory, "OHS_SPECIALIST_SPECIAL");
      assert.equal(assignment.outcome?.status, status);
      assert.equal(assignment.outcome?.source, "Сохранённый источник");
    }
  }
});

test("category transitions preserve explicitly cleared and imported hours even when they equal the former default", () => {
  for (const origin of ["MANUAL", "IMPORTED", "CLEARED"] as const) {
    const assignment = {
      ...newAssignment("biot-worker-card"),
      hours: origin === "CLEARED" ? "" : "10",
      productionHours: origin === "CLEARED" ? "" : "16",
      fieldOrigins: { hours: origin, productionHours: origin },
    };
    const updated = updateAssignment(assignment, {
      templateId: "biot-itr-certificate",
    });
    assert.equal(updated.hours, assignment.hours);
    assert.equal(updated.productionHours, assignment.productionHours);
    const raw = ordinaryItr();
    raw.items[0].assignments = [assignment];
    const normalized = applyBusinessRules(raw).items[0].assignments;
    for (const form of normalized) {
      assert.equal(form.hours, assignment.hours);
      assert.equal(form.productionHours, assignment.productionHours);
    }
  }
});

test("technical empty shared values inherit while explicit clears survive through the saved payload", () => {
  const raw = ordinaryItr();
  raw.commonFields = {
    documentDate: "",
    trainingSubject: " \u200b",
    hours: "",
    professionRu: "",
  };
  const center = {
    documentDate: "2026-10-05",
    trainingSubject: "Программа центра",
    hours: "48",
    professionRu: "Инженер",
  };
  let resolved = resolveDraft(raw, center);
  assert.equal(
    resolved.draft.items[0].assignments[0].documentDate,
    center.documentDate,
  );
  assert.equal(
    resolved.draft.items[0].assignments[0].trainingSubject,
    center.trainingSubject,
  );
  assert.equal(resolved.draft.items[0].assignments[0].hours, center.hours);
  assert.equal(
    resolved.draft.items[0].assignments[0].professionRu,
    center.professionRu,
  );
  raw.commonFields.fieldOrigins = {
    documentDate: "CLEARED",
    trainingSubject: "CLEARED",
    hours: "CLEARED",
    professionRu: "CLEARED",
  };
  resolved = resolveDraft(
    draftSchema.parse(JSON.parse(JSON.stringify(raw))),
    center,
  );
  for (const field of [
    "documentDate",
    "trainingSubject",
    "hours",
    "professionRu",
  ] as const) {
    assert.equal(resolved.draft.items[0].assignments[0][field], "");
    assert.equal(Object.values(resolved.provenance)[0][field], "CLEARED");
  }
});

test("course result RU/KZ defaults repair only unprotected blanks and retain imported or cleared wording", () => {
  for (const status of ["PASSED", "UNKNOWN", "FAILED", "ABSENT"] as const)
    for (const origin of ["MANUAL", "IMPORTED", "CLEARED"] as const) {
      const raw = ordinaryItr();
      const assignment = raw.items[0].assignments[0];
      assignment.outcome = { status, source: "Сохранённый источник" };
      assignment.result = origin === "CLEARED" ? "" : "Проверенный результат";
      assignment.resultKz = origin === "CLEARED" ? "" : "Тексерілген нәтиже";
      assignment.fieldOrigins = { result: origin, resultKz: origin };
      const resolved = resolveDraft(raw);
      const actual = resolved.draft.items[0].assignments[0];
      assert.equal(actual.result, assignment.result);
      assert.equal(actual.resultKz, assignment.resultKz);
      assert.equal(Object.values(resolved.provenance)[0].result, origin);
      assert.equal(Object.values(resolved.provenance)[0].resultKz, origin);
    }
  const raw = ordinaryItr();
  raw.items[0].assignments[0].resultKz = "";
  delete raw.items[0].assignments[0].fieldOrigins?.resultKz;
  assert.equal(
    resolveDraft(raw).draft.items[0].assignments[0].resultKz,
    "Өтті",
  );
});

test("changing the shared ITR program selects the effective program in every linked form without replacing protected hours", () => {
  for (const mode of ["GROUP", "INDIVIDUAL"] as const) {
    let raw = draftSchema.parse({
      kind: "PERSON",
      schemaVersion: 2,
      commonFields: { documentDate: "2026-10-05" },
      ...newRequestBundle("ITR"),
    });
    raw.events![0].protocolMode = mode;
    raw.events![0].protocolModeSource = "MANUAL";
    for (const category of [
      "OHS_SPECIALIST_SPECIAL",
      "MANAGER_GENERAL",
      "ITR_STANDARD",
    ] as const) {
      raw.events![0].commonFields = updateCommonBiotCategory(
        raw.events![0].commonFields,
        category,
      );
      raw = applyBusinessRules(raw);
      const resolved = resolveDraft(raw);
      for (const assignment of resolved.draft.items[0].assignments) {
        assert.equal(assignment.biotCategory, category);
        assert.equal(
          assignment.hours,
          category === "MANAGER_GENERAL" ? "16" : "40",
        );
      }
      assert.deepEqual(resolved.issues, []);
    }
    for (const origin of ["MANUAL", "IMPORTED", "CLEARED"] as const) {
      const before = {
        ...raw.events![0].commonFields,
        hours: origin === "CLEARED" ? "" : "40",
        fieldOrigins: { hours: origin },
      };
      assert.equal(
        updateCommonBiotCategory(before, "MANAGER_GENERAL").hours,
        before.hours,
      );
    }
  }
});

test("a new automatic credential inherits a saved companion outcome instead of replacing it with PASSED", () => {
  for (const status of ["UNKNOWN", "FAILED", "ABSENT", "PASSED"] as const) {
    const raw = ordinaryItr();
    raw.items[0].assignments.push({
      ...newAssignment("biot-itr-protocol"),
      outcome: { status, source: "Ранее сохранённый фактический исход" },
      result: "",
      resultKz: "",
      fieldOrigins: { outcome: "IMPORTED" },
    });
    const resolved = resolveDraft(applyBusinessRules(raw));
    for (const assignment of resolved.draft.items[0].assignments) {
      assert.equal(assignment.outcome?.status, status);
      assert.equal(
        assignment.outcome?.source,
        "Ранее сохранённый фактический исход",
      );
      assert.equal(assignment.fieldOrigins?.outcome, "IMPORTED");
    }
  }
});

test("contradicting saved manual outcomes remain visible and block a course until explicitly reconciled", () => {
  const raw = ordinaryItr();
  raw.items[0].assignments[0].fieldOrigins = { outcome: "MANUAL" };
  raw.items[0].assignments.push({
    ...newAssignment("biot-itr-protocol"),
    outcome: { status: "FAILED", source: "Сохранённый источник протокола" },
    fieldOrigins: { outcome: "IMPORTED" },
  });
  const saved = applyBusinessRules(raw);
  assert.deepEqual(
    saved.items[0].assignments.map((a) => a.outcome?.status),
    ["PASSED", "FAILED"],
  );
  assert.ok(
    validateDraft(resolveDraft(saved).draft, profile).some(
      (issue) => issue.code === "TRAINING_OUTCOME_CONFLICT",
    ),
  );
});
