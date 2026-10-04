"use client";

import {
  memo,
  useEffect,
  useState,
  type KeyboardEvent,
  type RefObject,
} from "react";
import { Icon } from "@demo/ui";
import type { GridField } from "@/lib/grid-paste";
import type { Recipient } from "@/lib/types";
import {
  assignedDocumentTemplates,
  documentChoices,
} from "@/lib/document-selection";
import {
  editRecipientRowDate,
  recipientRowDate,
} from "@/lib/recipient-row-date";
import type { RecipientGridProps } from "./recipient-grid";
import { TextQualityHint } from "./text-quality-hint";
import { restoreTrainingAssignmentField } from "@/lib/training-assignment-edit";
import { editTrainingAssignment } from "@/lib/training-assignment-edit";
import {
  recipientCourses,
  recipientPositionLabel,
} from "@/lib/recipient-course-context";
import { TranslationSuggestion } from "./translation-suggestion";

export type GridRowActions = Pick<
  RecipientGridProps,
  | "onEdit"
  | "onSelect"
  | "onOpen"
  | "onDocuments"
  | "onPhoto"
  | "onRemove"
  | "onPaste"
> & {
  toggleChecked: (id: string, checked: boolean) => void;
  moveInColumn: (
    event: KeyboardEvent<HTMLInputElement | HTMLSelectElement>,
    visibleIndex: number,
    field: GridField | "employeeCategory" | "documentDate",
  ) => void;
};
type Props = {
  item: Recipient;
  issuedAssignmentIds: readonly string[];
  resolvedItem: Recipient;
  index: number;
  visibleIndex: number;
  active: boolean;
  checked: boolean;
  disabled: boolean;
  readonly: boolean;
  canSelectDocuments: boolean;
  liveRules: boolean;
  showPhotoColumn: boolean;
  needsPhoto: boolean;
  documentCount: number;
  rowErrors: number;
  fieldErrors: Record<string, string>;
  fieldHints: Record<string, string>;
  columns: readonly (readonly [GridField, string])[];
  instanceId: string;
  inputs: Map<string, HTMLInputElement | HTMLSelectElement>;
  actions: RefObject<GridRowActions>;
};
const employerFields = [
  ["workplaceRu", "Предприятие"],
  ["employerBin", "БИН предприятия"],
  ["employerAddressRu", "Адрес предприятия · RU"],
] as const;

/** Compare visible resolved values, because resolution recreates every recipient. */
function resolvedRowKey(item: Recipient) {
  return JSON.stringify([
    item.employeeCategory,
    item.workplaceRu,
    item.employerBin,
    item.employerAddressRu,
    ...item.assignments.map((entry) => [
      entry.templateId,
      entry.documentDate,
      entry.protocolDate,
      entry.trainingStart,
      entry.trainingEnd,
      entry.fieldOrigins,
      entry.protocolMode,
      entry.eventId,
    ]),
  ]);
}
function feedbackKey(props: Props, values: Record<string, string>) {
  const fields = [
    ...props.columns.map(([field]) => field),
    "employeeCategory",
    "photoAssetId",
    ...employerFields.map(([field]) => field),
    ...props.item.assignments.flatMap((_, index) => [
      `assignments.${index}.documentDate`,
      `assignments.${index}.protocolDate`,
      `assignments.${index}.trainingStart`,
      `assignments.${index}.trainingEnd`,
    ]),
  ];
  return fields
    .map((field) => values[`items.${props.index}.${field}`] || "")
    .join("\u0000");
}

/** Preserve native rows, keyboard entry and paste while updating only changed rows. */
export const RecipientGridRow = memo(
  function RecipientGridRow({
    item,
    issuedAssignmentIds,
    resolvedItem,
    index,
    visibleIndex,
    active,
    checked,
    disabled,
    readonly,
    canSelectDocuments,
    liveRules,
    showPhotoColumn,
    needsPhoto,
    documentCount,
    rowErrors,
    fieldErrors,
    fieldHints,
    columns,
    instanceId,
    inputs,
    actions,
  }: Props) {
    const prefix = `items.${index}.`;
    const positionLabel = recipientPositionLabel(item);
    const courses = recipientCourses(item, resolvedItem);
    const [datesExpanded, setDatesExpanded] = useState(false);
    const date = recipientRowDate(item, resolvedItem);
    const personalDate = item.assignments.some(
      (entry) =>
        !entry.templateId.endsWith("-protocol") &&
        ["MANUAL", "IMPORTED", "CLEARED"].includes(
          entry.fieldOrigins?.documentDate || "",
        ),
    );
    const templates = [...assignedDocumentTemplates(resolvedItem)];
    const primaryTemplates = templates.filter(
      (template) => !template.endsWith("-protocol"),
    );
    const trainingLabel =
      (primaryTemplates.length ? primaryTemplates : templates)
        .map(
          (template) =>
            documentChoices.find((choice) => choice.templateId === template)
              ?.shortLabel || template,
        )
        .join(", ") || "Выбрать обучение";
    const itr = templates.includes("biot-itr-protocol");
    const visibleEmployerFields = employerFields.filter(
      ([field]) =>
        field !== "workplaceRu" ||
        !resolvedItem.workplaceRu?.trim() ||
        item.workplaceRu?.trim(),
    );
    const employerMissing = visibleEmployerFields.some(
      ([field]) => !(resolvedItem[field] || "").trim(),
    );
    const employerErrors = visibleEmployerFields.some(
      ([field]) => fieldErrors[`${prefix}${field}`],
    );
    const [employerExpanded, setEmployerExpanded] = useState(
      employerMissing || employerErrors,
    );
    useEffect(() => {
      if (employerMissing || employerErrors) setEmployerExpanded(true);
    }, [employerMissing, employerErrors]);
    const rowClass = [
      active ? "is-active" : "",
      checked ? "is-checked" : "",
      rowErrors ? "has-errors" : "",
    ]
      .filter(Boolean)
      .join(" ");
    const ref =
      (field: string) =>
      (element: HTMLInputElement | HTMLSelectElement | null) => {
        const key = `${item.id}:${field}`;
        if (element) inputs.set(key, element);
        else inputs.delete(key);
      };
    const feedbackId = (field: string) =>
      `${instanceId}-${item.id}-${field}-feedback`;
    const feedback = (field: string) => {
      const error = fieldErrors[`${prefix}${field}`];
      const message = error || fieldHints[`${prefix}${field}`];
      return message ? (
        <small
          id={feedbackId(field)}
          className={error ? "field-error" : "field-hint"}
          title={message}
        >
          {message}
        </small>
      ) : null;
    };
    const describedBy = (field: string) =>
      fieldErrors[`${prefix}${field}`] || fieldHints[`${prefix}${field}`]
        ? feedbackId(field)
        : undefined;
    const firstIssueIndex = item.assignments.findIndex(
      (assignment) => !assignment.templateId.endsWith("-protocol"),
    );
    const datePath =
      firstIssueIndex >= 0
        ? `${prefix}assignments.${firstIssueIndex}.documentDate`
        : undefined;
    const dateField =
      item.assignments
        .flatMap((assignment, n) =>
          assignment.templateId.endsWith("-protocol")
            ? []
            : [`assignments.${n}.documentDate`],
        )
        .find(
          (field) =>
            fieldErrors[`${prefix}${field}`] || fieldHints[`${prefix}${field}`],
        ) || `assignments.${firstIssueIndex}.documentDate`;
    return (
      <>
        <tr data-recipient-id={item.id} className={rowClass}>
          <td className="recipient-grid-selection">
            <label>
              <input
                type="checkbox"
                aria-label={`Выбрать строку ${index + 1}`}
                disabled={disabled}
                checked={checked}
                onChange={(event) =>
                  actions.current.toggleChecked(item.id, event.target.checked)
                }
              />
              <span aria-hidden="true">{index + 1}</span>
            </label>
          </td>
          <td className="recipient-grid-settings">
            <div className="recipient-grid-settings-line">
              <button
                type="button"
                className="recipient-grid-training-button"
                disabled={disabled}
                title={trainingLabel}
                aria-label={`Настройки обучения получателя ${index + 1}: ${trainingLabel}`}
                onClick={() =>
                  !readonly && canSelectDocuments
                    ? actions.current.onDocuments?.(item.id)
                    : actions.current.onOpen(item.id)
                }
              >
                <span>{trainingLabel}</span>
                <Icon name="chevron" size={12} />
              </button>
              <select
                ref={ref("employeeCategory")}
                aria-label={`Категория сотрудника, строка ${index + 1}`}
                data-field-path={`${prefix}employeeCategory`}
                aria-invalid={!!fieldErrors[`${prefix}employeeCategory`]}
                aria-describedby={describedBy("employeeCategory")}
                value={
                  item.employeeCategory ||
                  resolvedItem.employeeCategory ||
                  (templates.includes("biot-itr-certificate")
                    ? "ITR"
                    : "WORKER")
                }
                disabled={
                  disabled ||
                  readonly ||
                  item.assignments.some(
                    (entry) =>
                      entry.templateId.startsWith("biot-") &&
                      issuedAssignmentIds.includes(entry.id),
                  )
                }
                onChange={(event) =>
                  actions.current.onEdit({
                    ...item,
                    employeeCategory: event.target.value as "WORKER" | "ITR",
                  })
                }
              >
                <option value="WORKER">Рабочий</option>
                <option value="ITR">ИТР</option>
              </select>
            </div>
            {date.kind === "mixed" ? (
              <button
                type="button"
                className="recipient-grid-mixed-date"
                disabled={disabled}
                onClick={() => {
                  setDatesExpanded(true);
                  requestAnimationFrame(() => {
                    const panel = document.getElementById(
                      `${instanceId}-${item.id}-course-dates`,
                    );
                    panel
                      ?.querySelector<HTMLInputElement>("input:enabled")
                      ?.focus();
                    panel?.scrollIntoView({
                      block: "nearest",
                      inline: "nearest",
                    });
                  });
                }}
                title="У курсов разные даты. Раскрыть даты рядом в этой строке."
              >
                Разные даты <Icon name="chevron" size={12} />
              </button>
            ) : (
              <input
                ref={ref("documentDate")}
                type="date"
                value={date.value}
                aria-label={`Дата выдачи, строка ${index + 1}`}
                aria-invalid={!!fieldErrors[`${prefix}${dateField}`]}
                aria-describedby={describedBy(dateField)}
                data-field-path={datePath}
                disabled={
                  disabled ||
                  date.kind === "none" ||
                  issuedAssignmentIds.length > 0
                }
                readOnly={readonly}
                title={
                  date.kind === "none"
                    ? "Сначала выберите обучение"
                    : "Дата выдачи документов получателя"
                }
                onFocus={() => actions.current.onSelect(item.id)}
                onChange={(event) =>
                  actions.current.onEdit(
                    editRecipientRowDate(
                      item,
                      resolvedItem,
                      event.target.value,
                      liveRules,
                    ),
                  )
                }
              />
            )}
            {date.kind === "single" && (
              <small className="recipient-grid-date-source">
                {personalDate ? "Личная дата" : "Общая дата"}
                {personalDate && !readonly && (
                  <button
                    type="button"
                    className="text-button"
                    disabled={disabled || issuedAssignmentIds.length > 0}
                    onClick={() =>
                      actions.current.onEdit(
                        item.assignments
                          .filter(
                            (entry) => !entry.templateId.endsWith("-protocol"),
                          )
                          .reduce(
                            (next, entry) =>
                              restoreTrainingAssignmentField(
                                next,
                                entry.id,
                                "documentDate",
                                liveRules,
                              ),
                            item,
                          ),
                      )
                    }
                  >
                    Вернуть общую
                  </button>
                )}
              </small>
            )}
            {feedback(dateField)}
            {feedback("employeeCategory")}
            {!!courses.length && (
              <button
                type="button"
                className="text-button recipient-grid-course-toggle"
                aria-label={`Даты курсов, строка ${index + 1}`}
                aria-expanded={datesExpanded}
                aria-controls={`${instanceId}-${item.id}-course-dates`}
                disabled={disabled}
                onClick={() => setDatesExpanded((value) => !value)}
              >
                {datesExpanded ? "Скрыть даты курсов" : "Даты курсов"} ·{" "}
                {courses.length}
              </button>
            )}
          </td>
          {columns.map(([field, label], columnIndex) => {
            const value =
              item[field] || (field === "fullNameRu" ? item.fullNameKz : "");
            return (
              <td
                key={field}
                className={
                  columnIndex === 0 ? "recipient-grid-name" : undefined
                }
              >
                <input
                  ref={ref(field)}
                  type="text"
                  value={value}
                  title={
                    field.startsWith("position")
                      ? `${positionLabel}${value ? `: ${value}` : ""}`
                      : value || undefined
                  }
                  aria-label={`${field.startsWith("position") ? `${positionLabel} · ${field.endsWith("Kz") ? "KZ" : "RU"}` : label}, строка ${index + 1}`}
                  aria-invalid={!!fieldErrors[`${prefix}${field}`]}
                  aria-describedby={describedBy(field)}
                  data-field-path={`${prefix}${field}`}
                  data-grid-field={field}
                  disabled={disabled}
                  readOnly={readonly}
                  autoComplete="off"
                  spellCheck={false}
                  placeholder={label}
                  onFocus={() => actions.current.onSelect(item.id)}
                  onChange={(event) =>
                    actions.current.onEdit({
                      ...item,
                      [field]: event.target.value,
                    })
                  }
                  onKeyDown={(event) =>
                    actions.current.moveInColumn(event, visibleIndex, field)
                  }
                  onPaste={(event) => {
                    if (readonly || disabled) return;
                    const text = event.clipboardData.getData("text");
                    if (!/[\t\r\n]/.test(text)) return;
                    event.preventDefault();
                    actions.current.onPaste({
                      startRow: index,
                      startField: field,
                      text,
                      columns: columns.map(([column]) => column),
                    });
                  }}
                />
                {feedback(field)}
                <TextQualityHint value={value} />
                {field === "positionKz" && (
                  <TranslationSuggestion
                    compact
                    source={item.positionRu}
                    currentText={item.positionKz}
                    field="positionRu"
                    target="kk"
                    disabled={disabled || readonly}
                    onApply={(text) =>
                      actions.current.onEdit({ ...item, positionKz: text })
                    }
                  />
                )}
              </td>
            );
          })}
          {showPhotoColumn && (
            <td className="recipient-grid-photo">
              {needsPhoto || item.photoAssetId ? (
                <button
                  type="button"
                  disabled={disabled || readonly}
                  className="recipient-grid-photo-button"
                  aria-label={`${item.photoAssetId ? "Изменить" : "Добавить"} фото получателя ${index + 1}`}
                  onClick={() =>
                    (actions.current.onPhoto || actions.current.onOpen)(item.id)
                  }
                >
                  {item.photoAssetId ? "Фото ✓" : "Добавить фото"}
                </button>
              ) : (
                <span className="recipient-grid-no-photo">—</span>
              )}
              {feedback("photoAssetId")}
            </td>
          )}
          <td className="recipient-grid-actions">
            <div className="recipient-grid-row-actions">
              <button
                type="button"
                className="text-button recipient-grid-details-button"
                disabled={disabled}
                onClick={() => actions.current.onOpen(item.id)}
                aria-label={`Детали получателя ${index + 1}`}
                title={`Документов: ${documentCount}. Открыть детали`}
              >
                Детали <Icon name="chevron" size={12} />
              </button>
              {!readonly && (
                <>
                  <button
                    type="button"
                    disabled={disabled || issuedAssignmentIds.length > 0}
                    aria-label={`Удалить получателя ${index + 1}`}
                    aria-describedby={
                      issuedAssignmentIds.length > 0
                        ? `${instanceId}-issued-removal-${index}`
                        : undefined
                    }
                    title={
                      issuedAssignmentIds.length > 0
                        ? "Получателя с выпущенными документами нельзя удалить. Продолжайте оставшиеся обучения в этой строке."
                        : "Удалить получателя"
                    }
                    onClick={() => actions.current.onRemove(item.id)}
                  >
                    ×
                  </button>
                  {issuedAssignmentIds.length > 0 && (
                    <span
                      id={`${instanceId}-issued-removal-${index}`}
                      className="sr-only"
                    >
                      Получателя с выпущенными документами нельзя удалить.
                      Продолжайте оставшиеся обучения в этой строке.
                    </span>
                  )}
                </>
              )}
            </div>
            {rowErrors > 0 && (
              <small className="recipient-grid-row-errors">
                Ошибок: {rowErrors}
              </small>
            )}
          </td>
        </tr>
        {datesExpanded && courses.length > 0 && (
          <tr
            data-recipient-id={item.id}
            className={`recipient-grid-date-supplement ${rowClass}`}
          >
            <td colSpan={columns.length + 3 + (showPhotoColumn ? 1 : 0)}>
              <div
                id={`${instanceId}-${item.id}-course-dates`}
                className="recipient-grid-course-dates"
              >
                {courses.map((course) => (
                  <fieldset
                    key={course.key}
                    disabled={
                      disabled ||
                      readonly ||
                      issuedAssignmentIds.includes(course.assignment.id)
                    }
                  >
                    <legend>{course.label}</legend>
                    {issuedAssignmentIds.includes(course.assignment.id) && (
                      <small>
                        Оформлено · изменение через исправление документа
                      </small>
                    )}
                    {(
                      [
                        ["documentDate", "Выдача"],
                        ["protocolDate", "Протокол"],
                        ["trainingStart", "Начало"],
                        ["trainingEnd", "Окончание"],
                      ] as const
                    )
                      .filter(
                        ([field]) =>
                          !course.protocolOnly || field !== "documentDate",
                      )
                      .map(([field, label]) => {
                        const path = `assignments.${course.assignmentIndex}.${field}`;
                        const origin = course.assignment.fieldOrigins?.[field];
                        const exception = [
                          "MANUAL",
                          "IMPORTED",
                          "CLEARED",
                        ].includes(origin || "");
                        return (
                          <label key={field}>
                            <span>{label}</span>
                            <input
                              type="date"
                              value={course.resolved[field] || ""}
                              data-field-path={`${prefix}${path}`}
                              aria-label={`${course.label}: ${label.toLowerCase()}, строка ${index + 1}`}
                              aria-invalid={!!fieldErrors[`${prefix}${path}`]}
                              aria-describedby={describedBy(path)}
                              onChange={(event) =>
                                actions.current.onEdit(
                                  editTrainingAssignment(
                                    item,
                                    course.assignment.id,
                                    { [field]: event.target.value },
                                    liveRules,
                                  ),
                                )
                              }
                            />
                            <small>
                              {exception
                                ? origin === "IMPORTED"
                                  ? "Из импорта · исключение"
                                  : origin === "CLEARED"
                                    ? "Явно очищено"
                                    : "Личное исключение"
                                : "Общая дата курса"}
                            </small>
                            {exception && !readonly && (
                              <button
                                type="button"
                                className="text-button"
                                onClick={() =>
                                  actions.current.onEdit(
                                    restoreTrainingAssignmentField(
                                      item,
                                      course.assignment.id,
                                      field,
                                      liveRules,
                                    ),
                                  )
                                }
                              >
                                Вернуть общую
                              </button>
                            )}
                            {feedback(path)}
                          </label>
                        );
                      })}
                  </fieldset>
                ))}
              </div>
            </td>
          </tr>
        )}
        {itr && (
          <tr
            data-recipient-id={item.id}
            className={`recipient-grid-supplement ${rowClass}`}
          >
            <td colSpan={columns.length + 3 + (showPhotoColumn ? 1 : 0)}>
              <details
                open={employerExpanded}
                onToggle={(event) =>
                  setEmployerExpanded(event.currentTarget.open)
                }
              >
                <summary>
                  Реквизиты предприятия
                  {employerMissing ? " · заполните для протокола ИТР" : ""}
                </summary>
                <div className="recipient-grid-employer-fields">
                  {visibleEmployerFields.map(([field, label]) => (
                    <label key={field}>
                      <span>{label}</span>
                      <input
                        ref={ref(field)}
                        value={resolvedItem[field] || item[field] || ""}
                        inputMode={
                          field === "employerBin" ? "numeric" : undefined
                        }
                        aria-label={`${label}, строка ${index + 1}`}
                        data-field-path={`${prefix}${field}`}
                        aria-invalid={!!fieldErrors[`${prefix}${field}`]}
                        aria-describedby={describedBy(field)}
                        disabled={disabled}
                        readOnly={readonly}
                        onChange={(event) =>
                          actions.current.onEdit({
                            ...item,
                            [field]: event.target.value,
                          })
                        }
                      />
                      {feedback(field)}
                    </label>
                  ))}
                </div>
              </details>
            </td>
          </tr>
        )}
      </>
    );
  },
  (before, after) =>
    before.item === after.item &&
    before.issuedAssignmentIds.join("\u0000") ===
      after.issuedAssignmentIds.join("\u0000") &&
    before.index === after.index &&
    before.visibleIndex === after.visibleIndex &&
    before.active === after.active &&
    before.checked === after.checked &&
    before.disabled === after.disabled &&
    before.readonly === after.readonly &&
    before.canSelectDocuments === after.canSelectDocuments &&
    before.liveRules === after.liveRules &&
    before.showPhotoColumn === after.showPhotoColumn &&
    before.needsPhoto === after.needsPhoto &&
    before.documentCount === after.documentCount &&
    before.rowErrors === after.rowErrors &&
    before.columns === after.columns &&
    before.instanceId === after.instanceId &&
    before.inputs === after.inputs &&
    before.actions === after.actions &&
    resolvedRowKey(before.resolvedItem) ===
      resolvedRowKey(after.resolvedItem) &&
    feedbackKey(before, before.fieldErrors) ===
      feedbackKey(after, after.fieldErrors) &&
    feedbackKey(before, before.fieldHints) ===
      feedbackKey(after, after.fieldHints),
);
