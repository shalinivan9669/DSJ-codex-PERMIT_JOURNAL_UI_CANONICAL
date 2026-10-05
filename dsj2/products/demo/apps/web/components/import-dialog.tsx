"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { Modal, Notice } from "@demo/ui";
import {
  BIOT_CATEGORIES,
  initialImportScaffoldId,
  LIMITS,
  type BiotCategory,
  type TrainingEventInput,
} from "@demo/contracts";
import { joinEventAssignment } from "@/lib/event-assignment";
import { recipientForRequest, requestBundles } from "@/lib/request-bundles";
import {
  biotCategoriesForTemplate,
  defaultBiotCategory,
} from "@/lib/assignment-presets";
import { api, errorText, json } from "@/lib/api";
import {
  importFields,
  importApplyErrorText,
  recognizedImportMapping,
  importIssueText,
  mapImportRow,
  initialImportTemplate,
  importedSourceRows,
  validateMappedImportRow,
  applyImportCorrections,
  type ImportPreview,
  type SavedImportMapping,
} from "@/lib/imports";
import { templateLabels, type Assignment, type Draft } from "@/lib/types";
import { biotCategoryDescription } from "@/lib/validity-display";
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
  existingImportIds: _existingImportIds,
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
  const [savedMappings, setSavedMappings] = useState<SavedImportMapping[]>([]);
  const [mappingName, setMappingName] = useState("");
  const [mappingSaved, setMappingSaved] = useState(false);
  const [paste, setPaste] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [mapping, setMapping] = useState<string[]>([]);
  const [mappingColumns, setMappingColumns] = useState<string[]>([]);
  const [editMapping, setEditMapping] = useState(false);
  const [mappingSource, setMappingSource] = useState("");
  const [conflictingMappings, setConflictingMappings] = useState(false);
  const [problemsOnly, setProblemsOnly] = useState(false);
  const [visibleCount, setVisibleCount] = useState(50);
  const [corrections, setCorrections] = useState<
    Record<number, Record<number, string>>
  >({});
  const [excluded, setExcluded] = useState<number[]>([]);
  const bundle = Object.values(requestBundles).find(
    (choice) => choice.protocol === bundleEvent?.protocolTemplateId,
  );
  const [templateId, setTemplateId] = useState<Assignment["templateId"] | "">(
    existingDraft.trainingDefaults?.length
      ? ""
      : initialImportTemplate(bundleEvent),
  );
  const [useRequestTraining, setUseRequestTraining] = useState(
    !!existingDraft.trainingDefaults?.length,
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
  const errorRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (error) errorRef.current?.focus();
  }, [error]);
  useEffect(() => {
    setReconciliation(null);
    setOverwriteConfirmed(false);
  }, [
    mapping,
    excluded,
    templateId,
    biotCategory,
    blankMode,
    corrections,
    revisionMode,
    useRequestTraining,
    existingDraft.revision,
  ]);
  const workingPreview = useMemo(
    () =>
      preview && {
        ...preview,
        rows: preview.rows.map((row) => ({
          ...row,
          values: row.values.map(
            (value, column) => corrections[row.sourceRow]?.[column] ?? value,
          ),
        })),
      },
    [preview, corrections],
  );
  const alreadyAdded = importedSourceRows(
    existingDraft.items,
    preview?.importId || "",
  );
  const rowChecks = useMemo(
    () =>
      new Map(
        (workingPreview?.rows || []).map((row) => [
          row.sourceRow,
          validateMappedImportRow(
            workingPreview!,
            row,
            mapping,
            templateId,
            biotCategory,
          ),
        ]),
      ),
    [workingPreview, mapping, templateId, biotCategory],
  );
  useEffect(() => {
    let active = true;
    void api<{ items: SavedImportMapping[] }>("/imports/mappings")
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
        (await api<{ items: SavedImportMapping[] }>("/imports/mappings")).items,
      );
      setMappingSaved(true);
    } catch (caught) {
      setError(errorText(caught));
    } finally {
      setBusy(false);
    }
  }
  async function parse(sheet?: string, selectedFile?: File) {
    setBusy(true);
    setError("");
    try {
      const source =
        selectedFile ||
        file ||
        new File([paste], "вставка.tsv", { type: "text/tab-separated-values" });
      if (source.size > LIMITS.importBytes)
        throw new Error(
          "Файл больше 5 МиБ. Сохраните только таблицу значений без изображений и лишнего оформления; строки не обрезаны.",
        );
      const body = new FormData();
      body.set("file", source);
      if (sheet) body.set("sheet", sheet);
      const [result, rules] = await Promise.all([
        api<ImportPreview>("/imports/preview", { method: "POST", body }),
        api<{ items: SavedImportMapping[] }>("/imports/mappings"),
      ]);
      setSavedMappings(rules.items);
      setPreview(result);
      setCorrections({});
      setReconciliation(null);
      setOperationKey(crypto.randomUUID());
      const recognized = recognizedImportMapping(result.columns, rules.items);
      const preserveCurrent =
        !selectedFile &&
        mappingColumns.length === result.columns.length &&
        mappingColumns.every(
          (column, index) => column === result.columns[index],
        );
      setMapping(preserveCurrent ? mapping : recognized.mapping);
      setMappingSource(recognized.savedName);
      setConflictingMappings(recognized.conflictingSavedRules);
      setEditMapping(preserveCurrent ? editMapping : recognized.needsReview);
      setVisibleCount(50);
      setProblemsOnly(false);
      setMappingColumns(result.columns);
      setExcluded(
        result.rows
          .filter(
            (row) =>
              row.duplicate ||
              row.errors?.length ||
              (!revisionMode &&
                importedSourceRows(existingDraft.items, result.importId).has(
                  row.sourceRow,
                )),
          )
          .map((row) => row.sourceRow),
      );
    } catch (caught) {
      setError(errorText(caught));
    } finally {
      setBusy(false);
    }
  }
  async function apply() {
    if (!preview || !workingPreview) return;
    setBusy(true);
    setError("");
    try {
      const expectedRevision = await flush();
      const rows = workingPreview.rows
        .filter(
          (row) =>
            !excluded.includes(row.sourceRow) &&
            (revisionMode || !alreadyAdded.has(row.sourceRow)),
        )
        .map((row) => {
          const check = rowChecks.get(row.sourceRow);
          if (check?.issues.length)
            throw new Error(
              check.issues.map((issue) => issue.message).join(" "),
            );
          let mapped = applyImportCorrections(
            mapImportRow(
              workingPreview,
              row,
              mapping,
              templateId,
              biotCategory,
            ),
            mapping,
            corrections[row.sourceRow] || {},
          );
          if (!templateId && useRequestTraining && !revisionMode)
            mapped = recipientForRequest(existingDraft, mapped);
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
    workingPreview?.rows.filter(
      (row) =>
        !excluded.includes(row.sourceRow) &&
        (revisionMode || !alreadyAdded.has(row.sourceRow)),
    ) || [];
  const invalidSelected = selected.filter(
    (row) => rowChecks.get(row.sourceRow)?.issues.length,
  );
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
      [
        "Исходная строка",
        "Состояние",
        "Пояснение",
        ...preview.columns,
        ...preview.columns.map((column) => `${column} — переносимое значение`),
      ],
      ...preview.rows.map((row) => [
        row.sourceRow,
        !revisionMode && alreadyAdded.has(row.sourceRow)
          ? "Уже добавлена"
          : excluded.includes(row.sourceRow)
            ? "Исключена"
            : "Выбрана",
        rowChecks
          .get(row.sourceRow)
          ?.issues.map((issue) => issue.message)
          .join("; ") ||
          (row.duplicate ? "Возможный дубль" : "Готова к переносу"),
        ...row.values,
        ...(workingPreview?.rows.find(
          (item) => item.sourceRow === row.sourceRow,
        )?.values || row.values),
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
  const existingCount = existingDraft.items.length;
  const scaffoldId =
    existingDraft.importScaffoldId !== undefined
      ? existingDraft.importScaffoldId
      : initialImportScaffoldId(existingDraft);
  const replacesStarter = !revisionMode && selected.length > 0 && !!scaffoldId;
  const total = revisionMode
    ? reconciliation
      ? reconciliation.retainedTotal - exclusions.length
      : existingCount
    : existingCount - (replacesStarter ? 1 : 0) + selected.length;
  const mappedFields = mapping.filter(Boolean);
  const duplicateMapping = new Set(mappedFields).size !== mappedFields.length;
  const attentionRows =
    workingPreview?.rows.filter(
      (row) =>
        row.duplicate ||
        row.errors?.length ||
        rowChecks.get(row.sourceRow)?.issues.length ||
        rowChecks.get(row.sourceRow)?.incomplete,
    ) || [];
  const listedRows = problemsOnly ? attentionRows : workingPreview?.rows || [];
  const visibleRows = listedRows.slice(0, visibleCount);
  return (
    <Modal
      title="Импорт получателей"
      onClose={() => {
        if (!busy) onClose();
      }}
      wide
    >
      <p>
        Выберите XLSX / CSV или вставьте таблицу. Знакомые колонки распознаются
        автоматически; проверьте состав и отмеченные проблемы. Неполные строки
        сохраняются в черновик, номера ещё не назначаются.
      </p>
      {error && (
        <div ref={errorRef} tabIndex={-1}>
          <Notice>{error}</Notice>
        </div>
      )}
      {existingCount > 0 && (
        <label className="checkbox">
          <input
            type="checkbox"
            checked={revisionMode}
            disabled={busy}
            onChange={(e) => {
              setRevisionMode(e.target.checked);
              setReconciliation(null);
              setExcluded(
                e.target.checked
                  ? excluded.filter((row) => !alreadyAdded.has(row))
                  : [...new Set([...excluded, ...alreadyAdded])],
              );
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
              disabled={busy}
              onChange={(event) => {
                const selected = event.target.files?.[0] || null;
                setFile(selected);
                if (selected) void parse(undefined, selected);
              }}
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
              {busy ? "Читаем таблицу…" : "Проверить таблицу"}
            </button>
          </div>
        </>
      ) : (
        <>
          <div className="import-summary">
            <strong>Прочитано: {preview.total}</strong>
            <span>Выбрано: {selected.length}</span>
            <span>
              Исключено:{" "}
              {
                excluded.filter((row) => revisionMode || !alreadyAdded.has(row))
                  .length
              }
            </span>
            <span>В черновике: {existingCount}</span>
            {!revisionMode && (
              <span>Уже добавлено из источника: {alreadyAdded.size}</span>
            )}
          </div>
          {(preview.sheets?.length || 0) > 1 && (
            <label>
              Лист таблицы
              <select
                value={preview.sheet || preview.sheets![0]}
                disabled={busy}
                onChange={(event) => void parse(event.target.value)}
              >
                {preview.sheets!.map((sheet) => (
                  <option key={sheet} value={sheet}>
                    {sheet}
                  </option>
                ))}
              </select>
            </label>
          )}
          <p role="status">
            {mappingSource
              ? `Использовано сохранённое сопоставление «${mappingSource}».`
              : "Колонки распознаны по заголовкам."}{" "}
            {conflictingMappings
              ? "Подходящие сохранённые правила различаются: проверьте сопоставление."
              : editMapping
                ? "Проверьте нераспознанные и неоднозначные колонки."
                : "Повторно выбирать поля не требуется."}
          </p>
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
          <details className="import-document-options">
            <summary>
              {useRequestTraining && !templateId
                ? "Общие курсы заявки применяются ко всем новым строкам"
                : templateId
                  ? templateLabels[templateId]
                  : "Обучение можно выбрать для всего списка после импорта"}
            </summary>
            <div className="form-grid">
              {!!existingDraft.trainingDefaults?.length && (
                <label className="checkbox">
                  <input
                    type="checkbox"
                    checked={useRequestTraining && !templateId}
                    disabled={busy || revisionMode}
                    onChange={(event) => {
                      setUseRequestTraining(event.target.checked);
                      if (event.target.checked) {
                        setTemplateId("");
                        setBiotCategory(undefined);
                      }
                    }}
                  />
                  Применить общие курсы заявки к новым людям
                </label>
              )}
              <label>
                Документ для импортируемых строк
                <select
                  aria-label="Документ для импортируемых строк"
                  value={templateId}
                  onChange={(event) => {
                    const nextTemplate = event.target.value as
                      | Assignment["templateId"]
                      | "";
                    setTemplateId(nextTemplate);
                    setUseRequestTraining(false);
                    setBiotCategory(
                      nextTemplate
                        ? defaultBiotCategory(nextTemplate)
                        : undefined,
                    );
                  }}
                >
                  <option value="">
                    {useRequestTraining
                      ? "Общие курсы заявки"
                      : "Без обучения — выбрать после импорта"}
                  </option>
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
                    aria-label="Категория БиОТ для импортируемых строк"
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
                    {biotCategoryDescription(
                      biotCategory,
                      existingDraft.businessRuleVersion === "LIVE_V1",
                    )}{" "}
                    Если в таблице есть категория, используются значения строк.
                    Часы и даты из выбранных колонок сохраняются.
                  </small>
                </label>
              )}
            </div>
          </details>
          {replacesStarter && (
            <p className="muted">
              Нетронутая стартовая строка заменится импортируемым списком. Ранее
              заполненная и затем очищенная строка сохранится и будет
              учитываться в лимите.
            </p>
          )}
          {alreadyAdded.size > 0 && !revisionMode && (
            <Notice kind="info">
              Уже добавленные исходные строки сохранены без изменений. Можно
              дозагрузить оставшиеся строки; повтор не создаёт дублей.
            </Notice>
          )}
          {total > LIMITS.rows && (
            <Notice>
              После импорта получится {total} получателей. Технический объём
              одной заявки — {LIMITS.rows}. Строки не обрезаны; обратитесь к
              администратору центра.
            </Notice>
          )}
          {duplicateMapping && (
            <Notice>
              Одно поле назначено нескольким колонкам. Оставьте для каждого поля
              одну колонку.
            </Notice>
          )}
          {!!invalidSelected.length && (
            <Notice>
              В выбранных строках есть неприемлемые значения:{" "}
              {invalidSelected.map((row) => row.sourceRow).join(", ")}.
              Исправьте отмеченные ячейки или снимите выбор строки. Неполные
              допустимые строки можно переносить в черновик.
            </Notice>
          )}
          <div className="file-actions">
            <button
              className="text-button"
              onClick={() => setEditMapping(!editMapping)}
              aria-expanded={editMapping}
            >
              {editMapping
                ? "Скрыть настройки колонок"
                : "Изменить сопоставление колонок"}
            </button>
            {!!attentionRows.length && (
              <label className="checkbox">
                <input
                  type="checkbox"
                  checked={problemsOnly}
                  onChange={(event) => {
                    setProblemsOnly(event.target.checked);
                    setVisibleCount(50);
                  }}
                />
                Только требующие внимания ({attentionRows.length})
              </label>
            )}
            <span>
              Показано {visibleRows.length} из {listedRows.length}. В импорт
              входят все {selected.length} выбранных строк.
            </span>
          </div>
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
                      {editMapping ? (
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
                      ) : (
                        <small>
                          {importFields.find(
                            ([field]) => field === mapping[index],
                          )?.[1] || "Не импортировать колонку"}
                        </small>
                      )}
                    </th>
                  ))}
                  <th>Проверка</th>
                </tr>
              </thead>
              <tbody>
                {visibleRows.map((row) => (
                  <tr
                    key={row.sourceRow}
                    className={
                      excluded.includes(row.sourceRow) ||
                      (!revisionMode && alreadyAdded.has(row.sourceRow))
                        ? "excluded"
                        : ""
                    }
                  >
                    <td>
                      <label className="checkbox">
                        <input
                          type="checkbox"
                          aria-label={`Импортировать исходную строку ${row.sourceRow}`}
                          disabled={
                            busy ||
                            !!row.errors?.length ||
                            (!revisionMode && alreadyAdded.has(row.sourceRow))
                          }
                          checked={
                            !excluded.includes(row.sourceRow) &&
                            (revisionMode || !alreadyAdded.has(row.sourceRow))
                          }
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
                    {row.values.map((cell, index) => {
                      const issues =
                        rowChecks
                          .get(row.sourceRow)
                          ?.issues.filter((issue) => issue.column === index) ||
                        [];
                      const corrected = Object.hasOwn(
                        corrections[row.sourceRow] || {},
                        index,
                      );
                      const original =
                        preview.rows.find(
                          (source) => source.sourceRow === row.sourceRow,
                        )?.values[index] || "";
                      const inputId = `import-cell-${row.sourceRow}-${index}`;
                      return (
                        <td key={index}>
                          {(issues.length > 0 || corrected) &&
                          !row.errors?.length ? (
                            <>
                              <label htmlFor={inputId}>
                                {importFields.find(
                                  ([field]) => field === mapping[index],
                                )?.[1] || preview.columns[index]}
                              </label>
                              <input
                                id={inputId}
                                aria-label={`Исправленное значение, исходная строка ${row.sourceRow}, ${preview.columns[index]}`}
                                aria-invalid={issues.length > 0}
                                aria-describedby={
                                  issues.length ? `${inputId}-error` : undefined
                                }
                                value={cell}
                                disabled={
                                  busy ||
                                  (!revisionMode &&
                                    alreadyAdded.has(row.sourceRow))
                                }
                                onChange={(event) =>
                                  setCorrections((current) => ({
                                    ...current,
                                    [row.sourceRow]: {
                                      ...current[row.sourceRow],
                                      [index]: event.target.value,
                                    },
                                  }))
                                }
                              />
                              <small>
                                Исходное значение: {original || "пусто"}
                              </small>
                              {!!issues.length && (
                                <small
                                  id={`${inputId}-error`}
                                  className="field-error"
                                >
                                  {issues
                                    .map((issue) => issue.message)
                                    .join(" ")}
                                </small>
                              )}
                              {corrected && (
                                <button
                                  className="text-button"
                                  disabled={busy}
                                  onClick={() =>
                                    setCorrections((current) => {
                                      const next = {
                                        ...current,
                                        [row.sourceRow]: {
                                          ...current[row.sourceRow],
                                        },
                                      };
                                      delete next[row.sourceRow][index];
                                      return next;
                                    })
                                  }
                                >
                                  Вернуть исходное значение
                                </button>
                              )}
                            </>
                          ) : (
                            <>
                              {cell || <span className="muted">пусто</span>}
                              {!!mapping[index] &&
                                !row.errors?.length &&
                                (revisionMode ||
                                  !alreadyAdded.has(row.sourceRow)) && (
                                  <details>
                                    <summary>Исправить ячейку</summary>
                                    <button
                                      className="text-button"
                                      disabled={busy}
                                      onClick={() =>
                                        setCorrections((current) => ({
                                          ...current,
                                          [row.sourceRow]: {
                                            ...current[row.sourceRow],
                                            [index]: cell,
                                          },
                                        }))
                                      }
                                    >
                                      Редактировать значение
                                    </button>
                                  </details>
                                )}
                            </>
                          )}
                        </td>
                      );
                    })}
                    <td>
                      {!revisionMode && alreadyAdded.has(row.sourceRow)
                        ? "Уже добавлена · без изменений"
                        : rowChecks
                            .get(row.sourceRow)
                            ?.issues.map((issue) => issue.message)
                            .join("; ") ||
                          (row.duplicate
                            ? "Возможный дубль"
                            : rowChecks.get(row.sourceRow)?.incomplete
                              ? "Допустимая неполная строка · документы потребуют проверки"
                              : "Готово к переносу в черновик")}
                      {!revisionMode &&
                        !alreadyAdded.has(row.sourceRow) &&
                        !rowChecks.get(row.sourceRow)?.issues.length && (
                          <small>
                            {templateId
                              ? "Обучение из выбранного документа"
                              : useRequestTraining
                                ? "Общие курсы заявки"
                                : "Без обучения — общий выбор заявки не применяется"}
                          </small>
                        )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {visibleRows.length < listedRows.length && (
            <button
              className="text-button"
              onClick={() => setVisibleCount((count) => count + 50)}
            >
              Показать следующие{" "}
              {Math.min(50, listedRows.length - visibleRows.length)} строк
            </button>
          )}
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
                !!invalidSelected.length ||
                total > LIMITS.rows ||
                duplicateMapping ||
                !mappedFields.length ||
                (revisionMode &&
                  !!reconciliation &&
                  (!overwriteConfirmed ||
                    (exclusions.length > 0 && !exclusionReason.trim())))
              }
              onClick={() => void apply()}
            >
              {revisionMode
                ? busy
                  ? "Проверяем и сохраняем…"
                  : reconciliation
                    ? "Применить согласованные изменения"
                    : "Сравнить с текущим списком"
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
