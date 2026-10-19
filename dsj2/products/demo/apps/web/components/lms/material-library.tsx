"use client";
import { useEffect, useState } from "react";
import { Notice } from "@demo/ui";
import { api, json } from "@/lib/api";
import { LmsErrorDiagnostic, lmsError, type Translate } from "./common";

export type AuthorMaterial = {
  id: string;
  originalName: string;
  title: string;
  mimeType: string;
  size: number;
  state: "VISIBLE" | "HIDDEN" | "DELETED";
  revision: number;
  familyId: string;
  supersedesMaterialId?: string | null;
  allowedActions: string[];
};
type Page = {
  items: AuthorMaterial[];
  total: number;
  page: number;
  pageSize: number;
};
export function MaterialLibrary({
  courseId,
  selectedId,
  accept,
  onChoose,
  t,
  disabled = false,
  onBusy,
}: {
  courseId: string;
  selectedId?: string | null;
  accept?: string;
  onChoose: (material: AuthorMaterial) => void;
  t: Translate;
  disabled?: boolean;
  onBusy?: (busy: boolean) => void;
}) {
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<Page | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [remove, setRemove] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    const timer = setTimeout(() => {
      const params = new URLSearchParams({
        courseId,
        page: String(page),
        pageSize: "15",
        search,
      });
      void api<Page>(`/lms/material-library?${params}`)
        .then((value) => {
          if (live) {
            setData(value);
            setError(null);
          }
        })
        .catch((caught) => {
          if (live) setError(caught);
        });
    }, 200);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [courseId, page, search, refresh]);
  async function act(work: () => Promise<unknown>) {
    setBusy(true);
    onBusy?.(true);
    setError(null);
    try {
      await work();
      setRefresh((value) => value + 1);
    } catch (caught) {
      setError(caught);
    } finally {
      setBusy(false);
      onBusy?.(false);
    }
  }
  async function upload(file: File, supersedesMaterialId?: string) {
    const body = new FormData();
    body.append("file", file);
    if (supersedesMaterialId)
      body.append("supersedesMaterialId", supersedesMaterialId);
    const material = await api<AuthorMaterial>(
      `/lms/courses/${encodeURIComponent(courseId)}/materials`,
      { method: "POST", body },
    );
    onChoose(material);
  }
  function matches(material: AuthorMaterial) {
    if (!accept) return true;
    return accept
      .split(",")
      .some((mime) =>
        mime.startsWith(".")
          ? material.originalName.toLowerCase().endsWith(mime)
          : mime.endsWith("/*")
            ? material.mimeType.startsWith(mime.slice(0, -1))
            : material.mimeType === mime,
      );
  }
  return (
    <details className="lms-material-library">
      <summary>
        {selectedId
          ? t(
              "Выбрать или заменить материал",
              "Материалды таңдау немесе ауыстыру",
            )
          : t("Добавить материал", "Материал қосу")}
      </summary>
      <p className="muted">
        {t(
          "Выбор связывает материал с этим курсом. Замена создаёт отдельную редакцию; опубликованные уроки сохраняют прежний файл.",
          "Таңдау материалды осы курспен байланыстырады. Ауыстыру жаңа редакция жасайды; жарияланған сабақтар бұрынғы файлды сақтайды.",
        )}
      </p>
      <label>
        {t("Найти в библиотеке центра", "Орталық кітапханасынан іздеу")}
        <input
          type="search"
          value={search}
          onChange={(event) => {
            setSearch(event.target.value);
            setPage(1);
          }}
        />
      </label>
      {!!error && (
        <Notice>
          {lmsError(error, t)}
          <LmsErrorDiagnostic error={error} t={t} />
          <button
            type="button"
            onClick={() => setRefresh((value) => value + 1)}
          >
            {t("Повторить", "Қайталау")}
          </button>
        </Notice>
      )}
      <ul className="lms-list">
        {data?.items.map((material) => (
          <li
            key={material.id}
            className={
              selectedId === material.id ? "lms-author-selected" : undefined
            }
          >
            <div>
              <strong>{material.title || material.originalName}</strong>
              <p className="muted">
                {material.originalName} · {Math.ceil(material.size / 1024)} KB ·{" "}
                {t("Редакция", "Редакция")} {material.revision} ·{" "}
                {material.state === "VISIBLE"
                  ? t("В библиотеке", "Кітапханада")
                  : material.state === "HIDDEN"
                    ? t("Скрыт", "Жасырылған")
                    : t("Удалён", "Жойылған")}
              </p>
            </div>
            <div className="lms-actions">
              {material.state === "VISIBLE" && matches(material) && (
                <button
                  type="button"
                  disabled={
                    disabled ||
                    busy ||
                    !material.allowedActions.includes("bind")
                  }
                  onClick={() =>
                    void act(async () => {
                      await api(
                        `/lms/materials/${encodeURIComponent(material.id)}/bind`,
                        { method: "POST", body: json({ courseId }) },
                      );
                      onChoose(material);
                    })
                  }
                >
                  {selectedId === material.id
                    ? t("Выбран", "Таңдалды")
                    : t("Использовать", "Қолдану")}
                </button>
              )}
              {material.allowedActions.includes("state") && (
                <button
                  type="button"
                  disabled={disabled || busy}
                  onClick={() =>
                    void act(() =>
                      api(
                        `/lms/materials/${encodeURIComponent(material.id)}/state`,
                        {
                          method: "POST",
                          body: json({
                            state:
                              material.state === "VISIBLE"
                                ? "HIDDEN"
                                : "VISIBLE",
                            revision: material.revision,
                          }),
                        },
                      ),
                    )
                  }
                >
                  {material.state === "VISIBLE"
                    ? t("Скрыть из выбора", "Таңдаудан жасыру")
                    : t("Показать", "Көрсету")}
                </button>
              )}
              {material.allowedActions.includes("delete") &&
                (remove === material.id ? (
                  <>
                    <span>
                      {t(
                        "Удалить неиспользуемый файл?",
                        "Қолданылмайтын файл жойылсын ба?",
                      )}
                    </span>
                    <button
                      type="button"
                      disabled={disabled || busy}
                      onClick={() =>
                        void act(async () => {
                          await api(
                            `/lms/materials/${encodeURIComponent(material.id)}`,
                            { method: "DELETE" },
                          );
                          setRemove(null);
                        })
                      }
                    >
                      {t("Удалить файл", "Файлды жою")}
                    </button>
                    <button type="button" onClick={() => setRemove(null)}>
                      {t("Оставить", "Сақтау")}
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    disabled={disabled || busy}
                    onClick={() => setRemove(material.id)}
                  >
                    {t("Удалить", "Жою")}
                  </button>
                ))}
            </div>
          </li>
        ))}
      </ul>
      {data && !data.items.length && (
        <p>{t("Материалы не найдены", "Материалдар табылмады")}</p>
      )}
      {data && data.total > 15 && (
        <div className="lms-actions">
          <button
            type="button"
            disabled={page === 1 || busy}
            onClick={() => setPage((value) => value - 1)}
          >
            {t("Назад", "Артқа")}
          </button>
          <span>
            {page} / {Math.ceil(data.total / 15)}
          </span>
          <button
            type="button"
            disabled={page * 15 >= data.total || busy}
            onClick={() => setPage((value) => value + 1)}
          >
            {t("Далее", "Әрі қарай")}
          </button>
        </div>
      )}
      <label>
        {selectedId
          ? t(
              "Загрузить новую редакцию файла",
              "Файлдың жаңа редакциясын жүктеу",
            )
          : t("Загрузить файл", "Файл жүктеу")}
        <input
          type="file"
          accept={accept}
          disabled={disabled || busy}
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void act(() => upload(file, selectedId || undefined));
            event.target.value = "";
          }}
        />
      </label>
    </details>
  );
}
