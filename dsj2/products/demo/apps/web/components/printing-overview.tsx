"use client";
import { useEffect, useState } from "react";
import { Notice } from "@demo/ui";
import { api, errorText } from "@/lib/api";
import "./printing-overview.css";

type Overview = {
  requests: number;
  active: number;
  archived: number;
  documents: number;
};
export function PrintingOverview() {
  const [value, setValue] = useState<Overview | null>(null);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    setError("");
    api<Overview>("/print-requests/overview")
      .then((result) => {
        if (
          ![
            result?.requests,
            result?.active,
            result?.archived,
            result?.documents,
          ].every((count) => Number.isSafeInteger(count) && count >= 0)
        )
          throw new Error("Не удалось загрузить сводку.");
        if (active) setValue(result);
      })
      .catch((caught) => {
        if (active) setError(errorText(caught));
      });
    return () => {
      active = false;
    };
  }, [attempt]);
  return (
    <details className="printing-overview">
      <summary>Сводка по центру</summary>
      <p className="muted">
        За всё время, без фильтров списка. Версии документов учитываются
        отдельно; подготовка файла ещё не означает выдачу.
      </p>
      {error ? (
        <Notice>
          {error}{" "}
          <button onClick={() => setAttempt((v) => v + 1)}>
            Повторить загрузку сводки
          </button>
        </Notice>
      ) : value ? (
        <dl>
          <div>
            <dt>Всего заявок</dt>
            <dd>{value.requests}</dd>
          </div>
          <div>
            <dt>В работе</dt>
            <dd>{value.active}</dd>
          </div>
          <div>
            <dt>Заявок в архиве</dt>
            <dd>{value.archived}</dd>
          </div>
          <div>
            <dt>Подготовленных версий документов</dt>
            <dd>{value.documents}</dd>
          </div>
        </dl>
      ) : (
        <p role="status">Загружаем сводку…</p>
      )}
    </details>
  );
}
