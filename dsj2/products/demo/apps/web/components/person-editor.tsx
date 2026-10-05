"use client";

import { useEffect, useRef, useState } from "react";
import {
  BIOT_CATEGORIES,
  isBlankText,
  isSpecialBiotCategory,
  trainingDirection,
  type TrainingDirection,
} from "@demo/contracts";
import { Modal } from "@demo/ui";
import type { AppContext, Draft, Recipient } from "@/lib/types";
import { templateLabels } from "@/lib/types";
import { recipientCourses } from "@/lib/recipient-course-context";
import {
  editTrainingAssignment,
  restoreTrainingAssignmentField,
} from "@/lib/training-assignment-edit";
import { biotCategoriesForTemplate } from "@/lib/assignment-presets";
import {
  initialPersonStage,
  personStageForField,
  trainingPeriodErrors,
  type PersonStage,
} from "@/lib/person-flow";
import { RecipientDetails } from "./recipient-details";
import { TrainingPeriodFields } from "./training-period-fields";
import { RecipientRecord } from "./recipient-record";
import { TextQualityHint } from "./text-quality-hint";
import "./person-editor.css";

const directions = [
  ["BIOT", "БиОТ"],
  ["PTM", "ПТМ"],
  ["PB", "ПБ"],
  ["PS", "ПС"],
] as const;
const steps = ["ФИО и должность", "Категория", "Курсы"];

export type PersonEditorProps = {
  draft: Draft;
  resolvedDraft: Draft;
  context: AppContext;
  fieldErrors: Record<string, string>;
  fieldHints?: Record<string, string>;
  provenance?: Record<string, Record<string, string>>;
  disabled: boolean;
  readonly: boolean;
  selectedId: string;
  focusFieldPath?: string | null;
  onSelect: (id: string) => void;
  onChangeRecipient: (recipient: Recipient) => void;
  onChooseTraining: (rowId: string, direction: TrainingDirection) => void;
  onRemoveTraining: (rowId: string, direction: TrainingDirection) => void;
  onPhoto: (rowId: string) => void;
  onPreview: (rowId: string, assignmentId: string) => void;
  onStageChange?: (stage: PersonStage) => void;
};

/** Legacy PERSON requests retain every person and the original assignment identities. */
export function PersonEditor(props: PersonEditorProps) {
  const person =
    props.draft.items.find((item) => item.id === props.selectedId) ||
    props.draft.items[0];
  if (!person) return <p>В заявке пока нет человека.</p>;
  return (
    <section className="person-editor" aria-label="Данные физлица">
      {props.draft.items.length > 1 && (
        <label className="person-existing-selector">
          Человек в заявке
          <select
            aria-label="Человек в заявке"
            value={person.id}
            onChange={(event) => props.onSelect(event.target.value)}
          >
            {props.draft.items.map((item, index) => (
              <option key={item.id} value={item.id}>
                {item.fullNameRu || item.fullNameKz || `Человек ${index + 1}`}
              </option>
            ))}
          </select>
        </label>
      )}
      <PersonFlow key={person.id} {...props} person={person} />
    </section>
  );
}

function PersonFlow({
  person,
  ...props
}: PersonEditorProps & { person: Recipient }) {
  const {
    draft,
    context,
    disabled,
    readonly,
    onChangeRecipient,
    onPhoto,
    onPreview,
  } = props;
  const rowIndex = draft.items.findIndex((item) => item.id === person.id);
  const resolved =
    props.resolvedDraft.items.find((item) => item.id === person.id) || person;
  const liveRules = draft.businessRuleVersion === "LIVE_V1";
  const [stage, setStage] = useState<PersonStage>(() =>
    initialPersonStage(person),
  );
  const [returnToCard, setReturnToCard] = useState(false);
  const [localErrors, setLocalErrors] = useState<Record<string, string>>({});
  const [openAssignment, setOpenAssignment] = useState<string | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const latest = useRef(person);
  latest.current = person;
  const fieldErrors = { ...props.fieldErrors, ...localErrors };
  const courses = recipientCourses(person, resolved);
  const issuedIds =
    draft.issuedAssignments
      ?.filter((item) => item.rowId === person.id)
      .map((item) => item.assignmentId) || [];
  const photoNeeded = person.assignments.some(
    (assignment) =>
      ["ptm-card", "pb-card", "ps-card"].includes(assignment.templateId) ||
      context.templates.some(
        (template) =>
          (template.templateId || template.id) === assignment.templateId &&
          template.photo,
      ),
  );
  const needsEmployer = person.assignments.some((assignment) =>
    assignment.templateId.startsWith("biot-"),
  );
  const needsEmployerDetails = resolved.assignments.some(
    (assignment) =>
      assignment.templateId.startsWith("biot-itr-") &&
      isSpecialBiotCategory(assignment.biotCategory),
  );
  const prefix = `items.${rowIndex}.`;

  useEffect(() => {
    props.onStageChange?.(stage);
  }, [stage, props.onStageChange]);

  useEffect(() => {
    let frame = 0;
    let focusFrame = 0;
    function reveal(path: string) {
      if (!path.startsWith(prefix)) return;
      const field = path.slice(prefix.length).split(".")[0];
      setStage(personStageForField(field));
      setReturnToCard(initialPersonStage(latest.current) === "summary");
      const match = /^assignments\.(\d+)(?:\.(.+))?$/.exec(
        path.slice(prefix.length),
      );
      if (match) {
        const assignment = latest.current.assignments[Number(match[1])];
        const course = recipientCourses(latest.current).find(
          (entry) => entry.assignmentIndex === Number(match[1]),
        );
        const inline =
          course &&
          (["documentDate", "protocolDate", "hours", "biotCategory"].includes(
            match[2] || "",
          ) ||
            (assignment?.templateId.startsWith("ps-") &&
              ["trainingStart", "trainingEnd"].includes(match[2] || "")));
        if (assignment && !inline) setOpenAssignment(assignment.id);
        else setOpenAssignment(null);
      } else setOpenAssignment(null);
      frame = requestAnimationFrame(() => {
        focusFrame = requestAnimationFrame(() => {
          const target = root.current?.querySelector<HTMLElement>(
            `[data-field-path="${CSS.escape(path)}"]`,
          );
          let parent = target?.parentElement;
          while (parent && parent !== root.current) {
            if (parent instanceof HTMLDetailsElement) parent.open = true;
            parent = parent.parentElement;
          }
          target?.focus();
          target?.scrollIntoView({ block: "center" });
        });
      });
    }
    const listener = (event: Event) =>
      reveal((event as CustomEvent<string>).detail);
    window.addEventListener("demo:focus-field", listener);
    if (props.focusFieldPath) reveal(props.focusFieldPath);
    return () => {
      cancelAnimationFrame(frame);
      cancelAnimationFrame(focusFrame);
      window.removeEventListener("demo:focus-field", listener);
    };
  }, [person.id, prefix, props.focusFieldPath]);

  function editPoint(next: PersonStage) {
    setReturnToCard(true);
    setStage(next);
    setLocalErrors({});
  }
  function field(key: string) {
    const path = `${prefix}${key}`;
    return {
      "data-field-path": path,
      "aria-invalid": !!fieldErrors[path],
      "aria-describedby":
        fieldErrors[path] || props.fieldHints?.[path]
          ? `person-${person.id}-${key}`
          : undefined,
    };
  }
  function feedback(key: string) {
    const path = `${prefix}${key}`;
    const message = fieldErrors[path] || props.fieldHints?.[path];
    return message ? (
      <small
        id={`person-${person.id}-${key}`}
        className={fieldErrors[path] ? "field-error" : "field-hint"}
        aria-live="polite"
      >
        {message}
      </small>
    ) : null;
  }
  function change(patch: Partial<Recipient>) {
    setLocalErrors((errors) =>
      Object.fromEntries(
        Object.entries(errors).filter(
          ([path]) => !Object.keys(patch).some((key) => path === prefix + key),
        ),
      ),
    );
    onChangeRecipient({ ...person, ...patch });
  }
  function advance() {
    const errors: Record<string, string> = {};
    if (stage === "identity") {
      if (isBlankText(person.fullNameRu || person.fullNameKz))
        errors[prefix + "fullNameRu"] = "Укажите ФИО";
      if (isBlankText(person.positionRu || person.positionKz))
        errors[prefix + "positionRu"] = "Укажите должность";
    } else if (stage === "category" && !person.employeeCategory)
      errors[prefix + "employeeCategory"] = "Выберите категорию";
    else if (stage === "courses") {
      if (!person.assignments.length)
        errors[prefix + "assignments"] = "Выберите хотя бы один курс";
      for (const course of courses)
        for (const [key, message] of Object.entries(
          trainingPeriodErrors(course.resolved),
        ))
          errors[`${prefix}assignments.${course.assignmentIndex}.${key}`] =
            message;
    }
    setLocalErrors(errors);
    if (Object.keys(errors).length) {
      const path = Object.keys(errors)[0];
      requestAnimationFrame(() =>
        root.current
          ?.querySelector<HTMLElement>(
            `[data-field-path="${CSS.escape(path)}"]`,
          )
          ?.focus(),
      );
      return;
    }
    setStage(
      returnToCard
        ? "summary"
        : stage === "identity"
          ? "category"
          : stage === "category"
            ? "courses"
            : "summary",
    );
    setReturnToCard(false);
  }
  function formList() {
    return (
      <ul className="person-document-list">
        {person.assignments.map((assignment) => (
          <li key={assignment.id}>
            <span>
              {templateLabels[assignment.templateId] || assignment.templateId}
            </span>
            <button
              type="button"
              disabled={disabled}
              aria-label={`Предпросмотр: ${templateLabels[assignment.templateId] || assignment.templateId}`}
              onClick={() => onPreview(person.id, assignment.id)}
            >
              Предпросмотр
            </button>
            <button
              type="button"
              className="text-button"
              onClick={() => setOpenAssignment(assignment.id)}
            >
              Параметры
            </button>
          </li>
        ))}
      </ul>
    );
  }

  return (
    <div ref={root} data-person-stage={stage} data-recipient-id={person.id}>
      {stage !== "summary" && (
        <ol className="person-step-list" aria-label="Шаги заполнения">
          {steps.map((label, index) => (
            <li
              key={label}
              aria-current={
                index === ["identity", "category", "courses"].indexOf(stage)
                  ? "step"
                  : undefined
              }
            >
              <span>{index + 1}</span>
              {label}
            </li>
          ))}
        </ol>
      )}
      {stage === "summary" ? (
        <>
          <div className="person-summary-heading">
            <div>
              <h2>{resolved.fullNameRu || resolved.fullNameKz}</h2>
              <TextQualityHint
                value={resolved.fullNameRu || resolved.fullNameKz}
              />
              <p>{resolved.positionRu || resolved.positionKz}</p>
              <TextQualityHint
                value={resolved.positionRu || resolved.positionKz}
              />
            </div>
            <button type="button" onClick={() => editPoint("identity")}>
              Изменить ФИО и должность
            </button>
          </div>
          <dl className="person-summary-facts">
            <div>
              <dt>Категория</dt>
              <dd>
                {person.employeeCategory === "ITR" ? "ИТР" : "Рабочий"}{" "}
                <button
                  type="button"
                  className="text-button"
                  onClick={() => editPoint("category")}
                >
                  Изменить категорию
                </button>
              </dd>
            </div>
            <div>
              <dt>Курсы</dt>
              <dd>
                {[...new Set(courses.map((course) => course.label))].join(", ")}{" "}
                <button
                  type="button"
                  className="text-button"
                  onClick={() => editPoint("courses")}
                >
                  Изменить курсы
                </button>
              </dd>
            </div>
          </dl>
          {formList()}
          {person.photoAssetId && (
            <img
              className="person-saved-photo"
              src={`/api/photos/${person.photoAssetId}`}
              alt="Фото получателя"
              width={72}
              height={96}
            />
          )}
          {(person.photoAssetId || photoNeeded) && (
            <button
              type="button"
              disabled={disabled || readonly}
              data-field-path={`${prefix}photoAssetId`}
              onClick={() => onPhoto(person.id)}
            >
              {person.photoAssetId ? "Изменить фото" : "Добавить фото"}
            </button>
          )}
        </>
      ) : (
        <>
          <h2>{steps[["identity", "category", "courses"].indexOf(stage)]}</h2>
          {stage === "identity" && (
            <>
              <div className="form-grid person-identity-fields">
                {(
                  [
                    ["fullNameRu", "fullNameKz", "ФИО"],
                    ["positionRu", "positionKz", "Должность"],
                  ] as const
                ).map(([key, fallback, label]) => (
                  <label key={key}>
                    {label}
                    <input
                      {...field(key)}
                      aria-label={label}
                      value={person[key] || person[fallback]}
                      disabled={disabled || readonly}
                      onChange={(event) =>
                        change({ [key]: event.target.value })
                      }
                      onKeyDown={(event) => {
                        if (
                          event.key === "Enter" &&
                          !event.nativeEvent.isComposing
                        ) {
                          event.preventDefault();
                          advance();
                        }
                      }}
                    />
                    {feedback(key)}
                    <TextQualityHint value={person[key] || person[fallback]} />
                  </label>
                ))}
              </div>
              <details className="person-additional">
                <summary>
                  Дополнительные персональные данные
                  {person.fullNameKz || person.positionKz
                    ? " · сохранён казахский вариант"
                    : ""}
                </summary>
                <div className="form-grid">
                  {(
                    [
                      ["fullNameKz", "ФИО · KZ"],
                      ["positionKz", "Должность · KZ"],
                    ] as const
                  ).map(([key, label]) => (
                    <label key={key}>
                      {label}
                      <input
                        {...field(key)}
                        aria-label={label}
                        value={person[key]}
                        disabled={disabled || readonly}
                        onChange={(event) =>
                          change({ [key]: event.target.value })
                        }
                      />
                      {feedback(key)}
                      <TextQualityHint value={person[key]} />
                    </label>
                  ))}
                </div>
                <button
                  type="button"
                  disabled={disabled || readonly}
                  onClick={() => onPhoto(person.id)}
                >
                  {person.photoAssetId ? "Изменить фото" : "Добавить фото"}
                </button>
              </details>
            </>
          )}
          {stage === "category" && (
            <div
              role="group"
              aria-label="Категория сотрудника"
              className="person-category-choices"
              {...field("employeeCategory")}
              tabIndex={-1}
            >
              {(
                [
                  ["WORKER", "Рабочий"],
                  ["ITR", "ИТР"],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  disabled={disabled || readonly}
                  aria-pressed={person.employeeCategory === value}
                  onClick={() => change({ employeeCategory: value })}
                >
                  {label}
                </button>
              ))}
              {feedback("employeeCategory")}
            </div>
          )}
          {stage === "courses" && (
            <>
              <div
                className="person-course-choices"
                role="group"
                aria-label="Курсы"
                {...field("assignments")}
                tabIndex={-1}
              >
                {directions.map(([direction, label]) => {
                  const selected = person.assignments.some(
                    (assignment) =>
                      trainingDirection(assignment.templateId) === direction,
                  );
                  return (
                    <button
                      type="button"
                      key={direction}
                      disabled={disabled || readonly}
                      aria-pressed={selected}
                      onClick={() => {
                        setLocalErrors((current) => {
                          const next = { ...current };
                          delete next[prefix + "assignments"];
                          return next;
                        });
                        if (selected)
                          props.onRemoveTraining(person.id, direction);
                        else props.onChooseTraining(person.id, direction);
                      }}
                    >
                      {label}
                      {selected ? " ✓" : ""}
                    </button>
                  );
                })}
              </div>
              {feedback("assignments")}
              {courses.map((course) => {
                const assignment = course.assignment;
                const effective = course.resolved;
                const path = `${prefix}assignments.${course.assignmentIndex}`;
                const direction = trainingDirection(assignment.templateId);
                const blocked =
                  disabled || readonly || issuedIds.includes(assignment.id);
                const update = (patch: Partial<typeof assignment>) => {
                  setLocalErrors((current) => {
                    const next = { ...current };
                    delete next[path + ".trainingStart"];
                    delete next[path + ".trainingEnd"];
                    return next;
                  });
                  onChangeRecipient(
                    editTrainingAssignment(
                      person,
                      assignment.id,
                      patch,
                      liveRules,
                    ),
                  );
                };
                return (
                  <section
                    className="person-course-card"
                    key={course.key}
                    aria-label={`Параметры ${course.label}`}
                  >
                    <h3>{course.label}</h3>
                    <div className="form-grid compact">
                      {direction === "BIOT" && (
                        <label>
                          Категория обучения БиОТ
                          <select
                            aria-label="Категория обучения БиОТ"
                            disabled={blocked}
                            {...field(
                              `assignments.${course.assignmentIndex}.biotCategory`,
                            )}
                            value={effective.biotCategory || ""}
                            onChange={(event) =>
                              update({
                                biotCategory: event.target
                                  .value as typeof assignment.biotCategory,
                              })
                            }
                          >
                            {biotCategoriesForTemplate(
                              assignment.templateId,
                            ).map((category) => (
                              <option key={category} value={category}>
                                {BIOT_CATEGORIES[category].label}
                              </option>
                            ))}
                          </select>
                          {feedback(
                            `assignments.${course.assignmentIndex}.biotCategory`,
                          )}
                        </label>
                      )}
                      <label>
                        Дата документа
                        <input
                          aria-label="Дата документа"
                          type="date"
                          disabled={blocked}
                          {...field(
                            `assignments.${course.assignmentIndex}.documentDate`,
                          )}
                          value={effective.documentDate || ""}
                          onChange={(event) =>
                            update({ documentDate: event.target.value })
                          }
                        />
                        {feedback(
                          `assignments.${course.assignmentIndex}.documentDate`,
                        )}
                      </label>
                      <label>
                        Дата протокола
                        <input
                          aria-label="Дата протокола"
                          type="date"
                          disabled={blocked}
                          {...field(
                            `assignments.${course.assignmentIndex}.protocolDate`,
                          )}
                          value={effective.protocolDate || ""}
                          onChange={(event) =>
                            update({ protocolDate: event.target.value })
                          }
                        />
                        {feedback(
                          `assignments.${course.assignmentIndex}.protocolDate`,
                        )}
                      </label>
                      {direction !== "BIOT" && (
                        <label>
                          Часы программы
                          <input
                            aria-label="Часы программы"
                            inputMode="decimal"
                            disabled={blocked}
                            {...field(
                              `assignments.${course.assignmentIndex}.hours`,
                            )}
                            value={effective.hours || ""}
                            onChange={(event) =>
                              update({ hours: event.target.value })
                            }
                          />
                          {feedback(
                            `assignments.${course.assignmentIndex}.hours`,
                          )}
                        </label>
                      )}
                    </div>
                    {direction === "PS" && (
                      <TrainingPeriodFields
                        values={effective}
                        fieldPath={path}
                        fieldErrors={fieldErrors}
                        fieldHints={props.fieldHints}
                        origins={assignment.fieldOrigins}
                        disabled={blocked}
                        onChange={(key, value) => update({ [key]: value })}
                        onRestore={(key) =>
                          onChangeRecipient(
                            restoreTrainingAssignmentField(
                              person,
                              assignment.id,
                              key,
                              liveRules,
                            ),
                          )
                        }
                      />
                    )}
                    {direction === "BIOT" &&
                      isSpecialBiotCategory(effective.biotCategory) && (
                        <div className="form-grid">
                          {(
                            [
                              ["biotIndustryRu", "Отрасль · RU"],
                              ["biotIndustryKz", "Отрасль · KZ"],
                              [
                                "biotKnowledgeResult",
                                "Фактический результат проверки знаний",
                              ],
                              [
                                "biotProctoringResult",
                                "Фактический результат прокторинга",
                              ],
                            ] as const
                          ).map(([key, label]) => (
                            <label key={key}>
                              {label}
                              <input
                                aria-label={label}
                                disabled={blocked}
                                {...field(
                                  `assignments.${course.assignmentIndex}.${key}`,
                                )}
                                value={effective[key] || ""}
                                onChange={(event) =>
                                  update({ [key]: event.target.value })
                                }
                              />
                              {feedback(
                                `assignments.${course.assignmentIndex}.${key}`,
                              )}
                            </label>
                          ))}
                        </div>
                      )}
                    <ul className="person-document-list">
                      {person.assignments
                        .filter(
                          (entry) =>
                            entry.eventId === assignment.eventId &&
                            trainingDirection(entry.templateId) === direction,
                        )
                        .map((entry) => (
                          <li key={entry.id}>
                            <span>
                              {templateLabels[entry.templateId] ||
                                entry.templateId}
                            </span>
                            <button
                              type="button"
                              disabled={disabled}
                              onClick={() => onPreview(person.id, entry.id)}
                            >
                              Предпросмотр
                            </button>
                            <button
                              type="button"
                              className="text-button"
                              onClick={() => setOpenAssignment(entry.id)}
                            >
                              Параметры
                            </button>
                          </li>
                        ))}
                    </ul>
                  </section>
                );
              })}
              {(photoNeeded || person.photoAssetId) && (
                <div className="person-course-photo">
                  <button
                    type="button"
                    {...field("photoAssetId")}
                    disabled={disabled || readonly}
                    onClick={() => onPhoto(person.id)}
                  >
                    {person.photoAssetId
                      ? "Изменить фото"
                      : "Добавить фото для документа"}
                  </button>
                  {feedback("photoAssetId")}
                </div>
              )}
              {(needsEmployer || person.workplaceRu || person.workplaceKz) && (
                <section
                  className="person-employer-fields"
                  aria-label="Работодатель для документов"
                >
                  <h3>Работодатель для документов БиОТ</h3>
                  <div className="form-grid">
                    <label>
                      Место работы
                      <input
                        aria-label="Место работы"
                        {...field("workplaceRu")}
                        disabled={disabled || readonly}
                        value={person.workplaceRu || person.workplaceKz}
                        onChange={(event) =>
                          change({ workplaceRu: event.target.value })
                        }
                      />
                      {feedback("workplaceRu")}
                    </label>
                    {needsEmployerDetails &&
                      (
                        [
                          ["employerBin", "БИН работодателя"],
                          [
                            "employerAddressRu",
                            "Юридический адрес работодателя",
                          ],
                        ] as const
                      ).map(([key, label]) => (
                        <label key={key}>
                          {label}
                          <input
                            aria-label={label}
                            {...field(key)}
                            disabled={disabled || readonly}
                            value={person[key] || ""}
                            onChange={(event) =>
                              change({ [key]: event.target.value })
                            }
                          />
                          {feedback(key)}
                        </label>
                      ))}
                  </div>
                  <details>
                    <summary>Дополнительные сведения работодателя</summary>
                    <div className="form-grid">
                      {(
                        [
                          ["workplaceKz", "Место работы · KZ"],
                          ["employerAddressKz", "Адрес работодателя · KZ"],
                          ["departmentRu", "Подразделение · RU"],
                          ["departmentKz", "Подразделение · KZ"],
                        ] as const
                      ).map(([key, label]) => (
                        <label key={key}>
                          {label}
                          <input
                            aria-label={label}
                            {...field(key)}
                            disabled={disabled || readonly}
                            value={person[key] || ""}
                            onChange={(event) =>
                              change({ [key]: event.target.value })
                            }
                          />
                          {feedback(key)}
                        </label>
                      ))}
                    </div>
                    <RecipientRecord
                      recipient={person}
                      disabled={disabled || readonly}
                      onChange={onChangeRecipient}
                      rowIndex={rowIndex}
                      fieldErrors={fieldErrors}
                      fieldHints={props.fieldHints}
                    />
                  </details>
                </section>
              )}
            </>
          )}
          <div className="person-step-actions">
            {stage !== "identity" && !returnToCard && (
              <button
                type="button"
                onClick={() =>
                  setStage(stage === "courses" ? "category" : "identity")
                }
              >
                Назад
              </button>
            )}
            <button
              type="button"
              className="primary"
              disabled={disabled}
              onClick={advance}
            >
              {returnToCard
                ? "Готово"
                : stage === "courses"
                  ? "Готово"
                  : "Далее"}
            </button>
          </div>
        </>
      )}
      {openAssignment &&
        person.assignments.some(
          (assignment) => assignment.id === openAssignment,
        ) && (
          <Modal
            title="Параметры документа"
            onClose={() => setOpenAssignment(null)}
            wide
          >
            <RecipientDetails
              recipient={person}
              resolvedRecipient={resolved}
              onChange={onChangeRecipient}
              context={context}
              rowIndex={rowIndex}
              fieldErrors={fieldErrors}
              fieldHints={props.fieldHints}
              provenance={props.provenance}
              disabled={disabled || readonly}
              liveRules={liveRules}
              focusFieldPath={props.focusFieldPath}
              issuedAssignmentIds={issuedIds}
              documentsOnly
              assignmentIds={[openAssignment]}
              onPhoto={onPhoto}
              onPreview={onPreview}
            />
            <div className="modal-actions">
              <button
                type="button"
                className="primary"
                onClick={() => setOpenAssignment(null)}
              >
                Готово
              </button>
            </div>
          </Modal>
        )}
    </div>
  );
}
