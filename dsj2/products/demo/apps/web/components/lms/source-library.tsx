"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import type { RegulatoryProfile } from "@demo/contracts/src/lms";
import { Notice } from "@demo/ui";
import { api, json } from "@/lib/api";
import { PageControls, lmsError, type Translate } from "./common";

type Source = RegulatoryProfile["sources"][number];
type Revision = {
  id: string;
  version: number;
  definition: Source;
  checkedAt: string | null;
  reviewNote: string | null;
  createdAt: string;
};
type Entry = {
  id: string;
  title: string;
  canEdit: boolean;
  canConfirm: boolean;
  revisions: Revision[];
};
type Task = {
  id: string;
  courseId: string;
  title: string;
  sourceTitle: string;
  revision: number;
  status: string;
  note: string;
  dueAt: string | null;
  assigneeName: string | null;
  assigneeId: string | null;
  canEdit: boolean;
  assignees: Array<{ id: string; displayName: string }>;
};
const states = [
  ["OPEN", "Новая", "Жаңа"],
  ["IN_REVIEW", "В работе", "Орындалуда"],
  ["RESOLVED", "Редакция включена", "Редакция енгізілді"],
  ["DISMISSED", "Изменение не требуется", "Өзгерту қажет емес"],
] as const;

export function SourcePicker({
  t,
  onSelect,
}: {
  t: Translate;
  onSelect: (source: Source) => void;
}) {
  const [search, setSearch] = useState(""),
    [items, setItems] = useState<Entry[]>([]),
    [error, setError] = useState<unknown>(null);
  useEffect(() => {
    let live = true;
    const timer = setTimeout(() => {
      void api<{ items: Entry[] }>(
        `/lms/regulatory-sources?${new URLSearchParams({ search, pageSize: "100" })}`,
      )
        .then((result) => {
          if (live) {
            setItems(result.items);
            setError(null);
          }
        })
        .catch((caught) => {
          if (live) setError(caught);
        });
    }, 180);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [search]);
  return (
    <details className="lms-advanced">
      <summary>
        {t("Выбрать источник из библиотеки", "Кітапханадан дереккөзді таңдау")}
      </summary>
      <label>
        {t("Поиск по названию", "Атауы бойынша іздеу")}
        <input
          type="search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
      </label>
      {error != null && <Notice>{lmsError(error, t)}</Notice>}
      <ul className="lms-list">
        {items.map((item) => (
          <li key={item.id}>
            <strong>{item.title}</strong>
            <select
              aria-label={`${t("Редакция", "Редакция")}: ${item.title}`}
              defaultValue=""
              onChange={(event) => {
                const revision = item.revisions.find(
                  (value) => value.id === event.target.value,
                );
                if (revision)
                  onSelect({
                    ...revision.definition,
                    sourceId: item.id,
                    sourceRevisionId: revision.id,
                  });
                event.target.value = "";
              }}
            >
              <option value="">
                {t("Выбрать редакцию…", "Редакцияны таңдау…")}
              </option>
              {item.revisions.map((revision) => (
                <option key={revision.id} value={revision.id}>
                  {revision.version}. {revision.definition.revision} ·{" "}
                  {revision.checkedAt
                    ? t("Проверка записана", "Тексеру тіркелген")
                    : t("Ожидает проверки", "Тексеруді күтуде")}
                  {" · "}
                  {revision.definition.status === "CURRENT"
                    ? t("Актуальна", "Өзекті")
                    : t(
                        "Актуальность не подтверждена",
                        "Өзектілігі расталмаған",
                      )}
                </option>
              ))}
            </select>
          </li>
        ))}
      </ul>
      {!items.length && !error && (
        <p>
          {t(
            "Источник не найден. Создайте его в нормативной базе или уточните поиск.",
            "Дереккөз табылмады. Оны нормативтік базада жасаңыз немесе іздеуді нақтылаңыз.",
          )}
        </p>
      )}
      <Link href="/lms/regulatory">
        {t("Открыть нормативную базу", "Нормативтік базаны ашу")}
      </Link>
    </details>
  );
}

export function SourceLibrary({ t }: { t: Translate }) {
  const [data, setData] = useState<{ items: Entry[]; total: number }>({
      items: [],
      total: 0,
    }),
    [search, setSearch] = useState(""),
    [page, setPage] = useState(1),
    [refresh, setRefresh] = useState(0),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<unknown>(null),
    [notice, setNotice] = useState("");
  const [editor, setEditor] = useState<{
    entry?: Entry;
    definition: Source;
    confirmed: boolean;
    reviewNote: string;
  } | null>(null);
  useEffect(() => {
    let live = true;
    const timer = setTimeout(() => {
      void api<typeof data>(
        `/lms/regulatory-sources?${new URLSearchParams({ search, page: String(page), pageSize: "25" })}`,
      )
        .then((value) => {
          if (live) {
            setData(value);
            setError(null);
          }
        })
        .catch((caught) => {
          if (live) setError(caught);
        });
    }, 180);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [search, page, refresh]);
  async function save() {
    if (!editor) return;
    setBusy(true);
    try {
      await api(
        editor.entry
          ? `/lms/regulatory-sources/${editor.entry.id}/revisions`
          : "/lms/regulatory-sources",
        {
          method: "POST",
          body: json({
            definition: editor.definition,
            expectedVersion: editor.entry?.revisions[0]?.version || 0,
            confirmed: editor.confirmed,
            reviewNote: editor.reviewNote,
          }),
        },
      );
      setEditor(null);
      setRefresh((value) => value + 1);
      setNotice(
        t(
          "Редакция сохранена. Для связанных программ созданы задачи проверки.",
          "Редакция сақталды. Байланысты бағдарламаларға тексеру тапсырмалары жасалды.",
        ),
      );
      setError(null);
    } catch (caught) {
      setError(caught);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="panel lms-panel">
      <h2>
        {t(
          "Библиотека источников и редакций",
          "Дереккөздер мен редакциялар кітапханасы",
        )}
      </h2>
      <p className="muted">
        {t(
          "Редакции сохраняются в истории. Изменение источника создаёт задачи по связанным программам; опубликованные версии сохраняют прежнее основание.",
          "Редакциялар тарихта сақталады. Дереккөз өзгерсе, байланысты бағдарламаларға тапсырмалар жасалады; жарияланған нұсқалар бұрынғы негізді сақтайды.",
        )}
      </p>
      {error != null && <Notice>{lmsError(error, t)}</Notice>}
      {notice && <p role="status">{notice}</p>}
      <div className="lms-toolbar">
        <button
          onClick={() =>
            setEditor({
              definition: {
                title: "",
                url: "",
                revision: "",
                status: "REVIEW_REQUIRED",
              },
              confirmed: false,
              reviewNote: "",
            })
          }
        >
          {t("Создать источник", "Дереккөз жасау")}
        </button>
        <label>
          {t("Поиск источника", "Дереккөзді іздеу")}
          <input
            type="search"
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              setPage(1);
            }}
          />
        </label>
      </div>
      {editor && (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <fieldset disabled={busy}>
            <legend>
              {editor.entry
                ? t("Новая редакция", "Жаңа редакция")
                : t("Новый источник", "Жаңа дереккөз")}
            </legend>
            <div className="lms-fields">
              {(
                [
                  ["title", "Название", "Атауы"],
                  ["url", "Официальная HTTPS-ссылка", "Ресми HTTPS-сілтеме"],
                  ["revision", "Название редакции", "Редакция атауы"],
                  ["number", "Номер НПА", "НҚА нөмірі"],
                  ["authority", "Орган", "Орган"],
                  ["article", "Статья", "Бап"],
                  ["paragraph", "Пункт", "Тармақ"],
                  ["subparagraph", "Подпункт", "Тармақша"],
                ] as const
              ).map(([key, ru, kz]) => (
                <label key={key}>
                  {t(ru, kz)}
                  <input
                    required={
                      key === "title" || key === "url" || key === "revision"
                    }
                    type={key === "url" ? "url" : "text"}
                    value={editor.definition[key] || ""}
                    disabled={!!editor.entry && !editor.entry.canEdit}
                    onChange={(event) =>
                      setEditor({
                        ...editor,
                        definition: {
                          ...editor.definition,
                          [key]: event.target.value,
                        },
                      })
                    }
                  />
                </label>
              ))}
              {(
                [
                  ["date", "Дата НПА", "НҚА күні"],
                  ["effectiveOn", "Дата актуальности", "Өзектілік күні"],
                ] as const
              ).map(([key, ru, kz]) => (
                <label key={key}>
                  {t(ru, kz)}
                  <input
                    type="date"
                    value={editor.definition[key] || ""}
                    disabled={!!editor.entry && !editor.entry.canEdit}
                    onChange={(event) =>
                      setEditor({
                        ...editor,
                        definition: {
                          ...editor.definition,
                          [key]: event.target.value || null,
                        },
                      })
                    }
                  />
                </label>
              ))}
              <label>
                {t("Состояние", "Күйі")}
                <select
                  value={editor.definition.status || "REVIEW_REQUIRED"}
                  disabled={!!editor.entry && !editor.entry.canEdit}
                  onChange={(event) =>
                    setEditor({
                      ...editor,
                      definition: {
                        ...editor.definition,
                        status: event.target.value as Source["status"],
                      },
                    })
                  }
                >
                  {[
                    ["CURRENT", "Действует", "Қолданыста"],
                    [
                      "CHANGES_EXPECTED",
                      "Ожидаются изменения",
                      "Өзгерістер күтілуде",
                    ],
                    ["CHANGED", "Изменён", "Өзгертілді"],
                    ["REPEALED", "Утратил силу", "Күшін жойған"],
                    [
                      "REVIEW_REQUIRED",
                      "Требует проверки",
                      "Тексеруді қажет етеді",
                    ],
                  ].map(([value, ru, kz]) => (
                    <option key={value} value={value}>
                      {t(ru, kz)}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <label>
              {t(
                "Основание проверки / описание изменения",
                "Тексеру негізі / өзгеріс сипаттамасы",
              )}
              <textarea
                required={editor.confirmed}
                value={editor.reviewNote}
                onChange={(event) =>
                  setEditor({ ...editor, reviewNote: event.target.value })
                }
              />
            </label>
            {editor.entry?.canConfirm && (
              <label className="lms-inline-label">
                <input
                  type="checkbox"
                  checked={editor.confirmed}
                  onChange={(event) =>
                    setEditor({ ...editor, confirmed: event.target.checked })
                  }
                />
                {t(
                  "Подтверждаю проверку редакции по указанному источнику",
                  "Көрсетілген дереккөз бойынша редакцияның тексерілгенін растаймын",
                )}
              </label>
            )}
            <div className="lms-actions">
              <button className="primary">
                {t("Сохранить редакцию", "Редакцияны сақтау")}
              </button>
              <button type="button" onClick={() => setEditor(null)}>
                {t("Отмена", "Бас тарту")}
              </button>
            </div>
          </fieldset>
        </form>
      )}
      <ul className="lms-list">
        {data.items.map((item) => (
          <li key={item.id} style={{ display: "block" }}>
            <div className="lms-actions">
              <strong>{item.title}</strong>
              {(item.canEdit || item.canConfirm) && (
                <button
                  onClick={() =>
                    setEditor({
                      entry: item,
                      definition: item.revisions[0].definition,
                      confirmed: !item.canEdit && item.canConfirm,
                      reviewNote: "",
                    })
                  }
                >
                  {item.canEdit
                    ? t("Новая редакция", "Жаңа редакция")
                    : t("Проверить редакцию", "Редакцияны тексеру")}
                </button>
              )}
            </div>
            <details>
              <summary>
                {t("История редакций", "Редакциялар тарихы")} (
                {item.revisions.length})
              </summary>
              <ul>
                {item.revisions.map((revision) => (
                  <li key={revision.id}>
                    {revision.version}. {revision.definition.revision} ·{" "}
                    {revision.checkedAt
                      ? t("Проверка записана", "Тексеру тіркелген")
                      : t("Не подтверждена", "Расталмаған")}{" "}
                    ·{" "}
                    {revision.definition.status === "CURRENT"
                      ? t("Актуальна", "Өзекті")
                      : revision.definition.status === "REPEALED"
                        ? t("Утратила силу", "Күші жойылған")
                        : t("Требует проверки", "Тексеруді қажет етеді")}{" "}
                    · {revision.definition.effectiveOn || "—"}
                    <p>{revision.reviewNote}</p>
                    {revision.definition.url.startsWith("https://") && (
                      <a
                        href={revision.definition.url}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {t("Официальный источник", "Ресми дереккөз")}
                      </a>
                    )}
                  </li>
                ))}
              </ul>
            </details>
          </li>
        ))}
      </ul>
      <PageControls
        page={page}
        total={data.total}
        pageSize={25}
        onPage={setPage}
        t={t}
      />
      <SourceTasks key={refresh} t={t} />
    </section>
  );
}

function SourceTasks({ t }: { t: Translate }) {
  const [items, setItems] = useState<Task[]>([]),
    [page, setPage] = useState(1),
    [total, setTotal] = useState(0),
    [error, setError] = useState<unknown>(null),
    [refresh, setRefresh] = useState(0),
    [selected, setSelected] = useState<Task | null>(null),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    let live = true;
    void api<{ items: Task[]; total: number }>(
      `/lms/regulatory-tasks?page=${page}`,
    )
      .then((value) => {
        if (live) {
          setItems(value.items);
          setTotal(value.total);
        }
      })
      .catch((caught) => {
        if (live) setError(caught);
      });
    return () => {
      live = false;
    };
  }, [refresh, page]);
  async function save() {
    if (!selected) return;
    setBusy(true);
    try {
      await api(`/lms/regulatory-tasks/${selected.id}`, {
        method: "POST",
        body: json({
          revision: selected.revision,
          status: selected.status,
          note: selected.note,
          assigneeId: selected.assigneeId,
          dueAt: selected.dueAt ? new Date(selected.dueAt).toISOString() : null,
        }),
      });
      setSelected(null);
      setError(null);
      setRefresh((value) => value + 1);
    } catch (caught) {
      setError(caught);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <h3>
        {t(
          "Обновление связанных программ",
          "Байланысты бағдарламаларды жаңарту",
        )}
      </h3>
      {error != null && <Notice>{lmsError(error, t)}</Notice>}
      <ul className="lms-list">
        {items.map((task) => (
          <li key={task.id} style={{ display: "block" }}>
            <strong>{task.title}</strong> · {task.sourceTitle}
            <p>
              {t(
                ...((states
                  .find(([value]) => value === task.status)
                  ?.slice(1) || [task.status, task.status]) as [
                  string,
                  string,
                ]),
              )}{" "}
              ·{" "}
              {task.assigneeName ||
                t("Ответственный не назначен", "Жауапты тағайындалмаған")}{" "}
              · {task.dueAt?.slice(0, 10) || t("Без срока", "Мерзімсіз")}
            </p>
            <div className="lms-actions">
              <Link href={`/lms/courses/${task.courseId}?section=overview`}>
                {t("Открыть программу", "Бағдарламаны ашу")}
              </Link>
              {task.canEdit && (
                <button onClick={() => setSelected(task)}>
                  {t("Решение по задаче", "Тапсырма бойынша шешім")}
                </button>
              )}
            </div>
            <p>{task.note}</p>
          </li>
        ))}
      </ul>
      <PageControls
        page={page}
        total={total}
        pageSize={25}
        onPage={setPage}
        t={t}
      />
      {!items.length && (
        <p>
          {t("Задач проверки пока нет.", "Тексеру тапсырмалары әзірге жоқ.")}
        </p>
      )}
      {selected && (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <fieldset disabled={busy}>
            <legend>{selected.title}</legend>
            <label>
              {t("Ответственный за программу", "Бағдарламаға жауапты адам")}
              <select
                value={selected.assigneeId || ""}
                onChange={(event) =>
                  setSelected({
                    ...selected,
                    assigneeId: event.target.value || null,
                  })
                }
              >
                <option value="">{t("Не назначен", "Тағайындалмаған")}</option>
                {selected.assignees.map((person) => (
                  <option key={person.id} value={person.id}>
                    {person.displayName}
                  </option>
                ))}
              </select>
            </label>
            <label>
              {t("Решение", "Шешім")}
              <select
                value={selected.status}
                onChange={(event) =>
                  setSelected({ ...selected, status: event.target.value })
                }
              >
                {states.map(([value, ru, kz]) => (
                  <option key={value} value={value}>
                    {t(ru, kz)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              {t("Срок проверки", "Тексеру мерзімі")}
              <input
                type="date"
                value={selected.dueAt?.slice(0, 10) || ""}
                onChange={(event) =>
                  setSelected({
                    ...selected,
                    dueAt: event.target.value || null,
                  })
                }
              />
            </label>
            <label>
              {t("Обоснование решения", "Шешім негіздемесі")}
              <textarea
                required
                value={selected.note}
                onChange={(event) =>
                  setSelected({ ...selected, note: event.target.value })
                }
              />
            </label>
            <div className="lms-actions">
              <button className="primary">
                {t("Сохранить решение", "Шешімді сақтау")}
              </button>
              <button type="button" onClick={() => setSelected(null)}>
                {t("Отмена", "Бас тарту")}
              </button>
            </div>
          </fieldset>
        </form>
      )}
    </>
  );
}
