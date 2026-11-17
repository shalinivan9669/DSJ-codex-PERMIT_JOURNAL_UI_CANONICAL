"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import type { Page } from "@/lib/types";
import type { StoredRecipient } from "@/lib/stored-recipient";
import { useCabinetLanguage } from "./cabinet-language";

export function RecipientNameMatches({
  query,
  onChoose,
}: {
  query: string;
  onChoose: (record: StoredRecipient) => void;
}) {
  const t = useCabinetLanguage();
  const [result, setResult] = useState<{
    query: string;
    records: StoredRecipient[];
  }>();
  const [failed, setFailed] = useState("");
  useEffect(() => {
    if (query.length < 2 || query.length > 255) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      const params = new URLSearchParams({ search: query, pageSize: "5" });
      void api<Page<StoredRecipient>>(`/recipients?${params}`, {
        signal: controller.signal,
      })
        .then((page) => {
          if (!controller.signal.aborted) {
            setResult({
              query,
              records: page.items.filter(
                (record) =>
                  !record.archived &&
                  (record.data.fullNameRu || record.data.fullNameKz),
              ),
            });
            setFailed("");
          }
        })
        .catch(() => {
          if (!controller.signal.aborted) setFailed(query);
        });
    }, 250);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query]);
  if (!query) return null;
  if (failed === query)
    return (
      <small role="status">
        {t(
          "Справочник недоступен. Данные можно ввести вручную.",
          "Анықтамалық қолжетімсіз. Деректерді қолмен енгізуге болады.",
        )}
      </small>
    );
  if (result?.query !== query || !result.records.length) return null;
  return (
    <div
      role="group"
      className="person-directory-matches"
      aria-label={t("Слушатели из справочника", "Анықтамалықтағы тыңдаушылар")}
    >
      <small>
        {t("Заполнить из карточки слушателя", "Тыңдаушы карточкасынан толтыру")}
      </small>
      {result.records.map((record) => {
        const person = record.data;
        const details = [
          person.positionRu || person.positionKz,
          person.workplaceRu || person.workplaceKz,
          person.personnelNumber || person.externalId,
        ].filter(Boolean);
        return (
          <button
            key={record.id}
            type="button"
            className="text-button"
            onClick={() => onChoose(record)}
          >
            {[person.fullNameRu || person.fullNameKz, ...details].join(" · ")}
          </button>
        );
      })}
    </div>
  );
}
