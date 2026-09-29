"use client";

import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
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

type Language = "RU" | "KZ" | "BOTH";
const languageChoices: { value: Language; label: string }[] = [
  { value: "RU", label: "RU" },
  { value: "KZ", label: "KZ" },
  { value: "BOTH", label: "RU + KZ" },
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
  onChecked,
  onRemove,
  onPaste,
  onAdd,
  canAdd,
}: RecipientGridProps) {
  const [language, setLanguage] = useState<Language>("RU");
  const [showIdentifiers, setShowIdentifiers] = useState(false);
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
  const columns = useMemo(
    () =>
      gridColumns.filter(([field]) => {
        if (field === "personnelNumber" || field === "externalId")
          return showIdentifiers;
        return (
          language === "BOTH" ||
          (language === "RU" ? field.endsWith("Ru") : field.endsWith("Kz"))
        );
      }),
    [language, showIdentifiers],
  );

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
      if (field === "personnelNumber" || field === "externalId")
        setShowIdentifiers(true);
      else
        setLanguage((current) =>
          current === "BOTH" || field.endsWith(current === "RU" ? "Ru" : "Kz")
            ? current
            : "BOTH",
        );
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
  }, [items]);

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
        <div
          className="recipient-grid-language"
          role="group"
          aria-label="Язык колонок"
        >
          <span>Поля:</span>
          {languageChoices.map((choice) => (
            <button
              key={choice.value}
              type="button"
              aria-pressed={language === choice.value}
              onClick={() => setLanguage(choice.value)}
            >
              {choice.label}
            </button>
          ))}
        </div>
        <label className="recipient-grid-identifiers">
          <input
            type="checkbox"
            checked={showIdentifiers}
            onChange={(event) => setShowIdentifiers(event.target.checked)}
          />
          Табельный номер и ID
        </label>
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
        <table
          className={`recipient-grid-table${language === "BOTH" ? " is-bilingual" : ""}${showIdentifiers ? " has-identifiers" : ""}`}
        >
          <caption className="sr-only">
            Получатели заявки. Редактируйте данные в строках; документы и даты
            открываются отдельно для каждого человека.
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
              <th scope="col" className="recipient-grid-documents">
                Документы
              </th>
              {!readonly && (
                <th scope="col" className="recipient-grid-actions">
                  <span className="sr-only">Действия</span>
                </th>
              )}
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
              {columns.map(([, label]) => label).join(" → ")}. Для двух языков
              сначала включите «RU + KZ».
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
