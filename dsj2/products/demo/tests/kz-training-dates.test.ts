import test from "node:test";
import assert from "node:assert/strict";
import {
  calculateDates,
  draftSchema,
  resolveDraft,
  resolveCommonDates,
  trainingDateRuleSchema,
  KZ_TRAINING_CALENDAR_VERSION,
  type TrainingDateRule,
} from "../packages/contracts/src";
import { kzTrainingDay } from "../packages/contracts/src/kz-training-calendar";

const rule: TrainingDateRule = {
  hoursPerDay: 8,
  hoursSource: "THEORY",
  calendar: "KZ_FIVE_DAY",
  calendarVersion: KZ_TRAINING_CALENDAR_VERSION,
  anchor: "DOCUMENT_AFTER_TRAINING",
  protocolDate: "DOCUMENT_DATE",
  source: "Синтетический график: 8 часов выбраны центром для теста",
};
const calculate = (documentDate: string, hours = "16") =>
  calculateDates({ documentDate, hours }, rule);

test("verified five-day calendars match official 2025 and revised 2026 annual totals", () => {
  for (const [year, total] of [
    [2025, 246],
    [2026, 247],
  ]) {
    let count = 0;
    for (
      const date = new Date(`${year}-01-01T12:00:00Z`);
      date.getUTCFullYear() === year;
      date.setUTCDate(date.getUTCDate() + 1)
    )
      if (kzTrainingDay(date)) count++;
    assert.equal(count, total);
  }
  assert.equal(kzTrainingDay(new Date("2025-01-05T12:00:00Z")), true);
  assert.equal(kzTrainingDay(new Date("2025-01-03T12:00:00Z")), false);
  assert.equal(kzTrainingDay(new Date("2026-03-16T12:00:00Z")), true);
  assert.equal(kzTrainingDay(new Date("2026-08-31T12:00:00Z")), true);
});

test("strict-before schedule accepts weekend issue day and skips holidays and transferred rest days", () => {
  for (const [date, start, end] of [
    ["2026-09-27", "2026-09-24", "2026-09-25"],
    ["2026-09-28", "2026-09-24", "2026-09-25"],
    ["2026-03-26", "2026-03-19", "2026-03-20"],
    ["2026-05-12", "2026-05-06", "2026-05-08"],
    ["2026-05-28", "2026-05-25", "2026-05-26"],
    ["2026-09-01", "2026-08-28", "2026-08-31"],
    ["2025-10-28", "2025-10-23", "2025-10-24"],
    ["2025-01-08", "2025-01-05", "2025-01-06"],
    ["2027-01-01", "2026-12-30", "2026-12-31"],
  ]) {
    const result = calculate(date);
    assert.equal(result.proposed.trainingStart, start);
    assert.equal(result.proposed.trainingEnd, end);
    assert.equal(result.proposed.protocolDate, date);
    assert.deepEqual(result.problems, []);
  }
  assert.equal(calculate("2025-01-06", "8").proposed.trainingEnd, "2025-01-05");
  assert.equal(
    calculate("2026-01-08", "32").proposed.trainingStart,
    "2025-12-30",
  );
});

test("calendar version and full date coverage are explicit; unknown years never fall back to weekdays", () => {
  assert.equal(
    trainingDateRuleSchema.safeParse({ ...rule, calendarVersion: undefined })
      .success,
    false,
  );
  for (const date of ["2027-01-02", "2027-01-04", "2024-12-31", "2025-01-01"]) {
    const result = calculate(date);
    assert.equal(result.proposed.trainingStart, undefined);
    assert.equal(result.proposed.trainingEnd, undefined);
    assert.match(result.problems.join(" "), /2025–2026/);
  }
});

test("separate academic and production blocks use separate explicit capacities without unit conversion", () => {
  const blocks = {
    ...rule,
    hoursSource: "SEPARATE_BLOCKS" as const,
    productionHoursPerDay: 8,
  };
  const values = {
    documentDate: "2026-09-28",
    hours: "10",
    productionHours: "16",
  };
  assert.equal(
    trainingDateRuleSchema.safeParse({
      ...blocks,
      productionHoursPerDay: undefined,
    }).success,
    false,
  );
  assert.equal(calculateDates(values, rule).trainingDays, 2);
  const result = calculateDates(values, blocks);
  assert.equal(result.trainingDays, 4);
  assert.equal(result.proposed.trainingStart, "2026-09-22");
  assert.equal(result.proposed.trainingEnd, "2026-09-25");
  assert.equal(
    calculateDates(values, { ...blocks, productionHoursPerDay: 4 })
      .trainingDays,
    6,
  );
});

test("center schedule, request date and mixed individual category hours resolve independently with retroactive overrides", () => {
  const draft = draftSchema.parse({
    kind: "PERSON",
    schemaVersion: 2,
    commonFields: { documentDate: "2026-09-29" },
    items: [
      {
        id: "person",
        assignments: [
          {
            id: "worker",
            templateId: "biot-worker-card",
            biotCategory: "WORKER",
            hours: "10",
            productionHours: "16",
          },
          {
            id: "itr",
            templateId: "biot-itr-certificate",
            biotCategory: "OHS_SPECIALIST_SPECIAL",
            hours: "40",
          },
          {
            id: "retro",
            templateId: "ptm-card",
            hours: "8",
            documentDate: "2025-01-06",
            fieldOrigins: { documentDate: "MANUAL" },
          },
        ],
      },
    ],
  });
  const before = JSON.stringify(draft);
  const resolved = resolveDraft(draft, { trainingDateRule: rule });
  const [worker, itr, retro] = resolved.draft.items[0].assignments;
  assert.equal(worker.trainingStart, "2026-09-25");
  assert.equal(itr.trainingStart, "2026-09-22");
  assert.equal(retro.documentDate, "2025-01-06");
  assert.equal(retro.trainingStart, "2025-01-05");
  assert.equal(retro.trainingEnd, "2025-01-05");
  assert.equal(JSON.stringify(draft), before);
  assert.equal(
    resolveCommonDates(
      { documentDate: "2026-09-29", hours: "10" },
      { trainingDateRule: rule },
    ).trainingStart,
    worker.trainingStart,
  );
  draft.commonFields!.trainingDateRule = null;
  assert.equal(
    resolveDraft(draft, { trainingDateRule: rule }).draft.items[0]
      .assignments[0].trainingStart,
    "",
  );
});

test("manual imported and cleared dates remain exact and invalid strict-before overrides point to their own fields", () => {
  for (const origin of ["MANUAL", "IMPORTED", "CLEARED"] as const) {
    const value = origin === "CLEARED" ? "" : "2026-09-29";
    const draft = draftSchema.parse({
      kind: "PERSON",
      schemaVersion: 2,
      commonFields: { documentDate: "2026-09-29", trainingDateRule: rule },
      items: [
        {
          id: "row",
          assignments: [
            {
              id: "card",
              templateId: "ptm-card",
              hours: "16",
              trainingStart: value,
              trainingEnd: value,
              fieldOrigins: { trainingStart: origin, trainingEnd: origin },
            },
          ],
        },
      ],
    });
    const resolved = resolveDraft(
      draftSchema.parse(JSON.parse(JSON.stringify(draft))),
    );
    assert.equal(resolved.draft.items[0].assignments[0].trainingStart, value);
    assert.equal(resolved.draft.items[0].assignments[0].trainingEnd, value);
    const issues = resolved.issues.filter(
      (issue) => issue.code === "TRAINING_BEFORE_DOCUMENT",
    );
    assert.deepEqual(
      issues.map((issue) => issue.path),
      origin === "CLEARED"
        ? []
        : [
            "items.0.assignments.0.trainingStart",
            "items.0.assignments.0.trainingEnd",
          ],
    );
    assert.ok(issues.every((issue) => issue.rowId === "row"));
    draft.commonFields!.trainingDateRule = {
      ...rule,
      anchor: "DOCUMENT_IS_END",
    };
    assert.ok(
      !resolveDraft(draft).issues.some(
        (issue) => issue.code === "TRAINING_BEFORE_DOCUMENT",
      ),
    );
  }
});

test("mixed events retain independent durations and shared protocol dates with the center schedule", () => {
  const draft = draftSchema.parse({
    kind: "COMPANY",
    schemaVersion: 2,
    commonFields: { documentDate: "2026-09-29" },
    events: [
      {
        id: "workers",
        title: "Рабочие",
        protocolTemplateId: "biot-protocol",
        commonFields: {
          hours: "10",
          productionHours: "16",
          biotCategory: "WORKER",
        },
      },
      {
        id: "itr",
        title: "ИТР",
        protocolTemplateId: "biot-itr-protocol",
        commonFields: { hours: "40", biotCategory: "OHS_SPECIALIST_SPECIAL" },
      },
    ],
    items: [
      {
        id: "one",
        assignments: [
          {
            id: "worker",
            templateId: "biot-worker-card",
            eventId: "workers",
            protocolMode: "GROUP",
          },
          {
            id: "itr-card",
            templateId: "biot-itr-certificate",
            eventId: "itr",
            protocolMode: "GROUP",
          },
        ],
      },
    ],
  });
  const result = resolveDraft(draft, { trainingDateRule: rule });
  assert.equal(
    result.draft.events![0].commonFields.trainingStart,
    "2026-09-25",
  );
  assert.equal(
    result.draft.events![1].commonFields.trainingStart,
    "2026-09-22",
  );
  assert.equal(
    result.draft.items[0].assignments[0].trainingStart,
    "2026-09-25",
  );
  assert.equal(
    result.draft.items[0].assignments[1].trainingStart,
    "2026-09-22",
  );
});
