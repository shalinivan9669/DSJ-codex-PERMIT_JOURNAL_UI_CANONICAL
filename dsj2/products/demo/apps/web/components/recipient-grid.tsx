"use client";

import { useEffect, useId, useMemo, useRef, type KeyboardEvent } from "react";
import { Icon } from "@demo/ui";
import { gridColumns, type GridField } from "@/lib/grid-paste";
import type { Recipient } from "@/lib/types";
import { RecipientGridRow, type GridRowActions } from "./recipient-grid-row";
import "./recipient-grid.css";

export type RecipientGridProps = {
  items: Recipient[];
  visibleItems: Recipient[];
  resolvedItems?: Recipient[];
  selectedId: string;
  checked: string[];
  disabled: boolean;
  readonly: boolean;
  fieldErrors: Record<string, string>;
  onEdit: (recipient: Recipient) => void;
  onSelect: (id: string) => void;
  onOpen: (id: string) => void;
  onDocuments?: (id: string) => void;
  onChecked: (ids: string[]) => void;
  onRemove: (id: string) => void;
  onPaste: (range: {
    startRow: number;
    startField: GridField;
    text: string;
    columns?: GridField[];
  }) => void;
  onAdd: () => void;
  canAdd: boolean;
};

const columns: readonly (readonly [GridField, string])[] = [
  ["fullNameRu", "ФИО"],
  ["positionRu", "Должность / профессия"],
];

export function RecipientGrid({
  items,
  visibleItems,
  resolvedItems,
  selectedId,
  checked,
  disabled,
  readonly,
  fieldErrors,
  onEdit,
  onSelect,
  onOpen,
  onDocuments,
  onChecked,
  onRemove,
  onPaste,
  onAdd,
  canAdd,
}: RecipientGridProps) {
  const inputs = useRef(new Map<string, HTMLInputElement>());
  const instanceId = useId();
  const helpId = `${instanceId}-help`;
  const indexById = useMemo(
    () => new Map(items.map((item, index) => [item.id, index])),
    [items],
  );
  const resolvedById = useMemo(
    () => new Map((resolvedItems || items).map((item) => [item.id, item])),
    [resolvedItems, items],
  );
  const errorCountByIndex = useMemo(() => {
    const counts = new Map<number, number>();
    for (const path of Object.keys(fieldErrors)) {
      const match = /^items\.(\d+)\./.exec(path);
      if (!match) continue;
      const index = Number(match[1]);
      counts.set(index, (counts.get(index) || 0) + 1);
    }
    return counts;
  }, [fieldErrors]);
  const checkedIds = new Set(checked);
  const visibleIds = new Set(visibleItems.map((item) => item.id));
  const selectedVisible = visibleItems.filter((item) =>
    checkedIds.has(item.id),
  ).length;

  useEffect(() => {
    let revealFrame = 0;
    let focusFrame = 0;
    function focusField(event: Event) {
      const path = (event as CustomEvent<string>).detail;
      const match = /^items\.(\d+)\.([^.]+)$/.exec(path || "");
      if (!match || !gridColumns.some(([field]) => field === match[2])) return;
      const item = items[Number(match[1])];
      if (!item) return;
      const field = match[2] as GridField;
      if (!columns.some(([column]) => column === field)) {
        onOpen(item.id);
        return;
      }
      cancelAnimationFrame(revealFrame);
      cancelAnimationFrame(focusFrame);
      revealFrame = requestAnimationFrame(() => {
        focusFrame = requestAnimationFrame(() => {
          const input = inputs.current.get(`${item.id}:${field}`);
          if (!input || !input.getClientRects().length) return;
          input.focus({ preventScroll: true });
          input.scrollIntoView({ block: "center", inline: "nearest" });
        });
      });
    }
    window.addEventListener("demo:focus-field", focusField);
    return () => {
      cancelAnimationFrame(revealFrame);
      cancelAnimationFrame(focusFrame);
      window.removeEventListener("demo:focus-field", focusField);
    };
  }, [items, onOpen]);

  function moveInColumn(
    event: KeyboardEvent<HTMLInputElement>,
    visibleIndex: number,
    field: GridField,
  ) {
    if (
      event.key !== "Enter" ||
      event.nativeEvent.isComposing ||
      event.nativeEvent.keyCode === 229 ||
      event.altKey ||
      event.ctrlKey ||
      event.metaKey
    )
      return;
    event.preventDefault();
    const next = visibleItems[visibleIndex + (event.shiftKey ? -1 : 1)];
    if (!next) return;
    const input = inputs.current.get(`${next.id}:${field}`);
    input?.focus({ preventScroll: true });
    input?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }

  const actions = useRef<GridRowActions>(null!);
  // Memoized rows read the current callbacks, selection and visible row order.
  actions.current = {
    onEdit,
    onSelect,
    onOpen,
    onDocuments,
    onRemove,
    onPaste,
    moveInColumn,
    toggleChecked: (id, value) =>
      onChecked(
        value
          ? [...checked, id]
          : checked.filter((existing) => existing !== id),
      ),
  };

  return (
    <div className="operator-grid recipient-grid-workspace">
      <div className="recipient-grid-options">
        <span className="recipient-grid-simple-hint">
          ФИО и должность вводятся один раз. Языковые уточнения — в деталях.
        </span>
        <span className="recipient-grid-keyboard-hint" id={helpId}>
          Tab — следующее поле · Enter — строка ниже · Shift + Enter — выше
        </span>
      </div>
      <div
        className="recipient-grid-scroll"
        role="region"
        aria-label="Список получателей"
        aria-describedby={helpId}
        tabIndex={0}
      >
        <table className="recipient-grid-table is-compact has-document-labels">
          <caption className="sr-only">
            Получатели заявки. Редактируйте данные и назначайте обучение в
            строках; индивидуальные даты открываются отдельно.
          </caption>
          <thead>
            <tr>
              <th scope="col" className="recipient-grid-selection">
                <input
                  type="checkbox"
                  aria-label="Выбрать видимых получателей"
                  disabled={!visibleItems.length || disabled}
                  checked={
                    visibleItems.length > 0 &&
                    selectedVisible === visibleItems.length
                  }
                  ref={(element) => {
                    if (element)
                      element.indeterminate =
                        selectedVisible > 0 &&
                        selectedVisible < visibleItems.length;
                  }}
                  onChange={(event) =>
                    onChecked(
                      event.target.checked
                        ? [...new Set([...checked, ...visibleIds])]
                        : checked.filter((id) => !visibleIds.has(id)),
                    )
                  }
                />
              </th>
              {columns.map(([field, label], columnIndex) => (
                <th
                  key={field}
                  scope="col"
                  className={
                    columnIndex === 0 ? "recipient-grid-name" : undefined
                  }
                >
                  {label}
                </th>
              ))}
              <th scope="col" className="recipient-grid-category-cell">
                Категория
              </th>
              <th
                scope="col"
                className="recipient-grid-documents has-document-choices"
              >
                Обучение
              </th>
              <th scope="col" className="recipient-grid-actions">
                Действия
              </th>
            </tr>
          </thead>
          <tbody>
            {visibleItems.map((item, visibleIndex) => {
              const index = indexById.get(item.id);
              if (index === undefined) return null;
              return (
                <RecipientGridRow
                  key={item.id}
                  item={item}
                  index={index}
                  visibleIndex={visibleIndex}
                  active={selectedId === item.id}
                  checked={checkedIds.has(item.id)}
                  disabled={disabled}
                  readonly={readonly}
                  canSelectDocuments={!!onDocuments}
                  documentCount={
                    (resolvedById.get(item.id) || item).assignments.length
                  }
                  rowErrors={errorCountByIndex.get(index) || 0}
                  fieldErrors={fieldErrors}
                  columns={columns}
                  instanceId={instanceId}
                  inputs={inputs.current}
                  actions={actions}
                />
              );
            })}
          </tbody>
        </table>
        {!visibleItems.length && (
          <div className="recipient-grid-empty" role="status">
            {items.length ? (
              <p>По этим условиям никого нет. Измените поиск или фильтр.</p>
            ) : (
              <>
                <p>
                  Добавьте первого получателя или вставьте список из таблицы.
                </p>
                {!readonly && (
                  <button disabled={disabled || !canAdd} onClick={onAdd}>
                    <Icon name="plus" /> Добавить получателя
                  </button>
                )}
              </>
            )}
          </div>
        )}
      </div>
      <div className="recipient-grid-footer">
        {!readonly && items.length > 0 && (
          <button
            type="button"
            className="text-button"
            disabled={disabled || !canAdd}
            onClick={onAdd}
          >
            <Icon name="plus" size={16} /> Добавить получателя
          </button>
        )}
        {!readonly && (
          <details className="recipient-grid-paste-help">
            <summary>Как вставить из Excel</summary>
            <p>
              Скопируйте прямоугольный диапазон и вставьте в первую нужную
              ячейку. Перед применением откроется проверка изменений.
            </p>
            <p>
              Вставка следует видимым колонкам:{" "}
              {columns.map(([, label]) => label).join(" → ")}. Языковые
              уточнения можно добавить в деталях получателя или при импорте.
            </p>
            <p>
              Для таблицы с другим порядком колонок используйте «Импорт /
              вставка».
            </p>
          </details>
        )}
      </div>
    </div>
  );
}
