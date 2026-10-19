"use client";
import { useCabinetText, useCabinetError, useCabinetLanguage } from "./cabinet-language";
import { useEffect, useState } from "react";
import { Notice } from "@demo/ui";
import { api, json } from "@/lib/api";
import type { Customer, Recipient } from "@/lib/types";
import { RecordPicker } from "./record-picker";
import { EmployerAccessRequests } from "./employer-access-request";
type User = { id: string; displayName: string; email: string; role: string };
type Membership = {
  id: string;
  customerId: string;
  userId: string;
  permissions: string[];
  expiresAt?: string;
  revokedAt?: string;
  active?: boolean;
  customer?: { nameRu: string; nameKz?: string; bin?: string };
};
type Invite = {
  id: string;
  email: string;
  displayName: string;
  expiresAt: string;
  consumedAt?: string;
  revokedAt?: string;
};
export function PortalAccess() {
  const tr = useCabinetText();
  const t = useCabinetLanguage();
  const [mode, setMode] = useState("INVITE");
  const [invites, setInvites] = useState<Invite[]>([]);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteName, setInviteName] = useState("");
  const [inviteHours, setInviteHours] = useState(24);
  const [inviteUrl, setInviteUrl] = useState("");
  const [copied, setCopied] = useState(false);
  const [memberships, setMemberships] = useState<Membership[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [picker, setPicker] = useState<"customers" | "recipients" | null>(null);
  const [scope, setScope] = useState("ALL");
  const [recipients, setRecipients] = useState<Recipient[]>([]);
  const [userId, setUserId] = useState("");
  const [permissions, setPermissions] = useState(["READ"]);
  const [expiry, setExpiry] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useCabinetError();
  const [busy, setBusy] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [message, setMessage] = useState("");
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (window.location.hash === "#organization-access") setOpen(true);
  }, []);
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    Promise.all([
      api<{ items: Membership[] }>("/employer-memberships"),
      api<{ items: User[] }>("/users"),
      api<{ items: Invite[] }>("/employer-invites"),
    ])
      .then(([m, u, i]) => {
        if (active) {
          setMemberships(m.items);
          setUsers(u.items.filter((user) => user.role === "EMPLOYER"));
          setInvites(i.items);
          setLoaded(true);
        }
      })
      .catch((c) => {
        if (active) { setError(c); setLoaded(false); }
      }).finally(() => { if (active) setLoading(false); });
    return () => {
      active = false;
    };
  }, [refresh]);
  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await action();
      setRefresh((v) => v + 1);
      setConfirmed(false);
      setMessage(t("Доступ обновлён", "Рұқсат жаңартылды"));
    } catch (c) {
      setError(c);
    } finally {
      setBusy(false);
    }
  }
  return (
    <details className="outcome-entry" id="organization-access" open={open} onToggle={event => setOpen(event.currentTarget.open)}>
      <summary>{tr("Доступ представителей заказчиков")}</summary>
      <EmployerAccessRequests manager />
      {error && <Notice>{error} <button type="button" disabled={loading} onClick={() => setRefresh(value => value + 1)}>{t("Повторить загрузку", "Қайта жүктеу")}</button></Notice>}
      {loading && <p role="status">{t("Загружаем доступы…", "Рұқсаттар жүктелуде…")}</p>}
      {message && <p role="status">{message}</p>}
      <label>
        {tr("Способ предоставления доступа")}<select
          aria-label={tr("Способ предоставления доступа")}
          value={mode}
          onChange={(e) => {
            setMode(e.target.value);
            setConfirmed(false);
            setInviteUrl("");
          }}
        >
          <option value="INVITE">{tr("Одноразовое приглашение")}</option>
          <option value="PASSWORD" disabled={loaded && !users.length}>{tr("Существующая учётная запись")}</option>
        </select>
      </label>
      {inviteUrl && (
        <div className="notice" role="status">
          <p>
            {tr("Ссылка показана только сейчас. Передайте её выбранному представителю лично; отправка по почте не выполняется.")}</p>
          <label>
            {tr("Одноразовая ссылка")}<input
              readOnly
              value={inviteUrl}
              onFocus={(e) => e.target.select()}
            />
          </label>
          <button
            onClick={() => {
              void navigator.clipboard
                .writeText(inviteUrl)
                .then(() => setCopied(true))
                .catch(() =>
                  setError("Выделите ссылку и скопируйте её вручную."),
                );
            }}
          >
            {copied ? tr("Ссылка скопирована") : tr("Скопировать приглашение")}
          </button>
          <button onClick={() => setInviteUrl("")}>{tr("Скрыть ссылку")}</button>
        </div>
      )}
      {invites.length > 0 && (
        <details>
          <summary>{tr("Выданные приглашения (")}{invites.length})</summary>
          {invites.map((invite) => (
            <div className="outcome-entry" key={invite.id}>
              <strong>{invite.displayName}</strong>
              <p>
                {invite.email} {" "}{tr("· до")}{" "}
                {new Date(invite.expiresAt).toLocaleString(tr("Настройки") === "Настройки" ? "ru-KZ" : "kk-KZ")}
              </p>
              <p>
                {invite.revokedAt
                  ? tr("Отозвано")
                  : invite.consumedAt
                    ? tr("Принято")
                    : Date.parse(invite.expiresAt) <= Date.now()
                      ? tr("Истекло")
                      : tr("Ожидает принятия")}
              </p>
              {!invite.revokedAt && (
                <button
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      await api(`/employer-invites/${invite.id}/revoke`, {
                        method: "POST",
                        body: "{}",
                      });
                      setInviteUrl("");
                    })
                  }
                >
                  {invite.consumedAt
                    ? tr("Отозвать приглашение и доступ")
                    : tr("Отозвать приглашение")}
                </button>
              )}
            </div>
          ))}
        </details>
      )}
      {loaded && <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>{tr("Представитель")}</th>
              <th>{t("Организация", "Ұйым")}</th>
              <th>{tr("Срок")}</th>
              <th>{tr("Права")}</th>
              <th>{tr("Состояние")}</th>
            </tr>
          </thead>
          <tbody>
            {memberships.map((m) => (
              <tr key={m.id}>
                <td>
                  {users.find((u) => u.id === m.userId)?.displayName ||
                    tr("Представитель")}
                  <small>{users.find((u) => u.id === m.userId)?.email}</small>
                </td>
                <td>{m.customer ? t(m.customer.nameRu, m.customer.nameKz || m.customer.nameRu) : t("Организация недоступна", "Ұйым қолжетімсіз")}{m.customer?.bin && <small>{m.customer.bin}</small>}</td>
                <td>
                  {m.expiresAt
                    ? new Date(m.expiresAt).toLocaleDateString(tr("Настройки") === "Настройки" ? "ru-KZ" : "kk-KZ")
                    : tr("Не задан")}
                </td>
                <td>
                  {m.permissions
                    .map(
                      (p) =>
                        (
                          ({
                            READ: tr("Просмотр"),
                            PROPOSE: tr("Предложения"),
                            APPROVE_DATA: tr("Согласование"),
                            DOWNLOAD: tr("Скачивание"),
                            ASSIGN_TRAINING: tr("Назначение обучения"),
                          }) as Record<string, string>
                        )[p] || p,
                    )
                    .join(", ")}
                </td>
                <td>
                  {m.revokedAt || m.active === false ? (
                    tr("Отозван")
                  ) : (
                    <><span>{m.expiresAt && Date.parse(m.expiresAt) <= Date.now() ? t("Срок истёк", "Мерзімі аяқталды") : t("Действует", "Қолданыста")}</span>{" "}<button
                      disabled={busy}
                      onClick={() =>
                        void run(() =>
                          api(`/employer-memberships/${m.id}/revoke`, {
                            method: "POST",
                            body: "{}",
                          }),
                        )
                      }
                    >
                      {tr("Отозвать доступ")}</button></>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>}
      {loaded && !memberships.length && <p>{t("Представителей ещё нет. Создайте приглашение для выбранной организации.", "Өкілдер әлі жоқ. Таңдалған ұйым үшін шақыру жасаңыз.")}</p>}
      <div className="form-grid">
        <div>
          <label>{tr("Организация заказчика")}</label>
          <button onClick={() => setPicker("customers")}>
            {customer?.nameRu || tr("Выбрать организацию")}
          </button>
        </div>
        {mode === "PASSWORD" ? (
          <label>
            {tr("Представитель")}<select
              aria-label={tr("Представитель")}
              value={userId}
              onChange={(e) => {
                setUserId(e.target.value);
                setConfirmed(false);
              }}
            >
              <option value="">{tr("Выберите учётную запись")}</option>
              {users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.displayName} · {u.email}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <>
            <label>
              {tr("Имя представителя")}<input
                value={inviteName}
                maxLength={255}
                onChange={(e) => {
                  setInviteName(e.target.value);
                  setConfirmed(false);
                }}
              />
            </label>
            <label>
              {tr("Адрес представителя")}<input
                type="email"
                autoComplete="off"
                value={inviteEmail}
                maxLength={255}
                onChange={(e) => {
                  setInviteEmail(e.target.value);
                  setConfirmed(false);
                }}
              />
            </label>
            <label>
              {tr("Срок приглашения")}<select
                aria-label={tr("Срок приглашения")}
                value={inviteHours}
                onChange={(e) => {
                  setInviteHours(Number(e.target.value));
                  setConfirmed(false);
                }}
              >
                <option value={1}>{tr("1 час")}</option>
                <option value={24}>{tr("24 часа")}</option>
                <option value={72}>{tr("3 суток")}</option>
                <option value={168}>{tr("7 суток")}</option>
              </select>
            </label>
          </>
        )}
        <label>
          {tr("Доступ до")}<input
            type="datetime-local"
            value={expiry}
            onChange={(e) => {
              setExpiry(e.target.value);
              setConfirmed(false);
            }}
          />
        </label>
      </div>
      <label>
        {tr("Область людей представителя")}<select
          aria-label={tr("Область людей представителя")}
          value={scope}
          onChange={(e) => {
            setScope(e.target.value);
            setConfirmed(false);
          }}
        >
          <option value="ALL">{tr("Все люди выбранного заказчика")}</option>
          <option value="SELECTED">{tr("Только выбранные люди заказчика")}</option>
        </select>
      </label>
      {scope === "SELECTED" && (
        <>
          <button disabled={!customer} onClick={() => setPicker("recipients")}>
            {tr("Добавить человека в область доступа")}</button>
          <p>
            {tr("Файлы и строки дополнительно ограничены выбранным заказчиком. Совпадение ФИО не расширяет доступ.")}</p>
          {recipients.map((person) => (
            <p key={person.recipientId}>
              {person.fullNameRu} {person.personnelNumber || ""}{" "}
              <button
                onClick={() => {
                  setRecipients(
                    recipients.filter(
                      (p) => p.recipientId !== person.recipientId,
                    ),
                  );
                  setConfirmed(false);
                }}
              >
                {tr("Убрать из доступа")}</button>
            </p>
          ))}
        </>
      )}
      <div className="toolbar-actions">
        {[
          ["READ", tr("Просмотр")],
          ["PROPOSE", tr("Предложения изменений")],
          ["APPROVE_DATA", tr("Подтверждение списка")],
          ["DOWNLOAD", tr("Скачивание файлов")],
          ["ASSIGN_TRAINING", tr("Назначение обучения")],
        ].map(([key, title]) => (
          <label className="checkbox" key={key}>
            <input
              type="checkbox"
              disabled={key === "READ"}
              checked={permissions.includes(key)}
              onChange={(e) => {
                setPermissions(
                  e.target.checked
                    ? [...permissions, key]
                    : permissions.filter((p) => p !== key),
                );
                setConfirmed(false);
              }}
            />
            {title}
          </label>
        ))}
      </div>
      <label className="checkbox">
        <input
          type="checkbox"
          checked={confirmed}
          onChange={(e) => setConfirmed(e.target.checked)}
        />
        {tr("Разрешаю доступ к составу и заказам выбранной организации в пределах отмеченных прав")}</label>
      <button
        className="primary"
        disabled={
          busy ||
          loading ||
          !loaded ||
          !confirmed ||
          !customer ||
          (mode === "PASSWORD"
            ? !userId
            : !inviteEmail || !inviteName.trim()) ||
          !expiry ||
          new Date(expiry).getTime() <= Date.now() ||
          (scope === "SELECTED" && !recipients.length)
        }
        onClick={() =>
          void run(async () => {
            if (mode === "INVITE") {
              const result = await api<{ inviteUrl: string }>(
                "/employer-invites",
                {
                  method: "POST",
                  body: json({
                    customerId: customer!.id,
                    email: inviteEmail,
                    displayName: inviteName,
                    permissions,
                    accessExpiresAt: new Date(expiry).toISOString(),
                    expiresAt: new Date(
                      Math.min(
                        Date.now() + inviteHours * 3600_000,
                        new Date(expiry).getTime(),
                      ),
                    ).toISOString(),
                    recipientIds:
                      scope === "SELECTED"
                        ? recipients.map((p) => p.recipientId)
                        : [],
                  }),
                },
              );
              setInviteUrl(result.inviteUrl);
              setCopied(false);
              return;
            }
            return api("/employer-memberships", {
              method: "POST",
              body: json({
                customerId: customer!.id,
                userId,
                permissions,
                expiresAt: new Date(expiry).toISOString(),
                recipientIds:
                  scope === "SELECTED"
                    ? recipients.map((p) => p.recipientId)
                    : [],
              }),
            });
          })
        }
      >
        {mode === "INVITE"
          ? tr("Создать одноразовое приглашение")
          : tr("Открыть доступ представителю")}
      </button>
      {mode === "PASSWORD" && !users.length && (
        <p>{t("Для нового представителя выберите одноразовое приглашение.", "Жаңа өкіл үшін бір реттік шақыруды таңдаңыз.")}</p>
      )}
      {picker && (
        <RecordPicker
          kind={picker}
          onClose={() => setPicker(null)}
          onCustomer={(c) => {
            setCustomer(c);
            setPicker(null);
            setRecipients([]);
            setConfirmed(false);
          }}
          onRecipient={(person) => {
            if (
              person.recipientId &&
              !recipients.some((p) => p.recipientId === person.recipientId)
            )
              setRecipients([...recipients, person]);
            setPicker(null);
            setConfirmed(false);
          }}
        />
      )}
    </details>
  );
}
