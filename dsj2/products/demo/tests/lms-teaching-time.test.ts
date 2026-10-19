import test from "node:test";
import assert from "node:assert/strict";
import {
  isoToZonedInput as teachingLocalTime,
  zonedInputToIso as teachingUtcTime,
} from "../apps/web/lib/learning-time";
test("teaching time retains the chosen IANA zone and rejects DST gaps/folds", () => {
  assert.equal(
    teachingUtcTime("2026-10-18T14:30", "Asia/Qyzylorda"),
    "2026-10-18T09:30:00.000Z",
  );
  assert.equal(
    teachingLocalTime("2026-10-18T09:30:00.000Z", "Asia/Qyzylorda"),
    "2026-10-18T14:30",
  );
  assert.throws(() => teachingUtcTime("2026-03-08T02:30", "America/New_York"));
  assert.throws(() => teachingUtcTime("2026-11-01T01:30", "America/New_York"));
  assert.throws(() => teachingUtcTime("2026-02-30T12:00", "UTC"));
});
