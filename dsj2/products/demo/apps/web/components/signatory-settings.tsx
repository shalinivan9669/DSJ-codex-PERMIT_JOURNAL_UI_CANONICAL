"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Notice } from "@demo/ui";
import { isDirectorRole } from "@demo/contracts";
import { api, errorText, json } from "@/lib/api";

type Signatory = {
  id: string;
  userId: string;
  displayName: string;
  role: "DIRECTOR" | "CHAIR" | "MEMBER";
  iin: string;
  bin?: string;
  active: boolean;
};
const roleNames = {
  DIRECTOR: "Директор",
  CHAIR: "Председатель комиссии",
  MEMBER: "Член комиссии",
};

export function SignatorySettings() {
  const [items, setItems] = useState<Signatory[]>([]);
  const [users, setUsers] = useState<
    {
      id: string;
      displayName: string;
      role: string;
      active?: boolean;
      disabled?: boolean;
    }[]
  >([]);
  const [userId, setUserId] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [role, setRole] = useState<Signatory["role"]>("DIRECTOR");
  const [iin, setIin] = useState("");
  const [bin, setBin] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const eligibleUsers = users.filter(
    (user) =>
      user.active !== false &&
      !user.disabled &&
      ["ADMIN", "DIRECTOR", "OPERATOR"].includes(user.role) &&
      (role !== "DIRECTOR" || isDirectorRole(user.role)),
  );
  const load = useCallback(async () => {
    const [bindings, directory] = await Promise.all([
      api<{ items: Signatory[] }>("/settings/signatories"),
      api<{ items: typeof users }>("/users"),
    ]);
    setItems(bindings.items);
    setUsers(directory.items);
  }, []);
  useEffect(() => {
    void load().catch((caught) => setError(errorText(caught)));
  }, [load]);
  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setSaved(false);
    try {
      if (
        !eligibleUsers.some((entry) => entry.id === userId) ||
        displayName.trim().length < 2
      )
        throw new Error(
          "Выберите действующего сотрудника и укажите ФИО как в документах комиссии.",
        );
      await api("/settings/signatories", {
        method: "POST",
        body: json({
          userId,
          displayName: displayName.trim(),
          role,
          iin,
          ...(bin ? { bin } : {}),
          active: true,
        }),
      });
      await load();
      setSaved(true);
      setIin("");
      setBin("");
    } catch (caught) {
      setError(errorText(caught));
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <h2>Подписанты ЭЦП</h2>
      <Notice kind="info">
        Согласования директора достаточно для подготовки и печати документов.
        Этот раздел нужен для официального подписания ЭЦП. ФИО комиссии
        заполняются в реквизитах центра и не требуют отдельных учётных записей.
      </Notice>
      <p>
        Свяжите учётную запись подписанта с ИИН владельца ЭЦП. Председатель и
        члены комиссии должны соответствовать утверждённому профилю учебного
        центра.
      </p>
      <p className="muted">
        Ключ ЭЦП и пароль остаются у подписанта. Готовность eGov Mobile и
        проверки подписи настраивается на сервере.
      </p>
      {error && <Notice>{error}</Notice>}
      {saved && (
        <Notice kind="success">Новая привязка подписанта сохранена.</Notice>
      )}
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Подписант</th>
              <th>Роль</th>
              <th>ИИН</th>
              <th>Состояние</th>
            </tr>
          </thead>
          <tbody>
            {items.map((entry) => (
              <tr key={entry.id}>
                <td>{entry.displayName}</td>
                <td>{roleNames[entry.role]}</td>
                <td>
                  {entry.iin.slice(0, 3)}••••••{entry.iin.slice(-3)}
                </td>
                <td>{entry.active ? "Действует" : "Предыдущая версия"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <form onSubmit={submit} className="approval-decision">
        <h3>Добавить или обновить привязку</h3>
        <label>
          Пользователь
          <select
            required
            value={userId}
            onChange={(event) => {
              setUserId(event.target.value);
              setDisplayName(
                users.find((user) => user.id === event.target.value)
                  ?.displayName || "",
              );
              setSaved(false);
            }}
          >
            <option value="">Выберите пользователя</option>
            {eligibleUsers.map((user) => (
              <option key={user.id} value={user.id}>
                {user.displayName}
              </option>
            ))}
          </select>
        </label>
        <label>
          Роль подписанта
          <select
            value={role}
            onChange={(event) => {
              const nextRole = event.target.value as Signatory["role"];
              setRole(nextRole);
              if (
                nextRole === "DIRECTOR" &&
                !isDirectorRole(
                  users.find((user) => user.id === userId)?.role || "",
                )
              ) {
                setUserId("");
                setDisplayName("");
              }
              setSaved(false);
            }}
          >
            {Object.entries(roleNames).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label>
          ФИО в документах / комиссии
          <input
            required
            minLength={2}
            maxLength={255}
            autoComplete="name"
            value={displayName}
            aria-describedby="signatory-document-name-help"
            onChange={(event) => {
              setDisplayName(event.target.value);
              setSaved(false);
            }}
          />
        </label>
        <p className="muted" id="signatory-document-name-help">
          Укажите ФИО в точности как в утверждённом профиле центра: в составе
          комиссии или в поле руководителя.
        </p>
        <div className="form-grid">
          <label>
            ИИН владельца ЭЦП
            <input
              required
              inputMode="numeric"
              autoComplete="off"
              pattern="[0-9]{12}"
              minLength={12}
              maxLength={12}
              value={iin}
              onChange={(event) =>
                setIin(event.target.value.replace(/\D/g, ""))
              }
            />
          </label>
          <label>
            БИН сертификата организации, если требуется
            <input
              inputMode="numeric"
              autoComplete="off"
              pattern="[0-9]{12}"
              maxLength={12}
              value={bin}
              onChange={(event) =>
                setBin(event.target.value.replace(/\D/g, ""))
              }
            />
          </label>
        </div>
        <button
          className="primary"
          disabled={
            busy ||
            !eligibleUsers.some((user) => user.id === userId) ||
            displayName.trim().length < 2 ||
            iin.length !== 12
          }
        >
          {busy ? "Сохраняем…" : "Сохранить привязку"}
        </button>
      </form>
    </>
  );
}
