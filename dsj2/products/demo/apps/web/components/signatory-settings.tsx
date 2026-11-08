"use client";
import { useCabinetText, useCabinetError } from "./cabinet-language";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { Notice } from "@demo/ui";
import { api, json } from "@/lib/api";
import {
  eligibleSignatory,
  matchingSignatory,
  mergeSavedSignatory,
  signatoryRevocationPayload,
  signatoryReturnPath,
  signatoryRole,
  type Signatory,
  type SignatoryRole,
  type SignatoryUser,
} from "@/lib/signatory-settings";
const roleNames = {
  DIRECTOR: "Директор",
  CHAIR: "Председатель комиссии",
  MEMBER: "Член комиссии",
  TEACHER: "Преподаватель",
};

export function SignatorySettings({
  focusSetup = false,
  initialRole,
  returnTo,
}: {
  focusSetup?: boolean;
  initialRole?: string | null;
  returnTo?: string | null;
}) {
  const tr = useCabinetText();
  const [items, setItems] = useState<Signatory[]>([]);
  const [users, setUsers] = useState<SignatoryUser[]>([]);
  const [userId, setUserId] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [role, setRole] = useState<SignatoryRole>(() =>
    signatoryRole(initialRole),
  );
  const [iin, setIin] = useState("");
  const [bin, setBin] = useState("");
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const loadGeneration = useRef(0);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useCabinetError();
  const [error, setError] = useCabinetError();
  const [saved, setSaved] = useState(false);
  const [revocation, setRevocation] = useState<Signatory | null>(null);
  const [revoked, setRevoked] = useState<Signatory | null>(null);
  const eligibleUsers = users.filter((user) => eligibleSignatory(user, role));
  const safeReturnTo = signatoryReturnPath(returnTo);
  const unchanged = Boolean(
    matchingSignatory(items, { userId, role, displayName, iin, bin }),
  );
  const disabled = busy || loading || !loaded;
  const formDisabled = disabled || !!revocation;
  const load = useCallback(async () => {
    const generation = ++loadGeneration.current;
    setLoading(true);
    setLoadError("");
    try {
      const [bindings, directory] = await Promise.all([
        api<{ items: Signatory[] }>("/settings/signatories"),
        api<{ items: SignatoryUser[] }>("/users"),
      ]);
      if (generation !== loadGeneration.current) return;
      setItems(bindings.items);
      setUsers(directory.items);
      setLoaded(true);
    } catch (caught) {
      if (generation === loadGeneration.current) setLoadError(caught);
    } finally {
      if (generation === loadGeneration.current) setLoading(false);
    }
  }, []);
  useEffect(() => {
    void load();
    return () => {
      loadGeneration.current += 1;
    };
  }, [load]);
  useEffect(() => {
    if (focusSetup) headingRef.current?.focus();
  }, [focusSetup]);
  function selectUser(nextUserId: string) {
    setUserId(nextUserId);
    const previous =
      items.find(
        (entry) =>
          entry.active && entry.userId === nextUserId && entry.role === role,
      ) || items.find((entry) => entry.active && entry.userId === nextUserId);
    setDisplayName(
      previous?.displayName ||
        users.find((user) => user.id === nextUserId)?.displayName ||
        "",
    );
    setIin(previous?.iin || "");
    setBin(previous?.bin || "");
    setSaved(false);
    setRevoked(null);
    setError("");
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busyRef.current || formDisabled || unchanged) return;
    busyRef.current = true;
    setBusy(true);
    setError("");
    setSaved(false);
    setRevoked(null);
    try {
      if (
        !eligibleUsers.some((entry) => entry.id === userId) ||
        displayName.trim().length < 2
      )
        throw new Error(
          tr(
            "Выберите действующего сотрудника и укажите ФИО как в документах комиссии.",
          ),
        );
      const binding = await api<Signatory>("/settings/signatories", {
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
      setItems((previous) => mergeSavedSignatory(previous, binding));
      setSaved(true);
    } catch (caught) {
      setError(caught);
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }
  async function revoke() {
    if (busyRef.current || disabled || !revocation) return;
    const current = items.find(
      (entry) => entry.id === revocation.id && entry.active,
    );
    const payload = current && signatoryRevocationPayload(current);
    if (!payload) return;
    busyRef.current = true;
    setBusy(true);
    setError("");
    setSaved(false);
    try {
      const binding = await api<Signatory>("/settings/signatories", {
        method: "POST",
        body: json(payload),
      });
      setItems((previous) => mergeSavedSignatory(previous, binding));
      setRevoked(revocation);
      setRevocation(null);
      if (userId === revocation.userId && role === revocation.role) {
        setUserId("");
        setDisplayName("");
        setIin("");
        setBin("");
      }
    } catch (caught) {
      setError(caught);
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }
  return (
    <div id="signatory-settings">
      <h2 ref={headingRef} tabIndex={-1}>
        {tr("Подписанты ЭЦП")}
      </h2>
      <Notice kind="info">
        {tr(
          "Для печати достаточно согласования директора. Здесь настраивается ЭЦП; ФИО комиссии — в реквизитах центра.",
        )}
      </Notice>
      <p>
        {tr(
          "Назначьте директора, председателя и преподавателя. Один сотрудник может иметь несколько ролей.",
        )}
      </p>
      <p className="muted">
        {tr(
          "Изменения действуют только для новых оформлений.",
        )}
      </p>
      <p className="muted">
        {tr(
          "Преподавателем-подписантом может быть оператор или директор. Учётная запись преподавателя LMS для этого не подходит.",
        )}
      </p>
      {loadError && (
        <Notice>
          {loadError}
          <div className="toolbar">
            <button
              type="button"
              disabled={loading || busy}
              onClick={() => void load()}
            >
              {tr("Повторить загрузку")}
            </button>
          </div>
        </Notice>
      )}
      {loading && <p role="status">{tr("Загружаем подписантов…")}</p>}
      {error && <Notice>{error}</Notice>}
      {saved && (
        <Notice kind="success">
          {tr("Новая привязка подписанта сохранена.")}
        </Notice>
      )}
      {revoked && (
        <Notice kind="success">
          {tr("Полномочие отозвано")}: {tr(roleNames[revoked.role])} —{" "}
          {revoked.displayName}.
        </Notice>
      )}
      {safeReturnTo && (
        <p>
          <a className="button secondary" href={safeReturnTo}>
            {tr("Вернуться к заявке")}
          </a>
        </p>
      )}
      {loaded && items.length === 0 && (
        <p>
          {tr("Подписанты ЭЦП ещё не назначены.")}
        </p>
      )}
      {items.length > 0 && (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>{tr("Подписант")}</th>
                <th>{tr("Роль")}</th>
                <th>{tr("ИИН")}</th>
                <th>{tr("Состояние")}</th>
                <th>{tr("Действия")}</th>
              </tr>
            </thead>
            <tbody>
              {items.map((entry) => (
                <tr key={entry.id}>
                  <td>{entry.displayName}</td>
                  <td>{tr(roleNames[entry.role])}</td>
                  <td>
                    {entry.iin.slice(0, 3)}••••••{entry.iin.slice(-3)}
                  </td>
                  <td>
                    {entry.active
                      ? tr("Действует")
                      : items.some(
                            (candidate) =>
                              candidate.active &&
                              candidate.userId === entry.userId &&
                              candidate.role === entry.role,
                          )
                        ? tr("Предыдущая версия")
                        : tr("Полномочие отозвано")}
                  </td>
                  <td>
                    {entry.active && (
                      <button
                        type="button"
                        disabled={formDisabled}
                        aria-label={`${tr("Отозвать полномочие")}: ${tr(roleNames[entry.role])} — ${entry.displayName}`}
                        onClick={() => {
                          setRevocation(entry);
                          setRevoked(null);
                          setSaved(false);
                          setError("");
                        }}
                      >
                        {tr("Отозвать полномочие")}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {revocation && (
        <Notice kind="info">
          <p>
            <strong>
              {tr("Отозвать полномочие")}: {tr(roleNames[revocation.role])} —{" "}
              {revocation.displayName}?
            </strong>
          </p>
          <p>
            {tr(
              "Это полномочие ЭЦП перестанет действовать. Незавершённым выпускам может потребоваться исправление. Уже проверенные подписи сохранятся.",
            )}
          </p>
          <div className="button-row">
            <button
              type="button"
              disabled={disabled}
              onClick={() => setRevocation(null)}
            >
              {tr("Оставить полномочие")}
            </button>
            <button
              type="button"
              className="danger-text"
              disabled={disabled}
              onClick={() => void revoke()}
            >
              {busy ? tr("Сохраняем…") : tr("Подтвердить отзыв")}
            </button>
          </div>
        </Notice>
      )}
      <form onSubmit={submit} className="approval-decision">
        <h3>{tr("Добавить или обновить привязку")}</h3>
        <label>
          {tr("Роль подписанта")}
          <select
            disabled={formDisabled}
            value={role}
            onChange={(event) => {
              const nextRole = event.target.value as SignatoryRole;
              setRole(nextRole);
              const selectedUser = users.find((user) => user.id === userId);
              if (!selectedUser || !eligibleSignatory(selectedUser, nextRole)) {
                setUserId("");
                setDisplayName("");
                setIin("");
                setBin("");
              } else {
                const previous = items.find(
                  (entry) =>
                    entry.active &&
                    entry.userId === userId &&
                    entry.role === nextRole,
                );
                if (previous) {
                  setDisplayName(previous.displayName);
                  setIin(previous.iin);
                  setBin(previous.bin || "");
                }
              }
              setSaved(false);
              setError("");
            }}
          >
            {Object.entries(roleNames).map(([value, label]) => (
              <option key={value} value={value}>
                {tr(label)}
              </option>
            ))}
          </select>
        </label>
        <label>
          {tr("Пользователь")}
          <select
            required
            disabled={formDisabled}
            value={userId}
            onChange={(event) => selectUser(event.target.value)}
          >
            <option value="">{tr("Выберите пользователя")}</option>
            {eligibleUsers.map((user) => (
              <option key={user.id} value={user.id}>
                {user.displayName}
              </option>
            ))}
          </select>
        </label>
        {loaded && !eligibleUsers.length && (
          <Notice kind="info">
            {tr("Для этой роли нет действующих сотрудников.")}{" "}
            <a href="/settings?tab=users">{tr("Открыть пользователей")}</a>
          </Notice>
        )}
        <label>
          {tr("ФИО в документах / комиссии")}
          <input
            required
            disabled={formDisabled}
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
          {tr(
            "ФИО должно совпадать с реквизитами центра или группы.",
          )}
        </p>
        <div className="form-grid">
          <label>
            {tr("ИИН владельца ЭЦП")}
            <input
              required
              disabled={formDisabled}
              inputMode="numeric"
              autoComplete="off"
              pattern="[0-9]{12}"
              minLength={12}
              maxLength={12}
              value={iin}
              onChange={(event) => {
                setIin(event.target.value.replace(/\D/g, ""));
                setSaved(false);
              }}
            />
          </label>
          <label>
            {tr("БИН сертификата организации, если требуется")}
            <input
              disabled={formDisabled}
              inputMode="numeric"
              autoComplete="off"
              pattern="[0-9]{12}"
              maxLength={12}
              value={bin}
              onChange={(event) => {
                setBin(event.target.value.replace(/\D/g, ""));
                setSaved(false);
              }}
            />
          </label>
        </div>
        <button
          className="primary"
          disabled={
            formDisabled ||
            unchanged ||
            !eligibleUsers.some((user) => user.id === userId) ||
            displayName.trim().length < 2 ||
            iin.length !== 12 ||
            (bin.length > 0 && bin.length !== 12)
          }
        >
          {busy
            ? tr("Сохраняем…")
            : unchanged
              ? tr("Привязка сохранена")
              : tr("Сохранить привязку")}
        </button>
      </form>
    </div>
  );
}
