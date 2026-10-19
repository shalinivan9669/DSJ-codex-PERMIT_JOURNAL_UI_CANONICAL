"use client";
import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import { ApiError, errorText } from "@/lib/api";
import type { Translate } from "./lms/common";
import { cabinetKz } from "./cabinet-translations";
import { cabinetErrorKz } from "./cabinet-error-labels";

const LanguageContext = createContext<Translate>((ru) => ru);

/** Shares the account's language with reused forms and their portal dialogs. */
export function CabinetLanguageProvider({ t, children }: { t: Translate; children: ReactNode }) {
  return <LanguageContext.Provider value={t}>{children}</LanguageContext.Provider>;
}

export type CabinetText = (value: string) => string;
export function useCabinetLanguage(): Translate { return useContext(LanguageContext); }
export function useCabinetText(): CabinetText {
  const t = useContext(LanguageContext);
  return useMemo(() => (value: string) => {
    const key = value.replace(/\s+/g, " ").trim();
    const translated = cabinetKz[key];
    return translated ? value.replace(/\S[\s\S]*\S|\S/, t(key, translated)) : value;
  }, [t]);
}

/** Keep the original error so changing the account language also changes an open notice. */
export function useCabinetError() {
  const tr = useCabinetText();
  const [error, setError] = useState<unknown>(null);
  return [error ? cabinetError(error, tr) : "", setError] as const;
}

/** Errors from legacy endpoints are localized without displaying raw diagnostics. */
export function cabinetError(error: unknown, tr: CabinetText): string {
  const raw = typeof error === "string" ? error : error instanceof Error ? error.message : errorText(error);
  if (tr("Настройки") === "Настройки") return raw;
  const known = cabinetKz[raw.replace(/\s+/g, " ").trim()];
  if (known) return known;
  if (error instanceof ApiError) {
    const code = error.details && typeof error.details === "object" && "code" in error.details ? String(error.details.code || "") : "";
    if (cabinetErrorKz[code]) return cabinetErrorKz[code];
    const messages: Record<number, string> = {
      0: "Нет связи с сервером. Сохранённые на странице данные не потеряны. Повторите действие после восстановления связи.",
      400: "Проверьте заполненные поля и повторите действие.",
      401: "Сессия завершена. Войдите снова.",
      403: "Недостаточно прав для этого действия. Обратитесь к администратору центра.",
      404: "Запись недоступна. Обновите список.",
      409: "Данные изменились. Обновите запись и повторите действие.",
      413: "Превышен допустимый размер загрузки.",
      422: "Проверьте заполненные поля и повторите действие.",
      429: "Слишком много запросов. Подождите и повторите действие.",
    };
    const message = tr(messages[error.status] || "Не удалось выполнить действие. Повторите попытку.");
    return error.correlationId ? `${message} ${tr("Код обращения")}: ${error.correlationId}` : message;
  }
  return tr("Не удалось выполнить действие. Проверьте заполненные поля и повторите попытку.");
}
