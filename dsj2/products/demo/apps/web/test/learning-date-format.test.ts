import test from "node:test";
import assert from "node:assert/strict";
import { formatLearningDateTime } from "../lib/learning-date-format";

test("calendar uses numeric day-month-year and 24-hour time when Kazakh is unsupported", () => {
  const supportedLocalesOf = Intl.DateTimeFormat.supportedLocalesOf;
  Intl.DateTimeFormat.supportedLocalesOf = () => ["ru-KZ", "ru-RU"];
  try {
    assert.equal(
      formatLearningDateTime("2026-11-09T09:00:00Z", "Asia/Qyzylorda", "kk-KZ"),
      "09.11.2026, 14:00",
    );
  } finally {
    Intl.DateTimeFormat.supportedLocalesOf = supportedLocalesOf;
  }
});

test("minimal locale support cannot change date order or introduce English months and AM/PM", () => {
  const supportedLocalesOf = Intl.DateTimeFormat.supportedLocalesOf;
  Intl.DateTimeFormat.supportedLocalesOf = () => [];
  try {
    assert.equal(
      formatLearningDateTime("2026-11-09T09:00:00Z", "Asia/Qyzylorda", "kk-KZ"),
      "09.11.2026, 14:00",
    );
  } finally {
    Intl.DateTimeFormat.supportedLocalesOf = supportedLocalesOf;
  }
});

test("displayed calendar date respects local day rollover and uses 00 rather than 24 at midnight", () => {
  for (const locale of ["ru-KZ", "kk-KZ"])
    assert.equal(
      formatLearningDateTime("2026-12-31T19:05:00Z", "Asia/Qyzylorda", locale),
      "01.01.2027, 00:05",
    );
});
