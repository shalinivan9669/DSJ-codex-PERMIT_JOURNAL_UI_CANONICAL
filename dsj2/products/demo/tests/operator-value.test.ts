import test from "node:test";
import assert from "node:assert/strict";
import {
  commercialSchema,
  calculateCommercial,
  evidenceState,
  ruleVersionSchema,
  valueAttachmentSchema,
} from "../packages/contracts/src/operator-value";
import {
  draftSchema,
  itemSchema,
  assignmentSchema,
  applyBusinessRules,
  BIOT_CATEGORIES,
  biotCategoryIds,
  courseResultText,
  DEFAULT_POSITIVE_OUTCOME_SOURCE,
  resolveDraft,
} from "../packages/contracts/src";
import {
  repeatDraft,
  repeatAssignment,
  repeatRequestRoster,
} from "../apps/api/src/operator-value";

test("KZT calculations preserve exact integer amounts, explicit tax basis and discounts", () => {
  const result = calculateCommercial(
    commercialSchema.parse({
      expectedRevision: 0,
      taxBasis: "Подтверждённая конфигурация тестового центра",
      taxRateBasisPoints: 1200,
      lines: [
        {
          label: "Обучение",
          unit: "PERSON_SERVICE",
          quantity: 100,
          unitPriceMinor: "10001",
          discountMinor: "1",
          discountReason: "Согласованная скидка",
        },
      ],
    }),
  );
  assert.equal(result.subtotalMinor, "1000099");
  assert.equal(result.taxMinor, "120012");
  assert.equal(result.totalMinor, "1120111");
  const unknownTax = calculateCommercial(
    commercialSchema.parse({
      expectedRevision: 0,
      lines: [
        { label: "Курс", unit: "FIXED", quantity: 1, unitPriceMinor: "100" },
      ],
    }),
  );
  assert.equal(unknownTax.totalMinor, null);
  assert.equal(unknownTax.taxMinor, null);
  assert.throws(
    () =>
      calculateCommercial(
        commercialSchema.parse({
          expectedRevision: 0,
          lines: [
            {
              label: "Курс",
              unit: "FIXED",
              quantity: 1,
              unitPriceMinor: "1",
              discountMinor: "2",
              discountReason: "Тест",
            },
          ],
        }),
      ),
    /DISCOUNT_EXCEEDS_LINE/,
  );
  assert.throws(
    () =>
      calculateCommercial(
        commercialSchema.parse({
          expectedRevision: 0,
          taxRateBasisPoints: 0,
          lines: [],
        }),
      ),
    /TAX_BASIS_REQUIRED/,
  );
});

test("ordinary repeat reuses identity and course with fresh positive defaults, while historical assessment facts are removed", () => {
  const source = draftSchema.parse({
    kind: "PERSON",
    items: [
      itemSchema.parse({
        id: "row",
        recipientId: "person",
        fullNameRu: "Синтетический Қайрат",
        personnelNumber: "T-01",
        assignments: [
          assignmentSchema.parse({
            id: "a",
            templateId: "biot-worker-card",
            biotCategory: "WORKER",
            documentDate: "2026-09-22",
            trainingStart: "2026-09-20",
            trainingEnd: "2026-09-21",
            protocolDate: "2026-09-21",
            validUntil: "2027-09-22",
            result: "Успешно",
            hours: "40",
            externalBasisNumber: "REAL-EXTERNAL",
            biotUniqueNumber: "UNIQUE",
            biotKnowledgeResult: "Успешно",
            biotProctoringResult: "Допущен",
            reason: "Старое основание",
          }),
        ],
      }),
    ],
  });
  const result = repeatDraft(source, "row", "a", {
    documentDate: "2026-10-04",
    profileVersionId: "current-profile",
  });
  assert.equal(result.schemaVersion, 2);
  assert.equal(result.commonFields?.documentDate, "2026-10-04");
  assert.equal(result.profileVersionId, "current-profile");
  assert.equal(result.items[0].recipientId, "person");
  assert.equal(result.items[0].fullNameRu, "Синтетический Қайрат");
  assert.notEqual(result.items[0].id, "row");
  const assignment = result.items[0].assignments[0];
  assert.notEqual(assignment.id, "a");
  for (const key of [
    "documentDate",
    "trainingStart",
    "trainingEnd",
    "protocolDate",
    "validUntil",
    "reason",
  ] as const)
    assert.equal(assignment[key], "");
  for (const key of [
    "externalBasisNumber",
    "biotUniqueNumber",
    "biotKnowledgeResult",
    "biotProctoringResult",
  ] as const)
    assert.ok(!assignment[key]);
  assert.equal(source.items[0].assignments[0].result, "Успешно");
  assert.equal(assignment.hours, "10");
  assert.equal(assignment.productionHours, "16");
  assert.equal(
    assignment.result,
    courseResultText(assignment.templateId, "PASSED"),
  );
  assert.equal(assignment.outcome?.source, DEFAULT_POSITIVE_OUTCOME_SOURCE);
  assert.equal(assignment.fieldOrigins?.outcome, "AUTO");
  const resolved = resolveDraft(applyBusinessRules(result)).draft.items[0]
    .assignments[0];
  assert.equal(resolved.documentDate, "2026-10-04");
  assert.equal(resolved.protocolDate, "2026-10-04");
  assert.equal(resolved.validUntil, "2027-10-04");
});

test("every repeated BiOT category gets its own default hours without carrying old source grades or origins", () => {
  for (const category of biotCategoryIds) {
    const source = assignmentSchema.parse({
      id: "old",
      templateId:
        BIOT_CATEGORIES[category].form === "WORKER"
          ? "biot-worker-card"
          : "biot-itr-certificate",
      biotCategory: category,
      hours: "123",
      productionHours: "456",
      result: "Старая оценка",
      resultKz: "Old KZ",
      resultEn: "Old EN",
      biotKnowledgeResult: "80/100",
      biotKnowledgeResultEn: "Old knowledge",
      biotProctoringResult: "Old proctoring",
      biotProctoringResultEn: "Old EN proctoring",
      outcome: {
        status: "FAILED",
        source: "old exam",
        confirmedBy: "old operator",
      },
      fieldOrigins: { hours: "MANUAL", outcome: "MANUAL" },
    });
    const before = structuredClone(source);
    const result = repeatAssignment(source);
    assert.equal(result.hours, String(BIOT_CATEGORIES[category].defaultHours));
    assert.equal(result.outcome?.status, "PASSED");
    assert.equal(result.outcome?.confirmedBy, undefined);
    for (const key of [
      "resultEn",
      "biotKnowledgeResult",
      "biotKnowledgeResultEn",
      "biotProctoringResult",
      "biotProctoringResultEn",
    ] as const)
      assert.equal(result[key], undefined);
    assert.deepEqual(source, before);
  }
});

test("portal repeat preserves distinct same-direction event kits and resets each attempt's shared facts", () => {
  const source = draftSchema.parse({
    kind: "COMPANY",
    schemaVersion: 2,
    events: ["first", "second"].map((id) => ({
      id,
      title: "Одинаковое название курса",
      protocolTemplateId: "biot-itr-protocol",
      protocolMode: "INDIVIDUAL",
      commonFields: {
        documentDate: "2025-01-01",
        validUntil: "2028-01-01",
        biotKnowledgeResult: "90/100",
        biotProctoringResult: "Old verified",
        biotIndustryRu: `Подтверждённая отрасль ${id}`,
      },
    })),
    items: [
      {
        id: "person",
        employeeCategory: "ITR",
        fullNameRu: "Синтетический Получатель",
        assignments: ["first", "second"].flatMap((eventId) =>
          ["biot-itr-certificate", "biot-itr-protocol"].map((templateId) => ({
            id: `${eventId}-${templateId}`,
            templateId,
            eventId,
            biotCategory: "INSPECTOR_SPECIAL",
            result: "Old result",
            outcome: { status: "FAILED", source: "Old exam" },
          })),
        ),
      },
    ],
  });
  const before = structuredClone(source);
  const roster = repeatRequestRoster(source, source.items, {
    documentDate: "2026-10-04",
  });
  const normalized = applyBusinessRules(
    draftSchema.parse({
      kind: "COMPANY",
      schemaVersion: 2,
      commonFields: { documentDate: "2026-10-04" },
      ...roster,
    }),
  );
  assert.equal(normalized.events?.length, 2);
  assert.equal(normalized.items[0].assignments.length, 4);
  for (const event of normalized.events || []) {
    assert.ok(!["first", "second"].includes(event.id));
    assert.equal(
      normalized.items[0].assignments.filter((a) => a.eventId === event.id)
        .length,
      2,
    );
    assert.equal(event.commonFields.documentDate, undefined);
    assert.equal(event.commonFields.biotKnowledgeResult, undefined);
    assert.equal(event.commonFields.biotProctoringResult, undefined);
    assert.match(
      event.commonFields.biotIndustryRu || "",
      /Подтверждённая отрасль/,
    );
  }
  const resolved = resolveDraft(normalized).draft;
  for (const assignment of resolved.items[0].assignments) {
    assert.equal(assignment.outcome?.status, "PASSED");
    assert.equal(assignment.documentDate, "2026-10-04");
    assert.equal(assignment.validUntil, "2029-10-04");
    assert.equal(assignment.hours, "40");
    assert.equal(assignment.biotKnowledgeResult, undefined);
  }
  assert.deepEqual(source, before);
});

test("external evidence distinguishes unknown, unverified, unknown expiry and review dates", () => {
  assert.equal(evidenceState(null, "2026-09-24"), "UNKNOWN");
  assert.equal(
    evidenceState(
      { status: "UNVERIFIED", validUntil: "2026-01-01" },
      "2026-09-24",
    ),
    "UNVERIFIED",
  );
  assert.equal(
    evidenceState({ status: "VERIFIED", validUntil: null }, "2026-09-24"),
    "VERIFIED_NO_EXPIRY",
  );
  assert.equal(
    evidenceState(
      { status: "VERIFIED", validUntil: "2026-10-01" },
      "2026-09-24",
    ),
    "APPROACHING",
  );
  assert.equal(
    evidenceState(
      { status: "VERIFIED", validUntil: "2026-01-01" },
      "2026-09-24",
    ),
    "REVIEW_DATE_PASSED",
  );
});

test("rules require approval evidence and attachments have exactly one owner", () => {
  assert.equal(
    ruleVersionSchema.safeParse({
      serviceKey: "BIOT",
      title: "Тест",
      status: "APPROVED",
      source: "Источник",
      applicability: "Тест",
      definition: {
        programVersion: "1",
        category: "WORKER",
        compatibleTemplateIds: [],
        requirements: [],
      },
    }).success,
    false,
  );
  assert.equal(
    valueAttachmentSchema.safeParse({
      orderId: "a",
      evidenceId: "b",
      category: "SOURCE",
      source: "Источник",
      fileName: "x.pdf",
      contentBase64: "eA==",
    }).success,
    false,
  );
  assert.equal(
    valueAttachmentSchema.safeParse({
      orderId: "a",
      category: "SOURCE",
      source: "Источник",
      fileName: "x.pdf",
      contentBase64: "eA==",
      tenantId: "injected",
    }).success,
    false,
  );
});
