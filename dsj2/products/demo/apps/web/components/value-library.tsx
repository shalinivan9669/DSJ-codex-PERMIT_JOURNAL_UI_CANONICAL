"use client";
import { useEffect, useState } from "react";
import { Notice } from "@demo/ui";
import { api, errorText, json } from "@/lib/api";
import {
  templateLabels,
  type AppContext,
  type Customer,
  type Recipient,
} from "@/lib/types";
import { RecordPicker } from "./record-picker";
import { PortalAccess } from "./portal-access";
import { EvidenceMatrix } from "./evidence-matrix";
import { DossierActions } from "./dossier-actions";
import {
  SourceAttachment,
  type SourceAttachmentRecord,
} from "./source-attachment";
type Entry = {
  id: string;
  title?: string;
  program?: string;
  issuer?: string;
  originalNumber?: string;
  source: string;
  state?: string;
  status?: string;
  version?: string | number;
  validUntil?: string;
  applicability?: string;
  customerVisible?: boolean;
  category?: string;
  attachments?: SourceAttachmentRecord[];
};
export function ValueLibrary({ context }: { context: AppContext }) {
  const [section, setSection] = useState("evidence");
  const [entries, setEntries] = useState<Entry[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [refresh, setRefresh] = useState(0);
  const [open, setOpen] = useState(false);
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [recipient, setRecipient] = useState<Recipient | null>(null);
  const [picker, setPicker] = useState<"customers" | "recipients" | null>(null);
  const [form, setForm] = useState<Record<string, string>>({});
  const [verify, setVerify] = useState<Record<string, string>>({});
  const [extraTemplates, setExtraTemplates] = useState<string[]>([]);
  const [requirements, setRequirements] = useState<
    { key: string; label: string; source: string; stage: string }[]
  >([]);
  const readonly = context.user.role === "VIEWER";
  useEffect(() => {
    let alive = true;
    setBusy(true);
    api<{ items: Entry[] }>(`/${section}`)
      .then((r) => {
        if (alive) {
          setEntries(r.items);
          setError("");
        }
      })
      .catch((c) => {
        if (alive) setError(errorText(c));
      })
      .finally(() => {
        if (alive) setBusy(false);
      });
    return () => {
      alive = false;
    };
  }, [section, refresh]);
  async function run(action: () => Promise<unknown>, message: string) {
    setBusy(true);
    setError("");
    try {
      await action();
      setSuccess(message);
      setRefresh((v) => v + 1);
    } catch (c) {
      setError(errorText(c));
    } finally {
      setBusy(false);
    }
  }
  const field = (
    key: string,
    label: string,
    type = "text",
    required = true,
  ) => (
    <label key={key}>
      {label}
      <input
        type={type}
        required={required}
        value={form[key] || ""}
        onChange={(e) => setForm({ ...form, [key]: e.target.value })}
      />
    </label>
  );
  async function create() {
    let body: unknown;
    if (section === "evidence")
      body = {
        customerId: customer?.id,
        recipientId: recipient?.recipientId,
        program: form.title,
        issuer: form.issuer,
        originalNumber: form.originalNumber,
        documentDate: form.documentDate,
        validUntil: form.validUntil || null,
        source: form.source,
      };
    else if (section === "dossier")
      body = {
        title: form.title,
        category: form.category || "PROGRAM",
        version: form.version,
        source: form.source,
        applicability: form.applicability,
        validUntil: form.validUntil || null,
        ownerId: context.user.id,
        customerVisible: form.customerVisible === "true",
      };
    else
      body = {
        serviceKey: form.serviceKey,
        title: form.title,
        status: form.status || "DRAFT",
        source: form.source,
        applicability: form.applicability,
        checkedOn: form.checkedOn || null,
        effectiveFrom: form.effectiveFrom || null,
        effectiveTo: form.effectiveTo || null,
        definition: {
          programVersion: form.version,
          category: form.category || "",
          compatibleTemplateIds: [
            ...new Set([form.templateId, ...extraTemplates].filter(Boolean)),
          ],
          requirements: [
            ...(form.requirement
              ? [
                  {
                    key: "primary",
                    label: form.requirement,
                    source: form.requirementSource || "CONTRACT",
                    stage: form.stage || "EVIDENCE",
                  },
                ]
              : []),
            ...requirements,
          ],
          limitation: form.limitation || "",
        },
      };
    await api(`/${section}`, { method: "POST", body: json(body) });
    setOpen(false);
    setForm({});
    setExtraTemplates([]);
    setRequirements([]);
  }
  return (
    <section className="panel workbench-detail">
      <div className="tabs" role="tablist" aria-label="Источники и правила">
        {[
          ["evidence", "Внешние документы"],
          ["dossier", "Досье центра"],
          ["service-rules", "Паспорта услуг"],
        ].map(([key, label]) => (
          <button
            key={key}
            role="tab"
            aria-selected={section === key}
            onClick={() => {
              setSection(key);
              setOpen(false);
              setForm({});
              setExtraTemplates([]);
              setRequirements([]);
              setSuccess("");
            }}
          >
            {label}
          </button>
        ))}
      </div>
      {error && <Notice>{error}</Notice>}
      {success && <Notice kind="success">{success}</Notice>}
      {section === "evidence" && <EvidenceMatrix context={context} />}
      {section === "dossier" && (
        <DossierActions records={entries} timezone={context.tenant.timezone} />
      )}
      <p>
        {section === "evidence"
          ? "Сведения об источниках документов. Статус проверки отличается от наличия файла и не является допуском к работе."
          : section === "dossier"
            ? "Подтверждённые источники и версии документов центра. Доступ заказчику задаётся отдельно."
            : "Паспорт связывает проверенный источник, применимость и форму. Новая версия не переписывает историю документов."}
      </p>
      <div className="table-scroll">
        <table className="source-data-table">
          <thead>
            <tr>
              <th>Документ / правило</th>
              <th>Источник</th>
              <th>Состояние</th>
              <th>Срок</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((entry) => (
              <tr key={entry.id}>
                <td>
                  <strong>{entry.title || entry.program}</strong>
                  <small>
                    {entry.issuer}
                    {entry.originalNumber ? ` · № ${entry.originalNumber}` : ""}
                    {entry.version ? ` · версия ${entry.version}` : ""}
                  </small>
                  {(section === "dossier" || section === "evidence") && (
                    <SourceAttachment
                      owner={
                        section === "dossier"
                          ? { dossierId: entry.id }
                          : { evidenceId: entry.id }
                      }
                      attachments={entry.attachments}
                      canManage={!readonly}
                      canShare={
                        section === "dossier" &&
                        !!entry.customerVisible &&
                        entry.category !== "QUALIFICATION"
                      }
                      onChanged={() => setRefresh((v) => v + 1)}
                    />
                  )}
                </td>
                <td>
                  {entry.source}
                  <small>{entry.applicability}</small>
                </td>
                <td>
                  {(
                    {
                      UNVERIFIED: "Не проверен",
                      VERIFIED: "Проверен",
                      VERIFIED_NO_EXPIRY: "Проверен, срок не указан",
                      APPROACHING: "Срок приближается",
                      REVIEW_DATE_PASSED: "Нужна проверка срока",
                      SUPERSEDED: "Заменён",
                      DRAFT: "Проект",
                      APPROVED: "Утверждён",
                      RETIRED: "Архив",
                    } as Record<string, string>
                  )[entry.state || entry.status || ""] || "Запись сохранена"}
                  {section === "evidence" && !readonly && (
                    <>
                      <label>
                        Основание проверки
                        <input
                          value={verify[entry.id] || ""}
                          onChange={(e) =>
                            setVerify({ ...verify, [entry.id]: e.target.value })
                          }
                        />
                      </label>
                      <button
                        disabled={busy || !verify[entry.id]?.trim()}
                        onClick={() =>
                          void run(
                            () =>
                              api(`/evidence/${entry.id}/verify`, {
                                method: "POST",
                                body: json({
                                  status: "VERIFIED",
                                  verificationNote: verify[entry.id],
                                }),
                              }),
                            "Статус и основание проверки сохранены.",
                          )
                        }
                      >
                        Подтвердить проверку
                      </button>
                    </>
                  )}
                </td>
                <td>{entry.validUntil || "Не указан"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!entries.length && !busy && (
        <p>
          Записей пока нет. Добавьте сведения с фактическим источником и
          применимостью.
        </p>
      )}
      {!readonly &&
        (section !== "service-rules" || context.user.role === "ADMIN") && (
          <button onClick={() => setOpen(!open)}>
            {open ? "Закрыть форму" : "Добавить запись с источником"}
          </button>
        )}
      {open && (
        <form
          className="contact-form"
          onSubmit={(e) => {
            e.preventDefault();
            void run(create, "Запись сохранена.");
          }}
        >
          {section === "evidence" && (
            <div className="toolbar-actions">
              <button type="button" onClick={() => setPicker("customers")}>
                {customer?.nameRu || "Выбрать заказчика"}
              </button>
              <button type="button" onClick={() => setPicker("recipients")}>
                {recipient?.fullNameRu || "Выбрать человека"}
              </button>
            </div>
          )}
          <div className="form-grid">
            {field(
              "title",
              section === "evidence" ? "Направление / программа" : "Название",
            )}
            {field("source", "Источник документа / требования")}
            {section === "evidence" ? (
              <>
                {field("issuer", "Фактический эмитент")}
                {field("originalNumber", "Номер внешнего документа")}
                {field("documentDate", "Дата документа", "date")}
                {field(
                  "validUntil",
                  "Срок действия (если подтверждён)",
                  "date",
                  false,
                )}
              </>
            ) : (
              <>
                {field("version", "Версия программы / документа")}
                {field("applicability", "Применимость")}
              </>
            )}
            {section === "dossier" && (
              <>
                <label>
                  Категория
                  <select
                    value={form.category || "PROGRAM"}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        category: e.target.value,
                        ...(e.target.value === "QUALIFICATION"
                          ? { customerVisible: "false" }
                          : {}),
                      })
                    }
                  >
                    <option value="PROGRAM">Программа</option>
                    <option value="AUTHORIZATION">
                      Разрешительный документ
                    </option>
                    <option value="QUALIFICATION">Квалификация</option>
                    <option value="FACILITY">Материальная база</option>
                    <option value="INTERNAL_CONTROL">
                      Внутренний контроль
                    </option>
                  </select>
                </label>
                {field("validUntil", "Контрольный срок", "date", false)}
                <label className="checkbox">
                  <input
                    type="checkbox"
                    checked={form.customerVisible === "true"}
                    disabled={form.category === "QUALIFICATION"}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        customerVisible: String(e.target.checked),
                      })
                    }
                  />
                  Разрешить включение в комплект заказчика
                </label>
              </>
            )}
            {section === "service-rules" && (
              <>
                <label>
                  Состояние новой версии
                  <select
                    value={form.status || "DRAFT"}
                    onChange={(e) =>
                      setForm({ ...form, status: e.target.value })
                    }
                  >
                    <option value="DRAFT">Проект для проверки</option>
                    <option value="APPROVED">Утверждено администратором</option>
                  </select>
                </label>
                {field("serviceKey", "Постоянный код услуги")}
                {field("category", "Категория применимости", "text", false)}
                {field("effectiveFrom", "Применяется с", "date", false)}
                {field("effectiveTo", "Применяется до", "date", false)}
                {field(
                  "checkedOn",
                  "Дата проверки источника",
                  "date",
                  form.status === "APPROVED",
                )}
                <label>
                  Применимая форма
                  <select
                    required
                    value={form.templateId || ""}
                    onChange={(e) =>
                      setForm({ ...form, templateId: e.target.value })
                    }
                  >
                    <option value="">Выберите форму</option>
                    {Object.entries(templateLabels).map(([key, title]) => (
                      <option key={key} value={key}>
                        {title}
                      </option>
                    ))}
                  </select>
                </label>
                <fieldset>
                  <legend>Дополнительные совместимые формы</legend>
                  {Object.entries(templateLabels)
                    .filter(([key]) => key !== form.templateId)
                    .map(([key, label]) => (
                      <label className="checkbox-label" key={key}>
                        <input
                          type="checkbox"
                          checked={extraTemplates.includes(key)}
                          onChange={(e) =>
                            setExtraTemplates(
                              e.target.checked
                                ? [...extraTemplates, key]
                                : extraTemplates.filter((id) => id !== key),
                            )
                          }
                        />
                        {label}
                      </label>
                    ))}
                </fieldset>
                {field("requirement", "Основное требование", "text", false)}
                <label>
                  Этап основного требования
                  <select
                    value={form.stage || "EVIDENCE"}
                    onChange={(e) =>
                      setForm({ ...form, stage: e.target.value })
                    }
                  >
                    {Object.entries({
                      DATA: "Список и данные",
                      RESULTS: "Результаты",
                      DOCUMENTS: "Документы",
                      TRANSFER: "Передача",
                      SETTLEMENT: "Расчёты",
                      EVIDENCE: "Основания",
                    }).map(([key, label]) => (
                      <option key={key} value={key}>
                        {label}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Источник требования
                  <select
                    value={form.requirementSource || "CONTRACT"}
                    onChange={(e) =>
                      setForm({ ...form, requirementSource: e.target.value })
                    }
                  >
                    <option value="CONTRACT">Договорное</option>
                    <option value="NORMATIVE">Нормативное</option>
                    <option value="RECOMMENDATION">Рекомендованное</option>
                  </select>
                </label>
                {requirements.map((requirement, index) => (
                  <fieldset key={requirement.key}>
                    <legend>Дополнительное требование {index + 1}</legend>
                    <label>
                      Содержание требования
                      <input
                        required
                        value={requirement.label}
                        onChange={(e) =>
                          setRequirements(
                            requirements.map((r, i) =>
                              i === index ? { ...r, label: e.target.value } : r,
                            ),
                          )
                        }
                      />
                    </label>
                    <label>
                      Основание требования
                      <select
                        value={requirement.source}
                        onChange={(e) =>
                          setRequirements(
                            requirements.map((r, i) =>
                              i === index
                                ? { ...r, source: e.target.value }
                                : r,
                            ),
                          )
                        }
                      >
                        <option value="CONTRACT">Договорное</option>
                        <option value="NORMATIVE">Нормативное</option>
                        <option value="RECOMMENDATION">Рекомендованное</option>
                      </select>
                    </label>
                    <label>
                      Этап требования
                      <select
                        value={requirement.stage}
                        onChange={(e) =>
                          setRequirements(
                            requirements.map((r, i) =>
                              i === index ? { ...r, stage: e.target.value } : r,
                            ),
                          )
                        }
                      >
                        {Object.entries({
                          DATA: "Список и данные",
                          RESULTS: "Результаты",
                          DOCUMENTS: "Документы",
                          TRANSFER: "Передача",
                          SETTLEMENT: "Расчёты",
                          EVIDENCE: "Основания",
                        }).map(([key, label]) => (
                          <option key={key} value={key}>
                            {label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <button
                      type="button"
                      onClick={() =>
                        setRequirements(
                          requirements.filter((_, i) => i !== index),
                        )
                      }
                    >
                      Удалить требование {index + 1}
                    </button>
                  </fieldset>
                ))}
                <button
                  type="button"
                  disabled={requirements.length >= 49}
                  onClick={() =>
                    setRequirements([
                      ...requirements,
                      {
                        key: crypto.randomUUID(),
                        label: "",
                        source: "CONTRACT",
                        stage: "EVIDENCE",
                      },
                    ])
                  }
                >
                  Добавить требование к услуге
                </button>
                {field("limitation", "Ограничения применимости", "text", false)}
              </>
            )}
          </div>
          <button
            className="primary"
            disabled={
              busy ||
              (section === "evidence" && (!customer || !recipient?.recipientId))
            }
          >
            Сохранить запись
            {section === "service-rules"
              ? form.status === "APPROVED"
                ? " как утверждённую версию"
                : " как проект"
              : ""}
          </button>
        </form>
      )}
      {context.user.role === "ADMIN" && <PortalAccess />}
      {picker && (
        <RecordPicker
          kind={picker}
          onClose={() => setPicker(null)}
          onCustomer={(value) => {
            setCustomer(value);
            setPicker(null);
          }}
          onRecipient={(value) => {
            setRecipient(value);
            setPicker(null);
          }}
        />
      )}
    </section>
  );
}
