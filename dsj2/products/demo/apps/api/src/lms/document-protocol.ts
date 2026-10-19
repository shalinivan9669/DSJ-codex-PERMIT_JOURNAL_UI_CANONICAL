import type { Assignment, LearningAnswer, LmsQuestion } from "@demo/contracts";
import { questionResponseSpec } from "./assessment-grading";

export type FrozenProtocol = NonNullable<
  NonNullable<Assignment["lms"]>["protocol"]
>;

/** Human-readable examination evidence is frozen once, after grading. Never
 * resolve question IDs through today's editable question bank. */
export function protocolQuestion(
  question: LmsQuestion,
  answer: LearningAnswer | undefined,
  score: number | null,
): FrozenProtocol["questions"][number] {
  const spec = questionResponseSpec(question);
  function text(language: "Ru" | "Kz", correct: boolean) {
    const label = (id: string, right = false) => {
      const options =
        right && spec?.kind === "MATCHING"
          ? spec.rightOptions
          : question.options;
      const option = options.find((item) => item.id === id);
      return (
        option?.[`text${language}`] || option?.textRu || option?.textKz || id
      );
    };
    const list = (ids: string[]) => ids.map((id) => label(id)).join("; ");
    if (correct) {
      if (!spec) return list(question.correctOptionIds);
      if (spec.kind === "SINGLE" || spec.kind === "MULTIPLE")
        return list(spec.correctOptionIds);
      if (spec.kind === "ORDERING")
        return spec.correctOrderIds
          .map((id, i) => `${i + 1}. ${label(id)}`)
          .join("; ");
      if (spec.kind === "MATCHING")
        return spec.pairs
          .map((pair) => `${label(pair.leftId)} → ${label(pair.rightId, true)}`)
          .join("; ");
      if (spec.mode === "EXACT") return spec.acceptedAnswers.join(" / ");
      return spec[`criteria${language}`] || spec.criteriaRu || spec.criteriaKz;
    }
    if (!answer) return language === "Ru" ? "Ответ не дан" : "Жауап берілмеген";
    if (Array.isArray(answer)) return list(answer);
    if (answer.kind === "TEXT") return answer.text;
    if (answer.kind === "MATCHING")
      return answer.pairs
        .map((pair) => `${label(pair.leftId)} → ${label(pair.rightId, true)}`)
        .join("; ");
    if (answer.kind === "ORDERING")
      return answer.optionIds
        .map((id, i) => `${i + 1}. ${label(id)}`)
        .join("; ");
    return list(answer.optionIds);
  }
  const context =
    question.answerSpec?.kind === "CASE" ? question.answerSpec : null;
  return {
    id: question.id,
    promptRu: [context?.contextRu, question.promptRu]
      .filter(Boolean)
      .join("\n"),
    promptKz: [context?.contextKz, question.promptKz]
      .filter(Boolean)
      .join("\n"),
    correctAnswerRu: text("Ru", true),
    correctAnswerKz: text("Kz", true),
    responseRu: text("Ru", false),
    responseKz: text("Kz", false),
    score,
  };
}
