"use client";
import type { CourseContent } from "@demo/contracts/src/lms";
import type { Translate } from "./common";
import { LocalDeadline } from "./access-policy-editor";
import { QuestionLibrary, SaveLibraryQuestion } from "./question-library";
import {
  newAuthorQuestion,
  QuestionAuthor,
  questionKindName,
} from "./question-author";

type Assessment = CourseContent["exam"];
export function AssessmentAuthor({
  value,
  onChange,
  courseId,
  t,
  disabled = false,
  showValidation = false,
  flush,
  onBusy,
  timezone = "Asia/Qyzylorda",
}: {
  value: Assessment;
  onChange: (value: Assessment) => void;
  courseId: string;
  t: Translate;
  disabled?: boolean;
  showValidation?: boolean;
  flush: () => Promise<unknown>;
  onBusy: (busy: boolean) => void;
  timezone?: string;
}) {
  return (
    <div className="lms-assessment-author">
      {!disabled && (
        <QuestionLibrary
          courseId={courseId}
          t={t}
          onChoose={(question) =>
            onChange({
              ...value,
              questions: [
                ...value.questions.filter(
                  (item) =>
                    item.id !== question.id &&
                    (!question.libraryQuestionId ||
                      item.libraryQuestionId !== question.libraryQuestionId),
                ),
                question,
              ],
            })
          }
        />
      )}
      <details>
        <summary>{t("Параметры теста", "Тест параметрлері")}</summary>
        <div className="lms-fields">
          <LocalDeadline
            value={value.dueAt}
            onChange={(dueAt) => onChange({ ...value, dueAt })}
            timezone={timezone}
            t={t}
          />
          {(
            [
              ["questionCount", "Вопросов в попытке", "Талпыныстағы сұрақтар"],
              ["durationMinutes", "Время, минут", "Уақыт, минут"],
              ["maxAttempts", "Попыток", "Талпыныстар"],
              ["thresholdPercent", "Порог, %", "Шекті мән, %"],
            ] as const
          ).map(([key, ru, kz]) => (
            <label key={key}>
              {t(ru, kz)}
              <input
                type="number"
                min={key === "thresholdPercent" ? 0 : 1}
                max={key === "thresholdPercent" ? 100 : undefined}
                value={value[key]}
                onChange={(event) =>
                  onChange({ ...value, [key]: Number(event.target.value) })
                }
              />
            </label>
          ))}
          <label>
            {t("Правило порога", "Шекті мән ережесі")}
            <select
              value={value.comparison}
              onChange={(event) =>
                onChange({
                  ...value,
                  comparison: event.target.value as "GT" | "GTE",
                })
              }
            >
              <option value="GTE">
                {t("Не менее порога", "Шекті мәннен кем емес")}
              </option>
              <option value="GT">
                {t("Строго больше порога", "Шекті мәннен жоғары")}
              </option>
            </select>
          </label>
          <label className="lms-inline-label">
            <input
              type="checkbox"
              checked={value.revealAnswers}
              onChange={(event) =>
                onChange({ ...value, revealAnswers: event.target.checked })
              }
            />
            {t(
              "Показывать разбор после окончательной оценки",
              "Соңғы бағалаудан кейін талдауды көрсету",
            )}
          </label>
        </div>
      </details>
      {value.questions.map((question, index) => (
        <details key={question.id} id={`author-question-${question.id}`} open={showValidation || undefined}>
          <summary>
            {index + 1}.{" "}
            {t(question.promptRu, question.promptKz) ||
              t("Новый вопрос", "Жаңа сұрақ")}{" "}
            · {questionKindName(question, t)}
          </summary>
          <QuestionAuthor
            question={question}
            onChange={(next) =>
              onChange({
                ...value,
                questions: value.questions.map((old) =>
                  old.id === question.id ? next : old,
                ),
              })
            }
            t={t}
            showValidation={showValidation}
          />
          {!disabled && (
            <div className="lms-author-secondary">
              <SaveLibraryQuestion
                question={question}
                courseId={courseId}
                flush={flush}
                saved={(next) =>
                  onChange({
                    ...value,
                    questions: value.questions.map((old) =>
                      old.id === question.id ? next : old,
                    ),
                  })
                }
                onBusy={onBusy}
                t={t}
              />
              <button
                type="button"
                onClick={() =>
                  onChange({
                    ...value,
                    questions: value.questions.filter(
                      (old) => old.id !== question.id,
                    ),
                  })
                }
              >
                {t("Убрать вопрос", "Сұрақты алып тастау")}
              </button>
            </div>
          )}
        </details>
      ))}
      {!disabled && (
        <button
          type="button"
          onClick={() =>
            onChange({
              ...value,
              questions: [...value.questions, newAuthorQuestion()],
            })
          }
        >
          {t("Добавить вопрос", "Сұрақ қосу")}
        </button>
      )}
    </div>
  );
}
