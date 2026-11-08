"use client";
import { useEffect, useRef, useState } from "react";
import { Notice } from "@demo/ui";
import { api, json } from "@/lib/api";
import { lmsError, type Translate } from "./lms/common";

export function RegistrationPolicy({
  t,
  onBusyChange,
}: {
  t: Translate;
  onBusyChange?: (pending: boolean) => void;
}) {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState<unknown>(null);
  const [reload, setReload] = useState(0);
  const pending = useRef(false);
  useEffect(() => {
    let active = true;
    void api<{ enabled: boolean }>("/lms/registration-policy")
      .then((result) => {
        if (active) {
          setEnabled(result.enabled);
          setError(null);
        }
      })
      .catch((error) => {
        if (active) setError(error);
      });
    return () => {
      active = false;
    };
  }, [reload]);
  async function toggle() {
    if (enabled === null || pending.current) return;
    pending.current = true;
    onBusyChange?.(true);
    setBusy(true);
    setError(null);
    try {
      const result = await api<{ enabled: boolean }>(
        "/lms/registration-policy",
        { method: "PATCH", body: json({ enabled: !enabled }) },
      );
      setEnabled(result.enabled);
    } catch (error) {
      setError(error);
    } finally {
      pending.current = false;
      onBusyChange?.(false);
      setBusy(false);
    }
  }
  return (
    <section className="panel">
      <h2>{t("Регистрация слушателей", "Тыңдаушыларды тіркеу")}</h2>
      {!!error && (
        <Notice>
          {lmsError(error, t)}
          {enabled === null && (
            <button onClick={() => setReload((value) => value + 1)}>
              {t("Повторить", "Қайталау")}
            </button>
          )}
        </Notice>
      )}
      {enabled === null ? (
        !error && <p role="status">{t("Загрузка…", "Жүктелуде…")}</p>
      ) : (
        <>
          <p>
            {enabled
              ? t(
                  "Слушатели могут создать личный кабинет в вашем центре. Зачисление на программу выполняется отдельно.",
                  "Тыңдаушылар орталығыңызда жеке кабинет аша алады. Бағдарламаға қабылдау бөлек орындалады.",
                )
              : t(
                  "Вход по приглашению центра. Самостоятельная регистрация закрыта.",
                  "Орталықтың шақыруы бойынша кіру. Өз бетіңізше тіркелу жабық.",
                )}
          </p>
          <button disabled={busy} onClick={() => void toggle()}>
            {busy
              ? t("Сохраняем…", "Сақталуда…")
              : enabled
                ? t(
                    "Закрыть самостоятельную регистрацию",
                    "Өз бетімен тіркелуді жабу",
                  )
                : t(
                    "Открыть самостоятельную регистрацию",
                    "Өз бетімен тіркелуді ашу",
                  )}
          </button>
        </>
      )}
    </section>
  );
}
