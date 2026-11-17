import assert from "node:assert/strict";
import test from "node:test";
import {
  assignmentSchema,
  applyBusinessRules,
  resolveDraft,
} from "@demo/contracts";
import {
  eventCourseDefaults,
  updateCommonBiotCategory,
  updateAssignment,
} from "../lib/assignment-presets";
import {
  editTrainingAssignment,
  restoreTrainingAssignmentField,
} from "../lib/training-assignment-edit";
import { newAssignment, newRecipient, type Recipient } from "../lib/types";
import { addressIssue } from "../lib/validation-address";

test("a passport applicability issue for a person targets the group's selector", () => {
  const assignment = newAssignment("pb-card");
  const person = { ...newRecipient(), assignments: [assignment] };
  const issue = {
    message: "Категория не входит в программу",
    rowId: person.id,
    assignmentId: assignment.id,
    eventId: "group",
    path: "events.group.serviceRuleVersionId",
  };
  assert.deepEqual(addressIssue(issue, [person], [{ id: "group" }]), {
    ...issue,
    path: "events.0.serviceRuleVersionId",
  });
});

test("a new BiOT event keeps its suggested hour values automatic", () => {
  const fields = eventCourseDefaults("biot-worker-card");
  assert.equal(fields.hours, "10");
  assert.equal(fields.fieldOrigins?.hours, "AUTO");
  assert.equal(fields.productionHours, "16");
  assert.equal(fields.fieldOrigins?.productionHours, "AUTO");
  assert.deepEqual(eventCourseDefaults("pb-card"), {});
});

test("a category change preserves untagged hours even when they match the old preset", () => {
  const savedFields = {
    biotCategory: "WORKER" as const,
    hours: "10",
    productionHours: "16",
  };
  const savedEvent = updateCommonBiotCategory(savedFields, "ITR_STANDARD");
  assert.equal(savedEvent.hours, "10");
  assert.equal(savedEvent.productionHours, "16");
  assert.equal(savedEvent.fieldOrigins?.hours, undefined);
  const oldCard = assignmentSchema.parse({
    ...newAssignment("biot-worker-card"),
    ...savedFields,
    fieldOrigins: undefined,
    documentDate: "2028-02-29",
    validUntil: "2029-02-28",
  });
  const changed = updateAssignment(oldCard, {
    templateId: "biot-itr-certificate",
  });
  assert.equal(changed.hours, "10");
  assert.equal(changed.productionHours, "16");
  assert.equal(changed.validUntil, oldCard.validUntil);
  const automatic = updateCommonBiotCategory(
    eventCourseDefaults("biot-worker-card"),
    "ITR_STANDARD",
  );
  assert.equal(automatic.hours, "40");
  assert.equal(automatic.productionHours, "");
  const emptyOldCard = { ...oldCard, hours: "", productionHours: "" };
  const recalculated = updateAssignment(emptyOldCard, {
    templateId: "biot-itr-certificate",
  });
  assert.equal(recalculated.hours, "40");
  assert.equal(recalculated.fieldOrigins?.hours, "AUTO");
  assert.equal(
    updateAssignment(recalculated, { templateId: "biot-worker-card" }).hours,
    "10",
  );
});

test("changing direction drops the previous program, retaining explicitly entered hours", () => {
  const fire = updateAssignment(newAssignment("ptm-card"), {
    hoursProgram: "PTM_DIRECTOR",
  });
  const automatic = {
    ...fire,
    hours: "8",
    fieldOrigins: { ...fire.fieldOrigins, hours: "AUTO" as const },
  };
  const industrial = updateAssignment(automatic, { templateId: "pb-card" });
  assert.equal(industrial.hoursProgram, undefined);
  assert.equal(industrial.fieldOrigins?.hoursProgram, undefined);
  assert.equal(industrial.hours, "");
  const ordinary = {
    ...newAssignment("pb-card"),
    hours: "40",
    fieldOrigins: { hours: "AUTO" as const },
  };
  assert.equal(updateAssignment(ordinary, { templateId: "ps-card" }).hours, "");
  const entered = updateAssignment(automatic, { hours: "25" });
  assert.equal(
    updateAssignment(entered, { templateId: "pb-card" }).hours,
    "25",
  );
});

test("individual training edits and resets propagate to its companion and respect the parent program", () => {
  const card = { ...newAssignment("ptm-card"), eventId: "group" };
  const protocol = { ...newAssignment("ptm-protocol"), eventId: "group" };
  const person = { ...newRecipient(), assignments: [card, protocol] };
  const resolved = (p: Recipient) =>
    resolveDraft(
      applyBusinessRules({
        kind: "PERSON",
        schemaVersion: 2,
        businessRuleVersion: "LIVE_V1",
        title: "Часы",
        customerId: null,
        demoMode: true,
        items: [p],
        events: [
          {
            id: "group",
            title: "ПТМ",
            protocolTemplateId: "ptm-protocol",
            protocolMode: "INDIVIDUAL",
            revision: 0,
            commonFields: { hoursProgram: "PTM_HOT_WORK" },
          },
        ],
      }),
    ).draft.items[0].assignments[0];
  assert.equal(resolved(person).hours, "12");
  const edited = editTrainingAssignment(
    person,
    card.id,
    { hoursProgram: "PTM_DIRECTOR", hours: "25" },
    true,
  );
  assert.ok(
    edited.assignments.every(
      (a) => a.hoursProgram === "PTM_DIRECTOR" && a.hours === "25",
    ),
  );
  const inherited = restoreTrainingAssignmentField(
    edited,
    card.id,
    "hours",
    true,
  );
  assert.ok(
    inherited.assignments.every(
      (a) => !a.hours && !a.biotManualFields?.includes("hours"),
    ),
  );
  assert.equal(resolved(inherited).hours, "8");
  const cleared = editTrainingAssignment(
    inherited,
    card.id,
    { hoursProgram: undefined },
    true,
  );
  assert.ok(
    cleared.assignments.every(
      (a) => a.fieldOrigins?.hoursProgram === "CLEARED",
    ),
  );
  assert.equal(resolved(cleared).hours, "");
  const back = restoreTrainingAssignmentField(
    cleared,
    protocol.id,
    "hoursProgram",
    true,
  );
  assert.ok(
    back.assignments.every((a) => !assignmentSchema.parse(a).hoursProgram),
  );
  assert.equal(resolved(back).hours, "12");
});
