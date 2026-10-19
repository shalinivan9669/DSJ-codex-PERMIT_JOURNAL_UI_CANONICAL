import { createHash } from "node:crypto";
import type { LmsQuestion, QuestionAnswerSpec } from "@demo/contracts/src/lms";

function answerMeaning(spec: QuestionAnswerSpec): unknown {
  if (spec.kind === "CASE")
    return { ...spec, response: answerMeaning(spec.response) };
  if (spec.kind === "SINGLE" || spec.kind === "MULTIPLE")
    return { ...spec, correctOptionIds: [...spec.correctOptionIds].sort() };
  if (spec.kind === "MATCHING")
    return {
      ...spec,
      pairs: [...spec.pairs].sort((a, b) => a.leftId.localeCompare(b.leftId)),
      rightOptions: [...spec.rightOptions].sort((a, b) =>
        a.id.localeCompare(b.id),
      ),
    };
  if (spec.kind === "TEXT" && spec.mode === "EXACT")
    return { ...spec, acceptedAnswers: [...spec.acceptedAnswers].sort() };
  return spec;
}

/** Metadata identifying a revision is never part of its educational meaning. */
export function questionMeaning(q: LmsQuestion) {
  return {
    category: q.category,
    topic: q.topic || "",
    promptRu: q.promptRu,
    promptKz: q.promptKz,
    options: q.options
      .map((option) => ({ ...option }))
      .sort((a, b) => a.id.localeCompare(b.id)),
    correctOptionIds: [...q.correctOptionIds].sort(),
    multiple: q.multiple,
    explanationRu: q.explanationRu || "",
    explanationKz: q.explanationKz || "",
    difficulty: q.difficulty || "UNKNOWN",
    source: q.source || "",
    ...(q.answerSpec ? { answerSpec: answerMeaning(q.answerSpec) } : {}),
  };
}
export function questionSemanticHash(q: LmsQuestion) {
  return createHash("sha256")
    .update(JSON.stringify(questionMeaning(q)))
    .digest("hex");
}
export function embeddedQuestionId(courseId: string, clientId: string) {
  return (
    "q_" +
    createHash("sha256")
      .update(`${courseId}:${clientId}`)
      .digest("hex")
      .slice(0, 40)
  );
}
