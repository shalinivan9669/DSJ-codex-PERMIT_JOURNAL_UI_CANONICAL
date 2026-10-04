import test from "node:test";
import assert from "node:assert/strict";
import {
  draftSchema,
  documentPlan,
  validateDraft,
  LIMITS,
} from "../packages/contracts/src";

function fixture(rows = 250, assignments = 4) {
  return draftSchema.parse({
    kind: "PERSON",
    schemaVersion: 2,
    events: [
      {
        id: "event",
        title: "Тестовая группа",
        protocolTemplateId: "pb-protocol",
        commonFields: {},
      },
    ],
    items: Array.from({ length: rows }, (_, row) => ({
      id: `row-${row}`,
      fullNameRu: `Синтетический Получатель ${row}`,
      assignments: Array.from({ length: assignments }, (_, column) => ({
        id: `assignment-${row}-${column}`,
        templateId: "pb-card",
        documentDate: "2026-09-29",
        trainingSubject: "Синтетическая программа",
        result: "Сдал",
        ...(column === 0
          ? {
              eventId: "event",
              protocolMode: "GROUP",
              outcome: { status: "PASSED", source: "Тестовая ведомость" },
            }
          : {}),
      })),
    })),
  });
}

test("resource document guard counts the shared protocol alongside personal documents", () => {
  const draft = fixture(400, LIMITS.documents / 400);
  assert.equal(documentPlan(draft).documentCount, LIMITS.documents + 1);
  const issue = validateDraft(draft, null).find(
    (entry) => entry.code === "DOCUMENT_LIMIT",
  );
  assert.ok(
    issue,
    "the resource guard counts a shared protocol as well as personal forms",
  );
  assert.ok(issue.message.includes(String(LIMITS.documents)));
  assert.ok(issue.message.includes(String(LIMITS.documents + 1)));
  draft.items.at(-1)!.assignments.pop();
  assert.equal(documentPlan(draft).documentCount, LIMITS.documents);
  assert.equal(
    validateDraft(draft, null).some((entry) => entry.code === "DOCUMENT_LIMIT"),
    false,
  );
});

test("failed group participants count only documents that will actually be issued", () => {
  const draft = fixture();
  for (const item of draft.items)
    item.assignments[0].outcome = {
      status: "FAILED",
      source: "Тестовая ведомость",
    };
  assert.equal(documentPlan(draft).documentCount, 751);
  assert.equal(
    validateDraft(draft, null).some((entry) => entry.code === "DOCUMENT_LIMIT"),
    false,
  );
});
