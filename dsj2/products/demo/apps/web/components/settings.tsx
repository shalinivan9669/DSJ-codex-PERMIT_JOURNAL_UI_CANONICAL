"use client";
import {
  useCabinetText,
  useCabinetLanguage,
  useCabinetError,
} from "./cabinet-language";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Icon, Modal, Notice } from "@demo/ui";
import { api, json } from "@/lib/api";
import {
  canManageUsers,
  canManageSystem,
  profileSchema,
  roleLabel,
} from "@demo/contracts";
import {
  userRoleForEditor,
  userRoleOptions,
  userRoleUpdate,
} from "@/lib/user-roles";
import { OrganizationNameFields } from "./organization-name-fields";
import { CenterTrainingSchedule } from "./center-training-schedule";
import { SignatorySettings } from "./signatory-settings";
import { PortalAccess } from "./portal-access";
import { AuditLog } from "./audit-log";
import { OwnPasswordForm } from "./own-password-form";
import { RegistrationPolicy } from "./registration-policy";
import { LearningReadiness } from "./learning-readiness";
import { TemplateManager } from "./template-manager";
import { CommissionFields } from "./commission-fields";
import {
  commissionMissingNames,
  prepareCommissionForSave,
  requestReturnPath,
} from "@/lib/commission";
import { validationErrors } from "@/lib/validation-errors";
import "./center-onboarding.css";
import {
  templateLabels,
  type AppContext,
  type Profile,
  type Role,
  type Template,
  type Page,
} from "@/lib/types";

export function Settings({
  context,
  onContextChange,
}: {
  context: AppContext;
  onContextChange: (context: AppContext) => void;
}) {
  const tr = useCabinetText();
  const t = useCabinetLanguage();
  const managesSystem = canManageSystem(context.user.role);
  const managesUsers = canManageUsers(context.user.role);
  const searchParams = useSearchParams();
  const router = useRouter();
  const tabs = managesSystem
    ? [
        ["profile", tr("Учебный центр")],
        ["templates", tr("Формы")],
        ["numbering", tr("Нумерация")],
        ["users", tr("Пользователи")],
        ["signatories", tr("Подписанты ЭЦП")],
        ["audit", tr("Журнал аудита")],
        ["export", tr("Полная выгрузка")],
        ["account", tr("Мой пароль")],
      ]
    : managesUsers
      ? [
          ["users", tr("Пользователи")],
          ["templates", tr("Формы")],
          ["account", tr("Мой пароль")],
        ]
      : [["account", tr("Мой пароль")]];
  const tab = searchParams.get("tab");
  const activeTab = tabs.some(([id]) => id === tab) ? tab : tabs[0]![0];
  function selectTab(id: string) {
    const query = new URLSearchParams(searchParams.toString());
    query.set("tab", id);
    router.push(`/settings?${query.toString()}`, { scroll: false });
  }
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>{tr("Настройки")}</h1>
        </div>
      </div>
      <div className="settings-layout">
        <nav className="settings-nav" aria-label={tr("Разделы настроек")}>
          {tabs.map(([id, title]) => (
            <button
              key={id}
              aria-current={activeTab === id ? "page" : undefined}
              onClick={() => selectTab(id)}
            >
              {title}
            </button>
          ))}
        </nav>
        <section className="panel settings-panel">
          {activeTab === "profile" && managesSystem ? (
            <ProfileForm
              profile={context.profile}
              focusCommission={searchParams.get("focus") === "commission"}
              returnTo={requestReturnPath(searchParams.get("returnTo"))}
              onSaved={(profile) =>
                onContextChange({
                  ...context,
                  profile,
                  profileVersionId: profile.id || context.profileVersionId,
                })
              }
            />
          ) : activeTab === "templates" && managesUsers ? (
            <Templates initial={context.templates} />
          ) : activeTab === "numbering" && managesSystem ? (
            <Numbering />
          ) : activeTab === "users" && managesUsers ? (
            <>
              <Users
                currentUserId={context.user.id}
                actorRole={context.user.role}
              />
              <LearningReadiness
                key={context.tenant.id}
                t={t}
                tenantId={context.tenant.id}
              >
                {(onBusyChange) => (
                  <RegistrationPolicy t={t} onBusyChange={onBusyChange} />
                )}
              </LearningReadiness>
            </>
          ) : activeTab === "signatories" && managesSystem ? (
            <SignatorySettings
              focusSetup={searchParams.get("focus") === "signatories"}
              initialRole={searchParams.get("signerRole")}
              returnTo={searchParams.get("returnTo")}
            />
          ) : activeTab === "audit" && managesSystem ? (
            <AuditLog timezone={context.tenant.timezone} />
          ) : activeTab === "export" && managesSystem ? (
            <>
              <h2>{tr("Полная копия данных центра")}</h2>
              <p>
                {tr(
                  "Архив содержит персональные данные. Храните его в защищённом месте.",
                )}
              </p>
              <p className="fine-print">
                {tr(
                  "Восстановление из архива требует отдельной проверки.",
                )}
              </p>
              <a className="button primary" href="/api/tenant-export" download>
                {tr("Скачать полную копию центра (ZIP)")}
              </a>
            </>
          ) : (
            <OwnPasswordForm />
          )}
        </section>
      </div>
    </>
  );
}
export function ProfileForm({
  profile,
  onSaved,
  focusCommission = false,
  returnTo,
}: {
  profile: Profile | null;
  onSaved: (profile: Profile) => void;
  focusCommission?: boolean;
  returnTo?: string;
}) {
  const tr = useCabinetText();
  const t = useCabinetLanguage();
  const formRef = useRef<HTMLFormElement>(null);
  const [value, setValue] = useState<Profile>(
    profile || {
      nameRu: "",
      nameKz: "",
      legalForm: "NONE",
      ownNameRu: "",
      ownNameKz: "",
      cityRu: "",
      cityKz: "",
      addressRu: "",
      addressKz: "",
      commission: [],
      approvalBasis: "",
      approved: false,
    },
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useCabinetError();
  const [saved, setSaved] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [showErrors, setShowErrors] = useState(false);
  const [issues, setIssues] = useState<{ path: string; message: string }[]>([]);
  const safeReturnTo = requestReturnPath(returnTo);
  function focusField(path: string) {
    requestAnimationFrame(() => {
      const commission = /^commission\.(\d+)\.(name|position)/.exec(path);
      const targetId = commission
        ? `profile-commission-${commission[2]}-${commission[1]}`
        : /^(name|ownName|legalForm)/.test(path)
          ? "profile-names"
          : path.startsWith("people")
            ? "profile-other-people"
            : path.startsWith("commonFields")
              ? "profile-schedule"
              : `profile-${path}`;
      const target = document.getElementById(targetId) || formRef.current;
      if (!target) return;
      if (target instanceof HTMLDetailsElement) target.open = true;
      let ancestor = target.parentElement;
      while (ancestor) {
        if (ancestor instanceof HTMLDetailsElement) ancestor.open = true;
        ancestor = ancestor.parentElement;
      }
      const input = target.matches("input, textarea, select, button")
        ? target
        : target.querySelector<HTMLElement>("input, textarea, select, button");
      target.scrollIntoView({ block: "center" });
      input?.focus({ preventScroll: true });
    });
  }
  useEffect(() => {
    if (focusCommission) focusField("commission.0.name");
  }, [focusCommission]);
  useEffect(() => {
    if (!dirty && !busy) return;
    const beforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, [dirty, busy]);
  function change(patch: Partial<Profile>) {
    setSaved(false);
    setDirty(true);
    setIssues((current) =>
      current.filter((issue) => !(issue.path.split(".")[0] in patch)),
    );
    setValue((current) => ({ ...current, ...patch }));
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setError("");
    setSaved(false);
    setShowErrors(true);
    const { id: _id, version: _version, ...fields } = value;
    const commission = prepareCommissionForSave(fields.commission);
    const missing = commissionMissingNames(commission, focusCommission ? 3 : 0);
    const parsed = profileSchema.safeParse({
      ...fields,
      commission,
      people: fields.people?.filter(
        (person) => person.name.trim() || person.position.trim(),
      ),
    });
    const nextIssues = missing.map((index) => ({
      path: `commission.${index}.name`,
      message: `${index === 0 ? tr("Председатель комиссии") : `${tr("Член комиссии")} ${index}`} — ${tr("укажите ФИО")}`,
    }));
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        const path = issue.path.join(".");
        if (nextIssues.some((entry) => entry.path === path)) continue;
        nextIssues.push({
          path,
          message: /[А-Яа-яЁё]/.test(issue.message)
            ? tr(issue.message)
            : tr("Проверьте значение в выделенном поле."),
        });
      }
    }
    if (focusCommission && !fields.approved)
      nextIssues.push({
        path: "approved",
        message: tr("Подтвердите, что реквизиты и состав комиссии проверены."),
      });
    if (nextIssues.length || !parsed.success) {
      setIssues(nextIssues);
      focusField(nextIssues[0]?.path || "commission.0.name");
      return;
    }
    setIssues([]);
    setBusy(true);
    try {
      const result = await api<Profile & { profile?: Profile }>(
        "/settings/profile",
        {
          method: "POST",
          body: json(parsed.data),
        },
      );
      const savedProfile = result.profile
        ? { ...result.profile, version: result.version, id: result.id }
        : result;
      setValue(savedProfile);
      onSaved(savedProfile);
      setSaved(true);
      setDirty(false);
      setShowErrors(false);
    } catch (caught) {
      setError(caught);
      const serverIssues = validationErrors(caught).flatMap((issue) =>
        typeof issue === "string"
          ? []
          : [
              {
                path: Array.isArray(issue.path)
                  ? issue.path.join(".")
                  : issue.path || "",
                message: issue.message,
              },
            ],
      );
      setIssues(serverIssues);
      if (serverIssues.length) focusField(serverIssues[0].path);
    } finally {
      setBusy(false);
    }
  }
  return (
    <form ref={formRef} onSubmit={submit} noValidate>
      <div className="section-heading">
        <h2>{tr("Реквизиты учебного центра")}</h2>
        {value.version && (
          <span className="status">
            {tr("Версия")} {value.version}
          </span>
        )}
      </div>
      {error && <Notice>{error}</Notice>}
      {!!issues.length && (
        <Notice>
          <strong>{tr("Исправьте поля перед сохранением")}</strong>
          <ul className="profile-error-links">
            {issues.map((issue, index) => (
              <li key={`${issue.path}-${index}`}>
                <button type="button" onClick={() => focusField(issue.path)}>
                  {tr(issue.message)}
                </button>
              </li>
            ))}
          </ul>
        </Notice>
      )}
      <fieldset className="profile-fields" disabled={busy}>
        <div id="profile-names">
          <OrganizationNameFields
            value={value}
            autoFocus={!focusCommission}
            showRequiredErrors={showErrors}
            onChange={(names) => change(names)}
            legacyLabels={[
              tr("Юридическое название · RU"),
              tr("Юридическое название · KZ"),
            ]}
          />
        </div>
        <div className="form-grid">
          {[
            ["bin", tr("БИН учебного центра")],
            ["headName", tr("ФИО руководителя учебного центра")],

            ["cityRu", tr("Город · RU")],
            ["cityKz", tr("Город · KZ")],

            ["addressRu", tr("Адрес · RU")],
            ["addressKz", tr("Адрес · KZ")],
          ].map(([key, label]) => (
            <label key={key}>
              {label}
              <input
                id={`profile-${key}`}
                aria-invalid={issues.some((issue) => issue.path === key)}
                required={key === "nameRu"}
                value={String(value[key as keyof Profile] || "")}
                onChange={(event) => change({ [key]: event.target.value })}
              />
            </label>
          ))}
        </div>
        <label>
          {tr("Название комиссии / версии профиля")}
          <input
            id="profile-commissionTitle"
            maxLength={255}
            value={value.commissionTitle || ""}
            onChange={(event) =>
              change({ commissionTitle: event.target.value })
            }
            placeholder={tr("Например: комиссия ПБ, состав от 24.09.2026")}
          />
        </label>
        <label>
          {tr("Основание утверждения / полномочий")}
          <textarea
            id="profile-approvalBasis"
            aria-label={tr("Основание утверждения / полномочий")}
            value={value.approvalBasis}
            onChange={(event) => change({ approvalBasis: event.target.value })}
          />
        </label>
        <section
          className="profile-commission"
          id="profile-commission"
          aria-labelledby="profile-commission-title"
        >
          <div className="section-heading">
            <h3 id="profile-commission-title">
              {tr("Комиссия для протоколов")}
            </h3>
          </div>
          <p className="commission-organization">
            <span>{tr("Организация комиссии")}: </span>
            <strong>{t(value.nameRu || value.nameKz || "", value.nameKz || value.nameRu || "") || tr("Укажите название учебного центра выше")}</strong>
          </p>
          <CommissionFields
            value={value.commission}
            onChange={(commission) => change({ commission })}
            idPrefix="profile-commission"
            showErrors={showErrors}
            requiredCount={focusCommission ? 3 : 0}
            disabled={busy}
            headName={value.headName}
            people={value.people}
          />
        </section>
        <details className="center-extra-people" id="profile-other-people">
          <summary>{tr("Другие преподаватели и подписанты")}</summary>
          <p className="fine-print">
            {tr(
              "Этот список не меняет комиссию и не предоставляет доступ к приложению.",
            )}
          </p>
          {(value.people || []).map((person, index) => (
            <div className="form-grid" key={index}>
              <label>
                {tr("ФИО сотрудника")}
                <input
                  required
                  maxLength={255}
                  value={person.name}
                  onChange={(event) =>
                    change({
                      people: value.people!.map((row, i) =>
                        i === index
                          ? { ...row, name: event.target.value }
                          : row,
                      ),
                    })
                  }
                />
              </label>
              <label>
                {tr("Роль")}
                <select
                  value={person.role}
                  onChange={(event) =>
                    change({
                      people: value.people!.map((row, i) =>
                        i === index
                          ? {
                              ...row,
                              role: event.target.value as "TEACHER" | "SIGNER",
                            }
                          : row,
                      ),
                    })
                  }
                >
                  <option value="TEACHER">{tr("Преподаватель")}</option>
                  <option value="SIGNER">{tr("Подписант")}</option>
                </select>
              </label>
              <label>
                {tr("Должность сотрудника")}
                <input
                  maxLength={255}
                  value={person.position}
                  onChange={(event) =>
                    change({
                      people: value.people!.map((row, i) =>
                        i === index
                          ? { ...row, position: event.target.value }
                          : row,
                      ),
                    })
                  }
                />
              </label>
              <button
                type="button"
                onClick={() =>
                  change({
                    people: value.people!.filter((_, i) => i !== index),
                  })
                }
              >
                {tr("Убрать сотрудника")} {index + 1}
              </button>
            </div>
          ))}
          <button
            type="button"
            disabled={(value.people?.length || 0) >= 24}
            onClick={() =>
              change({
                people: [
                  ...(value.people || []),
                  { name: "", position: "", role: "TEACHER" },
                ],
              })
            }
          >
            {tr("Добавить преподавателя или подписанта")}
          </button>
        </details>
        <div id="profile-schedule">
          <CenterTrainingSchedule
            commonFields={value.commonFields}
            disabled={busy}
            onChange={(commonFields) => change({ commonFields })}
          />
        </div>
        <label className="checkbox approval">
          <input
            id="profile-approved"
            type="checkbox"
            aria-invalid={issues.some((issue) => issue.path === "approved")}
            checked={value.approved}
            onChange={(event) => change({ approved: event.target.checked })}
          />
          {tr(
            "Реквизиты и состав комиссии проверены уполномоченным сотрудником центра",
          )}
        </label>
      </fieldset>
      {saved && (
        <Notice kind="success">
          {safeReturnTo
            ? tr(
                focusCommission
                  ? "Комиссия сохранена. Вернитесь в заявку и примените сохранённый состав."
                  : "Реквизиты сохранены. Вернитесь в заявку и примените сохранённую версию.",
              )
            : tr(
                "Реквизиты сохранены. Для открытой заявки выберите новую версию комиссии; ранее оформленные документы не изменятся.",
              )}
        </Notice>
      )}
      <div className="profile-save-actions">
        {saved && safeReturnTo ? (
          <a className="button primary" href={safeReturnTo}>
            {tr("Вернуться к заявке")}
          </a>
        ) : (
          <button className="primary" disabled={busy}>
            {busy
              ? tr("Сохраняем…")
              : focusCommission
                ? tr("Сохранить комиссию")
                : tr("Сохранить реквизиты")}
          </button>
        )}
        {dirty && <p className="fine-print" role="status">{tr("Есть несохранённые изменения.")}</p>}
      </div>
    </form>
  );
}
export function Templates({ initial }: { initial: Template[] }) {
  const tr = useCabinetText();
  const [templates, setTemplates] = useState<
    (Template & {
      approved?: boolean;
      sha256?: string;
      pageFormat?: string;
    })[]
  >(initial);
  const [error, setError] = useCabinetError();
  const [busy, setBusy] = useState("");
  async function load() {
    const result = await api<Page<Template> | Template[]>(
      "/settings/templates",
    );
    setTemplates(Array.isArray(result) ? result : result.items);
  }
  useEffect(() => {
    void load().catch((caught) => setError(caught));
  }, []);
  async function approve(id: string) {
    setBusy(id);
    setError("");
    try {
      await api(`/settings/templates/${id}/approve`, {
        method: "POST",
        body: json({ approved: true }),
      });
      await load();
    } catch (caught) {
      setError(caught);
    } finally {
      setBusy("");
    }
  }
  return (
    <>
      <h2>{tr("Формы документов")}</h2>
      <p className="muted">
        {tr("Подтвердите форму после проверки её применимости. Выданные документы не изменятся.")}</p>
      {error && <Notice>{error}</Notice>}
      <TemplateManager onChanged={load} />
      <div className="template-list">
        {templates.map((template) => (
          <article key={template.id}>
            <div>
              <h3>
                {template.contract?.ownerKind === "GROUP"
                  ? `${({ "biot-protocol": tr("БиОТ рабочих"), "biot-itr-protocol": tr("БиОТ ИТР"), "pb-protocol": tr("ПБ"), "ptm-protocol": tr("ПТМ"), "ps-protocol": tr("ПС") } as Record<string, string>)[template.templateId || template.id] || tr("Событие")}${tr(" — групповой протокол")}`
                  : tr(templateLabels[template.templateId || template.id] || "") ||
                    template.title ||
                    template.name ||
                    template.id}
                {template.contract?.program === "SPECIAL" &&
                  tr(" — специальные компетенции")}
              </h3>
              <p>
                {tr("Версия")}{" "}{template.version || "1"} ·{" "}
                {template.pageFormat || tr("Геометрия исходной формы")} ·{" "}
                {(
                  template.supportedExports ||
                  template.exports || ["DOCX", "PDF"]
                ).join(", ")}
              </p>
              {template.description && <p>{template.description}</p>}
              {template.contract?.program === "SPECIAL" ? (
                <Notice kind="info">
                  {tr("Только для специальных компетенций. Применимость формы подтверждает ответственный сотрудник центра.")}</Notice>
              ) : typeof (
                  template.contract?.regulatoryReview as
                    | { notice?: unknown }
                    | undefined
                )?.notice === "string" ? (
                <Notice kind="info">
                  {String(
                    (template.contract?.regulatoryReview as { notice: string })
                      .notice,
                  )}
                </Notice>
              ) : (template.templateId || template.id).startsWith("biot-") ? (
                <Notice kind="info">
                  {tr("Эти макеты БиОТ не подтверждены правилами от 12.07.2026. Нужна актуальная форма для выбранной категории; отметка директора не заменяет её проверку.")}{" "}
                  <a
                    href="https://old.adilet.zan.kz/rus/docs/V1500012665"
                    target="_blank"
                    rel="noreferrer"
                  >
                    {tr("Действующие правила")}</a>
                </Notice>
              ) : null}
              <details>
                <summary>{tr("Контракт полей и контроль версии")}</summary>
                <pre>{JSON.stringify(template.contract || {}, null, 2)}</pre>
                {template.sha256 && (
                  <p className="hash">SHA-256: {template.sha256}</p>
                )}
              </details>
            </div>
            <div>
              {template.approved ? (
                <span className="status status-ready">{tr("Подтверждена")}</span>
              ) : (
                <button
                  disabled={!!busy}
                  onClick={() => void approve(template.id)}
                >
                  {busy === template.id ? tr("Подтверждаем…") : tr("Подтвердить форму")}
                </button>
              )}
            </div>
          </article>
        ))}
      </div>
    </>
  );
}
type NumberingPolicy = {
  namespace: string;
  prefix: string;
  nextValue?: number;
  next?: number;
  value?: number;
  suffix?: string;
  padding?: number;
};
function Numbering() {
  const tr = useCabinetText();
  const [items, setItems] = useState<NumberingPolicy[]>([]);
  const [error, setError] = useCabinetError();
  const [message, setMessage] = useState("");
  useEffect(() => {
    api<{ items: NumberingPolicy[] } | NumberingPolicy[]>("/settings/numbering")
      .then((result) => setItems(Array.isArray(result) ? result : result.items))
      .catch((caught) => setError(caught));
  }, []);
  async function save(item: NumberingPolicy) {
    setError("");
    setMessage("");
    try {
      await api("/settings/numbering", {
        method: "PATCH",
        body: json({
          namespace: item.namespace,
          prefix: item.prefix,
          suffix: item.suffix || "",
          padding: item.padding || 5,
        }),
      });
      setMessage(
        tr("Правило сохранено. Нумерация продолжится с текущего счётчика."),
      );
    } catch (caught) {
      setError(caught);
    }
  }
  return (
    <>
      <h2>{tr("Нумерация")}</h2>
      <p className="muted">
        {tr("Номер назначается при оформлении и не используется повторно.")}</p>
      {error && <Notice>{error}</Notice>}
      {message && <Notice kind="success">{message}</Notice>}
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>{tr("Область")}</th>
              <th>{tr("Следующий номер")}</th>
              <th>{tr("Префикс")}</th>
              <th>{tr("Суффикс / разрядность")}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {items.map((item, index) => (
              <tr key={item.namespace}>
                <td>{item.namespace}</td>
                <td>
                  {item.nextValue ??
                    item.next ??
                    (item.value != null ? item.value + 1 : tr("Будет назначен"))}
                </td>
                <td>
                  <input
                    aria-label={`${tr("Префикс ")}${item.namespace}`}
                    value={item.prefix || ""}
                    onChange={(event) =>
                      setItems(
                        items.map((row, i) =>
                          i === index
                            ? { ...row, prefix: event.target.value }
                            : row,
                        ),
                      )
                    }
                  />
                </td>
                <td>
                  <input
                    aria-label={`${tr("Суффикс ")}${item.namespace}`}
                    value={item.suffix || ""}
                    onChange={(event) =>
                      setItems(
                        items.map((row, i) =>
                          i === index
                            ? { ...row, suffix: event.target.value }
                            : row,
                        ),
                      )
                    }
                  />
                  <input
                    type="number"
                    min="1"
                    max="12"
                    aria-label={`${tr("Разрядность ")}${item.namespace}`}
                    value={item.padding || 5}
                    onChange={(event) =>
                      setItems(
                        items.map((row, i) =>
                          i === index
                            ? { ...row, padding: Number(event.target.value) }
                            : row,
                        ),
                      )
                    }
                  />
                </td>
                <td>
                  <button onClick={() => void save(item)}>{tr("Сохранить")}</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!items.length && (
        <p className="muted">
          {tr("Счётчики появятся после первого оформления.")}</p>
      )}
    </>
  );
}
type User = {
  id: string;
  displayName: string;
  email: string;
  role: Role;
  disabled: boolean;
};
function Users({ currentUserId, actorRole }: { currentUserId: string; actorRole: Role }) {
  const tr = useCabinetText();
  const [users, setUsers] = useState<User[]>([]);
  const [edit, setEdit] = useState<Partial<User> | null>(null);
  const [error, setError] = useCabinetError();
  const [canBootstrap, setCanBootstrap] = useState(false);
  const [bootstrapOpen, setBootstrapOpen] = useState(false);
  async function load() {
    const result = await api<(Page<User> & { canBootstrapSuperAdmin?: boolean }) | User[]>("/users");
    setUsers(Array.isArray(result) ? result : result.items);
    setCanBootstrap(!Array.isArray(result) && result.canBootstrapSuperAdmin === true);
  }
  useEffect(() => {
    void load().catch((caught) => setError(caught));
  }, []);
  return (
    <>
      <div className="section-heading">
        <h2>{tr("Пользователи")}</h2>
        <button
          onClick={() =>
            setEdit({
              displayName: "",
              email: "",
              role: "OPERATOR",
              disabled: false,
            })
          }
        >
          <Icon name="plus" />
          {tr("Добавить сотрудника")}</button>
      </div>
      <div className="actions">
        <a className="button" href="/lms/learning-roles">{tr("Учебные полномочия")}</a>
        <a className="button" href="/lms/assign">{tr("Пригласить слушателя")}</a>
      </div>
      {error && <Notice>{error}</Notice>}
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>{tr("Пользователь")}</th>
              <th>{tr("Роль")}</th>
              <th>{tr("Доступ")}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {users.map((user) => (
              <tr key={user.id}>
                <td>
                  <strong>{user.displayName}</strong>
                  <small>{user.email}</small>
                </td>
                <td>{tr(roleLabel(user.role))}</td>
                <td>{user.disabled ? tr("Отключён") : tr("Активен")}</td>
                <td>
                  {actorRole === "SUPER_ADMIN" || !["ADMIN", "DIRECTOR", "SUPER_ADMIN"].includes(user.role) ? (
                    <button onClick={() => setEdit(user)}>
                      {tr("Изменить")}{user.id === currentUserId ? tr(" себя") : ""}
                    </button>
                  ) : user.id === currentUserId ? (
                    <span className="muted">{tr("Пароль — в разделе «Мой пароль»")}</span>
                  ) : (
                    <span className="muted">{tr("Управляет суперадминистратор")}</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <PortalAccess />
      {canBootstrap && ["ADMIN", "DIRECTOR"].includes(actorRole) && (
        <p><button type="button" onClick={() => setBootstrapOpen(true)}>{tr("Назначить первого суперадминистратора")}</button></p>
      )}
      {bootstrapOpen && <BootstrapSuperAdmin onClose={() => setBootstrapOpen(false)} />}
      {edit && (
        <UserDialog
          user={edit}
          currentUserId={currentUserId}
          actorRole={actorRole}
          onClose={() => setEdit(null)}
          onSaved={() => {
            if (edit.id === currentUserId) {
              window.location.assign("/login");
              return;
            }
            setEdit(null);
            void load().catch((caught) => setError(caught));
          }}
        />
      )}
    </>
  );
}
function BootstrapSuperAdmin({ onClose }: { onClose: () => void }) {
  const tr = useCabinetText();
  const [currentPassword, setCurrentPassword] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useCabinetError();
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!confirmed) return;
    setBusy(true);
    setError("");
    try {
      await api("/users/bootstrap-super-admin", {
        method: "POST",
        body: json({ currentPassword, confirm: true }),
      });
      setCurrentPassword("");
      window.location.assign("/login");
    } catch (caught) {
      setError(caught);
      setCurrentPassword("");
      setBusy(false);
    }
  }
  return (
    <Modal title={tr("Первый суперадминистратор")} onClose={() => { if (!busy) onClose(); }}>
      <form onSubmit={submit}>
        <p>{tr("Вы получите полный доступ к центру, включая управление администраторами. После назначения войдите заново.")}</p>
        {error && <Notice>{error}</Notice>}
        <label>
          {tr("Текущий пароль")}<input autoFocus type="password" autoComplete="current-password" required maxLength={256} disabled={busy} value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} />
        </label>
        <label className="checkbox">
          <input type="checkbox" required disabled={busy} checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} />
          {tr("Назначить меня первым суперадминистратором центра")}</label>
        <div className="modal-actions">
          <button type="button" disabled={busy} onClick={onClose}>{tr("Отмена")}</button>
          <button className="primary" disabled={busy || !confirmed}>{busy ? tr("Назначаем…") : tr("Подтвердить назначение")}</button>
        </div>
      </form>
    </Modal>
  );
}
function UserDialog({
  user,
  currentUserId,
  actorRole,
  onClose,
  onSaved,
}: {
  user: Partial<User>;
  currentUserId: string;
  actorRole: Role;
  onClose: () => void;
  onSaved: () => void;
}) {
  const tr = useCabinetText();
  const [value, setValue] = useState({
    email: "",
    displayName: "",
    disabled: false,
    ...user,
    role: userRoleForEditor(user.role),
  });
  const [password, setPassword] = useState("");
  const [error, setError] = useCabinetError();
  const [busy, setBusy] = useState(false);
  const editingSelf = user.id === currentUserId;
  const roles = userRoleOptions(user.id ? user.role : undefined, actorRole)
    .filter((role) => !!user.id || !["LEARNER", "EMPLOYER"].includes(role));
  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api(user.id ? `/users/${user.id}` : "/users", {
        method: user.id ? "PATCH" : "POST",
        body: json({
          ...(!user.id ? { email: value.email } : {}),
          displayName: value.displayName,
          ...userRoleUpdate(user.id ? user.role : undefined, value.role),
          ...(user.id ? { disabled: value.disabled } : {}),
          ...(password ? { password } : {}),
        }),
      });
      onSaved();
    } catch (caught) {
      setError(caught);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title={user.id ? tr("Настройки пользователя") : tr("Новый пользователь")}
      onClose={onClose}
    >
      <form onSubmit={submit}>
        {error && <Notice>{error}</Notice>}
        <label>
          {tr("Имя")}<input
            autoFocus
            required
            value={value.displayName}
            onChange={(event) =>
              setValue({ ...value, displayName: event.target.value })
            }
          />
        </label>
        <label>
          {tr("Электронная почта")}<input
            type="email"
            required
            disabled={!!user.id}
            value={value.email}
            onChange={(event) =>
              setValue({ ...value, email: event.target.value })
            }
          />
        </label>
        <label>
          {tr("Роль")}<select
            value={value.role}
            disabled={editingSelf}
            onChange={(event) =>
              setValue({ ...value, role: event.target.value as Role })
            }
          >
            {roles.map((role) => (
              <option key={role} value={role}>
                {tr(roleLabel(role))}
                {role === "LEARNER" || role === "EMPLOYER"
                  ? tr(" (текущий доступ)")
                  : ""}
              </option>
            ))}
          </select>
        </label>
        {["TEACHER", "METHODIST", "EXPERT"].includes(value.role) && (
          <p className="fine-print">{tr("Курсы и группы — в «Учебных полномочиях». Для ЭЦП назначьте отдельное полномочие подписанта.")}</p>
        )}
        <label>
          {user.id ? tr("Новый пароль (необязательно)") : tr("Первоначальный пароль")}
          <input
            type="password"
            autoComplete="new-password"
            minLength={12}
            required={!user.id}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </label>
        <small className="muted">
          {tr("Не менее 12 символов. Изменение роли, пароля или отключение отзывает активные сессии.")}</small>
        {user.id && (
          <label className="checkbox">
            <input
              type="checkbox"
              disabled={editingSelf}
              checked={value.disabled}
              onChange={(event) =>
                setValue({ ...value, disabled: event.target.checked })
              }
            />
            {tr("Отключить доступ")}</label>
        )}
        <div className="modal-actions">
          <button type="button" onClick={onClose}>
            {tr("Отмена")}</button>
          <button className="primary" disabled={busy}>
            {busy ? tr("Сохраняем…") : tr("Сохранить")}
          </button>
        </div>
      </form>
    </Modal>
  );
}
