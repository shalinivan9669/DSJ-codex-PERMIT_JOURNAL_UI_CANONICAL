import assert from "node:assert/strict";
import test from "node:test";
import {
  documentPlan,
  draftSchema,
  eventProtocolAssignment,
  resolveDraft,
} from "../packages/contracts/src";

function mixed(categories: ("WORKER" | "ITR")[]) {
  return draftSchema.parse({
    kind: "COMPANY",
    schemaVersion: 2,
    businessRuleVersion: "LIVE_V1",
    events: [
      {
        id: "event",
        title: "ПБ",
        protocolTemplateId: "pb-protocol",
        protocolMode: "GROUP",
        commonFields: { documentDate: "2026-11-17" },
      },
    ],
    items: categories.map((employeeCategory, index) => ({
      id: "r" + employeeCategory + index,
      fullNameRu: employeeCategory,
      employeeCategory,
      assignments: [
        {
          id: "a" + employeeCategory + index,
          templateId: "pb-card",
          eventId: "event",
          protocolMode: "GROUP",
          outcome: { status: "PASSED", source: "Тест" },
        },
      ],
    })),
  });
}
test("industrial safety protocols partition by resolved programme and hours independently of row order", () => {
  for (const categories of [
    ["WORKER", "ITR"],
    ["ITR", "WORKER"],
  ] as const) {
    const draft = resolveDraft(mixed([...categories])).draft;
    const groups = documentPlan(draft).groups;
    assert.equal(groups.length, 2);
    assert.deepEqual(
      groups
        .map((group) =>
          group.members.map(
            (m) =>
              eventProtocolAssignment(group.event, m.assignment, true).hours,
          ),
        )
        .sort(),
      [["10"], ["40"]],
    );
  }
});
test("same resolved programme remains one protocol; explicit exceptions split it", () => {
  const input = mixed(["WORKER", "WORKER"]);
  input.events![0].commonFields.hours = "10";
  assert.equal(documentPlan(resolveDraft(input).draft).groups.length, 1);
  input.items[1].assignments[0].hours = "12";
  input.items[1].assignments[0].fieldOrigins = { hours: "MANUAL" };
  const resolved = resolveDraft(input);
  assert.equal(documentPlan(resolved.draft).groups.length, 2);
  assert.ok(
    !resolved.issues.some((issue) => issue.code === "GROUP_COMMON_OVERRIDE"),
  );
});
test("saved PB programme and manually changed programme remain separate even with equal hours", () => {
  const input = mixed(["WORKER", "WORKER"]);
  input.items[1].assignments[0].hoursProgram = "PB_RETRAINING";
  input.items[1].assignments[0].fieldOrigins = { hoursProgram: "MANUAL" };
  const resolved = resolveDraft(input);
  assert.deepEqual(
    resolved.draft.items.map((item) => item.assignments[0].hours),
    ["10", "10"],
  );
  assert.equal(documentPlan(resolved.draft).groups.length, 2);
  assert.ok(
    !resolved.issues.some((issue) => issue.code === "GROUP_COMMON_OVERRIDE"),
  );
  const saved = draftSchema.parse(JSON.parse(JSON.stringify(input)));
  assert.equal(documentPlan(resolveDraft(saved).draft).groups.length, 2);
  saved.items.reverse();
  assert.deepEqual(
    documentPlan(resolveDraft(saved).draft)
      .groups.map((group) =>
        group.members.map((member) => member.item.id).sort(),
      )
      .sort(),
    documentPlan(resolved.draft)
      .groups.map((group) =>
        group.members.map((member) => member.item.id).sort(),
      )
      .sort(),
  );
  input.events![0].commonFields.hoursProgram = "PB_RETRAINING";
  delete input.items[1].assignments[0].hoursProgram;
  delete input.items[1].assignments[0].fieldOrigins;
  assert.equal(documentPlan(resolveDraft(input).draft).groups.length, 1);
});
