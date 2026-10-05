"use client";
import {
  trainingDirection,
  isSpecialBiotCategory,
  type CommonFields,
  type TrainingEventInput,
} from "@demo/contracts";
import {
  trainingDirectionLabel,
  trainingDisplayTitle,
} from "@/lib/training-display";
import type { Draft } from "@/lib/types";
import { TrainingPeriodFields } from "./training-period-fields";

const itrFields = [
  ["biotIndustryRu", "Отрасль · RU"],
  ["biotIndustryKz", "Отрасль · KZ"],
  ["biotKnowledgeResult", "Результат проверки знаний"],
  ["biotProctoringResult", "Результат прокторинга"],
] as const;
const psFields = [
  ["professionRu", "Обучаемая профессия · RU"],
  ["professionKz", "Обучаемая профессия · KZ"],
  ["psQualificationRu", "Присвоенная квалификация · RU"],
  ["psQualificationKz", "Присвоенная квалификация · KZ"],
] as const;

/** Facts shared by the course are entered once; raw participant exceptions win. */
export function CourseSharedFields({
  draft,
  resolvedEvents,
  fieldHints = {},
  disabled,
  onChange,
}: {
  draft: Draft;
  resolvedEvents: TrainingEventInput[] | undefined;
  fieldHints?: Record<string, string>;
  disabled: boolean;
  onChange: (patch: Partial<Draft>) => void;
}) {
  const relevant = (draft.events || []).flatMap((event, index) => {
    const direction = trainingDirection(event.protocolTemplateId);
    const effective =
      resolvedEvents?.find((candidate) => candidate.id === event.id)
        ?.commonFields || event.commonFields;
    const showHours =
      direction !== "BIOT" &&
      (!!effective.trainingDateRule ||
        event.commonFields.hours !== undefined ||
        !!fieldHints[`events.${index}.commonFields.hours`]);
    const showProductionHours =
      direction !== "BIOT" &&
      ((!!effective.trainingDateRule &&
        effective.trainingDateRule.hoursSource !== "THEORY") ||
        event.commonFields.productionHours !== undefined ||
        !!fieldHints[`events.${index}.commonFields.productionHours`]);
    return showHours ||
      showProductionHours ||
      event.protocolTemplateId === "ps-protocol" ||
      (event.protocolTemplateId === "biot-itr-protocol" &&
        isSpecialBiotCategory(effective.biotCategory))
      ? [{ event, index, direction, effective, showHours, showProductionHours }]
      : [];
  });
  if (!relevant.length) return null;
  return (
    <section
      aria-label="Общие сведения выбранных курсов"
      className="course-shared-fields"
    >
      {relevant.map(
        ({
          event,
          index,
          direction,
          effective,
          showHours,
          showProductionHours,
        }) => {
          const isItr =
            event.protocolTemplateId === "biot-itr-protocol" &&
            isSpecialBiotCategory(effective.biotCategory);
          const isPs = event.protocolTemplateId === "ps-protocol";
          const fields = [
            ...(showHours ? [["hours", "Часы программы"] as const] : []),
            ...(showProductionHours
              ? [
                  [
                    "productionHours",
                    "Часы производственного обучения",
                  ] as const,
                ]
              : []),
            ...(isItr ? [...itrFields] : isPs ? psFields : []),
          ];
          const members = draft.items.filter((item) =>
            item.assignments.some(
              (assignment) => assignment.eventId === event.id,
            ),
          );
          return (
            <details
              key={event.id}
              open={
                isItr || isPs || showHours || showProductionHours || undefined
              }
            >
              <summary>
                {trainingDisplayTitle(event.title)} ·{" "}
                {isPs
                  ? "параметры курса"
                  : isItr
                    ? "сведения проверки"
                    : showHours || showProductionHours
                      ? "длительность программы"
                      : "другая профессия или квалификация"}{" "}
                · {members.length} человек
              </summary>
              <fieldset disabled={disabled}>
                <legend>
                  {trainingDisplayTitle(event.title)} · общие сведения для{" "}
                  {members.length} человек
                </legend>
                {isPs && (
                  <TrainingPeriodFields
                    values={effective}
                    fieldPath={`events.${index}.commonFields`}
                    fieldHints={fieldHints}
                    origins={event.commonFields.fieldOrigins}
                    disabled={disabled}
                    onChange={(key, value) =>
                      onChange({
                        events: draft.events!.map((candidate) =>
                          candidate.id === event.id
                            ? {
                                ...candidate,
                                commonFields: {
                                  ...candidate.commonFields,
                                  [key]: value,
                                  fieldOrigins: {
                                    ...candidate.commonFields.fieldOrigins,
                                    [key]: value ? "MANUAL" : "CLEARED",
                                  },
                                },
                              }
                            : candidate,
                        ),
                      })
                    }
                  />
                )}
                {(showHours || showProductionHours) && (
                  <p className="fine-print">
                    Укажите фактическую длительность этой программы один раз для
                    курса. Сохранённый график центра рассчитает период обучения;
                    индивидуальные часы и даты сохраняются.
                  </p>
                )}
                {(isItr || isPs) && (
                  <p className="fine-print">
                    {isItr
                      ? "Укажите отрасль и фактические сведения проверки один раз для курса. Индивидуальные результаты сохраняются. Числовой балл и внешняя проверка не придумываются системой."
                      : "Если профессия совпадает с должностью человека, поля можно оставить пустыми. Иную обучаемую профессию или присвоенную квалификацию укажите здесь один раз."}
                  </p>
                )}
                <div className="form-grid">
                  {fields.map(([key, label]) => (
                    <label key={key}>
                      {label}
                      <input
                        aria-label={
                          key === "hours" || key === "productionHours"
                            ? `${trainingDirectionLabel(direction)} · ${label}`
                            : label
                        }
                        data-field-path={`events.${index}.commonFields.${key}`}
                        aria-invalid={
                          !!fieldHints[`events.${index}.commonFields.${key}`]
                        }
                        aria-describedby={
                          fieldHints[`events.${index}.commonFields.${key}`]
                            ? `course-${event.id}-${key}-feedback`
                            : undefined
                        }
                        value={String(
                          (effective as Record<string, unknown>)[key] || "",
                        )}
                        maxLength={
                          key === "hours" || key === "productionHours"
                            ? 30
                            : 500
                        }
                        inputMode={
                          key === "hours" || key === "productionHours"
                            ? "decimal"
                            : undefined
                        }
                        onChange={(change) => {
                          const value = change.target.value;
                          const commonFields: CommonFields = {
                            ...event.commonFields,
                            [key]: value,
                            fieldOrigins: {
                              ...event.commonFields.fieldOrigins,
                              [key]: value ? "MANUAL" : "CLEARED",
                            },
                          };
                          onChange({
                            events: draft.events!.map((candidate) =>
                              candidate.id === event.id
                                ? { ...candidate, commonFields }
                                : candidate,
                            ),
                          });
                        }}
                      />
                      {fieldHints[`events.${index}.commonFields.${key}`] && (
                        <small
                          className="field-hint"
                          id={`course-${event.id}-${key}-feedback`}
                        >
                          {fieldHints[`events.${index}.commonFields.${key}`]}
                        </small>
                      )}
                    </label>
                  ))}
                </div>
              </fieldset>
            </details>
          );
        },
      )}
    </section>
  );
}
