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
} from "../packages/contracts/src";
import { repeatDraft } from "../apps/api/src/operator-value";

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

test("repeat uses reusable identity and form only; every historical outcome and event date is removed", () => {
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
  const result = repeatDraft(source, "row", "a");
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
    "result",
    "reason",
    "hours",
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
