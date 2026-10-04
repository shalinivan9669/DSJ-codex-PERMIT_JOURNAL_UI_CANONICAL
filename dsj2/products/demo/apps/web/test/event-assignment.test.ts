import test from "node:test";
import assert from "node:assert/strict";
import { applyBusinessRules, type Draft as DraftInput } from "@demo/contracts";
import { newAssignment, newRecipient } from "../lib/types";
import { joinEventAssignmentKit } from "../lib/event-assignment";

function fixture() {
  const draft: DraftInput = {
    kind: "COMPANY", title: "Synthetic join", customerId: null, demoMode: true,
    businessRuleVersion: "LIVE_V1", schemaVersion: 2,
    events: [{ id: "group", title: "Synthetic PB", protocolTemplateId: "pb-protocol", protocolMode: "GROUP", protocolModeSource: "MANUAL", revision: 0, commonFields: {} }],
    commonFields: { documentDate: "2026-10-03", protocolDate: "2026-10-02" },
    items: [{ ...newRecipient(), employeeCategory: "WORKER", assignments: [{ ...newAssignment("pb-card"), id: "imported-primary", trainingSubject: "Imported course", fieldOrigins: { trainingSubject: "IMPORTED" }, outcome: { status: "UNKNOWN", source: "" } }] }],
  };
  return applyBusinessRules(draft);
}

test("explicit joining moves the generated kit together and LIVE normalization creates no duplicate", () => {
  const draft = fixture();
  const item = draft.items[0];
  assert.equal(item.assignments.length, 2);
  const before = structuredClone(item);
  const joined = joinEventAssignmentKit(draft, item, item.assignments[0], "group");
  assert.ok(joined);
  assert.equal(joined.filter((a) => a.eventId === "group").length, 2);
  const after = applyBusinessRules({ ...draft, items: [{ ...item, assignments: joined }] });
  assert.equal(after.items[0].assignments.length, 1);
  assert.equal(after.items[0].assignments[0].id, "imported-primary");
  assert.equal(after.items[0].assignments[0].trainingSubject, "Imported course");
  assert.equal(after.items[0].assignments[0].fieldOrigins?.trainingSubject, "IMPORTED");
  assert.equal(after.items[0].assignments[0].outcome?.status, "UNKNOWN");
  assert.deepEqual(item, before);
  assert.deepEqual(applyBusinessRules(after), after);
});

test("an independently identified course is preserved by explicit kit joining", () => {
  const draft = fixture();
  const item = draft.items[0];
  const independent = { ...newAssignment("ptm-card"), id: "independent", trainingSubject: "Separate PTM" };
  item.assignments.push(independent);
  const joined = joinEventAssignmentKit(draft, item, item.assignments[0], "group");
  assert.ok(joined);
  assert.deepEqual(joined.find((a) => a.id === "independent"), independent);
  const after = applyBusinessRules({ ...draft, items: [{ ...item, assignments: joined }] });
  assert.equal(after.items[0].assignments.filter((a) => a.templateId === "pb-card").length, 1);
  assert.equal(after.items[0].assignments.filter((a) => a.templateId.startsWith("ptm-")).length, 2);
});

test("separate manual or imported companion data blocks the join without changing any field", () => {
  for (const origin of ["MANUAL", "IMPORTED"] as const) {
    const draft = fixture();
    const item = draft.items[0];
    const protocol = item.assignments[1];
    protocol.reason = "Separate protocol evidence";
    protocol.fieldOrigins = { ...protocol.fieldOrigins, reason: origin };
    const before = structuredClone(item);
    assert.equal(joinEventAssignmentKit(draft, item, item.assignments[0], "group"), null);
    assert.deepEqual(item, before);
  }
});

test("a canonical companion bound to another event cannot be silently merged", () => {
  const draft = fixture();
  const item = draft.items[0];
  item.assignments[1].eventId = "different-event";
  const before = structuredClone(item);
  assert.equal(joinEventAssignmentKit(draft, item, item.assignments[0], "group"), null);
  assert.deepEqual(item, before);
});
