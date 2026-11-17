"use client";
import { useEffect, useState } from "react";
import { Notice } from "@demo/ui";
import { api, copyRegistry, downloadExport, errorText, json } from "@/lib/api";
import { templateLabels, type Customer, type Draft } from "@/lib/types";
import { profileOwner, soleGroupEmployer, uniqueCustomerProfile } from "@/lib/request-customer-defaults";
import { RecordPicker } from "./record-picker";
type Column = {
  field: string;
  title: string;
  type: "TEXT" | "DATE_ONLY";
  program?: string;
};
type OutputProfile = {
  name: string;
  customerId?: string | null;
  contact?: string;
  columns: Column[];
  rowMode: "PER_ASSIGNMENT" | "PER_PERSON";
  sort: string;
  dateFormat: string;
  language: string;
  files: {
    grouping: string;
    nameFields: string[];
    includeRegistry: boolean;
    includeInventory: boolean;
    includeCoverText: boolean;
  };
};
type Stored = {
  id: string;
  name: string;
  customerId?: string | null;
  profile?: OutputProfile;
  data?: OutputProfile;
};
const fields: [string, string][] = [
  ["personnelNumber", "Табельный номер"],
  ["externalId", "Внешний ID"],
  ["fullNameRu", "ФИО RU"],
  ["fullNameKz", "ФИО KZ"],
  ["positionRu", "Должность"],
  ["departmentRu", "Подразделение"],
  ["trainingSubject", "Программа / тема обучения"],
  ["hours", "Объём обучения, часов"],
  ["trainingStart", "Начало обучения"],
  ["trainingEnd", "Окончание обучения"],
  ["templateLabel", "Документ"],
  ["documentNumber", "Номер документа"],
  ["protocolNumber", "Номер протокола"],
  ["documentDate", "Дата документа"],
  ["validUntil", "Действителен до"],
  ["result", "Результат"],
];
const fileNameFields: [string, string][] = [
  ["personnelNumber", "Табельный номер"],
  ["fullNameRu", "ФИО RU"],
  ["fullNameKz", "ФИО KZ"],
  ["templateLabel", "Название документа"],
  ["documentNumber", "Номер документа"],
];
const defaults: OutputProfile = {
  name: "Комплект заказчика",
  columns: fields
    .filter(([field]) =>
      [
        "personnelNumber",
        "fullNameRu",
        "templateLabel",
        "documentNumber",
        "documentDate",
      ].includes(field),
    )
    .map(([field, title]) => ({
      field,
      title,
      type: field.endsWith("Date") ? "DATE_ONLY" : "TEXT",
    })),
  rowMode: "PER_ASSIGNMENT",
  sort: "SOURCE_ORDER",
  dateFormat: "DD.MM.YYYY",
  language: "ru",
  files: {
    grouping: "BY_PERSON",
    nameFields: [
      "personnelNumber",
      "fullNameRu",
      "templateLabel",
      "documentNumber",
    ],
    includeRegistry: true,
    includeInventory: true,
    includeCoverText: true,
  },
};
function changedFields<T extends object>(before: T, after: T): Partial<T> {
  const changes: Partial<T> = {};
  for (const key of Object.keys(after) as (keyof T)[])
    if (after[key] !== before[key]) changes[key] = after[key];
  return changes;
}

export function CustomerOutput({
  draft,
  canManage,
  embedded = false,
}: {
  draft: Draft;
  canManage: boolean;
  embedded?: boolean;
}) {
  const [open, setOpen] = useState(embedded);
  const [chosenCustomer, setChosenCustomer] = useState<string>();
  const customerId =
    chosenCustomer ?? (draft.customerId || soleGroupEmployer(draft) || "");
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [customerPicker, setCustomerPicker] = useState(false);
  const [partialCustomer, setPartialCustomer] = useState("");
  const allowPartial = Boolean(customerId && partialCustomer === customerId);
  const [edited, setEdited] = useState<{
    customerId: string;
    selectedId?: string;
    fields?: Partial<Omit<OutputProfile, "files">>;
    files?: Partial<OutputProfile["files"]>;
  } | null>(null);
  const [saved, setSaved] = useState<Stored[]>([]);
  const [profilesLoaded, setProfilesLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const relatedCustomerIds = [
    ...new Set(
      [draft.customerId, ...draft.items.map((item) => item.employerId)].filter(
        (id): id is string => !!id,
      ),
    ),
  ];
  const relatedCustomerKey = relatedCustomerIds.join("|");
  useEffect(() => {
    if (!open) return;
    let active = true;
    const pending = relatedCustomerKey.split("|").filter(Boolean);
    void Promise.all(
      Array.from({ length: Math.min(4, pending.length) }, async () => {
        for (let id = pending.shift(); id; id = pending.shift()) {
          try {
            const value = await api<Customer>(`/customers/${id}`);
            if (active)
              setCustomers((old) => [
                ...old.filter((customer) => customer.id !== id),
                value,
              ]);
          } catch (caught) {
            if (active) setError(errorText(caught));
          }
        }
      }),
    );
    return () => {
      active = false;
    };
  }, [open, relatedCustomerKey]);
  useEffect(() => {
    if (!open) return;
    let active = true;
    setProfilesLoaded(false);
    void api<{ items: Stored[] }>("/customer-export-profiles")
      .then((result) => {
        if (active) setSaved(result.items);
      })
      .catch((cause) => {
        if (active) setError(errorText(cause));
      })
      .finally(() => {
        if (active) setProfilesLoaded(true);
      });
    return () => {
      active = false;
    };
  }, [open]);
  const applicableProfiles = saved.filter(
    (p) => !profileOwner(p) || profileOwner(p) === customerId,
  );
  const automatic = uniqueCustomerProfile(saved, customerId);
  const manual = edited?.customerId === customerId ? edited : null;
  const selected =
    manual?.selectedId !== undefined
      ? applicableProfiles.find((p) => p.id === manual.selectedId)
      : automatic;
  const base = selected?.profile || selected?.data || defaults;
  const profile: OutputProfile = {
    ...base,
    ...manual?.fields,
    files: { ...base.files, ...manual?.files },
  };
  const profileId = manual?.fields || manual?.files ? "" : selected?.id || "";
  const awaitingProfile =
    !!customerId && !profilesLoaded && manual?.selectedId === undefined;
  function setProfile(value: OutputProfile) {
    const { files, ...fields } = value;
    setEdited({
      ...manual,
      customerId,
      fields: { ...manual?.fields, ...changedFields(profile, fields) },
      files: { ...manual?.files, ...changedFields(profile.files, files) },
    });
  }
  function chooseCustomer(id: string) {
    setChosenCustomer(id);
    setEdited(null);
    setPartialCustomer("");
    setSuccess("");
    setError("");
  }
  const exportOptions = {
    customerId: customerId || undefined,
    profile: { ...profile, customerId: customerId || null },
    allowPartial,
  };
  const needsCustomer = relatedCustomerIds.length > 0 && !customerId;
  const programs = [
    ...new Set(
      draft.items.flatMap((item) => item.assignments.map((a) => a.templateId)),
    ),
  ];
  async function run(action: () => Promise<unknown>, message: string) {
    setBusy(true);
    setError("");
    setSuccess("");
    try {
      await action();
      setSuccess(message);
    } catch (c) {
      setError(errorText(c));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className={embedded ? undefined : "panel common-context"}>
      {!embedded && (
        <div className="toolbar">
          <div>
            <h2>Комплект для заказчика</h2>
          </div>
          <button onClick={() => setOpen(!open)} aria-expanded={open}>
            {open ? "Свернуть" : "Настроить выдачу"}
          </button>
        </div>
      )}
      {open && (
        <div className="context-body">
          {error && <Notice>{error}</Notice>}
          {success && <Notice kind="success">{success}</Notice>}
          <div className="form-grid">
            <label>
              Заказчик этого комплекта
              <select
                aria-label="Заказчик этого комплекта"
                disabled={busy}
                value={customerId}
                onChange={(e) => chooseCustomer(e.target.value)}
              >
                <option value="">
                  {relatedCustomerIds.length
                    ? "Выберите заказчика комплекта"
                    : "Личная выдача без организации"}
                </option>
                {[
                  ...new Set([
                    ...relatedCustomerIds,
                    ...customers.map((customer) => customer.id),
                  ]),
                ].map((id, index) => (
                  <option key={id} value={id}>
                    {customers.find((customer) => customer.id === id)?.nameRu ||
                      draft.items.find((item) => item.employerId === id)
                        ?.workplaceRu ||
                      `Организация из заявки ${index + 1}`}
                  </option>
                ))}
              </select>
              <small>
                Реестр и файлы отбираются по сохранённой принадлежности
                участников выбранной организации.
              </small>
            </label>
            <div>
              <button disabled={busy} onClick={() => setCustomerPicker(true)}>
                Найти заказчика комплекта
              </button>
            </div>
          </div>
          {needsCustomer && (
            <p>Выберите организацию для её комплекта документов.</p>
          )}
          {customerId && (
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={allowPartial}
                onChange={(e) =>
                  setPartialCustomer(e.target.checked ? customerId : "")
                }
                disabled={busy}
              />
              Разрешить частичный ZIP: исключить общие протоколы с участниками
              других организаций и указать непереданные файлы в описи
            </label>
          )}
          <div className="form-grid">
            <label>
              Сохранённый профиль
              <select
                aria-label="Сохранённый профиль"
                value={profileId}
                onChange={(e) => {
                  setEdited({ customerId, selectedId: e.target.value });
                }}
              >
                <option value="">Текущие настройки</option>
                {applicableProfiles.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Контакт получателя комплекта
              <input
                value={profile.contact || ""}
                onChange={(e) =>
                  setProfile({ ...profile, contact: e.target.value })
                }
                placeholder="Имя, подразделение, согласованный контакт"
              />
            </label>
            <label>
              Язык сопроводительных сведений
              <select
                aria-label="Язык сопроводительных сведений"
                value={profile.language}
                onChange={(e) =>
                  setProfile({ ...profile, language: e.target.value })
                }
              >
                <option value="ru">Русский</option>
                <option value="kz">Қазақша</option>
              </select>
            </label>
            <label>
              Название профиля
              <input
                value={profile.name}
                onChange={(e) =>
                  setProfile({ ...profile, name: e.target.value })
                }
              />
            </label>
            <label>
              Строки реестра
              <select
                value={profile.rowMode}
                onChange={(e) =>
                  setProfile({
                    ...profile,
                    rowMode: e.target.value as OutputProfile["rowMode"],
                  })
                }
              >
                <option value="PER_ASSIGNMENT">Одна строка на документ</option>
                <option value="PER_PERSON">Одна строка на человека</option>
              </select>
              <small>
                При нескольких разных значениях сервер попросит уточнить
                направления колонок.
              </small>
            </label>
            <label>
              Порядок строк
              <select
                value={profile.sort}
                onChange={(e) =>
                  setProfile({ ...profile, sort: e.target.value })
                }
              >
                <option value="SOURCE_ORDER">Исходный порядок</option>
                <option value="NAME">По ФИО</option>
                <option value="PERSONNEL_NUMBER">По табельному номеру</option>
                <option value="DEPARTMENT">По подразделению</option>
              </select>
            </label>
            <label>
              Формат дат
              <select
                value={profile.dateFormat}
                onChange={(e) =>
                  setProfile({ ...profile, dateFormat: e.target.value })
                }
              >
                <option value="DD.MM.YYYY">ДД.ММ.ГГГГ</option>
                <option value="YYYY-MM-DD">ГГГГ-ММ-ДД</option>
              </select>
            </label>
            <label>
              Папки в ZIP
              <select
                value={profile.files.grouping}
                onChange={(e) =>
                  setProfile({
                    ...profile,
                    files: { ...profile.files, grouping: e.target.value },
                  })
                }
              >
                <option value="BY_PERSON">По получателям</option>
                <option value="BY_PROGRAM">По направлениям</option>
                <option value="BY_DEPARTMENT">По подразделениям</option>
                <option value="FLAT">Одна папка</option>
              </select>
            </label>
          </div>
          <fieldset>
            <legend>Имена файлов</legend>
            <div className="export-columns">
              {profile.files.nameFields.map((field, index) => {
                const label =
                  fileNameFields.find(([key]) => key === field)?.[1] || field;
                return (
                  <div className="export-column" key={field}>
                    <span>
                      {index + 1}. {label}
                    </span>
                    <button
                      aria-label={`Поднять поле имени файла ${label}`}
                      disabled={!index}
                      onClick={() => {
                        const nameFields = [...profile.files.nameFields];
                        [nameFields[index - 1], nameFields[index]] = [
                          nameFields[index],
                          nameFields[index - 1],
                        ];
                        setProfile({
                          ...profile,
                          files: { ...profile.files, nameFields },
                        });
                      }}
                    >
                      Выше
                    </button>
                    <button
                      aria-label={`Убрать поле имени файла ${label}`}
                      disabled={profile.files.nameFields.length === 1}
                      onClick={() =>
                        setProfile({
                          ...profile,
                          files: {
                            ...profile.files,
                            nameFields: profile.files.nameFields.filter(
                              (_, at) => at !== index,
                            ),
                          },
                        })
                      }
                    >
                      Убрать
                    </button>
                  </div>
                );
              })}
            </div>
            <label>
              Добавить поле имени файла
              <select
                value=""
                disabled={
                  profile.files.nameFields.length >= fileNameFields.length
                }
                onChange={(e) => {
                  if (e.target.value)
                    setProfile({
                      ...profile,
                      files: {
                        ...profile.files,
                        nameFields: [
                          ...profile.files.nameFields,
                          e.target.value,
                        ],
                      },
                    });
                }}
              >
                <option value="">Выберите поле</option>
                {fileNameFields
                  .filter(
                    ([field]) => !profile.files.nameFields.includes(field),
                  )
                  .map(([field, label]) => (
                    <option key={field} value={field}>
                      {label}
                    </option>
                  ))}
              </select>
            </label>
            <p aria-live="polite" className="fine-print">
              Схема:{" "}
              {profile.files.nameFields
                .map(
                  (field) =>
                    `[${fileNameFields.find(([key]) => key === field)?.[1] || field}]`,
                )
                .join(" — ")}
              .pdf
            </p>
          </fieldset>
          <fieldset>
            <legend>Колонки и порядок</legend>
            <div className="export-columns">
              {profile.columns.map((column, index) => (
                <div className="export-column" key={`${column.field}-${index}`}>
                  <label>
                    {fields.find(([field]) => field === column.field)?.[1]}
                    <input
                      value={column.title}
                      onChange={(e) =>
                        setProfile({
                          ...profile,
                          columns: profile.columns.map((c, i) =>
                            i === index ? { ...c, title: e.target.value } : c,
                          ),
                        })
                      }
                    />
                  </label>
                  {profile.rowMode === "PER_PERSON" &&
                    ![
                      "personnelNumber",
                      "externalId",
                      "fullNameRu",
                      "fullNameKz",
                      "positionRu",
                      "departmentRu",
                    ].includes(column.field) && (
                      <label>
                        Направление колонки
                        <select
                          aria-label={`Направление колонки ${index + 1}`}
                          value={column.program || ""}
                          onChange={(e) =>
                            setProfile({
                              ...profile,
                              columns: profile.columns.map((c, i) =>
                                i === index
                                  ? {
                                      ...c,
                                      program: e.target.value || undefined,
                                    }
                                  : c,
                              ),
                            })
                          }
                        >
                          <option value="">
                            Общее, если значения совпадают
                          </option>
                          {programs.map((program) => (
                            <option key={program} value={program}>
                              {templateLabels[program]}
                            </option>
                          ))}
                        </select>
                      </label>
                    )}
                  <button
                    aria-label={`Повторить колонку ${column.title} для другого направления`}
                    disabled={
                      profile.rowMode !== "PER_PERSON" ||
                      profile.columns.length >= 60
                    }
                    onClick={() =>
                      setProfile({
                        ...profile,
                        columns: [
                          ...profile.columns,
                          {
                            ...column,
                            title: `${column.title} (другое направление)`,
                            program: undefined,
                          },
                        ],
                      })
                    }
                  >
                    Для другой программы
                  </button>
                  <button
                    aria-label={`Поднять колонку ${column.title}`}
                    disabled={!index}
                    onClick={() => {
                      const columns = [...profile.columns];
                      [columns[index - 1], columns[index]] = [
                        columns[index],
                        columns[index - 1],
                      ];
                      setProfile({ ...profile, columns });
                    }}
                  >
                    Выше
                  </button>
                  <button
                    aria-label={`Убрать колонку ${column.title}`}
                    disabled={profile.columns.length === 1}
                    onClick={() =>
                      setProfile({
                        ...profile,
                        columns: profile.columns.filter((_, i) => i !== index),
                      })
                    }
                  >
                    Убрать
                  </button>
                </div>
              ))}
            </div>
            <label>
              Добавить колонку
              <select
                value=""
                onChange={(e) => {
                  if (e.target.value)
                    setProfile({
                      ...profile,
                      columns: [
                        ...profile.columns,
                        {
                          field: e.target.value,
                          title: fields.find(([f]) => f === e.target.value)![1],
                          type: [
                            "documentDate",
                            "validUntil",
                            "trainingStart",
                            "trainingEnd",
                          ].includes(e.target.value)
                            ? "DATE_ONLY"
                            : "TEXT",
                        },
                      ],
                    });
                }}
              >
                <option value="">Выберите поле</option>
                {fields
                  .filter(([f]) => !profile.columns.some((c) => c.field === f))
                  .map(([f, title]) => (
                    <option key={f} value={f}>
                      {title}
                    </option>
                  ))}
              </select>
            </label>
          </fieldset>
          <p className="fine-print">
            В комплект входят реестр, опись и сопроводительный текст. Передачу
            заказчику отметьте отдельно.
          </p>
          <div className="toolbar-actions">
            {canManage && (
              <button
                disabled={
                  busy ||
                  awaitingProfile ||
                  needsCustomer ||
                  !profile.name.trim()
                }
                onClick={() =>
                  void run(async () => {
                    const entry = await api<Stored>(
                      "/customer-export-profiles",
                      {
                        method: "POST",
                        body: json({
                          ...profile,
                          customerId: customerId || null,
                        }),
                      },
                    );
                    setSaved((previous) => [
                      ...previous.filter((row) => row.id !== entry.id),
                      entry,
                    ]);
                    setEdited({ customerId, selectedId: entry.id });
                  }, "Профиль сохранён для следующих заказов.")
                }
              >
                Сохранить профиль
              </button>
            )}
            <button
              disabled={busy || awaitingProfile || needsCustomer}
              onClick={() =>
                void run(
                  () =>
                    copyRegistry(`/print-requests/${draft.id}/export`, {
                      format: "TSV",
                      ...exportOptions,
                    }),
                  "Таблица скопирована. Можно вставить в Excel или Google Sheets.",
                )
              }
            >
              Копировать таблицу
            </button>
            <button
              disabled={busy || awaitingProfile || needsCustomer}
              onClick={() =>
                void run(
                  () =>
                    downloadExport(
                      `/print-requests/${draft.id}/export`,
                      { format: "XLSX", ...exportOptions },
                      "Реестр заказчика.xlsx",
                    ),
                  "Реестр подготовлен.",
                )
              }
            >
              Реестр XLSX
            </button>
            <button
              disabled={
                busy ||
                awaitingProfile ||
                needsCustomer ||
                draft.status === "DRAFT"
              }
              onClick={() =>
                void run(
                  () =>
                    downloadExport(
                      `/print-requests/${draft.id}/export`,
                      { format: "ZIP", ...exportOptions },
                      "Комплект заказчика.zip",
                    ),
                  "Комплект подготовлен.",
                )
              }
            >
              Комплект ZIP
            </button>
          </div>
        </div>
      )}
      {customerPicker && (
        <RecordPicker
          kind="customers"
          onClose={() => setCustomerPicker(false)}
          onCustomer={(customer) => {
            setCustomers((old) => [
              ...old.filter((value) => value.id !== customer.id),
              customer,
            ]);
            chooseCustomer(customer.id);
            setCustomerPicker(false);
          }}
        />
      )}
    </section>
  );
}
