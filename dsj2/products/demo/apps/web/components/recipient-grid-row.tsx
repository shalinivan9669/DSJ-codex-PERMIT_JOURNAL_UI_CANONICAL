"use client";

import { memo, type KeyboardEvent, type RefObject } from "react";
import { Icon } from "@demo/ui";
import type { GridField } from "@/lib/grid-paste";
import type { Recipient } from "@/lib/types";
import type { RecipientGridProps } from "./recipient-grid";
import { TextQualityHint } from "./text-quality-hint";

export type GridRowActions = Pick<
  RecipientGridProps,
  "onEdit" | "onSelect" | "onOpen" | "onRemove" | "onPaste"
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
                value={item[field] || ""}
                title={item[field] || undefined}
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
              <TextQualityHint value={item[field] || ""} />
            </td>
          );
        })}
        <td className="recipient-grid-documents">
          <button
            type="button"
            disabled={disabled}
            onClick={() => actions.current.onOpen(item.id)}
            aria-label={`Документы и даты получателя ${index + 1}`}
            title="Открыть документы и даты"
          >
            {documentCount}
            <Icon name="chevron" size={14} />
          </button>
          {rowErrors > 0 && (
            <small className="recipient-grid-row-errors">
              Ошибок: {rowErrors}
            </small>
          )}
        </td>
        {!readonly && (
          <td className="recipient-grid-actions">
            <button
              type="button"
              disabled={disabled}
              aria-label={`Удалить получателя ${index + 1}`}
              title="Удалить получателя"
              onClick={() => actions.current.onRemove(item.id)}
            >
              ×
            </button>
          </td>
        )}
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
    before.documentCount === after.documentCount &&
    before.rowErrors === after.rowErrors &&
    before.columns === after.columns &&
    before.instanceId === after.instanceId &&
    before.inputs === after.inputs &&
    before.actions === after.actions &&
    after.columns.every(
      ([field]) =>
        before.fieldErrors[`items.${before.index}.${field}`] ===
        after.fieldErrors[`items.${after.index}.${field}`],
    ),
);
