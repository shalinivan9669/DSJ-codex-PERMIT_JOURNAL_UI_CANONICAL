"use client";
import type { LearningAnswer } from "@demo/contracts/src/lms";
import type { PublicQuestion } from "@/lib/lms-api";
import type { Translate } from "./common";

/** Only the sanitized question snapshot is accepted here; no answer key is needed. */
export function QuestionResponse({
  question,
  value,
  onChange,
  disabled = false,
  t,
  number,
}: {
  question: PublicQuestion;
  value?: LearningAnswer;
  onChange: (value: LearningAnswer) => void;
  disabled?: boolean;
  t: Translate;
  number?: number;
}) {
  const spec = question.answerSpec;
  const response = spec?.kind === "CASE" ? spec.response : spec;
  const kind = response?.kind || (question.multiple ? "MULTIPLE" : "SINGLE");
  const selected = Array.isArray(value)
    ? value
    : value && "optionIds" in value
      ? value.optionIds
      : [];
  const pairs =
    !Array.isArray(value) && value?.kind === "MATCHING" ? value.pairs : [];
  const ordered = [
    ...selected,
    ...question.options.map((o) => o.id).filter((id) => !selected.includes(id)),
  ];
  function move(index: number, step: number) {
    const target = index + step;
    if (target < 0 || target >= ordered.length) return;
    const next = [...ordered];
    [next[index], next[target]] = [next[target], next[index]];
    onChange({ kind: "ORDERING", optionIds: next });
  }
  return (
    <fieldset className="lms-question" disabled={disabled}>
      <legend>
        {number ? `${number}. ` : ""}
        {t(question.promptRu, question.promptKz)}
      </legend>
      {spec?.kind === "CASE" && (
        <div className="lms-prose">{t(spec.contextRu, spec.contextKz)}</div>
      )}
      {(kind === "SINGLE" || kind === "MULTIPLE") &&
        question.options.map((option) => (
          <label className="lms-inline-label lms-answer" key={option.id}>
            <input
              type={kind === "MULTIPLE" ? "checkbox" : "radio"}
              name={question.id}
              checked={selected.includes(option.id)}
              onChange={(event) =>
                onChange({
                  kind,
                  optionIds:
                    kind === "SINGLE"
                      ? [option.id]
                      : event.target.checked
                        ? [
                            ...selected.filter((id) => id !== option.id),
                            option.id,
                          ]
                        : selected.filter((id) => id !== option.id),
                })
              }
            />
            <span>{t(option.textRu, option.textKz)}</span>
          </label>
        ))}
      {kind === "MATCHING" &&
        response?.kind === "MATCHING" &&
        question.options.map((option) => (
          <label key={option.id} className="lms-answer">
            <span>{t(option.textRu, option.textKz)}</span>
            <select
              value={
                pairs.find((pair) => pair.leftId === option.id)?.rightId || ""
              }
              onChange={(event) =>
                onChange({
                  kind: "MATCHING",
                  pairs: [
                    ...pairs.filter((pair) => pair.leftId !== option.id),
                    ...(event.target.value
                      ? [{ leftId: option.id, rightId: event.target.value }]
                      : []),
                  ],
                })
              }
            >
              <option value="">
                {t("Выберите соответствие", "Сәйкестікті таңдаңыз")}
              </option>
              {response.rightOptions.map((right) => (
                <option key={right.id} value={right.id}>
                  {t(right.textRu, right.textKz)}
                </option>
              ))}
            </select>
          </label>
        ))}
      {kind === "ORDERING" && (
        <>
          <p className="lms-save-state">
            {t(
              "Расположите пункты по порядку. Кнопки доступны с клавиатуры.",
              "Тармақтарды ретімен орналастырыңыз. Пернетақтамен басқаруға болады.",
            )}
          </p>
          <ol className="lms-answer-order">
            {ordered.map((id, index) => {
              const option = question.options.find((item) => item.id === id);
              return (
                <li key={id}>
                  <span>{option ? t(option.textRu, option.textKz) : id}</span>
                  <div className="lms-actions">
                    <button
                      type="button"
                      disabled={disabled || index === 0}
                      aria-label={`${t("Выше", "Жоғары")}: ${option ? t(option.textRu, option.textKz) : id}`}
                      onClick={() => move(index, -1)}
                    >
                      ↑ {t("Выше", "Жоғары")}
                    </button>
                    <button
                      type="button"
                      disabled={disabled || index === ordered.length - 1}
                      aria-label={`${t("Ниже", "Төмен")}: ${option ? t(option.textRu, option.textKz) : id}`}
                      onClick={() => move(index, 1)}
                    >
                      ↓ {t("Ниже", "Төмен")}
                    </button>
                  </div>
                </li>
              );
            })}
          </ol>
          {!selected.length && (
            <button
              type="button"
              onClick={() => onChange({ kind: "ORDERING", optionIds: ordered })}
            >
              {t("Подтвердить этот порядок", "Осы ретті растау")}
            </button>
          )}
        </>
      )}
      {kind === "TEXT" && (
        <label>
          {t("Ваш ответ", "Жауабыңыз")}
          <textarea
            rows={5}
            maxLength={10000}
            value={
              !Array.isArray(value) && value?.kind === "TEXT" ? value.text : ""
            }
            onChange={(event) =>
              onChange({ kind: "TEXT", text: event.target.value })
            }
          />
        </label>
      )}
    </fieldset>
  );
}
