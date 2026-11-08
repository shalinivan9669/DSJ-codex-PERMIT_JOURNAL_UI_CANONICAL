"use client";
import { useCabinetText } from "./cabinet-language";
import { useId, useState } from "react";
import {
  formatOrganizationNames,
  ORGANIZATION_FORMS,
  type OrganizationForm,
  type OrganizationNames,
} from "@demo/contracts";

export function OrganizationNameFields({
  value,
  onChange,
  legacyLabels = ["Полное название · RU", "Полное название · KZ"],
  labels,
  autoFocus = true,
  showRequiredErrors = false,
  compactHints = false,
  hideEmptyPreview = false,
  requestEntry = false,
  alwaysShowKz = false,
  fieldPaths,
  fieldErrors,
  fieldHints,
  disabled = false,
}: {
  value: OrganizationNames;
  onChange: (value: OrganizationNames) => void;
  legacyLabels?: readonly [string, string];
  labels?: { legalForm?: string; ownNameRu?: string; ownNameKz?: string };
  autoFocus?: boolean;
  showRequiredErrors?: boolean;
  compactHints?: boolean;
  hideEmptyPreview?: boolean;
  requestEntry?: boolean;
  alwaysShowKz?: boolean;
  fieldPaths?: readonly [string, string];
  fieldErrors?: readonly [string | undefined, string | undefined];
  fieldHints?: readonly [string | undefined, string | undefined];
  disabled?: boolean;
}) {
  const tr = useCabinetText();
  const id = useId();
  const [differentKz, setDifferentKz] = useState(!!value.ownNameKz);
  const names = value.legalForm
    ? formatOrganizationNames(
        value.legalForm,
        value.ownNameRu || "",
        value.ownNameKz || "",
      )
    : null;
  const nameError =
    names?.issue ||
    fieldErrors?.[0] ||
    (showRequiredErrors &&
    !(value.legalForm ? value.ownNameRu : value.nameRu)?.trim()
      ? tr("Введите название компании.")
      : "");
  const ruFeedback = nameError || fieldHints?.[0];
  const kzFeedback = fieldErrors?.[1] || fieldHints?.[1];
  const kzDescription =
    [
      names?.issue && `${id}-error`,
      kzFeedback && `${id}-kz-feedback`,
      alwaysShowKz && value.legalForm && `${id}-kz-hint`,
    ]
      .filter(Boolean)
      .join(" ") || undefined;
  function update(ownNameRu: string, ownNameKz: string) {
    if (!value.legalForm) return;
    const computed = formatOrganizationNames(
      value.legalForm,
      ownNameRu,
      ownNameKz,
    );
    onChange({
      ...value,
      ownNameRu,
      ownNameKz,
      nameRu: computed.nameRu,
      nameKz: computed.nameKz,
    });
  }
  return (
    <div className="stack organization-name-fields">
      <label>
        {labels?.legalForm || tr("Форма организации")}
        <select
          disabled={disabled}
          value={value.legalForm || ""}
          aria-describedby={requestEntry ? undefined : `${id}-hint`}
          onChange={(event) => {
            const legalForm = (event.target.value ||
              null) as OrganizationForm | null;
            if (!legalForm) {
              onChange({
                ...value,
                legalForm: null,
                ownNameRu: null,
                ownNameKz: null,
              });
              return;
            }
            const computed = formatOrganizationNames(
              legalForm,
              value.ownNameRu ?? value.nameRu,
              value.ownNameKz ?? value.nameKz,
            );
            const ownNameKz =
              !alwaysShowKz && computed.ownNameKz === computed.ownNameRu
                ? ""
                : computed.ownNameKz;
            setDifferentKz(!!ownNameKz);
            onChange({
              ...value,
              legalForm,
              ownNameRu: computed.ownNameRu,
              ownNameKz,
              nameRu: computed.nameRu,
              nameKz: computed.nameKz,
            });
          }}
        >
          {!value.legalForm && (
            <option value="">{tr("Сохранённое название — как введено")}</option>
          )}
          {ORGANIZATION_FORMS.map((form) => (
            <option value={form.value} key={form.value}>
              {tr(form.label)}
            </option>
          ))}
        </select>
      </label>
      {!requestEntry && (
        <p className="fine-print" id={`${id}-hint`}>
          {compactHints
            ? value.legalForm === "NONE"
              ? tr("Название сохранится как введено.")
              : tr("Введите название без ТОО, ИП, АО. Кавычки сохраняются.")
            : tr(
                "Название вводится один раз. Меняется только обозначение формы: ТОО / ЖШС, ИП / ЖК, АО / АҚ.",
              )}
        </p>
      )}
      {value.legalForm ? (
        <>
          <label>
            {labels?.ownNameRu || tr("Собственное наименование")}
            <input
              disabled={disabled}
              data-field-path={fieldPaths?.[0]}
              aria-label={labels?.ownNameRu || tr("Собственное наименование")}
              autoFocus={autoFocus}
              required
              maxLength={500}
              value={value.ownNameRu || ""}
              aria-invalid={!!nameError}
              aria-describedby={ruFeedback ? `${id}-error` : undefined}
              onChange={(event) =>
                update(event.target.value, value.ownNameKz || "")
              }
            />
            {!compactHints && (
              <small>
                {value.legalForm === "NONE"
                  ? tr(
                      "Название сохраняется как введено. Обозначение формы не добавляется.",
                    )
                  : tr(
                      "Без ТОО, ИП, АО. Кавычки сохраняются так, как вы их ввели.",
                    )}
              </small>
            )}
          </label>
          {alwaysShowKz ? (
            <label>
              {labels?.ownNameKz || tr("Собственное наименование · KZ")}
              <input
                disabled={disabled}
                data-field-path={fieldPaths?.[1]}
                aria-label={
                  labels?.ownNameKz || tr("Собственное наименование · KZ")
                }
                maxLength={500}
                value={value.ownNameKz || ""}
                placeholder={value.ownNameRu || ""}
                aria-invalid={!!names?.issue || !!fieldErrors?.[1]}
                aria-describedby={kzDescription}
                onChange={(event) =>
                  update(value.ownNameRu || "", event.target.value)
                }
              />
              <small id={`${id}-kz-hint`}>
                {tr("Пусто — используем название RU.")}
              </small>
            </label>
          ) : (
            !requestEntry && (
              <details
                open={differentKz || undefined}
                className="organization-extra-name"
              >
                <summary>{tr("Другое наименование на казахском")}</summary>
                <label className="checkbox-label">
                  <input
                    disabled={disabled}
                    type="checkbox"
                    checked={differentKz}
                    onChange={(event) => {
                      setDifferentKz(event.target.checked);
                      if (!event.target.checked)
                        update(value.ownNameRu || "", "");
                    }}
                  />
                  {tr("Собственное наименование на казахском отличается")}
                </label>
                {differentKz && (
                  <label>
                    {labels?.ownNameKz || tr("Собственное наименование · KZ")}
                    <input
                      disabled={disabled}
                      data-field-path={fieldPaths?.[1]}
                      required
                      maxLength={500}
                      value={value.ownNameKz || ""}
                      aria-invalid={!!names?.issue || !!fieldErrors?.[1]}
                      aria-describedby={kzDescription}
                      onChange={(event) =>
                        update(value.ownNameRu || "", event.target.value)
                      }
                    />
                  </label>
                )}
              </details>
            )
          )}
          {nameError && (
            <p className="field-error" id={`${id}-error`} role="alert">
              {tr(nameError)}
            </p>
          )}
          {!nameError && fieldHints?.[0] && (
            <p className="fine-print" id={`${id}-error`}>
              {tr(fieldHints[0])}
            </p>
          )}
          {names?.normalized && !names.issue && (
            <p className="fine-print">
              {tr(
                "Отдельное обозначение выбранной формы распознано. В полном названии оно будет только один раз.",
              )}
            </p>
          )}
        </>
      ) : (
        <>
          <p className="fine-print">
            {tr(
              "Старые или импортированные названия сохраняются без изменений. Чтобы разделить форму и имя, явно выберите форму и проверьте предпросмотр.",
            )}
          </p>
          <div className="form-grid">
            <label>
              {tr(legacyLabels[0])}
              <input
                disabled={disabled}
                data-field-path={fieldPaths?.[0]}
                autoFocus={autoFocus}
                required
                maxLength={500}
                value={value.nameRu}
                aria-invalid={!!nameError}
                aria-describedby={ruFeedback ? `${id}-error` : undefined}
                onChange={(event) =>
                  onChange({ ...value, nameRu: event.target.value })
                }
              />
              {nameError && (
                <span className="field-error" id={`${id}-error`} role="alert">
                  {tr(nameError)}
                </span>
              )}
              {!nameError && fieldHints?.[0] && (
                <small id={`${id}-error`}>{tr(fieldHints[0])}</small>
              )}
            </label>
            <label>
              {tr(legacyLabels[1])}
              <input
                disabled={disabled}
                data-field-path={fieldPaths?.[1]}
                maxLength={500}
                value={value.nameKz}
                aria-invalid={!!fieldErrors?.[1]}
                aria-describedby={kzDescription}
                onChange={(event) =>
                  onChange({ ...value, nameKz: event.target.value })
                }
              />
            </label>
          </div>
        </>
      )}
      {kzFeedback && (
        <p
          id={`${id}-kz-feedback`}
          className={fieldErrors?.[1] ? "field-error" : "fine-print"}
          role={fieldErrors?.[1] ? "alert" : undefined}
        >
          {tr(kzFeedback)}
        </p>
      )}
      {(!hideEmptyPreview ||
        names?.nameRu ||
        names?.nameKz ||
        value.nameRu ||
        value.nameKz) && (
        <div
          className="form-grid organization-name-preview"
          aria-live="polite"
          aria-label={tr("Полные названия для документов")}
        >
          <div>
            <small>{tr("Полное название · RU")}</small>
            <p>
              <output>{names?.nameRu || value.nameRu || "—"}</output>
            </p>
          </div>
          <div>
            <small>{tr("Полное название · KZ")}</small>
            <p>
              <output>{names?.nameKz || value.nameKz || "—"}</output>
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
