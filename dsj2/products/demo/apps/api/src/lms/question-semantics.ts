import { createHash } from "node:crypto";
import type { LmsQuestion } from "@demo/contracts/src/lms";

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
