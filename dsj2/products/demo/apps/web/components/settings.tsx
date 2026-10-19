"use client";
import { useCabinetText, useCabinetLanguage, useCabinetError } from "./cabinet-language";
import { useEffect, useState, type FormEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Icon, Modal, Notice } from "@demo/ui";
import { api, json } from "@/lib/api";
import { canManageUsers, canManageSystem, profileSchema, roleLabel } from "@demo/contracts";
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
import { TemplateManager } from "./template-manager";
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
      ? [["users", tr("Пользователи")], ["templates", tr("Формы")], ["account", tr("Мой пароль")]]
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
          <p>{managesSystem ? tr("Реквизиты эмитента, формы документов и доступ к центру.") : managesUsers ? tr("Пользователи, формы документов и доступ к обучению.") : tr("Безопасность вашей учётной записи.")}</p>
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
            <><Users currentUserId={context.user.id} actorRole={context.user.role} /><RegistrationPolicy t={t} /></>
          ) : activeTab === "signatories" && managesSystem ? (
            <SignatorySettings />
          ) : activeTab === "audit" && managesSystem ? (
            <AuditLog timezone={context.tenant.timezone} />
          ) : activeTab === "export" && managesSystem ? (
            <>
              <h2>{tr("Полная копия данных центра")}</h2>
              <p>
                {tr("Архив содержит данные заказчиков и получателей, историю, связанные записи и доступные файлы центра. Сохраните его в защищённом месте с доступом только уполномоченных сотрудников.")}</p>
              <p className="fine-print">
                {tr("Это выгрузка данных для сохранения и переноса. Проверка восстановления выполняется отдельно.")}</p>
              <a className="button primary" href="/api/tenant-export" download>
                {tr("Скачать полную копию центра (ZIP)")}</a>
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
}: {
  profile: Profile | null;
  onSaved: (profile: Profile) => void;
}) {
  const tr = useCabinetText();
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
  function change(patch: Partial<Profile>) {
    setSaved(false);
    setValue({ ...value, ...patch });
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const { id: _id, version: _version, ...fields } = value;
      const payload = profileSchema.parse(fields);
      const result = await api<Profile & { profile?: Profile }>(
        "/settings/profile",
        {
          method: "POST",
          body: json(payload),
        },
      );
      const savedProfile = result.profile
        ? { ...result.profile, version: result.version, id: result.id }
        : result;
      setValue(savedProfile);
      onSaved(savedProfile);
      setSaved(true);
    } catch (caught) {
      setError(caught);
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={submit}>
      <div className="section-heading">
        <h2>{tr("Реквизиты учебного центра")}</h2>
        {value.version && (
          <span className="status">{tr("Версия")}{" "}{value.version}</span>
        )}
      </div>
      <p className="muted">
        {tr("Название DEMO относится к программе. В документы попадают реквизиты вашей организации.")}</p>
      {error && <Notice>{error}</Notice>}
      {saved && (
        <Notice kind="success">
          {tr("Создана новая версия реквизитов. Ранее оформленные документы сохраняют свою версию.")}</Notice>
      )}
      <OrganizationNameFields
        value={value}
        onChange={(names) => change(names)}
        legacyLabels={[
          tr("Юридическое название · RU"),
          tr("Юридическое название · KZ"),
        ]}
      />
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
              required={key === "nameRu"}
              value={String(value[key as keyof Profile] || "")}
              onChange={(event) => change({ [key]: event.target.value })}
            />
          </label>
        ))}
      </div>
      <label>
        {tr("Название комиссии / версии профиля")}<input
          value={value.commissionTitle || ""}
          onChange={(event) => change({ commissionTitle: event.target.value })}
          placeholder={tr("Например: комиссия ПБ, состав от 24.09.2026")}
        />
      </label>
      <label>
        {tr("Основание утверждения / полномочий")}<textarea
          aria-label={tr("Основание утверждения / полномочий")}
          value={value.approvalBasis}
          onChange={(event) => change({ approvalBasis: event.target.value })}
        />
      </label>
      <div className="section-heading">
        <h3>{tr("Комиссия")}</h3>
        <button
          type="button"
          disabled={value.commission.length >= 12}
          onClick={() =>
            change({
              commission: [...value.commission, { name: "", position: "" }],
            })
          }
        >
          <Icon name="plus" />
          {value.commission.length
            ? tr("Добавить члена комиссии")
            : tr("Добавить председателя")}
        </button>
      </div>

      {value.commission.length === 0 && (
        <p className="muted">
          {tr("Состав комиссии не указан. Внесите фактические утверждённые данные.")}</p>
      )}
      {value.commission.map((person, index) => (
        <div key={index}>
          <p className="center-person-role">
            {index === 0 ? tr("Председатель комиссии") : `${tr("Член комиссии ")}${index}`}
          </p>
          <div className="commission-row">
            <label>
              {tr("ФИО")}<input
                required
                value={person.name}
                onChange={(event) =>
                  change({
                    commission: value.commission.map((row, i) =>
                      i === index ? { ...row, name: event.target.value } : row,
                    ),
                  })
                }
              />
            </label>
            <label>
              {tr("Роль в комиссии / должность")}<input
                value={person.position}
                onChange={(event) =>
                  change({
                    commission: value.commission.map((row, i) =>
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
              aria-label={`${tr("Удалить члена комиссии ")}${index + 1}`}
              onClick={() =>
                change({
                  commission:
                    index === 0 && value.commission.length > 1
                      ? [
                          { name: "", position: "" },
                          ...value.commission.slice(1),
                        ]
                      : value.commission.filter((_, i) => i !== index),
                })
              }
            >
              {tr("Удалить")}</button>
          </div>
        </div>
      ))}
      <details className="center-extra-people">
        <summary>{tr("Другие преподаватели и подписанты")}</summary>
        <p className="fine-print">
          {tr("Список имён для работы центра. Состав комиссии выше определяет подписи в текущих формах. Эти записи не предоставляют доступ к приложению.")}</p>
        {(value.people || []).map((person, index) => (
          <div className="form-grid" key={index}>
            <label>
              {tr("ФИО сотрудника")}<input
                required
                maxLength={255}
                value={person.name}
                onChange={(event) =>
                  change({
                    people: value.people!.map((row, i) =>
                      i === index ? { ...row, name: event.target.value } : row,
                    ),
                  })
                }
              />
            </label>
            <label>
              {tr("Роль")}<select
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
              {tr("Должность сотрудника")}<input
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
                change({ people: value.people!.filter((_, i) => i !== index) })
              }
            >
              {tr("Убрать сотрудника")}{" "}{index + 1}
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
          {tr("Добавить преподавателя или подписанта")}</button>
      </details>
      <CenterTrainingSchedule
        commonFields={value.commonFields}
        disabled={busy}
        onChange={(commonFields) => change({ commonFields })}
      />
      <label className="checkbox approval">
        <input
          type="checkbox"
          checked={value.approved}
          onChange={(event) => change({ approved: event.target.checked })}
        />
        {tr("Реквизиты и состав комиссии проверены уполномоченным сотрудником центра")}</label>
      <button className="primary" disabled={busy}>
        {busy ? tr("Сохраняем…") : tr("Сохранить новую версию")}
      </button>
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
        {tr("Версии форм фиксируются при оформлении. Подтверждение формы выполняет ответственный сотрудник центра после проверки её применимости.")}</p>
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
                  {tr("Этот вариант выбирается только для программы специальных компетенций. Сертификат содержит отрасль, а протокол — БИН и адрес работодателя, фактические результаты проверки знаний и прокторинга. Применимость формы подтверждает ответственный сотрудник центра.")}</Notice>
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
                  {tr("Исторические макеты БиОТ не подтверждены редакцией правил с 12.07.2026. Текущая форма протокола рабочих профессий содержит 7 колонок. Отметка директора не исправляет несовпадение формы; требуется актуальный макет, проверенный уполномоченным сотрудником для соответствующей категории получателей.")}{" "}
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
        tr("Правило сохранено. Счётчик не сброшен; ранее назначенные номера сохранены."),
      );
    } catch (caught) {
      setError(caught);
    }
  }
  return (
    <>
      <h2>{tr("Нумерация")}</h2>
      <p className="muted">
        {tr("Номера назначаются сервером при оформлении. Сохранение, просмотр и повтор генерации не расходуют номера. Отменённые номера не используются повторно.")}</p>
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
          {tr("Счётчики появятся при первом оформлении документов соответствующего направления.")}</p>
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
        <p>{tr("Назначение даст вашей учётной записи полный доступ к этому учебному центру, включая управление администраторами и системными настройками. После назначения войдите заново.")}</p>
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
          <p className="fine-print">{tr("Курсы и группы назначаются в «Учебных полномочиях». Подписание документов требует отдельного действующего полномочия подписанта.")}</p>
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
