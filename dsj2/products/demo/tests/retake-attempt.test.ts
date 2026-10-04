import test from "node:test";
import assert from "node:assert/strict";
import {
  assignmentSchema,
  trainingEventSchema,
} from "../packages/contracts/src";
import {
  resetRetakeAttempt,
  resetRetakeEvent,
} from "../apps/api/src/retake-attempt";

test("retake clears every attempt language, evidence and its provenance while keeping the issued source intact", () => {
  const attemptFields = [
    "result",
    "resultKz",
    "resultEn",
    "biotKnowledgeResult",
    "biotKnowledgeResultEn",
    "biotProctoringResult",
    "biotProctoringResultEn",
    "biotNotes",
    "biotNotesEn",
    "biotUniqueNumber",
    "externalBasisNumber",
  ];
  const dates = [
    "documentDate",
    "protocolDate",
    "trainingStart",
    "trainingEnd",
    "validUntil",
  ];
  const source = assignmentSchema.parse({
    id: "attempt",
    templateId: "biot-itr-certificate",
    hours: "48",
    biotManualFields: ["hours", "validUntil"],
    ...Object.fromEntries(
      attemptFields.map((field) => [field, "previous attempt evidence"]),
    ),
    ...Object.fromEntries(dates.map((field) => [field, "2026-10-01"])),
    outcome: {
      status: "FAILED",
      source: "Previous record",
      confirmedAt: "2026-10-01",
      confirmedBy: "previous reviewer",
    },
    fieldOrigins: {
      ...Object.fromEntries(
        [...attemptFields, ...dates].map((field) => [field, "IMPORTED"]),
      ),
      hours: "MANUAL",
      biotCheckType: "MANUAL",
    },
  });
  const original = structuredClone(source);
  const next = resetRetakeAttempt(source);
  for (const field of [...attemptFields, ...dates]) {
    assert.equal(next[field as keyof typeof next], "", field);
    assert.equal(next.fieldOrigins?.[field], undefined, `${field} origin`);
  }
  assert.deepEqual(next.outcome, { status: "UNKNOWN", source: "" });
  assert.equal(next.biotCheckType, "REPEAT");
  assert.equal(next.hours, "48");
  assert.deepEqual(next.biotManualFields, ["hours"]);
  assert.deepEqual(next.fieldOrigins, { hours: "MANUAL" });
  assert.deepEqual(source, original);
});

test("retake event keeps its program but never old dates, date origins or lineage cache", () => {
  const source = trainingEventSchema.parse({
    id: "old",
    rootEventId: "old-root",
    lineageContext: "old values",
    lineageOwnContext: "old values",
    title: "Program",
    protocolTemplateId: "pb-protocol",
    commonFields: {
      documentDate: "2026-10-01",
      protocolDate: "2026-10-01",
      externalBasisNumber: "old number",
      trainingSubject: "Kept program",
      biotKnowledgeResult: "Старая оценка",
      biotKnowledgeResultEn: "Previous grade",
      biotProctoringResult: "Старый прокторинг",
      biotProctoringResultEn: "Previous proctoring",
      dateOrigins: { protocolDate: "MANUAL" },
      fieldOrigins: {
        documentDate: "IMPORTED",
        externalBasisNumber: "MANUAL",
        trainingSubject: "MANUAL",
        biotKnowledgeResult: "IMPORTED",
        biotKnowledgeResultEn: "IMPORTED",
        biotProctoringResult: "MANUAL",
        biotProctoringResultEn: "MANUAL",
      },
    },
  });
  const original = structuredClone(source);
  const next = resetRetakeEvent(source);
  assert.equal(next.commonFields.documentDate, undefined);
  assert.equal(next.commonFields.protocolDate, undefined);
  assert.equal(next.commonFields.externalBasisNumber, undefined);
  assert.equal(next.commonFields.dateOrigins, undefined);
  assert.deepEqual(next.commonFields.fieldOrigins, {
    trainingSubject: "MANUAL",
  });
  assert.equal(next.commonFields.trainingSubject, "Kept program");
  for (const key of [
    "biotKnowledgeResult",
    "biotKnowledgeResultEn",
    "biotProctoringResult",
    "biotProctoringResultEn",
  ] as const)
    assert.equal(next.commonFields[key], undefined);
  assert.equal(next.rootEventId, undefined);
  assert.equal(next.lineageContext, undefined);
  assert.equal(next.lineageOwnContext, undefined);
  assert.deepEqual(source, original);
});
