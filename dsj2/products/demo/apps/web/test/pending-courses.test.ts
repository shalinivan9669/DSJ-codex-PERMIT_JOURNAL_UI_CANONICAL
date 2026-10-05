import test from "node:test";
import assert from "node:assert/strict";
import { draftSchema } from "@demo/contracts";
import { newRecipient, type Draft } from "../lib/types";
import { pendingCourses } from "../lib/pending-courses";

test("ready composition omits technical spares but retains partial people and contradictory course outcomes", () => {
  const spare = newRecipient();
  const person = newRecipient();
  person.fullNameRu = "Синтетический";
  const partial = newRecipient();
  partial.positionRu = "Инженер";
  const draft = {
    ...draftSchema.parse({ kind: "PERSON", items: [spare, person, partial] }),
    id: "draft",
    revision: 0,
    status: "DRAFT",
  } as Draft;
  assert.deepEqual(
    pendingCourses(draft).map((course) => course.row.id),
    [person.id, partial.id],
  );
  const previous = pendingCourses(draft)[0];
  draft.items.reverse();
  assert.equal(pendingCourses(draft)[1].key, previous.key);
  person.assignments.push({
    ...person.assignments[0],
    id: "linked-protocol",
    templateId: "biot-protocol",
    outcome: { status: "UNKNOWN", source: "" },
  });
  draft.items = [person];
  assert.equal(pendingCourses(draft)[0].passed, false);
});
