"use client";

import { memo, type KeyboardEvent, type RefObject } from "react";
import { Icon } from "@demo/ui";
import type { GridField } from "@/lib/grid-paste";
import type { Recipient } from "@/lib/types";
import type { RecipientGridProps } from "./recipient-grid";
import { TextQualityHint } from "./text-quality-hint";
import { documentChoices } from "@/lib/document-selection";
import "./document-selection.css";

export type GridRowActions = Pick<
  RecipientGridProps,
  "onEdit" | "onSelect" | "onOpen" | "onDocuments" | "onRemove" | "onPaste"
> & {
  toggleChecked: (id: string, checked: boolean) => void;
  moveInColumn: (
    event: KeyboardEvent<HTMLInputElement>,
    visibleIndex: number,
    field: GridField,
  ) => void;
};

type Props = {
  item: Recipient;
  index: number;
  visibleIndex: number;
  active: boolean;
  checked: boolean;
  disabled: boolean;
  readonly: boolean;
  canSelectDocuments: boolean;
  documentCount: number;
  rowErrors: number;
  fieldErrors: Record<string, string>;
  columns: readonly (readonly [GridField, string])[];
  instanceId: string;
  inputs: Map<string, HTMLInputElement>;
  actions: RefObject<GridRowActions>;
};

/** Preserve every native row while reconciling only changed row values/state. */
export const RecipientGridRow = memo(
  function RecipientGridRow({
    item,
    index,
    visibleIndex,
    active,
    checked,
    disabled,
    readonly,
    canSelectDocuments,
    documentCount,
    rowErrors,
    fieldErrors,
    columns,
    instanceId,
    inputs,
    actions,
  }: Props) {
    const rowPrefix = `items.${index}.`;
    return (
      <tr
        data-recipient-id={item.id}
        className={[
          active ? "is-active" : "",
          checked ? "is-checked" : "",
          rowErrors ? "has-errors" : "",
        ]
          .filter(Boolean)
          .join(" ")}
      >
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
        {columns.map(([field, label], columnIndex) => {
          const path = `${rowPrefix}${field}`;
          const error = fieldErrors[path];
          const errorId = `${instanceId}-${item.id}-${field}-error`;
          const value =
            item[field] ||
            (field === "fullNameRu"
              ? item.fullNameKz
              : field === "positionRu"
                ? item.positionKz
                : "");
          return (
            <td
              key={field}
              className={columnIndex === 0 ? "recipient-grid-name" : undefined}
            >
              <input
                ref={(element) => {
                  const key = `${item.id}:${field}`;
                  if (element) inputs.set(key, element);
                  else inputs.delete(key);
                }}
                type="text"
                maxLength={
                  field === "personnelNumber" || field === "externalId"
                    ? 100
                    : 500
                }
                value={value}
                title={value || undefined}
                aria-label={`${label}, строка ${index + 1}`}
                aria-invalid={!!error}
                aria-describedby={error ? errorId : undefined}
                data-field-path={path}
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
              {error && (
                <small className="field-error" id={errorId}>
                  {error}
                </small>
              )}
              <TextQualityHint value={value} />
            </td>
          );
        })}
        <td className="recipient-grid-category-cell">
          <label className="recipient-grid-category">
            <span className="sr-only">
              Категория сотрудника, строка {index + 1}
            </span>
            <select
              aria-label={`Категория сотрудника, строка ${index + 1}`}
              data-field-path={`${rowPrefix}employeeCategory`}
              aria-invalid={!!fieldErrors[`${rowPrefix}employeeCategory`]}
              aria-describedby={
                fieldErrors[`${rowPrefix}employeeCategory`]
                  ? `${instanceId}-${item.id}-category-error`
                  : undefined
              }
              value={
                item.employeeCategory ||
                (item.assignments.some(
                  (assignment) =>
                    assignment.templateId === "biot-itr-certificate",
                )
                  ? "ITR"
                  : "WORKER")
              }
              disabled={disabled || readonly}
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
          </label>
          {fieldErrors[`${rowPrefix}employeeCategory`] && (
            <small
              className="field-error"
              id={`${instanceId}-${item.id}-category-error`}
            >
              {fieldErrors[`${rowPrefix}employeeCategory`]}
            </small>
          )}
        </td>
        <td className="recipient-grid-documents has-document-choices">
          <div
            className="recipient-document-labels"
            aria-label="Выбранные документы"
          >
            {[
              ...new Set(
                item.assignments.map((assignment) => assignment.templateId),
              ),
            ].map((templateId) => {
              const choice = documentChoices.find(
                (candidate) => candidate.templateId === templateId,
              );
              const count = item.assignments.filter(
                (assignment) => assignment.templateId === templateId,
              ).length;
              return (
                <span key={templateId} title={choice?.label}>
                  {choice?.shortLabel || templateId}
                  {count > 1 ? ` ×${count}` : ""}
                </span>
              );
            })}
            {item.assignments.some(
              (assignment) => assignment.protocolMode === "GROUP",
            ) && <span>Общий протокол</span>}
            {!documentCount && (
              <span className="recipient-document-empty">
                Документы не выбраны
              </span>
            )}
          </div>
          <div className="recipient-document-actions">
            {!readonly && canSelectDocuments && (
              <button
                type="button"
                disabled={disabled}
                onClick={() => actions.current.onDocuments?.(item.id)}
                aria-label={`Назначить обучение получателю ${index + 1}`}
              >
                Обучение
              </button>
            )}
          </div>
          {rowErrors > 0 && (
            <small className="recipient-grid-row-errors">
              Ошибок: {rowErrors}
            </small>
          )}
        </td>
        <td className="recipient-grid-actions">
          <div className="recipient-grid-row-actions">
            <button
              type="button"
              className="text-button recipient-grid-details-button"
              disabled={disabled}
              onClick={() => actions.current.onOpen(item.id)}
              aria-label={`Документы и даты получателя ${index + 1}`}
              title={`Документов: ${documentCount}. Открыть даты и детали`}
            >
              Детали <Icon name="chevron" size={14} />
            </button>
            {!readonly && (
              <button
                type="button"
                disabled={disabled}
                aria-label={`Удалить получателя ${index + 1}`}
                title="Удалить получателя"
                onClick={() => actions.current.onRemove(item.id)}
              >
                ×
              </button>
            )}
          </div>
        </td>
      </tr>
    );
  },
  (before, after) =>
    before.item === after.item &&
    before.index === after.index &&
    before.visibleIndex === after.visibleIndex &&
    before.active === after.active &&
    before.checked === after.checked &&
    before.disabled === after.disabled &&
    before.readonly === after.readonly &&
    before.canSelectDocuments === after.canSelectDocuments &&
    before.documentCount === after.documentCount &&
    before.rowErrors === after.rowErrors &&
    before.columns === after.columns &&
    before.instanceId === after.instanceId &&
    before.inputs === after.inputs &&
    before.actions === after.actions &&
    before.fieldErrors[`items.${before.index}.employeeCategory`] ===
      after.fieldErrors[`items.${after.index}.employeeCategory`] &&
    after.columns.every(
      ([field]) =>
        before.fieldErrors[`items.${before.index}.${field}`] ===
        after.fieldErrors[`items.${after.index}.${field}`],
    ),
);
