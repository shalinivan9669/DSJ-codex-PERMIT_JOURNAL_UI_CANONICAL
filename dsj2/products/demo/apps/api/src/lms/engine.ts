import { randomInt } from "node:crypto";

export type WatchedInterval = [number, number];

/** Union intervals before counting time: replays and duplicate heartbeats add no credit. */
export function mergeWatchedIntervals(
  input: WatchedInterval[],
  duration: number,
): WatchedInterval[] {
  const valid = input
    .filter(([a, b]) => Number.isFinite(a) && Number.isFinite(b) && b > a)
    .map(([a, b]) => [Math.max(0, a), Math.min(duration, b)] as WatchedInterval)
    .filter(([a, b]) => b > a)
    .sort((a, b) => a[0] - b[0]);
  const result: WatchedInterval[] = [];
  for (const interval of valid) {
    const previous = result.at(-1);
    if (previous && interval[0] <= previous[1] + 0.01)
      previous[1] = Math.max(previous[1], interval[1]);
    else result.push([...interval]);
  }
  return result;
}

/** A seek can save the resume position, but cannot assert that the skipped part was watched. */
export function creditPlayback(input: {
  intervals: WatchedInterval[];
  previousPosition: number;
  position: number;
  elapsedSeconds: number;
  duration: number;
  playing: boolean;
}) {
  const position = Math.min(input.duration, Math.max(0, input.position));
  const advance = position - input.previousPosition;
  // A delayed/stale heartbeat may save position; at most 30 real seconds can be credited.
  const realSeconds = Math.min(30, Math.max(0, input.elapsedSeconds));
  const plausible =
    input.playing && advance > 0 && advance <= realSeconds + 0.75;
  const intervals = mergeWatchedIntervals(
    plausible
      ? [...input.intervals, [input.previousPosition, position]]
      : input.intervals,
    input.duration,
  );
  const watchedSeconds = intervals.reduce((sum, [a, b]) => sum + b - a, 0);
  return {
    position,
    intervals,
    watchedSeconds,
    completed: input.duration > 0 && watchedSeconds >= input.duration * 0.95,
  };
}

export type ScoredQuestion = {
  id: string;
  options: { id: string }[];
  correctOptionIds: string[];
};

export function gradeAnswers(
  questions: ScoredQuestion[],
  answers: Record<string, string[]>,
  policy: { thresholdPercent: number; comparison: "GT" | "GTE" },
) {
  let score = 0;
  for (const question of questions) {
    const received = [...new Set(answers[question.id] || [])].sort();
    const expected = [...new Set(question.correctOptionIds)].sort();
    if (
      received.length === expected.length &&
      received.every((answer, index) => answer === expected[index])
    )
      score += 1;
  }
  const maxScore = questions.length;
  // Integer cross multiplication keeps the strict 80% boundary exact.
  const passed =
    maxScore > 0 &&
    (policy.comparison === "GT"
      ? score * 100 > maxScore * policy.thresholdPercent
      : score * 100 >= maxScore * policy.thresholdPercent);
  return {
    score,
    maxScore,
    percent: maxScore ? (score * 100) / maxScore : 0,
    verdict: passed ? ("PASSED" as const) : ("FAILED" as const),
  };
}

export function shuffled<T>(values: T[]): T[] {
  const result = [...values];
  for (let i = result.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

export function validatedAnswers(
  questions: ScoredQuestion[],
  answers: Record<string, string[]>,
): boolean {
  return Object.entries(answers).every(([id, choices]) => {
    const question = questions.find((q) => q.id === id);
    return (
      !!question &&
      choices.length <= question.options.length &&
      choices.every((choice) => question.options.some((o) => o.id === choice))
    );
  });
}

export function parseByteRange(header: string | undefined, size: number) {
  if (!header) return { start: 0, end: size - 1, partial: false };
  const match = /^bytes=(\d*)-(\d*)$/.exec(header);
  if (!match || (!match[1] && !match[2])) return null;
  const start = match[1]
    ? Number(match[1])
    : Math.max(0, size - Number(match[2]));
  const end = match[1]
    ? match[2]
      ? Math.min(Number(match[2]), size - 1)
      : size - 1
    : size - 1;
  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(end) ||
    start < 0 ||
    start >= size ||
    end < start
  )
    return null;
  return { start, end, partial: true };
}
