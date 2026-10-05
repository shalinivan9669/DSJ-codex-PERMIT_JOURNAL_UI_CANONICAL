"use client";
import { useId, useRef, useState } from "react";
import {
  customerSchema,
  ORGANIZATION_FORMS,
  type OrganizationNames,
} from "@demo/contracts";
import { api, json } from "@/lib/api";
import type { Customer } from "@/lib/types";
import { OrganizationNameFields } from "./organization-name-fields";

export type RequestOrganizationSelection =
  | { mode: "existing"; customerId: string }
  | { mode: "new"; names: OrganizationNames };

export function emptyRequestOrganization(): RequestOrganizationSelection {
  return {
    mode: "new",
    names: {
      legalForm: "TOO",
      ownNameRu: "",
      ownNameKz: "",
      nameRu: "",
      nameKz: "",
    },
  };
}

export async function createRequestCustomer(
  names: OrganizationNames,
  operationKey?: string,
) {
  const parsed = customerSchema.safeParse(names);
  if (!parsed.success)
    throw new Error(
      parsed.error.issues[0]?.message || "Проверьте название компании.",
    );
  return api<Customer>("/customers", {
    method: "POST",
    headers: operationKey ? { "Idempotency-Key": operationKey } : undefined,
    body: json(parsed.data),
  });
}

export function RequestOrganizationFields({
  customers,
  value,
  onChange,
  onEdit,
  onFind,
  disabled = false,
  busy = false,
  error,
}: {
  customers: Customer[];
  value: RequestOrganizationSelection;
  onChange: (value: RequestOrganizationSelection) => void;
  onEdit?: (customer: Customer) => void;
  onFind?: () => void;
  disabled?: boolean;
  busy?: boolean;
  error?: string;
}) {
  const id = useId();
  const [touched, setTouched] = useState(false);
  const [choicesOpen, setChoicesOpen] = useState(false);
  const newNames = useRef<OrganizationNames | null>(null);
  const previousCustomerId = useRef("");
  if (value.mode === "new") newNames.current = value.names;
  else previousCustomerId.current = value.customerId;
  const selected =
    value.mode === "existing"
      ? customers.find((customer) => customer.id === value.customerId)
      : undefined;
  const selectedForm = selected?.legalForm
    ? ORGANIZATION_FORMS.find((form) => form.value === selected.legalForm)
        ?.label
    : "Сохранённое название — как введено";
  if (selected && !choicesOpen)
    return (
      <div className="request-organization-selected-compact">
        <strong>{selected.nameRu || selected.nameKz}</strong>
        <span className="muted">
          {selected.bin ? `БИН ${selected.bin}` : "БИН не указан"}
        </span>
        <button
          type="button"
          className="text-button"
          disabled={disabled || busy}
          onClick={() => setChoicesOpen(true)}
        >
          Сменить компанию
        </button>
        <details>
          <summary>Названия и общая карточка</summary>
          <p>
            RU: {selected.nameRu || "—"}
            <br />
            KZ: {selected.nameKz || "—"}
          </p>
          <small>{selectedForm}</small>
          {onEdit && !disabled && (
            <button
              type="button"
              className="text-button"
              disabled={busy}
              onClick={() => onEdit(selected)}
            >
              Изменить общую карточку организации
            </button>
          )}
          <p className="fine-print">
            Общая карточка используется и в других заявках.
          </p>
        </details>
        {error && (
          <p className="field-error" role="alert">
            {error}
          </p>
        )}
      </div>
    );
  return (
    <div className="request-organization-fields stack">
      <div
        className="request-organization-mode entry-view-switch"
        role="group"
        aria-label="Компания заявки"
      >
        <button
          type="button"
          className="text-button"
          aria-pressed={value.mode === "new"}
          disabled={disabled || busy}
          onClick={() => {
            if (value.mode === "new") return;
            setTouched(false);
            onChange(
              newNames.current
                ? { mode: "new", names: newNames.current }
                : emptyRequestOrganization(),
            );
          }}
        >
          Новая компания
        </button>
        <button
          type="button"
          className="text-button"
          aria-pressed={value.mode === "existing"}
          disabled={disabled || busy}
          onClick={() => {
            if (value.mode === "existing") return;
            setTouched(false);
            onChange({
              mode: "existing",
              customerId: previousCustomerId.current,
            });
          }}
        >
          Из справочника
        </button>
      </div>
      {value.mode === "existing" && (
        <>
          <label>
            Компания
            <select
              data-field-path="customerId"
              value={value.customerId}
              disabled={disabled || busy}
              aria-describedby={error ? `${id}-error` : undefined}
              aria-invalid={!!error}
              onChange={(event) =>
                onChange({ mode: "existing", customerId: event.target.value })
              }
            >
              <option value="">Выберите компанию</option>
              {customers.map((customer) => (
                <option key={customer.id} value={customer.id}>
                  {customer.nameRu}
                  {customer.archived ? " (архив)" : ""}
                </option>
              ))}
            </select>
          </label>
          {onFind && !disabled && (
            <button
              type="button"
              className="text-button"
              disabled={busy}
              onClick={onFind}
            >
              Найти в справочнике
            </button>
          )}
        </>
      )}
      {value.mode === "new" ? (
        <fieldset
          className="request-organization-new stack"
          disabled={disabled || busy}
          onBlurCapture={() => setTouched(true)}
        >
          <legend className="sr-only">Новая компания</legend>
          <OrganizationNameFields
            value={value.names}
            onChange={(names) => onChange({ mode: "new", names })}
            labels={{
              legalForm: "Форма компании",
              ownNameRu: "Название компании",
            }}
            autoFocus={false}
            compactHints
            hideEmptyPreview
            requestEntry
            showRequiredErrors={touched || !!error}
          />
        </fieldset>
      ) : selected ? (
        <button
          type="button"
          className="text-button"
          onClick={() => setChoicesOpen(false)}
        >
          Готово: {selected.nameRu}
        </button>
      ) : null}
      {value.mode === "existing" && selected && choicesOpen ? (
        <div className="request-organization-selected stack">
          <p>
            <strong>Форма компании:</strong> {selectedForm}
          </p>
          <div
            className="form-grid organization-name-preview"
            aria-label="Названия выбранной компании для документов"
          >
            <div>
              <small>Полное название · RU</small>
              <p>{selected.nameRu || "—"}</p>
            </div>
            <div>
              <small>Полное название · KZ</small>
              <p>{selected.nameKz || "—"}</p>
            </div>
          </div>
          {onEdit && !disabled && (
            <div>
              <button
                type="button"
                className="text-button"
                disabled={busy}
                onClick={() => onEdit(selected)}
              >
                Изменить общую карточку организации
              </button>
              <p className="fine-print">
                Общая карточка используется и в других заявках.
              </p>
            </div>
          )}
        </div>
      ) : null}
      {error && (
        <p className="field-error" id={`${id}-error`} role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
