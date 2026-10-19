"use client";
import { useEffect, useState } from "react";
import { Notice } from "@demo/ui";
import { api, json } from "@/lib/api";
import { lmsError, PageControls, type Translate } from "./common";
type Decision = {
  id: string;
  revision: number;
  decision: string;
  feedback: string;
  createdAt: string;
};
type Roster = {
  items: Array<{
    enrollmentId: string;
    nameRu: string;
    nameKz: string;
    decisions: Decision[];
  }>;
  criteria: Array<{ id: string; titleRu: string; titleKz: string }>;
  canReview: boolean;
  eventRevision: number;
  total: number;
  pageSize: number;
};
export function PracticeEditor({ id, t }: { id: string; t: Translate }) {
  const [data, setData] = useState<Roster | null>(null),
    [page, setPage] = useState(1),
    [selected, setSelected] = useState(""),
    [checks, setChecks] = useState<Record<string, boolean>>({}),
    [feedback, setFeedback] = useState(""),
    [error, setError] = useState<unknown>(null),
    [busy, setBusy] = useState(false),
    [command, setCommand] = useState(() => crypto.randomUUID());
  async function load() {
    try {
      setData(
        await api<Roster>(`/lms/teaching-events/${id}/practice?page=${page}`),
      );
      setError(null);
    } catch (caught) {
      setError(caught);
    }
  }
  useEffect(() => {
    void load();
  }, [id, page]);
  async function save(decision: "ACCEPTED" | "RETURNED") {
    if (!data) return;
    setBusy(true);
    setError(null);
    try {
      const row = data.items.find((item) => item.enrollmentId === selected)!;
      await api(`/lms/teaching-events/${id}/practice`, {
        method: "POST",
        body: json({
          commandId: command,
          expectedEventRevision: data.eventRevision,
          enrollmentId: selected,
          expectedRevision: row.decisions[0]?.revision || 0,
          decision,
          checks,
          feedback,
        }),
      });
      setSelected("");
      setFeedback("");
      setChecks({});
      setCommand(crypto.randomUUID());
      await load();
    } catch (caught) {
      setError(caught);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="lms-panel">
      <h4>{t("Оценка очной практики", "Күндізгі практиканы бағалау")}</h4>
      {error != null && (
        <Notice>
          {lmsError(error, t)}{" "}
          <button onClick={() => void load()}>
            {t("Обновить список", "Тізімді жаңарту")}
          </button>
        </Notice>
      )}
      {data && (
        <>
          <ul className="lms-list">
            {data.items.map((row) => (
              <li key={row.enrollmentId}>
                <div>
                  <strong>{t(row.nameRu, row.nameKz)}</strong>
                  <p>
                    {row.decisions[0]
                      ? row.decisions[0].decision === "ACCEPTED"
                        ? t("Зачтено", "Қабылданды")
                        : t("Нужна повторная практика", "Қайта практика қажет")
                      : t("Не оценено", "Бағаланбады")}
                  </p>
                  {!!row.decisions.length && (
                    <details>
                      <summary>
                        {t("История решений", "Шешімдер тарихы")}
                      </summary>
                      {row.decisions.map((item) => (
                        <p key={item.id}>
                          {new Date(item.createdAt).toLocaleString(
                            t("ru-RU", "kk-KZ"),
                          )}{" "}
                          ·{" "}
                          {item.decision === "ACCEPTED"
                            ? t("Зачтено", "Қабылданды")
                            : t("Возвращено", "Қайтарылды")}{" "}
                          · {item.feedback}
                        </p>
                      ))}
                    </details>
                  )}
                </div>
                {data.canReview && (
                  <button
                    onClick={() => {
                      setSelected(row.enrollmentId);
                      setChecks({});
                      setFeedback("");
                      setCommand(crypto.randomUUID());
                    }}
                  >
                    {row.decisions.length
                      ? t("Повторная оценка", "Қайта бағалау")
                      : t("Оценить", "Бағалау")}
                  </button>
                )}
              </li>
            ))}
          </ul>
          <PageControls
            page={page}
            total={data.total}
            pageSize={data.pageSize}
            onPage={setPage}
            t={t}
          />
          {selected && (
            <form
              onSubmit={(event) => {
                event.preventDefault();
                void save("ACCEPTED");
              }}
              onChange={() => setCommand(crypto.randomUUID())}
            >
              <h4>
                {t(
                  data.items.find((row) => row.enrollmentId === selected)
                    ?.nameRu || "",
                  data.items.find((row) => row.enrollmentId === selected)
                    ?.nameKz || "",
                )}
              </h4>
              {data.criteria.map((criterion) => (
                <label key={criterion.id}>
                  {t(criterion.titleRu, criterion.titleKz)}
                  <select
                    required
                    value={
                      Object.hasOwn(checks, criterion.id)
                        ? checks[criterion.id]
                          ? "YES"
                          : "NO"
                        : ""
                    }
                    onChange={(event) =>
                      setChecks((value) => ({
                        ...value,
                        [criterion.id]: event.target.value === "YES",
                      }))
                    }
                  >
                    <option value="">
                      {t("Оцените навык", "Дағдыны бағалаңыз")}
                    </option>
                    <option value="YES">{t("Выполнено", "Орындалды")}</option>
                    <option value="NO">
                      {t("Нужна доработка", "Толықтыру қажет")}
                    </option>
                  </select>
                </label>
              ))}
              <label>
                {t(
                  "Результат наблюдения и замечания",
                  "Бақылау нәтижесі және ескертулер",
                )}
                <textarea
                  required
                  maxLength={4000}
                  value={feedback}
                  onChange={(event) => setFeedback(event.target.value)}
                />
              </label>
              <div className="lms-actions">
                <button
                  className="primary"
                  disabled={
                    busy ||
                    !feedback.trim() ||
                    data.criteria.some((row) => !checks[row.id])
                  }
                >
                  {t("Зачесть практику", "Практиканы қабылдау")}
                </button>
                <button
                  type="button"
                  disabled={
                    busy ||
                    !feedback.trim() ||
                    data.criteria.some((row) => !Object.hasOwn(checks, row.id))
                  }
                  onClick={() => void save("RETURNED")}
                >
                  {t("Вернуть на доработку", "Толықтыруға қайтару")}
                </button>
              </div>
            </form>
          )}
        </>
      )}
    </section>
  );
}
