import test from "node:test";
import assert from "node:assert/strict";
import {
  calculateDates,
  draftSchema,
  eventProtocolAssignment,
  resolveCommonDates,
  resolveDraft,
  trainingDateRuleSchema,
  today,
  assignmentSchema,
  type TrainingDateRule,
} from "../packages/contracts/src";

const rule: TrainingDateRule = {
  hoursPerDay: 8,
  hoursSource: "THEORY",
  calendar: "CALENDAR",
  anchor: "DOCUMENT_IS_END",
  protocolDate: "TRAINING_END",
  source: "Синтетический график теста, не норматив БиОТ",
};
const fixture = () =>
  draftSchema.parse({
    kind: "PERSON",
    schemaVersion: 2,
    commonFields: { documentDate: "2028-03-01", trainingDateRule: rule },
    events: [
      {
        id: "event",
        title: "Рабочие",
        protocolTemplateId: "biot-protocol",
        commonFields: {
          hours: "24",
          productionHours: "16",
          biotCategory: "WORKER",
        },
      },
    ],
    items: [
      {
        id: "person",
        assignments: [
          {
            id: "card",
            templateId: "biot-worker-card",
            eventId: "event",
            protocolMode: "GROUP",
            outcome: { status: "UNKNOWN", source: "" },
          },
        ],
      },
    ],
  });

test("today uses the center calendar across the UTC year boundary", () => {
  const instant = new Date("2026-12-31T21:00:00Z");
  assert.equal(today("Asia/Qyzylorda", instant), "2027-01-01");
  assert.equal(today("UTC", instant), "2026-12-31");
});

test("no unsupported hours-to-days default is inferred from the BIOT category", () => {
  assert.deepEqual(
    calculateDates({
      documentDate: "2028-02-29",
      hours: "40",
      biotCategory: "OHS_SPECIALIST_SPECIAL",
    }).proposed,
    { validUntil: "2031-02-28" },
  );
  assert.equal(
    trainingDateRuleSchema.safeParse({ hoursPerDay: 8 }).success,
    false,
  );
  assert.equal(
    trainingDateRuleSchema.safeParse({ ...rule, source: "" }).success,
    false,
  );
});

test("configured inclusive calendar periods cross leap days, months and years and round incomplete days upward", () => {
  for (const [date, hours, start] of [
    ["2028-03-01", "24", "2028-02-28"],
    ["2027-01-01", "24", "2026-12-30"],
    ["2026-10-01", "9", "2026-09-30"],
    ["2026-09-25", "8", "2026-09-25"],
  ]) {
    const result = calculateDates({ documentDate: date, hours }, rule);
    assert.equal(result.proposed.trainingStart, start);
    assert.equal(result.proposed.trainingEnd, date);
    assert.equal(result.proposed.protocolDate, date);
    assert.equal(result.problems.length, 0);
  }
  assert.equal(
    calculateDates(
      { documentDate: "2026-01-31", hours: "16" },
      { ...rule, anchor: "DOCUMENT_IS_START" },
    ).proposed.trainingEnd,
    "2026-02-01",
  );
});

test("weekday schedules skip only explicit weekends and reject a weekend anchor instead of silently moving it", () => {
  const weekdays = { ...rule, calendar: "WEEKDAYS" as const };
  assert.equal(
    calculateDates({ documentDate: "2026-09-28", hours: "24" }, weekdays)
      .proposed.trainingStart,
    "2026-09-24",
  );
  const invalid = calculateDates(
    { documentDate: "2026-09-27", hours: "24" },
    weekdays,
  );
  assert.equal(invalid.proposed.trainingStart, undefined);
  assert.equal(invalid.problems.length, 1);
});

test("the configured hour source controls duration; changing hours never changes category validity", () => {
  const values = {
    documentDate: "2026-09-25",
    hours: "10",
    productionHours: "16",
    biotCategory: "WORKER" as const,
  };
  const theory = calculateDates(values, rule);
  const total = calculateDates(values, {
    ...rule,
    hoursSource: "THEORY_AND_PRODUCTION",
  });
  assert.equal(theory.trainingDays, 2);
  assert.equal(total.trainingDays, 4);
  assert.equal(theory.proposed.validUntil, total.proposed.validUntil);
  assert.equal(
    calculateDates({ ...values, hours: "100000" }, rule).problems.length,
    1,
  );
  assert.equal(
    calculateDates({ ...values, hours: "0" }, rule).problems.length,
    1,
  );
});

test("request date and hours propagate to one shared event, individual documents and protocol without confirming outcomes", () => {
  const draft = fixture();
  draft.items = Array.from({ length: 100 }, (_, i) => ({
    ...draft.items[0],
    id: `person-${i}`,
  }));
  const before = JSON.stringify(draft);
  const first = resolveDraft(draft);
  assert.equal(first.draft.events![0].commonFields.documentDate, "2028-03-01");
  assert.equal(first.draft.events![0].commonFields.trainingStart, "2028-02-28");
  for (const item of first.draft.items) {
    assert.equal(item.assignments[0].trainingStart, "2028-02-28");
    assert.equal(item.assignments[0].outcome?.status, "UNKNOWN");
  }
  const protocol = eventProtocolAssignment(
    first.draft.events![0],
    first.draft.items[0].assignments[0],
  );
  assert.equal(protocol.trainingStart, "2028-02-28");
  assert.equal(protocol.validUntil, "2029-03-01");
  assert.equal(JSON.stringify(draft), before);
  draft.commonFields!.documentDate = "2029-01-01";
  draft.events![0].commonFields.hours = "40";
  const next = resolveDraft(draft);
  assert.equal(next.draft.items[0].assignments[0].trainingStart, "2028-12-28");
  assert.equal(next.draft.events![0].commonFields.trainingStart, "2028-12-28");
  assert.equal(next.draft.items[0].assignments[0].validUntil, "2030-01-01");
});

test("manual/imported/cleared event dates persist across serialized reload and explicit reset restores automatic calculation", () => {
  for (const origin of ["MANUAL", "IMPORTED", "CLEARED"] as const) {
    const draft = fixture();
    draft.events![0].commonFields.trainingStart =
      origin === "CLEARED" ? "" : "2028-02-28";
    draft.events![0].commonFields.dateOrigins = { trainingStart: origin };
    draft.commonFields!.documentDate = "2029-01-01";
    const reloaded = draftSchema.parse(JSON.parse(JSON.stringify(draft)));
    assert.equal(
      resolveDraft(reloaded).draft.items[0].assignments[0].trainingStart,
      origin === "CLEARED" ? "" : "2028-02-28",
    );
    reloaded.events![0].commonFields.dateOrigins = { trainingStart: "AUTO" };
    assert.equal(
      resolveDraft(reloaded).draft.items[0].assignments[0].trainingStart,
      "2028-12-30",
    );
  }
});

test("saved legacy event values are preserved; individual manual date conflicts cannot silently alter the group", () => {
  const draft = fixture();
  draft.events![0].commonFields.validUntil = "2028-10-01";
  let result = resolveDraft(draft);
  assert.equal(result.draft.items[0].assignments[0].validUntil, "2028-10-01");
  draft.items[0].assignments[0].trainingStart = "2028-02-01";
  draft.items[0].assignments[0].fieldOrigins = { trainingStart: "MANUAL" };
  result = resolveDraft(draft);
  assert.equal(
    result.issues.some((i) => i.code === "GROUP_COMMON_OVERRIDE"),
    true,
  );
  draft.items[0].assignments[0].fieldOrigins = { trainingStart: "INHERITED" };
  assert.equal(
    resolveDraft(draft).draft.items[0].assignments[0].trainingStart,
    "2028-02-28",
  );
});

test("automatic markers survive stored calculated fields and disabling a rule clears only automatic dates", () => {
  const common = resolveCommonDates({
    documentDate: "2028-03-01",
    hours: "24",
    trainingDateRule: rule,
  });
  common.documentDate = "2029-01-01";
  assert.equal(resolveCommonDates(common).trainingStart, "2028-12-30");
  common.trainingDateRule = null;
  assert.equal(resolveCommonDates(common).trainingStart, "");
  common.trainingStart = "2026-01-01";
  common.dateOrigins = { trainingStart: "MANUAL" };
  assert.equal(resolveCommonDates(common).trainingStart, "2026-01-01");
});

test("generated protocol does not leak common-only date metadata into its strict assignment contract", () => {
  const resolved = resolveDraft(fixture()).draft;
  const protocol = eventProtocolAssignment(
    resolved.events![0],
    resolved.items[0].assignments[0],
  );
  assert.equal(Object.hasOwn(protocol, "dateOrigins"), false);
  assert.equal(assignmentSchema.safeParse(protocol).success, true);
  assert.equal(protocol.trainingStart, "2028-02-28");
  assert.deepEqual(protocol.trainingDateRule, rule);
});

test("legacy schema1 group context receives no new period or validity calculations", () => {
  const legacy = fixture();
  delete legacy.schemaVersion;
  const before = JSON.stringify(legacy);
  const resolved = resolveDraft(legacy).draft;
  const assignment = resolved.items[0].assignments[0];
  assert.equal(assignment.trainingStart, "");
  assert.equal(assignment.trainingEnd, "");
  assert.equal(assignment.protocolDate, "");
  assert.equal(assignment.validUntil, "");
  assert.equal(resolved.events![0].commonFields.trainingStart, undefined);
  assert.equal(resolved.events![0].commonFields.validUntil, undefined);
  assert.equal(JSON.stringify(legacy), before);
});
