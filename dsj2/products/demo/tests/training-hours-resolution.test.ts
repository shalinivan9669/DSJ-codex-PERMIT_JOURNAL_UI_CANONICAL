import assert from "node:assert/strict";
import test from "node:test";
import {
  applyBusinessRules,
  draftSchema,
  eventProtocolAssignment,
  resolveDraft,
  validateDraft,
  type Assignment,
  type CommonFields,
} from "../packages/contracts/src";

function request(
  templateId: Assignment["templateId"],
  protocol: string,
  categories: ("WORKER" | "ITR")[],
  commonFields: CommonFields = {},
) {
  return draftSchema.parse({
    kind: "COMPANY",
    schemaVersion: 2,
    businessRuleVersion: "LIVE_V1",
    events: [
      {
        id: "group",
        title: "Учебная группа",
        protocolTemplateId: protocol,
        protocolMode: "GROUP",
        commonFields: { documentDate: "2026-11-17", ...commonFields },
      },
    ],
    items: categories.map((category, index) => ({
      id: "r" + index,
      employeeCategory: category,
      fullNameRu: "Учебный",
      assignments: [
        {
          id: "a" + index,
          templateId,
          eventId: "group",
          protocolMode: "GROUP",
          outcome: { status: "PASSED", source: "Тест" },
        },
      ],
    })),
  });
}

test("mixed industrial safety group preserves each person's hours in both the card and group protocol", () => {
  const input = request("pb-card", "pb-protocol", ["WORKER", "ITR"]);
  const calculate = () => resolveDraft(input).draft;
  const draft = calculate();
  const event = draft.events![0];
  assert.equal(event.commonFields.hours, undefined);
  assert.deepEqual(
    draft.items.map(
      (r) => eventProtocolAssignment(event, r.assignments[0], true).hours,
    ),
    ["10", "40"],
  );
  input.events![0].commonFields.hoursProgram = "PB_RETRAINING";
  const retrained = calculate();
  assert.equal(retrained.events![0].commonFields.hours, "10");
  assert.deepEqual(
    retrained.items.map((r) => r.assignments[0].hours),
    ["10", "10"],
  );
  assert.deepEqual(
    input.items.map((r) => r.assignments[0].hours),
    ["", ""],
  );
});

test("legal program applies before dates and below-minimum/cleared overrides remain visible to validation", () => {
  const input = request("pb-card", "pb-protocol", ["ITR"], {
    trainingDateRule: {
      hoursPerDay: 8,
      hoursSource: "THEORY",
      calendar: "CALENDAR",
      anchor: "DOCUMENT_AFTER_TRAINING",
      protocolDate: "DOCUMENT_DATE",
      source: "Учебный график",
    },
  });
  const a = input.items[0].assignments[0];
  const check = () => resolveDraft(input).draft;
  assert.ok(check().items[0].assignments[0].trainingStart);
  for (const [origin, value] of [
    ["IMPORTED", "8"],
    ["CLEARED", ""],
  ] as const) {
    a.hours = value;
    a.fieldOrigins = { hours: origin };
    const resolved = check();
    assert.equal(resolved.items[0].assignments[0].hours, value);
    assert.ok(
      validateDraft(resolved, null).some((i) => i.code === "PB_HOURS_MIN"),
    );
  }
});

test("PTM uses the selected program, preserves individual values and never infers the program from ITR", () => {
  const input = request("ptm-card", "ptm-protocol", ["ITR"]);
  const hours = () => resolveDraft(input).draft.items[0].assignments[0].hours;
  assert.equal(hours(), "");
  input.events![0].commonFields.hoursProgram = "PTM_DIRECTOR";
  assert.equal(hours(), "8");
  input.events![0].commonFields.hoursProgram = "PTM_HOT_WORK";
  assert.equal(hours(), "12");
  input.items[0].assignments[0].hours = "14";
  assert.equal(hours(), "14");
});

test("the pinned curriculum applies only to its event, below individual and group overrides", () => {
  const input = request("ps-card", "ps-protocol", ["WORKER"]);
  const event = input.events![0];
  event.serviceRuleVersionId = "approved";
  const plans = new Map([["group", "72"]]);
  const resolve = () => resolveDraft(input, { hours: "12" }, plans);
  assert.equal(resolve().draft.items[0].assignments[0].hours, "72");
  assert.equal(resolve().provenance["r0:a0"].hours, "SERVICE_RULE");
  event.commonFields.hours = "80";
  assert.equal(resolve().draft.items[0].assignments[0].hours, "80");
  input.items[0].assignments[0].hours = "96";
  assert.equal(resolve().draft.items[0].assignments[0].hours, "96");
  assert.equal(
    resolveDraft(request("ps-card", "ps-protocol", ["ITR"])).draft.items[0]
      .assignments[0].hours,
    "",
  );
});

test("manual hours follow the main credential across edits to its individual protocol", () => {
  let draft = request("ptm-card", "ptm-protocol", ["ITR"]);
  draft.events![0].protocolMode = "INDIVIDUAL";
  const primary = draft.items[0].assignments[0];
  primary.hours = "18";
  primary.fieldOrigins = { hours: "MANUAL" };
  draft = applyBusinessRules(draft);
  draft.items[0].assignments[0].hours = "20";
  assert.deepEqual(
    resolveDraft(applyBusinessRules(draft)).draft.items[0].assignments.map(
      (a) => a.hours,
    ),
    ["20", "20"],
  );
});

test("saving calculated hours never turns the former category or passport into a manual override", () => {
  const input = request("pb-card", "pb-protocol", ["WORKER"]);
  const saved = draftSchema.parse(resolveDraft(input).draft);
  saved.items[0].employeeCategory = "ITR";
  assert.equal(resolveDraft(saved).draft.items[0].assignments[0].hours, "40");

  const ps = request("ps-card", "ps-protocol", ["WORKER"]);
  ps.events![0].serviceRuleVersionId = "first";
  const withPlan = draftSchema.parse(
    resolveDraft(ps, {}, new Map([["group", "72"]])).draft,
  );
  delete withPlan.events![0].serviceRuleVersionId;
  assert.equal(resolveDraft(withPlan).draft.items[0].assignments[0].hours, "");
});

test("live print rules keep existing LMS curriculum hours", () => {
  const lms = draftSchema.parse({
    kind: "PERSON",
    businessRuleVersion: "LIVE_V1",
    items: [
      {
        id: "r1",
        assignments: [
          {
            id: "l1",
            templateId: "lms-certificate",
            hours: "36",
            fieldOrigins: { hours: "AUTO" },
          },
        ],
      },
    ],
  });
  assert.equal(resolveDraft(lms).draft.items[0].assignments[0].hours, "36");
});

test("changing a BiOT category preserves a previously entered value without origin metadata", () => {
  const draft = request("biot-worker-card", "biot-protocol", ["ITR"], {
    biotCategory: "WORKER",
    hours: "10",
  });
  const primary = draft.items[0].assignments[0];
  primary.hours = "10";
  primary.biotCategory = "WORKER";
  const updated = applyBusinessRules(draft);
  assert.equal(updated.items[0].assignments[0].hours, "10");
  assert.equal(updated.events![0].commonFields.hours, "10");
});
