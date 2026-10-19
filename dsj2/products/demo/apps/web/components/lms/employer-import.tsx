"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Notice } from "@demo/ui";
import { api, json, ApiError } from "@/lib/api";
import type { Course } from "@/lib/lms-api";
import { zonedInputToIso } from "@/lib/learning-time";
import { LmsHeading, PageControls, lmsError, type Translate } from "./common";
import { OperatorOrganization } from "./operator-organization";
import { LearnerAccess } from "./learner-access";

const fields = [
  "fullNameRu",
  "iin",
  "phone",
  "email",
  "positionRu",
  "course",
] as const;
type Row = {
  sourceRow: number;
  fullNameRu: string;
  iin: string;
  phone: string;
  email: string;
  positionRu: string;
  course: string;
  recipientId: string;
  resolution: "AUTO" | "REUSE" | "NEW" | "SKIP";
  sourceErrors: string[];
  preview?: {
    errors: string[];
    outcome: string;
    candidates: { id: string; fullNameRu: string; positionRu: string }[];
  };
  result?: {
    recipientId?: string | null;
    outcome: string;
    errorCode: string | null;
    assignmentOutcome?: string;
    assignmentError?: string | null;
  };
};
type Draft = {
  organizationNameRu: string;
  organizationNameKz: string;
  programmeTitleRu: string;
  programmeTitleKz: string;
  id: string;
  revision: number;
  state: string;
  rows: Row[];
  total: number;
  page: number;
  pageSize: number;
  errors: number;
  cursor: number;
  errorCode: string | null;
  canAssign: boolean;
  canEdit: boolean;
  failedRows: number;
  courseVersionId: string;
  customerId: string;
  sourceOrderId?: string | null;
  sourceRequestId?: string | null;
  repeatTraining: boolean;
  assignment: {
    id: string;
    cursor: number;
    state: string;
    groupId: string | null;
    created: number;
    reused: number;
    errorCount: number;
  } | null;
};
type Context = {
  timezone: string;
  customers: { id: string; nameRu: string; nameKz: string | null }[];
  courses: Course[];
  groups: { id: string; name: string; courseVersionId: string }[];
  customerId?: string;
  courseVersionId?: string;
  sourceOrderId?: string;
  sourceRequestId?: string;
  canAssign: boolean;
  canManagePeople: boolean;
  canPrepare: boolean;
};
type FilePreview = {
  headers: string[];
  rawRows: { rowNumber: number; values: string[]; errors?: string[] }[];
  mapping: Record<string, string>;
  sheets: string[];
  sheet: string;
};
const emptyRow = (): Row => ({
  sourceRow: 1,
  fullNameRu: "",
  iin: "",
  phone: "",
  email: "",
  positionRu: "",
  course: "",
  recipientId: "",
  resolution: "AUTO",
  sourceErrors: [],
});
function cleanRow(row: Row) {
  const { preview: _, result: __, ...value } = row;
  return value;
}
function errorText(code: string, t: Translate) {
  const messages: Record<string, [string, string]> = {
    NAME_REQUIRED: ["Укажите ФИО", "Аты-жөнін көрсетіңіз"],
    IIN_INVALID: ["ИИН должен содержать 12 цифр", "ЖСН 12 саннан тұруы керек"],
    EMAIL_INVALID: ["Проверьте e-mail", "E-mail тексеріңіз"],
    UNSAFE_CELL: [
      "Замените формулу обычным текстом",
      "Формуланы мәтінмен ауыстырыңыз",
    ],
    FORMULA_NOT_ALLOWED: [
      "Формула не принимается. Введите значение",
      "Формула қабылданбайды. Мәнін енгізіңіз",
    ],
    COURSE_MISMATCH: [
      "Курс не совпадает с выбранной программой",
      "Курс таңдалған бағдарламаға сәйкес емес",
    ],
    DUPLICATE_ROW: [
      "Повтор строки: исключите лишнюю",
      "Қайталанған жолды алып тастаңыз",
    ],
    MATCH_REQUIRED: [
      "Выберите сотрудника или подтвердите нового",
      "Қызметкерді таңдаңыз немесе жаңасын растаңыз",
    ],
    RECIPIENT_UNAVAILABLE: ["Сотрудник недоступен", "Қызметкер қолжетімсіз"],
    NEW_RECIPIENT_DENIED: [
      "Добавление нового сотрудника доступно центру",
      "Жаңа қызметкерді орталық қоса алады",
    ],
    CENTER_IDENTITY_REVIEW: [
      "Связь сотрудника должен подтвердить центр",
      "Қызметкер байланысын орталық растауы керек",
    ],
    IMPORT_AUTHORITY_REVOKED: [
      "Право назначения отозвано. Обратитесь в центр",
      "Тағайындау құқығы қайтарылды. Орталыққа хабарласыңыз",
    ],
    COURSE_ASSIGNMENT_PAUSED: [
      "Набор на программу приостановлен",
      "Бағдарламаға қабылдау тоқтатылды",
    ],
    IMPORT_RETRY_REQUIRED: [
      "Обработка прервана. Можно продолжить",
      "Өңдеу үзілді. Жалғастыруға болады",
    ],
  };
  return messages[code]
    ? t(...messages[code])
    : t(
        "Проверьте строку или обратитесь в центр",
        "Жолды тексеріңіз немесе орталыққа хабарласыңыз",
      );
}
function stateText(state: string, t: Translate) {
  const values: Record<string, [string, string]> = {
    DRAFT: ["Проверка списка", "Тізімді тексеру"],
    SUBMITTED: ["Список передан центру", "Тізім орталыққа жіберілді"],
    QUEUED: ["Список принят в обработку", "Тізім өңдеуге қабылданды"],
    PROCESSING: ["Подготовка сотрудников", "Қызметкерлерді дайындау"],
    ASSIGNING: ["Назначение обучения", "Оқуды тағайындау"],
    COMPLETED: ["Обработка завершена", "Өңдеу аяқталды"],
    PAUSED: ["Нужна проверка", "Тексеру қажет"],
    FAILED: ["Обработка прервана", "Өңдеу үзілді"],
    CANCELLED: ["Оставшаяся обработка отменена", "Қалған өңдеу тоқтатылды"],
  };
  return values[state]
    ? t(...values[state])
    : t("Проверьте состояние", "Күйін тексеріңіз");
}

export function EmployerImport({ t, scope }: { t: Translate; scope: string }) {
  const [context, setContext] = useState<Context | null>(null),
    [draft, setDraft] = useState<Draft | null>(null);
  const [customerId, setCustomerId] = useState(""),
    [versionId, setVersionId] = useState(""),
    [groupId, setGroupId] = useState(""),
    [groupName, setGroupName] = useState(""),
    [dueAt, setDueAt] = useState("");
  const [mode, setMode] = useState("manual"),
    [manual, setManual] = useState<Row>(emptyRow),
    [bulk, setBulk] = useState("");
  const [manualRows, setManualRows] = useState<Row[]>([]);
  const [showCompletedRows, setShowCompletedRows] = useState(false);
  const [file, setFile] = useState<FilePreview | null>(null),
    [mapping, setMapping] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false),
    [error, setError] = useState<unknown>(null),
    [saveState, setSaveState] = useState(""),
    [repeatTraining, setRepeatTraining] = useState(false);
  const [recent, setRecent] = useState<{ id: string; state: string }[]>([]);
  const [conflict, setConflict] = useState<Draft | null>(null);
  const uploadedFile = useRef<File | null>(null);
  const draftRef = useRef<Draft | null>(null),
    revision = useRef(0),
    pending = useRef<Row[] | null>(null),
    saveChain = useRef<Promise<void>>(Promise.resolve()),
    timer = useRef<ReturnType<typeof setTimeout> | null>(null),
    createId = useRef("");
  const labels: Record<string, string> = {
    fullNameRu: t("ФИО", "Аты-жөні"),
    iin: t("ИИН", "ЖСН"),
    phone: t("Телефон", "Телефон"),
    email: "E-mail",
    positionRu: t("Должность", "Лауазым"),
    course: t("Курс", "Курс"),
  };
  function accept(value: Draft) {
    window.history.replaceState(null, "", `/lms/import?id=${value.id}`);
    draftRef.current = value;
    revision.current = value.revision;
    setDraft(value);
    setRepeatTraining(value.repeatTraining);
  }
  async function load(id: string, page = 1) {
    const value = await api<Draft>(`/lms/employer-import/${id}?page=${page}`);
    accept(value);
  }
  useEffect(() => {
    let alive = true;
    const query = new URLSearchParams(window.location.search);
    const params = new URLSearchParams();
    for (const key of ["customerId", "orderId", "requestId", "versionId"])
      if (query.get(key)) params.set(key, query.get(key)!);
    for (const [key, alias] of [["orderId", "sourceOrderId"], ["requestId", "sourceRequestId"], ["versionId", "courseVersionId"]])
      if (!params.has(key) && query.get(alias)) params.set(key, query.get(alias)!);
    void Promise.all([
      api<Context>(`/lms/employer-import/context?${params}`),
      api<{ id: string; state: string }[]>("/lms/employer-import"),
    ])
      .then(([value, list]) => {
        if (!alive) return;
        setContext(value);
        setRecent(list);
        setCustomerId(value.customerId || "");
        setVersionId(
          value.courseVersionId ||
            (value.courses.filter(
              (course) => course.latestVersion?.status === "PUBLISHED",
            ).length === 1 &&
              value.courses.find(
                (course) => course.latestVersion?.status === "PUBLISHED",
              )?.latestVersion?.id) ||
            "",
        );
      })
      .catch(setError);
    if (query.get("id")) void load(query.get("id")!).catch(setError);
    try {
      const saved = JSON.parse(
        sessionStorage.getItem(`demo:lms:import-input:${scope}`) || "null",
      );
      if (saved) {
        setBulk(saved.bulk || "");
        setManual(saved.manual || emptyRow());
        setManualRows(saved.manualRows || []);
        setMode(saved.mode || "manual");
      }
    } catch {
      /* optional draft input recovery */
    }
    return () => {
      alive = false;
    };
  }, [scope]);
  useEffect(() => {
    try {
      sessionStorage.setItem(
        `demo:lms:import-input:${scope}`,
        JSON.stringify({ bulk, manual, manualRows, mode }),
      );
    } catch {
      /* server draft remains authoritative */
    }
  }, [bulk, manual, manualRows, mode, scope]);
  useEffect(() => {
    if (!draft || !["QUEUED", "PROCESSING", "ASSIGNING"].includes(draft.state))
      return;
    const poll = setInterval(
      () => void load(draft.id, draft.page).catch(setError),
      1500,
    );
    return () => clearInterval(poll);
  }, [draft?.id, draft?.state, draft?.page]);
  function flush() {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    const rows = pending.current;
    pending.current = null;
    if (!rows || !draftRef.current) return saveChain.current;
    const id = draftRef.current.id;
    setSaveState("saving");
    saveChain.current = saveChain.current
      .then(async () => {
        const saved = await api<{ revision: number }>(
          `/lms/employer-import/${id}`,
          {
            method: "PUT",
            body: json({
              revision: revision.current,
              rows: rows.map(cleanRow),
            }),
          },
        );
        revision.current = saved.revision;
        if (draftRef.current)
          draftRef.current = { ...draftRef.current, revision: saved.revision };
        setSaveState(pending.current ? "saving" : "saved");
        setError(null);
        if (!pending.current && draftRef.current) {
          const refreshed = await api<Draft>(
            `/lms/employer-import/${id}?page=${draftRef.current.page}`,
          );
          if (!pending.current) accept(refreshed);
        }
      })
      .catch(async (caught) => {
        pending.current ||= rows;
        setSaveState("error");
        setError(caught);
        if (caught instanceof ApiError && caught.status === 409)
          setConflict(
            await api<Draft>(
              `/lms/employer-import/${id}?page=${draftRef.current?.page || 1}`,
            ).catch(() => null),
          );
        throw caught;
      });
    return saveChain.current;
  }
  function edit(sourceRow: number, patch: Partial<Row>) {
    if (!draft) return;
    const next = {
      ...draft,
      rows: draft.rows.map((row) =>
        row.sourceRow === sourceRow
          ? { ...row, ...patch, sourceErrors: [] }
          : row,
      ),
    };
    draftRef.current = next;
    setDraft(next);
    const changed = next.rows.find((row) => row.sourceRow === sourceRow)!;
    pending.current = [
      ...new Map(
        [...(pending.current || []), changed].map((row) => [
          row.sourceRow,
          row,
        ]),
      ).values(),
    ];
    setSaveState("saving");
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void flush().catch(() => {}), 700);
  }
  async function upload(uploaded: File, sheet?: string) {
    uploadedFile.current = uploaded;
    createId.current = "";
    setBusy(true);
    setError(null);
    try {
      const body = new FormData();
      body.set("file", uploaded);
      if (sheet) body.set("sheet", sheet);
      const parsed = await api<FilePreview>("/lms/employer-import/file", {
        method: "POST",
        body,
      });
      setFile(parsed);
      setMapping(parsed.mapping);
    } catch (caught) {
      setError(caught);
    } finally {
      setBusy(false);
    }
  }
  async function preview() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const rows =
        mode === "manual"
          ? [...manualRows, ...(manual.fullNameRu.trim() ? [manual] : [])].map((row, index) => ({ ...row, sourceRow: index + 1 }))
          : mode === "bulk"
            ? bulk
                .split(/\r?\n/)
                .filter(Boolean)
                .map((line, index) => {
                  const values = line.split("\t");
                  return {
                    ...emptyRow(),
                    sourceRow: index + 1,
                    ...Object.fromEntries(
                      fields.map((field, i) => [field, values[i] || ""]),
                    ),
                  };
                })
            : file?.rawRows.map((raw) => ({
                ...emptyRow(),
                sourceRow: raw.rowNumber,
                sourceErrors: raw.errors || [],
                ...Object.fromEntries(
                  fields.map((field) => [
                    field,
                    raw.values[file.headers.indexOf(mapping[field] || "")] ||
                      "",
                  ]),
                ),
              })) || [];
      createId.current ||= crypto.randomUUID();
      const value = await api<Draft>("/lms/employer-import", {
        method: "POST",
        body: json({
          id: createId.current,
          customerId,
          courseVersionId: versionId,
          rows,
          mapping,
          groupId: groupId || undefined,
          groupName,
          dueAt: dueAt
            ? zonedInputToIso(dueAt, context?.timezone || "UTC")
            : undefined,
          sourceOrderId: context?.sourceOrderId,
          sourceRequestId: context?.sourceRequestId,
          repeatTraining,
        }),
      });
      accept(value);
      window.history.replaceState(null, "", `/lms/import?id=${value.id}`);
    } catch (caught) {
      setError(caught);
    } finally {
      setBusy(false);
    }
  }
  async function confirm() {
    if (!draft || busy) return;
    setBusy(true);
    try {
      await flush();
      const value = await api<Draft>(
        `/lms/employer-import/${draft.id}/confirm`,
        { method: "POST", body: json({ revision: revision.current }) },
      );
      accept(value);
      setError(null);
    } catch (caught) {
      setError(caught);
      if (!pending.current) await load(draft.id, draft.page).catch(() => {});
    } finally {
      setBusy(false);
    }
  }
  async function action(value: "CANCEL" | "RESUME" | "REPAIR") {
    if (!draft) return;
    setBusy(true);
    try {
      accept(
        await api<Draft>(`/lms/employer-import/${draft.id}/action`, {
          method: "POST",
          body: json({ action: value }),
        }),
      );
      setError(null);
    } catch (caught) {
      setError(caught);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <LmsHeading title={t("Сотрудники и обучение", "Қызметкерлер және оқу")} />
      {!!error && (
        <Notice>
          <span role="alert">{lmsError(error, t)}</span>
          {conflict && (
            <details>
              <summary>
                {t("Текущие сохранённые строки", "Ағымдағы сақталған жолдар")}
              </summary>
              <ul>
                {conflict.rows
                  .filter((row) =>
                    pending.current?.some(
                      (edit) => edit.sourceRow === row.sourceRow,
                    ),
                  )
                  .map((row) => (
                    <li key={row.sourceRow}>
                      {row.sourceRow}: {row.fullNameRu} · {row.positionRu}
                    </li>
                  ))}
              </ul>
            </details>
          )}
          <button
            onClick={() => {
              saveChain.current = Promise.resolve();
              if (conflict) {
                revision.current = conflict.revision;
                setConflict(null);
              }
              void (
                pending.current
                  ? flush()
                  : draft
                    ? load(draft.id, draft.page)
                    : Promise.resolve()
              ).catch(setError);
            }}
          >
            {conflict
              ? t("Сохранить исправленные строки", "Түзетілген жолдарды сақтау")
              : t("Повторить", "Қайталау")}
          </button>
        </Notice>
      )}
      {!draft ? (
        <section className="panel lms-panel">
          {context && !context.canPrepare && <p role="status">{t("Доступен просмотр. Подготовить и назначить список может центр или представитель с правом назначения обучения.", "Қарау қолжетімді. Тізімді орталық немесе оқуды тағайындау құқығы бар өкіл дайындай алады.")}</p>}
          {context?.sourceOrderId && <p><Link href={`/workbench?orderId=${context.sourceOrderId}`}>{t("Вернуться к заказу", "Тапсырысқа оралу")}</Link></p>}
          {context?.canManagePeople && !context.sourceOrderId && <OperatorOrganization value={customerId} t={t} disabled={busy} onChange={(customer) => { setCustomerId(customer?.id || ""); createId.current = ""; }} />}
          <div className="lms-toolbar">
            {(!context?.canManagePeople || context.sourceOrderId) &&
            <label>
              {t("Организация", "Ұйым")}
              <select
                value={customerId}
                disabled={busy || !!context?.sourceOrderId}
                onChange={(event) => {
                  setCustomerId(event.target.value);
                  createId.current = "";
                }}
              >
                <option value="">
                  {t("Выберите организацию", "Ұйымды таңдаңыз")}
                </option>
                {context?.customers.map((customer) => (
                  <option key={customer.id} value={customer.id}>
                    {t(customer.nameRu, customer.nameKz || customer.nameRu)}
                  </option>
                ))}
              </select>
            </label>}
            <label>
              {t("Программа", "Бағдарлама")}
              <select
                value={versionId}
                disabled={busy || !!context?.sourceOrderId}
                onChange={(event) => {
                  setVersionId(event.target.value);
                  createId.current = "";
                }}
              >
                <option value="">
                  {t("Выберите программу", "Бағдарламаны таңдаңыз")}
                </option>
                {context?.courses.map(
                  (course) =>
                    course.latestVersion?.status === "PUBLISHED" && (
                      <option key={course.id} value={course.latestVersion.id}>
                        {t(
                          course.latestVersion.content.titleRu,
                          course.latestVersion.content.titleKz,
                        )}
                      </option>
                    ),
                )}
              </select>
            </label>
          </div>
          {context && !context.courses.some((course) => course.latestVersion?.status === "PUBLISHED") && <p>{t("Нужна опубликованная программа. Её готовит методист или директор.", "Жарияланған бағдарлама қажет. Оны әдіскер немесе директор дайындайды.")} <Link href="/lms">{t("Открыть программы", "Бағдарламаларды ашу")}</Link></p>}
          <label>
            {t("Добавление сотрудников", "Қызметкерлерді қосу")}
            <select
              aria-label={t("Добавление сотрудников", "Қызметкерлерді қосу")}
              value={mode}
              onChange={(event) => {
                setMode(event.target.value);
                createId.current = "";
              }}
            >
              <option value="manual">{t("Вручную", "Қолмен")}</option>
              <option value="file">Excel / CSV / TSV</option>
              <option value="bulk">
                {t("Вставить список", "Тізімді қою")}
              </option>
            </select>
          </label>
          {mode === "manual" ? (
            <>
            <div className="lms-toolbar">
              {fields
                .filter((field) => field !== "course")
                .map((field) => (
                  <label key={field}>
                    {labels[field]}
                    <input
                      type={
                        field === "email"
                          ? "email"
                          : field === "phone"
                            ? "tel"
                            : "text"
                      }
                      value={manual[field]}
                      onChange={(event) => {
                        setManual((old) => ({
                          ...old,
                          [field]: event.target.value,
                        }));
                        createId.current = "";
                      }}
                    />
                  </label>
                ))}
            </div>
            <button type="button" disabled={busy || !manual.fullNameRu.trim() || manualRows.length >= 4999 || !context?.canPrepare} onClick={() => { setManualRows((rows) => [...rows, { ...manual, sourceRow: rows.length + 1 }]); setManual(emptyRow()); createId.current = ""; }}>{t("Добавить строку", "Жол қосу")}</button>
            {!!manualRows.length && <div className="lms-table-scroll"><table className="lms-table"><thead><tr>{fields.filter((field) => field !== "course").map((field) => <th key={field}>{labels[field]}</th>)}<th>{t("Состав", "Құрамы")}</th></tr></thead><tbody>{manualRows.map((row, index) => <tr key={row.sourceRow}>{fields.filter((field) => field !== "course").map((field) => <td key={field}><input aria-label={`${labels[field]} ${index + 1}`} value={row[field]} onChange={(event) => { setManualRows((rows) => rows.map((value, rowIndex) => rowIndex === index ? { ...value, [field]: event.target.value } : value)); createId.current = ""; }} /></td>)}<td><button type="button" onClick={() => { setManualRows((rows) => rows.filter((_, rowIndex) => rowIndex !== index).map((value, rowIndex) => ({ ...value, sourceRow: rowIndex + 1 }))); createId.current = ""; }}>{t("Убрать", "Алып тастау")}</button></td></tr>)}</tbody></table></div>}
            </>
          ) : mode === "bulk" ? (
            <label>
              {t(
                "ФИО · ИИН · телефон · e-mail · должность · курс (колонки разделены Tab)",
                "Аты-жөні · ЖСН · телефон · e-mail · лауазым · курс (бағандар Tab арқылы)",
              )}
              <textarea
                rows={8}
                value={bulk}
                onChange={(event) => {
                  setBulk(event.target.value);
                  createId.current = "";
                }}
              />
            </label>
          ) : (
            <>
              <label>
                {t("Файл сотрудников", "Қызметкерлер файлы")}
                <input
                  type="file"
                  accept=".xlsx,.csv,.tsv"
                  disabled={busy}
                  onChange={(event) => {
                    const value = event.target.files?.[0];
                    if (value) void upload(value);
                  }}
                />
              </label>
              {file && file.sheets.length > 1 && (
                <label>
                  {t("Лист", "Парақ")}
                  <select
                    value={file.sheet}
                    disabled={busy}
                    onChange={(event) => {
                      if (uploadedFile.current)
                        void upload(uploadedFile.current, event.target.value);
                    }}
                  >
                    {file.sheets.map((sheet) => (
                      <option key={sheet} value={sheet}>
                        {sheet}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              {file && (
                <div className="lms-toolbar">
                  {fields.map((field) => (
                    <label key={field}>
                      {labels[field]}
                      <select
                        value={mapping[field] || ""}
                        onChange={(event) => {
                          setMapping((old) => ({
                            ...old,
                            [field]: event.target.value,
                          }));
                          createId.current = "";
                        }}
                      >
                        <option value="">
                          {t("Нет колонки", "Баған жоқ")}
                        </option>
                        {file.headers.map((header, index) => (
                          <option key={index} value={header}>
                            {header}
                          </option>
                        ))}
                      </select>
                    </label>
                  ))}
                </div>
              )}
            </>
          )}
          <details>
            <summary>{t("Группа и сроки", "Топ және мерзімдер")}</summary>
            <div className="lms-toolbar">
              <label>
                {t("Группа", "Топ")}
                <select
                  value={groupId}
                  onChange={(event) => setGroupId(event.target.value)}
                >
                  <option value="">
                    {t("Автоматически по списку", "Тізім бойынша автоматты түрде")}
                  </option>
                  {context?.groups
                    .filter((group) => group.courseVersionId === versionId)
                    .map((group) => (
                      <option key={group.id} value={group.id}>
                        {group.name}
                      </option>
                    ))}
                </select>
              </label>
              {!groupId && <p className="muted">{t("Один сотрудник — индивидуальное назначение. Несколько сотрудников — новая группа.", "Бір қызметкерге оқу жеке тағайындалады. Бірнеше қызметкерге жаңа топ құрылады.")}</p>}
              {!groupId && (
                <label>
                  {t("Название группы", "Топ атауы")}
                  <input
                    value={groupName}
                    onChange={(event) => {
                      setGroupName(event.target.value);
                      createId.current = "";
                    }}
                  />
                </label>
              )}
              <label>
                {t(
                  "Доступ до (необязательно)",
                  "Қолжетімділік мерзімі (міндетті емес)",
                )}
                <input
                  type="datetime-local"
                  value={dueAt}
                  onChange={(event) => {
                    setDueAt(event.target.value);
                    createId.current = "";
                  }}
                />
              </label>
              <label className="lms-inline-label">
                <input
                  type="checkbox"
                  checked={repeatTraining}
                  onChange={(event) => {
                    setRepeatTraining(event.target.checked);
                    createId.current = "";
                  }}
                />
                {t(
                  "Новое повторное обучение с отдельной историей",
                  "Жеке тарихы бар қайта оқу",
                )}
              </label>
            </div>
          </details>
          <button
            className="primary lms-primary"
            disabled={
              busy || !context?.canPrepare || !versionId || !customerId || (mode === "file" && !file) || (mode === "manual" && !manualRows.length && !manual.fullNameRu.trim()) || (mode === "bulk" && !bulk.trim())
            }
            onClick={() => void preview()}
          >
            {busy
              ? t("Подождите…", "Күтіңіз…")
              : t("Подготовить состав", "Құрамды дайындау")}
          </button>
          <Link className="button" href={`/lms/assign?${new URLSearchParams({ ...(customerId ? { customerId } : {}), ...(versionId ? { versionId } : {}), ...(context?.sourceOrderId ? { orderId: context.sourceOrderId } : {}), ...(context?.sourceRequestId ? { requestId: context.sourceRequestId } : {}) })}`}>
            {t(
              "Выбрать известных сотрудников",
              "Белгілі қызметкерлерді таңдау",
            )}
          </Link>
          {!!recent.length && (
            <details>
              <summary>{t("Сохранённые списки", "Сақталған тізімдер")}</summary>
              <ul>
                {recent.map((entry) => (
                  <li key={entry.id}>
                    <Link href={`/lms/import?id=${entry.id}`}>
                      {stateText(entry.state, t)}
                    </Link>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </section>
      ) : (
        <section className="panel lms-panel">
          <p><strong>{t(draft.organizationNameRu, draft.organizationNameKz)}</strong> · {t(draft.programmeTitleRu, draft.programmeTitleKz)}</p>
          <div className="lms-toolbar">
            <p role="status">
              {stateText(draft.state, t)} · {draft.total}
              {saveState === "saving"
                ? ` · ${t("Сохраняется…", "Сақталуда…")}`
                : saveState === "saved"
                  ? ` · ${t("Сохранено", "Сақталды")}`
                  : ""}
            </p>
            {draft.canAssign && ["DRAFT", "SUBMITTED"].includes(draft.state) && (
              <button
                className="primary lms-primary"
                disabled={
                  busy ||
                  saveState === "error" ||
                  (draft.state === "SUBMITTED" && !draft.canAssign)
                }
                onClick={() => void confirm()}
              >
                {draft.canAssign
                  ? t("Подтвердить и назначить", "Растау және тағайындау")
                  : t("Отправить список центру", "Тізімді орталыққа жіберу")}
              </button>
            )}
            {draft.canAssign && ["PAUSED", "FAILED"].includes(draft.state) && (
              <button
                className="primary lms-primary"
                disabled={busy}
                onClick={() => void action("RESUME")}
              >
                {t("Продолжить обработку", "Өңдеуді жалғастыру")}
              </button>
            )}
          </div>
          {draft.errorCode && <Notice>{errorText(draft.errorCode, t)}</Notice>}
          {draft.errors > 0 && (
            <p role="status">
              {t("Нужна проверка строк", "Тексеруді қажет ететін жолдар")}:{" "}
              {draft.errors}
            </p>
          )}
          {["QUEUED", "PROCESSING", "ASSIGNING"].includes(draft.state) && (
            <div>
              <progress
                max={draft.total}
                value={draft.assignment?.cursor || draft.cursor}
              />
              <p>
                {t("Обработано", "Өңделді")}:{" "}
                {draft.assignment?.cursor || draft.cursor}/{draft.total}
              </p>
              <button onClick={() => void action("CANCEL")} disabled={busy || !draft.canAssign}>
                {t("Остановить оставшиеся", "Қалғанын тоқтату")}
              </button>
            </div>
          )}
          {draft.state === "COMPLETED" && <button onClick={() => setShowCompletedRows((shown) => !shown)}>{showCompletedRows ? t("К доступу слушателей", "Тыңдаушылар қолжетімділігіне") : t("Показать обработанные строки", "Өңделген жолдарды көрсету")}</button>}
          {(draft.state !== "COMPLETED" || showCompletedRows) && <div
            className="lms-table-scroll"
            tabIndex={0}
            role="region"
            aria-label={t("Проверка сотрудников", "Қызметкерлерді тексеру")}
          >
            <table className="lms-table">
              <thead>
                <tr>
                  <th>№</th>
                  {fields
                    .filter((field) => field !== "course")
                    .map((field) => (
                      <th key={field}>{labels[field]}</th>
                    ))}
                  <th>{t("Сопоставление", "Сәйкестендіру")}</th>
                </tr>
              </thead>
              <tbody>
                {draft.rows.map((row) => (
                  <tr key={row.sourceRow}>
                    <td>{row.sourceRow}</td>
                    {fields
                      .filter((field) => field !== "course")
                      .map((field) => (
                        <td key={field}>
                          {draft.canEdit ? (
                            <input
                              aria-label={`${labels[field]} · ${row.sourceRow}`}
                              type={
                                field === "email"
                                  ? "email"
                                  : field === "phone"
                                    ? "tel"
                                    : "text"
                              }
                              value={row[field]}
                              onChange={(event) =>
                                edit(row.sourceRow, {
                                  [field]: event.target.value,
                                })
                              }
                            />
                          ) : (
                            row[field] || "—"
                          )}
                        </td>
                      ))}
                    <td>
                      {row.preview?.errors.map((code) => (
                        <p className="lms-error" key={code}>
                          {errorText(code, t)}
                        </p>
                      ))}
                      {draft.canEdit ? (
                        <select
                          aria-label={`${t("Сопоставление", "Сәйкестендіру")} · ${row.sourceRow}`}
                          value={
                            row.resolution === "REUSE"
                              ? row.recipientId
                              : row.resolution
                          }
                          onChange={(event) =>
                            edit(
                              row.sourceRow,
                              ["AUTO", "NEW", "SKIP"].includes(
                                event.target.value,
                              )
                                ? {
                                    resolution: event.target
                                      .value as Row["resolution"],
                                    recipientId: "",
                                  }
                                : {
                                    resolution: "REUSE",
                                    recipientId: event.target.value,
                                  },
                            )
                          }
                        >
                          <option value="AUTO">
                            {t("Проверить совпадение", "Сәйкестікті тексеру")}
                          </option>
                          {row.preview?.candidates.map((candidate) => (
                            <option key={candidate.id} value={candidate.id}>
                              {candidate.fullNameRu} · {candidate.positionRu}
                            </option>
                          ))}
                          <option value="NEW">
                            {t("Это новый сотрудник", "Бұл жаңа қызметкер")}
                          </option>
                          <option value="SKIP">
                            {t("Исключить строку", "Жолды алып тастау")}
                          </option>
                        </select>
                      ) : row.result?.assignmentOutcome === "CONFLICT" ? (
                        t(
                          "Уже назначено в другой группе или заявке",
                          "Басқа топта немесе өтінімде тағайындалған",
                        )
                      ) : row.result?.assignmentError ? (
                        errorText(row.result.assignmentError, t)
                      ) : row.result?.assignmentOutcome === "CREATED" ? (
                        t("Назначено", "Тағайындалды")
                      ) : row.result?.assignmentOutcome === "REUSED" ? (
                        t("Ранее назначено", "Бұрын тағайындалған")
                      ) : row.result?.errorCode ? (
                        errorText(row.result.errorCode, t)
                      ) : row.result?.outcome === "SKIPPED" ? (
                        t("Исключено", "Алып тасталды")
                      ) : row.result ? (
                        t("Сотрудник подготовлен", "Қызметкер дайындалды")
                      ) : (
                        "—"
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          }
          <PageControls
            page={draft.page}
            total={draft.total}
            pageSize={draft.pageSize}
            onPage={(page) =>
              void flush()
                .then(() => load(draft.id, page))
                .catch(setError)
            }
            t={t}
          />
          {draft.assignment?.groupId && (
            <Link
              className="button"
              href={`/lms/groups/${draft.assignment.groupId}`}
            >
              {t("Открыть группу и результаты", "Топты және нәтижелерді ашу")}
            </Link>
          )}
          {context?.canManagePeople && draft.state === "COMPLETED" && !showCompletedRows && <LearnerAccess recipientIds={draft.rows.flatMap((row) => row.result?.recipientId && ["CREATED", "REUSED"].includes(row.result.assignmentOutcome || "") ? [row.result.recipientId] : [])} customerId={draft.customerId} t={t} />}
          {draft.sourceOrderId && <p><Link href={`/workbench?orderId=${draft.sourceOrderId}`}>{t("Исходный заказ", "Бастапқы тапсырыс")}</Link></p>}
          {["COMPLETED", "CANCELLED"].includes(draft.state) && (
            <div>
              <p role="status">
                {t("Назначено", "Тағайындалды")}:{" "}
                {draft.assignment?.created || 0} ·{" "}
                {t("Ранее назначено", "Бұрын тағайындалған")}:{" "}
                {draft.assignment?.reused || 0} ·{" "}
                {t("Не выполнено", "Орындалмады")}:{" "}
                {draft.failedRows + (draft.assignment?.errorCount || 0)}
              </p>
              {(draft.failedRows > 0 ||
                (draft.assignment?.errorCount || 0) > 0) && (
                <button
                  className="button"
                  disabled={busy || !draft.canAssign}
                  onClick={() => void action("REPAIR")}
                >
                  {t(
                    "Исправить невыполненные строки",
                    "Орындалмаған жолдарды түзету",
                  )}
                </button>
              )}
              <p>
                <Link href={`/lms/import?${new URLSearchParams({ customerId: draft.customerId, versionId: draft.courseVersionId, ...(draft.sourceOrderId ? { orderId: draft.sourceOrderId } : {}), ...(draft.sourceRequestId ? { requestId: draft.sourceRequestId } : {}) })}`}>
                  {t("Добавить другой список", "Басқа тізім қосу")}
                </Link>
              </p>
            </div>
          )}
        </section>
      )}
    </>
  );
}
