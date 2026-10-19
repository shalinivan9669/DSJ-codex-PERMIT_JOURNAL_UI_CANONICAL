import type {
  LearningAnswer,
  LearningAnswers,
  LmsQuestion,
} from "@demo/contracts/src/lms";
import { gradeAnswers, validatedAnswers } from "./engine";

type QuestionSpec = NonNullable<LmsQuestion["answerSpec"]>;
type ResponseSpec = Exclude<QuestionSpec, { kind: "CASE" }>;
type Policy = { thresholdPercent: number; comparison: "GT" | "GTE" };
export type ManualScores = Record<string, 0 | 1>;

export function questionResponseSpec(
  question: LmsQuestion,
): ResponseSpec | null {
  const spec = question.answerSpec;
  return !spec ? null : spec.kind === "CASE" ? spec.response : spec;
}

function choices(answer: LearningAnswer | undefined) {
  if (Array.isArray(answer)) return answer;
  if (answer?.kind === "SINGLE" || answer?.kind === "MULTIPLE")
    return answer.optionIds;
  return null;
}

function unique(values: string[]) {
  return new Set(values).size === values.length;
}

function sameSet(left: string[], right: string[]) {
  const a = [...left].sort();
  const b = [...right].sort();
  return a.length === b.length && a.every((value, i) => value === b[i]);
}

/** A legacy snapshot retains its original choice validation and exact-set score. */
export function validateLearningAnswers(
  questions: LmsQuestion[],
  answers: LearningAnswers,
): boolean {
  return Object.entries(answers).every(([id, answer]) => {
    const question = questions.find((item) => item.id === id);
    if (!question) return false;
    const spec = questionResponseSpec(question);
    if (!spec) {
      const selected = choices(answer);
      return (
        selected !== null && validatedAnswers([question], { [id]: selected })
      );
    }
    if (Array.isArray(answer)) {
      // Old clients may still send choice arrays. Other response modes require
      // an explicit discriminator; a list of words cannot become a text answer.
      if (spec.kind !== "SINGLE" && spec.kind !== "MULTIPLE") return false;
      return (
        unique(answer) &&
        answer.length <=
          (spec.kind === "SINGLE" ? 1 : question.options.length) &&
        answer.every((value) => question.options.some((o) => o.id === value))
      );
    }
    if (answer.kind !== spec.kind) return false;
    if (
      (spec.kind === "SINGLE" || spec.kind === "MULTIPLE") &&
      (answer.kind === "SINGLE" || answer.kind === "MULTIPLE")
    )
      return (
        unique(answer.optionIds) &&
        answer.optionIds.length <=
          (spec.kind === "SINGLE" ? 1 : question.options.length) &&
        answer.optionIds.every((value) =>
          question.options.some((option) => option.id === value),
        )
      );
    if (spec.kind === "MATCHING" && answer.kind === "MATCHING")
      return (
        answer.pairs.length <= question.options.length &&
        unique(answer.pairs.map((pair) => pair.leftId)) &&
        unique(answer.pairs.map((pair) => pair.rightId)) &&
        answer.pairs.every(
          (pair) =>
            question.options.some((option) => option.id === pair.leftId) &&
            spec.rightOptions.some((option) => option.id === pair.rightId),
        )
      );
    if (spec.kind === "ORDERING" && answer.kind === "ORDERING")
      return (
        unique(answer.optionIds) &&
        answer.optionIds.length <= question.options.length &&
        answer.optionIds.every((value) =>
          question.options.some((option) => option.id === value),
        )
      );
    return (
      spec.kind === "TEXT" &&
      answer.kind === "TEXT" &&
      typeof answer.text === "string" &&
      answer.text.length <= 10000
    );
  });
}

function normalizeText(
  text: string,
  spec: Extract<ResponseSpec, { kind: "TEXT" }>,
) {
  let value = text.trim();
  if (spec.mode !== "EXACT") return value;
  if (spec.collapseWhitespace) value = value.replace(/\s+/gu, " ");
  if (!spec.caseSensitive) value = value.toLowerCase();
  return value;
}

export function manualQuestionIds(questions: LmsQuestion[]) {
  return questions
    .filter((question) => {
      const spec = questionResponseSpec(question);
      return spec?.kind === "TEXT" && spec.mode === "MANUAL";
    })
    .map((question) => question.id);
}

/** Every frozen question contributes exactly one point; no inferred partial credit. */
export function gradeLearningAnswers(
  questions: LmsQuestion[],
  answers: LearningAnswers,
  policy: Policy,
  manualScores: ManualScores = {},
) {
  if (!validateLearningAnswers(questions, answers))
    throw new Error("ANSWERS_INVALID");
  const manualIds = new Set(manualQuestionIds(questions));
  if (
    Object.entries(manualScores).some(
      ([id, score]) => !manualIds.has(id) || (score !== 0 && score !== 1),
    )
  )
    throw new Error("MANUAL_SCORES_INVALID");

  const pendingQuestionIds: string[] = [];
  const questionScores: Record<string, number | null> = {};
  let score = 0;
  for (const question of questions) {
    const answer = answers[question.id];
    const spec = questionResponseSpec(question);
    let points: 0 | 1 | null = 0;
    if (!spec) {
      const legacy = gradeAnswers(
        [question],
        { [question.id]: choices(answer) || [] },
        { thresholdPercent: 100, comparison: "GTE" },
      );
      points = legacy.score ? 1 : 0;
    } else if (spec.kind === "SINGLE" || spec.kind === "MULTIPLE") {
      const selected = choices(answer) || [];
      points =
        selected.length > 0 && sameSet(selected, spec.correctOptionIds) ? 1 : 0;
    } else if (spec.kind === "MATCHING") {
      const pairs =
        answer && !Array.isArray(answer) && answer.kind === "MATCHING"
          ? answer.pairs
          : [];
      points =
        pairs.length > 0 &&
        pairs.length === spec.pairs.length &&
        pairs.every((pair) =>
          spec.pairs.some(
            (expected) =>
              expected.leftId === pair.leftId &&
              expected.rightId === pair.rightId,
          ),
        )
          ? 1
          : 0;
    } else if (spec.kind === "ORDERING") {
      const selected =
        answer && !Array.isArray(answer) && answer.kind === "ORDERING"
          ? answer.optionIds
          : [];
      points =
        selected.length > 0 &&
        selected.length === spec.correctOrderIds.length &&
        selected.every((id, index) => id === spec.correctOrderIds[index])
          ? 1
          : 0;
    } else {
      const text =
        answer && !Array.isArray(answer) && answer.kind === "TEXT"
          ? answer.text
          : "";
      if (text.trim() && spec.mode === "EXACT")
        points = spec.acceptedAnswers.some(
          (expected) =>
            normalizeText(text, spec) === normalizeText(expected, spec),
        )
          ? 1
          : 0;
      else if (text.trim() && spec.mode === "MANUAL") {
        if (Object.hasOwn(manualScores, question.id))
          points = manualScores[question.id];
        else {
          points = null;
          pendingQuestionIds.push(question.id);
        }
      }
    }
    questionScores[question.id] = points;
    score += points || 0;
  }
  const maxScore = questions.length;
  const passed =
    maxScore > 0 &&
    (policy.comparison === "GT"
      ? score * 100 > maxScore * policy.thresholdPercent
      : score * 100 >= maxScore * policy.thresholdPercent);
  return {
    algorithmVersion: questions.some((q) => q.answerSpec)
      ? ("TYPED_EXACT_V2" as const)
      : ("LEGACY_CHOICES_V1" as const),
    score,
    maxScore,
    percent: maxScore ? (score * 100) / maxScore : 0,
    verdict: pendingQuestionIds.length
      ? ("AWAITING_REVIEW" as const)
      : passed
        ? ("PASSED" as const)
        : ("FAILED" as const),
    pendingQuestionIds,
    questionScores,
  };
}

function publicResponseSpec(spec: ResponseSpec) {
  switch (spec.kind) {
    case "SINGLE":
    case "MULTIPLE":
    case "ORDERING":
      return { kind: spec.kind };
    case "MATCHING":
      return { kind: spec.kind, rightOptions: spec.rightOptions };
    case "TEXT":
      return spec.mode === "MANUAL"
        ? {
            kind: spec.kind,
            mode: spec.mode,
            criteriaRu: spec.criteriaRu,
            criteriaKz: spec.criteriaKz,
          }
        : { kind: spec.kind, mode: spec.mode };
  }
}

/** Reused by content, attempt and autosave projections; never leak scoring keys. */
export function publicQuestion(question: LmsQuestion, reveal = false) {
  if (reveal) return structuredClone(question);
  const {
    correctOptionIds: _correct,
    explanationRu: _explanationRu,
    explanationKz: _explanationKz,
    answerSpec,
    ...visible
  } = question;
  return {
    ...visible,
    ...(answerSpec
      ? {
          answerSpec:
            answerSpec.kind === "CASE"
              ? {
                  kind: "CASE" as const,
                  contextRu: answerSpec.contextRu,
                  contextKz: answerSpec.contextKz,
                  response: publicResponseSpec(answerSpec.response),
                }
              : publicResponseSpec(answerSpec),
        }
      : {}),
  };
}
