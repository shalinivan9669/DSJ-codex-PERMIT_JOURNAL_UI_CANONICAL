import test from "node:test";
import assert from "node:assert/strict";
import {
  BIOT_CATEGORIES,
  biotCategoryIds,
  biotValidUntil,
  assignmentSchema,
  draftSchema,
  profileSchema,
  validateDraft,
  type BiotCategory,
  type Assignment,
} from "../packages/contracts/src";

function issues(category: BiotCategory, override: Partial<Assignment> = {}) {
  const preset = BIOT_CATEGORIES[category];
  const assignment = assignmentSchema.parse({
    id: "document",
    templateId:
      preset.form === "WORKER" ? "biot-worker-card" : "biot-itr-certificate",
    biotCategory: category,
    documentDate: "2028-02-29",
    validUntil: biotValidUntil("2028-02-29", category) || "",
    hours: String(preset.defaultHours),
    productionHours: preset.defaultProductionHours
      ? String(preset.defaultProductionHours)
      : undefined,
    trainingSubject: "Подтверждённая программа",
    result: "Сдал",
    biotIndustryRu: "Синтетическая отрасль",
    biotCheckType: "PERIODIC",
    biotKnowledgeResult: "80%",
    biotProctoringResult: "Подтверждённый результат",
    biotUniqueNumber: "Синтетический подтверждённый номер",
    ...override,
  });
  return validateDraft(
    draftSchema.parse({
      kind: "PERSON",
      items: [
        {
          id: "recipient",
          fullNameRu: "Синтетический Получатель",
          workplaceRu: "Синтетическое предприятие",
          positionRu: "Синтетическая должность",
          employerBin: "000000000001",
          employerAddressRu: "Синтетический адрес",
          assignments: [assignment],
        },
      ],
    }),
    profileSchema.parse({
      nameRu: "Синтетический учебный центр",
      approved: true,
      headName: "Синтетический Руководитель",
      bin: "000000000002",
      cityRu: "Синтетический город",
      commission: Array.from({ length: 3 }, (_, i) => ({
        name: `Член ${i}`,
        position: "Должность",
      })),
    }),
  ).filter((issue) => issue.code.startsWith("BIOT_"));
}

test("BIOT rules distinguish worker theory/practice and all general/special training periods", () => {
  assert.deepEqual(
    biotCategoryIds.map((category) => {
      const p = BIOT_CATEGORIES[category];
      return [
        category,
        p.minimumHours,
        p.minimumProductionHours ?? null,
        p.validityYears,
      ];
    }),
    [
      ["WORKER", 10, 16, 1],
      ["MANAGER_GENERAL", 16, null, 3],
      ["OHS_HEAD_GENERAL", 40, null, 3],
      ["OHS_SPECIALIST_SPECIAL", 40, null, 3],
      ["INSPECTOR_GENERAL", 24, null, 3],
      ["INSPECTOR_SPECIAL", 40, null, 1],
      ["COUNCIL_GENERAL", 24, null, null],
      ["COUNCIL_SPECIAL", 40, null, null],
    ],
  );
  for (const category of biotCategoryIds)
    assert.deepEqual(
      issues(category).map((issue) => issue.code),
      BIOT_CATEGORIES[category].requiresExternalCertificate
        ? ["BIOT_ECS_REQUIRED"]
        : [],
    );
});

test("BIOT date defaults use calendar anniversaries and clamp leap day without inventing a council term", () => {
  assert.equal(biotValidUntil("2028-02-29", "WORKER"), "2029-02-28");
  assert.equal(
    biotValidUntil("2028-02-29", "OHS_SPECIALIST_SPECIAL"),
    "2031-02-28",
  );
  assert.equal(biotValidUntil("2026-12-31", "WORKER"), "2027-12-31");
  assert.equal(biotValidUntil("2027-01-01", "MANAGER_GENERAL"), "2030-01-01");
  assert.equal(biotValidUntil("2026-02-29", "WORKER"), null);
  assert.equal(biotValidUntil("", "WORKER"), null);
  assert.equal(biotValidUntil("2028-02-29", "COUNCIL_SPECIAL"), null);
});

test("explicit BIOT category enforces separate minimum hours with field-specific errors", () => {
  assert.deepEqual(
    issues("WORKER", { hours: "9", productionHours: "15" }).map((issue) => [
      issue.code,
      issue.path,
    ]),
    [
      ["BIOT_HOURS_MIN", "items.0.assignments.0.hours"],
      ["BIOT_PRODUCTION_HOURS_MIN", "items.0.assignments.0.productionHours"],
    ],
  );
  assert.ok(
    issues("WORKER", { productionHours: undefined }).some(
      (issue) => issue.code === "BIOT_PRODUCTION_HOURS_MIN",
    ),
  );
  assert.ok(
    issues("OHS_SPECIALIST_SPECIAL", { hours: "39" }).some(
      (issue) => issue.code === "BIOT_HOURS_MIN",
    ),
  );
  assert.ok(
    !issues("MANAGER_GENERAL", { hours: "24,5" }).some(
      (issue) => issue.code === "BIOT_HOURS_MIN",
    ),
  );
  assert.ok(
    issues("WORKER", { hours: "Infinity" }).some(
      (issue) => issue.code === "BIOT_HOURS_MIN",
    ),
  );
});

test("explicit categories prevent worker/ITR and unrelated template mismatch", () => {
  for (const templateId of ["biot-itr-certificate", "ptm-card"] as const)
    assert.ok(
      issues("WORKER", { templateId }).some(
        (issue) => issue.code === "BIOT_CATEGORY_TEMPLATE",
      ),
    );
  assert.ok(
    issues("OHS_SPECIALIST_SPECIAL", { templateId: "biot-worker-card" }).some(
      (issue) => issue.code === "BIOT_CATEGORY_TEMPLATE",
    ),
  );
  assert.deepEqual(
    issues("WORKER", { templateId: "biot-protocol", validUntil: "" }),
    [],
  );
});

test("earlier repeated checks are allowed, extending beyond the category period is rejected", () => {
  assert.deepEqual(issues("WORKER", { validUntil: "2028-12-31" }), []);
  assert.ok(
    issues("WORKER", { validUntil: "2029-03-01" }).some(
      (issue) => issue.code === "BIOT_VALID_UNTIL_RANGE",
    ),
  );
  assert.ok(
    issues("WORKER", { validUntil: "2028-02-28" }).some(
      (issue) => issue.code === "BIOT_VALID_UNTIL_RANGE",
    ),
  );
  assert.ok(
    issues("WORKER", { validUntil: "" }).some(
      (issue) => issue.code === "BIOT_VALID_UNTIL_REQUIRED",
    ),
  );
  assert.deepEqual(issues("COUNCIL_SPECIAL", { validUntil: "" }), []);
});

test("old assignments remain unchanged; explicit general categories identify external ECS scope", () => {
  const old = assignmentSchema.parse({
    id: "old",
    templateId: "biot-worker-card",
    documentDate: "2026-09-22",
    hours: "8",
  });
  assert.equal(old.biotCategory, undefined);
  assert.equal(old.productionHours, undefined);
  assert.equal(old.hours, "8");
  const draft = draftSchema.parse({
    kind: "PERSON",
    items: [{ id: "old-recipient", assignments: [old] }],
  });
  assert.deepEqual(
    validateDraft(draft, null)
      .filter((issue) => issue.code.startsWith("BIOT_"))
      .map((issue) => [issue.code, issue.path]),
    [["BIOT_CATEGORY_REQUIRED", "items.0.assignments.0.biotCategory"]],
  );
  for (const category of biotCategoryIds)
    assert.equal(
      BIOT_CATEGORIES[category].requiresExternalCertificate,
      BIOT_CATEGORIES[category].program === "GENERAL",
    );
});

test("every BIOT draft remains saveable but cannot be newly issued without an explicit category", () => {
  for (const templateId of [
    "biot-worker-card",
    "biot-itr-certificate",
    "biot-protocol",
    "biot-itr-protocol",
  ] as const) {
    const draft = draftSchema.parse({
      kind: "PERSON",
      items: [
        {
          id: "legacy",
          assignments: [
            {
              id: "legacy-document",
              templateId,
              hours: "8",
              documentDate: "2028-02-29",
            },
          ],
        },
      ],
    });
    const before = JSON.stringify(draft);
    assert.ok(
      validateDraft(draft, null).some(
        (issue) =>
          issue.code === "BIOT_CATEGORY_REQUIRED" &&
          issue.path === "items.0.assignments.0.biotCategory",
      ),
    );
    assert.equal(JSON.stringify(draft), before);
    assert.equal(draft.items[0].assignments[0].hours, "8");
    assert.equal(draft.items[0].assignments[0].documentDate, "2028-02-29");
  }
});

test("the new ITR protocol requires a category and actual score/proctoring facts", () => {
  assert.ok(
    issues("OHS_SPECIALIST_SPECIAL", {
      templateId: "biot-itr-protocol",
      biotCategory: undefined,
    }).some((issue) => issue.code === "BIOT_CATEGORY_REQUIRED"),
  );
  const missing = issues("OHS_SPECIALIST_SPECIAL", {
    templateId: "biot-itr-protocol",
    biotKnowledgeResult: "",
    biotProctoringResult: "",
    biotUniqueNumber: "",
  });
  assert.ok(
    missing.some((issue) => issue.path.endsWith(".biotKnowledgeResult")),
  );
  assert.ok(
    missing.some((issue) => issue.path.endsWith(".biotProctoringResult")),
  );
  assert.ok(
    missing.some((issue) => issue.code === "BIOT_UNIQUE_NUMBER_REQUIRED"),
  );
  const partial = assignmentSchema.parse({
    id: "partial",
    templateId: "biot-itr-protocol",
    biotCheckType: "",
  });
  assert.equal(partial.biotKnowledgeResult, undefined);
  assert.equal(partial.biotProctoringResult, undefined);
  assert.equal(partial.biotUniqueNumber, undefined);
});

test("a supplied unique number and a linked certificate cannot ambiguously compete", () => {
  const draft = draftSchema.parse({
    kind: "PERSON",
    items: [
      {
        id: "r",
        assignments: [
          {
            id: "protocol",
            templateId: "biot-itr-protocol",
            biotCategory: "OHS_SPECIALIST_SPECIAL",
            biotUniqueNumber: "Подтверждённый номер",
          },
          { id: "certificate", templateId: "biot-itr-certificate" },
        ],
      },
    ],
  });
  assert.ok(
    validateDraft(draft, null).some(
      (issue) => issue.code === "BIOT_UNIQUE_NUMBER_CONFLICT",
    ),
  );
  draft.items[0].assignments[0].biotUniqueNumber = "";
  assert.ok(
    !validateDraft(draft, null).some(
      (issue) =>
        issue.code === "BIOT_UNIQUE_NUMBER_REQUIRED" ||
        issue.code === "BIOT_UNIQUE_NUMBER_CONFLICT",
    ),
  );
});

test("ambiguous matching certificates are rejected for worker and special protocols", () => {
  for (const [category, protocol, credential] of [
    ["WORKER", "biot-protocol", "biot-worker-card"],
    ["OHS_SPECIALIST_SPECIAL", "biot-itr-protocol", "biot-itr-certificate"],
  ] as const) {
    const draft = draftSchema.parse({
      kind: "PERSON",
      items: [
        {
          id: "recipient",
          assignments: [
            { id: "protocol", templateId: protocol, biotCategory: category },
            {
              id: "credential-a",
              templateId: credential,
              biotCategory: category,
            },
            {
              id: "credential-b",
              templateId: credential,
              biotCategory: category,
            },
          ],
        },
      ],
    });
    assert.ok(
      validateDraft(draft, null).some(
        (issue) =>
          issue.code === "BIOT_CREDENTIAL_AMBIGUOUS" &&
          issue.path === "items.0.assignments.0.biotUniqueNumber",
      ),
    );
    draft.items[0].assignments.pop();
    assert.ok(
      !validateDraft(draft, null).some(
        (issue) => issue.code === "BIOT_CREDENTIAL_AMBIGUOUS",
      ),
    );
  }
});
