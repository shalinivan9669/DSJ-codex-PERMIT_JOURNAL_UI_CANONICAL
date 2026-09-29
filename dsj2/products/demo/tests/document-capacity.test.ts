import test from "node:test";
import assert from "node:assert/strict";
import {
  draftSchema,
  documentPlan,
  validateDraft,
} from "../packages/contracts/src";

function fixture() {
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
    items: Array.from({ length: 250 }, (_, row) => ({
      id: `row-${row}`,
      fullNameRu: `Синтетический Получатель ${row}`,
      assignments: Array.from({ length: 4 }, (_, column) => ({
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

test("1000-document limit counts the shared protocol alongside personal documents", () => {
  const draft = fixture();
  assert.equal(documentPlan(draft).documentCount, 1001);
  const issue = validateDraft(draft, null).find(
    (entry) => entry.code === "DOCUMENT_LIMIT",
  );
  assert.ok(
    issue,
    "1000 personal documents plus one protocol must be rejected",
  );
  assert.match(issue.message, /1000/);
  assert.match(issue.message, /1001/);
  draft.items.at(-1)!.assignments.pop();
  assert.equal(documentPlan(draft).documentCount, 1000);
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
