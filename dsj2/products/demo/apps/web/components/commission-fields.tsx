"use client";

import { Icon } from "@demo/ui";
import { commissionMissingNames, type Commission } from "@/lib/commission";
import { useCabinetText } from "./cabinet-language";
import "./commission-fields.css";

export function CommissionFields({
  value,
  onChange,
  idPrefix = "commission",
  showErrors = false,
  disabled = false,
  requiredCount = 3,
}: {
  value: Commission;
  onChange: (value: Commission) => void;
  idPrefix?: string;
  showErrors?: boolean;
  disabled?: boolean;
  requiredCount?: number;
}) {
  const tr = useCabinetText();
  const rows = Array.from(
    { length: Math.max(3, value.length) },
    (_, index) => value[index] || { name: "", position: "" },
  );
  const missing = showErrors
    ? commissionMissingNames(value, requiredCount)
    : [];
  function update(index: number, patch: Partial<Commission[number]>) {
    onChange(
      rows.map((person, row) =>
        row === index ? { ...person, ...patch } : person,
      ),
    );
  }
  return (
    <div className="commission-fields">
      <p className="fine-print" id={`${idPrefix}-hint`}>
        {tr(
          "Для протокола БиОТ укажите председателя и не менее двух членов комиссии. Должность — при необходимости.",
        )}
      </p>
      {rows.map((person, index) => {
        const role =
          index === 0
            ? tr("Председатель комиссии")
            : `${tr("Член комиссии")} ${index}`;
        const nameId = `${idPrefix}-name-${index}`;
        return (
          <fieldset
            key={index}
            className="commission-person"
            disabled={disabled}
          >
            <legend>{role}</legend>
            <div className="commission-person-fields">
              <label htmlFor={nameId}>
                {tr("ФИО")}
                <input
                  id={nameId}
                  aria-label={`${role} — ${tr("ФИО")}`}
                  maxLength={255}
                  value={person.name}
                  aria-invalid={missing.includes(index)}
                  aria-describedby={
                    missing.includes(index)
                      ? `${nameId}-error`
                      : `${idPrefix}-hint`
                  }
                  onChange={(event) =>
                    update(index, { name: event.target.value })
                  }
                />
                {missing.includes(index) && (
                  <span className="field-error" id={`${nameId}-error`}>
                    {tr("Укажите ФИО.")}
                  </span>
                )}
              </label>
              <label htmlFor={`${idPrefix}-position-${index}`}>
                {tr("Должность (необязательно)")}
                <input
                  id={`${idPrefix}-position-${index}`}
                  aria-label={`${role} — ${tr("Должность")}`}
                  maxLength={255}
                  value={person.position}
                  onChange={(event) =>
                    update(index, { position: event.target.value })
                  }
                />
              </label>
            </div>
            {index >= 3 && (
              <button
                type="button"
                onClick={() => onChange(rows.filter((_, row) => row !== index))}
              >
                {tr("Удалить члена комиссии")} {index}
              </button>
            )}
          </fieldset>
        );
      })}
      <button
        type="button"
        disabled={disabled || rows.length >= 12}
        onClick={() => onChange([...rows, { name: "", position: "" }])}
      >
        <Icon name="plus" /> {tr("Добавить члена комиссии")}
      </button>
    </div>
  );
}
