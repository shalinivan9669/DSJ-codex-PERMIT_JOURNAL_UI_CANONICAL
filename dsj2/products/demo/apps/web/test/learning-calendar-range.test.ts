import test from "node:test";
import assert from "node:assert/strict";
import {
  learningCalendarRange,
  learningCalendarToday,
} from "../lib/learning-calendar-range";

test("calendar starts at local midnight and covers the early hours of the selected Kazakhstan date", () => {
  assert.equal(
    learningCalendarToday("Asia/Qyzylorda", new Date("2026-11-06T20:30:00Z")),
    "2026-11-07",
  );
  assert.deepEqual(learningCalendarRange("2026-11-07", "Asia/Qyzylorda"), {
    from: "2026-11-06T19:00:00.000Z",
    to: "2026-12-07T19:00:00.000Z",
  });
});

test("calendar spans 31 local dates across daylight saving and year boundaries", () => {
  assert.deepEqual(learningCalendarRange("2026-03-01", "America/New_York"), {
    from: "2026-03-01T05:00:00.000Z",
    to: "2026-04-01T04:00:00.000Z",
  });
  assert.deepEqual(learningCalendarRange("2026-12-15", "Asia/Qyzylorda"), {
    from: "2026-12-14T19:00:00.000Z",
    to: "2027-01-14T19:00:00.000Z",
  });
  assert.deepEqual(learningCalendarRange("2024-02-29", "UTC"), {
    from: "2024-02-29T00:00:00.000Z",
    to: "2024-03-31T00:00:00.000Z",
  });
});

test("empty, incomplete, impossible and unrepresentable calendar dates do not produce requests", () => {
  for (const value of [
    "",
    "2026-11",
    "2026-2-01",
    "2026-02-29",
    "2026-04-31",
    "2026-13-01",
    "9999-12-31",
  ])
    assert.equal(learningCalendarRange(value, "Asia/Qyzylorda"), null, value);
  assert.equal(learningCalendarRange("2026-11-07", "Invalid/Zone"), null);
  assert.equal(learningCalendarToday("Invalid/Zone"), "");
});
