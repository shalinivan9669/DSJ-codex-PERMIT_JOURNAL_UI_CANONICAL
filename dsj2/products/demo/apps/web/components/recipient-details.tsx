"use client";
import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { Icon, Modal, Notice } from "@demo/ui";
import {
  BIOT_CATEGORIES,
  LIMITS,
  calculatedDateKeys,
  isBlankText,
  type BiotCategory,
} from "@demo/contracts";
import { api, errorText } from "@/lib/api";
import { TextQualityHint } from "./text-quality-hint";
import { RecipientRecord } from "./recipient-record";
import { DateCalculationStatus } from "./date-calculation-status";
import { TrainingDateSettings } from "./training-date-settings";
import {
  liveValidityDescription,
  biotCategoryDescription,
} from "@/lib/validity-display";
import { TranslationSuggestion } from "./translation-suggestion";
import { recipientPositionLabel } from "@/lib/recipient-course-context";
import {
  editTrainingAssignment,
  restoreTrainingAssignmentField,
} from "@/lib/training-assignment-edit";
import { biotCategoriesForTemplate } from "@/lib/assignment-presets";
import {
  newAssignment,
  templateLabels,
  type AppContext,
  type Assignment,
  type Recipient,
} from "@/lib/types";

type DocumentSection = "main" | "training" | "settings";
const documentSections: { id: DocumentSection; label: string }[] = [
  { id: "main", label: "Основное" },
  { id: "training", label: "Обучение и результат" },
  { id: "settings", label: "Настройки" },
];
function sectionForField(key: string): DocumentSection {
  if (["externalBasisNumber", "protocolMode", "trainingDateRule"].includes(key))
    return "settings";
  if (
    [
      "trainingSubject",
      "trainingSubjectKz",
      "psGeneralSubjectRu",
      "psGeneralSubjectKz",
      "psSpecialSubjectRu",
      "psSpecialSubjectKz",
      "resultKz",
      "professionRu",
      "professionKz",
      "psQualificationRu",
      "psQualificationKz",
      "trainingSubjectEn",
      "resultEn",
      "reasonEn",
      "educationEn",
      "biotIndustryEn",
      "biotKnowledgeResultEn",
      "biotProctoringResultEn",
      "biotNotesEn",
      "result",
      "outcome",
      "reason",
      "education",
      "biotCheckType",
      "biotIndustryRu",
      "biotIndustryKz",
      "biotKnowledgeResult",
      "biotProctoringResult",
      "biotUniqueNumber",
      "biotNotes",
    ].includes(key)
  )
    return "training";
  return "main";
}
function documentDateSummary(assignment: Assignment) {
  const date = (value: string) =>
    value ? value.split("-").reverse().join(".") : "не задана";
  return [
    assignment.trainingStart || assignment.trainingEnd
      ? `Обучение ${date(assignment.trainingStart)} — ${date(assignment.trainingEnd)}`
      : "Период обучения не задан",
    assignment.protocolDate
      ? `протокол ${date(assignment.protocolDate)}`
      : "дата протокола не задана",
    assignment.validityMode === "UNLIMITED"
      ? "бессрочно"
      : assignment.validUntil
        ? `действует до ${date(assignment.validUntil)}`
        : "",
  ]
    .filter(Boolean)
    .join(" · ");
}
function navigateTabs(event: KeyboardEvent<HTMLButtonElement>) {
  const tabs = Array.from(
    event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>(
      '[role="tab"]',
    ) || [],
  );
  const index = tabs.indexOf(event.currentTarget);
  let next: number;
  if (event.key === "ArrowRight") next = (index + 1) % tabs.length;
  else if (event.key === "ArrowLeft")
    next = (index - 1 + tabs.length) % tabs.length;
  else if (event.key === "Home") next = 0;
  else if (event.key === "End") next = tabs.length - 1;
  else return;
  event.preventDefault();
  tabs[next]?.focus();
  tabs[next]?.click();
}

export function RecipientDetails({
  recipient,
  disabled,
  onChange,
  context,
  rowIndex,
  fieldErrors,
  fieldHints = {},
  resolvedRecipient,
  provenance,
  liveRules = false,
  englishAppendix = false,
  requestEmployer,
  focusFieldPath,
  issuedAssignmentIds = [],
}: {
  recipient: Recipient;
  disabled: boolean;
  onChange: (recipient: Recipient) => void;
  context: AppContext;
  rowIndex: number;
  fieldErrors: Record<string, string>;
  fieldHints?: Record<string, string>;
  resolvedRecipient?: Recipient;
  provenance?: Record<string, Record<string, string>>;
  liveRules?: boolean;
  englishAppendix?: boolean;
  requestEmployer?: { id: string; nameRu: string; nameKz: string } | null;
  focusFieldPath?: string | null;
  issuedAssignmentIds?: readonly string[];
}) {
  const [photoOpen, setPhotoOpen] = useState(false);
  const [activeTab, setActiveTab] = useState("documents");
  const [documentTabs, setDocumentTabs] = useState<
    Record<string, DocumentSection>
  >({});
  const tabId = useId();
  const detailsRoot = useRef<HTMLDivElement>(null);
  const consumedFocusPath = useRef("");
  const employerException = !!(
    requestEmployer &&
    ((recipient.employerId && recipient.employerId !== requestEmployer.id) ||
      (recipient.workplaceRu &&
        recipient.workplaceRu !== requestEmployer.nameRu) ||
      (recipient.workplaceKz &&
        recipient.workplaceKz !== requestEmployer.nameKz))
  );
  const hasLanguageDetails = !!(recipient.fullNameKz || recipient.positionKz);
  useEffect(() => {
    let revealFrame = 0;
    let focusFrame = 0;
    function revealField(path: string) {
      if (!path?.startsWith(`items.${rowIndex}.`)) return;
      consumedFocusPath.current = `${recipient.id}:${path}`;
      const assignmentPath = path
        .slice(`items.${rowIndex}.`.length)
        .match(/^assignments\.(\d+)(?:\.(.+))?$/);
      setActiveTab(assignmentPath ? "documents" : "person");
      if (assignmentPath) {
        const assignment = recipient.assignments[Number(assignmentPath[1])];
        if (assignment)
          setDocumentTabs((current) => ({
            ...current,
            [assignment.id]: sectionForField(
              assignmentPath[2]?.split(".")[0] || "",
            ),
          }));
      }
      cancelAnimationFrame(revealFrame);
      cancelAnimationFrame(focusFrame);
      revealFrame = requestAnimationFrame(() => {
        focusFrame = requestAnimationFrame(() => {
          const input = detailsRoot.current?.querySelector<HTMLElement>(
            `[data-field-path="${CSS.escape(path)}"]`,
          );
          let ancestor = input?.parentElement;
          while (ancestor && ancestor !== detailsRoot.current) {
            if (ancestor instanceof HTMLDetailsElement) ancestor.open = true;
            ancestor = ancestor.parentElement;
          }
          input?.focus();
          input?.scrollIntoView({ block: "center" });
        });
      });
    }
    function focusField(event: Event) {
      revealField((event as CustomEvent<string>).detail);
    }
    window.addEventListener("demo:focus-field", focusField);
    // The selected row may render after the editor's focus event. Consume the
    // requested path after this recipient mounts, without refocusing on edits.
    if (
      focusFieldPath &&
      consumedFocusPath.current !== `${recipient.id}:${focusFieldPath}`
    )
      revealField(focusFieldPath);
    return () => {
      cancelAnimationFrame(revealFrame);
      cancelAnimationFrame(focusFrame);
      window.removeEventListener("demo:focus-field", focusField);
    };
  }, [rowIndex, recipient.id, recipient.assignments, focusFieldPath]);
  function field(index: number, key: string) {
    const path = `items.${rowIndex}.assignments.${index}.${key}`;
    const category = recipient.assignments[index].biotCategory;
    const labels: Record<string, string> = {
      templateId: "Форма документа",
      protocolMode: "Основание",
      documentDate: "Дата документа",
      validUntil: "Действителен до",
      trainingStart: "Начало обучения",
      trainingEnd: "Окончание обучения",
      protocolDate: "Дата протокола",
      trainingSubject: "Программа / тема обучения",
      trainingSubjectKz: "Программа / тема обучения · KZ",
      psGeneralSubjectRu: "Общепрофессиональный курс · RU",
      psGeneralSubjectKz: "Общепрофессиональный курс · KZ",
      psSpecialSubjectRu: "Специальный курс · RU",
      psSpecialSubjectKz: "Специальный курс · KZ",
      resultKz: "Текст результата / оценка · KZ",
      professionRu: "Профессия для ПС · RU",
      professionKz: "Профессия для ПС · KZ",
      psQualificationRu: "Присвоенная квалификация ПС · RU",
      psQualificationKz: "Присвоенная квалификация ПС · KZ",
      result: "Подтверждённый результат / оценка",
      outcome: "Исход обучения",
      "outcome.source": "Источник подтверждения результата",
      externalBasisNumber: "Внешний номер основания",
      reason:
        recipient.assignments[index].templateId === "ptm-protocol"
          ? "Причина проверки знаний"
          : "Причина / основание",
      education: "Образование",
      biotCategory: "Категория обучения БиОТ",
      hours: category
        ? BIOT_CATEGORIES[category].hoursLabel
        : "Объём обучения, часов",
      productionHours: "Производственное обучение, часов",
      biotCheckType: "Вид проверки знаний БиОТ",
      biotIndustryRu: "Отрасль специальных компетенций · RU",
      biotIndustryKz: "Отрасль специальных компетенций · KZ",
      biotKnowledgeResult: "Фактический результат проверки знаний",
      biotProctoringResult: "Фактический результат прокторинга",
      biotUniqueNumber: "Уникальный номер сертификата БиОТ",
      biotNotes: "Примечание к протоколу БиОТ",
    };
    return {
      "aria-label": labels[key],
      "data-field-path": path,
      "aria-invalid": !!fieldErrors[path],
      "aria-describedby":
        [
          fieldErrors[path] ? `error-${recipient.id}-${index}-${key}` : "",
          !fieldErrors[path] && fieldHints[path]
            ? `feedback-${recipient.id}-${index}-${key}`
            : "",
          (category && key === "hours") || key === "productionHours"
            ? `hint-${recipient.id}-${index}-${key}`
            : "",
          key === "reason" ? `hint-${recipient.id}-${index}-reason` : "",
        ]
          .filter(Boolean)
          .join(" ") || undefined,
    };
  }
  function fieldError(index: number, key: string) {
    const message =
      fieldErrors[`items.${rowIndex}.assignments.${index}.${key}`];
    const hint = fieldHints[`items.${rowIndex}.assignments.${index}.${key}`];
    return message || hint ? (
      <small
        className={message ? "field-error" : "field-hint"}
        id={`${message ? "error" : "feedback"}-${recipient.id}-${index}-${key}`}
      >
        {message || hint}
      </small>
    ) : null;
  }
  function changeAssignment(id: string, patch: Partial<Assignment>) {
    onChange(editTrainingAssignment(recipient, id, patch, liveRules));
  }
  function personField(key: string) {
    const path = `items.${rowIndex}.${key}`;
    return {
      "data-field-path": path,
      "aria-invalid": !!fieldErrors[path],
      "aria-describedby":
        fieldErrors[path] || fieldHints[path]
          ? `${fieldErrors[path] ? "error" : "feedback"}-${recipient.id}-${key}`
          : undefined,
    };
  }
  function personError(key: string) {
    const message = fieldErrors[`items.${rowIndex}.${key}`];
    const hint = fieldHints[`items.${rowIndex}.${key}`];
    return message || hint ? (
      <small
        className={message ? "field-error" : "field-hint"}
        id={`${message ? "error" : "feedback"}-${recipient.id}-${key}`}
      >
        {message || hint}
      </small>
    ) : null;
  }
  return (
    <div className="recipient-detail-content" ref={detailsRoot}>
      <div className="recipient-heading">
        <div>
          <small className="muted">Выбранный получатель</small>
          <h3>
            {recipient.fullNameRu || recipient.fullNameKz || "Новый получатель"}
          </h3>
        </div>
        {recipient.photoAssetId ? (
          <button
            disabled={disabled}
            className="photo-small"
            onClick={() => setPhotoOpen(true)}
            aria-label="Изменить фото получателя"
          >
            <img
              src={`/api/photos/${recipient.photoAssetId}`}
              alt="Фото получателя"
            />
          </button>
        ) : (
          <button
            disabled={disabled}
            className="photo-add"
            onClick={() => setPhotoOpen(true)}
          >
            <Icon name="person" />
            <span>Фото</span>
          </button>
        )}
      </div>
      <label>
        Категория сотрудника
        <select
          disabled={disabled}
          {...personField("employeeCategory")}
          value={
            recipient.employeeCategory ||
            (recipient.assignments.some(
              (assignment) => assignment.templateId === "biot-itr-certificate",
            )
              ? "ITR"
              : "WORKER")
          }
          onChange={(event) =>
            onChange({
              ...recipient,
              employeeCategory: event.target.value as "WORKER" | "ITR",
            })
          }
        >
          <option value="WORKER">Рабочий</option>
          <option value="ITR">ИТР</option>
        </select>
        {personError("employeeCategory")}
      </label>
      {englishAppendix && (
        <div className="english-fields">
          <p className="muted">
            Английская страница добавится к казахско-русскому документу.
            Проверьте перевод; ФИО укажите по документам сотрудника.
          </p>
          {(
            [
              ["fullNameEn", "ФИО латиницей · EN"],
              ["positionEn", "Должность · EN"],
              ["workplaceEn", "Место работы · EN"],
              ["employerAddressEn", "Адрес работодателя · EN"],
              ["departmentEn", "Подразделение · EN"],
            ] as const
          )
            .filter(
              ([key]) =>
                (key !== "employerAddressEn" && key !== "departmentEn") ||
                (key === "departmentEn"
                  ? !!(recipient.departmentRu || recipient.departmentKz)
                  : !!(
                      recipient.employerAddressRu || recipient.employerAddressKz
                    )),
            )
            .map(([key, label]) => (
              <label key={key}>
                {label}
                <input
                  disabled={disabled}
                  value={recipient[key] || ""}
                  {...personField(key)}
                  onChange={(event) =>
                    onChange({ ...recipient, [key]: event.target.value })
                  }
                />
                {personError(key)}
              </label>
            ))}
          <TranslationSuggestion
            source={recipient.positionRu}
            currentText={recipient.positionEn || ""}
            field="positionRu"
            target="en"
            disabled={disabled}
            onApply={(text) => onChange({ ...recipient, positionEn: text })}
          />
        </div>
      )}
      <div className="tabs" role="tablist" aria-label="Данные получателя">
        <button
          type="button"
          role="tab"
          id={`${tabId}-documents-tab`}
          aria-controls={`${tabId}-documents-panel`}
          tabIndex={activeTab === "documents" ? 0 : -1}
          onKeyDown={navigateTabs}
          aria-selected={activeTab === "documents"}
          onClick={() => setActiveTab("documents")}
        >
          Документы ({recipient.assignments.length})
        </button>
        <button
          type="button"
          role="tab"
          id={`${tabId}-person-tab`}
          aria-controls={`${tabId}-person-panel`}
          tabIndex={activeTab === "person" ? 0 : -1}
          onKeyDown={navigateTabs}
          aria-selected={activeTab === "person"}
          onClick={() => setActiveTab("person")}
        >
          Личные данные
        </button>
      </div>
      <div
        className="person-fields person-fields-grid"
        role="tabpanel"
        id={`${tabId}-person-panel`}
        aria-labelledby={`${tabId}-person-tab`}
        hidden={activeTab !== "person"}
      >
        <label>
          ФИО
          <input
            disabled={disabled}
            value={recipient.fullNameRu || recipient.fullNameKz}
            aria-label="ФИО"
            {...personField("fullNameRu")}
            onChange={(event) =>
              onChange({ ...recipient, fullNameRu: event.target.value })
            }
          />
          {personError("fullNameRu")}
          <TextQualityHint value={recipient.fullNameRu} />
        </label>
        <label>
          {recipientPositionLabel(recipient)}
          <input
            aria-label={recipientPositionLabel(recipient)}
            {...personField("positionRu")}
            disabled={disabled}
            value={recipient.positionRu || recipient.positionKz}
            onChange={(event) =>
              onChange({ ...recipient, positionRu: event.target.value })
            }
          />
          {personError("positionRu")}
          <TextQualityHint
            value={recipient.positionRu || recipient.positionKz}
          />
        </label>
        <details className="person-fields-wide">
          <summary>
            Казахский вариант
            {hasLanguageDetails
              ? " · есть сохранённые данные"
              : " · при необходимости"}
          </summary>
          <p className="fine-print">
            Основные формы всегда KZ/RU. Если отдельный вариант не указан,
            используется введённый текст без перевода. Сохранённые уточнения
            остаются самостоятельными и не меняются при редактировании общего
            ввода.
          </p>
          <div className="form-grid">
            {(
              [
                ["fullNameKz", "ФИО · KZ"],
                ["positionKz", `${recipientPositionLabel(recipient)} · KZ`],
              ] as const
            ).map(([key, label]) => (
              <label key={key}>
                {label}
                <input
                  aria-label={label}
                  {...personField(key)}
                  disabled={disabled}
                  value={recipient[key]}
                  placeholder="Если отличается от общего ввода"
                  onChange={(event) =>
                    onChange({ ...recipient, [key]: event.target.value })
                  }
                />
                {personError(key)}
                <TextQualityHint value={recipient[key]} />
                {key === "positionKz" && (
                  <TranslationSuggestion
                    source={recipient.positionRu}
                    currentText={recipient.positionKz}
                    field="positionRu"
                    target="kk"
                    disabled={disabled}
                    onApply={(text) =>
                      onChange({ ...recipient, positionKz: text })
                    }
                  />
                )}
              </label>
            ))}
          </div>
        </details>
        {requestEmployer && (
          <div className="person-fields-wide">
            <p className="fine-print">
              Работодатель заявки: {requestEmployer.nameRu}
            </p>
            {employerException && (
              <Notice>
                У этого получателя сохранены отдельные сведения работодателя:{" "}
                {recipient.workplaceRu ||
                  recipient.workplaceKz ||
                  "другая организация"}
                . Они сохранены как исключение. Проверьте их в деталях ниже.
              </Notice>
            )}
          </div>
        )}
        <details
          className="person-fields-wide employer-document-wording"
          open={employerException || undefined}
        >
          <summary>
            {requestEmployer
              ? "Исключение по работодателю и история"
              : "Работодатель, справочник и история"}
          </summary>
          {requestEmployer && (
            <p className="fine-print">
              Общий работодатель задаётся в заявке. Здесь сохранены только
              индивидуальные сведения и исключения из старых заявок.
            </p>
          )}
          <RecipientRecord
            recipient={recipient}
            disabled={disabled}
            onChange={onChange}
            rowIndex={rowIndex}
            fieldErrors={fieldErrors}
            fieldHints={fieldHints}
          />
          <p className="fine-print">
            Отдельные названия работодателя для документов · RU/KZ
          </p>
          <div className="form-grid">
            {[
              ["workplaceRu", "Место работы · RU"],
              ["workplaceKz", "Место работы · KZ"],
            ].map(([key, label]) => (
              <label key={key}>
                {label}
                <input
                  aria-label={label}
                  {...personField(key)}
                  disabled={disabled}
                  value={String(recipient[key as keyof Recipient] || "")}
                  onChange={(event) =>
                    onChange({ ...recipient, [key]: event.target.value })
                  }
                />
                {personError(key)}
              </label>
            ))}
          </div>
        </details>
        {recipient.assignments.some((assignment) =>
          assignment.templateId.startsWith("biot-"),
        ) && (
          <details className="person-fields-wide">
            <summary>Реквизиты работодателя для форм БиОТ</summary>
            <p className="muted">
              Если в заявке организации реквизиты работодателя не заполнены,
              используются сведения выбранного заказчика.
            </p>
            {[
              ["departmentRu", "Подразделение · RU"],
              ["departmentKz", "Подразделение · KZ"],
              ["employerBin", "БИН работодателя"],
              ["employerAddressRu", "Юридический адрес работодателя · RU"],
              ["employerAddressKz", "Юридический адрес работодателя · KZ"],
            ].map(([key, label]) => (
              <label key={key}>
                {label}
                <input
                  disabled={disabled}
                  value={String(recipient[key as keyof Recipient] || "")}
                  data-field-path={`items.${rowIndex}.${key}`}
                  aria-invalid={!!fieldErrors[`items.${rowIndex}.${key}`]}
                  aria-describedby={
                    fieldErrors[`items.${rowIndex}.${key}`]
                      ? `error-${recipient.id}-${key}`
                      : undefined
                  }
                  onChange={(event) =>
                    onChange({ ...recipient, [key]: event.target.value })
                  }
                />
                {fieldErrors[`items.${rowIndex}.${key}`] && (
                  <small
                    className="field-error"
                    id={`error-${recipient.id}-${key}`}
                  >
                    {fieldErrors[`items.${rowIndex}.${key}`]}
                  </small>
                )}
              </label>
            ))}
          </details>
        )}
        {recipient.photoAssetId && (
          <button
            className="text-button danger-text"
            disabled={disabled}
            onClick={() => onChange({ ...recipient, photoAssetId: null })}
          >
            Убрать фото из получателя
          </button>
        )}
      </div>
      <div
        className="assignment-list"
        role="tabpanel"
        id={`${tabId}-documents-panel`}
        aria-labelledby={`${tabId}-documents-tab`}
        hidden={activeTab !== "documents"}
      >
        {recipient.assignments.map((assignment, index) => {
          const documentDisabled =
            disabled || issuedAssignmentIds.includes(assignment.id);
          const activeSection = documentTabs[assignment.id] || "main";
          return (
            <details
              key={assignment.id}
              open={index === 0}
              data-assignment-id={assignment.id}
            >
              <summary
                data-field-path={`items.${rowIndex}.assignments.${index}`}
              >
                {templateLabels[assignment.templateId] || assignment.templateId}
                <span>
                  {resolvedRecipient?.assignments[index]?.documentDate ||
                    assignment.documentDate ||
                    "Дата не указана"}
                </span>
              </summary>
              <div className="assignment-fields">
                {issuedAssignmentIds.includes(assignment.id) && (
                  <p className="fine-print">
                    Это назначение оформлено. Его данные защищены; изменение
                    выданного документа доступно через явное исправление.
                  </p>
                )}
                <div
                  className="tabs assignment-section-tabs"
                  role="tablist"
                  aria-label={`Разделы документа ${index + 1}`}
                >
                  {documentSections.map((section) => {
                    const errors = Object.keys(fieldErrors).filter(
                      (path) =>
                        path.startsWith(
                          `items.${rowIndex}.assignments.${index}.`,
                        ) && sectionForField(path.split(".")[4]) === section.id,
                    ).length;
                    return (
                      <button
                        key={section.id}
                        type="button"
                        role="tab"
                        id={`${tabId}-${assignment.id}-${section.id}-tab`}
                        aria-controls={`${tabId}-${assignment.id}-${section.id}-panel`}
                        aria-selected={activeSection === section.id}
                        tabIndex={activeSection === section.id ? 0 : -1}
                        onKeyDown={navigateTabs}
                        onClick={() =>
                          setDocumentTabs((current) => ({
                            ...current,
                            [assignment.id]: section.id,
                          }))
                        }
                      >
                        {section.label}
                        {errors > 0 && (
                          <span
                            className="tab-error-count"
                            aria-label={`Ошибок: ${errors}`}
                          >
                            {errors}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
                <div
                  className="assignment-section"
                  data-assignment-section="main"
                  role="tabpanel"
                  id={`${tabId}-${assignment.id}-main-panel`}
                  aria-labelledby={`${tabId}-${assignment.id}-main-tab`}
                  hidden={activeSection !== "main"}
                >
                  <label>
                    Форма документа
                    <select
                      {...field(index, "templateId")}
                      disabled={documentDisabled || liveRules}
                      value={assignment.templateId}
                      onChange={(event) =>
                        changeAssignment(assignment.id, {
                          templateId: event.target
                            .value as Assignment["templateId"],
                          ...(event.target.value.endsWith("-protocol")
                            ? { protocolMode: "INDIVIDUAL" as const }
                            : {}),
                        })
                      }
                    >
                      {Object.entries(templateLabels).map(([id, name]) => (
                        <option key={id} value={id}>
                          {name}
                        </option>
                      ))}
                    </select>
                    {fieldError(index, "templateId")}
                  </label>
                  {assignment.templateId.startsWith("biot-") && (
                    <label>
                      Категория обучения БиОТ
                      <select
                        {...field(index, "biotCategory")}
                        disabled={documentDisabled}
                        value={
                          (resolvedRecipient?.assignments[index] || assignment)
                            .biotCategory || ""
                        }
                        onChange={(event) =>
                          changeAssignment(assignment.id, {
                            biotCategory: event.target.value as BiotCategory,
                          })
                        }
                      >
                        {!assignment.biotCategory && (
                          <option value="" disabled>
                            Выберите категорию
                          </option>
                        )}
                        {biotCategoriesForTemplate(assignment.templateId).map(
                          (category) => (
                            <option key={category} value={category}>
                              {BIOT_CATEGORIES[category].label}
                            </option>
                          ),
                        )}
                      </select>
                      {fieldError(index, "biotCategory")}
                      {assignment.biotCategory &&
                        (BIOT_CATEGORIES[assignment.biotCategory]
                          .requiresExternalCertificate ? (
                          <Notice kind="info">
                            {biotCategoryDescription(
                              assignment.biotCategory,
                              liveRules,
                            )}
                          </Notice>
                        ) : (
                          <small>
                            {biotCategoryDescription(
                              assignment.biotCategory,
                              liveRules,
                            )}
                          </small>
                        ))}
                    </label>
                  )}
                  <div className="form-grid compact">
                    <label>
                      Дата документа
                      <input
                        {...field(index, "documentDate")}
                        type="date"
                        disabled={documentDisabled}
                        value={
                          (resolvedRecipient?.assignments[index] || assignment)
                            .documentDate
                        }
                        onChange={(event) =>
                          changeAssignment(assignment.id, {
                            documentDate: event.target.value,
                          })
                        }
                      />
                      {fieldError(index, "documentDate")}
                    </label>
                  </div>
                  <details className="document-date-details">
                    <summary>
                      <span>Период обучения, протокол и срок действия</span>
                      <small>
                        {documentDateSummary(
                          resolvedRecipient?.assignments[index] || assignment,
                        )}
                      </small>
                      {[
                        "trainingStart",
                        "trainingEnd",
                        "protocolDate",
                        "validUntil",
                      ].some(
                        (key) =>
                          fieldErrors[
                            `items.${rowIndex}.assignments.${index}.${key}`
                          ],
                      ) && (
                        <span className="field-error">
                          Есть незаполненные или неверные даты
                        </span>
                      )}
                    </summary>
                    <div className="form-grid compact">
                      <label>
                        Действителен до
                        <input
                          {...field(index, "validUntil")}
                          type="date"
                          disabled={
                            documentDisabled ||
                            assignment.validityMode === "UNLIMITED"
                          }
                          value={
                            (
                              resolvedRecipient?.assignments[index] ||
                              assignment
                            ).validUntil
                          }
                          onChange={(event) =>
                            changeAssignment(assignment.id, {
                              validUntil: event.target.value,
                            })
                          }
                        />
                        {fieldError(index, "validUntil")}
                        {liveRules && (
                          <small>
                            {liveValidityDescription(recipient, assignment)}
                          </small>
                        )}
                        {!liveRules &&
                          assignment.validityMode === "UNLIMITED" && (
                            <small>
                              ПС — бессрочно. Дата окончания не указывается.
                            </small>
                          )}
                        {!liveRules &&
                          assignment.biotCategory &&
                          BIOT_CATEGORIES[assignment.biotCategory]
                            .validityYears && (
                            <small>
                              Срок по категории:{" "}
                              {BIOT_CATEGORIES[assignment.biotCategory]
                                .validityYears === 1
                                ? "1 год"
                                : "3 года"}{" "}
                              от даты документа. Введённая вручную дата
                              сохраняется.
                            </small>
                          )}
                      </label>
                      <label>
                        Начало обучения
                        <input
                          {...field(index, "trainingStart")}
                          type="date"
                          disabled={documentDisabled}
                          value={
                            (
                              resolvedRecipient?.assignments[index] ||
                              assignment
                            ).trainingStart
                          }
                          onChange={(event) =>
                            changeAssignment(assignment.id, {
                              trainingStart: event.target.value,
                            })
                          }
                        />
                        {fieldError(index, "trainingStart")}
                      </label>
                      <label>
                        Окончание обучения
                        <input
                          {...field(index, "trainingEnd")}
                          type="date"
                          disabled={documentDisabled}
                          value={
                            (
                              resolvedRecipient?.assignments[index] ||
                              assignment
                            ).trainingEnd
                          }
                          onChange={(event) =>
                            changeAssignment(assignment.id, {
                              trainingEnd: event.target.value,
                            })
                          }
                        />
                        {fieldError(index, "trainingEnd")}
                      </label>
                      <label>
                        Дата протокола
                        <input
                          {...field(index, "protocolDate")}
                          type="date"
                          disabled={documentDisabled}
                          value={
                            (
                              resolvedRecipient?.assignments[index] ||
                              assignment
                            ).protocolDate
                          }
                          onChange={(event) =>
                            changeAssignment(assignment.id, {
                              protocolDate: event.target.value,
                            })
                          }
                        />
                        {fieldError(index, "protocolDate")}
                      </label>
                    </div>
                    <details className="assignment-help">
                      <summary>Расчёт дат и пояснения</summary>
                      <DateCalculationStatus
                        forceValidity={liveRules}
                        validityDescription={liveValidityDescription(
                          recipient,
                          assignment,
                        )}
                        values={
                          resolvedRecipient?.assignments[index] || assignment
                        }
                        rule={
                          (resolvedRecipient?.assignments[index] || assignment)
                            .trainingDateRule
                        }
                        origins={
                          provenance?.[`${recipient.id}:${assignment.id}`] ||
                          assignment.fieldOrigins
                        }
                        disabled={documentDisabled}
                        restoreKeys={
                          assignment.protocolMode === "GROUP"
                            ? calculatedDateKeys.filter((key) =>
                                ["MANUAL", "IMPORTED", "CLEARED"].includes(
                                  provenance?.[
                                    `${recipient.id}:${assignment.id}`
                                  ]?.[key] ||
                                    assignment.fieldOrigins?.[key] ||
                                    "",
                                ),
                              )
                            : undefined
                        }
                        onRestore={(key) =>
                          onChange(
                            restoreTrainingAssignmentField(
                              recipient,
                              assignment.id,
                              key,
                              liveRules,
                            ),
                          )
                        }
                      />
                    </details>
                  </details>
                  <div className="form-grid compact">
                    <label>
                      {assignment.biotCategory
                        ? BIOT_CATEGORIES[assignment.biotCategory].hoursLabel
                        : "Объём обучения, часов"}
                      <input
                        {...field(index, "hours")}
                        inputMode="decimal"
                        disabled={documentDisabled}
                        value={
                          (resolvedRecipient?.assignments[index] || assignment)
                            .hours
                        }
                        onChange={(event) =>
                          changeAssignment(assignment.id, {
                            hours: event.target.value,
                          })
                        }
                      />
                      {fieldError(index, "hours")}
                      {assignment.biotCategory && (
                        <small id={`hint-${recipient.id}-${index}-hours`}>
                          {BIOT_CATEGORIES[assignment.biotCategory].hoursLabel}:
                          не менее{" "}
                          {
                            BIOT_CATEGORIES[assignment.biotCategory]
                              .minimumHours
                          }{" "}
                          ч. Укажите фактический объём.
                        </small>
                      )}
                    </label>
                    {((assignment.biotCategory &&
                      BIOT_CATEGORIES[assignment.biotCategory]
                        .minimumProductionHours) ||
                      assignment.productionHours) && (
                      <label>
                        Производственное обучение, часов
                        <input
                          {...field(index, "productionHours")}
                          inputMode="decimal"
                          disabled={documentDisabled}
                          value={
                            (
                              resolvedRecipient?.assignments[index] ||
                              assignment
                            ).productionHours || ""
                          }
                          onChange={(event) =>
                            changeAssignment(assignment.id, {
                              productionHours: event.target.value,
                            })
                          }
                        />
                        {fieldError(index, "productionHours")}
                        <small
                          id={`hint-${recipient.id}-${index}-productionHours`}
                        >
                          {assignment.biotCategory &&
                          BIOT_CATEGORIES[assignment.biotCategory]
                            .minimumProductionHours
                            ? `Не менее ${BIOT_CATEGORIES[assignment.biotCategory].minimumProductionHours} часов производственного обучения. Учитываются отдельно от академических часов теории.`
                            : "Укажите фактический объём производственного обучения отдельно от теории."}
                        </small>
                      </label>
                    )}
                  </div>
                </div>
                <div
                  className="assignment-section assignment-section-grid"
                  data-assignment-section="training"
                  role="tabpanel"
                  id={`${tabId}-${assignment.id}-training-panel`}
                  aria-labelledby={`${tabId}-${assignment.id}-training-tab`}
                  hidden={activeSection !== "training"}
                >
                  {(assignment.biotCategory === "WORKER" ||
                    assignment.templateId === "biot-itr-protocol") && (
                    <label>
                      Вид проверки знаний БиОТ
                      <select
                        {...field(index, "biotCheckType")}
                        disabled={documentDisabled}
                        value={
                          (resolvedRecipient?.assignments[index] || assignment)
                            .biotCheckType || ""
                        }
                        onChange={(event) =>
                          changeAssignment(assignment.id, {
                            biotCheckType: event.target
                              .value as Assignment["biotCheckType"],
                          })
                        }
                      >
                        {!assignment.biotCheckType && (
                          <option value="" disabled>
                            Выберите вид проверки
                          </option>
                        )}
                        <option value="PERIODIC">Периодическая</option>
                        <option value="REPEAT">Повторная</option>
                      </select>
                      {fieldError(index, "biotCheckType")}
                    </label>
                  )}
                  {assignment.biotCategory &&
                    BIOT_CATEGORIES[assignment.biotCategory].program ===
                      "SPECIAL" && (
                      <div className="form-grid compact">
                        {[
                          [
                            "biotIndustryRu",
                            "Отрасль специальных компетенций · RU",
                          ],
                          [
                            "biotIndustryKz",
                            "Отрасль специальных компетенций · KZ",
                          ],
                        ].map(([key, label]) => (
                          <label key={key}>
                            {label}
                            <input
                              {...field(index, key)}
                              disabled={documentDisabled}
                              value={String(
                                assignment[key as keyof Assignment] || "",
                              )}
                              onChange={(event) =>
                                changeAssignment(assignment.id, {
                                  [key]: event.target.value,
                                })
                              }
                            />
                            {fieldError(index, key)}
                          </label>
                        ))}
                      </div>
                    )}
                  {assignment.templateId === "biot-itr-protocol" && (
                    <>
                      {[
                        [
                          "biotKnowledgeResult",
                          "Фактический результат проверки знаний",
                        ],
                        [
                          "biotProctoringResult",
                          "Фактический результат прокторинга",
                        ],
                        [
                          "biotUniqueNumber",
                          "Уникальный номер сертификата БиОТ",
                        ],
                      ].map(([key, label]) => (
                        <label key={key}>
                          {label}
                          <input
                            {...field(index, key)}
                            disabled={documentDisabled}
                            value={String(
                              assignment[key as keyof Assignment] || "",
                            )}
                            onChange={(event) =>
                              changeAssignment(assignment.id, {
                                [key]: event.target.value,
                              })
                            }
                          />
                          {fieldError(index, key)}
                          {key === "biotUniqueNumber" && (
                            <small>
                              Если сертификат оформляется этому получателю в том
                              же комплекте, поле можно оставить пустым. Номер
                              протокола не заменяет номер сертификата.
                            </small>
                          )}
                        </label>
                      ))}
                    </>
                  )}
                  {["biot-protocol", "biot-itr-protocol"].includes(
                    assignment.templateId,
                  ) && (
                    <label className="assignment-field-wide">
                      Примечание к протоколу БиОТ
                      <textarea
                        {...field(index, "biotNotes")}
                        disabled={documentDisabled}
                        value={assignment.biotNotes || ""}
                        onChange={(event) =>
                          changeAssignment(assignment.id, {
                            biotNotes: event.target.value,
                          })
                        }
                      />
                      {fieldError(index, "biotNotes")}
                    </label>
                  )}
                  <label className="assignment-field-wide">
                    Программа / тема обучения
                    <textarea
                      {...field(index, "trainingSubject")}
                      disabled={documentDisabled}
                      value={
                        (resolvedRecipient?.assignments[index] || assignment)
                          .trainingSubject
                      }
                      onChange={(event) =>
                        changeAssignment(assignment.id, {
                          trainingSubject: event.target.value,
                        })
                      }
                    />
                    {fieldError(index, "trainingSubject")}
                  </label>
                  <label className="assignment-field-wide">
                    Программа / тема обучения · KZ
                    <textarea
                      {...field(index, "trainingSubjectKz")}
                      disabled={documentDisabled}
                      value={
                        (resolvedRecipient?.assignments[index] || assignment)
                          .trainingSubjectKz || ""
                      }
                      onChange={(event) =>
                        changeAssignment(assignment.id, {
                          trainingSubjectKz: event.target.value,
                        })
                      }
                    />
                    {fieldError(index, "trainingSubjectKz")}
                    <small>
                      KZ необязателен; без отдельного варианта используется
                      введённый текст без перевода.
                    </small>
                  </label>
                  {assignment.templateId.startsWith("ps-") && (
                    <div className="form-grid assignment-field-wide">
                      {(
                        [
                          [
                            "psGeneralSubjectRu",
                            "Удостоверение ПС: общепрофессиональная дисциплина · RU",
                          ],
                          [
                            "psGeneralSubjectKz",
                            "Удостоверение ПС: общепрофессиональная дисциплина · KZ",
                          ],
                          [
                            "psSpecialSubjectRu",
                            "Удостоверение ПС: специальная дисциплина · RU",
                          ],
                          [
                            "psSpecialSubjectKz",
                            "Удостоверение ПС: специальная дисциплина · KZ",
                          ],
                        ] as const
                      ).map(([key, label]) => (
                        <label key={key}>
                          {label}
                          <input
                            {...field(index, key)}
                            disabled={documentDisabled}
                            value={
                              (resolvedRecipient?.assignments[index] ||
                                assignment)[key] || ""
                            }
                            onChange={(event) =>
                              changeAssignment(assignment.id, {
                                [key]: event.target.value,
                              })
                            }
                          />
                          {fieldError(index, key)}
                        </label>
                      ))}
                      <p className="fine-print">
                        Эти тексты печатаются в строках дисциплин удостоверения
                        ПС. Свидетельство сохраняет названия
                        «Общепрофессиональные дисциплины» и «Специальные
                        дисциплины» исходного бланка.
                      </p>
                      <details className="assignment-field-wide">
                        <summary>
                          Профессия и квалификация ПС · исключения для этого
                          курса
                        </summary>
                        <p className="fine-print">
                          Без исключения используется общий ввод человека.
                          Профессия печатается в удостоверении ПС; присвоенная
                          квалификация — в свидетельстве и протоколе ПС. У
                          смешанных курсов эти значения могут отличаться от
                          должности.
                        </p>
                        <div className="form-grid">
                          {(
                            [
                              ["professionRu", "Профессия для ПС · RU"],
                              ["professionKz", "Профессия для ПС · KZ"],
                              [
                                "psQualificationRu",
                                "Присвоенная квалификация — свидетельство и протокол ПС · RU",
                              ],
                              [
                                "psQualificationKz",
                                "Присвоенная квалификация — свидетельство и протокол ПС · KZ",
                              ],
                            ] as const
                          ).map(([key, label]) => (
                            <label key={key}>
                              {label}
                              <input
                                {...field(index, key)}
                                disabled={documentDisabled}
                                value={assignment[key] || ""}
                                placeholder={
                                  key.endsWith("Kz")
                                    ? recipient.positionKz ||
                                      recipient.positionRu
                                    : recipient.positionRu ||
                                      recipient.positionKz
                                }
                                onChange={(event) =>
                                  changeAssignment(assignment.id, {
                                    [key]: event.target.value,
                                  })
                                }
                              />
                              {fieldError(index, key)}
                              {assignment[key] && (
                                <button
                                  type="button"
                                  disabled={documentDisabled}
                                  className="text-button"
                                  onClick={() =>
                                    onChange(
                                      restoreTrainingAssignmentField(
                                        recipient,
                                        assignment.id,
                                        key,
                                        liveRules,
                                      ),
                                    )
                                  }
                                >
                                  Вернуть общий ввод
                                </button>
                              )}
                            </label>
                          ))}
                        </div>
                      </details>
                    </div>
                  )}
                  <label>
                    Подтверждённый результат / оценка
                    <input
                      {...field(index, "result")}
                      disabled={documentDisabled}
                      value={assignment.result}
                      placeholder="Укажите фактический результат"
                      onChange={(event) =>
                        changeAssignment(assignment.id, {
                          result: event.target.value,
                        })
                      }
                    />
                    {fieldError(index, "result")}
                  </label>
                  <label>
                    Текст результата / оценка · KZ
                    <input
                      {...field(index, "resultKz")}
                      disabled={documentDisabled}
                      value={
                        (resolvedRecipient?.assignments[index] || assignment)
                          .resultKz || ""
                      }
                      onChange={(event) =>
                        changeAssignment(assignment.id, {
                          resultKz: event.target.value,
                        })
                      }
                    />
                    {fieldError(index, "resultKz")}
                  </label>
                  {(liveRules ||
                    assignment.outcome ||
                    assignment.protocolMode === "GROUP") && (
                    <div className="form-grid assignment-field-wide">
                      <label>
                        Исход обучения
                        <select
                          {...field(index, "outcome")}
                          disabled={documentDisabled}
                          value={assignment.outcome?.status || "UNKNOWN"}
                          onChange={(event) =>
                            changeAssignment(assignment.id, {
                              outcome: {
                                ...assignment.outcome,
                                status: event.target.value as NonNullable<
                                  Assignment["outcome"]
                                >["status"],
                                source: assignment.outcome?.source || "",
                              },
                            })
                          }
                        >
                          <option value="UNKNOWN">Не подтверждён</option>
                          <option value="PASSED">Сдал</option>
                          <option value="FAILED">Не сдал</option>
                          <option value="ABSENT">Не явился</option>
                        </select>
                        {fieldError(index, "outcome")}
                      </label>
                      <label>
                        Источник подтверждения результата
                        <input
                          {...field(index, "outcome.source")}
                          disabled={documentDisabled}
                          value={assignment.outcome?.source || ""}
                          placeholder="Ведомость, дата и ответственный"
                          onChange={(event) =>
                            changeAssignment(assignment.id, {
                              outcome: {
                                ...assignment.outcome,
                                status: assignment.outcome?.status || "UNKNOWN",
                                source: event.target.value,
                              },
                            })
                          }
                        />
                        {fieldError(index, "outcome.source")}
                      </label>
                      <p className="fine-print assignment-field-wide">
                        Оценка и подтверждённый исход указываются отдельно.
                        Удостоверение выдаётся при исходе «Сдал». Эти сведения
                        применяются ко всем формам этого обучения у выбранного
                        получателя.
                      </p>
                    </div>
                  )}
                  {englishAppendix && (
                    <div className="english-fields assignment-field-wide">
                      <p className="muted">
                        Текст для дополнительной английской страницы
                      </p>
                      {(
                        [
                          ["trainingSubjectEn", "Программа · EN"],
                          ["resultEn", "Результат · EN"],
                          ["reasonEn", "Причина проверки · EN"],
                          ["educationEn", "Образование · EN"],
                          ["biotIndustryEn", "Отрасль БиОТ · EN"],
                          [
                            "biotKnowledgeResultEn",
                            "Результат проверки знаний · EN",
                          ],
                          [
                            "biotProctoringResultEn",
                            "Результат прокторинга · EN",
                          ],
                          ["biotNotesEn", "Примечания БиОТ · EN"],
                        ] as const
                      )
                        .filter(([key]) => {
                          const source =
                            resolvedRecipient?.assignments[index] || assignment;
                          const bases: Record<string, boolean> = {
                            reasonEn: !!source.reason,
                            educationEn: !!source.education,
                            biotIndustryEn: !!(
                              source.biotIndustryRu || source.biotIndustryKz
                            ),
                            biotKnowledgeResultEn: !!source.biotKnowledgeResult,
                            biotProctoringResultEn:
                              !!source.biotProctoringResult,
                            biotNotesEn: !!source.biotNotes,
                          };
                          return bases[key] ?? true;
                        })
                        .map(([key, label]) => (
                          <label key={key}>
                            {label}
                            <input
                              disabled={documentDisabled}
                              value={
                                (resolvedRecipient?.assignments[index] ||
                                  assignment)[key] || ""
                              }
                              {...field(index, key)}
                              onChange={(event) =>
                                changeAssignment(assignment.id, {
                                  [key]: event.target.value,
                                })
                              }
                            />
                            {fieldError(index, key)}
                            {key === "trainingSubjectEn" && (
                              <TranslationSuggestion
                                source={
                                  (
                                    resolvedRecipient?.assignments[index] ||
                                    assignment
                                  ).trainingSubject
                                }
                                field="trainingSubject"
                                currentText={
                                  (
                                    resolvedRecipient?.assignments[index] ||
                                    assignment
                                  ).trainingSubjectEn || ""
                                }
                                target="en"
                                disabled={documentDisabled}
                                onApply={(text) =>
                                  changeAssignment(assignment.id, {
                                    trainingSubjectEn: text,
                                  })
                                }
                              />
                            )}
                          </label>
                        ))}
                    </div>
                  )}
                  {(assignment.templateId === "ptm-protocol" ||
                    !isBlankText(assignment.reason || "") ||
                    !isBlankText(
                      (resolvedRecipient?.assignments[index] || assignment)
                        .reason || "",
                    ) ||
                    !!fieldErrors[
                      `items.${rowIndex}.assignments.${index}.reason`
                    ] ||
                    !!fieldHints[
                      `items.${rowIndex}.assignments.${index}.reason`
                    ]) && (
                    <label>
                      {assignment.templateId === "ptm-protocol"
                        ? "Причина проверки знаний"
                        : "Причина / основание"}
                      <input
                        {...field(index, "reason")}
                        disabled={documentDisabled}
                        value={
                          (resolvedRecipient?.assignments[index] || assignment)
                            .reason || ""
                        }
                        onChange={(event) =>
                          changeAssignment(assignment.id, {
                            reason: event.target.value,
                          })
                        }
                      />
                      {fieldError(index, "reason")}
                      <small id={`hint-${recipient.id}-${index}-reason`}>
                        Укажите фактическую причину, если она применима.
                        {assignment.protocolMode === "GROUP" &&
                          " Для группового документа она должна совпадать с общей причиной обучения. Используйте общее значение, чтобы убрать индивидуальное исключение."}
                      </small>
                      {(!!fieldErrors[
                        `items.${rowIndex}.assignments.${index}.reason`
                      ] ||
                        !isBlankText(assignment.reason || "") ||
                        ["MANUAL", "IMPORTED", "CLEARED"].includes(
                          assignment.fieldOrigins?.reason ||
                            provenance?.[`${recipient.id}:${assignment.id}`]
                              ?.reason ||
                            "",
                        )) && (
                        <button
                          type="button"
                          className="text-button"
                          disabled={documentDisabled}
                          onClick={() =>
                            onChange(
                              restoreTrainingAssignmentField(
                                recipient,
                                assignment.id,
                                "reason",
                                liveRules,
                              ),
                            )
                          }
                        >
                          Использовать общее значение причины
                        </button>
                      )}
                    </label>
                  )}
                  {assignment.templateId === "pb-protocol" && (
                    <label>
                      Образование
                      <input
                        {...field(index, "education")}
                        disabled={documentDisabled}
                        value={
                          (resolvedRecipient?.assignments[index] || assignment)
                            .education || ""
                        }
                        onChange={(event) =>
                          changeAssignment(assignment.id, {
                            education: event.target.value,
                          })
                        }
                      />
                      {fieldError(index, "education")}
                      <small>
                        Необязательное поле. Вносите подтверждённые сведения.
                      </small>
                    </label>
                  )}
                </div>
                <div
                  className="assignment-section"
                  data-assignment-section="settings"
                  role="tabpanel"
                  id={`${tabId}-${assignment.id}-settings-panel`}
                  aria-labelledby={`${tabId}-${assignment.id}-settings-tab`}
                  hidden={activeSection !== "settings"}
                >
                  {assignment.protocolMode !== "GROUP" && (
                    <TrainingDateSettings
                      rule={
                        (resolvedRecipient?.assignments[index] || assignment)
                          .trainingDateRule
                      }
                      disabled={documentDisabled}
                      onChange={(rule) =>
                        changeAssignment(assignment.id, {
                          trainingDateRule: rule,
                        })
                      }
                    />
                  )}
                  {!!Object.keys(
                    provenance?.[`${recipient.id}:${assignment.id}`] || {},
                  ).length && (
                    <details className="field-provenance">
                      <summary>Источники общих значений</summary>
                      <dl>
                        {Object.entries(
                          provenance?.[`${recipient.id}:${assignment.id}`] ||
                            {},
                        ).map(([key, origin]) => (
                          <div key={key}>
                            <dt>
                              {(
                                {
                                  documentDate: "Дата документа",
                                  trainingStart: "Начало обучения",
                                  trainingEnd: "Окончание обучения",
                                  protocolDate: "Дата протокола",
                                  trainingSubject: "Программа",
                                  trainingSubjectEn: "Программа · EN",
                                  hours: "Часы",
                                  validUntil: "Действителен до",
                                  reason: "Причина",
                                  reasonEn: "Причина · EN",
                                  education: "Образование",
                                  educationEn: "Образование · EN",
                                  externalBasisNumber:
                                    "Внешний номер основания",
                                  biotCategory: "Категория",
                                  productionHours: "Производственные часы",
                                  biotCheckType: "Вид проверки",
                                } as Record<string, string>
                              )[key] || key}
                            </dt>
                            <dd>
                              {(
                                {
                                  EVENT: "Из события",
                                  REQUEST: "Из заявки",
                                  PRESET: "Из набора",
                                  COURSE: "Программа курса",
                                  CENTER: "Из настроек центра",
                                  MANUAL: "Введено вручную",
                                  IMPORTED: "Импортировано",
                                  CLEARED: "Очищено вручную",
                                  AUTO: "Автоматический расчёт",
                                } as Record<string, string>
                              )[origin] || origin}
                              {["MANUAL", "IMPORTED", "CLEARED"].includes(
                                origin,
                              ) && (
                                <button
                                  className="text-button"
                                  disabled={documentDisabled}
                                  onClick={() =>
                                    onChange(
                                      restoreTrainingAssignmentField(
                                        recipient,
                                        assignment.id,
                                        key,
                                        liveRules,
                                      ),
                                    )
                                  }
                                >
                                  Вернуть общее значение
                                </button>
                              )}
                            </dd>
                          </div>
                        ))}
                      </dl>
                    </details>
                  )}
                  <label>
                    Основание
                    <select
                      {...field(index, "protocolMode")}
                      disabled={
                        documentDisabled ||
                        liveRules ||
                        assignment.templateId.endsWith("-protocol")
                      }
                      value={assignment.protocolMode}
                      onChange={(event) =>
                        changeAssignment(assignment.id, {
                          protocolMode: event.target
                            .value as Assignment["protocolMode"],
                        })
                      }
                    >
                      <option value="INDIVIDUAL">
                        Индивидуальный документ
                      </option>
                      {assignment.eventId && (
                        <option value="GROUP">Общий протокол события</option>
                      )}
                      <option value="EXTERNAL_REFERENCE">
                        Внешний протокол / основание
                      </option>
                    </select>
                    {fieldError(index, "protocolMode")}
                    {liveRules && (
                      <small>
                        Вариант протокола меняется в разделе «Обучения и
                        протоколы» для всего обучения.
                      </small>
                    )}
                  </label>
                  <label>
                    Внешний номер основания
                    <input
                      {...field(index, "externalBasisNumber")}
                      disabled={documentDisabled}
                      value={
                        (resolvedRecipient?.assignments[index] || assignment)
                          .externalBasisNumber
                      }
                      onChange={(event) =>
                        changeAssignment(assignment.id, {
                          externalBasisNumber: event.target.value,
                        })
                      }
                    />
                    {fieldError(index, "externalBasisNumber")}
                  </label>
                  <small className="muted">
                    Номер печатного документа назначит сервер. Внешний номер
                    основания хранится отдельно.
                  </small>
                </div>
                {!documentDisabled && !liveRules && (
                  <button
                    className="text-button danger-text"
                    onClick={() =>
                      onChange({
                        ...recipient,
                        assignments: recipient.assignments.filter(
                          (item) => item.id !== assignment.id,
                        ),
                      })
                    }
                  >
                    Удалить этот документ
                  </button>
                )}
              </div>
            </details>
          );
        })}
        {!disabled && !liveRules && (
          <button
            className="add-document"
            disabled={recipient.assignments.length >= 10}
            onClick={() =>
              onChange({
                ...recipient,
                assignments: [...recipient.assignments, newAssignment()],
              })
            }
          >
            <Icon name="plus" />
            Добавить документ
          </button>
        )}
      </div>
      <small className="timezone-note">
        Календарные даты центра · {context.tenant.timezone}
      </small>
      {photoOpen && (
        <PhotoDialog
          onClose={() => setPhotoOpen(false)}
          onSaved={(id) => {
            onChange({ ...recipient, photoAssetId: id });
            setPhotoOpen(false);
          }}
        />
      )}
    </div>
  );
}
export function PhotoDialog({
  onClose,
  onSaved,
}: {
  onClose: () => void;
  onSaved: (id: string) => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [source, setSource] = useState("");
  const [rotation, setRotation] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [x, setX] = useState(50);
  const [y, setY] = useState(50);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const canvas = useRef<HTMLCanvasElement>(null);
  const imageRef = useRef<HTMLImageElement | null>(null);
  const orientedWidth = rotation % 180 ? size.height : size.width;
  const orientedHeight = rotation % 180 ? size.width : size.height;
  const width = Math.min(orientedWidth, (orientedHeight * 3) / 4) / zoom;
  const height = (width * 4) / 3;
  const crop = {
    x: Math.round(((orientedWidth - width) * x) / 100),
    y: Math.round(((orientedHeight - height) * y) / 100),
    width: Math.floor(width),
    height: Math.floor(height),
  };
  useEffect(() => {
    if (!file) return;
    imageRef.current = null;
    setSize({ width: 0, height: 0 });
    const url = URL.createObjectURL(file);
    setSource(url);
    const image = new Image();
    image.onload = () => {
      if (image.width * image.height > LIMITS.imagePixels) {
        setError(
          "Изображение превышает 20 мегапикселей. Уменьшите его размер.",
        );
        setFile(null);
        return;
      }
      imageRef.current = image;
      setSize({ width: image.width, height: image.height });
    };
    image.onerror = () => {
      setError(
        "Не удалось прочитать изображение. Выберите исправный PNG или JPEG.",
      );
      setFile(null);
    };
    image.src = url;
    return () => {
      image.onload = null;
      URL.revokeObjectURL(url);
    };
  }, [file]);
  useEffect(() => {
    const image = imageRef.current;
    const target = canvas.current;
    if (!image || !target || !crop.width) return;
    const oriented = document.createElement("canvas");
    oriented.width = orientedWidth;
    oriented.height = orientedHeight;
    const stage = oriented.getContext("2d");
    const ctx = target.getContext("2d");
    if (!ctx || !stage) return;
    stage.translate(orientedWidth / 2, orientedHeight / 2);
    stage.rotate((rotation * Math.PI) / 180);
    stage.drawImage(image, -size.width / 2, -size.height / 2);
    ctx.clearRect(0, 0, target.width, target.height);
    ctx.drawImage(
      oriented,
      crop.x,
      crop.y,
      crop.width,
      crop.height,
      0,
      0,
      target.width,
      target.height,
    );
  }, [
    source,
    size,
    rotation,
    zoom,
    x,
    y,
    crop.x,
    crop.y,
    crop.width,
    crop.height,
    orientedWidth,
    orientedHeight,
  ]);
  async function upload() {
    if (!file) return;
    setBusy(true);
    setError("");
    try {
      const body = new FormData();
      body.set("file", file);
      body.set("rotation", String(rotation));
      body.set("crop", JSON.stringify(crop));
      const result = await api<{ id?: string; assetId?: string }>("/photos", {
        method: "POST",
        body,
      });
      const id = result.assetId || result.id;
      if (!id) throw new Error("Сервер не вернул идентификатор фото.");
      onSaved(id);
    } catch (caught) {
      setError(errorText(caught));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title="Фото для печати" onClose={onClose}>
      <p>
        PNG или JPEG до 5 МБ. Кадр 3 × 4. После загрузки фото доступно только
        внутри вашего центра.
      </p>
      {error && <Notice>{error}</Notice>}
      <label className="upload-zone">
        Выбрать фотографию
        <input
          type="file"
          accept="image/png,image/jpeg"
          onChange={(event) => {
            const next = event.target.files?.[0];
            if (!next) return;
            if (next.size > LIMITS.photoBytes) {
              setError(
                "Файл больше 5 МБ. Выберите изображение меньшего размера.",
              );
              return;
            }
            if (!["image/png", "image/jpeg"].includes(next.type)) {
              setError("Допускаются только PNG и JPEG.");
              return;
            }
            setError("");
            setZoom(1);
            setX(50);
            setY(50);
            setRotation(0);
            setFile(next);
          }}
        />
      </label>
      {file && (
        <div className="photo-editor">
          <canvas
            ref={canvas}
            width={300}
            height={400}
            aria-label="Предпросмотр обрезанной фотографии"
          />
          <div>
            <label>
              Поворот
              <select
                aria-label="Поворот"
                value={rotation}
                onChange={(event) => setRotation(Number(event.target.value))}
              >
                <option value="0">Без поворота</option>
                <option value="90">90° вправо</option>
                <option value="180">180°</option>
                <option value="270">90° влево</option>
              </select>
            </label>
            <label>
              Масштаб
              <input
                type="range"
                min="1"
                max="3"
                step="0.05"
                value={zoom}
                onChange={(event) => setZoom(Number(event.target.value))}
              />
            </label>
            <label>
              По горизонтали
              <input
                type="range"
                min="0"
                max="100"
                value={x}
                onChange={(event) => setX(Number(event.target.value))}
              />
            </label>
            <label>
              По вертикали
              <input
                type="range"
                min="0"
                max="100"
                value={y}
                onChange={(event) => setY(Number(event.target.value))}
              />
            </label>
            <small>
              {crop.width} × {crop.height} px в печатном кадре
            </small>
            {crop.width < 354 && (
              <Notice kind="info">
                Для качественной печати 3 × 4 см рекомендуется кадр не менее 354
                × 472 px.
              </Notice>
            )}
          </div>
        </div>
      )}
      <div className="modal-actions">
        <button disabled={busy} onClick={onClose}>
          Отмена
        </button>
        <button
          className="primary"
          disabled={!file || !size.width || busy}
          onClick={() => void upload()}
        >
          {busy ? "Загружаем…" : "Сохранить фото"}
        </button>
      </div>
    </Modal>
  );
}
