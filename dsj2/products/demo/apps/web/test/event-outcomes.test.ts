import test from "node:test";
import assert from "node:assert/strict";
import { newAssignment, newRecipient } from "../lib/types";
import {
  applyEventOutcomes,
  eventOutcomeRecipients,
} from "../lib/event-outcomes";
import type { Draft } from "../lib/types";

function sample() {
  const events: Draft["events"] = [
    {
      id: "itr",
      title: "ИТР",
      revision: 0,
      protocolTemplateId: "biot-itr-protocol",
      commonFields: {},
    },
    {
      id: "pb",
      title: "ПБ",
      revision: 0,
      protocolTemplateId: "pb-protocol",
      commonFields: {},
    },
  ];
  const items = Array.from({ length: 3 }, (_, index) => {
    const item = newRecipient();
    item.id = `person-${index}`;
    item.assignments = [
      {
        ...newAssignment(index === 2 ? "pb-card" : "biot-itr-certificate"),
        eventId: index === 2 ? "pb" : "itr",
        outcome: { status: "UNKNOWN", source: "" },
      },
    ];
    return item;
  });
  items[0].assignments.push({
    ...newAssignment("pb-card"),
    eventId: "pb",
    outcome: { status: "FAILED", source: "Previous PB assessment" },
  });
  items[0].assignments[0].biotKnowledgeResult = "Individual knowledge result";
  items[0].assignments[0].biotProctoringResult = "Individual proctoring result";
  return { items, events };
}

test("all-event scope includes its participants only, while an explicit empty selection stays empty", () => {
  const draft = sample();
  assert.deepEqual(
    eventOutcomeRecipients(draft, "itr").map((item) => item.id),
    ["person-0", "person-1"],
  );
  assert.deepEqual(
    eventOutcomeRecipients(draft, "itr", ["person-0", "person-2"]).map(
      (item) => item.id,
    ),
    ["person-0"],
  );
  assert.deepEqual(eventOutcomeRecipients(draft, "itr", []), []);
});

test("confirmation affects the reviewed event and people without clearing individual factual results", () => {
  const draft = sample();
  const before = structuredClone(draft);
  const items = applyEventOutcomes(draft, "itr", ["person-0"], {
    status: "PASSED",
    source: "  Assessment 42  ",
    knowledge: "",
    proctoring: "",
  });
  assert.equal(items[0].assignments[0].outcome?.status, "PASSED");
  assert.equal(items[0].assignments[0].outcome?.source, "Assessment 42");
  assert.equal(
    items[0].assignments[0].biotKnowledgeResult,
    "Individual knowledge result",
  );
  assert.equal(
    items[0].assignments[0].biotProctoringResult,
    "Individual proctoring result",
  );
  assert.deepEqual(items[0].assignments[1], before.items[0].assignments[1]);
  assert.deepEqual(items.slice(1), before.items.slice(1));
  assert.deepEqual(draft, before, "reviewed input remains unchanged");
});

test("unknown results, missing sources and missing events cannot become confirmed outcomes", () => {
  const draft = sample();
  for (const [eventId, status, source] of [
    ["itr", "UNKNOWN", "Assessment"],
    ["itr", "PASSED", "   "],
    ["missing", "PASSED", "Assessment"],
  ] as const) {
    assert.throws(() =>
      applyEventOutcomes(draft, eventId, ["person-0"], { status, source }),
    );
  }
});

test("explicit factual fields replace only the reviewed ITR participants", () => {
  const draft = sample();
  const items = applyEventOutcomes(draft, "itr", ["person-0", "person-1"], {
    status: "FAILED",
    source: "Assessment",
    knowledge: "  30/100  ",
    proctoring: "Verified",
  });
  for (const item of items.slice(0, 2)) {
    assert.equal(item.assignments[0].result, "Не сдал");
    assert.equal(item.assignments[0].biotKnowledgeResult, "30/100");
    assert.equal(item.assignments[0].biotProctoringResult, "Verified");
  }
  assert.deepEqual(items[2], draft.items[2]);
});
