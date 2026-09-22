"use client";
import { useEffect, useState, type FormEvent } from "react";
import { Icon, Modal, Notice } from "@demo/ui";
import { api, errorText, json } from "@/lib/api";
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
  const [tab, setTab] = useState(
    context.user.role === "ADMIN" ? "profile" : "account",
  );
  const tabs =
    context.user.role === "ADMIN"
      ? [
          ["profile", "Учебный центр"],
          ["templates", "Формы"],
          ["numbering", "Нумерация"],
          ["users", "Пользователи"],
          ["account", "Мой пароль"],
        ]
      : [["account", "Мой пароль"]];
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>Настройки</h1>
          <p>Реквизиты эмитента, формы документов и доступ к центру.</p>
        </div>
      </div>
      <div className="settings-layout">
        <nav className="settings-nav" aria-label="Разделы настроек">
          {tabs.map(([id, title]) => (
            <button
              key={id}
              aria-current={tab === id ? "page" : undefined}
              onClick={() => setTab(id)}
            >
              {title}
            </button>
          ))}
        </nav>
        <section className="panel settings-panel">
          {tab === "profile" ? (
            <ProfileForm
              profile={context.profile}
              onSaved={(profile) => onContextChange({ ...context, profile })}
            />
          ) : tab === "templates" ? (
            <Templates initial={context.templates} />
          ) : tab === "numbering" ? (
            <Numbering />
          ) : tab === "users" ? (
            <Users currentUserId={context.user.id} />
          ) : (
            <PasswordForm />
          )}
        </section>
      </div>
    </>
  );
}
function ProfileForm({
  profile,
  onSaved,
}: {
  profile: Profile;
  onSaved: (profile: Profile) => void;
}) {
  const [value, setValue] = useState<Profile>(
    profile || {
      nameRu: "",
      nameKz: "",
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
  const [error, setError] = useState("");
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
      const {
        nameRu,
        nameKz,
        addressRu,
        addressKz,
        cityRu,
        cityKz,
        commission,
        approvalBasis,
        approved,
      } = value;
      const result = await api<Profile & { profile?: Profile }>(
        "/settings/profile",
        {
          method: "POST",
          body: json({
            nameRu,
            nameKz,
            addressRu,
            addressKz,
            cityRu,
            cityKz,
            commission,
            approvalBasis,
            approved,
          }),
        },
      );
      const savedProfile = result.profile
        ? { ...result.profile, version: result.version }
        : result;
      setValue(savedProfile);
      onSaved(savedProfile);
      setSaved(true);
    } catch (caught) {
      setError(errorText(caught));
    } finally {
      setBusy(false);
    }
  }
  return (
    <form onSubmit={submit}>
      <div className="section-heading">
        <h2>Реквизиты учебного центра</h2>
        {value.version && (
          <span className="status">Версия {value.version}</span>
        )}
      </div>
      <p className="muted">
        Название DEMO относится к программе. В документы попадают реквизиты
        вашей организации.
      </p>
      {error && <Notice>{error}</Notice>}
      {saved && (
        <Notice kind="success">
          Создана новая версия реквизитов. Ранее оформленные документы сохраняют
          свою версию.
        </Notice>
      )}
      <div className="form-grid">
        {[
          ["nameRu", "Юридическое название · RU"],
          ["nameKz", "Юридическое название · KZ"],
          ["cityRu", "Город · RU"],
          ["cityKz", "Город · KZ"],
          ["addressRu", "Адрес · RU"],
          ["addressKz", "Адрес · KZ"],
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
        Основание утверждения / полномочий
        <textarea
          value={value.approvalBasis}
          onChange={(event) => change({ approvalBasis: event.target.value })}
        />
      </label>
      <div className="section-heading">
        <h3>Комиссия</h3>
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
          Добавить
        </button>
      </div>
      {value.commission.length === 0 && (
        <p className="muted">
          Состав комиссии не указан. Внесите фактические утверждённые данные.
        </p>
      )}
      {value.commission.map((person, index) => (
        <div className="commission-row" key={index}>
          <label>
            ФИО
            <input
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
            Роль в комиссии / должность
            <input
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
            aria-label={`Удалить члена комиссии ${index + 1}`}
            onClick={() =>
              change({
                commission: value.commission.filter((_, i) => i !== index),
              })
            }
          >
            Удалить
          </button>
        </div>
      ))}
      <label className="checkbox approval">
        <input
          type="checkbox"
          checked={value.approved}
          onChange={(event) => change({ approved: event.target.checked })}
        />
        Реквизиты и состав комиссии проверены уполномоченным сотрудником центра
      </label>
      <button className="primary" disabled={busy}>
        {busy ? "Сохраняем…" : "Сохранить новую версию"}
      </button>
    </form>
  );
}
function Templates({ initial }: { initial: Template[] }) {
  const [templates, setTemplates] = useState<
    (Template & {
      approved?: boolean;
      sha256?: string;
      pageFormat?: string;
    })[]
  >(initial);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  async function load() {
    const result = await api<Page<Template> | Template[]>(
      "/settings/templates",
    );
    setTemplates(Array.isArray(result) ? result : result.items);
  }
  useEffect(() => {
    void load().catch((caught) => setError(errorText(caught)));
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
      setError(errorText(caught));
    } finally {
      setBusy("");
    }
  }
  return (
    <>
      <h2>Формы документов</h2>
      <p className="muted">
        Версии форм фиксируются при оформлении. Подтверждение формы выполняет
        ответственный сотрудник центра после проверки её применимости.
      </p>
      {error && <Notice>{error}</Notice>}
      <div className="template-list">
        {templates.map((template) => (
          <article key={template.id}>
            <div>
              <h3>
                {templateLabels[template.templateId || template.id] ||
                  template.title ||
                  template.name ||
                  template.id}
              </h3>
              <p>
                Версия {template.version || "1"} ·{" "}
                {template.pageFormat || "Геометрия исходной формы"} ·{" "}
                {(
                  template.supportedExports ||
                  template.exports || ["DOCX", "PDF"]
                ).join(", ")}
              </p>
              {template.description && <p>{template.description}</p>}
              {typeof (
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
                  Исторические макеты БиОТ не подтверждены редакцией правил с
                  12.07.2026. Текущая форма протокола рабочих профессий содержит
                  7 колонок. Отметка администратора не исправляет несовпадение
                  формы; требуется актуальный макет, проверенный уполномоченным
                  сотрудником для соответствующей категории получателей.{" "}
                  <a
                    href="https://old.adilet.zan.kz/rus/docs/V1500012665"
                    target="_blank"
                    rel="noreferrer"
                  >
                    Действующие правила
                  </a>
                </Notice>
              ) : null}
              <details>
                <summary>Контракт полей и контроль версии</summary>
                <pre>{JSON.stringify(template.contract || {}, null, 2)}</pre>
                {template.sha256 && (
                  <p className="hash">SHA-256: {template.sha256}</p>
                )}
              </details>
            </div>
            <div>
              {template.approved ? (
                <span className="status status-ready">Подтверждена</span>
              ) : (
                <button
                  disabled={!!busy}
                  onClick={() => void approve(template.id)}
                >
                  {busy === template.id ? "Подтверждаем…" : "Подтвердить форму"}
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
  const [items, setItems] = useState<NumberingPolicy[]>([]);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  useEffect(() => {
    api<{ items: NumberingPolicy[] } | NumberingPolicy[]>("/settings/numbering")
      .then((result) => setItems(Array.isArray(result) ? result : result.items))
      .catch((caught) => setError(errorText(caught)));
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
        "Правило сохранено. Счётчик не сброшен; ранее назначенные номера сохранены.",
      );
    } catch (caught) {
      setError(errorText(caught));
    }
  }
  return (
    <>
      <h2>Нумерация</h2>
      <p className="muted">
        Номера назначаются сервером при оформлении. Сохранение, просмотр и
        повтор генерации не расходуют номера. Отменённые номера не используются
        повторно.
      </p>
      {error && <Notice>{error}</Notice>}
      {message && <Notice kind="success">{message}</Notice>}
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Область</th>
              <th>Следующий номер</th>
              <th>Префикс</th>
              <th>Суффикс / разрядность</th>
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
                    (item.value != null ? item.value + 1 : "Будет назначен")}
                </td>
                <td>
                  <input
                    aria-label={`Префикс ${item.namespace}`}
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
                    aria-label={`Суффикс ${item.namespace}`}
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
                    aria-label={`Разрядность ${item.namespace}`}
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
                  <button onClick={() => void save(item)}>Сохранить</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!items.length && (
        <p className="muted">
          Счётчики появятся при первом оформлении документов соответствующего
          направления.
        </p>
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
function Users({ currentUserId }: { currentUserId: string }) {
  const [users, setUsers] = useState<User[]>([]);
  const [edit, setEdit] = useState<Partial<User> | null>(null);
  const [error, setError] = useState("");
  async function load() {
    const result = await api<Page<User> | User[]>("/users");
    setUsers(Array.isArray(result) ? result : result.items);
  }
  useEffect(() => {
    void load().catch((caught) => setError(errorText(caught)));
  }, []);
  return (
    <>
      <div className="section-heading">
        <h2>Пользователи</h2>
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
          Добавить
        </button>
      </div>
      <p className="muted">
        Администратор управляет настройками и доступом. Оператор подготавливает
        документы. Просмотр позволяет читать заявки и скачивать файлы.
      </p>
      {error && <Notice>{error}</Notice>}
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Пользователь</th>
              <th>Роль</th>
              <th>Доступ</th>
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
                <td>
                  {
                    {
                      ADMIN: "Администратор",
                      OPERATOR: "Оператор",
                      VIEWER: "Просмотр",
                    }[user.role]
                  }
                </td>
                <td>{user.disabled ? "Отключён" : "Активен"}</td>
                <td>
                  <button onClick={() => setEdit(user)}>
                    Изменить{user.id === currentUserId ? " себя" : ""}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {edit && (
        <UserDialog
          user={edit}
          onClose={() => setEdit(null)}
          onSaved={() => {
            setEdit(null);
            void load().catch((caught) => setError(errorText(caught)));
          }}
        />
      )}
    </>
  );
}
function UserDialog({
  user,
  onClose,
  onSaved,
}: {
  user: Partial<User>;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [value, setValue] = useState({
    email: "",
    displayName: "",
    role: "OPERATOR" as Role,
    disabled: false,
    ...user,
  });
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
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
          role: value.role,
          ...(user.id ? { disabled: value.disabled } : {}),
          ...(password ? { password } : {}),
        }),
      });
      onSaved();
    } catch (caught) {
      setError(errorText(caught));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title={user.id ? "Настройки пользователя" : "Новый пользователь"}
      onClose={onClose}
    >
      <form onSubmit={submit}>
        {error && <Notice>{error}</Notice>}
        <label>
          Имя
          <input
            autoFocus
            required
            value={value.displayName}
            onChange={(event) =>
              setValue({ ...value, displayName: event.target.value })
            }
          />
        </label>
        <label>
          Электронная почта
          <input
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
          Роль
          <select
            value={value.role}
            onChange={(event) =>
              setValue({ ...value, role: event.target.value as Role })
            }
          >
            <option value="ADMIN">Администратор</option>
            <option value="OPERATOR">Оператор</option>
            <option value="VIEWER">Просмотр</option>
          </select>
        </label>
        <label>
          {user.id ? "Новый пароль (необязательно)" : "Первоначальный пароль"}
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
          Не менее 12 символов. Изменение роли, пароля или отключение отзывает
          активные сессии.
        </small>
        {user.id && (
          <label className="checkbox">
            <input
              type="checkbox"
              checked={value.disabled}
              onChange={(event) =>
                setValue({ ...value, disabled: event.target.checked })
              }
            />
            Отключить доступ
          </label>
        )}
        <div className="modal-actions">
          <button type="button" onClick={onClose}>
            Отмена
          </button>
          <button className="primary" disabled={busy}>
            {busy ? "Сохраняем…" : "Сохранить"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
function PasswordForm() {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [repeat, setRepeat] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    setMessage("");
    if (repeat !== newPassword) {
      setError("Новые пароли не совпадают.");
      return;
    }
    setBusy(true);
    try {
      await api("/auth/password", {
        method: "POST",
        body: json({ currentPassword, newPassword }),
      });
      setMessage("Пароль изменён. Войдите заново с новым паролем.");
      setCurrentPassword("");
      setNewPassword("");
      setRepeat("");
    } catch (caught) {
      setError(errorText(caught));
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="narrow-form" onSubmit={submit}>
      <h2>Смена пароля</h2>
      {error && <Notice>{error}</Notice>}
      {message && <Notice kind="success">{message}</Notice>}
      <label>
        Текущий пароль
        <input
          type="password"
          required
          autoComplete="current-password"
          value={currentPassword}
          onChange={(event) => setCurrentPassword(event.target.value)}
        />
      </label>
      <label>
        Новый пароль
        <input
          type="password"
          required
          minLength={12}
          autoComplete="new-password"
          value={newPassword}
          onChange={(event) => setNewPassword(event.target.value)}
        />
      </label>
      <label>
        Повторите новый пароль
        <input
          type="password"
          required
          autoComplete="new-password"
          value={repeat}
          onChange={(event) => setRepeat(event.target.value)}
        />
      </label>
      <button className="primary" disabled={busy}>
        {busy ? "Сохраняем…" : "Изменить пароль"}
      </button>
    </form>
  );
}
