"use client";
import { useEffect, useState } from "react";
import { Notice } from "@demo/ui";
import { api, errorText, json } from "@/lib/api";
import type { Customer, Recipient } from "@/lib/types";
import { RecordPicker } from "./record-picker";
type User = { id: string; displayName: string; email: string; role: string };
type Membership = {
  id: string;
  customerId: string;
  userId: string;
  permissions: string[];
  expiresAt?: string;
  revokedAt?: string;
  active?: boolean;
};
export function PortalAccess() {
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
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    let active = true;
    Promise.all([
      api<{ items: Membership[] }>("/employer-memberships"),
      api<{ items: User[] }>("/users"),
    ])
      .then(([m, u]) => {
        if (active) {
          setMemberships(m.items);
          setUsers(u.items.filter((user) => user.role === "EMPLOYER"));
        }
      })
      .catch((c) => {
        if (active) setError(errorText(c));
      });
    return () => {
      active = false;
    };
  }, [refresh]);
  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setError("");
    try {
      await action();
      setRefresh((v) => v + 1);
      setConfirmed(false);
    } catch (c) {
      setError(errorText(c));
    } finally {
      setBusy(false);
    }
  }
  return (
    <details className="outcome-entry">
      <summary>Доступ представителей заказчиков</summary>
      {error && <Notice>{error}</Notice>}
      <p>
        Представитель использует отдельную учётную запись с ролью «Представитель
        заказчика». Здесь доступ ограничивается выбранной организацией и
        указанными действиями.
      </p>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Представитель</th>
              <th>Срок</th>
              <th>Права</th>
              <th>Состояние</th>
            </tr>
          </thead>
          <tbody>
            {memberships.map((m) => (
              <tr key={m.id}>
                <td>
                  {users.find((u) => u.id === m.userId)?.displayName ||
                    "Представитель"}
                  <small>{users.find((u) => u.id === m.userId)?.email}</small>
                </td>
                <td>
                  {m.expiresAt
                    ? new Date(m.expiresAt).toLocaleDateString("ru-RU")
                    : "Не задан"}
                </td>
                <td>
                  {m.permissions
                    .map(
                      (p) =>
                        (
                          ({
                            READ: "Просмотр",
                            PROPOSE: "Предложения",
                            APPROVE_DATA: "Согласование",
                            DOWNLOAD: "Скачивание",
                          }) as Record<string, string>
                        )[p] || p,
                    )
                    .join(", ")}
                </td>
                <td>
                  {m.revokedAt || m.active === false ? (
                    "Отозван"
                  ) : (
                    <button
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
                      Отозвать доступ
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="form-grid">
        <div>
          <label>Организация заказчика</label>
          <button onClick={() => setPicker("customers")}>
            {customer?.nameRu || "Выбрать организацию"}
          </button>
        </div>
        <label>
          Представитель
          <select
            value={userId}
            onChange={(e) => {
              setUserId(e.target.value);
              setConfirmed(false);
            }}
          >
            <option value="">Выберите учётную запись</option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.displayName} · {u.email}
              </option>
            ))}
          </select>
        </label>
        <label>
          Доступ до
          <input
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
        Область людей представителя
        <select
          value={scope}
          onChange={(e) => {
            setScope(e.target.value);
            setConfirmed(false);
          }}
        >
          <option value="ALL">Все люди выбранного заказчика</option>
          <option value="SELECTED">Только выбранные люди заказчика</option>
        </select>
      </label>
      {scope === "SELECTED" && (
        <>
          <button disabled={!customer} onClick={() => setPicker("recipients")}>
            Добавить человека в область доступа
          </button>
          <p>
            Файлы и строки дополнительно ограничены выбранным заказчиком.
            Совпадение ФИО не расширяет доступ.
          </p>
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
                Убрать из доступа
              </button>
            </p>
          ))}
        </>
      )}
      <div className="toolbar-actions">
        {[
          ["READ", "Просмотр"],
          ["PROPOSE", "Предложения изменений"],
          ["APPROVE_DATA", "Подтверждение списка"],
          ["DOWNLOAD", "Скачивание файлов"],
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
        Разрешаю доступ к составу и заказам выбранной организации в пределах
        отмеченных прав
      </label>
      <button
        className="primary"
        disabled={
          busy ||
          !confirmed ||
          !customer ||
          !userId ||
          !expiry ||
          (scope === "SELECTED" && !recipients.length)
        }
        onClick={() =>
          void run(() =>
            api("/employer-memberships", {
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
            }),
          )
        }
      >
        Открыть доступ представителю
      </button>
      {!users.length && (
        <p>Создайте учётную запись представителя в настройках пользователей.</p>
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
