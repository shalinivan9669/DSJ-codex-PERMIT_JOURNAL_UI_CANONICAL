"use client";
import { useEffect, useRef, useState } from "react";
import { Notice } from "@demo/ui";
import { api, copyRegistry, downloadExport, errorText, json } from "@/lib/api";
import { templateLabels, type Customer, type Draft } from "@/lib/types";
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
export function CustomerOutput({
  draft,
  canManage,
}: {
  draft: Draft;
  canManage: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [customerId, setCustomerId] = useState(draft.customerId || "");
  const customerChosen = useRef(false);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [customerPicker, setCustomerPicker] = useState(false);
  const [allowPartial, setAllowPartial] = useState(false);
  const [profile, setProfile] = useState<OutputProfile>({
    ...defaults,
    customerId: draft.customerId,
  });
  const [saved, setSaved] = useState<Stored[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [profileId, setProfileId] = useState("");
  const relatedCustomerIds = [
    ...new Set(
      [draft.customerId, ...draft.items.map((item) => item.employerId)].filter(
        (id): id is string => !!id,
      ),
    ),
  ];
  const relatedCustomerKey = relatedCustomerIds.join("|");
  useEffect(() => {
    if (!customerChosen.current) {
      setCustomerId(draft.customerId || "");
      setProfile((old) => ({ ...old, customerId: draft.customerId }));
    }
  }, [draft.customerId]);
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
    if (open)
      void api<{ items: Stored[] }>("/customer-export-profiles")
        .then((r) => setSaved(r.items))
        .catch((c) => setError(errorText(c)));
  }, [open]);
  const applicableProfiles = saved.filter((p) => {
    const owner = p.customerId || p.profile?.customerId || p.data?.customerId;
    return !owner || owner === customerId;
  });
  const suggestion = applicableProfiles.find(
    (p) =>
      (p.customerId || p.profile?.customerId || p.data?.customerId) ===
        customerId && customerId,
  );
  function chooseCustomer(id: string) {
    customerChosen.current = true;
    setCustomerId(id);
    setProfile({ ...structuredClone(defaults), customerId: id || null });
    setProfileId("");
    setAllowPartial(false);
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
    <section className="panel common-context">
      <div className="toolbar">
        <div>
          <h2>Комплект для заказчика</h2>
          <span className="muted">
            Колонки, порядок и названия файлов из согласованного профиля
          </span>
        </div>
        <button onClick={() => setOpen(!open)} aria-expanded={open}>
          {open ? "Свернуть" : "Настроить выдачу"}
        </button>
      </div>
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
            <p>
              Выберите организацию: комплект заказчика содержит только
              относящиеся к ней строки и файлы.
            </p>
          )}
          {customerId && (
            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={allowPartial}
                onChange={(e) => setAllowPartial(e.target.checked)}
                disabled={busy}
              />
              Разрешить частичный ZIP: исключить общие протоколы с участниками
              других организаций и указать непереданные файлы в описи
            </label>
          )}
          {!profileId && suggestion && (
            <Notice kind="success">
              Для заказчика сохранён профиль «{suggestion.name}».{" "}
              <button
                onClick={() => {
                  const value = suggestion.profile || suggestion.data;
                  if (value) {
                    setProfile(value);
                    setProfileId(suggestion.id);
                  }
                }}
              >
                Применить сохранённые настройки
              </button>
            </Notice>
          )}
          <div className="form-grid">
            <label>
              Сохранённый профиль
              <select
                value={profileId}
                onChange={(e) => {
                  setProfileId(e.target.value);
                  const value = applicableProfiles.find(
                    (p) => p.id === e.target.value,
                  );
                  if (value) {
                    const p = value.profile || value.data;
                    if (p) setProfile(p);
                  }
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
            <p className="fine-print">
              Поля соединяются в выбранном порядке. Пустые значения
              пропускаются; расширение, безопасные символы и различимые имена
              совпадающих файлов система добавляет при сборке комплекта.
            </p>
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
                          type: ["documentDate", "validUntil"].includes(
                            e.target.value,
                          )
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
            Табельные и регистрационные номера сохраняются как текст. Комплект
            содержит реестр, опись и подготовленный сопроводительный текст.
            Отправка фиксируется отдельно.
          </p>
          <div className="toolbar-actions">
            {canManage && (
              <button
                disabled={busy || needsCustomer || !profile.name.trim()}
                onClick={() =>
                  void run(
                    () =>
                      api("/customer-export-profiles", {
                        method: "POST",
                        body: json({
                          ...profile,
                          customerId: customerId || null,
                        }),
                      }),
                    "Профиль сохранён для следующих заказов.",
                  )
                }
              >
                Сохранить профиль
              </button>
            )}
            <button
              disabled={busy || needsCustomer}
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
              disabled={busy || needsCustomer}
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
              disabled={busy || needsCustomer || draft.status === "DRAFT"}
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
