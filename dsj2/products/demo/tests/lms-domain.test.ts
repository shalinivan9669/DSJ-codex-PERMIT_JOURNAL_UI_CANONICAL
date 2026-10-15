import { test } from "node:test";
import assert from "node:assert/strict";
import {
  creditPlayback,
  gradeAnswers,
  mergeWatchedIntervals,
  parseByteRange,
  validatedAnswers,
} from "../apps/api/src/lms/engine";

test("video seeks, repeat heartbeats and accelerated playback cannot invent watched intervals", () => {
  const base = {
    intervals: [[0, 10]] as [number, number][],
    previousPosition: 10,
    position: 100,
    elapsedSeconds: 2,
    duration: 120,
    playing: true,
  };
  assert.equal(creditPlayback(base).watchedSeconds, 10);
  assert.equal(creditPlayback({ ...base, position: 10 }).watchedSeconds, 10);
  assert.equal(creditPlayback({ ...base, position: 14 }).watchedSeconds, 10);
  assert.equal(creditPlayback({ ...base, position: 12 }).watchedSeconds, 12);
  assert.equal(
    creditPlayback({ ...base, position: 12, playing: false }).watchedSeconds,
    10,
  );
  assert.deepEqual(
    mergeWatchedIntervals(
      [
        [0, 20],
        [10, 30],
        [40, 50],
      ],
      45,
    ),
    [
      [0, 30],
      [40, 45],
    ],
  );
});

test("sanitary strict more than 80 percent differs from ordinary GTE policy", () => {
  const questions = Array.from({ length: 10 }, (_, i) => ({
    id: String(i),
    options: [{ id: "a" }, { id: "b" }],
    correctOptionIds: ["a"],
  }));
  const answers = Object.fromEntries(
    questions.slice(0, 8).map((q) => [q.id, ["a"]]),
  );
  assert.equal(
    gradeAnswers(questions, answers, { thresholdPercent: 80, comparison: "GT" })
      .verdict,
    "FAILED",
  );
  assert.equal(
    gradeAnswers(questions, answers, {
      thresholdPercent: 80,
      comparison: "GTE",
    }).verdict,
    "PASSED",
  );
  answers["8"] = ["a"];
  assert.equal(
    gradeAnswers(questions, answers, { thresholdPercent: 80, comparison: "GT" })
      .verdict,
    "PASSED",
  );
  assert.equal(validatedAnswers(questions, { "0": ["invented"] }), false);
  assert.equal(
    validatedAnswers(questions, { "missing-question": ["a"] }),
    false,
  );
});

test("multiple choice requires the exact set and partial byte ranges are bounded", () => {
  const questions = [
    {
      id: "1",
      options: [{ id: "a" }, { id: "b" }, { id: "c" }],
      correctOptionIds: ["a", "b"],
    },
  ];
  assert.equal(
    gradeAnswers(
      questions,
      { "1": ["a"] },
      { thresholdPercent: 80, comparison: "GT" },
    ).score,
    0,
  );
  assert.equal(
    gradeAnswers(
      questions,
      { "1": ["b", "a"] },
      { thresholdPercent: 80, comparison: "GT" },
    ).score,
    1,
  );
  assert.equal(
    gradeAnswers(
      questions,
      { "1": ["a", "b", "c"] },
      { thresholdPercent: 80, comparison: "GT" },
    ).score,
    0,
  );
  assert.deepEqual(parseByteRange("bytes=10-20", 100), {
    start: 10,
    end: 20,
    partial: true,
  });
  assert.deepEqual(parseByteRange("bytes=-10", 100), {
    start: 90,
    end: 99,
    partial: true,
  });
  assert.equal(parseByteRange("bytes=100-200", 100), null);
  assert.equal(parseByteRange("bytes=0-10,20-30", 100), null);
});
