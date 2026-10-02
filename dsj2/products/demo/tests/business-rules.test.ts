import test from "node:test";
import assert from "node:assert/strict";
import {
  applyBusinessRules,
  assignmentSchema,
  businessValidUntil,
  documentPlan,
  draftSchema,
  employeeCategoryFor,
  resolveDraft,
  roleSchema,
  profileSchema,
  validateBusinessRules,
} from "../packages/contracts/src";

function draft(
  category: "WORKER" | "ITR",
  templateId:
    | "biot-worker-card"
    | "biot-itr-certificate"
    | "ptm-card"
    | "pb-card"
    | "ps-card",
) {
  return draftSchema.parse({
    kind: "PERSON",
    schemaVersion: 2,
    commonFields: {
      documentDate: "2028-02-29",
      protocolDate: "2028-03-01",
      trainingSubject: "Обучение",
    },
    items: [
      {
        id: "person",
        employeeCategory: category,
        fullNameRu: "Тест Тестов",
        assignments: [
          assignmentSchema.parse({ id: "course", templateId, result: "Сдал" }),
        ],
      },
    ],
  });
}

test("LIVE_V1 mandatory kits include one protocol, category-specific BiOT and indefinite PS", () => {
  for (const category of ["WORKER", "ITR"] as const)
    for (const templateId of [
      "biot-worker-card",
      "ptm-card",
      "pb-card",
      "ps-card",
    ] as const) {
      const raw = draft(category, templateId);
      const normalized = applyBusinessRules(raw);
      const resolved = resolveDraft(normalized).draft;
      const assignments = resolved.items[0].assignments;
      assert.equal(normalized.businessRuleVersion, "LIVE_V1");
      assert.equal(normalized.englishAppendix, false);
      assert.equal(
        assignments.filter((a) => a.templateId.endsWith("-protocol")).length,
        1,
      );
      assert.equal(assignments.length, templateId === "ps-card" ? 3 : 2);
      assert.equal(assignments[0].documentDate, "2028-02-29");
      assert.equal(assignments.at(-1)?.documentDate, "2028-03-01");
      for (const assignment of assignments) {
        assert.equal(
          assignment.validityMode,
          templateId === "ps-card" ? "UNLIMITED" : "FIXED",
        );
        assert.equal(
          assignment.validUntil,
          templateId === "ps-card"
            ? ""
            : businessValidUntil(assignment.documentDate, category),
        );
      }
      if (templateId === "biot-worker-card")
        assert.equal(
          assignments[0].templateId,
          category === "ITR" ? "biot-itr-certificate" : "biot-worker-card",
        );
      assert.deepEqual(validateBusinessRules(resolved), []);
      assert.equal(
        raw.businessRuleVersion,
        undefined,
        "historical input is never mutated",
      );
      assert.deepEqual(
        applyBusinessRules(normalized),
        normalized,
        "normalization is stable on save/reload",
      );
    }
});

test("a legacy protocol or witness expands into mandatory kit without duplicate assignment identifiers", () => {
  for (const templateId of [
    "ptm-protocol",
    "pb-protocol",
    "ps-protocol",
    "ps-witness",
    "biot-protocol",
  ] as const) {
    const input = draft("WORKER", "ptm-card");
    input.items[0].assignments[0].templateId = templateId;
    const normalized = applyBusinessRules(input);
    assert.doesNotThrow(() => draftSchema.parse(normalized), templateId);
    assert.deepEqual(applyBusinessRules(normalized), normalized);
    assert.equal(
      normalized.items[0].assignments.find(
        (assignment) => assignment.templateId === templateId,
      )?.id,
      "course",
    );
  }
});

test("legacy category inference does not use a job-title guess and remains unchanged until opt-in", () => {
  const input = draft("ITR", "biot-itr-certificate");
  delete input.items[0].employeeCategory;
  input.items[0].positionRu = "Рабочий";
  assert.equal(employeeCategoryFor(input.items[0]), "ITR");
  assert.equal(resolveDraft(input).draft.businessRuleVersion, undefined);
  assert.deepEqual(validateBusinessRules(input), []);
  assert.equal(roleSchema.parse("DIRECTOR"), "DIRECTOR");
  assert.throws(() => roleSchema.parse("SUPERVISOR"));
});

test("individual issue dates differ within one shared protocol, while shared training conditions remain checked", () => {
  const input = draft("WORKER", "ps-card");
  input.events = [
    {
      id: "event",
      title: "ПС",
      protocolTemplateId: "ps-protocol",
      protocolMode: "GROUP",
      revision: 0,
      commonFields: {
        documentDate: "2028-03-01",
        protocolDate: "2028-03-01",
        trainingSubject: "Общая программа",
      },
    },
  ];
  input.items[0].assignments[0] = {
    ...input.items[0].assignments[0],
    eventId: "event",
    protocolMode: "GROUP",
    documentDate: "2028-03-02",
    fieldOrigins: { documentDate: "IMPORTED" },
    outcome: { status: "PASSED", source: "Ведомость" },
  };
  input.items.push({
    ...structuredClone(input.items[0]),
    id: "person-2",
    assignments: [
      {
        ...structuredClone(input.items[0].assignments[0]),
        id: "course-2",
        documentDate: "2028-03-03",
      },
    ],
  });
  const result = resolveDraft(applyBusinessRules(input));
  assert.deepEqual(result.issues, []);
  assert.equal(result.draft.items[0].assignments[0].documentDate, "2028-03-02");
  assert.equal(result.draft.items[1].assignments[0].documentDate, "2028-03-03");
  const plan = documentPlan(result.draft);
  assert.equal(plan.groups.length, 1);
  assert.equal(
    plan.groups[0].members.length,
    2,
    "PS card+witness is one roster participant",
  );
  assert.equal(plan.individuals.length, 4);
  assert.equal(plan.documentCount, 5);
  result.draft.items[0].assignments[0].trainingSubject = "Другая программа";
  result.draft.items[0].assignments[0].fieldOrigins = {
    trainingSubject: "MANUAL",
  };
  assert.ok(
    resolveDraft(result.draft).issues.some(
      (issue) => issue.code === "GROUP_COMMON_OVERRIDE",
    ),
  );
});

test("direct API input cannot drop required forms or fake an indefinite expiry", () => {
  const resolved = resolveDraft(
    applyBusinessRules(draft("WORKER", "ps-card")),
  ).draft;
  resolved.items[0].assignments.splice(1, 1);
  resolved.items[0].assignments[0].validUntil = "2099-12-31";
  const issues = validateBusinessRules(resolved);
  assert.ok(
    issues.some((issue) => issue.code === "MANDATORY_DOCUMENT_MISSING"),
  );
  assert.ok(
    issues.some((issue) => issue.code === "BUSINESS_VALIDITY_MISMATCH"),
  );
});

test("English appendix requires supplied English personal fields and program, preserving KZ/RU base", () => {
  const input = applyBusinessRules(draft("ITR", "ptm-card"));
  input.englishAppendix = true;
  assert.ok(
    validateBusinessRules(resolveDraft(input).draft).some(
      (issue) => issue.path === "items.0.fullNameEn",
    ),
  );
  Object.assign(input.items[0], {
    fullNameEn: "Test Person",
    positionEn: "Engineer",
    workplaceEn: "Test Company",
  });
  for (const assignment of input.items[0].assignments)
    Object.assign(assignment, {
      trainingSubjectEn: "Fire safety",
      resultEn: "Passed",
    });
  const saved = draftSchema.parse(JSON.parse(JSON.stringify(input)));
  assert.equal(saved.items[0].fullNameRu, "Тест Тестов");
  assert.equal(saved.items[0].fullNameEn, "Test Person");
  assert.deepEqual(validateBusinessRules(resolveDraft(saved).draft), []);
});

test("English appendix rejects omitted factual translations and round-trips reviewed source fields", () => {
  const input = applyBusinessRules(draft("ITR", "biot-itr-certificate"));
  input.englishAppendix = true;
  Object.assign(input.items[0], {
    fullNameEn: "Test Person",
    positionEn: "Engineer",
    workplaceEn: "Test Company",
    departmentKz: "Бөлім",
    employerAddressRu: "Тестовый адрес",
  });
  for (const assignment of input.items[0].assignments)
    Object.assign(assignment, {
      trainingSubjectEn: "Safety course",
      resultEn: "Passed",
      biotIndustryRu: "Промышленность",
      biotKnowledgeResult: "Сдал",
      biotProctoringResult: "Подтверждено",
      biotNotes: "Примечание",
    });
  const profile = profileSchema.parse({
    nameRu: "Центр",
    nameEn: "Centre",
    cityEn: "Kyzylorda",
    headName: "Тестовый Директор",
    approvalBasis: "Приказ",
    commission: [{ name: "Тестовый Председатель", position: "Председатель" }],
  });
  const missing = validateBusinessRules(resolveDraft(input).draft, profile).map(
    (issue) => issue.path,
  );
  for (const path of [
    "items.0.departmentEn",
    "items.0.employerAddressEn",
    "items.0.assignments.0.biotIndustryEn",
    "items.0.assignments.0.biotKnowledgeResultEn",
    "items.0.assignments.0.biotProctoringResultEn",
    "items.0.assignments.0.biotNotesEn",
    "profile.headNameEn",
    "profile.approvalBasisEn",
    "profile.commission.0.nameEn",
    "profile.commission.0.positionEn",
  ])
    assert.ok(missing.includes(path), path);
  Object.assign(input.items[0], {
    departmentEn: "Division",
    employerAddressEn: "Test address",
  });
  for (const assignment of input.items[0].assignments)
    Object.assign(assignment, {
      biotIndustryEn: "Industry",
      biotKnowledgeResultEn: "Passed",
      biotProctoringResultEn: "Confirmed",
      biotNotesEn: "Note",
    });
  Object.assign(profile, {
    headNameEn: "Test Director",
    approvalBasisEn: "Order",
  });
  Object.assign(profile.commission[0], {
    nameEn: "Test Chair",
    positionEn: "Chair",
  });
  const savedDraft = draftSchema.parse(JSON.parse(JSON.stringify(input)));
  const savedProfile = profileSchema.parse(JSON.parse(JSON.stringify(profile)));
  assert.equal(savedDraft.items[0].employerAddressEn, "Test address");
  assert.equal(savedDraft.items[0].assignments[0].biotNotesEn, "Note");
  assert.equal(savedProfile.commission[0].nameEn, "Test Chair");
  assert.deepEqual(
    validateBusinessRules(resolveDraft(savedDraft).draft, savedProfile),
    [],
  );
  savedDraft.englishAppendix = false;
  delete savedProfile.headNameEn;
  assert.deepEqual(
    validateBusinessRules(resolveDraft(savedDraft).draft, savedProfile),
    [],
  );
});

test("calendar anniversary clamps leap day and does not invent out-of-range dates", () => {
  assert.equal(businessValidUntil("2028-02-29", "WORKER"), "2029-02-28");
  assert.equal(businessValidUntil("2028-02-29", "ITR"), "2031-02-28");
  assert.equal(businessValidUntil("2027-02-29", "ITR"), "");
  assert.equal(businessValidUntil("9998-12-31", "ITR"), "");
});

test("individual issuance exceptions do not move a shared event's calculated training schedule", () => {
  const input = draft("WORKER", "ptm-card");
  input.commonFields = { documentDate: "2026-10-01" };
  input.events = [
    {
      id: "event",
      title: "ПТМ",
      protocolTemplateId: "ptm-protocol",
      protocolMode: "GROUP",
      revision: 0,
      commonFields: {
        documentDate: "2026-10-01",
        hours: "16",
        trainingSubject: "ПТМ",
        trainingDateRule: {
          hoursPerDay: 8,
          hoursSource: "THEORY",
          calendar: "CALENDAR",
          anchor: "DOCUMENT_AFTER_TRAINING",
          protocolDate: "TRAINING_END",
          source: "Утвержденный график",
        },
        dateOrigins: {
          trainingStart: "AUTO",
          trainingEnd: "AUTO",
          protocolDate: "AUTO",
        },
      },
    },
  ];
  Object.assign(input.items[0].assignments[0], {
    documentDate: "2026-10-08",
    eventId: "event",
    protocolMode: "GROUP",
    fieldOrigins: { documentDate: "MANUAL" },
    outcome: { status: "PASSED", source: "Ведомость" },
  });
  const resolved = resolveDraft(applyBusinessRules(input));
  assert.deepEqual(resolved.issues, []);
  const assignment = resolved.draft.items[0].assignments[0];
  assert.equal(assignment.documentDate, "2026-10-08");
  assert.equal(assignment.trainingStart, "2026-09-29");
  assert.equal(assignment.trainingEnd, "2026-09-30");
  assert.equal(assignment.protocolDate, "2026-09-30");
  assert.equal(assignment.validUntil, "2027-10-08");
});

test("one person may have independent issue dates per training kit and bilingual output has a single English appendix flag", () => {
  const input = draft("ITR", "ptm-card");
  input.commonFields = {
    documentDate: "2026-10-01",
    protocolDate: "2026-09-30",
  };
  Object.assign(input.items[0].assignments[0], {
    documentDate: "2026-10-02",
    fieldOrigins: { documentDate: "IMPORTED" },
  });
  input.items[0].assignments.push(
    assignmentSchema.parse({
      id: "ps",
      templateId: "ps-card",
      documentDate: "2026-11-03",
      fieldOrigins: { documentDate: "MANUAL" },
      result: "Сдал",
    }),
  );
  const value = resolveDraft(applyBusinessRules(input)).draft;
  assert.equal(value.englishAppendix, false);
  assert.equal(
    value.items[0].assignments.find((a) => a.templateId === "ptm-card")
      ?.validUntil,
    "2029-10-02",
  );
  for (const template of ["ps-card", "ps-witness"]) {
    const assignment = value.items[0].assignments.find(
      (a) => a.templateId === template,
    )!;
    assert.equal(assignment.documentDate, "2026-11-03");
    assert.equal(assignment.validityMode, "UNLIMITED");
    assert.equal(assignment.validUntil, "");
  }
  assert.deepEqual(validateBusinessRules(value), []);
  assert.equal(
    draftSchema.safeParse({ ...value, language: "EN" }).success,
    false,
    "a legacy/unknown language flag cannot silently replace the mandatory KZ/RU base",
  );
});
