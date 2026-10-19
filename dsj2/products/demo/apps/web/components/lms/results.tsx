"use client";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import type { AccessPolicy } from "@demo/contracts/src/lms";
import { AccessPolicyEditor } from "./access-policy-editor";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Notice } from "@demo/ui";
import { api, downloadExport, json } from "@/lib/api";
import { type Enrollment, type Learning, type Paged } from "@/lib/lms-api";
import {
  resultsApi,
  resultQuery,
  initialResultFilters,
  type ResultFilters,
  type ResultEnrollment,
  type FilterOption,
  type BundleState,
} from "@/lib/results-api";
import type { AppContext } from "@/lib/types";
import { ExternalEvidence } from "./external-evidence";
import { LmsDocument } from "./documents";
import { LearnerAccess } from "./learner-access";
import {
  LmsHeading,
  PageControls,
  Status,
  lmsError,
  LmsErrorDiagnostic,
  type Translate,
} from "./common";

type Prepared = {
  items: {
    id: string;
    resultId: string;
    requestId: string;
    legalForm: string;
    status: string;
    artifacts: { id: string; kind: string }[];
  }[];
  errors: {
    resultId: string;
    code: string;
    params?: Record<string, unknown>;
    message: string;
    correlationId?: string;
  }[];
};
export function Results({ t, context }: { t: Translate; context: AppContext }) {
  const searchParams = useSearchParams();
  const incomingQuery = searchParams.toString();
  const writtenQuery = useRef<string | null>(null);
  const [data, setData] = useState<Paged<ResultEnrollment>>({
    items: [],
    total: 0,
  });
  const [filters, setFilters] = useState<ResultFilters>(initialResultFilters);
  const [filtersReady, setFiltersReady] = useState(false);
  const [options, setOptions] = useState<{
    customers: FilterOption[];
    courses: FilterOption[];
    groups: FilterOption[];
  }>({ customers: [], courses: [], groups: [] });
  const [bundle, setBundle] = useState<BundleState | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [page, setPage] = useState(1),
    [refresh, setRefresh] = useState(0);
  const [error, setError] = useState<unknown>(null),
    [busy, setBusy] = useState(false);
  const [prepared, setPrepared] = useState<Prepared | null>(null);
  const [active, setActive] = useState<Enrollment | null>(null);
  const [format, setFormat] = useState<"PDF" | "DOCX">("PDF");
  const [downloading, setDownloading] = useState(false);
  const initializedPages = useRef(new Map<number, Set<string>>());
  const pageSelections = useRef(new Map<number, Set<string>>());
  const focusedEnrollment = useRef<string | null>(null);
  const staff = ["SUPER_ADMIN", "ADMIN", "DIRECTOR", "OPERATOR"].includes(context.user.role);
  const filterKey = `demo:lms:results:${context.tenant.id}:${context.user.id}`;
  function filter<K extends keyof ResultFilters>(
    key: K,
    value: ResultFilters[K],
  ) {
    setFilters((current) => ({ ...current, [key]: value }));
    setPage(1);
  }
  useEffect(() => {
    if (writtenQuery.current === incomingQuery) return;
    const query = new URLSearchParams(incomingQuery);
    const contextKeys = ["enrollmentId", "customerId", "groupId", "courseVersionId", "sourceOrderId", "sourceRequestId"];
    const fromContext = contextKeys.some((name) => query.has(name));
    const queryFilters = Object.fromEntries(Object.keys({ ...initialResultFilters, enrollmentId: "", sourceOrderId: "", sourceRequestId: "", dateFrom: "", dateTo: "", bin: "", city: "", teacherUserId: "" }).flatMap((name) => query.get(name) ? [[name, name === "expiringDays" ? Number(query.get(name)) : query.get(name)!]] : []));
    focusedEnrollment.current = query.get("enrollmentId");
    try {
      const saved = JSON.parse(
        localStorage.getItem(filterKey) || "{}",
      ) as Partial<ResultFilters>;
      setFilters({
        ...initialResultFilters,
        ...(fromContext ? {} : saved),
        ...queryFilters,
      });
    } catch {
      /* Optional preferences. */
      setFilters({ ...initialResultFilters, ...queryFilters });
    }
    setFiltersReady(true);
    setPage(1);
    void resultsApi
      .filters()
      .then(setOptions)
      .catch((caught) => setError(caught));
  }, [filterKey, incomingQuery]);
  useEffect(() => {
    initializedPages.current.clear();
    pageSelections.current.clear();
    setSelected(new Set());
    setActive(null);
  }, [filters]);
  useEffect(() => {
    if (filtersReady)
      try {
        localStorage.setItem(filterKey, JSON.stringify(filters));
        const query = new URLSearchParams(Object.entries(resultQuery(filters)).map(([name, value]) => [name, String(value)]));
        writtenQuery.current = query.toString();
        window.history.replaceState(window.history.state, "", `${window.location.pathname}?${query}`);
      } catch {
        /* Optional preferences. */
      }
  }, [filters, filtersReady, filterKey]);
  useEffect(() => {
    if (bundle?.status !== "PREPARING") return;
    let alive = true;
    const timer = setTimeout(() => {
      void resultsApi
        .bundleStatus(bundle.id)
        .then((value) => {
          if (alive) setBundle(value);
        })
        .catch((caught) => {
          if (alive) {
            setError(caught);
          }
        });
    }, 2000);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [bundle]);
  const bundleKey = `demo:lms:bundle:${context.tenant.id}:${context.user.id}`;
  useEffect(() => {
    try {
      const id = sessionStorage.getItem(bundleKey);
      if (id) void resultsApi.bundleStatus(id).then(setBundle).catch(setError);
    } catch {
      /* Optional recovery. */
    }
  }, [bundleKey]);
  useEffect(() => {
    if (bundle)
      try {
        sessionStorage.setItem(bundleKey, bundle.id);
      } catch {
        /* Optional recovery. */
      }
  }, [bundle, bundleKey]);
  const preparedKey = `demo:lms:prepared:${context.tenant.id}:${context.user.id}`;
  useEffect(() => {
    if (prepared)
      try {
        sessionStorage.setItem(
          preparedKey,
          JSON.stringify(prepared.items.map((item) => item.id)),
        );
      } catch {
        /* Optional recovery. */
      }
  }, [prepared, preparedKey]);
  useEffect(() => {
    let alive = true;
    try {
      const ids = JSON.parse(
        sessionStorage.getItem(preparedKey) || "[]",
      ) as unknown;
      if (
        Array.isArray(ids) &&
        ids.length &&
        ids.length <= 750 &&
        ids.every((id) => typeof id === "string")
      ) {
        void Promise.all(
          ids.map(async (id) => {
            const view = await api<{
              link: Prepared["items"][number];
              artifacts: { id: string; kind: string }[];
              status: string;
            }>(`/lms/documents/${id}`);
            return {
              ...view.link,
              artifacts: view.artifacts,
              status: view.status,
            };
          }),
        )
          .then((items) => {
            if (alive)
              setPrepared((current) => ({
                items,
                errors: current?.errors || [],
              }));
          })
          .catch((caught) => {
            if (alive) setError(caught);
          });
      }
    } catch {
      /* Optional recovery context; server remains the source of facts. */
    }
    return () => {
      alive = false;
    };
  }, [preparedKey, staff, refresh]);
  useEffect(() => {
    try {
      const saved = localStorage.getItem(
        `demo:lms:documents:${context.tenant.id}:${context.user.id}`,
      );
      if (saved === "PDF" || saved === "DOCX") setFormat(saved);
    } catch {
      /* Optional preference. */
    }
  }, [context.tenant.id, context.user.id]);
  useEffect(() => {
    if (
      !prepared?.items.some(
        (item) =>
          (!item.artifacts.some((artifact) => artifact.kind === format) ||
            item.status !== "ISSUED") &&
          !["VOIDED", "SUPERSEDED", "REJECTED"].includes(item.status),
      )
    )
      return;
    let alive = true;
    const timer = setTimeout(
      () => {
        void Promise.all(
          prepared.items.map(async (item) => {
            const view = await api<{
              artifacts: { id: string; kind: string }[];
              status: string;
            }>(`/lms/documents/${item.id}`);
            return { ...item, artifacts: view.artifacts, status: view.status };
          }),
        )
          .then((items) => {
            if (alive)
              setPrepared((current) =>
                current ? { ...current, items } : null,
              );
          })
          .catch((caught) => {
            if (alive) setError(caught);
          });
      },
      prepared.items.some((item) => item.status === "AWAITING_APPROVAL")
        ? 10000
        : 3000,
    );
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [prepared, format]);
  useEffect(() => {
    if (!filtersReady) return;
    let alive = true;
    setBusy(true);
    const timer = setTimeout(
      () => {
        void resultsApi
          .list(page, filters)
          .then((value) => {
            if (alive) {
              setData(value);
              setActive((current) =>
                current
                  ? value.items.find((item) => item.id === current.id) ||
                    null
                  : value.items.find((item) => item.id === focusedEnrollment.current) || null,
              );
              const previousIds =
                initializedPages.current.get(page) || new Set<string>();
              const currentIds = new Set(
                value.items.flatMap((item) =>
                  item.result ? [item.result.id] : [],
                ),
              );
              initializedPages.current.set(page, currentIds);
              setSelected((current) => {
                const next = new Set(current);
                previousIds.forEach((id) => {
                  if (!currentIds.has(id)) next.delete(id);
                });
                for (const enrollment of value.items) {
                  const result = enrollment.result;
                  if (!result) continue;
                  if (!(result.documentEligible ?? result.eligible))
                    next.delete(result.id);
                }
                return next;
              });
              setError("");
            }
          })
          .catch((caught) => {
            if (alive) {
              setError(caught);
              setData({ items: [], total: 0 });
              setActive(null);
            }
          })
          .finally(() => {
            if (alive) setBusy(false);
          });
      },
      filters.search ? 250 : 0,
    );
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [page, refresh, filters, filtersReady]);
  useEffect(() => {
    const update = () => { if (!document.hidden) setRefresh((value) => value + 1); };
    const timer = setInterval(update, 20_000);
    window.addEventListener("focus", update);
    return () => { clearInterval(timer); window.removeEventListener("focus", update); };
  }, []);
  const selectedReady =
    selected.size > 0 &&
    [...selected].every((resultId) => {
      const documents = data.items.find(
        (item) => item.result?.id === resultId,
      )?.documents;
      return (
        !!documents?.length &&
        documents.every(
          (document) =>
            document.status === "ISSUED" &&
            document.artifacts.some((artifact) => artifact.kind === format),
        )
      );
    });
  async function prepare(resultIds = [...selected]) {
    if (busy || !resultIds.length) return;
    const targets = new Set(resultIds);
    setBusy(true);
    setError("");
    try {
      const value = await api<Prepared>("/lms/results/documents", {
        method: "POST",
        body: json({ resultIds }),
      });
      const continuing = prepared?.errors.some((item) =>
        targets.has(item.resultId),
      );
      const nextPrepared =
        continuing && prepared
          ? {
              items: [
                ...new Map(
                  [...prepared.items, ...value.items].map((item) => [
                    item.id,
                    item,
                  ]),
                ).values(),
              ],
              errors: [
                ...prepared.errors.filter(
                  (item) => !targets.has(item.resultId),
                ),
                ...value.errors,
              ],
            }
          : value;
      setPrepared(nextPrepared);
      const completed = new Set(value.items.map((item) => item.resultId));
      setSelected(
        (current) => new Set([...current].filter((id) => !completed.has(id))),
      );
      try {
        sessionStorage.setItem(
          preparedKey,
          JSON.stringify(nextPrepared.items.map((item) => item.id)),
        );
      } catch {
        /* Optional recovery context. */
      }
      if (
        !value.errors.length &&
        value.items.length &&
        value.items.every(
          (item) =>
            item.status === "ISSUED" &&
            item.artifacts.some((artifact) => artifact.kind === format),
        )
      ) {
        setBundle(
          await resultsApi.bundle(
            value.items.map((item) => item.id),
            format,
          ),
        );
      }
      setRefresh((v) => v + 1);
    } catch (caught) {
      setError(caught);
    } finally {
      setBusy(false);
    }
  }
  const rowErrors = new Map(prepared?.errors.map((e) => [e.resultId, e]) || []);
  const readyDocuments =
    prepared?.items.filter(
      (item) =>
        !["VOIDED", "SUPERSEDED", "REJECTED"].includes(item.status) &&
        item.status === "ISSUED" &&
        item.artifacts.some((artifact) => artifact.kind === format),
    ) || [];
  const downloadable = readyDocuments.length > 0;
  async function download() {
    if (!prepared || !readyDocuments.length || downloading) return;
    setDownloading(true);
    setError("");
    try {
      const value = await resultsApi.bundle(
        readyDocuments.map((item) => item.id),
        format,
      );
      setBundle(value);
    } catch (caught) {
      setError(caught);
    } finally {
      setDownloading(false);
    }
  }
  return (
    <>
      <LmsHeading title={t("Результаты", "Нәтижелер")}>
        {staff && (
          <button
            className="primary lms-primary"
            disabled={busy || !selected.size}
            onClick={() => void prepare()}
          >
            {busy
              ? t("Подождите…", "Күтіңіз…")
              : `${selectedReady ? t("Получить готовый комплект", "Дайын жинақты алу") : t("Подготовить документы", "Құжаттарды дайындау")} · ${selected.size}`}
          </button>
        )}
      </LmsHeading>
      <nav className="lms-actions" aria-label={t("Контекст обучения", "Оқу контексті")}>
        <Link href={`/lms/reports?${new URLSearchParams(Object.entries(resultQuery(filters)).map(([name, value]) => [name, String(value)]))}`}>
          {t("Отчёт по этой выборке", "Осы іріктеу бойынша есеп")}
        </Link>
        {filters.groupId && <Link href={`/lms/groups/${filters.groupId}`}>{t("Вернуться к группе", "Топқа оралу")}</Link>}
        {staff && filters.sourceOrderId && <Link href={`/workbench?orderId=${filters.sourceOrderId}`}>{t("Вернуться к заказу", "Тапсырысқа оралу")}</Link>}
        {staff && filters.sourceRequestId && <Link href={`/requests/${filters.sourceRequestId}`}>{t("К подготовке документов", "Құжаттарды дайындауға")}</Link>}
      </nav>
      {!!error && (
        <Notice>
          {lmsError(error, t)}
          <LmsErrorDiagnostic error={error} t={t} />
          <button onClick={() => setRefresh((v) => v + 1)}>
            {t("Повторить", "Қайталау")}
          </button>
        </Notice>
      )}
      <section className="panel lms-panel">
        <div className="lms-toolbar">
          <label>
            {t("Найти слушателя", "Тыңдаушыны табу")}
            <input
              type="search"
              value={filters.search}
              onChange={(e) => filter("search", e.target.value)}
            />
          </label>
          <label>
            {t("Вид списка", "Тізім көрінісі")}
            <select
              value={filters.view}
              onChange={(e) => filter("view", e.target.value)}
            >
              {[
                ["ALL", t("Все назначения", "Барлық тағайындаулар")],
                [
                  "EXPIRING",
                  t("Истекает доступ", "Қолжетімділік мерзімі аяқталады"),
                ],
                ["INCOMPLETE", t("Не завершено", "Аяқталмаған")],
                ["NEEDS_REVIEW", t("Нужна проверка", "Тексеру қажет")],
                [
                  "WAITING_DOCUMENTS",
                  t("Ожидаются документы", "Құжаттар күтілуде"),
                ],
              ].map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          {filters.view === "EXPIRING" && (
            <label>
              {t("В ближайшие дни", "Алдағы күндер")}
              <input
                type="number"
                min={1}
                max={365}
                value={filters.expiringDays}
                onChange={(e) =>
                  filter(
                    "expiringDays",
                    Math.min(365, Math.max(1, Number(e.target.value))),
                  )
                }
              />
            </label>
          )}
          <details>
            <summary>{t("Фильтры и отчёт", "Сүзгілер мен есеп")}</summary>
            <div className="lms-actions">
              {(
                [
                  ["customerId", "customers", t("Организация", "Ұйым")],
                  [
                    "courseVersionId",
                    "courses",
                    t("Курс и версия", "Курс және нұсқа"),
                  ],
                  ["groupId", "groups", t("Группа", "Топ")],
                ] as const
              ).map(([key, kind, label]) => (
                <label key={key}>
                  {label}
                  <select
                    value={filters[key]}
                    onChange={(e) => filter(key, e.target.value)}
                  >
                    <option value="">{t("Все", "Барлығы")}</option>
                    {options[kind].map((option) => (
                      <option key={option.id} value={option.id}>
                        {t(option.labelRu, option.labelKz || option.labelRu)}
                      </option>
                    ))}
                  </select>
                </label>
              ))}
              <label>
                {t("Состояние", "Күйі")}
                <select
                  value={filters.status}
                  onChange={(e) => filter("status", e.target.value)}
                >
                  <option value="">{t("Все", "Барлығы")}</option>
                  {[
                    "ACTIVE",
                    "COMPLETED",
                    "PASSED",
                    "FAILED",
                    "VOIDED",
                    "SUPERSEDED",
                  ].map((value) => (
                    <option key={value} value={value}>
                      {
                        (
                          {
                            ACTIVE: t("Обучается", "Оқып жатыр"),
                            COMPLETED: t("Завершено", "Аяқталды"),
                            PASSED: t("Сдано", "Өтті"),
                            FAILED: t("Не сдано", "Өтпеді"),
                            VOIDED: t("Аннулирован", "Күші жойылған"),
                            SUPERSEDED: t("Заменено", "Ауыстырылған"),
                          } as Record<string, string>
                        )[value]
                      }
                    </option>
                  ))}
                </select>
              </label>
              <label>
                {t("Доступ истекает с", "Қолжетімділік аяқталуы, бастап")}
                <input
                  type="date"
                  value={filters.dueFrom.slice(0, 10)}
                  onChange={(e) =>
                    filter(
                      "dueFrom",
                      e.target.value ? `${e.target.value}T00:00:00.000Z` : "",
                    )
                  }
                />
              </label>
              <label>
                {t("По", "Дейін")}
                <input
                  type="date"
                  value={filters.dueTo.slice(0, 10)}
                  onChange={(e) =>
                    filter(
                      "dueTo",
                      e.target.value ? `${e.target.value}T23:59:59.999Z` : "",
                    )
                  }
                />
              </label>
              <button
                onClick={() => {
                  setFilters(initialResultFilters);
                  setPage(1);
                }}
              >
                {t("Сбросить фильтры", "Сүзгілерді тазалау")}
              </button>
              <label>
                {t("Отчёт", "Есеп")}
                <select
                  defaultValue=""
                  disabled={downloading}
                  onChange={(e) => {
                    const value = e.target.value;
                    e.target.value = "";
                    if (value) {
                      setDownloading(true);
                      void downloadExport(
                        "/lms/results/export",
                        {
                          filters: resultQuery(filters),
                          format: value,
                          language: t("ru", "kz"),
                        },
                        `LMS-results.${value.toLowerCase()}`,
                      )
                        .catch((caught) => {
                          setError(caught);
                        })
                        .finally(() => setDownloading(false));
                    }
                  }}
                >
                  <option value="">{t("Скачать…", "Жүктеу…")}</option>
                  <option value="CSV">CSV</option>
                  <option value="XLSX">XLSX</option>
                </select>
              </label>
            </div>
          </details>
          {filters.groupId && (
            <button
              disabled={downloading}
              onClick={() => {
                setDownloading(true);
                void resultsApi
                  .bundle([], format, filters.groupId)
                  .then(setBundle)
                  .catch((caught) => {
                    setError(caught);
                  })
                  .finally(() => setDownloading(false));
              }}
            >
              {t("Готовые документы группы", "Топтың дайын құжаттары")}
            </button>
          )}
        </div>
        <p className="lms-list-meta">
          {t("Найдено", "Табылды")}: {data.total}
        </p>
      </section>
      {bundle && (
        <section className="panel lms-panel" aria-live="polite">
          <h2>{t("Комплект документов", "Құжаттар жинағы")}</h2>
          <Status value={bundle.status} t={t} />
          {bundle.error && (
            <div role="alert">
              {lmsError(bundle.error, t)}
              <LmsErrorDiagnostic error={bundle.error} t={t} />
            </div>
          )}
          <div className="lms-actions">
            {bundle.parts.map((part) => (
              <a
                className={part.index === 0 ? "button primary" : "button"}
                key={part.index}
                href={`/api/lms/documents/bundles/${bundle.id}/parts/${part.index}`}
                download
              >
                {t("Скачать часть", "Бөлікті жүктеу")} {part.index + 1} /{" "}
                {bundle.partCount}
              </a>
            ))}
            {bundle.directFiles.map((file) => (
              <a
                className="button"
                key={file.id}
                href={`/api/lms/artifacts/${file.id}`}
                download
              >
                {file.fileName}
              </a>
            ))}
          </div>
          {!!bundle.directFiles.length && (
            <p>
              {t(
                "Крупные файлы доступны отдельно в исходном качестве.",
                "Үлкен файлдар бастапқы сапада бөлек қолжетімді.",
              )}
            </p>
          )}
        </section>
      )}
      {!!prepared?.items.length && (
        <details className="panel lms-panel" open={!bundle}>
          <summary>
            {t("Формат и исходные документы", "Пішім және бастапқы құжаттар")}
          </summary>
          <div className="lms-toolbar">
            <div className="lms-actions">
              <label>
                {t("Формат", "Пішім")}
                <select
                  value={format}
                  onChange={(event) => {
                    const value = event.target.value as "PDF" | "DOCX";
                    setFormat(value);
                    try {
                      localStorage.setItem(
                        `demo:lms:documents:${context.tenant.id}:${context.user.id}`,
                        value,
                      );
                    } catch {
                      /* Optional preference. */
                    }
                  }}
                >
                  <option>PDF</option>
                  <option>DOCX</option>
                </select>
              </label>
              <button
                className="primary lms-primary"
                disabled={!downloadable || downloading}
                onClick={() => void download()}
              >
                {readyDocuments.length < prepared.items.length
                  ? `${t("Получить готовую часть", "Дайын бөлігін алу")} · ${readyDocuments.length}`
                  : t("Получить комплект", "Жинақты алу")}
              </button>
            </div>
          </div>
          {readyDocuments.length < prepared.items.length && <p className="lms-list-meta">
            {t("Готово к скачиванию", "Жүктеуге дайын")}: {readyDocuments.length} · {t("Ожидается", "Күтілуде")}: {prepared.items.length - readyDocuments.length}
          </p>}
          <ul className="lms-list">
            {[
              ...new Map(
                prepared.items.map((item) => [item.requestId, item]),
              ).values(),
            ].map((item) => (
              <li key={item.requestId}>
                <Status value={item.legalForm} t={t} />
                <Status value={item.status} t={t} />
                {staff && (
                  <Link className="button" href={`/requests/${item.requestId}`}>
                    {t("Посмотреть комплект", "Жинақты қарау")}
                  </Link>
                )}
              </li>
            ))}
          </ul>
        </details>
      )}
      <section className="panel lms-panel" aria-busy={busy}>
        {staff && !!data.items.length && <div className="lms-actions">
          <button onClick={() => setSelected((current) => new Set([...current, ...data.items.flatMap((item) => (item.result?.documentEligible ?? item.result?.eligible) ? [item.result!.id] : [])]))}>
            {t("Выбрать допустимые результаты на странице", "Беттегі рұқсат етілген нәтижелерді таңдау")}
          </button>
          {!!selected.size && <button className="text-button" onClick={() => setSelected(new Set())}>{t("Снять выбор", "Таңдауды алып тастау")}</button>}
          <span>{t("Выбрано результатов", "Таңдалған нәтижелер")}: {selected.size}</span>
        </div>}
        <div
          className="lms-table-scroll"
          tabIndex={0}
          role="region"
          aria-label={t("Результаты обучения", "Оқу нәтижелері")}
        >
          <table className="lms-table">
            <thead>
              <tr>
                <th>{t("Слушатель", "Тыңдаушы")}</th>
                <th>{t("Программа", "Бағдарлама")}</th>
                <th>{t("Прогресс", "Барысы")}</th>
                <th>{t("Результат", "Нәтиже")}</th>
                <th>{t("Документы", "Құжаттар")}</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((enrollment) => {
                const result = enrollment.result;
                return (
                  <tr key={enrollment.id}>
                    <td>
                      <div className="lms-inline-label">
                        {(result?.documentEligible ?? result?.eligible) && (
                          <input
                            type="checkbox"
                            aria-label={t(
                              enrollment.recipient?.data.fullNameRu || "",
                              enrollment.recipient?.data.fullNameKz ||
                                enrollment.recipient?.data.fullNameRu ||
                                "",
                            )}
                            checked={
                              staff
                                ? selected.has(result.id)
                                : !!enrollment.documents?.some((document) =>
                                    prepared?.items.some(
                                      (item) => item.id === document.id,
                                    ),
                                  )
                            }
                            onChange={(event) => {
                              if (!staff) {
                                const checked = event.target.checked;
                                const documents = (
                                  enrollment.documents || []
                                ).filter(
                                  (document) => document.status === "ISSUED",
                                );
                                setPrepared((current) => ({
                                  items: checked
                                    ? [
                                        ...new Map(
                                          [
                                            ...(current?.items || []),
                                            ...documents,
                                          ].map((item) => [item.id, item]),
                                        ).values(),
                                      ]
                                    : (current?.items || []).filter(
                                        (item) =>
                                          !documents.some(
                                            (d) => d.id === item.id,
                                          ),
                                      ),
                                  errors: current?.errors || [],
                                }));
                                return;
                              }
                              setSelected((current) => {
                                const next = new Set(current);
                                if (event.target.checked) next.add(result.id);
                                else next.delete(result.id);
                                return next;
                              });
                            }}
                          />
                        )}
                        <button
                          className="text-button"
                          onClick={() => {
                            setActive(enrollment);
                            focusedEnrollment.current = enrollment.id;
                            const url = new URL(window.location.href);
                            url.searchParams.set("enrollmentId", enrollment.id);
                            writtenQuery.current = url.searchParams.toString();
                            window.history.replaceState(window.history.state, "", url);
                          }}
                        >
                          {t(
                            enrollment.recipient?.data.fullNameRu || "",
                            enrollment.recipient?.data.fullNameKz ||
                              enrollment.recipient?.data.fullNameRu ||
                              "",
                          )}
                        </button>
                      </div>
                      <div className="lms-list-meta">
                        {t(
                          enrollment.customer?.nameRu || "",
                          enrollment.customer?.nameKz ||
                            enrollment.customer?.nameRu ||
                            "",
                        )}
                        {enrollment.group?.name || enrollment.groupKey
                          ? ` · ${enrollment.group?.name || enrollment.groupKey}`
                          : ""}
                      </div>
                    </td>
                    <td>
                      {t(
                        enrollment.courseVersion?.content.titleRu || "",
                        enrollment.courseVersion?.content.titleKz || "",
                      )}
                    </td>
                    <td>
                      {enrollment.progressPercent || 0}%
                      <div
                        className="lms-list-meta"
                        style={{ whiteSpace: "nowrap" }}
                      >
                        {enrollment.dueAt
                          ? new Date(enrollment.dueAt).toLocaleDateString(
                              t("ru-KZ", "kk-KZ"),
                            )
                          : ""}
                      </div>
                    </td>
                    <td>
                      {result ? (
                        <>
                          <Status
                            value={result.state || result.verdict}
                            t={t}
                          />
                          <div className="lms-list-meta">
                            <Status value={result.assessmentKind} t={t} />
                            {result.score != null && (
                              <span>
                                {result.score}/{result.maximum}
                              </span>
                            )}
                          </div>
                          {result.reviewReasons?.includes(
                            "EXAM_DATE_UNKNOWN",
                          ) && (
                            <p>
                              {t(
                                "Уточните дату внешнего экзамена",
                                "Сыртқы емтихан күнін нақтылаңыз",
                              )}
                            </p>
                          )}
                          {rowErrors.get(result.id) && (
                            <div className="lms-error" role="alert">
                              {lmsError(rowErrors.get(result.id), t)}
                              <LmsErrorDiagnostic
                                error={rowErrors.get(result.id)}
                                t={t}
                              />
                            </div>
                          )}
                        </>
                      ) : (
                        <Status value="ACTIVE" t={t} />
                      )}
                    </td>
                    <td>
                      {enrollment.documents?.map((document) => (
                        <p key={document.id}>
                          <Status value={document.legalForm} t={t} />
                          {" · "}<Status value={document.status} t={t} />
                          <button className="text-button" onClick={() => setActive(enrollment)}>{t("Открыть документ", "Құжатты ашу")}</button>
                        </p>
                      ))}
                      {!enrollment.documents?.length && (
                        <button className="text-button" onClick={() => setActive(enrollment)}>
                          {(result?.documentEligible ?? result?.eligible)
                            ? t("Готово к подготовке", "Дайындауға дайын")
                            : t("Что требуется для документа", "Құжат үшін не қажет")}
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {!data.items.length && !busy && (
          <p className="lms-empty">
            {t("В этой выборке назначений нет.", "Бұл іріктеуде тағайындаулар жоқ.")} {" "}
            <button className="text-button" onClick={() => { setFilters(initialResultFilters); setPage(1); }}>{t("Сбросить фильтры", "Сүзгілерді тазалау")}</button>
            {staff && <Link href="/lms/assign">{t("Организовать обучение", "Оқуды ұйымдастыру")}</Link>}
          </p>
        )}
        <PageControls
          page={page}
          total={data.total}
          pageSize={data.pageSize || 50}
          onPage={(nextPage) => {
            pageSelections.current.set(page, new Set(selected));
            setSelected(new Set(pageSelections.current.get(nextPage) || []));
            setPage(nextPage);
          }}
          t={t}
        />
      </section>
      {active && (
        <section className="panel lms-panel">
          <div className="lms-toolbar">
            <h2>
              {t(
                active.recipient?.data.fullNameRu || "",
                active.recipient?.data.fullNameKz ||
                  active.recipient?.data.fullNameRu ||
                  "",
              )}
            </h2>
            <button onClick={() => { focusedEnrollment.current = null; setActive(null); }}>
              {t("Закрыть", "Жабу")}
            </button>
          </div>
          {staff && (
            <LearnerAccess
              recipientIds={[active.recipientId]}
              t={t}
              canRecover={["SUPER_ADMIN", "ADMIN", "DIRECTOR"].includes(context.user.role)}
            />
          )}
          <EnrollmentDetails
            key={active.id}
            enrollment={active}
            t={t}
            staff={staff}
            canReview={["SUPER_ADMIN", "ADMIN", "DIRECTOR"].includes(context.user.role)}
            revision={refresh}
            preparing={busy}
            onPrepare={() => { if (active.result) void prepare([active.result.id]); }}
            onChanged={() => setRefresh((v) => v + 1)}
          />
        </section>
      )}
    </>
  );
}
function EnrollmentDetails({
  enrollment,
  t,
  canReview,
  staff,
  onChanged,
  revision,
  preparing,
  onPrepare,
}: {
  enrollment: Enrollment;
  t: Translate;
  canReview: boolean;
  staff: boolean;
  onChanged: () => void;
  revision: number;
  preparing: boolean;
  onPrepare: () => void;
}) {
  const [data, setData] = useState<Learning | null>(null),
    [error, setError] = useState<unknown>(null);
  const [reason, setReason] = useState(""),
    [action, setAction] = useState("correct"),
    [busy, setBusy] = useState(false),
    [done, setDone] = useState(false);
  const [accessPolicy, setAccessPolicy] = useState<AccessPolicy>(
    () =>
      enrollment.accessPolicy || {
        mode: enrollment.expiresAt || enrollment.dueAt ? "FIXED" : "UNLIMITED",
        endsAt: enrollment.expiresAt || enrollment.dueAt || null,
        timezone: "Asia/Qyzylorda",
      },
  );
  const [extended, setExtended] = useState(false);
  useEffect(() => {
    let alive = true;
    void api<Learning>(`/lms/enrollments/${enrollment.id}`)
      .then((value) => {
        if (alive) { setData(value); setError(null); }
      })
      .catch((caught) => {
        if (alive) { setError(caught); setData(null); }
      });
    return () => {
      alive = false;
    };
  }, [enrollment.id, enrollment.result?.id, revision]);
  async function amend(event: FormEvent) {
    event.preventDefault();
    if (!enrollment.result || busy) return;
    setBusy(true);
    setError("");
    try {
      await api(`/lms/results/${enrollment.result.id}/${action}`, {
        method: "POST",
        body: json({ reason }),
      });
      setDone(true);
      onChanged();
    } catch (caught) {
      setError(caught);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      {!!error && <Notice>{lmsError(error, t)}</Notice>}
      {data && !data.documents.some((document) => document.resultId === enrollment.result?.id) && <section className="lms-panel" aria-live="polite">
        <h3>{t("Следующий шаг к документам", "Құжаттарға келесі қадам")}</h3>
        <p>{(enrollment.result?.documentEligible ?? enrollment.result?.eligible)
          ? t("Результат допускает подготовку документов центром.", "Нәтиже орталыққа құжаттарды дайындауға мүмкіндік береді.")
          : data.attempts.some((attempt) => attempt.state === "SUBMITTED")
            ? t("Ожидается решение преподавателя или эксперта по отправленной работе.", "Жіберілген жұмыс бойынша оқытушының немесе сарапшының шешімі күтілуде.")
            : data.examReadiness.missingLessonIds.length
              ? t(`Слушателю нужно завершить обязательные элементы: ${data.examReadiness.missingLessonIds.length}.`, `Тыңдаушы міндетті элементтерді аяқтауы керек: ${data.examReadiness.missingLessonIds.length}.`)
              : data.profile.assessmentKind === "EXTERNAL_AUTHORIZED"
                ? t("Центру нужно внести основание внешнего результата; директору — подтвердить его.", "Орталық сыртқы нәтиженің негізін енгізуі, директор оны растауы керек.")
                : enrollment.result?.verdict === "FAILED"
                  ? t("Положительного результата нет. Следующий допуск определяется правилами программы и центром.", "Оң нәтиже жоқ. Келесі рұқсатты бағдарлама ережелері мен орталық анықтайды.")
                  : t("Нужен положительный подтверждённый результат и выполнение условий программы.", "Оң расталған нәтиже және бағдарлама шарттарының орындалуы қажет.")}</p>
        {data.examReadiness.reasonCode && <p>{lmsError({ code: data.examReadiness.reasonCode }, t)}</p>}
        <div className="lms-actions">
          {staff && (enrollment.result?.documentEligible ?? enrollment.result?.eligible) && <button className="primary" disabled={preparing} onClick={onPrepare}>{preparing ? t("Подготовка…", "Дайындалуда…") : t("Подготовить документы", "Құжаттарды дайындау")}</button>}
          {enrollment.groupId && <Link href={`/lms/groups/${enrollment.groupId}`}>{t("Открыть группу", "Топты ашу")}</Link>}
          {staff && enrollment.sourceOrderId && <Link href={`/workbench?orderId=${enrollment.sourceOrderId}`}>{t("Открыть заказ", "Тапсырысты ашу")}</Link>}
          <Link href={`/lms/reports?enrollmentId=${enrollment.id}`}>{t("Отчёт по назначению", "Тағайындау бойынша есеп")}</Link>
        </div>
      </section>}
      {staff && data?.profile.assessmentKind === "EXTERNAL_AUTHORIZED" && (
        <ExternalEvidence
          enrollmentId={enrollment.id}
          t={t}
          canReview={canReview}
          onChanged={onChanged}
        />
      )}
      {data?.documents.map((document) => (
        <LmsDocument
          key={document.id}
          id={document.id}
          t={t}
          canPrepare={staff}
          canAttest={canReview}
          revision={revision}
          onChanged={onChanged}
        />
      ))}
      {staff && (
        <details>
          <summary>{t("Срок доступа", "Қолжетімділік мерзімі")}</summary>
          <form
            onSubmit={async (event) => {
              event.preventDefault();
              if (busy) return;
              setBusy(true);
              setError("");
              try {
                await api(`/lms/enrollments/${enrollment.id}/extend`, {
                  method: "POST",
                  body: json({
                    accessPolicy,
                  }),
                });
                setExtended(true);
                onChanged();
              } catch (caught) {
                setError(caught);
              } finally {
                setBusy(false);
              }
            }}
          >
            <AccessPolicyEditor
              value={accessPolicy}
              onChange={(value) => {
                setAccessPolicy(value);
                setExtended(false);
              }}
              t={t}
              disabled={busy}
            />
            <p className="muted">
              {t(
                "Индивидуальный период имеет приоритет над настройками группы и курса. Срок выполнения задания проверяется отдельно.",
                "Жеке кезең топ пен курс параметрлерінен басым. Тапсырманы орындау мерзімі бөлек тексеріледі.",
              )}
            </p>
            {extended && (
              <p role="status">{t("Срок обновлён", "Мерзім жаңартылды")}</p>
            )}
            <button className="primary" disabled={busy}>
              {t("Обновить срок доступа", "Қолжетімділік мерзімін жаңарту")}
            </button>
          </form>
        </details>
      )}
      {canReview && enrollment.result && (
        <details>
          <summary>
            {t("Исправление или аннулирование", "Түзету немесе күшін жою")}
          </summary>
          {done ? (
            <p role="status">
              {t("Изменение зарегистрировано", "Өзгеріс тіркелді")}
            </p>
          ) : (
            <form onSubmit={amend}>
              <label>
                {t("Действие", "Әрекет")}
                <select
                  value={action}
                  onChange={(e) => setAction(e.target.value)}
                >
                  <option value="correct">
                    {t(
                      "Новая редакция с исправленными данными",
                      "Түзетілген деректермен жаңа нұсқа",
                    )}
                  </option>
                  <option value="revoke">
                    {t("Аннулировать результат", "Нәтиженің күшін жою")}
                  </option>
                </select>
              </label>
              <label>
                {t("Основание", "Негіз")}
                <textarea
                  required
                  minLength={3}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                />
              </label>
              <button className="primary" disabled={busy}>
                {action === "correct"
                  ? t(
                      "Создать исправленную редакцию",
                      "Түзетілген нұсқаны жасау",
                    )
                  : t("Аннулировать результат", "Нәтиженің күшін жою")}
              </button>
            </form>
          )}
        </details>
      )}
    </>
  );
}
