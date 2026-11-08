"use client";

import { useState } from "react";
import { Icon } from "@demo/ui";
import { isBlankText, type IssuerProfile } from "@demo/contracts";
import { commissionMissingNames, type Commission } from "@/lib/commission";
import {
  COMMISSION_POSITIONS,
  commissionTemplateRows,
  fillCommissionPositions,
  suggestedCommissionTemplate,
  commissionRoleAsPosition,
  type CommissionTemplate,
} from "@/lib/commission-template";
import { useCabinetText } from "./cabinet-language";
import "./commission-fields.css";

export function CommissionFields({
  value,
  onChange,
  idPrefix = "commission",
  showErrors = false,
  disabled = false,
  requiredCount = 3,
  headName,
  people = [],
}: {
  value: Commission;
  onChange: (value: Commission) => void;
  idPrefix?: string;
  showErrors?: boolean;
  disabled?: boolean;
  requiredCount?: number;
  headName?: string;
  people?: IssuerProfile["people"];
}) {
  const tr = useCabinetText();
  const [template, setTemplate] = useState<CommissionTemplate>(() =>
    suggestedCommissionTemplate(value),
  );
  const [customRows, setCustomRows] = useState<Set<number>>(new Set());
  const rows = commissionTemplateRows(value, template);
  const started = value.some((person) =>
    Object.values(person).some((field) => !isBlankText(field)),
  );
  const hasEmptyPosition = rows
    .slice(0, 3)
    .some((person) => isBlankText(person.position));
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
      <div className="commission-template-controls">
        <label htmlFor={`${idPrefix}-template`}>
          {tr("Шаблон состава")}
          <select
            id={`${idPrefix}-template`}
            disabled={disabled || (started && !hasEmptyPosition)}
            value={template}
            onChange={(event) =>
              setTemplate(event.target.value as CommissionTemplate)
            }
            aria-describedby={
              started && !hasEmptyPosition
                ? `${idPrefix}-template-hint`
                : undefined
            }
          >
            <option value="umo-chair">
              {tr("Начальник УМО — председатель")}
            </option>
            <option value="director-chair">
              {tr("Директор — председатель")}
            </option>
          </select>
        </label>
        {started && hasEmptyPosition && (
          <button
            type="button"
            disabled={disabled}
            onClick={() => {
              const next = fillCommissionPositions(value, template);
              setCustomRows(
                (current) =>
                  new Set(
                    [...current].filter(
                      (index) =>
                        index >= 3 || !isBlankText(rows[index]?.position),
                    ),
                  ),
              );
              onChange(next);
            }}
          >
            {tr("Заполнить пустые должности")}
          </button>
        )}
      </div>
      {started && !hasEmptyPosition && (
        <p className="fine-print" id={`${idPrefix}-template-hint`}>
          {tr("Должности уже заполнены. Измените их в строках ниже.")}
        </p>
      )}
      {rows.map((person, index) => {
        const role =
          index === 0
            ? tr("Председатель комиссии")
            : `${tr("Член комиссии")} ${index}`;
        const nameId = `${idPrefix}-name-${index}`;
        const preset = COMMISSION_POSITIONS.find(
          (position) => position === person.position,
        );
        const custom =
          customRows.has(index) || (!preset && !isBlankText(person.position));
        const staff = people.filter(
          (entry) =>
            !isBlankText(entry.name) &&
            (entry.position.trim().toLocaleLowerCase() ===
              person.position.trim().toLocaleLowerCase() ||
              (person.position === "Преподаватель" &&
                entry.role === "TEACHER")),
        );
        return (
          <fieldset
            key={index}
            className="commission-person"
            disabled={disabled}
          >
            <legend>{role}</legend>
            <div className="commission-person-fields">
              <div>
                <label htmlFor={nameId}>
                  {tr("ФИО")}
                  <input
                    id={nameId}
                    aria-label={`${role} — ${tr("ФИО")}`}
                    maxLength={255}
                    value={person.name}
                    aria-invalid={missing.includes(index)}
                    aria-describedby={
                      missing.includes(index) ? `${nameId}-error` : undefined
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
                {isBlankText(person.name) &&
                  person.position === "Директор" &&
                  !isBlankText(headName) && (
                    <button
                      type="button"
                      className="commission-use-person"
                      onClick={() => update(index, { name: headName!.trim() })}
                    >
                      {tr("Подставить руководителя центра")}
                    </button>
                  )}
                {isBlankText(person.name) && staff.length > 0 && (
                  <select
                    aria-label={`${role} — ${tr("Выбрать сотрудника центра")}`}
                    value=""
                    onChange={(event) => {
                      if (!event.target.value) return;
                      const candidate = staff[Number(event.target.value)];
                      if (candidate) update(index, { name: candidate.name });
                    }}
                  >
                    <option value="">{tr("Выбрать сотрудника центра")}</option>
                    {staff.map((candidate, candidateIndex) => (
                      <option key={candidateIndex} value={candidateIndex}>
                        {candidate.name}
                        {candidate.position ? ` · ${candidate.position}` : ""}
                      </option>
                    ))}
                  </select>
                )}
              </div>
              <div>
                <label htmlFor={`${idPrefix}-position-${index}`}>
                  {tr("Должность в организации")}
                  <select
                    id={`${idPrefix}-position-${index}`}
                    aria-label={`${role} — ${tr("Должность")}`}
                    value={custom ? "custom" : person.position}
                    onChange={(event) => {
                      const next = event.target.value;
                      setCustomRows((current) => {
                        const values = new Set(current);
                        if (next === "custom") values.add(index);
                        else values.delete(index);
                        return values;
                      });
                      update(index, {
                        position:
                          next === "custom"
                            ? custom
                              ? person.position
                              : ""
                            : next,
                      });
                    }}
                  >
                    <option value="">{tr("Выберите должность")}</option>
                    {COMMISSION_POSITIONS.map((position) => (
                      <option key={position} value={position}>
                        {tr(position)}
                      </option>
                    ))}
                    <option value="custom">{tr("Другая должность")}</option>
                  </select>
                </label>
                {custom && (
                  <label htmlFor={`${idPrefix}-custom-position-${index}`}>
                    {tr("Другая должность")}
                    <input
                      id={`${idPrefix}-custom-position-${index}`}
                      aria-label={`${role} — ${tr("Другая должность")}`}
                      maxLength={255}
                      value={person.position}
                      onChange={(event) =>
                        update(index, { position: event.target.value })
                      }
                    />
                  </label>
                )}
                {commissionRoleAsPosition(person.position) && (
                  <p className="fine-print">
                    {tr(
                      "Здесь указана роль в комиссии. Выберите должность сотрудника в организации.",
                    )}
                  </p>
                )}
              </div>
            </div>
            {index >= 3 && (
              <button
                type="button"
                onClick={() => {
                  setCustomRows(
                    (current) =>
                      new Set(
                        [...current]
                          .filter((row) => row !== index)
                          .map((row) => (row > index ? row - 1 : row)),
                      ),
                  );
                  onChange(rows.filter((_, row) => row !== index));
                }}
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
