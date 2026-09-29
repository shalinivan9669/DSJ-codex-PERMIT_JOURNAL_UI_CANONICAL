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
}: {
  value: OrganizationNames;
  onChange: (value: OrganizationNames) => void;
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
        Форма организации
        <select
          value={value.legalForm || ""}
          aria-describedby={`${id}-hint`}
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
      <p className="fine-print" id={`${id}-hint`}>
        Название вводится один раз. Меняется только обозначение формы: ТОО /
        ЖШС, ИП / ЖК, АО / АҚ.
      </p>
      {value.legalForm ? (
        <>
          <label>
            Собственное наименование
            <input
              autoFocus
              required
              maxLength={500}
              value={value.ownNameRu || ""}
              aria-invalid={!!names?.issue}
              aria-describedby={names?.issue ? `${id}-error` : undefined}
              onChange={(event) =>
                update(event.target.value, value.ownNameKz || "")
              }
            />
            <small>
              {value.legalForm === "NONE"
                ? "Название сохраняется как введено. Обозначение формы не добавляется."
                : "Без ТОО, ИП, АО. Кавычки сохраняются так, как вы их ввели."}
            </small>
          </label>
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
                  if (!event.target.checked) update(value.ownNameRu || "", "");
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
          {names?.issue && (
            <p className="field-error" id={`${id}-error`} role="alert">
              {names.issue}
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
              Полное название · RU
              <input
                autoFocus
                required
                maxLength={500}
                value={value.nameRu}
                onChange={(event) =>
                  onChange({ ...value, nameRu: event.target.value })
                }
              />
            </label>
            <label>
              Полное название · KZ
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
    </div>
  );
}
