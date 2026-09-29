import test from "node:test";
import assert from "node:assert/strict";
import { draftSchema, resolveDraft, templateIds } from "@demo/contracts";
import {
  addSelectedDocuments,
  assignedDocumentTemplates,
  documentChoices,
  previewDocumentSelection,
} from "../lib/document-selection";
import { newAssignment, newRecipient, type Recipient } from "../lib/types";

function person(id: string): Recipient {
  return { ...newRecipient(), id, fullNameRu: id, assignments: [] };
}

test("document choices cover every actual form exactly once", () => {
  assert.equal(documentChoices.length, templateIds.length);
  assert.deepEqual(
    documentChoices.map((choice) => choice.templateId).sort(),
    [...templateIds].sort(),
  );
});

test("multi-person selection adds missing forms once and preserves all existing manual data and links", () => {
  const existing = {
    ...newAssignment("biot-worker-card"),
    documentDate: "2026-08-15",
    trainingStart: "2026-08-01",
    hours: "48",
    result: "Подтверждённый результат",
    eventId: "event-preserve",
    protocolMode: "GROUP" as const,
    fieldOrigins: {
      documentDate: "IMPORTED" as const,
      hours: "MANUAL" as const,
    },
    biotManualFields: ["hours" as const],
    outcome: { status: "PASSED" as const, source: "Подтверждённая ведомость" },
  };
  const first = { ...person("first"), assignments: [existing] };
  const second = {
    ...person("second"),
    assignments: [newAssignment("ptm-card")],
  };
  const unselected = person("unselected");
  const input = [first, second, unselected];
  const before = structuredClone(input);
  const selected = [first.id, second.id, first.id];
  const templates = [
    "biot-worker-card",
    "ptm-card",
    "pb-card",
    "pb-card",
  ] as const;
  const preview = previewDocumentSelection(input, selected, templates);
  assert.equal(preview.people, 2);
  assert.equal(preview.documents, 4);
  const result = addSelectedDocuments(input, selected, templates);
  assert.deepEqual(input, before, "the input is never mutated");
  assert.equal(
    result[0].assignments[0],
    existing,
    "the original assignment remains intact",
  );
  assert.equal(result[1].assignments[0], second.assignments[0]);
  assert.equal(result[2], unselected);
  assert.equal(result[0].assignments.length, 3);
  assert.equal(result[1].assignments.length, 3);
  const assignmentIds = result.flatMap((item) =>
    item.assignments.map((assignment) => assignment.id),
  );
  assert.equal(new Set(assignmentIds).size, assignmentIds.length);
  const repeated = addSelectedDocuments(result, selected, templates);
  assert.deepEqual(repeated, result);
  assert.ok(repeated.every((item, index) => item === result[index]));
});

test("a linked group protocol is already assigned and is not duplicated as an individual protocol", () => {
  const recipient = {
    ...person("member"),
    assignments: [
      {
        ...newAssignment("biot-itr-certificate"),
        eventId: "itr-event",
        protocolMode: "GROUP" as const,
        outcome: { status: "UNKNOWN" as const, source: "" },
      },
    ],
  };
  assert.ok(assignedDocumentTemplates(recipient).has("biot-itr-protocol"));
  const result = addSelectedDocuments(
    [recipient],
    [recipient.id],
    ["biot-itr-certificate", "biot-itr-protocol"],
  );
  assert.equal(result[0], recipient);
  assert.equal(result[0].assignments.length, 1);
  assert.equal(result[0].assignments[0].outcome?.status, "UNKNOWN");
});

test("new documents use current request dates without inventing results or changing existing dates", () => {
  const existing = {
    ...newAssignment("ptm-card"),
    documentDate: "2026-08-10",
    fieldOrigins: { documentDate: "MANUAL" as const },
  };
  const items = addSelectedDocuments(
    [{ ...person("one"), assignments: [existing] }],
    ["one"],
    ["pb-card"],
  );
  assert.equal(items[0].assignments[1].documentDate, "");
  assert.equal(items[0].assignments[1].result, "");
  assert.equal(items[0].assignments[1].outcome, undefined);
  const resolved = resolveDraft(
    draftSchema.parse({
      kind: "PERSON",
      schemaVersion: 2,
      commonFields: { documentDate: "2026-09-29" },
      items,
    }),
  );
  assert.equal(
    resolved.draft.items[0].assignments[0].documentDate,
    "2026-08-10",
  );
  assert.equal(
    resolved.draft.items[0].assignments[1].documentDate,
    "2026-09-29",
  );
});

test("capacity failure is atomic for the full selection and existing forms remain selectable without adding duplicates", () => {
  const full = {
    ...person("full"),
    assignments: templateIds
      .filter((id) => id !== "ps-witness")
      .map((id) => newAssignment(id)),
  };
  const other = person("other");
  const input = [full, other];
  const before = structuredClone(input);
  const preview = previewDocumentSelection(
    input,
    ["full", "other"],
    ["ps-witness"],
  );
  assert.equal(preview.overLimit.length, 1);
  assert.equal(preview.overLimit[0].recipient.id, "full");
  assert.throws(
    () => addSelectedDocuments(input, ["full", "other"], ["ps-witness"]),
    /не более 10/,
  );
  assert.deepEqual(input, before);
  assert.equal(addSelectedDocuments(input, ["full"], ["pb-card"])[0], full);
});

test("no selection or stale recipient IDs never affect another recipient", () => {
  const input = [person("present")];
  assert.equal(
    previewDocumentSelection(input, ["missing"], ["pb-card"]).documents,
    0,
  );
  assert.equal(
    addSelectedDocuments(input, ["missing"], ["pb-card"])[0],
    input[0],
  );
  assert.equal(addSelectedDocuments(input, ["present"], [])[0], input[0]);
});
