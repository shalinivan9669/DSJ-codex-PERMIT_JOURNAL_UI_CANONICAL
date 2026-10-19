"use client";
import type { CourseContent } from "@demo/contracts/src/lms";
import { AccessPolicyEditor } from "./access-policy-editor";
import { type Translate } from "./common";
import { TeachingChoiceSearch, useTeachingContext } from "./teaching-context";

export function CourseLearningSettings({
  content,
  courseId,
  onChange,
  t,
}: {
  content: CourseContent;
  courseId: string;
  onChange: (patch: Partial<CourseContent>) => void;
  t: Translate;
}) {
  const choices = useTeachingContext({ excludeCourseId: courseId });
  const courses = choices.context?.courses || [];
  const meta = content.metadata || {
    goalRu: "",
    goalKz: "",
    audienceRu: "",
    audienceKz: "",
    format: "ONLINE" as const,
    documentValidity: "",
    trainingRecurrence: "",
    parameterSource: "",
    updatedOn: null,
  };
  const policy = content.accessPolicy || {
    mode: "DAYS" as const,
    days: content.accessDays,
    timezone: "Asia/Qyzylorda",
  };
  return (
    <>
      <details>
        <summary>
          {t(
            "Цели, аудитория и параметры программы",
            "Бағдарламаның мақсаттары, аудиториясы мен параметрлері",
          )}
        </summary>
        <div className="lms-fields">
          {(
            [
              ["goalRu", "Цель RU", "Мақсат RU"],
              ["goalKz", "Цель KZ", "Мақсат KZ"],
              ["audienceRu", "Аудитория RU", "Аудитория RU"],
              ["audienceKz", "Аудитория KZ", "Аудитория KZ"],
              [
                "documentValidity",
                "Срок действия документа",
                "Құжаттың қолданылу мерзімі",
              ],
              [
                "trainingRecurrence",
                "Периодичность обучения",
                "Оқыту мерзімділігі",
              ],
              [
                "parameterSource",
                "Источник параметров программы",
                "Бағдарлама параметрлерінің дереккөзі",
              ],
            ] as const
          ).map(([key, ru, kz]) => (
            <label key={key}>
              {t(ru, kz)}
              <textarea
                value={meta[key]}
                onChange={(event) =>
                  onChange({ metadata: { ...meta, [key]: event.target.value } })
                }
              />
            </label>
          ))}
          <label>
            {t("Продолжительность программы, дней", "Бағдарламаның ұзақтығы, күн")}
            <input type="number" min={1} max={3650} value={meta.durationDays ?? ""} onChange={(event) => onChange({ metadata: { ...meta, durationDays: event.target.value ? Number(event.target.value) : undefined } })} />
          </label>
          <label>
            {t("Формат", "Формат")}
            <select
              value={meta.format}
              onChange={(event) =>
                onChange({
                  metadata: {
                    ...meta,
                    format: event.target.value as typeof meta.format,
                  },
                })
              }
            >
              <option value="ONLINE">{t("Онлайн", "Онлайн")}</option>
              <option value="BLENDED">{t("Смешанный", "Аралас")}</option>
              <option value="IN_PERSON">{t("Очный", "Күндізгі")}</option>
            </select>
          </label>
          <label>
            {t("Дата актуализации", "Өзектендіру күні")}
            <input
              type="date"
              value={meta.updatedOn || ""}
              onChange={(event) =>
                onChange({
                  metadata: { ...meta, updatedOn: event.target.value || null },
                })
              }
            />
          </label>
          <label>
            {t("Итог программы", "Бағдарлама қорытындысы")}
            <select
              value={content.learningOutcome || "REGULATED"}
              onChange={(event) =>
                onChange({
                  learningOutcome: event.target.value as
                    | "LEARNING"
                    | "REGULATED",
                })
              }
            >
              <option value="LEARNING">
                {t("Учебное завершение", "Оқуды аяқтау")}
              </option>
              <option value="REGULATED">
                {t("Регламентированный результат", "Реттелетін нәтиже")}
              </option>
            </select>
          </label>
        </div>
        <p className="muted">
          {content.learningOutcome === "LEARNING"
            ? t(
                "Курс фиксирует учебный итог после выполнения обязательных требований. Выдача официального документа этим итогом не запускается.",
                "Курс міндетті талаптар орындалғаннан кейін оқу қорытындысын тіркейді. Бұл қорытынды ресми құжат беруді бастамайды.",
              )
            : t(
                "Допуск, подтверждение результата и выдача определяются регуляторным профилем.",
                "Рұқсат, нәтижені растау және беру реттеуші профильмен анықталады.",
              )}
        </p>
      </details>
      <details>
        <summary>{t("Период доступа", "Қолжетімділік мерзімі")}</summary>
        <AccessPolicyEditor
          value={policy}
          onChange={(accessPolicy) => onChange({ accessPolicy })}
          t={t}
        />
        <p className="muted">
          {t(
            "Настройки применяются при новых назначениях. Индивидуальный срок задания и срок доступа проверяются отдельно.",
            "Параметрлер жаңа тағайындауларға қолданылады. Тапсырманың жеке мерзімі мен қолжетімділік мерзімі бөлек тексеріледі.",
          )}
        </p>
      </details>
      <details>
        <summary>{t("Предыдущие курсы", "Алдыңғы курстар")}</summary>
        <TeachingChoiceSearch choices={choices} kind="course" t={t} />
        {(content.coursePrerequisites || []).map((rule, index) => (
          <fieldset key={rule.courseId}>
            <legend>
              {(() => {
                const course = courses.find(
                  (value) => value.id === rule.courseId,
                );
                return course
                  ? t(course.titleRu, course.titleKz)
                  : t("Ранее выбранный курс", "Бұрын таңдалған курс");
              })()}
            </legend>
            <div className="lms-fields">
              <label>
                {t("Условие допуска", "Рұқсат шарты")}
                <select
                  value={rule.basis}
                  onChange={(event) =>
                    onChange({
                      coursePrerequisites: content.coursePrerequisites!.map(
                        (old, n) =>
                          n === index
                            ? {
                                ...old,
                                basis: event.target.value as typeof rule.basis,
                              }
                            : old,
                      ),
                    })
                  }
                >
                  <option value="ELEMENTS">
                    {t(
                      "Все обязательные элементы",
                      "Барлық міндетті элементтер",
                    )}
                  </option>
                  <option value="LEARNING_COMPLETION">
                    {t("Положительный учебный итог", "Оң оқу қорытындысы")}
                  </option>
                  <option value="OFFICIAL_RESULT">
                    {t(
                      "Подтверждённый официальный результат",
                      "Расталған ресми нәтиже",
                    )}
                  </option>
                </select>
              </label>
              <label>
                {t("Версия курса", "Курс нұсқасы")}
                <select
                  value={rule.versionPolicy}
                  onChange={(event) =>
                    onChange({
                      coursePrerequisites: content.coursePrerequisites!.map(
                        (old, n) =>
                          n === index
                            ? {
                                ...old,
                                versionPolicy: event.target
                                  .value as typeof rule.versionPolicy,
                                minimumVersion:
                                  event.target.value === "AT_LEAST"
                                    ? old.minimumVersion || 1
                                    : undefined,
                              }
                            : old,
                      ),
                    })
                  }
                >
                  <option value="ANY">{t("Любая", "Кез келген")}</option>
                  <option value="AT_LEAST">
                    {t("Не ниже указанной", "Көрсетілгеннен төмен емес")}
                  </option>
                </select>
              </label>
              {rule.versionPolicy === "AT_LEAST" && (
                <label>
                  {t("Минимальная версия", "Ең төменгі нұсқа")}
                  <input
                    type="number"
                    min={1}
                    value={rule.minimumVersion || 1}
                    onChange={(event) =>
                      onChange({
                        coursePrerequisites: content.coursePrerequisites!.map(
                          (old, n) =>
                            n === index
                              ? {
                                  ...old,
                                  minimumVersion:
                                    Number(event.target.value) || 1,
                                }
                              : old,
                        ),
                      })
                    }
                  />
                </label>
              )}
            </div>
            <button
              type="button"
              onClick={() =>
                onChange({
                  coursePrerequisites: content.coursePrerequisites!.filter(
                    (_, n) => n !== index,
                  ),
                })
              }
            >
              {t("Снять требование", "Талапты алып тастау")}
            </button>
          </fieldset>
        ))}
        <label>
          {t("Добавить предварительный курс", "Алдын ала курсты қосу")}
          <select
            value=""
            onChange={(event) => {
              if (event.target.value)
                onChange({
                  coursePrerequisites: [
                    ...(content.coursePrerequisites || []),
                    {
                      courseId: event.target.value,
                      basis: "LEARNING_COMPLETION",
                      versionPolicy: "ANY",
                    },
                  ],
                });
            }}
          >
            <option value="">{t("Выберите курс", "Курсты таңдаңыз")}</option>
            {courses
              .filter(
                (course) =>
                  !content.coursePrerequisites?.some(
                    (rule) => rule.courseId === course.id,
                  ),
              )
              .map((course) => (
                <option key={course.id} value={course.id}>
                  {t(course.titleRu, course.titleKz)}
                </option>
              ))}
          </select>
        </label>
      </details>
    </>
  );
}
