"use client";
import { useEffect, useRef, useState } from "react";
import { OwnPasswordForm } from "../own-password-form";
import { Notice } from "@demo/ui";
import { api, json, ApiError } from "@/lib/api";
import { LmsHeading, lmsError, type Translate } from "./common";
type Profile = {
  displayName: string;
  email: string;
  fullNameRu: string | null;
  phone: string | null;
  preferences: { language?: "ru" | "kz"; showUnreadBadge?: boolean };
  revision: string;
};
export function LmsProfile({ t, scope }: { t: Translate; scope: string }) {
  const [profile, setProfile] = useState<Profile | null>(null),
    [error, setError] = useState<unknown>(null),
    [status, setStatus] = useState("");
  const [conflict, setConflict] = useState<Profile | null>(null);
  const [reload, setReload] = useState(0);
  const alive = useRef(false), inFlight = useRef(false), blocked = useRef(false);
  const revision = useRef(""),
    pending = useRef<Profile | null>(null),
    timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    alive.current = true;
    void api<Profile>("/lms/profile")
      .then((value) => {
        if (alive.current) {
          setProfile(value);
          revision.current = value.revision;
          setError(null);
        }
      })
      .catch((caught) => { if (alive.current) setError(caught); });
    const warn = (event: BeforeUnloadEvent) => {
      if (pending.current || inFlight.current) { event.preventDefault(); event.returnValue = ""; }
    };
    window.addEventListener("beforeunload", warn);
    return () => {
      alive.current = false;
      window.removeEventListener("beforeunload", warn);
      if (timer.current) clearTimeout(timer.current);
      if (pending.current && !blocked.current) save();
    };
  }, [reload]);
  function save() {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    const value = pending.current;
    if (!value || inFlight.current || blocked.current) return;
    pending.current = null;
    inFlight.current = true;
    if (alive.current) setStatus("saving");
    void api<Profile>("/lms/profile", {
          method: "PUT",
          body: json({
            displayName: value.displayName,
            preferences: value.preferences,
            revision: revision.current,
          }),
        })
      .then((result) => {
        revision.current = result.revision;
        if (alive.current) {
          setStatus(pending.current ? "saving" : "saved");
          setError(null);
        }
      })
      .catch(async (caught) => {
        pending.current ||= value;
        blocked.current = true;
        if (alive.current) { setError(caught); setStatus("error"); }
        if (caught instanceof ApiError && caught.status === 409) {
          try {
            const latest = await api<Profile>("/lms/profile");
            if (alive.current) setConflict(latest);
          } catch (loadError) {
            if (alive.current) setError(loadError);
          }
        }
      })
      .finally(() => {
        inFlight.current = false;
        if (pending.current && !blocked.current) save();
      });
  }
  function edit(value: Profile) {
    setProfile(value);
    pending.current = value;
    setStatus(blocked.current ? "error" : "saving");
    if (timer.current) clearTimeout(timer.current);
    if (!blocked.current) timer.current = setTimeout(save, 700);
  }
  return (
    <>
      <LmsHeading title={t("Профиль и настройки", "Профиль және баптаулар")} />
      {!profile && !error && <p role="status">{t("Открываем профиль…", "Профиль ашылуда…")}</p>}
      {!!error && (
        <Notice>
          <span role="alert">{lmsError(error, t)}</span>
          {conflict && (
            <p>
              {t("Сохранённое имя", "Сақталған аты")}: {conflict.displayName}
            </p>
          )}
          <button
            onClick={() => {
              if (!profile) { setReload((value) => value + 1); return; }
              if (conflict) {
                revision.current = conflict.revision;
                setConflict(null);
              }
              blocked.current = false;
              save();
            }}
          >
            {!profile ? t("Повторить загрузку", "Қайта жүктеу") : conflict
              ? t("Сохранить мой вариант", "Менің нұсқамды сақтау")
              : t("Повторить сохранение", "Қайта сақтау")}
          </button>
          {conflict && <button onClick={() => {
            pending.current = null;
            blocked.current = false;
            revision.current = conflict.revision;
            setProfile(conflict);
            setConflict(null);
            setError(null);
            setStatus("saved");
          }}>{t("Принять сохранённый вариант", "Сақталған нұсқаны қабылдау")}</button>}
        </Notice>
      )}
      <section className="panel lms-panel"><OwnPasswordForm t={t} /></section>
      {profile && (
        <section className="panel lms-panel">
          <label>
            {t("Имя в кабинете", "Кабинеттегі атыңыз")}
            <input
              value={profile.displayName}
              onChange={(event) =>
                edit({ ...profile, displayName: event.target.value })
              }
              maxLength={300}
              onBlur={save}
            />
          </label>
          <dl>
            <dt>E-mail</dt>
            <dd>{profile.email}</dd>
            {profile.fullNameRu && (
              <>
                <dt>{t("ФИО в документах", "Құжаттағы аты-жөні")}</dt>
                <dd>{profile.fullNameRu}</dd>
              </>
            )}
            {profile.phone && (
              <>
                <dt>{t("Телефон", "Телефон")}</dt>
                <dd>{profile.phone}</dd>
              </>
            )}
          </dl>
          <label>
            {t("Язык кабинета и уведомлений", "Кабинет пен хабарламалар тілі")}
            <select
              value={profile.preferences.language || "ru"}
              onChange={(event) => {
                const language = event.target.value as "ru" | "kz";
                try {
                  localStorage.setItem(`demo:lms:language:${scope}`, language);
                } catch {
                  /* optional local preference */
                }
                window.dispatchEvent(
                  new CustomEvent("demo:lms-language", {
                    detail: { scope, language },
                  }),
                );
                edit({
                  ...profile,
                  preferences: {
                    ...profile.preferences,
                    language,
                  },
                });
              }}
            >
              <option value="ru">Русский</option>
              <option value="kz">Қазақша</option>
            </select>
          </label>
          <label className="lms-inline-label">
            <input
              type="checkbox"
              checked={profile.preferences.showUnreadBadge !== false}
              onChange={(event) =>
                edit({
                  ...profile,
                  preferences: {
                    ...profile.preferences,
                    showUnreadBadge: event.target.checked,
                  },
                })
              }
            />
            {t(
              "Показывать счётчик непрочитанных",
              "Оқылмаған хабарламалар санын көрсету",
            )}
          </label>
          <p role="status">
            {status === "saving"
              ? t("Сохраняется…", "Сақталуда…")
              : status === "saved"
                ? t("Сохранено", "Сақталды")
                : ""}
          </p>
          <details>
            <summary>
              {t(
                "Изменить подтверждённые данные",
                "Расталған деректерді өзгерту",
              )}
            </summary>
            <p>
              {t(
                "Для изменения ФИО в документах, контакта для входа или организации обратитесь в центр. Изменение имени кабинета не меняет эти данные.",
                "Құжаттағы аты-жөнін, кіру байланысын немесе ұйымды өзгерту үшін орталыққа хабарласыңыз. Кабинет атауы бұл деректерді өзгертпейді.",
              )}
            </p>
          </details>
        </section>
      )}
    </>
  );
}
