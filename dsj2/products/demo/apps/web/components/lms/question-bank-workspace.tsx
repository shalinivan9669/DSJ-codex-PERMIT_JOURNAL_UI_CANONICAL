"use client";
import { useEffect, useState } from "react";
import { Notice } from "@demo/ui";
import type { LmsQuestion } from "@demo/contracts/src/lms";
import { api, json } from "@/lib/api";
import type { LibraryQuestion, LibraryRevision, Paged } from "@/lib/lms-api";
import { LmsHeading, PageControls, lmsError, type Translate } from "./common";
import { newAuthorQuestion, QuestionAuthor } from "./question-author";
import "./author.css";

export function QuestionBankWorkspace({ t }: { t: Translate }) {
  const [data, setData] = useState<
      Paged<LibraryQuestion & { canEdit: boolean }>
    >({ items: [], total: 0 }),
    [search, setSearch] = useState(""),
    [category, setCategory] = useState(""),
    [topic, setTopic] = useState(""),
    [page, setPage] = useState(1),
    [refresh, setRefresh] = useState(0),
    [editor, setEditor] = useState<LmsQuestion | null>(null),
    [error, setError] = useState<unknown>(null),
    [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(true),
    [showValidation, setShowValidation] = useState(false),
    [notice, setNotice] = useState(""),
    [importText, setImportText] = useState(""),
    [preview, setPreview] = useState<{
      rows: Array<{
        row: number;
        title: string;
        error: string | null;
        duplicate: boolean;
      }>;
      valid: number;
    } | null>(null);
  useEffect(() => {
    let live = true;
    setLoading(true);
    const timer = setTimeout(() => {
      void api<typeof data>(
        `/lms/questions?${new URLSearchParams({ search, category, topic, page: String(page) })}`,
      )
        .then((value) => {
          if (live) {
            setData(value);
            setError(null);
          }
        })
        .catch((caught) => {
          if (live) setError(caught);
        })
        .finally(() => {
          if (live) setLoading(false);
        });
    }, 180);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [search, category, topic, page, refresh]);
  async function save() {
    if (!editor) return;
    setBusy(true);
    setShowValidation(true);
    try {
      await api<LibraryRevision>(
        editor.libraryQuestionId
          ? `/lms/questions/${editor.libraryQuestionId}/revisions`
          : "/lms/questions",
        {
          method: "POST",
          body: json({
            question: editor,
            ...(editor.libraryQuestionId
              ? { expectedVersion: editor.version }
              : {}),
          }),
        },
      );
      setEditor(null);
      setRefresh((value) => value + 1);
      setNotice(t("Вопрос сохранён в банке", "Сұрақ банкте сақталды"));
      setError(null);
    } catch (caught) {
      setError(caught);
    } finally {
      setBusy(false);
    }
  }
  async function importFile(commit: boolean) {
    setBusy(true);
    setError(null);
    try {
      const value = await api<typeof preview & { saved: number }>(
        "/lms/questions/import",
        { method: "POST", body: json({ text: importText, commit }) },
      );
      if (commit) {
        setPreview(null);
        setImportText("");
        setRefresh((value) => value + 1);
        setNotice(
          `${t("Сохранено вопросов", "Сақталған сұрақтар")}: ${value?.saved}. ${t("Повторные строки объединены с существующими.", "Қайталанған жолдар бар сұрақтармен біріктірілді.")}`,
        );
      } else setPreview(value);
    } catch (caught) {
      setError(caught);
    } finally {
      setBusy(false);
    }
  }
  function template() {
    const header =
      "kind\tcategory\ttopic\tquestionRu\tquestionKz\toptionsRu\toptionsKz\tcorrect\trightRu\trightKz\tcriteriaRu\tcriteriaKz\texplanationRu\texplanationKz\tsource\tcontextRu\tcontextKz";
    const blob = new Blob(
      [
        "\uFEFF" +
          header +
          "\nSINGLE\tУчебный пример\tРабочий порядок\tКогда уточняют непонятное задание?\tТүсініксіз тапсырманы қашан нақтылайды?\tДо начала работы|После выполнения\tЖұмысты бастамас бұрын|Орындағаннан кейін\t1\t\t\t\t\tНепонятные условия нужно уточнить до действия.\tТүсініксіз шарттар әрекетке дейін нақтыланады.\tОригинальный учебный пример\t\t\n",
      ],
      { type: "text/tab-separated-values;charset=utf-8" },
    );
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "question-bank-template.tsv";
    link.click();
    URL.revokeObjectURL(url);
  }
  return (
    <>
      <LmsHeading title={t("Банк вопросов", "Сұрақтар банкі")} />
      {error != null && <Notice>{lmsError(error, t)}</Notice>}
      {notice && <p role="status">{notice}</p>}
      <section className="panel lms-panel">
        <div className="lms-toolbar">
          <button
            className="primary"
            disabled={busy || !!editor}
            onClick={() => {
              setEditor(newAuthorQuestion());
              setShowValidation(false);
            }}
          >
            {t("Создать вопрос", "Сұрақ жасау")}
          </button>
        </div>
        {editor && (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void save();
            }}
          >
            <QuestionAuthor
              question={editor}
              onChange={setEditor}
              t={t}
              showValidation={showValidation}
            />
            <div className="lms-actions">
              <button className="primary" disabled={busy}>
                {t("Сохранить редакцию", "Редакцияны сақтау")}
              </button>
              <button type="button" onClick={() => setEditor(null)}>
                {t("Отменить изменения", "Өзгерістерден бас тарту")}
              </button>
            </div>
          </form>
        )}
        <details>
          <summary>{t("Импорт вопросов", "Сұрақтарды импорттау")}</summary>
          <button type="button" onClick={template}>
            {t("Скачать шаблон таблицы", "Кесте үлгісін жүктеу")}
          </button>
          <p>
            {t(
              "Файл TSV из Excel: варианты разделяются |, правильные номера — запятыми. Для соответствий используйте 1:2,2:1; для порядка — 2,1. TEXT без ключа и CASE требуют критерии преподавателя.",
              "Excel-ден TSV файлы: нұсқалар | арқылы, дұрыс нөмірлер үтірмен бөлінеді. Сәйкестіктер: 1:2,2:1; реттілік: 2,1. Кілтсіз TEXT және CASE үшін оқытушы критерийлері қажет.",
            )}
          </p>
          <label>
            {t("Таблица вопросов", "Сұрақтар кестесі")}
            <input
              type="file"
              accept=".tsv,.txt"
              disabled={busy}
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) {
                  if (file.size > 2_000_000) {
                    setError(
                      new Error(
                        t(
                          "Размер файла не должен превышать 2 МБ",
                          "Файл өлшемі 2 МБ-тан аспауы тиіс",
                        ),
                      ),
                    );
                    return;
                  }
                  void file
                    .text()
                    .then((value) => {
                      setImportText(value);
                      setPreview(null);
                    })
                    .catch(setError);
                }
              }}
            />
          </label>
          <button
            type="button"
            disabled={busy || !importText}
            onClick={() => void importFile(false)}
          >
            {t("Проверить таблицу", "Кестені тексеру")}
          </button>
          {preview && (
            <>
              <ul className="lms-list">
                {preview.rows.map((row) => (
                  <li key={row.row}>
                    {row.row}. {row.title} ·{" "}
                    {row.error ||
                      (row.duplicate
                        ? t("Повтор в файле", "Файлдағы қайталау")
                        : t("Готов к сохранению", "Сақтауға дайын"))}
                  </li>
                ))}
              </ul>
              <button
                className="primary"
                disabled={
                  busy ||
                  !preview.valid ||
                  preview.rows.some((row) => row.error)
                }
                onClick={() => void importFile(true)}
              >
                {t("Сохранить вопросы", "Сұрақтарды сақтау")} ({preview.valid})
              </button>
            </>
          )}
        </details>
        <div className="lms-fields">
          {(
            [
              [search, setSearch, "Поиск", "Іздеу"],
              [category, setCategory, "Категория", "Санат"],
              [topic, setTopic, "Тема", "Тақырып"],
            ] as const
          ).map(([value, setValue, ru, kz]) => (
            <label key={ru}>
              {t(ru, kz)}
              <input
                value={value}
                onChange={(event) => {
                  setValue(event.target.value);
                  setPage(1);
                }}
              />
            </label>
          ))}
        </div>
        {loading && <p role="status">{t("Загрузка…", "Жүктелуде…")}</p>}
        {!loading && !error && !data.items.length && (
          <p>
            {t(
              "Вопросов по этим условиям нет. Создайте вопрос или измените фильтр.",
              "Осы шарттар бойынша сұрақтар жоқ. Сұрақ жасаңыз немесе сүзгіні өзгертіңіз.",
            )}
          </p>
        )}
        <ul className="lms-list">
          {data.items.map((row) => (
            <li key={row.id}>
              <div>
                <strong>
                  {t(
                    row.latestRevision.question.promptRu,
                    row.latestRevision.question.promptKz,
                  )}
                </strong>
                <p>
                  {row.category} · {row.topic} · {t("Редакция", "Редакция")}{" "}
                  {row.latestRevision.version}
                </p>
              </div>
              {row.canEdit && (
                <button
                  onClick={() => {
                    setEditor(row.latestRevision.question);
                    setShowValidation(false);
                  }}
                >
                  {t("Новая редакция", "Жаңа редакция")}
                </button>
              )}
            </li>
          ))}
        </ul>
        <PageControls
          page={page}
          total={data.total}
          pageSize={data.pageSize || 30}
          onPage={setPage}
          t={t}
        />
      </section>
    </>
  );
}
