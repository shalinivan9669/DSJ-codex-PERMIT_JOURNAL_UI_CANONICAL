"use client";
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
}: {
  value: OrganizationNames;
  onChange: (value: OrganizationNames) => void;
  legacyLabels?: readonly [string, string];
  labels?: { legalForm?: string; ownNameRu?: string };
  autoFocus?: boolean;
  showRequiredErrors?: boolean;
  compactHints?: boolean;
  hideEmptyPreview?: boolean;
  requestEntry?: boolean;
}) {
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
    (showRequiredErrors &&
    !(value.legalForm ? value.ownNameRu : value.nameRu)?.trim()
      ? "Введите название компании."
      : "");
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
        {labels?.legalForm || "Форма организации"}
        <select
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
              computed.ownNameKz === computed.ownNameRu
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
            <option value="">Сохранённое название — как введено</option>
          )}
          {ORGANIZATION_FORMS.map((form) => (
            <option value={form.value} key={form.value}>
              {form.label}
            </option>
          ))}
        </select>
      </label>
      {!requestEntry && (
        <p className="fine-print" id={`${id}-hint`}>
          {compactHints
            ? value.legalForm === "NONE"
              ? "Название сохранится как введено."
              : "Введите название без ТОО, ИП, АО. Кавычки сохраняются."
            : "Название вводится один раз. Меняется только обозначение формы: ТОО / ЖШС, ИП / ЖК, АО / АҚ."}
        </p>
      )}
      {value.legalForm ? (
        <>
          <label>
            {labels?.ownNameRu || "Собственное наименование"}
            <input
              autoFocus={autoFocus}
              required
              maxLength={500}
              value={value.ownNameRu || ""}
              aria-invalid={!!nameError}
              aria-describedby={nameError ? `${id}-error` : undefined}
              onChange={(event) =>
                update(event.target.value, value.ownNameKz || "")
              }
            />
            {!compactHints && (
              <small>
                {value.legalForm === "NONE"
                  ? "Название сохраняется как введено. Обозначение формы не добавляется."
                  : "Без ТОО, ИП, АО. Кавычки сохраняются так, как вы их ввели."}
              </small>
            )}
          </label>
          {!requestEntry && (
            <details
              open={differentKz || undefined}
              className="organization-extra-name"
            >
              <summary>Другое наименование на казахском</summary>
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={differentKz}
                  onChange={(event) => {
                    setDifferentKz(event.target.checked);
                    if (!event.target.checked)
                      update(value.ownNameRu || "", "");
                  }}
                />
                Собственное наименование на казахском отличается
              </label>
              {differentKz && (
                <label>
                  Собственное наименование · KZ
                  <input
                    required
                    maxLength={500}
                    value={value.ownNameKz || ""}
                    aria-invalid={!!names?.issue}
                    aria-describedby={names?.issue ? `${id}-error` : undefined}
                    onChange={(event) =>
                      update(value.ownNameRu || "", event.target.value)
                    }
                  />
                </label>
              )}
            </details>
          )}
          {nameError && (
            <p className="field-error" id={`${id}-error`} role="alert">
              {nameError}
            </p>
          )}
          {names?.normalized && !names.issue && (
            <p className="fine-print">
              Отдельное обозначение выбранной формы распознано. В полном
              названии оно будет только один раз.
            </p>
          )}
        </>
      ) : (
        <>
          <p className="fine-print">
            Старые или импортированные названия сохраняются без изменений. Чтобы
            разделить форму и имя, явно выберите форму и проверьте предпросмотр.
          </p>
          <div className="form-grid">
            <label>
              {legacyLabels[0]}
              <input
                autoFocus={autoFocus}
                required
                maxLength={500}
                value={value.nameRu}
                aria-invalid={!!nameError}
                aria-describedby={nameError ? `${id}-error` : undefined}
                onChange={(event) =>
                  onChange({ ...value, nameRu: event.target.value })
                }
              />
              {nameError && (
                <span className="field-error" id={`${id}-error`} role="alert">
                  {nameError}
                </span>
              )}
            </label>
            <label>
              {legacyLabels[1]}
              <input
                maxLength={500}
                value={value.nameKz}
                onChange={(event) =>
                  onChange({ ...value, nameKz: event.target.value })
                }
              />
            </label>
          </div>
        </>
      )}
      {(!hideEmptyPreview ||
        names?.nameRu ||
        names?.nameKz ||
        value.nameRu ||
        value.nameKz) && (
        <div
          className="form-grid organization-name-preview"
          aria-live="polite"
          aria-label="Полные названия для документов"
        >
          <div>
            <small>Полное название · RU</small>
            <p>
              <output>{names?.nameRu || value.nameRu || "—"}</output>
            </p>
          </div>
          <div>
            <small>Полное название · KZ</small>
            <p>
              <output>{names?.nameKz || value.nameKz || "—"}</output>
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
