"use client";
import { useEffect, useState } from "react";
import type { LmsQuestion } from "@demo/contracts/src/lms";
import { api, json } from "@/lib/api";
import type { LibraryQuestion, LibraryRevision, Paged } from "@/lib/lms-api";
import { lmsError, PageControls, type Translate } from "./common";

export function QuestionLibrary({
  t,
  onChoose,
}: {
  t: Translate;
  onChoose: (q: LmsQuestion) => void;
}) {
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("");
  const [topic, setTopic] = useState("");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<Paged<LibraryQuestion>>({
    items: [],
    total: 0,
  });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [revisions, setRevisions] = useState<Record<string, LibraryRevision[]>>(
    {},
  );
  const [chosen, setChosen] = useState<Record<string, string>>({});
  useEffect(() => {
    let active = true;
    const timer = setTimeout(() => {
      setBusy(true);
      const query = new URLSearchParams({
        search,
        category,
        topic,
        page: String(page),
      });
      void api<Paged<LibraryQuestion>>(`/lms/questions?${query}`)
        .then((result) => {
          if (active) {
            setData(result);
            setError("");
          }
        })
        .catch((caught) => {
          if (active) setError(lmsError(caught, t));
        })
        .finally(() => {
          if (active) setBusy(false);
        });
    }, 200);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [search, category, topic, page]);
  return (
    <details
      onToggle={(event) => {
        if (event.currentTarget.open) setPage(1);
      }}
    >
      <summary>
        {t("Выбрать из банка вопросов", "Сұрақтар банкінен таңдау")}
      </summary>
      <div className="lms-fields">
        <label>
          {t("Поиск вопроса", "Сұрақты іздеу")}
          <input
            type="search"
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              setPage(1);
            }}
          />
        </label>
        <label>
          {t("Категория", "Санат")}
          <input
            value={category}
            onChange={(event) => {
              setCategory(event.target.value);
              setPage(1);
            }}
          />
        </label>
        <label>
          {t("Тема", "Тақырып")}
          <input
            value={topic}
            onChange={(event) => {
              setTopic(event.target.value);
              setPage(1);
            }}
          />
        </label>
      </div>
      {error && <p role="alert">{error}</p>}
      <ul className="lms-list" aria-busy={busy}>
        {data.items.map((item) => {
          const available = revisions[item.id] || [item.latestRevision];
          const selected =
            available.find((revision) => revision.id === chosen[item.id]) ||
            item.latestRevision;
          return (
            <li key={item.id}>
              <div>
                <strong>
                  {t(selected.question.promptRu, selected.question.promptKz)}
                </strong>
                <p>
                  {item.category}
                  {item.topic ? ` · ${item.topic}` : ""}
                </p>
                <label>
                  {t("Редакция", "Редакция")}
                  <select
                    value={selected.id}
                    onFocus={() => {
                      if (revisions[item.id]) return;
                      void api<{ revisions: LibraryRevision[] }>(
                        `/lms/questions/${item.id}/revisions`,
                      )
                        .then((result) =>
                          setRevisions((value) => ({
                            ...value,
                            [item.id]: result.revisions,
                          })),
                        )
                        .catch((caught) => setError(lmsError(caught, t)));
                    }}
                    onChange={(event) =>
                      setChosen((value) => ({
                        ...value,
                        [item.id]: event.target.value,
                      }))
                    }
                  >
                    {available.map((revision) => (
                      <option key={revision.id} value={revision.id}>
                        {revision.version}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <button type="button" onClick={() => onChoose(selected.question)}>
                {t("Использовать", "Қолдану")}
              </button>
            </li>
          );
        })}
      </ul>
      {!busy && !data.items.length && (
        <p>{t("Вопросы не найдены", "Сұрақтар табылмады")}</p>
      )}
      <PageControls
        page={page}
        total={data.total}
        pageSize={data.pageSize || 30}
        onPage={setPage}
        t={t}
      />
    </details>
  );
}

export function SaveLibraryQuestion({
  question,
  courseId,
  flush,
  saved,
  onBusy,
  t,
}: {
  question: LmsQuestion;
  courseId: string;
  flush: () => Promise<unknown>;
  saved: (q: LmsQuestion) => void;
  onBusy: (busy: boolean) => void;
  t: Translate;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function save() {
    setBusy(true);
    onBusy(true);
    setError("");
    try {
      await flush();
      const value = await api<LibraryRevision>(
        question.libraryQuestionId
          ? `/lms/questions/${question.libraryQuestionId}/revisions`
          : "/lms/questions",
        {
          method: "POST",
          body: json({
            question,
            ...(question.libraryQuestionId
              ? { expectedVersion: question.version }
              : { originCourseId: courseId, originQuestionId: question.id }),
          }),
        },
      );
      saved(value.question);
    } catch (caught) {
      setError(lmsError(caught, t));
    } finally {
      setBusy(false);
      onBusy(false);
    }
  }
  return (
    <div>
      <button type="button" disabled={busy} onClick={() => void save()}>
        {busy
          ? t("Сохраняем…", "Сақталуда…")
          : question.libraryQuestionId
            ? t("Сохранить редакцию в банке", "Редакцияны банкте сақтау")
            : t("Добавить в банк вопросов", "Сұрақтар банкіне қосу")}
      </button>
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
