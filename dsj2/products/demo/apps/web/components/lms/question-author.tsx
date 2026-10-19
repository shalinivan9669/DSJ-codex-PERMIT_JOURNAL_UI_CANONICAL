"use client";
import { useId, useState } from "react";
import type { LmsQuestion } from "@demo/contracts/src/lms";
import type { Translate } from "./common";

type Spec = NonNullable<LmsQuestion["answerSpec"]>;
type ResponseSpec = Exclude<Spec, { kind: "CASE" }>;
type QuestionKind = Spec["kind"];
const kinds = [
  ["SINGLE", "Один ответ", "Бір жауап"],
  ["MULTIPLE", "Несколько ответов", "Бірнеше жауап"],
  ["MATCHING", "Соответствие", "Сәйкестік"],
  ["ORDERING", "Последовательность", "Реттілік"],
  ["TEXT", "Текстовый ответ", "Мәтіндік жауап"],
  ["CASE", "Ситуационная задача", "Жағдаяттық тапсырма"],
] as const;

export function newAuthorQuestion(): LmsQuestion {
  const first = crypto.randomUUID();
  return {
    id: crypto.randomUUID(),
    version: 1,
    category: "",
    promptRu: "",
    promptKz: "",
    multiple: false,
    options: [
      { id: first, textRu: "", textKz: "" },
      { id: crypto.randomUUID(), textRu: "", textKz: "" },
    ],
    correctOptionIds: [],
    answerSpec: { kind: "SINGLE", correctOptionIds: [] },
  };
}

function newSpec(
  kind: ResponseSpec["kind"],
  question: LmsQuestion,
): ResponseSpec {
  switch (kind) {
    case "SINGLE":
      return { kind, correctOptionIds: question.correctOptionIds.slice(0, 1) };
    case "MULTIPLE":
      return { kind, correctOptionIds: [...question.correctOptionIds] };
    case "MATCHING":
      return {
        kind,
        pairs: [],
        rightOptions: question.options.map(() => ({
          id: crypto.randomUUID(),
          textRu: "",
          textKz: "",
        })),
      };
    case "ORDERING":
      return {
        kind,
        correctOrderIds: question.options.map((option) => option.id),
      };
    case "TEXT":
      return { kind, mode: "MANUAL", criteriaRu: "", criteriaKz: "" };
  }
}

export function questionKindName(question: LmsQuestion, t: Translate) {
  const kind =
    question.answerSpec?.kind || (question.multiple ? "MULTIPLE" : "SINGLE");
  const name = kinds.find(([value]) => value === kind)!;
  return t(name[1], name[2]);
}

export function QuestionAuthor({
  question: q,
  onChange,
  t,
  showValidation = false,
}: {
  question: LmsQuestion;
  onChange: (question: LmsQuestion) => void;
  t: Translate;
  showValidation?: boolean;
}) {
  const [removalIssue, setRemovalIssue] = useState(false);
  const radioGroup = useId();
  const spec: Spec = q.answerSpec || {
    kind: q.multiple ? "MULTIPLE" : "SINGLE",
    correctOptionIds: q.correctOptionIds,
  };
  const response = spec.kind === "CASE" ? spec.response : spec;
  function edit(patch: Partial<LmsQuestion>) {
    onChange({ ...q, ...patch });
  }
  function changeResponse(value: ResponseSpec, options = q.options) {
    const answerSpec: Spec =
      spec.kind === "CASE" ? { ...spec, response: value } : value;
    onChange({
      ...q,
      options,
      answerSpec,
      multiple: value.kind === "MULTIPLE",
      correctOptionIds:
        value.kind === "SINGLE" || value.kind === "MULTIPLE"
          ? value.correctOptionIds
          : [],
    });
    setRemovalIssue(false);
  }
  function changeKind(kind: QuestionKind) {
    const answerSpec: Spec =
      kind === "CASE"
        ? { kind, contextRu: "", contextKz: "", response }
        : newSpec(kind, q);
    onChange({
      ...q,
      answerSpec,
      multiple: kind === "MULTIPLE",
      correctOptionIds:
        kind === "SINGLE" || kind === "MULTIPLE"
          ? (
              answerSpec as Extract<
                ResponseSpec,
                { kind: "SINGLE" | "MULTIPLE" }
              >
            ).correctOptionIds
          : [],
    });
  }
  function removeOption(id: string) {
    const isKey =
      (response.kind === "SINGLE" || response.kind === "MULTIPLE") &&
      response.correctOptionIds.includes(id);
    const isPair =
      response.kind === "MATCHING" &&
      response.pairs.some((pair) => pair.leftId === id);
    if (isKey || isPair) {
      setRemovalIssue(true);
      return;
    }
    const options = q.options.filter((option) => option.id !== id);
    changeResponse(
      response.kind === "ORDERING"
        ? {
            ...response,
            correctOrderIds: response.correctOrderIds.filter(
              (value) => value !== id,
            ),
          }
        : response,
      options,
    );
  }
  const optionIds = new Set(q.options.map((option) => option.id));
  const badKey =
    response.kind === "SINGLE" || response.kind === "MULTIPLE"
      ? !response.correctOptionIds.length ||
        response.correctOptionIds.some((id) => !optionIds.has(id)) ||
        (response.kind === "SINGLE" && response.correctOptionIds.length !== 1)
      : response.kind === "MATCHING"
        ? response.pairs.length !== q.options.length ||
          response.pairs.some(
            (pair) =>
              !optionIds.has(pair.leftId) ||
              !response.rightOptions.some(
                (option) => option.id === pair.rightId,
              ),
          )
        : response.kind === "ORDERING"
          ? response.correctOrderIds.length !== q.options.length ||
            new Set(response.correctOrderIds).size !== q.options.length ||
            response.correctOrderIds.some((id) => !optionIds.has(id))
          : response.mode === "EXACT"
            ? !response.acceptedAnswers.some((answer) => answer.trim())
            : !response.criteriaRu.trim() || !response.criteriaKz.trim();
  const invalid =
    !q.promptRu.trim() ||
    !q.promptKz.trim() ||
    badKey ||
    (response.kind !== "TEXT" &&
      (q.options.length < 2 ||
        q.options.some(
          (option) => !option.textRu.trim() || !option.textKz.trim(),
        )));
  return (
    <div className="lms-question-author">
      <div className="lms-fields">
        <label>
          {t("Тип вопроса", "Сұрақ түрі")}
          <select
            value={spec.kind}
            onChange={(event) => changeKind(event.target.value as QuestionKind)}
          >
            {kinds.map(([value, ru, kz]) => (
              <option key={value} value={value}>
                {t(ru, kz)}
              </option>
            ))}
          </select>
        </label>
        <label>
          {t("Категория", "Санат")}
          <input
            value={q.category}
            onChange={(event) => edit({ category: event.target.value })}
          />
        </label>
        <label>
          {t("Вопрос RU", "Сұрақ RU")}
          <textarea
            value={q.promptRu}
            onChange={(event) => edit({ promptRu: event.target.value })}
          />
        </label>
        <label>
          {t("Вопрос KZ", "Сұрақ KZ")}
          <textarea
            value={q.promptKz}
            onChange={(event) => edit({ promptKz: event.target.value })}
          />
        </label>
      </div>
      {spec.kind === "CASE" && (
        <fieldset>
          <legend>{t("Условие ситуации", "Жағдаят шарты")}</legend>
          <div className="lms-fields">
            <label>
              {t("Ситуация RU", "Жағдаят RU")}
              <textarea
                rows={4}
                value={spec.contextRu}
                onChange={(event) =>
                  edit({
                    answerSpec: { ...spec, contextRu: event.target.value },
                  })
                }
              />
            </label>
            <label>
              {t("Ситуация KZ", "Жағдаят KZ")}
              <textarea
                rows={4}
                value={spec.contextKz}
                onChange={(event) =>
                  edit({
                    answerSpec: { ...spec, contextKz: event.target.value },
                  })
                }
              />
            </label>
            <label>
              {t("Способ ответа", "Жауап беру тәсілі")}
              <select
                value={response.kind}
                onChange={(event) =>
                  changeResponse(
                    newSpec(event.target.value as ResponseSpec["kind"], q),
                  )
                }
              >
                {kinds
                  .filter(([kind]) => kind !== "CASE")
                  .map(([value, ru, kz]) => (
                    <option key={value} value={value}>
                      {t(ru, kz)}
                    </option>
                  ))}
              </select>
            </label>
          </div>
        </fieldset>
      )}
      {response.kind !== "TEXT" && (
        <>
          {q.options.map((option, index) => (
            <fieldset key={option.id}>
              <legend>
                {response.kind === "MATCHING"
                  ? t("Левая часть", "Сол жақ")
                  : t("Вариант", "Нұсқа")}{" "}
                {index + 1}
              </legend>
              <div className="lms-fields">
                <label>
                  RU
                  <input
                    value={option.textRu}
                    onChange={(event) =>
                      edit({
                        options: q.options.map((old) =>
                          old.id === option.id
                            ? { ...old, textRu: event.target.value }
                            : old,
                        ),
                      })
                    }
                  />
                </label>
                <label>
                  KZ
                  <input
                    value={option.textKz}
                    onChange={(event) =>
                      edit({
                        options: q.options.map((old) =>
                          old.id === option.id
                            ? { ...old, textKz: event.target.value }
                            : old,
                        ),
                      })
                    }
                  />
                </label>
              </div>
              {(response.kind === "SINGLE" || response.kind === "MULTIPLE") && (
                <label className="lms-inline-label">
                  <input
                    type={response.kind === "SINGLE" ? "radio" : "checkbox"}
                    name={`correct-${radioGroup}`}
                    checked={response.correctOptionIds.includes(option.id)}
                    onChange={(event) =>
                      changeResponse({
                        ...response,
                        correctOptionIds: event.target.checked
                          ? response.kind === "SINGLE"
                            ? [option.id]
                            : [...response.correctOptionIds, option.id]
                          : response.correctOptionIds.filter(
                              (id) => id !== option.id,
                            ),
                      })
                    }
                  />
                  {t("Правильный ответ", "Дұрыс жауап")}
                </label>
              )}
              {response.kind === "MATCHING" && (
                <label>
                  {t("Соответствует", "Сәйкес келеді")}
                  <select
                    value={
                      response.pairs.find((pair) => pair.leftId === option.id)
                        ?.rightId || ""
                    }
                    onChange={(event) =>
                      changeResponse({
                        ...response,
                        pairs: [
                          ...response.pairs.filter(
                            (pair) => pair.leftId !== option.id,
                          ),
                          ...(event.target.value
                            ? [
                                {
                                  leftId: option.id,
                                  rightId: event.target.value,
                                },
                              ]
                            : []),
                        ],
                      })
                    }
                  >
                    <option value="">
                      {t("Выберите пару", "Жұбын таңдаңыз")}
                    </option>
                    {response.rightOptions.map((right) => (
                      <option key={right.id} value={right.id}>
                        {t(right.textRu, right.textKz) ||
                          t("Без текста", "Мәтін жоқ")}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <button type="button" onClick={() => removeOption(option.id)}>
                {t("Убрать вариант", "Нұсқаны алып тастау")}
              </button>
            </fieldset>
          ))}
          <button
            type="button"
            onClick={() => {
              const option = {
                id: crypto.randomUUID(),
                textRu: "",
                textKz: "",
              };
              changeResponse(
                response.kind === "ORDERING"
                  ? {
                      ...response,
                      correctOrderIds: [...response.correctOrderIds, option.id],
                    }
                  : response,
                [...q.options, option],
              );
            }}
          >
            {t("Добавить вариант", "Нұсқа қосу")}
          </button>
          {removalIssue && (
            <p role="alert">
              {t(
                "Сначала измените правильный ответ или снимите соответствие этого варианта.",
                "Алдымен дұрыс жауапты өзгертіңіз немесе осы нұсқаның сәйкестігін алып тастаңыз.",
              )}
            </p>
          )}
        </>
      )}
      {response.kind === "MATCHING" && (
        <fieldset>
          <legend>
            {t("Правая часть соответствий", "Сәйкестіктердің оң жағы")}
          </legend>
          {response.rightOptions.map((option, index) => (
            <div key={option.id} className="lms-author-row">
              <div className="lms-fields">
                <label>
                  {t("Правая часть", "Оң жақ")} {index + 1} RU
                  <input
                    value={option.textRu}
                    onChange={(event) =>
                      changeResponse({
                        ...response,
                        rightOptions: response.rightOptions.map((old) =>
                          old.id === option.id
                            ? { ...old, textRu: event.target.value }
                            : old,
                        ),
                      })
                    }
                  />
                </label>
                <label>
                  {t("Правая часть", "Оң жақ")} {index + 1} KZ
                  <input
                    value={option.textKz}
                    onChange={(event) =>
                      changeResponse({
                        ...response,
                        rightOptions: response.rightOptions.map((old) =>
                          old.id === option.id
                            ? { ...old, textKz: event.target.value }
                            : old,
                        ),
                      })
                    }
                  />
                </label>
              </div>
              <button
                type="button"
                disabled={response.pairs.some(
                  (pair) => pair.rightId === option.id,
                )}
                onClick={() =>
                  changeResponse({
                    ...response,
                    rightOptions: response.rightOptions.filter(
                      (old) => old.id !== option.id,
                    ),
                  })
                }
              >
                {t("Убрать", "Алып тастау")}
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={() =>
              changeResponse({
                ...response,
                rightOptions: [
                  ...response.rightOptions,
                  { id: crypto.randomUUID(), textRu: "", textKz: "" },
                ],
              })
            }
          >
            {t("Добавить правую часть", "Оң жақ бөлігін қосу")}
          </button>
        </fieldset>
      )}
      {response.kind === "ORDERING" && (
        <fieldset>
          <legend>
            {t("Правильная последовательность", "Дұрыс реттілік")}
          </legend>
          <ol className="lms-author-order">
            {response.correctOrderIds.map((id, index) => {
              const option = q.options.find((item) => item.id === id);
              function move(direction: number) {
                if (response.kind !== "ORDERING") return;
                const ids = [...response.correctOrderIds];
                [ids[index], ids[index + direction]] = [
                  ids[index + direction]!,
                  ids[index]!,
                ];
                changeResponse({ ...response, correctOrderIds: ids });
              }
              return (
                <li key={id}>
                  <span>
                    {option
                      ? t(option.textRu, option.textKz) ||
                        t("Без текста", "Мәтін жоқ")
                      : t(
                          "Удалённый вариант — исправьте порядок",
                          "Жойылған нұсқа — реттілікті түзетіңіз",
                        )}
                  </span>
                  <div className="lms-actions">
                    <button
                      type="button"
                      disabled={!index}
                      onClick={() => move(-1)}
                      aria-label={`${t("Выше", "Жоғары")}: ${option?.textRu || index + 1}`}
                    >
                      {t("Выше", "Жоғары")}
                    </button>
                    <button
                      type="button"
                      disabled={index === response.correctOrderIds.length - 1}
                      onClick={() => move(1)}
                      aria-label={`${t("Ниже", "Төмен")}: ${option?.textRu || index + 1}`}
                    >
                      {t("Ниже", "Төмен")}
                    </button>
                  </div>
                </li>
              );
            })}
          </ol>
          {badKey && (
            <button
              type="button"
              onClick={() =>
                changeResponse({
                  ...response,
                  correctOrderIds: q.options.map((option) => option.id),
                })
              }
            >
              {t(
                "Взять порядок из списка вариантов",
                "Нұсқалар тізімінің ретін қолдану",
              )}
            </button>
          )}
        </fieldset>
      )}
      {response.kind === "TEXT" && (
        <fieldset>
          <legend>
            {t("Проверка текстового ответа", "Мәтіндік жауапты тексеру")}
          </legend>
          <label>
            {t("Способ проверки", "Тексеру тәсілі")}
            <select
              value={response.mode}
              onChange={(event) =>
                changeResponse(
                  event.target.value === "MANUAL"
                    ? {
                        kind: "TEXT",
                        mode: "MANUAL",
                        criteriaRu: "",
                        criteriaKz: "",
                      }
                    : {
                        kind: "TEXT",
                        mode: "EXACT",
                        acceptedAnswers: [],
                        caseSensitive: false,
                        collapseWhitespace: true,
                      },
                )
              }
            >
              <option value="MANUAL">
                {t(
                  "По критериям преподавателем",
                  "Оқытушы критерийлер бойынша",
                )}
              </option>
              <option value="EXACT">
                {t("Точное совпадение с ключом", "Кілтпен дәл сәйкестік")}
              </option>
            </select>
          </label>
          {response.mode === "MANUAL" ? (
            <div className="lms-fields">
              <label>
                {t("Критерии RU", "Критерийлер RU")}
                <textarea
                  value={response.criteriaRu}
                  onChange={(event) =>
                    changeResponse({
                      ...response,
                      criteriaRu: event.target.value,
                    })
                  }
                />
              </label>
              <label>
                {t("Критерии KZ", "Критерийлер KZ")}
                <textarea
                  value={response.criteriaKz}
                  onChange={(event) =>
                    changeResponse({
                      ...response,
                      criteriaKz: event.target.value,
                    })
                  }
                />
              </label>
            </div>
          ) : (
            <>
              <label>
                {t(
                  "Допустимые ответы — по одному на строку",
                  "Рұқсат етілген жауаптар — әр жолға бір жауап",
                )}
                <textarea
                  value={response.acceptedAnswers.join("\n")}
                  onChange={(event) =>
                    changeResponse({
                      ...response,
                      acceptedAnswers: event.target.value.split("\n"),
                    })
                  }
                />
              </label>
              <label className="lms-inline-label">
                <input
                  type="checkbox"
                  checked={response.caseSensitive}
                  onChange={(event) =>
                    changeResponse({
                      ...response,
                      caseSensitive: event.target.checked,
                    })
                  }
                />
                {t("Учитывать регистр", "Әріп регистрін ескеру")}
              </label>
              <label className="lms-inline-label">
                <input
                  type="checkbox"
                  checked={response.collapseWhitespace}
                  onChange={(event) =>
                    changeResponse({
                      ...response,
                      collapseWhitespace: event.target.checked,
                    })
                  }
                />
                {t(
                  "Считать повторные пробелы одним",
                  "Қайталанатын бос орындарды бір деп санау",
                )}
              </label>
            </>
          )}
        </fieldset>
      )}
      <details>
        <summary>
          {t("Объяснение и источник", "Түсіндірме және дереккөз")}
        </summary>
        <div className="lms-fields">
          {(
            [
              ["topic", "Тема", "Тақырып"],
              ["explanationRu", "Объяснение RU", "Түсіндірме RU"],
              ["explanationKz", "Объяснение KZ", "Түсіндірме KZ"],
              ["source", "Источник", "Дереккөз"],
            ] as const
          ).map(([key, ru, kz]) => (
            <label key={key}>
              {t(ru, kz)}
              <textarea
                value={q[key] || ""}
                onChange={(event) => edit({ [key]: event.target.value })}
              />
            </label>
          ))}
          <label>
            {t("Сложность", "Күрделілік")}
            <select
              value={q.difficulty || "UNKNOWN"}
              onChange={(event) =>
                edit({
                  difficulty: event.target.value as LmsQuestion["difficulty"],
                })
              }
            >
              {(
                [
                  ["UNKNOWN", "Не указана", "Көрсетілмеген"],
                  ["EASY", "Лёгкий", "Жеңіл"],
                  ["MEDIUM", "Средний", "Орташа"],
                  ["HARD", "Сложный", "Күрделі"],
                ] as const
              ).map(([value, ru, kz]) => (
                <option key={value} value={value}>
                  {t(ru, kz)}
                </option>
              ))}
            </select>
          </label>
        </div>
      </details>
      {showValidation && invalid && (
        <p role="alert">
          {t(
            "Заполните вопрос и варианты на двух языках, проверьте ключ или критерии оценки.",
            "Сұрақ пен нұсқаларды екі тілде толтырып, кілтті немесе бағалау критерийлерін тексеріңіз.",
          )}
        </p>
      )}
    </div>
  );
}
