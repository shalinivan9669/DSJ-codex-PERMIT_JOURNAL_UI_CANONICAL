import test from "node:test";
import assert from "node:assert/strict";
import { draftSchema, documentPlan, resolveDraft } from "@demo/contracts";
import { newRequestBundle, recipientForRequest } from "../lib/request-bundles";
import { joinEventAssignment } from "../lib/event-assignment";
import { newRecipient } from "../lib/types";

for (const category of ["WORKER", "ITR"] as const) {
  for (const count of [1, 3, 100]) {
    test(`${category} bundle: ${count} members share exactly one protocol and preserve IDs after reload`, () => {
      const seed = newRequestBundle(category);
      const draft = draftSchema.parse({
        kind: "PERSON",
        schemaVersion: 2,
        commonFields: { documentDate: "2026-09-25" },
        ...seed,
      });
      while (draft.items.length < count)
        draft.items.push(recipientForRequest(draft));
      const first = resolveDraft(draft);
      assert.equal(
        first.draft.items[0].assignments[0].documentDate,
        "2026-09-25",
      );
      assert.equal(documentPlan(first.draft).groups.length, 1);
      assert.equal(
        documentPlan(first.draft).individuals.length,
        0,
        "no outcome is invented",
      );
      for (const item of draft.items) {
        item.assignments[0].outcome = {
          status: "PASSED",
          source: "Synthetic test assessment",
        };
        item.assignments[0].result = "Сдал";
      }
      const saved = draftSchema.parse(JSON.parse(JSON.stringify(draft)));
      const plan = documentPlan(resolveDraft(saved).draft);
      assert.equal(plan.individuals.length, count);
      assert.equal(plan.groups.length, 1);
      assert.equal(plan.documentCount, count + 1);
      assert.equal(plan.groups[0].members.length, count);
      assert.deepEqual(
        saved.items.map((item) => item.id),
        draft.items.map((item) => item.id),
      );
      assert.equal(
        new Set(
          saved.items.flatMap((item) => item.assignments.map((a) => a.id)),
        ).size,
        count,
      );
      assert.ok(saved.items.every((item) => item.assignments.length === 1));
    });
  }
}

test("multiple events require explicit selection and never mix worker/ITR", () => {
  const worker = newRequestBundle("WORKER");
  const itr = newRequestBundle("ITR");
  const person = newRecipient();
  assert.equal(
    recipientForRequest({ events: [...worker.events, ...itr.events] }, person),
    person,
  );
  const draft = draftSchema.parse({
    kind: "PERSON",
    schemaVersion: 2,
    events: worker.events,
    items: itr.items,
  });
  assert.ok(
    resolveDraft(draft).issues.some(
      (issue) => issue.code === "EVENT_INCOMPATIBLE",
    ),
  );
});

test("joining imported participant preserves imported dates and source; repeated joining does not duplicate documents", () => {
  const bundle = newRequestBundle("WORKER");
  const assignment = {
    ...newRecipient().assignments[0],
    documentDate: "2026-01-01",
    fieldOrigins: { documentDate: "IMPORTED" as const },
  };
  const joined = joinEventAssignment(assignment, bundle.events[0].id);
  const twice = joinEventAssignment(joined, bundle.events[0].id);
  assert.deepEqual(twice, joined);
  assert.equal(twice.documentDate, "2026-01-01");
  assert.equal(twice.fieldOrigins?.documentDate, "IMPORTED");
  assert.equal(twice.outcome?.status, "UNKNOWN");
});
