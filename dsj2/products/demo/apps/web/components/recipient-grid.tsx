"use client";

import { useEffect, useId, useMemo, useRef, type KeyboardEvent } from "react";
import { Icon } from "@demo/ui";
import type { GridField } from "@/lib/grid-paste";
import type { Recipient } from "@/lib/types";
import { recipientRowDate } from "@/lib/recipient-row-date";
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
  fieldHints?: Record<string, string>;
  onEdit: (recipient: Recipient) => void;
  onSelect: (id: string) => void;
  onOpen: (id: string) => void;
  onDocuments?: (id: string) => void;
  onPhoto?: (id: string) => void;
  photoTemplateIds?: readonly string[];
  liveRules?: boolean;
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
  active?: boolean;
};

const columns: readonly (readonly [GridField, string])[] = [
  ["fullNameRu", "ФИО"],
  ["positionRu", "Должность · RU"],
  ["positionKz", "Должность · KZ"],
];
const defaultPhotoTemplates = ["ptm-card", "pb-card", "ps-card"];
const noHints: Record<string, string> = {};

export function RecipientGrid({
  items,
  visibleItems,
  resolvedItems,
  selectedId,
  checked,
  disabled,
  readonly,
  fieldErrors,
  fieldHints = noHints,
  onEdit,
  onSelect,
  onOpen,
  onDocuments,
  onPhoto,
  photoTemplateIds = defaultPhotoTemplates,
  liveRules = true,
  onChecked,
  onRemove,
  onPaste,
  onAdd,
  canAdd,
  active = true,
}: RecipientGridProps) {
  const root = useRef<HTMLDivElement>(null);
  const inputs = useRef(
    new Map<string, HTMLInputElement | HTMLSelectElement>(),
  );
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
  const showPhotoColumn = (resolvedItems || items).some(
    (item) =>
      item.photoAssetId ||
      item.assignments.some((assignment) =>
        photoTemplateIds.includes(assignment.templateId),
      ),
  );
  const visibleIds = new Set(visibleItems.map((item) => item.id));
  const selectedVisible = visibleItems.filter((item) =>
    checkedIds.has(item.id),
  ).length;

  useEffect(() => {
    if (!active) return;
    let revealFrame = 0;
    let focusFrame = 0;
    function focusField(event: Event) {
      if (!root.current?.getClientRects().length) return;
      const path = (event as CustomEvent<string>).detail;
      const match = /^items\.(\d+)\.(.+)$/.exec(path || "");
      if (!match) return;
      const item = items[Number(match[1])];
      if (!item) return;
      const assignmentDate = /^assignments\.(\d+)\.documentDate$/.exec(
        match[2],
      );
      if (
        assignmentDate &&
        item.assignments[Number(assignmentDate[1])]?.templateId.endsWith(
          "-protocol",
        )
      ) {
        onOpen(item.id);
        return;
      }
      const field = assignmentDate ? "documentDate" : match[2];
      const inline =
        columns.some(([column]) => column === field) ||
        [
          "employeeCategory",
          "workplaceRu",
          "employerBin",
          "employerAddressRu",
        ].includes(field) ||
        (field === "documentDate" &&
          recipientRowDate(item, resolvedById.get(item.id) || item).kind ===
            "single");
      if (!inline) {
        onOpen(item.id);
        return;
      }
      cancelAnimationFrame(revealFrame);
      cancelAnimationFrame(focusFrame);
      revealFrame = requestAnimationFrame(() => {
        focusFrame = requestAnimationFrame(() => {
          const input = inputs.current.get(`${item.id}:${field}`);
          if (!input) {
            onOpen(item.id);
            return;
          }
          const details = input.closest("details");
          if (details) details.open = true;
          if (!input.getClientRects().length) return;
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
  }, [active, items, resolvedById, onOpen]);

  function moveInColumn(
    event: KeyboardEvent<HTMLInputElement | HTMLSelectElement>,
    visibleIndex: number,
    field: GridField | "employeeCategory" | "documentDate",
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
    onPhoto,
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
    <div className="operator-grid recipient-grid-workspace" ref={root}>
      <div
        className="recipient-grid-scroll"
        role="region"
        aria-label="Список получателей"
        aria-describedby={helpId}
        tabIndex={0}
      >
        <table
          className={`recipient-grid-table is-compact legacy-entry${showPhotoColumn ? " has-photo" : ""}`}
        >
          <caption className="sr-only">
            Получатели заявки. Редактируйте данные и назначайте обучение в
            строках; дата и языковые варианты доступны сразу.
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
              <th scope="col" className="recipient-grid-settings">
                Обучение / дата выдачи
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
              {showPhotoColumn && (
                <th scope="col" className="recipient-grid-photo">
                  Фото
                </th>
              )}
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
                  resolvedItem={resolvedById.get(item.id) || item}
                  index={index}
                  visibleIndex={visibleIndex}
                  active={selectedId === item.id}
                  checked={checkedIds.has(item.id)}
                  disabled={disabled}
                  readonly={readonly}
                  canSelectDocuments={!!onDocuments}
                  liveRules={liveRules}
                  showPhotoColumn={showPhotoColumn}
                  needsPhoto={(
                    resolvedById.get(item.id) || item
                  ).assignments.some((assignment) =>
                    photoTemplateIds.includes(assignment.templateId),
                  )}
                  documentCount={
                    (resolvedById.get(item.id) || item).assignments.length
                  }
                  rowErrors={errorCountByIndex.get(index) || 0}
                  fieldErrors={fieldErrors}
                  fieldHints={fieldHints}
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
        <span className="recipient-grid-keyboard-hint" id={helpId}>
          Tab — следующее поле · Enter — строка ниже · Shift + Enter — выше
        </span>
        {!readonly && items.length > 10 && (
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
              {columns.map(([, label]) => label).join(" → ")}.
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
