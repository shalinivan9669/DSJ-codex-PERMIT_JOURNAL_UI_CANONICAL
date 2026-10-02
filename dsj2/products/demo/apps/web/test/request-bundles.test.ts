import test from "node:test";
import assert from "node:assert/strict";
import {
  applyBusinessRules,
  draftSchema,
  documentPlan,
  resolveDraft,
  validateBusinessRules,
} from "@demo/contracts";
import {
  assignTrainingBundle,
  newRequestBundle,
  recipientForRequest,
  setTrainingProtocolMode,
} from "../lib/request-bundles";
import { joinEventAssignment } from "../lib/event-assignment";
import { newRecipient } from "../lib/types";

for (const category of ["WORKER", "ITR"] as const) {
  for (const count of [1, 3, 100, 250]) {
    test(`${category} bundle: ${count} members have the selected protocol mode and preserve IDs after reload`, () => {
      const seed = newRequestBundle(category);
      seed.events[0].protocolMode = count > 1 ? "GROUP" : "INDIVIDUAL";
      let draft = draftSchema.parse({
        kind: "PERSON",
        schemaVersion: 2,
        commonFields: { documentDate: "2026-09-25" },
        ...seed,
      });
      while (draft.items.length < count)
        draft.items.push(recipientForRequest(draft));
      draft = applyBusinessRules(draft);
      const first = resolveDraft(draft);
      assert.equal(
        first.draft.items[0].assignments[0].documentDate,
        "2026-09-25",
      );
      assert.equal(documentPlan(first.draft).groups.length, count > 1 ? 1 : 0);
      assert.equal(
        documentPlan(first.draft).individuals.length,
        count === 1 ? 1 : 0,
        "no outcome is invented",
      );
      for (const item of draft.items) {
        item.assignments[0].outcome = {
          status: "PASSED",
          source: "Synthetic test assessment",
        };
        item.assignments[0].result = "Сдал";
      }
      const saved = draftSchema.parse(
        JSON.parse(JSON.stringify(applyBusinessRules(draft))),
      );
      const plan = documentPlan(resolveDraft(saved).draft);
      assert.equal(plan.individuals.length, count === 1 ? 2 : count);
      assert.equal(plan.groups.length, count > 1 ? 1 : 0);
      assert.equal(plan.documentCount, count + 1);
      if (count > 1) assert.equal(plan.groups[0].members.length, count);
      assert.deepEqual(
        saved.items.map((item) => item.id),
        draft.items.map((item) => item.id),
      );
      assert.equal(
        new Set(
          saved.items.flatMap((item) => item.assignments.map((a) => a.id)),
        ).size,
        count === 1 ? 2 : count,
      );
      assert.ok(
        saved.items.every(
          (item) => item.assignments.length === (count === 1 ? 2 : 1),
        ),
      );
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
    businessRuleVersion: "LIVE_V1",
    events: worker.events,
    items: itr.items,
  });
  assert.ok(
    resolveDraft(draft).issues.some(
      (issue) => issue.code === "EVENT_INCOMPATIBLE",
    ),
  );
});

test("training selection is idempotent, separates BiOT categories and defaults two people to a group", () => {
  const worker = { ...newRecipient(), id: "worker", assignments: [] };
  const itr = {
    ...newRecipient(),
    id: "itr",
    employeeCategory: "ITR" as const,
    assignments: [],
  };
  const secondWorker = { ...newRecipient(), id: "worker-2", assignments: [] };
  const input = {
    ...draftSchema.parse({
      kind: "PERSON",
      schemaVersion: 2,
      commonFields: { documentDate: "2026-10-01" },
      items: [worker, itr, secondWorker],
    }),
    id: "request",
    revision: 0,
    status: "DRAFT",
  };
  const result = assignTrainingBundle(
    input,
    [worker.id, itr.id, secondWorker.id],
    "BIOT",
  );
  assert.equal(result.events?.length, 2);
  assert.equal(
    result.events?.find((event) => event.protocolTemplateId === "biot-protocol")
      ?.protocolMode,
    "GROUP",
  );
  assert.equal(
    result.events?.find(
      (event) => event.protocolTemplateId === "biot-itr-protocol",
    )?.protocolMode,
    "INDIVIDUAL",
  );
  assert.equal(result.items[0].assignments.length, 1);
  assert.equal(result.items[1].assignments.length, 2);
  assert.deepEqual(
    assignTrainingBundle(result, [worker.id, itr.id, secondWorker.id], "BIOT"),
    result,
  );
  assert.deepEqual(input.items[0].assignments, []);
});

test("switching protocol mode preserves personal dates and includes one PS witness per person", () => {
  const input = {
    ...draftSchema.parse({
      kind: "PERSON",
      schemaVersion: 2,
      commonFields: { documentDate: "2026-10-01", protocolDate: "2026-10-02" },
      items: [
        { ...newRecipient(), id: "one", assignments: [] },
        { ...newRecipient(), id: "two", assignments: [] },
      ],
    }),
    id: "request",
    revision: 0,
    status: "DRAFT",
  };
  let result = assignTrainingBundle(input, ["one", "two"], "PS");
  const eventId = result.events![0].id;
  for (const [index, item] of result.items.entries())
    Object.assign(item.assignments[0], {
      documentDate: `2026-10-0${index + 3}`,
      result: "Сдал",
      outcome: { status: "PASSED", source: "Ведомость" },
      fieldOrigins: { documentDate: "MANUAL" },
    });
  result = setTrainingProtocolMode(result, eventId, "INDIVIDUAL");
  assert.ok(result.items.every((item) => item.assignments.length === 3));
  assert.equal(result.items[1].assignments[0].documentDate, "2026-10-04");
  result = setTrainingProtocolMode(result, eventId, "GROUP");
  const resolved = resolveDraft(result).draft;
  assert.ok(resolved.items.every((item) => item.assignments.length === 2));
  assert.equal(resolved.items[0].assignments[1].documentDate, "2026-10-03");
  assert.equal(documentPlan(resolved).documentCount, 5);
  assert.deepEqual(validateBusinessRules(resolved), []);
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

test("automatic protocol mode follows participant count while an operator's explicit choice survives new rows", () => {
  const seed = newRequestBundle("WORKER");
  let draft = {
    ...draftSchema.parse({ kind: "PERSON", ...seed }),
    id: "request",
    revision: 0,
    status: "DRAFT",
  };
  draft.items.push(recipientForRequest(draft));
  draft = applyBusinessRules(draft);
  assert.equal(draft.events?.[0].protocolMode, "GROUP");
  assert.equal(draft.items[0].assignments.length, 1);
  draft = setTrainingProtocolMode(draft, draft.events![0].id, "INDIVIDUAL");
  draft.items.push(recipientForRequest(draft));
  draft = applyBusinessRules(draft);
  assert.equal(draft.events?.[0].protocolMode, "INDIVIDUAL");
  assert.equal(draft.events?.[0].protocolModeSource, "MANUAL");
  assert.ok(draft.items.every((item) => item.assignments.length === 2));
});

test("changing one participant to ITR splits the BiOT event and retains another participant's worker kit", () => {
  const seed = newRequestBundle("WORKER");
  let draft = {
    ...draftSchema.parse({ kind: "PERSON", ...seed }),
    id: "request",
    revision: 0,
    status: "DRAFT",
  };
  draft.items.push(recipientForRequest(draft));
  draft = applyBusinessRules(draft);
  const workerId = draft.items[0].assignments[0].id;
  draft.items[1].employeeCategory = "ITR";
  draft = applyBusinessRules(draft);
  assert.equal(draft.items[0].assignments[0].id, workerId);
  assert.equal(draft.items[0].assignments[0].templateId, "biot-worker-card");
  assert.equal(
    draft.items[1].assignments[0].templateId,
    "biot-itr-certificate",
  );
  assert.notEqual(
    draft.items[0].assignments[0].eventId,
    draft.items[1].assignments[0].eventId,
  );
  assert.ok(
    draft.events?.every((event) => event.protocolMode === "INDIVIDUAL"),
  );
  assert.deepEqual(applyBusinessRules(draft), draft);
});
