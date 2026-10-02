"use client";
import { useEffect, useState } from "react";
import { Modal, Notice } from "@demo/ui";
import {
  BIOT_CATEGORIES,
  initialImportScaffoldId,
  LIMITS,
  type BiotCategory,
  type TrainingEventInput,
} from "@demo/contracts";
import { joinEventAssignment } from "@/lib/event-assignment";
import { requestBundles } from "@/lib/request-bundles";
import {
  biotCategoriesForTemplate,
  defaultBiotCategory,
} from "@/lib/assignment-presets";
import { api, errorText, json } from "@/lib/api";
import {
  importFields,
  importApplyErrorText,
  inferMapping,
  importIssueText,
  importRowIssueText,
  mapImportRow,
  initialImportTemplate,
  type ImportPreview,
} from "@/lib/imports";
import { templateLabels, type Assignment, type Draft } from "@/lib/types";
type Reconciliation = {
  retainedTotal: number;
  revision: number;
  importId: string;
  counts: Record<string, number>;
  rows: {
    sourceRow?: number;
    targetId?: string;
    category: "added" | "changed" | "unchanged" | "missing" | "ambiguous";
    changes: { field: string; oldValue: unknown; newValue: unknown }[];
    candidates: string[];
  }[];
};

export function ImportDialog({
  requestId,
  existingDraft,
  existingImportIds,
  bundleEvent,
  flush,
  onClose,
  onApplied,
}: {
  requestId: string;
  existingDraft: Draft;
  existingImportIds: string[];
  bundleEvent?: TrainingEventInput;
  flush: () => Promise<number>;
  onClose: () => void;
  onApplied: (draft: Draft) => void;
}) {
  type SavedMapping = {
    id: string;
    name: string;
    columns: string[];
    mapping: Record<string, string>;
  };
  const [savedMappings, setSavedMappings] = useState<SavedMapping[]>([]);
  const [mappingName, setMappingName] = useState("");
  const [mappingSaved, setMappingSaved] = useState(false);
  const [paste, setPaste] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [mapping, setMapping] = useState<string[]>([]);
  const [excluded, setExcluded] = useState<number[]>([]);
  const bundle = Object.values(requestBundles).find(
    (choice) => choice.protocol === bundleEvent?.protocolTemplateId,
  );
  const [templateId, setTemplateId] = useState<Assignment["templateId"] | "">(
    initialImportTemplate(bundleEvent),
  );
  const [biotCategory, setBiotCategory] = useState<BiotCategory | undefined>(
    bundleEvent?.commonFields.biotCategory,
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [revisionMode, setRevisionMode] = useState(false);
  const [blankMode, setBlankMode] = useState<"RETAIN" | "CLEAR">("RETAIN");
  const [reconciliation, setReconciliation] = useState<Reconciliation | null>(
    null,
  );
  const [exclusions, setExclusions] = useState<string[]>([]);
  const [exclusionReason, setExclusionReason] = useState("");
  const [overwriteConfirmed, setOverwriteConfirmed] = useState(false);
  const [operationKey, setOperationKey] = useState("");
  useEffect(() => {
    setReconciliation(null);
    setOverwriteConfirmed(false);
  }, [mapping, excluded, templateId, biotCategory, blankMode]);
  useEffect(() => {
    let active = true;
    void api<{ items: SavedMapping[] }>("/imports/mappings")
      .then((result) => {
        if (active) setSavedMappings(result.items);
      })
      .catch((caught) => {
        if (active) setError(errorText(caught));
      });
    return () => {
      active = false;
    };
  }, []);
  async function saveMapping() {
    if (!preview || !mappingName.trim()) return;
    setBusy(true);
    setError("");
    try {
      await api("/imports/mappings", {
        method: "POST",
        body: json({
          name: mappingName.trim(),
          columns: preview.columns,
          mapping: Object.fromEntries(
            preview.columns.flatMap((column, index) =>
              mapping[index] ? [[column, mapping[index]]] : [],
            ),
          ),
        }),
      });
      setSavedMappings(
        (await api<{ items: SavedMapping[] }>("/imports/mappings")).items,
      );
      setMappingSaved(true);
    } catch (caught) {
      setError(errorText(caught));
    } finally {
      setBusy(false);
    }
  }
  async function parse(sheet?: string) {
    setBusy(true);
    setError("");
    try {
      const source =
        file ||
        new File([paste], "вставка.tsv", { type: "text/tab-separated-values" });
      if (source.size > LIMITS.importBytes)
        throw new Error(
          "Файл больше 5 МБ. Разделите список на несколько файлов.",
        );
      const body = new FormData();
      body.set("file", source);
      if (sheet) body.set("sheet", sheet);
      const result = await api<ImportPreview>("/imports/preview", {
        method: "POST",
        body,
      });
      setPreview(result);
      setReconciliation(null);
      setOperationKey(crypto.randomUUID());
      setMapping(inferMapping(result.columns));
      setExcluded(
        result.rows
          .filter((row) => row.duplicate || row.errors?.length)
          .map((row) => row.sourceRow),
      );
    } catch (caught) {
      setError(errorText(caught));
    } finally {
      setBusy(false);
    }
  }
  async function apply() {
    if (!preview) return;
    setBusy(true);
    setError("");
    try {
      const expectedRevision = await flush();
      const rows = preview.rows
        .filter((row) => !excluded.includes(row.sourceRow))
        .map((row) => {
          const mapped = mapImportRow(
            preview,
            row,
            mapping,
            templateId,
            biotCategory,
          );
          if (
            bundleEvent &&
            bundle?.card === templateId &&
            bundleEvent.commonFields.biotCategory === biotCategory
          )
            mapped.assignments = mapped.assignments.map((assignment) =>
              assignment.biotCategory === bundleEvent.commonFields.biotCategory
                ? joinEventAssignment(assignment, bundleEvent.id)
                : assignment,
            );
          return mapped;
        });
      if (revisionMode) {
        const input = {
          expectedRevision,
          importId: preview.importId,
          rows,
          fieldMask: mapping.filter((field) =>
            [
              "employeeCategory",
              "fullNameEn",
              "positionEn",
              "workplaceEn",
              "departmentEn",
              "employerAddressEn",
              "fullNameRu",
              "fullNameKz",
              "positionRu",
              "positionKz",
              "workplaceRu",
              "workplaceKz",
              "departmentRu",
              "departmentKz",
              "employerBin",
              "employerAddressRu",
              "employerAddressKz",
              "personnelNumber",
              "externalId",
              "employerId",
            ].includes(field),
          ),
          blankMode,
        };
        if (!reconciliation) {
          setReconciliation(
            await api<Reconciliation>(
              `/print-requests/${requestId}/import-reconciliation/preview`,
              { method: "POST", body: json(input) },
            ),
          );
          return;
        }
        if (expectedRevision !== reconciliation.revision)
          throw new Error(
            "Черновик изменился после сравнения. Повторите сравнение актуальной редакции.",
          );
        const result = await api<Draft>(
          `/print-requests/${requestId}/import-reconciliation/apply`,
          {
            method: "POST",
            body: json({
              ...input,
              operationKey,
              selectedSourceRows: reconciliation.rows
                .filter(
                  (row) =>
                    row.sourceRow &&
                    row.category !== "ambiguous" &&
                    !excluded.includes(row.sourceRow),
                )
                .map((row) => row.sourceRow),
              excludeMissingIds: exclusions,
              exclusionReason,
            }),
          },
        );
        onApplied(result);
        return;
      }
      const result = await api<Draft>(`/print-requests/${requestId}/import`, {
        method: "POST",
        body: json({ expectedRevision, importId: preview.importId, rows }),
      });
      onApplied(result);
    } catch (caught) {
      setError(importApplyErrorText(caught, replacesStarter));
    } finally {
      setBusy(false);
    }
  }
  const selected =
    preview?.rows.filter((row) => !excluded.includes(row.sourceRow)) || [];
  function downloadReport() {
    if (!preview) return;
    const cell = (value: unknown) => {
      const text = String(value ?? "");
      return (
        '"' +
        (/^[=+@-]/.test(text) ? "'" : "") +
        text.replaceAll('"', '""') +
        '"'
      );
    };
    const rows = [
      ["Исходная строка", "Состояние", "Пояснение", ...preview.columns],
      ...preview.rows.map((row) => [
        row.sourceRow,
        excluded.includes(row.sourceRow) ? "Исключена" : "Выбрана",
        row.errors?.map(importRowIssueText).join("; ") ||
          (row.duplicate ? "Возможный дубль" : "Готова к переносу"),
        ...row.values,
      ]),
    ];
    const url = URL.createObjectURL(
      new Blob(
        ["\uFEFF" + rows.map((row) => row.map(cell).join(";")).join("\r\n")],
        { type: "text/csv;charset=utf-8" },
      ),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = "DEMO-import-report.csv";
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  const repeated = !!preview && existingImportIds.includes(preview.importId);
  const existingCount = existingDraft.items.length;
  const replacesStarter =
    !revisionMode &&
    !repeated &&
    selected.length > 0 &&
    !!initialImportScaffoldId(existingDraft);
  const total = revisionMode
    ? reconciliation
      ? reconciliation.retainedTotal - exclusions.length
      : existingCount
    : existingCount -
      (replacesStarter ? 1 : 0) +
      (repeated ? 0 : selected.length);
  const mappedFields = mapping.filter(Boolean);
  const duplicateMapping = new Set(mappedFields).size !== mappedFields.length;
  return (
    <Modal
      title="Импорт получателей"
      onClose={() => {
        if (!busy) onClose();
      }}
      wide
    >
      <p>
        Выберите XLSX / CSV или вставьте таблицу. Сначала сопоставьте колонки и
        проверьте строки. Неполные строки сохраняются в черновик, номера ещё не
        назначаются.
      </p>
      {error && <Notice>{error}</Notice>}
      {existingCount > 0 && (
        <label className="checkbox">
          <input
            type="checkbox"
            checked={revisionMode}
            disabled={busy}
            onChange={(e) => {
              setRevisionMode(e.target.checked);
              setReconciliation(null);
            }}
          />
          Это исправленный список для существующей заявки
        </label>
      )}
      {!preview ? (
        <>
          <label className="upload-zone">
            Табличный файл
            <input
              type="file"
              accept=".xlsx,.csv,.tsv"
              onChange={(event) => setFile(event.target.files?.[0] || null)}
            />
          </label>
          <label>
            Или вставьте таблицу с заголовками
            <textarea
              rows={7}
              disabled={!!file}
              value={paste}
              onChange={(event) => setPaste(event.target.value)}
              placeholder={
                "ФИО RU\tФИО KZ\tДолжность RU\nИванов Иван\tИванов Иван\tЭлектрик"
              }
            />
          </label>
          {file && (
            <button className="text-button" onClick={() => setFile(null)}>
              Убрать файл и использовать вставку
            </button>
          )}
          <div className="modal-actions">
            <button onClick={onClose}>Отмена</button>
            <button
              className="primary"
              disabled={busy || (!file && !paste.trim())}
              onClick={() => void parse()}
            >
              {busy ? "Читаем таблицу…" : "Перейти к сопоставлению"}
            </button>
          </div>
        </>
      ) : (
        <>
          <div className="import-summary">
            <strong>Прочитано: {preview.total}</strong>
            <span>Выбрано: {selected.length}</span>
            <span>Исключено: {excluded.length}</span>
            <span>В черновике: {existingCount}</span>
          </div>
          {!!preview.sheets?.length && (
            <label>
              Лист таблицы
              <select
                value={preview.sheet || preview.sheets[0]}
                disabled={busy}
                onChange={(event) => void parse(event.target.value)}
              >
                {preview.sheets.map((sheet) => (
                  <option key={sheet} value={sheet}>
                    {sheet}
                  </option>
                ))}
              </select>
            </label>
          )}
          {preview.errors?.map((message, index) => (
            <Notice key={index}>{importIssueText(message)}</Notice>
          ))}
          {revisionMode && (
            <>
              <label>
                Пустые ячейки в исправленном списке
                <select
                  value={blankMode}
                  disabled={busy}
                  onChange={(e) => {
                    setBlankMode(e.target.value as typeof blankMode);
                    setReconciliation(null);
                    setOverwriteConfirmed(false);
                  }}
                >
                  <option value="RETAIN">Сохранить прежние значения</option>
                  <option value="CLEAR">
                    Очистить значения в сопоставленных полях
                  </option>
                </select>
              </label>
              <p className="fine-print">
                Сопоставляем по ID человека, внешнему или табельному номеру.
                Совпадение ФИО не объединяет людей. Назначения и результаты
                сохраняются.
              </p>
            </>
          )}
          {reconciliation && (
            <section aria-label="Сравнение исправленного списка">
              <h3>Изменения редакции {reconciliation.revision}</h3>
              <div className="import-summary">
                {Object.entries(reconciliation.counts).map(([key, count]) => (
                  <span key={key}>
                    {(
                      {
                        added: "Новые",
                        changed: "Изменились",
                        unchanged: "Без изменений",
                        missing: "Нет в новом файле",
                        ambiguous: "Неоднозначные",
                      } as Record<string, string>
                    )[key] || key}
                    : {count}
                  </span>
                ))}
              </div>
              <div className="table-scroll bulk-preview">
                <table>
                  <thead>
                    <tr>
                      <th>Строка</th>
                      <th>Состояние</th>
                      <th>Изменения</th>
                      <th>Действие</th>
                    </tr>
                  </thead>
                  <tbody>
                    {reconciliation.rows.map((row, index) => (
                      <tr key={index}>
                        <td>{row.sourceRow || "—"}</td>
                        <td>
                          {
                            {
                              added: "Добавить",
                              changed: "Обновить",
                              unchanged: "Сохранить",
                              missing: "Отсутствует",
                              ambiguous: "Требует уточнения",
                            }[row.category]
                          }
                        </td>
                        <td>
                          {row.changes.map((c) => (
                            <div key={c.field}>
                              {importFields.find(
                                ([field]) => field === c.field,
                              )?.[1] || c.field}
                              : {String(c.oldValue ?? "пусто")} →{" "}
                              {String(c.newValue ?? "пусто")}
                            </div>
                          ))}
                        </td>
                        <td>
                          {row.category === "missing" && row.targetId ? (
                            <label className="checkbox">
                              <input
                                type="checkbox"
                                checked={exclusions.includes(row.targetId)}
                                onChange={(e) =>
                                  setExclusions(
                                    e.target.checked
                                      ? [...exclusions, row.targetId!]
                                      : exclusions.filter(
                                          (id) => id !== row.targetId,
                                        ),
                                  )
                                }
                              />
                              Исключить из черновика
                            </label>
                          ) : row.category === "ambiguous" ? (
                            "Не применяется: уточните устойчивый идентификатор"
                          ) : (
                            "По сравнению"
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {exclusions.length > 0 && (
                <label>
                  Причина исключения
                  <input
                    value={exclusionReason}
                    onChange={(e) => setExclusionReason(e.target.value)}
                  />
                </label>
              )}
              <label className="checkbox">
                <input
                  type="checkbox"
                  checked={overwriteConfirmed}
                  onChange={(e) => setOverwriteConfirmed(e.target.checked)}
                />
                Проверил изменения и сохраняемый состав
              </label>
              <button
                className="text-button"
                onClick={() => {
                  setReconciliation(null);
                  setOverwriteConfirmed(false);
                }}
              >
                Повторить сравнение
              </button>
            </section>
          )}
          <details className="import-mapping-options">
            <summary>Сохранённые правила сопоставления</summary>
            <div className="form-grid">
              <label>
                Сохранённое сопоставление
                <select
                  defaultValue=""
                  disabled={busy}
                  onChange={(event) => {
                    const selected = savedMappings.find(
                      (item) => item.id === event.target.value,
                    );
                    if (selected) {
                      setMapping(
                        preview.columns.map(
                          (column) => selected.mapping[column] || "",
                        ),
                      );
                      setMappingName(selected.name);
                      setMappingSaved(false);
                    }
                  }}
                >
                  <option value="">Выберите правило центра</option>
                  {savedMappings.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Название правила сопоставления
                <input
                  value={mappingName}
                  maxLength={100}
                  onChange={(event) => {
                    setMappingName(event.target.value);
                    setMappingSaved(false);
                  }}
                />
              </label>
            </div>
            <div className="file-actions">
              <button
                disabled={
                  busy ||
                  !mappingName.trim() ||
                  duplicateMapping ||
                  !mappedFields.length
                }
                onClick={() => void saveMapping()}
              >
                {savedMappings.some((item) => item.name === mappingName.trim())
                  ? "Обновить сохранённое правило"
                  : "Сохранить сопоставление"}
              </button>
              <button onClick={downloadReport}>Скачать отчёт по строкам</button>
            </div>
            {mappingSaved && (
              <Notice kind="success">
                Сопоставление сохранено для вашего центра.
              </Notice>
            )}
          </details>
          <div className="form-grid import-document-options">
            <label>
              Документ для импортируемых строк
              <select
                value={templateId}
                onChange={(event) => {
                  const nextTemplate = event.target.value as
                    | Assignment["templateId"]
                    | "";
                  setTemplateId(nextTemplate);
                  setBiotCategory(
                    nextTemplate
                      ? defaultBiotCategory(nextTemplate)
                      : undefined,
                  );
                }}
              >
                <option value="">Без обучения — выбрать после импорта</option>
                {Object.entries(templateLabels).map(([id, title]) => (
                  <option key={id} value={id}>
                    {title}
                  </option>
                ))}
              </select>
            </label>
            {biotCategory && templateId && (
              <label>
                Категория БиОТ для импортируемых строк
                <select
                  value={biotCategory}
                  onChange={(event) =>
                    setBiotCategory(event.target.value as BiotCategory)
                  }
                >
                  {biotCategoriesForTemplate(templateId).map((category) => (
                    <option key={category} value={category}>
                      {BIOT_CATEGORIES[category].label}
                    </option>
                  ))}
                </select>
                <small>
                  {BIOT_CATEGORIES[biotCategory].hint} Если в таблице есть
                  категория, используются значения строк. Часы и даты из
                  выбранных колонок сохраняются.
                </small>
              </label>
            )}
          </div>
          {replacesStarter && (
            <p className="muted">
              Нетронутая стартовая строка заменится импортируемым списком. Ранее
              заполненная и затем очищенная строка сохранится и будет
              учитываться в лимите.
            </p>
          )}
          {repeated && (
            <Notice kind="info">
              Этот файл уже добавлен в заявку. Повторные строки не будут
              созданы.
            </Notice>
          )}
          {total > LIMITS.rows && (
            <Notice>
              После импорта получится {total} получателей. Лимит — {LIMITS.rows}
              . Исключите лишние строки до применения.
            </Notice>
          )}
          {duplicateMapping && (
            <Notice>
              Одно поле назначено нескольким колонкам. Оставьте для каждого поля
              одну колонку.
            </Notice>
          )}
          <div
            className="table-scroll import-preview"
            role="region"
            aria-label="Предпросмотр импортируемых строк"
            tabIndex={0}
          >
            <table>
              <thead>
                <tr>
                  <th>Строка</th>
                  {preview.columns.map((column, index) => (
                    <th key={index}>
                      <span>{column || `Колонка ${index + 1}`}</span>
                      <select
                        aria-label={`Поле для колонки ${column || index + 1}`}
                        value={mapping[index]}
                        disabled={busy}
                        onChange={(event) => {
                          setReconciliation(null);
                          setOverwriteConfirmed(false);
                          setMapping(
                            mapping.map((field, i) =>
                              i === index ? event.target.value : field,
                            ),
                          );
                        }}
                      >
                        <option value="">Не импортировать колонку</option>
                        {importFields.map(([field, label]) => (
                          <option key={field} value={field}>
                            {label}
                          </option>
                        ))}
                      </select>
                    </th>
                  ))}
                  <th>Проверка</th>
                </tr>
              </thead>
              <tbody>
                {preview.rows.map((row) => (
                  <tr
                    key={row.sourceRow}
                    className={
                      excluded.includes(row.sourceRow) ? "excluded" : ""
                    }
                  >
                    <td>
                      <label className="checkbox">
                        <input
                          type="checkbox"
                          aria-label={`Импортировать исходную строку ${row.sourceRow}`}
                          disabled={!!row.errors?.length}
                          checked={!excluded.includes(row.sourceRow)}
                          onChange={(event) =>
                            setExcluded(
                              event.target.checked
                                ? excluded.filter(
                                    (value) => value !== row.sourceRow,
                                  )
                                : [...excluded, row.sourceRow],
                            )
                          }
                        />
                        {row.sourceRow}
                      </label>
                    </td>
                    {row.values.map((cell, index) => (
                      <td key={index}>
                        {cell || <span className="muted">пусто</span>}
                      </td>
                    ))}
                    <td>
                      {row.errors?.map(importRowIssueText).join("; ") ||
                        (row.duplicate
                          ? "Возможный дубль"
                          : "Готово к переносу")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="fine-print">
            Исходные номера строк и ведущие нули сохраняются. Формулы, макросы и
            внешние ссылки не исполняются. Повтор этого импорта не добавляет те
            же строки ещё раз.
          </p>
          <div className="modal-actions">
            <button
              disabled={busy}
              onClick={() => {
                setPreview(null);
                setError("");
              }}
            >
              Другой файл
            </button>
            <button
              className="primary"
              disabled={
                busy ||
                !selected.length ||
                total > LIMITS.rows ||
                duplicateMapping ||
                !mappedFields.length ||
                (revisionMode &&
                  !!reconciliation &&
                  (!overwriteConfirmed ||
                    (exclusions.length > 0 && !exclusionReason.trim())))
              }
              onClick={() =>
                repeated && !revisionMode ? onClose() : void apply()
              }
            >
              {revisionMode
                ? busy
                  ? "Проверяем и сохраняем…"
                  : reconciliation
                    ? "Применить согласованные изменения"
                    : "Сравнить с текущим списком"
                : repeated
                  ? "Закрыть повторный импорт"
                  : busy
                    ? "Сохраняем строки…"
                    : `Добавить ${selected.length} строк в черновик`}
            </button>
          </div>
        </>
      )}
    </Modal>
  );
}
