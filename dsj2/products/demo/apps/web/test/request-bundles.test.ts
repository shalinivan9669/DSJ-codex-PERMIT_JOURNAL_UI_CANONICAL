import test from "node:test";
import assert from "node:assert/strict";
import {
  applyBusinessRules,
  commonFieldKeys,
  draftSchema,
  documentPlan,
  resolveDraft,
  trainingDirection,
  validateBusinessRules,
} from "@demo/contracts";
import {
  assignTrainingBundle,
  newRequestBundle,
  recipientForRequest,
  setTrainingProtocolMode,
} from "../lib/request-bundles";
import { joinEventAssignment } from "../lib/event-assignment";
import { newAssignment, newRecipient } from "../lib/types";

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

for (const direction of ["PTM", "PB", "PS"] as const) {
  test(`new empty recipient inherits the unique ${direction} event and its common dates without an outcome`, () => {
    const first = { ...newRecipient(), assignments: [] };
    const draft = assignTrainingBundle(
      {
        ...draftSchema.parse({
          kind: "PERSON",
          schemaVersion: 2,
          items: [first],
        }),
        id: "request",
        revision: 0,
        status: "DRAFT",
      },
      [first.id],
      direction,
      "INDIVIDUAL",
    );
    const event = draft.events![0];
    event.commonFields = {
      documentDate: "2026-10-02",
      protocolDate: "2026-10-01",
      trainingStart: "2026-09-28",
      trainingEnd: "2026-09-30",
      trainingSubject: "Synthetic common program",
      hours: "24",
    };
    const person = { ...newRecipient(), assignments: [] };
    const before = structuredClone(draft);
    const added = recipientForRequest(draft, person);
    assert.equal(added.assignments.length, 1, "only a raw primary is added");
    assert.equal(added.assignments[0].eventId, event.id);
    assert.equal(trainingDirection(added.assignments[0].templateId), direction);
    assert.equal(added.assignments[0].protocolMode, "INDIVIDUAL");
    assert.deepEqual(added.assignments[0].outcome, {
      status: "UNKNOWN",
      source: "",
    });
    for (const key of commonFieldKeys)
      assert.equal(added.assignments[0].fieldOrigins?.[key], "INHERITED");
    assert.deepEqual(person.assignments, []);
    assert.deepEqual(draft, before);
    const normalized = applyBusinessRules({
      ...draft,
      items: [...draft.items, added],
    });
    const resolved = resolveDraft(normalized).draft.items.at(-1)!;
    assert.equal(resolved.assignments[0].documentDate, "2026-10-02");
    assert.equal(resolved.assignments[0].trainingStart, "2026-09-28");
    assert.equal(resolved.assignments[0].trainingEnd, "2026-09-30");
    assert.equal(
      resolved.assignments[0].trainingSubject,
      "Synthetic common program",
    );
    assert.equal(resolved.assignments.length, direction === "PS" ? 3 : 2);
    assert.equal(
      normalized.events![0].protocolMode,
      "INDIVIDUAL",
      "manual mode survives adding a person",
    );
    assert.deepEqual(
      recipientForRequest(draft, added),
      added,
      "a second pass preserves assigned facts",
    );
  });
}

test("a new recipient inherits each unique direction and the unique BiOT category", () => {
  const seed = newRequestBundle("ITR");
  let draft = {
    ...draftSchema.parse({ kind: "PERSON", ...seed }),
    id: "request",
    revision: 0,
    status: "DRAFT",
  };
  for (const direction of ["PTM", "PB", "PS"] as const)
    draft = assignTrainingBundle(draft, [draft.items[0].id], direction);
  const added = recipientForRequest(draft, {
    ...newRecipient(),
    assignments: [],
  });
  assert.equal(added.employeeCategory, "ITR");
  assert.deepEqual(
    added.assignments.map((assignment) =>
      trainingDirection(assignment.templateId),
    ),
    ["BIOT", "PTM", "PB", "PS"],
  );
  assert.equal(added.assignments[0].templateId, "biot-itr-certificate");
  assert.deepEqual(
    new Set(added.assignments.map((assignment) => assignment.eventId)),
    new Set(draft.events!.map((event) => event.id)),
  );
});

test("ambiguous courses are skipped per direction while other unique courses still inherit", () => {
  const worker = newRequestBundle("WORKER");
  const itr = newRequestBundle("ITR");
  let draft = {
    ...draftSchema.parse({ kind: "PERSON", ...worker }),
    id: "request",
    revision: 0,
    status: "DRAFT",
  };
  for (const direction of ["PTM", "PB"] as const)
    draft = assignTrainingBundle(draft, [draft.items[0].id], direction);
  const ptm = draft.events!.find(
    (event) => event.protocolTemplateId === "ptm-protocol",
  )!;
  draft.events!.push(...itr.events, {
    ...structuredClone(ptm),
    id: "another-ptm",
  });
  const added = recipientForRequest(draft, {
    ...newRecipient(),
    assignments: [],
  });
  assert.deepEqual(
    added.assignments.map((assignment) => assignment.templateId),
    ["pb-card"],
  );
  assert.equal(
    added.assignments[0].eventId,
    draft.events!.find((event) => event.protocolTemplateId === "pb-protocol")!
      .id,
  );
});

test("a supplied recipient with existing assignments is never rewritten or enrolled elsewhere", () => {
  const draft = newRequestBundle("ITR");
  const person = {
    ...newRecipient(),
    assignments: [
      {
        ...newAssignment("pb-card"),
        documentDate: "2026-09-15",
        protocolDate: "",
        fieldOrigins: {
          documentDate: "IMPORTED" as const,
          protocolDate: "CLEARED" as const,
        },
        outcome: { status: "FAILED" as const, source: "Synthetic assessment" },
      },
    ],
  };
  const before = structuredClone(person);
  assert.equal(recipientForRequest(draft, person), person);
  assert.deepEqual(person, before);
});

for (const category of ["WORKER", "ITR"] as const) {
  test(`directory ${category} retains its category and skips incompatible BiOT while inheriting other directions`, () => {
    const seed = newRequestBundle(category === "ITR" ? "WORKER" : "ITR");
    let draft = {
      ...draftSchema.parse({ kind: "PERSON", ...seed }),
      id: "request",
      revision: 0,
      status: "DRAFT",
    };
    const person = {
      ...newRecipient(),
      recipientId: "stored-person",
      employeeCategory: category,
      assignments: [],
    };
    const before = structuredClone(person);
    assert.equal(
      recipientForRequest(draft, person),
      person,
      "incompatible-only event does not enroll the person",
    );
    for (const direction of ["PTM", "PB", "PS"] as const)
      draft = assignTrainingBundle(draft, [draft.items[0].id], direction);
    const added = recipientForRequest(draft, person);
    assert.equal(added.employeeCategory, category);
    assert.equal(added.recipientId, "stored-person");
    assert.deepEqual(
      added.assignments.map((assignment) =>
        trainingDirection(assignment.templateId),
      ),
      ["PTM", "PB", "PS"],
    );
    assert.ok(
      added.assignments.every(
        (assignment) => assignment.outcome?.status === "UNKNOWN",
      ),
    );
    assert.deepEqual(person, before);
    const normalized = applyBusinessRules({
      ...draft,
      items: [...draft.items, added],
    });
    assert.equal(
      normalized.events!.length,
      draft.events!.length,
      "no incompatible BiOT event is implicitly split",
    );
  });
}

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

for (const direction of ["BIOT", "PTM", "PB", "PS"] as const) {
  test(`inline ${direction} addition targets selected people, preserves previous facts and is idempotent`, () => {
    const previousDirection = direction === "BIOT" ? "PTM" : "BIOT";
    let input = assignTrainingBundle(
      {
        ...draftSchema.parse({
          kind: "PERSON",
          schemaVersion: 2,
          commonFields: { documentDate: "2026-10-02" },
          items: ["one", "two", "excluded"].map((id) => ({
            ...newRecipient(),
            id,
            assignments: [],
          })),
        }),
        id: "request",
        revision: 0,
        status: "DRAFT",
      },
      ["one", "two", "excluded"],
      previousDirection,
    );
    Object.assign(input.items[0].assignments[0], {
      documentDate: "2026-09-28",
      protocolDate: "",
      fieldOrigins: { documentDate: "IMPORTED", protocolDate: "CLEARED" },
      result: "Не сдал",
      outcome: { status: "FAILED", source: "Synthetic assessment" },
    });
    input = applyBusinessRules(input);
    const before = structuredClone(input);
    const next = assignTrainingBundle(input, ["one", "two"], direction);
    assert.deepEqual(input, before, "input remains unchanged");
    assert.deepEqual(
      next.items[2],
      before.items[2],
      "excluded person is unchanged",
    );
    for (const item of next.items.slice(0, 2)) {
      const old = before.items.find((row) => row.id === item.id)!;
      assert.deepEqual(
        item.assignments.filter((assignment) =>
          old.assignments.some((entry) => entry.id === assignment.id),
        ),
        old.assignments,
        "existing documents retain dates, origins and factual results",
      );
      const added = item.assignments.filter(
        (assignment) => trainingDirection(assignment.templateId) === direction,
      );
      assert.ok(added.length > 0);
      assert.ok(
        added.every((assignment) => assignment.outcome?.status === "UNKNOWN"),
      );
    }
    assert.deepEqual(
      assignTrainingBundle(next, ["one", "two"], direction),
      next,
    );
  });
}

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
