"use client";
import type {
  LearningAnswer,
  QuestionAnswerSpec,
} from "@demo/contracts/src/lms";
import type { Attempt, PublicQuestion } from "@/lib/lms-api";
import type { Translate } from "./common";

function answerText(
  question: PublicQuestion,
  answer: LearningAnswer | undefined,
  t: Translate,
) {
  const option = (id: string) => {
    const row = question.options.find((item) => item.id === id);
    return row
      ? t(row.textRu, row.textKz)
      : t("Вариант не найден", "Нұсқа табылмады");
  };
  if (!answer) return t("Ответ не дан", "Жауап берілмеді");
  if (Array.isArray(answer))
    return answer.length
      ? answer.map(option).join("; ")
      : t("Ответ не дан", "Жауап берілмеді");
  if (answer.kind === "TEXT")
    return answer.text || t("Ответ не дан", "Жауап берілмеді");
  if (answer.kind === "MATCHING") {
    const spec =
      question.answerSpec?.kind === "CASE"
        ? question.answerSpec.response
        : question.answerSpec;
    return (
      answer.pairs
        .map((pair) => {
          const right =
            spec?.kind === "MATCHING"
              ? spec.rightOptions.find((row) => row.id === pair.rightId)
              : null;
          return `${option(pair.leftId)} → ${right ? t(right.textRu, right.textKz) : "—"}`;
        })
        .join("; ") || t("Ответ не дан", "Жауап берілмеді")
    );
  }
  return (
    answer.optionIds
      .map(option)
      .join(answer.kind === "ORDERING" ? " → " : "; ") ||
    t("Ответ не дан", "Жауап берілмеді")
  );
}
function correctAnswer(question: PublicQuestion): LearningAnswer | undefined {
  const full = question as PublicQuestion & {
    correctOptionIds?: string[];
    answerSpec?: QuestionAnswerSpec;
  };
  const spec =
    full.answerSpec?.kind === "CASE"
      ? full.answerSpec.response
      : full.answerSpec;
  if (!spec) return full.correctOptionIds;
  if (spec.kind === "SINGLE" || spec.kind === "MULTIPLE")
    return { kind: spec.kind, optionIds: spec.correctOptionIds };
  if (spec.kind === "MATCHING") return { kind: spec.kind, pairs: spec.pairs };
  if (spec.kind === "ORDERING")
    return { kind: spec.kind, optionIds: spec.correctOrderIds };
  if (spec.mode === "EXACT")
    return { kind: "TEXT", text: spec.acceptedAnswers.join(" / ") };
  return undefined;
}
/** Rendering only uses the attempt projection; keys are absent unless this exact snapshot allows disclosure. */
export function AttemptReview({
  attempt,
  t,
}: {
  attempt: Attempt;
  t: Translate;
}) {
  const review = attempt.review;
  if (attempt.state === "IN_PROGRESS" || !review) return null;
  return (
    <section
      className="lms-panel"
      aria-label={t("Разбор попытки", "Талпынысты талдау")}
    >
      <p>
        {t("Проходной порог", "Өту шегі")}:{" "}
        {review.comparison === "GT" ? ">" : "≥"} {review.thresholdPercent}% ·{" "}
        {t("Осталось попыток", "Қалған талпыныстар")}:{" "}
        {review.remainingAttempts}
      </p>
      {review.feedback && (
        <p>
          <strong>
            {t("Комментарий преподавателя", "Оқытушының түсініктемесі")}:{" "}
          </strong>
          {review.feedback}
        </p>
      )}
      {attempt.state === "FINISHED" && (
        <>
          <h3>{t("Разбор ответов", "Жауаптарды талдау")}</h3>
          {!review.revealAnswers && (
            <p>
              {t(
                "По правилам этой попытки правильные ответы и объяснения не раскрываются.",
                "Бұл талпыныстың ережелері бойынша дұрыс жауаптар мен түсіндірмелер көрсетілмейді.",
              )}
            </p>
          )}
          {attempt.questions.map((question, index) => {
            const score = review.questionScores[question.id];
            const expected = review.revealAnswers
              ? correctAnswer(question)
              : undefined;
            return (
              <article className="lms-question" key={question.id}>
                <h4>
                  {index + 1}. {t(question.promptRu, question.promptKz)}
                </h4>
                <p>
                  <strong>{t("Ваш ответ", "Жауабыңыз")}: </strong>
                  {answerText(question, attempt.answers[question.id], t)}
                </p>
                {score != null && (
                  <p>
                    {t("Баллы", "Ұпайлар")}: {score} / 1
                  </p>
                )}
                {expected && (
                  <p>
                    <strong>{t("Правильный ответ", "Дұрыс жауап")}: </strong>
                    {answerText(question, expected, t)}
                  </p>
                )}
                {review.revealAnswers &&
                  (question.explanationRu || question.explanationKz) && (
                    <p className="lms-prose">
                      {t(
                        question.explanationRu || "",
                        question.explanationKz || "",
                      )}
                    </p>
                  )}
              </article>
            );
          })}
        </>
      )}
    </section>
  );
}
