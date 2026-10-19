"use client";
import { lmsAssessmentSchema, type LmsLesson } from "@demo/contracts/src/lms";
import { AssessmentAuthor } from "./assessment-author";
import { MaterialLibrary } from "./material-library";
import type { Translate } from "./common";
import { LocalDeadline } from "./access-policy-editor";

const kinds = [
  ["TEXT", "Текст", "Мәтін"],
  ["PDF", "PDF", "PDF"],
  ["VIDEO", "Видео", "Бейне"],
  ["FILE", "Файл", "Файл"],
  ["LINK", "Ссылка", "Сілтеме"],
  ["ASSESSMENT", "Промежуточная проверка", "Аралық тексеру"],
  ["ASSIGNMENT", "Практическое задание", "Практикалық тапсырма"],
  ["SESSION", "Занятие с преподавателем", "Оқытушымен сабақ"],
] as const;
export function LessonAuthor({
  lesson,
  onChange,
  courseId,
  disabled,
  showValidation,
  flush,
  onBusy,
  t,
  timezone = "Asia/Qyzylorda",
}: {
  lesson: LmsLesson;
  onChange: (patch: Partial<LmsLesson>) => void;
  courseId: string;
  disabled: boolean;
  showValidation: boolean;
  flush: () => Promise<unknown>;
  onBusy: (busy: boolean) => void;
  t: Translate;
  timezone?: string;
}) {
  function changeKind(kind: LmsLesson["kind"]) {
    onChange({
      kind,
      ...(kind === "ASSESSMENT" && !lesson.assessment
        ? {
            assessment: lmsAssessmentSchema.parse({
              questions: [],
              questionCount: 1,
            }),
          }
        : {}),
      ...(kind === "ASSIGNMENT" && !lesson.assignment
        ? {
            assignment: {
              instructionsRu: "",
              instructionsKz: "",
              criteriaRu: "",
              criteriaKz: "",
              allowText: true,
              allowFiles: true,
              maxSubmissions: 3,
            },
          }
        : {}),
      ...(kind === "SESSION" && !lesson.session
        ? { session: { attendanceRequired: true } }
        : {}),
    });
  }
  const assignment = lesson.assignment;
  const video = lesson.videoPolicy || {
    minimumPercent: 95,
    allowSeekAhead: false,
    playbackRates: [1],
  };
  return (
    <>
      <div className="lms-fields">
        <label>
          {t("Урок RU", "Сабақ RU")}
          <input
            value={lesson.titleRu}
            onChange={(event) => onChange({ titleRu: event.target.value })}
          />
        </label>
        <label>
          {t("Урок KZ", "Сабақ KZ")}
          <input
            value={lesson.titleKz}
            onChange={(event) => onChange({ titleKz: event.target.value })}
          />
        </label>
        <label>
          {t("Тип элемента", "Элемент түрі")}
          <select
            value={lesson.kind}
            onChange={(event) =>
              changeKind(event.target.value as LmsLesson["kind"])
            }
          >
            {kinds.map(([value, ru, kz]) => (
              <option key={value} value={value}>
                {t(ru, kz)}
              </option>
            ))}
          </select>
        </label>
        <label className="lms-inline-label">
          <input
            type="checkbox"
            checked={lesson.required}
            onChange={(event) => onChange({ required: event.target.checked })}
          />
          {t("Обязательный элемент", "Міндетті элемент")}
        </label>
        <label>
          {t("Текст RU", "Мәтін RU")}
          <textarea
            rows={4}
            value={lesson.textRu}
            onChange={(event) => onChange({ textRu: event.target.value })}
          />
        </label>
        <label>
          {t("Текст KZ", "Мәтін KZ")}
          <textarea
            rows={4}
            value={lesson.textKz}
            onChange={(event) => onChange({ textKz: event.target.value })}
          />
        </label>
      </div>
      {lesson.kind === "LINK" && (
        <label>
          {t("Адрес материала (https)", "Материал мекенжайы (https)")}
          <input
            type="url"
            value={lesson.url || ""}
            onChange={(event) => onChange({ url: event.target.value })}
          />
        </label>
      )}
      {(["PDF", "VIDEO", "FILE"] as string[]).includes(lesson.kind) && (
        <MaterialLibrary
          onBusy={onBusy}
          courseId={courseId}
          selectedId={lesson.materialId}
          accept={
            lesson.kind === "PDF"
              ? "application/pdf"
              : lesson.kind === "VIDEO"
                ? "video/mp4,video/webm"
                : undefined
          }
          disabled={disabled}
          onChoose={(material) => onChange({ materialId: material.id })}
          t={t}
        />
      )}
      {lesson.kind === "VIDEO" && (
        <fieldset>
          <legend>{t("Просмотр видео", "Бейнені қарау")}</legend>
          <div className="lms-fields">
            <label>
              {t("Длительность, секунд", "Ұзақтығы, секунд")}
              <input
                type="number"
                min={1}
                max={86400}
                value={lesson.durationSeconds || ""}
                onChange={(event) =>
                  onChange({
                    durationSeconds: Number(event.target.value) || null,
                  })
                }
              />
            </label>
            <label>
              {t("Минимум просмотра, %", "Қарау минимумы, %")}
              <input
                type="number"
                min={1}
                max={100}
                value={video.minimumPercent}
                onChange={(event) =>
                  onChange({
                    videoPolicy: {
                      ...video,
                      minimumPercent: Number(event.target.value) || 1,
                    },
                  })
                }
              />
            </label>
            <label className="lms-inline-label">
              <input
                type="checkbox"
                checked={video.allowSeekAhead}
                onChange={(event) =>
                  onChange({
                    videoPolicy: {
                      ...video,
                      allowSeekAhead: event.target.checked,
                    },
                  })
                }
              />
              {t("Разрешить перемотку вперёд", "Алға айналдыруға рұқсат беру")}
            </label>
          </div>
          <fieldset>
            <legend>
              {t("Доступные скорости", "Қолжетімді жылдамдықтар")}
            </legend>
            <div className="lms-author-row">
              {[0.5, 0.75, 1, 1.25, 1.5, 2].map((rate) => (
                <label className="lms-inline-label" key={rate}>
                  <input
                    type="checkbox"
                    checked={video.playbackRates.includes(rate)}
                    disabled={
                      video.playbackRates.length === 1 &&
                      video.playbackRates.includes(rate)
                    }
                    onChange={(event) =>
                      onChange({
                        videoPolicy: {
                          ...video,
                          playbackRates: event.target.checked
                            ? [...video.playbackRates, rate].sort(
                                (a, b) => a - b,
                              )
                            : video.playbackRates.filter((old) => old !== rate),
                        },
                      })
                    }
                  />
                  {rate}×
                </label>
              ))}
            </div>
          </fieldset>
          <details>
            <summary>{t("Субтитры", "Субтитрлер")}</summary>
            {(lesson.subtitles || []).map((subtitle, index) => (
              <fieldset key={`${subtitle.materialId}-${index}`}>
                <legend>
                  {t("Дорожка", "Жол")} {index + 1}
                </legend>
                <div className="lms-fields">
                  <label>
                    {t("Язык", "Тіл")}
                    <select
                      value={subtitle.language}
                      onChange={(event) =>
                        onChange({
                          subtitles: lesson.subtitles!.map((old, n) =>
                            n === index
                              ? { ...old, language: event.target.value }
                              : old,
                          ),
                        })
                      }
                    >
                      <option value="ru">Русский</option>
                      <option value="kk">Қазақша</option>
                    </select>
                  </label>
                  <label>
                    {t("Подпись", "Атауы")}
                    <input
                      value={subtitle.label}
                      onChange={(event) =>
                        onChange({
                          subtitles: lesson.subtitles!.map((old, n) =>
                            n === index
                              ? { ...old, label: event.target.value }
                              : old,
                          ),
                        })
                      }
                    />
                  </label>
                </div>
                <button
                  type="button"
                  onClick={() =>
                    onChange({
                      subtitles: lesson.subtitles!.filter(
                        (_, n) => n !== index,
                      ),
                    })
                  }
                >
                  {t("Убрать дорожку", "Жолды алып тастау")}
                </button>
              </fieldset>
            ))}
            <MaterialLibrary
              onBusy={onBusy}
              courseId={courseId}
              accept="text/vtt,.vtt"
              disabled={disabled || (lesson.subtitles?.length || 0) >= 10}
              onChoose={(material) =>
                onChange({
                  subtitles: [
                    ...(lesson.subtitles || []),
                    {
                      materialId: material.id,
                      language: "ru",
                      label: material.title || material.originalName,
                    },
                  ],
                })
              }
              t={t}
            />
          </details>
        </fieldset>
      )}
      {lesson.kind === "ASSESSMENT" && lesson.assessment && (
        <AssessmentAuthor
          timezone={timezone}
          value={lesson.assessment}
          onChange={(assessment) => onChange({ assessment })}
          courseId={courseId}
          disabled={disabled}
          showValidation={showValidation}
          flush={flush}
          onBusy={onBusy}
          t={t}
        />
      )}
      {lesson.kind === "ASSIGNMENT" && assignment && (
        <fieldset>
          <legend>
            {t("Условия и проверка работы", "Жұмыс шарттары мен тексеру")}
          </legend>
          <div className="lms-fields">
            <LocalDeadline
              value={assignment.dueAt}
              onChange={(dueAt) =>
                onChange({ assignment: { ...assignment, dueAt } })
              }
              timezone={timezone}
              t={t}
            />
            {(
              [
                ["instructionsRu", "Инструкция RU", "Нұсқаулық RU"],
                ["instructionsKz", "Инструкция KZ", "Нұсқаулық KZ"],
                [
                  "criteriaRu",
                  "Критерии приёмки RU",
                  "Қабылдау критерийлері RU",
                ],
                [
                  "criteriaKz",
                  "Критерии приёмки KZ",
                  "Қабылдау критерийлері KZ",
                ],
              ] as const
            ).map(([key, ru, kz]) => (
              <label key={key}>
                {t(ru, kz)}
                <textarea
                  rows={4}
                  value={assignment[key]}
                  onChange={(event) =>
                    onChange({
                      assignment: { ...assignment, [key]: event.target.value },
                    })
                  }
                />
              </label>
            ))}
            <label>
              {t("Максимум отправок", "Жіберулердің ең көп саны")}
              <input
                type="number"
                min={1}
                max={100}
                value={assignment.maxSubmissions}
                onChange={(event) =>
                  onChange({
                    assignment: {
                      ...assignment,
                      maxSubmissions: Number(event.target.value) || 1,
                    },
                  })
                }
              />
            </label>
          </div>
          <div className="lms-author-row">
            <label className="lms-inline-label">
              <input
                type="checkbox"
                checked={assignment.allowText}
                onChange={(event) =>
                  onChange({
                    assignment: {
                      ...assignment,
                      allowText: event.target.checked,
                    },
                  })
                }
              />
              {t("Текстовый ответ", "Мәтіндік жауап")}
            </label>
            <label className="lms-inline-label">
              <input
                type="checkbox"
                checked={assignment.allowFiles}
                onChange={(event) =>
                  onChange({
                    assignment: {
                      ...assignment,
                      allowFiles: event.target.checked,
                    },
                  })
                }
              />
              {t("Приложения", "Тіркемелер")}
            </label>
          </div>
        </fieldset>
      )}
      {lesson.kind === "SESSION" && (
        <fieldset>
          <legend>
            {t("Требование к занятию", "Сабаққа қойылатын талап")}
          </legend>
          <p>
            {t(
              "Конкретное время, группа и ссылка на встречу задаются в расписании группы. Этот элемент сохраняет требование курса.",
              "Нақты уақыт, топ және кездесу сілтемесі топ кестесінде беріледі. Бұл элемент курс талабын сақтайды.",
            )}
          </p>
          <label className="lms-inline-label">
            <input
              type="checkbox"
              checked={lesson.session?.attendanceRequired ?? true}
              onChange={(event) =>
                onChange({
                  session: { attendanceRequired: event.target.checked },
                })
              }
            />
            {t(
              "Преподаватель должен подтвердить присутствие",
              "Оқытушы қатысуды растауы керек",
            )}
          </label>
        </fieldset>
      )}
    </>
  );
}
