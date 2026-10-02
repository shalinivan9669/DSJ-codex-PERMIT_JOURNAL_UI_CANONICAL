"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Icon } from "@demo/ui";
import {
  assignedDocumentTemplates,
  documentChoices,
} from "@/lib/document-selection";
import type { GridField } from "@/lib/grid-paste";
import type { RecipientGridProps } from "./recipient-grid";
import "./recipient-panels.css";

export type RecipientPanelsProps = Omit<
  RecipientGridProps,
  "selectedId" | "onSelect" | "onPaste"
> & {
  selectedId?: string;
  onSelect?: (id: string) => void;
  onPaste?: RecipientGridProps["onPaste"];
  fieldHints?: Record<string, string>;
  active?: boolean;
  showTrainingControls?: boolean;
};

const textFields = [
  ["fullNameRu", "ФИО"],
  ["positionRu", "Должность / профессия"],
] as const;
const employerFields = [
  ["workplaceRu", "Предприятие"],
  ["employerBin", "БИН предприятия"],
  ["employerAddressRu", "Адрес предприятия"],
] as const;
const employerFieldNames = new Set<string>(
  employerFields.map(([field]) => field),
);
const inlineFields = new Set([
  "fullNameRu",
  "positionRu",
  "employeeCategory",
  ...employerFieldNames,
]);

export function RecipientPanels({
  items,
  visibleItems,
  resolvedItems,
  checked,
  disabled,
  readonly,
  fieldErrors,
  fieldHints = {},
  onEdit,
  onSelect,
  onOpen,
  onDocuments,
  onChecked,
  onRemove,
  onPaste,
  onAdd,
  canAdd,
  active = true,
  showTrainingControls = true,
}: RecipientPanelsProps) {
  const instanceId = useId();
  const root = useRef<HTMLDivElement>(null);
  const fields = useRef(
    new Map<string, HTMLInputElement | HTMLSelectElement>(),
  );
  const pendingFocus = useRef<string | null>(null);
  const addingAfter = useRef<number | null>(null);
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(10);
  const [revealedId, setRevealedId] = useState<string | null>(null);
  const indexById = useMemo(
    () => new Map(items.map((item, index) => [item.id, index])),
    [items],
  );
  const resolvedById = useMemo(
    () => new Map((resolvedItems || items).map((item) => [item.id, item])),
    [resolvedItems, items],
  );
  const revealed =
    revealedId && !visibleItems.some((item) => item.id === revealedId)
      ? items.find((item) => item.id === revealedId)
      : undefined;
  const panelItems = revealed ? [revealed, ...visibleItems] : visibleItems;
  const pages = Math.max(1, Math.ceil(panelItems.length / pageSize));
  const currentPage = Math.min(page, pages - 1);
  const start = currentPage * pageSize;
  const pageItems = panelItems.slice(start, start + pageSize);
  const checkedIds = new Set(checked);

  useEffect(() => {
    if (!active) return;
    if (addingAfter.current === null || items.length <= addingAfter.current)
      return;
    addingAfter.current = null;
    const added = items[items.length - 1];
    if (!added) return;
    const visibleIndex = visibleItems.findIndex((item) => item.id === added.id);
    setRevealedId(visibleIndex < 0 ? added.id : null);
    setPage(visibleIndex < 0 ? 0 : Math.floor(visibleIndex / pageSize));
    pendingFocus.current = `${added.id}:fullNameRu`;
  }, [active, items, visibleItems, pageSize]);

  useEffect(() => {
    if (!active) {
      pendingFocus.current = null;
      return;
    }
    let focusFrame = 0;
    function focusField(event: Event) {
      if (!root.current?.getClientRects().length) return;
      const path = (event as CustomEvent<string>).detail;
      const match = /^items\.(\d+)\.(.+)$/.exec(path || "");
      if (!match) return;
      const item = items[Number(match[1])];
      if (!item) return;
      const resolved = resolvedById.get(item.id) || item;
      if (
        !inlineFields.has(match[2]) ||
        (employerFieldNames.has(match[2]) &&
          !assignedDocumentTemplates(resolved).has("biot-itr-protocol")) ||
        (match[2] === "workplaceRu" &&
          resolved.workplaceRu?.trim() &&
          !item.workplaceRu?.trim())
      ) {
        onOpen(item.id);
        return;
      }
      const visibleIndex = visibleItems.findIndex(
        (candidate) => candidate.id === item.id,
      );
      setRevealedId(visibleIndex < 0 ? item.id : null);
      setPage(visibleIndex < 0 ? 0 : Math.floor(visibleIndex / pageSize));
      const key = `${item.id}:${match[2]}`;
      pendingFocus.current = key;
      cancelAnimationFrame(focusFrame);
      focusFrame = requestAnimationFrame(() => {
        const field = fields.current.get(key);
        if (!field || !field.getClientRects().length) return;
        field.focus({ preventScroll: true });
        field.scrollIntoView({ block: "center", inline: "nearest" });
        pendingFocus.current = null;
      });
    }
    window.addEventListener("demo:focus-field", focusField);
    return () => {
      cancelAnimationFrame(focusFrame);
      window.removeEventListener("demo:focus-field", focusField);
    };
  }, [active, items, visibleItems, resolvedById, pageSize, onOpen]);

  useEffect(() => {
    if (!active || !pendingFocus.current) return;
    const frame = requestAnimationFrame(() => {
      const field = fields.current.get(pendingFocus.current || "");
      if (!field || !field.getClientRects().length) return;
      field.focus({ preventScroll: true });
      field.scrollIntoView({ block: "center", inline: "nearest" });
      pendingFocus.current = null;
    });
    return () => cancelAnimationFrame(frame);
  });

  function changePage(next: number) {
    setPage(next);
    pendingFocus.current = null;
    requestAnimationFrame(() =>
      root.current?.scrollIntoView({ block: "start" }),
    );
  }

  return (
    <div className="recipient-panels" ref={root}>
      {revealed && (
        <div className="recipient-panels-revealed" role="status">
          Показан получатель вне текущего фильтра.
          <button
            type="button"
            className="text-button"
            onClick={() => setRevealedId(null)}
          >
            Вернуться к отбору
          </button>
        </div>
      )}
      {pageItems.map((item) => {
        const index = indexById.get(item.id);
        if (index === undefined) return null;
        const prefix = `items.${index}.`;
        const resolved = resolvedById.get(item.id) || item;
        const templates = assignedDocumentTemplates(resolved);
        const showEmployerFields = templates.has("biot-itr-protocol");
        const showEnterpriseName =
          !resolved.workplaceRu?.trim() || !!item.workplaceRu?.trim();
        const rowInlineFields = new Set(inlineFields);
        if (!showEmployerFields)
          for (const field of employerFieldNames) rowInlineFields.delete(field);
        if (!showEnterpriseName) rowInlineFields.delete("workplaceRu");
        const documentSummary = [...templates]
          .map(
            (templateId) =>
              documentChoices.find((choice) => choice.templateId === templateId)
                ?.shortLabel || templateId,
          )
          .join(" · ");
        const moreErrors = [
          ...new Set(
            Object.entries(fieldErrors)
              .filter(
                ([path]) =>
                  path.startsWith(prefix) &&
                  !rowInlineFields.has(path.slice(prefix.length)),
              )
              .map(([, message]) => message),
          ),
        ];
        const moreHints = [
          ...new Set(
            Object.entries(fieldHints)
              .filter(
                ([path]) =>
                  path.startsWith(prefix) &&
                  !rowInlineFields.has(path.slice(prefix.length)) &&
                  !fieldErrors[path],
              )
              .map(([, message]) => message),
          ),
        ];
        const categoryPath = `${prefix}employeeCategory`;
        const categoryError = fieldErrors[categoryPath];
        const categoryHint = !categoryError && fieldHints[categoryPath];
        return (
          <fieldset
            className="recipient-panel"
            key={item.id}
            data-recipient-id={item.id}
            disabled={disabled}
          >
            <legend>Получатель {index + 1}</legend>
            {items.length > 1 && (
              <label className="recipient-panel-select">
                <input
                  type="checkbox"
                  checked={checkedIds.has(item.id)}
                  disabled={disabled || readonly}
                  onChange={(event) =>
                    onChecked(
                      event.target.checked
                        ? [...new Set([...checked, item.id])]
                        : checked.filter((id) => id !== item.id),
                    )
                  }
                />
                Выбрать получателя {index + 1}
              </label>
            )}
            <div className="recipient-panel-fields">
              {textFields.map(([field, label]) => {
                const path = `${prefix}${field}`;
                const error = fieldErrors[path];
                const hint = !error && fieldHints[path];
                const helpId = `${instanceId}-${item.id}-${field}-help`;
                const value =
                  item[field] ||
                  (field === "fullNameRu"
                    ? item.fullNameKz
                    : item.positionKz) ||
                  "";
                return (
                  <label key={field}>
                    {label}
                    <input
                      ref={(element) => {
                        const key = `${item.id}:${field}`;
                        if (element) fields.current.set(key, element);
                        else fields.current.delete(key);
                      }}
                      data-field-path={path}
                      aria-label={`${label}, получатель ${index + 1}`}
                      aria-invalid={!!error}
                      aria-describedby={error || hint ? helpId : undefined}
                      value={value}
                      maxLength={500}
                      readOnly={readonly}
                      autoComplete="off"
                      onFocus={() => onSelect?.(item.id)}
                      onChange={(event) =>
                        onEdit({ ...item, [field]: event.target.value })
                      }
                      onPaste={(event) => {
                        if (disabled || readonly || !onPaste) return;
                        const text = event.clipboardData.getData("text");
                        if (!/[\t\r\n]/.test(text)) return;
                        event.preventDefault();
                        onPaste({
                          startRow: index,
                          startField: field,
                          text,
                          columns: textFields.map(
                            ([column]) => column as GridField,
                          ),
                        });
                      }}
                    />
                    {(error || hint) && (
                      <small
                        id={helpId}
                        className={
                          error
                            ? "recipient-panel-error"
                            : "recipient-panel-hint"
                        }
                      >
                        {error || hint}
                      </small>
                    )}
                  </label>
                );
              })}
              {showEmployerFields &&
                employerFields.map(([field, label]) => {
                  if (field === "workplaceRu" && !showEnterpriseName)
                    return null;
                  const path = `${prefix}${field}`;
                  const error = fieldErrors[path];
                  const hint = !error && fieldHints[path];
                  const helpId = `${instanceId}-${item.id}-${field}-help`;
                  return (
                    <label key={field}>
                      {label}
                      <input
                        ref={(element) => {
                          const key = `${item.id}:${field}`;
                          if (element) fields.current.set(key, element);
                          else fields.current.delete(key);
                        }}
                        data-field-path={path}
                        aria-label={`${label}, получатель ${index + 1}`}
                        aria-invalid={!!error}
                        aria-describedby={error || hint ? helpId : undefined}
                        value={resolved[field] ?? item[field] ?? ""}
                        maxLength={field === "employerBin" ? 50 : 500}
                        inputMode={
                          field === "employerBin" ? "numeric" : undefined
                        }
                        readOnly={readonly}
                        autoComplete="off"
                        onFocus={() => onSelect?.(item.id)}
                        onChange={(event) =>
                          onEdit({ ...item, [field]: event.target.value })
                        }
                      />
                      {(error || hint) && (
                        <small
                          id={helpId}
                          className={
                            error
                              ? "recipient-panel-error"
                              : "recipient-panel-hint"
                          }
                        >
                          {error || hint}
                        </small>
                      )}
                    </label>
                  );
                })}
            </div>
            <div className="recipient-panel-training">
              <label className="recipient-panel-category">
                Категория
                <select
                  ref={(element) => {
                    const key = `${item.id}:employeeCategory`;
                    if (element) fields.current.set(key, element);
                    else fields.current.delete(key);
                  }}
                  data-field-path={categoryPath}
                  aria-label={`Категория, получатель ${index + 1}`}
                  aria-invalid={!!categoryError}
                  aria-describedby={
                    categoryError || categoryHint
                      ? `${instanceId}-${item.id}-category-help`
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
                  onFocus={() => onSelect?.(item.id)}
                  onChange={(event) =>
                    onEdit({
                      ...item,
                      employeeCategory: event.target.value as "WORKER" | "ITR",
                    })
                  }
                >
                  <option value="WORKER">Рабочий</option>
                  <option value="ITR">ИТР</option>
                </select>
                {(categoryError || categoryHint) && (
                  <small
                    id={`${instanceId}-${item.id}-category-help`}
                    className={
                      categoryError
                        ? "recipient-panel-error"
                        : "recipient-panel-hint"
                    }
                  >
                    {categoryError || categoryHint}
                  </small>
                )}
              </label>
              {showTrainingControls && (
                <div className="recipient-panel-documents">
                  <span className="recipient-panel-field-label">
                    Обучение и документы
                  </span>
                  <p
                    className={
                      templates.size
                        ? "recipient-panel-document-summary"
                        : "recipient-panel-hint"
                    }
                  >
                    {documentSummary ||
                      "Выберите обучение — документы добавятся комплектом."}
                  </p>
                  {!readonly && onDocuments && (
                    <button
                      type="button"
                      onClick={() => onDocuments(item.id)}
                      aria-label={`${templates.size ? "Изменить" : "Выбрать"} обучение получателя ${index + 1}`}
                    >
                      {templates.size
                        ? "Изменить обучение"
                        : "Выбрать обучение"}
                    </button>
                  )}
                  {moreErrors.length > 0 ? (
                    <p className="recipient-panel-error">
                      {moreErrors[0]}
                      {moreErrors.length > 1
                        ? ` Ещё замечаний: ${moreErrors.length - 1}.`
                        : ""}
                    </p>
                  ) : moreHints.length > 0 && templates.size > 0 ? (
                    <p className="recipient-panel-hint">
                      {moreHints[0]}
                      {moreHints.length > 1
                        ? ` Ещё уточнений: ${moreHints.length - 1}.`
                        : ""}
                    </p>
                  ) : null}
                </div>
              )}
            </div>
            <div className="recipient-panel-actions">
              <button
                type="button"
                className="text-button"
                onClick={() => onOpen(item.id)}
                aria-label={`Подробнее о получателе ${index + 1}`}
              >
                Подробнее <Icon name="chevron" size={14} />
              </button>
              {!readonly && (
                <button
                  type="button"
                  className="text-button recipient-panel-remove"
                  onClick={() => onRemove(item.id)}
                  aria-label={`Удалить получателя ${index + 1}`}
                >
                  Удалить
                </button>
              )}
            </div>
          </fieldset>
        );
      })}
      {!pageItems.length && (
        <p className="recipient-panel-hint" role="status">
          {items.length
            ? "По этим условиям никого нет. Измените поиск или фильтр."
            : "Добавьте первого получателя."}
        </p>
      )}
      <div className="recipient-panels-footer">
        {!readonly && (
          <button
            type="button"
            className="recipient-panel-add"
            disabled={disabled || !canAdd}
            onClick={() => {
              addingAfter.current = items.length;
              onAdd();
            }}
          >
            <Icon name="plus" size={17} />
            Добавить получателя
          </button>
        )}
        {panelItems.length > 1 && (
          <span className="recipient-panel-hint" role="status">
            Получатели {start + 1}–
            {Math.min(start + pageSize, panelItems.length)} из{" "}
            {panelItems.length}
            {checked.length ? ` · выбрано ${checked.length}` : ""}
          </span>
        )}
      </div>
      {panelItems.length > 10 && (
        <nav
          className="recipient-panels-pagination"
          aria-label="Страницы получателей"
        >
          <label>
            На странице
            <select
              value={pageSize}
              onChange={(event) => {
                setPageSize(Number(event.target.value));
                setPage(0);
              }}
            >
              <option value={10}>10</option>
              <option value={20}>20</option>
            </select>
          </label>
          <div>
            <button
              type="button"
              disabled={currentPage === 0}
              onClick={() => changePage(currentPage - 1)}
            >
              Назад
            </button>
            <span aria-live="polite">
              {currentPage + 1} из {pages}
            </span>
            <button
              type="button"
              disabled={currentPage + 1 >= pages}
              onClick={() => changePage(currentPage + 1)}
            >
              Далее
            </button>
          </div>
        </nav>
      )}
    </div>
  );
}
