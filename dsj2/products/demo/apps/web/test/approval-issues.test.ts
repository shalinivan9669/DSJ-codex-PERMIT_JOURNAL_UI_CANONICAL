import test from "node:test";
import assert from "node:assert/strict";
import { draftSchema, selectAssignmentScope } from "@demo/contracts";
import { approvalIssueGroups } from "../lib/approval-issues";

test("director errors group the shared course once and preserve each person's outcome and stable link", () => {
  const draft = draftSchema.parse({
    kind: "PERSON",
    events: [
      {
        id: "event",
        title: "БиОТ",
        protocolTemplateId: "biot-protocol",
        commonFields: {},
      },
    ],
    items: [1, 2].map((n) => ({
      id: `person-${n}`,
      fullNameRu: `Получатель ${n}`,
      assignments: ["biot-worker-card", "biot-protocol"].map(
        (templateId, i) => ({
          id: `a-${n}-${i}`,
          eventId: "event",
          templateId,
        }),
      ),
    })),
  });
  const issues = draft.items.flatMap((row, r) =>
    row.assignments.flatMap((assignment, a) => [
      {
        code: "INDUSTRY",
        path: `items.${r}.assignments.${a}.biotIndustryRu`,
        field: "biotIndustryRu",
        rowId: row.id,
        assignmentId: assignment.id,
        eventId: "event",
        message: "Укажите отрасль",
      },
      {
        code: "OUTCOME_UNCONFIRMED",
        path: `items.${r}.assignments.${a}.outcome`,
        field: "outcome",
        rowId: row.id,
        assignmentId: assignment.id,
        eventId: "event",
        message: "Проверьте результат",
      },
    ]),
  );
  const groups = approvalIssueGroups(issues, {
    ...draft,
    items: [...draft.items].reverse(),
  });
  assert.equal(groups.length, 3);
  assert.equal(groups.find((g) => g.key === "course:event")?.entries.length, 1);
  assert.equal(
    groups.find((g) => g.key === "person:person-1")?.entries.length,
    1,
  );
  assert.equal(
    groups.find((g) => g.key === "person:person-2")?.entries.length,
    1,
  );
  const issue = groups.find((g) => g.key === "person:person-1")!.entries[0]
    .issue;
  assert.notEqual(typeof issue, "string");
  if (typeof issue !== "string") {
    assert.equal(issue.path, "items.1.assignments.0.outcome");
    assert.equal(issue.rowId, "person-1");
  }
});

test("selection narrows frozen effective values and provenance with the raw scope", () => {
  const raw = draftSchema.parse({
    kind: "PERSON",
    items: [1, 2].map((n) => ({
      id: `person-${n}`,
      fullNameRu: `Получатель ${n}`,
      assignments: [{ id: `a-${n}`, templateId: "ptm-card" }],
    })),
  });
  const frozen = draftSchema.parse({
    ...raw,
    frozenResolution: {
      version: 1,
      resolvedAt: "2026-10-05T00:00:00Z",
      draft: raw,
      provenance: {
        "person-1:a-1": { trainingSubject: "COURSE" },
        "person-2:a-2": { trainingSubject: "CENTER" },
      },
    },
  });
  const selected = selectAssignmentScope(frozen, [
    { rowId: "person-2", assignmentId: "a-2" },
  ]);
  assert.deepEqual(
    selected.draft.frozenResolution?.draft.items.map((row) => row.id),
    ["person-2"],
  );
  assert.deepEqual(Object.keys(selected.draft.frozenResolution!.provenance), [
    "person-2:a-2",
  ]);
});

test("special knowledge and proctoring requirements share one event input while personal overrides stay separate", () => {
  const fields = ["biotKnowledgeResult", "biotProctoringResult"] as const;
  const draft = draftSchema.parse({
    kind: "PERSON",
    events: [
      {
        id: "special",
        title: "Специальная программа",
        protocolTemplateId: "biot-itr-protocol",
        commonFields: {},
      },
    ],
    items: [1, 2, 3].map((n) => ({
      id: `person-${n}`,
      fullNameRu: `Получатель ${n}`,
      assignments: ["biot-itr-certificate", "biot-itr-protocol"].map(
        (templateId, i) => ({
          id: `a-${n}-${i}`,
          templateId,
          eventId: "special",
          fieldOrigins:
            n === 3
              ? {
                  biotKnowledgeResult: "CLEARED",
                  biotProctoringResult: "MANUAL",
                }
              : {},
        }),
      ),
    })),
  });
  const issues = draft.items.flatMap((row, r) =>
    row.assignments.flatMap((assignment, a) =>
      fields.map((field) => ({
        code: `REQUIRED_${field}`,
        path: `items.${r}.assignments.${a}.${field}`,
        field,
        rowId: row.id,
        assignmentId: assignment.id,
        eventId: "special",
        message: "Укажите значение",
      })),
    ),
  );
  const groups = approvalIssueGroups(issues, draft);
  assert.deepEqual(
    groups.map((group) => group.key),
    ["course:special", "person:person-3"],
  );
  assert.deepEqual(
    groups[0].entries.map((entry) => entry.count),
    [4, 4],
  );
  assert.deepEqual(
    groups[1].entries.map((entry) => entry.count),
    [2, 2],
  );
  for (const entry of groups[1].entries) {
    assert.notEqual(typeof entry.issue, "string");
    if (typeof entry.issue !== "string")
      assert.equal(entry.issue.rowId, "person-3");
  }
});
