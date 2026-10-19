"use client";
import "./reports.css";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Notice } from "@demo/ui";
import { isoToZonedInput, zonedInputToIso } from "@demo/contracts/src/lms/time";
import type { AppContext } from "@/lib/types";
import { ApiError } from "@/lib/api";
import {
  reportsApi,
  downloadReport,
  initialReportFilters,
  type ReportKind,
  type ReportFilters,
  type ReportData,
  type ReportOption,
} from "@/lib/reports-api";
import { LmsHeading, PageControls, lmsError, type Translate } from "./common";

const kinds: Array<[ReportKind, string, string]> = [
  ["TRAINING", "Обучение", "Оқыту"],
  ["EMPLOYEES", "Сотрудники", "Қызметкерлер"],
  ["TESTING", "Тестирование", "Тестілеу"],
  ["DOCUMENTS", "Документы", "Құжаттар"],
  ["ORGANIZATIONS", "Организации", "Ұйымдар"],
  ["DEADLINES", "Сроки", "Мерзімдер"],
  ["CREDENTIALS", "Реестр удостоверений", "Куәліктер тізілімі"],
  ["CERTIFICATES", "Реестр сертификатов", "Сертификаттар тізілімі"],
  [
    "EMPLOYEE_DIRECTORY",
    "Все сотрудники, включая без обучения",
    "Оқуы жоқтарды қоса барлық қызметкерлер",
  ],
  [
    "ORGANIZATION_DIRECTORY",
    "Все организации, включая без обучения",
    "Оқуы жоқтарды қоса барлық ұйымдар",
  ],
  [
    "DOCUMENT_REGISTRY",
    "Общий реестр: обучение и обычная печать",
    "Жалпы тізілім: оқу және кәдімгі басып шығару",
  ],
];
const metrics: Array<[string, string, string, ReportKind]> = [
  ["participants", "Участники", "Қатысушылар", "EMPLOYEES"],
  [
    "accounts",
    "Связанные учебные записи",
    "Байланысқан оқу тіркелгілері",
    "EMPLOYEES",
  ],
  ["organizations", "Организации", "Ұйымдар", "ORGANIZATIONS"],
  [
    "activeAssignments",
    "Активные назначения",
    "Белсенді тағайындаулар",
    "TRAINING",
  ],
  [
    "completedAssignments",
    "Завершённые назначения",
    "Аяқталған тағайындаулар",
    "TRAINING",
  ],
  [
    "attempts",
    "Отправленные / завершённые попытки",
    "Жіберілген / аяқталған талпыныстар",
    "TESTING",
  ],
  ["passedAttempts", "Успешные попытки", "Сәтті талпыныстар", "TESTING"],
  [
    "issuedDocuments",
    "Выданные документы, включая историю",
    "Берілген құжаттар, тарихымен",
    "DOCUMENTS",
  ],
  ["validDocuments", "Действующие документы", "Жарамды құжаттар", "DOCUMENTS"],
  [
    "expiringDocuments",
    "Истекают в течение 30 дней",
    "30 күн ішінде аяқталады",
    "DOCUMENTS",
  ],
  [
    "voidedDocuments",
    "Аннулированные документы",
    "Күші жойылған құжаттар",
    "DOCUMENTS",
  ],
  [
    "supersededDocuments",
    "Заменённые документы",
    "Ауыстырылған құжаттар",
    "DOCUMENTS",
  ],
  [
    "unknownValidity",
    "Выданы, срок неизвестен",
    "Берілген, мерзімі белгісіз",
    "DOCUMENTS",
  ],
];
const states: Record<string, [string, string]> = {
  LMS: ["Результат обучения", "Оқу нәтижесі"],
  PRINTING: ["Обычная печать", "Кәдімгі басып шығару"],
  ACTIVE: ["Назначено", "Тағайындалды"],
  COMPLETED: ["Завершено", "Аяқталған"],
  CANCELLED: ["Отменено", "Тоқтатылған"],
  PASSED: ["Сдано", "Өтті"],
  FAILED: ["Не сдано", "Өтпеді"],
  VOIDED: ["Аннулирован", "Күші жойылған"],
  SUPERSEDED: ["Заменён", "Ауыстырылған"],
  VALID: ["Действует", "Жарамды"],
  EXPIRING: ["Истекает в течение 30 дней", "30 күн ішінде аяқталады"],
  EXPIRED: ["Срок истёк", "Мерзімі аяқталған"],
  UNKNOWN: ["Неизвестно", "Белгісіз"],
  UNKNOWN_VALIDITY: ["Срок действия неизвестен", "Қолданылу мерзімі белгісіз"],
  ISSUED: ["Выдан", "Берілген"],
  AWAITING_APPROVAL: ["Ожидает согласования", "Келісу күтілуде"],
  AWAITING_SIGNATURE: ["Ожидает подписи", "Қол қою күтілуде"],
  RENDERING: ["Файлы готовятся", "Файлдар дайындалуда"],
  SUBMITTED: ["На проверке", "Тексерілуде"],
  FINISHED: ["Завершено", "Аяқталған"],
  FINAL: ["Итоговый экзамен", "Қорытынды емтихан"],
  INTERMEDIATE: ["Промежуточная проверка", "Аралық тексеру"],
  LEARNING_FINAL: ["Учебное завершение", "Оқуды аяқтау"],
  CREDENTIAL: ["Удостоверение", "Куәлік"],
  CERTIFICATE: ["Сертификат", "Сертификат"],
  PROTOCOL: ["Протокол", "Хаттама"],
  ACCESS: ["Доступ к обучению", "Оқуға қолжетімділік"],
  DOCUMENT: ["Действие документа", "Құжаттың қолданылуы"],
  NEXT_CHECK: ["Следующая проверка", "Келесі тексеру"],
  CONNECTED: ["Связана", "Байланыстырылған"],
  NOT_CONNECTED: ["Не связана", "Байланыстырылмаған"],
  NOT_STARTED: ["Результата нет", "Нәтиже жоқ"],
  KNOWN: ["Срок известен", "Мерзімі белгілі"],
};
const translated = new Set([
  "status",
  "result",
  "purpose",
  "documentType",
  "deadlineKind",
  "account",
  "origin",
]);
const contextFilterKeys = [
  "groupId",
  "sourceOrderId",
  "sourceRequestId",
  "enrollmentId",
  "view",
  "expiringDays",
  "dueFrom",
  "dueTo",
] as const;
const reportFilterKeys = [
  ...Object.keys(initialReportFilters),
  ...contextFilterKeys,
] as Array<keyof ReportFilters>;
function savedReportFilters(data: ReportData): ReportFilters {
  return {
    ...initialReportFilters,
    ...Object.fromEntries(
      reportFilterKeys.flatMap((name) =>
        data.filters?.[name] != null
          ? [[name, String(data.filters[name])]]
          : [],
      ),
    ),
  };
}
function reportError(error: unknown, t: Translate) {
  const code =
    error instanceof ApiError
      ? (error.details as { code?: string })?.code
      : undefined;
  if (code === "REPORT_ACCESS_REVOKED")
    return t(
      "Область доступа изменилась. Сформируйте новый отчёт.",
      "Қолжетімділік өзгерді. Жаңа есеп жасаңыз.",
    );
  if (code === "REPORT_EXPIRED")
    return t(
      "Срок хранения истёк. Сформируйте новый отчёт.",
      "Сақтау мерзімі аяқталды. Жаңа есеп жасаңыз.",
    );
  if (code === "IDEMPOTENCY_CONFLICT")
    return t(
      "Параметры операции изменились. Повторите формирование.",
      "Операция параметрлері өзгерді. Қайта қалыптастырыңыз.",
    );
  return lmsError(error, t);
}
export function Reports({ t, context }: { t: Translate; context: AppContext }) {
  const readonly = context.user.role === "VIEWER";
  const searchParams = useSearchParams();
  const incomingQuery = searchParams.toString();
  const key = `demo:lms:reports:${context.tenant.id}:${context.user.id}`;
  const [filters, setFilters] = useState<ReportFilters>(initialReportFilters),
    [kind, setKind] = useState<ReportKind>("TRAINING"),
    [format, setFormat] = useState("PDF"),
    [page, setPage] = useState(1),
    [ready, setReady] = useState(false);
  const [data, setData] = useState<ReportData | null>(null),
    [job, setJob] = useState<ReportData | null>(null),
    [error, setError] = useState<unknown>(null),
    [busy, setBusy] = useState(false),
    [refresh, setRefresh] = useState(0);
  const [options, setOptions] = useState<{
    customers: ReportOption[];
    courses: ReportOption[];
    teachers: ReportOption[];
    cities: string[];
  }>({ customers: [], courses: [], teachers: [], cities: [] });
  const [history, setHistory] = useState<
    Array<{
      id: string;
      kind: ReportKind;
      format: string;
      status: string;
      totalRows: number;
      snapshotAt: string;
    }>
  >([]);
  const request = useRef<{ identity: string; key: string } | null>(null);
  const language = t("ru", "kz") as "ru" | "kz";
  const [snapshotView, setSnapshotView] = useState(false);
  const [metric, setMetric] = useState<string | undefined>();
  useEffect(() => {
    let alive = true;
    const query = new URLSearchParams(incomingQuery);
    const fromContext = reportFilterKeys.some((name) => query.has(name));
    const queryFilters = Object.fromEntries(
      reportFilterKeys.flatMap((name) =>
        query.get(name) ? [[name, query.get(name)!]] : [],
      ),
    );
    if (fromContext) {
      setSnapshotView(false);
      setMetric(undefined);
      setKind("TRAINING");
      setPage(1);
      setJob(null);
    }
    try {
      const saved = JSON.parse(localStorage.getItem(key) || "{}");
      setFilters({
        ...initialReportFilters,
        ...(fromContext ? queryFilters : saved.filters || {}),
      });
      if (!fromContext && kinds.some(([k]) => k === saved.kind))
        setKind(saved.kind);
      if (!fromContext && metrics.some(([m]) => m === saved.metric))
        setMetric(saved.metric);
      if (kinds.some(([k]) => k === query.get("kind")))
        setKind(query.get("kind") as ReportKind);
      if (["PDF", "XLSX", "CSV"].includes(saved.format))
        setFormat(saved.format);
      const pending = JSON.parse(
        sessionStorage.getItem(key + ":request") || "null",
      );
      if (pending?.identity && pending?.key) request.current = pending;
      const id = sessionStorage.getItem(key + ":job");
      const savedSnapshotView =
        sessionStorage.getItem(key + ":snapshot") === "true";
      if (id && !readonly)
        void reportsApi
          .status(id)
          .then((value) => {
            if (!alive) return;
            if (fromContext) {
              const expected = { ...initialReportFilters, ...queryFilters };
              const normalize = (name: string, input: unknown) => {
                if (
                  input == null ||
                  input === "" ||
                  (name === "view" && input === "ALL") ||
                  (name === "expiringDays" && String(input) === "30")
                )
                  return "";
                if (["dateFrom", "dateTo", "dueFrom", "dueTo"].includes(name))
                  return String(new Date(String(input)).getTime());
                return String(input);
              };
              if (
                value.kind !== (query.get("kind") || "TRAINING") ||
                reportFilterKeys.some(
                  (name) =>
                    normalize(name, value.filters?.[name]) !==
                    normalize(name, expected[name]),
                )
              )
                return;
            }
            setJob(value);
            if (savedSnapshotView && !fromContext) {
              setData(value);
              setKind(value.kind);
              setMetric(value.metric);
              setFilters(savedReportFilters(value));
              setSnapshotView(true);
            }
          })
          .catch((caught) => {
            if (alive && !fromContext) setError(caught);
          });
    } catch {
      /* Optional preferences never grant access. */
      if (fromContext) setFilters({ ...initialReportFilters, ...queryFilters });
    }
    setReady(true);
    void reportsApi
      .options()
      .then((value) => {
        if (alive) setOptions(value);
      })
      .catch((caught) => {
        if (alive) setError(caught);
      });
    return () => {
      alive = false;
    };
  }, [key, incomingQuery]);
  useEffect(() => {
    if (ready)
      try {
        localStorage.setItem(
          key,
          JSON.stringify({ filters, kind, format, metric }),
        );
      } catch {
        /* Optional preferences. */
      }
  }, [ready, key, filters, kind, format, metric]);
  useEffect(() => {
    if (ready)
      try {
        sessionStorage.setItem(key + ":snapshot", String(snapshotView));
      } catch {
        /* Optional view recovery. */
      }
  }, [ready, key, snapshotView]);
  useEffect(() => {
    if (!ready) return;
    let alive = true;
    const timer = setTimeout(() => {
      setBusy(true);
      void (
        snapshotView && job?.id
          ? reportsApi.status(job.id, page)
          : reportsApi.query(kind, filters, language, page, metric)
      )
        .then((v) => {
          if (alive) {
            setData(v);
            setError(null);
          }
        })
        .catch((e) => {
          if (alive) {
            setError(e);
            setData(null);
          }
        })
        .finally(() => {
          if (alive) setBusy(false);
        });
    }, 180);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [
    ready,
    kind,
    filters,
    language,
    page,
    refresh,
    snapshotView,
    job?.id,
    metric,
  ]);
  useEffect(() => {
    if (readonly) return;
    void reportsApi
      .list()
      .then((v) => setHistory(v.items))
      .catch(setError);
  }, [refresh, job?.status]);
  useEffect(() => {
    if (!job?.id) return;
    try {
      sessionStorage.setItem(key + ":job", job.id);
    } catch {
      /* Optional recovery. */
    }
    if (!["PENDING", "RUNNING"].includes(job.status || "")) return;
    let alive = true;
    const timer = setTimeout(() => {
      void reportsApi
        .status(job.id!)
        .then((v) => {
          if (alive) setJob(v);
        })
        .catch((e) => {
          if (alive) {
            setJob(null);
            setError(e);
          }
        });
    }, 1500);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [job, key]);
  const change = (name: keyof ReportFilters, value: string) => {
    setFilters((v) => ({ ...v, [name]: value }));
    setPage(1);
    setSnapshotView(false);
  };
  const choose = (next: ReportKind) => {
    setMetric(undefined);
    setKind(next);
    setPage(1);
    setSnapshotView(false);
  };
  const select = (
    name: "customerId" | "courseVersionId" | "teacherUserId",
    label: [string, string],
    values: ReportOption[],
  ) => (
    <label>
      {t(...label)}
      <select
        aria-label={t(...label)}
        value={filters[name]}
        onChange={(e) => change(name, e.target.value)}
      >
        <option value="">{t("Все", "Барлығы")}</option>
        {values.map((o) => (
          <option key={o.id} value={o.id}>
            {t(o.labelRu, o.labelKz)}
          </option>
        ))}
      </select>
    </label>
  );
  async function generate() {
    if (busy || readonly) return;
    setBusy(true);
    setError(null);
    try {
      const identity = JSON.stringify({
        kind,
        filters,
        language,
        format,
        metric,
      });
      if (job && ["READY", "CANCELLED", "EXPIRED"].includes(job.status || ""))
        request.current = null;
      if (request.current?.identity !== identity)
        request.current = { identity, key: crypto.randomUUID() };
      try {
        sessionStorage.setItem(
          key + ":request",
          JSON.stringify(request.current),
        );
      } catch {
        /* The server request key remains in memory when browser storage is unavailable. */
      }
      const created = await reportsApi.create(
        kind,
        filters,
        language,
        format,
        request.current.key,
        metric,
      );
      setJob(created);
      setData(created);
      setPage(1);
      setSnapshotView(true);
      setRefresh((v) => v + 1);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }
  async function act(action: "retry" | "cancel") {
    if (!job?.id) return;
    setBusy(true);
    try {
      setJob(await reportsApi.action(job.id, action));
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }
  function cell(field: string, value: string | number | null) {
    if (value === null || value === "" || value === undefined)
      return t("Неизвестно", "Белгісіз");
    if (translated.has(field) && states[String(value)])
      return t(...states[String(value)]);
    return String(value);
  }
  return (
    <>
      <LmsHeading title={t("Сводка и отчёты", "Жиынтық пен есептер")} />
      <nav
        className="lms-actions"
        aria-label={t("Контекст отчёта", "Есеп контексті")}
      >
        {!readonly && (
          <Link
            href={`/lms/results?${new URLSearchParams(
              Object.entries(filters)
                .filter(([, value]) => !!value)
                .map(([name, value]) => [name, String(value)]),
            )}`}
          >
            {t(
              "Открыть назначения этой выборки",
              "Осы іріктеудің тағайындауларын ашу",
            )}
          </Link>
        )}
        {filters.groupId && (
          <Link href={`/lms/groups/${filters.groupId}`}>
            {t("К группе", "Топқа")}
          </Link>
        )}
        {["SUPER_ADMIN", "ADMIN", "DIRECTOR", "OPERATOR"].includes(
          context.user.role,
        ) &&
          filters.sourceOrderId && (
            <Link href={`/workbench?orderId=${filters.sourceOrderId}`}>
              {t("К заказу", "Тапсырысқа")}
            </Link>
          )}
        <button
          className="text-button"
          onClick={() => {
            setFilters(initialReportFilters);
            setMetric(undefined);
            setPage(1);
            setSnapshotView(false);
          }}
        >
          {t("Сбросить выборку", "Іріктеуді тазалау")}
        </button>
      </nav>
      {(filters.groupId ||
        filters.sourceOrderId ||
        filters.enrollmentId ||
        filters.sourceRequestId) && (
        <p className="lms-list-meta">
          {t(
            "Область отчёта сохранена из открытой группы, заказа или назначения.",
            "Есеп аймағы ашылған топтан, тапсырыстан немесе тағайындаудан сақталды.",
          )}
        </p>
      )}
      {!!error && (
        <Notice>
          <span>{reportError(error, t)}</span>
          <button type="button" onClick={() => setRefresh((v) => v + 1)}>
            {t("Повторить", "Қайталау")}
          </button>
        </Notice>
      )}
      <section className="panel lms-panel">
        <div className="lms-filter-grid">
          <label>
            {t("Вид отчёта", "Есеп түрі")}
            <select
              aria-label={t("Вид отчёта", "Есеп түрі")}
              value={kind}
              onChange={(e) => choose(e.target.value as ReportKind)}
            >
              {kinds.map(([k, ru, kz]) => (
                <option key={k} value={k}>
                  {t(ru, kz)}
                </option>
              ))}
            </select>
          </label>
          <label>
            {kind === "ORGANIZATION_DIRECTORY"
              ? t("Поиск организации / БИН", "Ұйымды / БСН іздеу")
              : kind === "DOCUMENT_REGISTRY"
                ? t(
                    "Номер, слушатель или организация",
                    "Нөмір, тыңдаушы немесе ұйым",
                  )
                : t("Поиск слушателя", "Тыңдаушыны іздеу")}
            <input
              value={filters.search}
              maxLength={300}
              onChange={(e) => change("search", e.target.value)}
            />
          </label>
          {select(
            "courseVersionId",
            ["Программа / версия", "Бағдарлама / нұсқа"],
            options.courses,
          )}
          {select("customerId", ["Организация", "Ұйым"], options.customers)}
        </div>
        <details>
          <summary>
            {t(
              "Дата, БИН, город, преподаватель и состояние",
              "Күні, БСН, қала, оқытушы және күйі",
            )}
          </summary>
          <div className="lms-filter-grid">
            <label>
              {kind === "DOCUMENT_REGISTRY"
                ? t("Документ от", "Құжат күні бастап")
                : t("Назначено с", "Тағайындау басталуы")}
              <input
                type="date"
                value={isoToZonedInput(
                  filters.dateFrom,
                  context.tenant.timezone,
                ).slice(0, 10)}
                onChange={(e) =>
                  change(
                    "dateFrom",
                    e.target.value
                      ? zonedInputToIso(
                          `${e.target.value}T00:00:00`,
                          context.tenant.timezone,
                        )
                      : "",
                  )
                }
              />
            </label>
            <label>
              {kind === "DOCUMENT_REGISTRY"
                ? t("Документ до", "Құжат күні дейін")
                : t("Назначено до", "Тағайындау аяқталуы")}
              <input
                type="date"
                value={isoToZonedInput(
                  filters.dateTo,
                  context.tenant.timezone,
                ).slice(0, 10)}
                onChange={(e) =>
                  change(
                    "dateTo",
                    e.target.value
                      ? new Date(
                          new Date(
                            zonedInputToIso(
                              `${e.target.value}T23:59:59`,
                              context.tenant.timezone,
                            ),
                          ).getTime() + 999,
                        ).toISOString()
                      : "",
                  )
                }
              />
            </label>
            <label>
              {t("БИН организации", "Ұйым БСН")}
              <input
                value={filters.bin}
                inputMode="numeric"
                maxLength={12}
                onChange={(e) => change("bin", e.target.value)}
              />
            </label>
            <label>
              {t("Подтверждённый город", "Расталған қала")}
              <input
                list="lms-report-cities"
                value={filters.city}
                maxLength={200}
                onChange={(e) => change("city", e.target.value)}
              />
              <datalist id="lms-report-cities">
                {options.cities.map((city) => (
                  <option key={city} value={city} />
                ))}
              </datalist>
            </label>
            {select(
              "teacherUserId",
              [
                "Преподаватель по текущей учебной связи",
                "Ағымдағы оқу байланысындағы оқытушы",
              ],
              options.teachers,
            )}
            <label>
              {t(
                kind === "DOCUMENT_REGISTRY"
                  ? "Состояние документа"
                  : "Состояние назначения / текущего результата",
                kind === "DOCUMENT_REGISTRY"
                  ? "Құжаттың күйі"
                  : "Тағайындау / ағымдағы нәтиже күйі",
              )}
              <select
                aria-label={t(
                  kind === "DOCUMENT_REGISTRY"
                    ? "Состояние документа"
                    : "Состояние назначения / текущего результата",
                  kind === "DOCUMENT_REGISTRY"
                    ? "Құжаттың күйі"
                    : "Тағайындау / ағымдағы нәтиже күйі",
                )}
                value={filters.status}
                onChange={(e) => change("status", e.target.value)}
              >
                <option value="">{t("Все", "Барлығы")}</option>
                {(kind === "DOCUMENT_REGISTRY"
                  ? [
                      "VALID",
                      "EXPIRING",
                      "EXPIRED",
                      "UNKNOWN_VALIDITY",
                      "AWAITING_APPROVAL",
                      "AWAITING_SIGNATURE",
                      "VOIDED",
                      "SUPERSEDED",
                    ]
                  : [
                      "ACTIVE",
                      "COMPLETED",
                      "CANCELLED",
                      "PASSED",
                      "FAILED",
                      "VOIDED",
                      "SUPERSEDED",
                    ]
                ).map((v) => (
                  <option key={v} value={v}>
                    {t(...states[v])}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </details>
        {!readonly && (
          <div className="lms-toolbar">
            <label>
              {t("Формат", "Пішім")}
              <select
                aria-label={t("Формат", "Пішім")}
                value={format}
                onChange={(e) => setFormat(e.target.value)}
              >
                {["PDF", "XLSX", "CSV"].map((v) => (
                  <option key={v}>{v}</option>
                ))}
              </select>
            </label>
            <button
              className="primary"
              disabled={busy}
              onClick={() => void generate()}
            >
              {busy
                ? t("Подождите…", "Күтіңіз…")
                : t("Сформировать отчёт", "Есепті қалыптастыру")}
            </button>
            {snapshotView && (
              <button
                type="button"
                onClick={() => {
                  setSnapshotView(false);
                  setPage(1);
                }}
              >
                {t("Текущие данные", "Ағымдағы деректер")}
              </button>
            )}
          </div>
        )}
      </section>
      {job && (
        <section
          className="panel lms-panel"
          aria-label={t("Подготовка отчёта", "Есеп дайындау")}
        >
          <div className="lms-toolbar">
            <span role="status">
              {job.status === "READY"
                ? t("Отчёт готов", "Есеп дайын")
                : job.status === "FAILED"
                  ? t(
                      "Не удалось подготовить отчёт",
                      "Есепті дайындау мүмкін болмады",
                    )
                  : job.status === "CANCELLED"
                    ? t("Отчёт отменён", "Есеп тоқтатылды")
                    : job.status === "EXPIRED"
                      ? t("Срок хранения истёк", "Сақтау мерзімі аяқталды")
                      : t(
                          `Подготовка: ${job.progress || 0}%`,
                          `Дайындау: ${job.progress || 0}%`,
                        )}
            </span>
            {job.status === "READY" ? (
              <button
                className="primary"
                disabled={busy}
                onClick={() => {
                  setBusy(true);
                  void downloadReport(job.id!, job.fileName || "LMS-report")
                    .catch(setError)
                    .finally(() => setBusy(false));
                }}
              >
                {t("Скачать", "Жүктеу")}{" "}
              </button>
            ) : job.status === "FAILED" ? (
              <button disabled={busy} onClick={() => void act("retry")}>
                {t("Повторить подготовку", "Дайындауды қайталау")}
              </button>
            ) : ["PENDING", "RUNNING"].includes(job.status || "") ? (
              <button disabled={busy} onClick={() => void act("cancel")}>
                {t("Отменить", "Тоқтату")}
              </button>
            ) : null}
          </div>
        </section>
      )}
      {data && (
        <>
          <details className="panel lms-panel">
            <summary>
              {t(
                "Сводные показатели выбранных назначений",
                "Таңдалған тағайындаулардың жиынтық көрсеткіштері",
              )}
            </summary>
            <div className="lms-table-scroll">
              <table className="lms-table">
                <tbody>
                  {metrics.map(([key, ru, kz, target]) => (
                    <tr key={key}>
                      <th>{t(ru, kz)}</th>
                      <td>
                        {data.summary[key] ?? t("Неизвестно", "Белгісіз")}
                      </td>
                      <td>
                        <button
                          type="button"
                          className="text-button"
                          onClick={() => {
                            choose(target);
                            setMetric(key);
                          }}
                        >
                          {t("Состав", "Құрамы")}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="muted">
              {t(
                "Участники — разные люди; курсы — назначения; тесты — попытки, включая повторные. Выданные документы сохраняют историю отмены и замены. Неизвестный срок не считается бессрочным.",
                "Қатысушылар — бөлек адамдар; курстар — тағайындаулар; тесттер — қайталанғанын қоса талпыныстар. Берілген құжаттар күшін жою және ауыстыру тарихын сақтайды. Белгісіз мерзім шексіз болып саналмайды.",
              )}
            </p>
          </details>
          <section className="panel lms-panel" aria-busy={busy}>
            <h2>
              {t(
                kinds.find((k) => k[0] === kind)![1],
                kinds.find((k) => k[0] === kind)![2],
              )}{" "}
              · {data.total}
            </h2>
            {metric && (
              <p>
                {t(
                  metrics.find((m) => m[0] === metric)![1],
                  metrics.find((m) => m[0] === metric)![2],
                )}{" "}
                <button
                  type="button"
                  className="text-button"
                  onClick={() => setMetric(undefined)}
                >
                  {t("Весь отчёт", "Толық есеп")}
                </button>
              </p>
            )}
            <p className="muted">{data.definition}</p>
            <p className="muted">
              {snapshotView
                ? t("Сохранённый срез", "Сақталған кесінді")
                : t("Текущий срез", "Ағымдағы кесінді")}
              :{" "}
              {new Date(data.snapshotAt).toLocaleString(t("ru-KZ", "kk-KZ"), {
                timeZone: data.timezone,
              })}{" "}
              · {data.timezone}
            </p>
            <div
              className="lms-table-scroll"
              tabIndex={0}
              role="region"
              aria-label={t("Строки отчёта", "Есеп жолдары")}
            >
              <table className="lms-table lms-report-table">
                <thead>
                  <tr>
                    {data.columns.map((c) => (
                      <th key={c.field}>{c.title}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.items.map((r, i) => (
                    <tr key={r.sourceId || r.ordinal || i}>
                      {data.columns.map((c) => (
                        <td key={c.field}>
                          {c.field === "number" &&
                          r.payload.requestId &&
                          [
                            "SUPER_ADMIN",
                            "ADMIN",
                            "DIRECTOR",
                            "OPERATOR",
                            "VIEWER",
                          ].includes(context.user.role) ? (
                            <Link href={`/requests/${r.payload.requestId}`}>
                              {cell(c.field, r.payload[c.field])}
                            </Link>
                          ) : c.field === "name" &&
                            r.enrollmentId &&
                            !readonly ? (
                            <Link
                              href={`/lms/results?enrollmentId=${r.enrollmentId}`}
                            >
                              {cell(c.field, r.payload[c.field])}
                            </Link>
                          ) : (
                            cell(c.field, r.payload[c.field])
                          )}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!data.items.length && (
              <p className="lms-empty">
                {t(
                  "По этим фильтрам данных нет.",
                  "Осы сүзгілер бойынша деректер жоқ.",
                )}
              </p>
            )}
            <PageControls
              page={page}
              pageSize={data.pageSize}
              total={data.total}
              onPage={setPage}
              t={t}
            />
          </section>
        </>
      )}
      {!!history.length && (
        <details className="panel lms-panel">
          <summary>
            {t("Мои сохранённые отчёты", "Менің сақталған есептерім")}
          </summary>
          <ul>
            {history.map((h) => (
              <li key={h.id}>
                <button
                  type="button"
                  className="text-button"
                  onClick={() => {
                    void reportsApi
                      .status(h.id)
                      .then((v) => {
                        setJob(v);
                        setData(v);
                        setKind(v.kind);
                        setMetric(v.metric);
                        setFilters(savedReportFilters(v));
                        setPage(1);
                        setSnapshotView(true);
                      })
                      .catch(setError);
                  }}
                >
                  {t(
                    kinds.find((k) => k[0] === h.kind)![1],
                    kinds.find((k) => k[0] === h.kind)![2],
                  )}{" "}
                  · {h.format} · {h.totalRows} ·{" "}
                  {new Date(h.snapshotAt).toLocaleDateString(
                    t("ru-KZ", "kk-KZ"),
                  )}
                </button>
              </li>
            ))}
          </ul>
        </details>
      )}
    </>
  );
}
