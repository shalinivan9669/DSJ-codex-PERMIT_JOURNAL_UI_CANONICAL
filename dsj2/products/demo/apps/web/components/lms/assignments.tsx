"use client";
import { useEffect, useRef, useState } from "react";
import { Notice } from "@demo/ui";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { api, ApiError, json } from "@/lib/api";
import {
  assignmentOutcomeUnknown,
  publishedAssignmentVersion,
  readAssignmentDraft,
  type AssignmentDraft,
} from "@/lib/lms-assignment";
import type { Customer, Recipient } from "@/lib/types";
import { lms, type Course, type LearnerSummary } from "@/lib/lms-api";
import { LearnerAccess } from "./learner-access";
import { OperatorPerson } from "./operator-person";
import { OperatorOrganization } from "./operator-organization";
import { AccessPolicyEditor } from "./access-policy-editor";
import type { AccessPolicy } from "@demo/contracts/src/lms";
import {
  LmsHeading,
  PageControls,
  lmsError,
  LmsErrorDiagnostic,
  type Translate,
} from "./common";

export function Assignments({
  t,
  scope,
  canRepair = false,
}: {
  t: Translate;
  scope: string;
  canRepair?: boolean;
}) {
  const [recipients, setRecipients] = useState<LearnerSummary[]>([]);
  const [courses, setCourses] = useState<Course[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [versionId, setVersionId] = useState("");
  const [customerId, setCustomerId] = useState<string | undefined>();
  const [source, setSource] = useState<{
    title?: string | null;
    applicationId?: string | null;
    courseVersionId?: string | null;
  }>({});
  const [addingPerson, setAddingPerson] = useState(false);
  const [assignedIds, setAssignedIds] = useState<string[]>([]);
  const [resuming, setResuming] = useState(false);
  const [customAccess, setCustomAccess] = useState(false);
  const [accessPolicy, setAccessPolicy] = useState<AccessPolicy>({
    mode: "DAYS",
    days: 90,
    timezone: "Asia/Qyzylorda",
  });
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1),
    [total, setTotal] = useState(0);
  const [error, setError] = useState<{
    cause: unknown;
    action: "assign" | "selection" | "employment";
    recipientId?: string;
  } | null>(null);
  const [contextError, setContextError] = useState<unknown>(null);
  const deploymentBlocked = contextError instanceof ApiError &&
    !!contextError.details && typeof contextError.details === "object" &&
    "code" in contextError.details && contextError.details.code === "LMS_DEPLOYMENT_REVIEW_REQUIRED";
  const [loadingContext, setLoadingContext] = useState(true);
  const [contextReady, setContextReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Awaited<
    ReturnType<typeof lms.assign>
  > | null>(null);
  const [refresh, setRefresh] = useState(0);
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [repairing, setRepairing] = useState("");
  const [origin, setOrigin] = useState<{
    sourceRequestId?: string | null;
    sourceOrderId?: string | null;
    groupId?: string;
    dueAt?: string;
  }>({});
  const [groupName, setGroupName] = useState("");
  const [selectingAll, setSelectingAll] = useState(false);
  const queryString = useSearchParams().toString();
  const sourceQuery = new URLSearchParams(queryString);
  const currentDraftScope = `${scope}:${sourceQuery.get("requestId") || sourceQuery.get("sourceRequestId") || ""}:${sourceQuery.get("orderId") || sourceQuery.get("sourceOrderId") || ""}:${sourceQuery.get("groupId") || ""}:${sourceQuery.get("customerId") || ""}`;
  const operation = useRef<{
    fingerprint: string;
    operationId: string;
    state: string;
  } | null>(null);
  const pendingInput = useRef<
    | (AssignmentDraft & { customerId?: string | null; origin: typeof origin })
    | null
  >(null);
  const [draftScope, setDraftScope] = useState("");
  const uncertainAssignment =
    error?.action === "assign" && assignmentOutcomeUnknown(error.cause);
  const controlsDisabled =
    busy || loadingContext || uncertainAssignment || selectingAll;
  const selectedCourse = courses.find(
    (course) => publishedAssignmentVersion(course)?.id === versionId,
  );
  const canSubmit =
    !controlsDisabled &&
    !contextError &&
    !repairing &&
    !selectingAll &&
    !!selectedCourse &&
    !selectedCourse.assignmentPaused &&
    selected.size > 0;
  async function selectAllFiltered() {
    if (controlsDisabled || contextError || selectingAll) return;
    setSelectingAll(true);
    setError(null);
    try {
      const params = new URLSearchParams({ search });
      for (const [key, value] of Object.entries({
        requestId: origin.sourceRequestId,
        orderId: origin.sourceOrderId,
        groupId: origin.groupId,
        customerId,
      }))
        if (value) params.set(key, value);
      const result = await api<{ recipientIds: string[] }>(
        `/lms/employer-import/selection?${params}`,
      );
      setSelected(new Set(result.recipientIds));
    } catch (caught) {
      setError({ cause: caught, action: "selection" });
    } finally {
      setSelectingAll(false);
    }
  }
  const initializedVersion = useRef("");
  const initializedQueryVersion = useRef("");
  const restoredSelection = useRef("");
  useEffect(() => {
    let alive = true;
    setCustomer(null);
    if (customerId && canRepair)
      void api<Customer>(`/customers/${customerId}`)
        .then((value) => {
          if (alive) setCustomer(value);
        })
        .catch(() => {
          /* An unavailable employer cannot be confirmed. */
        });
    return () => {
      alive = false;
    };
  }, [customerId, canRepair]);
  useEffect(() => {
    let alive = true;
    setLoadingContext(true);
    const query = new URLSearchParams(queryString);
    const requestId =
      query.get("requestId") || query.get("sourceRequestId") || "";
    const orderId = query.get("orderId") || query.get("sourceOrderId") || "";
    const groupId = query.get("groupId") || "";
    const filterCustomer = query.get("customerId") || "";
    const params = new URLSearchParams({ page: String(page), search });
    for (const [key, value] of Object.entries({
      requestId,
      orderId,
      groupId,
      customerId: filterCustomer,
    }))
      if (value) params.set(key, value);
    void api<
      Awaited<ReturnType<typeof lms.assignmentContext>> & {
        sourceTitle?: string | null;
        applicationId?: string | null;
        courseVersionId?: string | null;
      }
    >(`/lms/assignment-context?${params}`)
      .then((data) => {
        if (!alive) return;
        setRecipients(data.recipients);
        setTotal(data.total);
        setCourses(data.courses);
        const selectionScope = `${scope}:${requestId}:${orderId}:${groupId}:${filterCustomer}`;
        const pending =
          initializedVersion.current === selectionScope &&
          operation.current?.state === "PENDING"
            ? pendingInput.current
            : null;
        setCustomerId(
          (pending ? pending.customerId : data.customerId) || undefined,
        );
        setSource({
          title: data.sourceTitle,
          applicationId: data.applicationId,
          courseVersionId: data.courseVersionId,
        });
        setOrigin(
          pending
            ? pending.origin
            : {
                sourceRequestId: data.sourceRequestId,
                sourceOrderId: data.sourceOrderId,
                ...(data.group
                  ? { groupId: data.group.id, dueAt: data.group.dueAt }
                  : {}),
              },
        );
        if (pending) setGroupName(pending.groupName);
        else if (data.group) setGroupName(data.group.name);
        if (restoredSelection.current !== selectionScope) {
          restoredSelection.current = selectionScope;
          try {
            const saved = sessionStorage.getItem(
              `demo:lms:selection:${selectionScope}`,
            );
            const savedIds: unknown = saved ? JSON.parse(saved) : null;
            if (
              Array.isArray(savedIds) &&
              savedIds.length <= 10000 &&
              savedIds.every(
                (id) =>
                  typeof id === "string" && !!id.trim() && id.length <= 100,
              )
            ) {
              setSelected(new Set(savedIds));
            } else if (requestId && !groupId) {
              setSelected(
                new Set(
                  data.contextRecipientIds || data.recipients.map((r) => r.id),
                ),
              );
            } else setSelected(new Set());
          } catch {
            if (requestId && !groupId)
              setSelected(
                new Set(
                  data.contextRecipientIds || data.recipients.map((r) => r.id),
                ),
              );
            else setSelected(new Set());
          }
        }
        const explicitVersion =
          query.get("versionId") || query.get("courseVersionId") || "";
        const explicitVersionChanged =
          initializedQueryVersion.current !== explicitVersion;
        initializedQueryVersion.current = explicitVersion;
        let preferred =
          data.group?.courseVersionId ||
          data.courseVersionId ||
          query.get("versionId") ||
          query.get("courseVersionId") ||
          "";
        try {
          preferred ||= localStorage.getItem(`demo:lms:course:${scope}`) || "";
        } catch {
          /* Optional preference. */
        }
        const published = data.courses
          .map(publishedAssignmentVersion)
          .filter((v) => v !== null);
        const fixedVersion =
          data.group?.courseVersionId || data.courseVersionId;
        const available = data.courses
          .filter((course) => !course.assignmentPaused)
          .map(publishedAssignmentVersion)
          .filter((v) => v !== null);
        const initialVersion =
          fixedVersion ||
          explicitVersion ||
          published.find((v) => v.id === preferred)?.id ||
          (available.length === 1 ? available[0].id : "");
        if (initializedVersion.current !== selectionScope) {
          initializedVersion.current = selectionScope;
          setVersionId(initialVersion);
          operation.current = null;
          pendingInput.current = null;
          setError(null);
          setResult(null);
          setResuming(false);
          setGroupName(data.group?.name || "");
          setCustomAccess(false);
          setAccessPolicy({
            mode: "DAYS",
            days: 90,
            timezone: "Asia/Qyzylorda",
          });
          try {
            const draft = readAssignmentDraft(
              sessionStorage.getItem(
                `demo:lms:assignment-draft:${selectionScope}`,
              ),
            );
            if (draft) {
              setVersionId(
                fixedVersion ||
                  explicitVersion ||
                  (published.some((v) => v.id === draft.versionId)
                    ? draft.versionId
                    : initialVersion),
              );
              setGroupName(data.group?.name || draft.groupName);
              setCustomAccess(draft.customAccess);
              setAccessPolicy(draft.accessPolicy);
              setSelected(new Set(draft.recipientIds));
            }
            const saved = JSON.parse(
              sessionStorage.getItem(`demo:lms:assignment:${scope}`) || "null",
            );
            const settings = saved?.settings;
            const pending =
              settings &&
              readAssignmentDraft(
                JSON.stringify({
                  versionId: settings.versionId,
                  groupName: settings.groupName,
                  customAccess: settings.customAccess,
                  accessPolicy: settings.accessPolicy,
                  recipientIds: saved.recipientIds,
                }),
              );
            if (
              pending &&
              settings.origin &&
              ["PENDING", "PAUSED"].includes(saved.state) &&
              typeof saved.operationId === "string" &&
              typeof saved.fingerprint === "string" &&
              (saved.selectionScope === selectionScope ||
                ((settings.origin.sourceRequestId || "") ===
                  (data.sourceRequestId || "") &&
                  (settings.origin.sourceOrderId || "") ===
                    (data.sourceOrderId || "") &&
                  (settings.origin.groupId || "") === groupId &&
                  (settings.customerId || "") === (data.customerId || "")))
            ) {
              setVersionId(
                saved.state === "PENDING"
                  ? pending.versionId
                  : fixedVersion || pending.versionId,
              );
              setGroupName(pending.groupName);
              setCustomAccess(pending.customAccess);
              setAccessPolicy(pending.accessPolicy);
              setSelected(new Set(pending.recipientIds));
              setResuming(true);
              operation.current = {
                fingerprint: saved.fingerprint,
                operationId: saved.operationId,
                state: saved.state,
              };
              pendingInput.current = {
                ...pending,
                customerId: settings.customerId,
                origin: settings.origin,
              };
              if (saved.state === "PENDING") {
                setOrigin(settings.origin);
                setCustomerId(settings.customerId || undefined);
              }
              if (saved.state === "PENDING")
                setError({
                  action: "assign",
                  cause: new ApiError(0, "Assignment outcome pending"),
                });
            }
          } catch {
            /* Current source and persisted row outcomes remain available. */
          }
        } else {
          setVersionId((current) =>
            operation.current?.state === "PENDING"
              ? current
              : fixedVersion ||
                (explicitVersionChanged ? initialVersion : "") ||
                (published.some((version) => version.id === current)
                  ? current
                  : initialVersion),
          );
        }
        setDraftScope(selectionScope);
        setContextReady(true);
        setContextError(null);
      })
      .catch((caught) => {
        if (alive) setContextError(caught);
      })
      .finally(() => {
        if (alive) setLoadingContext(false);
      });
    return () => {
      alive = false;
    };
  }, [scope, refresh, page, search, queryString]);
  const visible = recipients;
  useEffect(() => {
    if (restoredSelection.current === currentDraftScope && !loadingContext)
      try {
        sessionStorage.setItem(
          `demo:lms:selection:${restoredSelection.current}`,
          JSON.stringify([...selected]),
        );
      } catch {
        /* Optional local recovery; durable operation remains server-side. */
      }
  }, [selected, currentDraftScope, loadingContext]);
  useEffect(() => {
    if (!draftScope || draftScope !== currentDraftScope || loadingContext)
      return;
    try {
      sessionStorage.setItem(
        `demo:lms:assignment-draft:${draftScope}`,
        JSON.stringify({
          versionId,
          recipientIds: [...selected],
          groupName,
          customAccess,
          accessPolicy,
        }),
      );
    } catch {
      /* The current page remains usable without browser storage. */
    }
  }, [
    draftScope,
    currentDraftScope,
    loadingContext,
    versionId,
    selected,
    groupName,
    customAccess,
    accessPolicy,
  ]);
  const completed = result?.state === "COMPLETED" && result.errorCount === 0;
  const errors = new Map(
    result?.errors.map((row) => [row.recipientId, lmsError(row, t)]) || [],
  );
  async function repairEmployment(row: LearnerSummary) {
    if (!canRepair || !customer || !customerId || repairing || controlsDisabled)
      return;
    setRepairing(row.id);
    setError(null);
    try {
      const current = await api<{ data: Recipient }>(`/recipients/${row.id}`);
      await api(`/recipients/${row.id}`, {
        method: "PATCH",
        body: json({
          ...current.data,
          id: current.data.id || row.id,
          employerId: customerId,
          assignments: [],
        }),
      });
      setResult((value) =>
        value
          ? {
              ...value,
              errors: value.errors.filter(
                (entry) => entry.recipientId !== row.id,
              ),
            }
          : value,
      );
      setRecipients((values) =>
        values.map((value) =>
          value.id === row.id
            ? {
                ...value,
                customerIds: [
                  ...new Set([...(value.customerIds || []), customerId]),
                ],
                data: {
                  ...value.data,
                  workplaceRu: customer.nameRu,
                  workplaceKz: customer.nameKz || customer.nameRu,
                },
              }
            : value,
        ),
      );
    } catch (caught) {
      setError({ cause: caught, action: "employment", recipientId: row.id });
    } finally {
      setRepairing("");
    }
  }
  function toggle(id: string) {
    if (controlsDisabled) return;
    setSelected((old) => {
      const next = new Set(old);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  function changeOrganization(value: { id: string } | null) {
    setLoadingContext(true);
    setCustomerId(value?.id);
    setSelected(new Set());
    setResult(null);
    setPage(1);
    const query = new URLSearchParams(window.location.search);
    if (value) query.set("customerId", value.id);
    else query.delete("customerId");
    window.history.replaceState(
      window.history.state,
      "",
      `/lms/assign${query.size ? `?${query}` : ""}`,
    );
    setRefresh((current) => current + 1);
  }
  async function assign() {
    if (
      !canSubmit &&
      !(
        uncertainAssignment &&
        !busy &&
        !loadingContext &&
        !contextError &&
        versionId &&
        selected.size
      )
    )
      return;
    const input =
      uncertainAssignment && pendingInput.current
        ? pendingInput.current
        : {
            versionId,
            recipientIds: [...selected],
            customerId,
            origin,
            groupName,
            customAccess,
            accessPolicy,
          };
    setBusy(true);
    setError(null);
    try {
      const {
        versionId,
        customerId,
        origin,
        groupName,
        customAccess,
        accessPolicy,
      } = input;
      const ids = input.recipientIds;
      const fingerprint = JSON.stringify([
        versionId,
        [...ids].sort(),
        customerId,
        origin,
        groupName,
        customAccess ? accessPolicy : null,
      ]);
      const key = `demo:lms:assignment:${scope}`;
      let operationId = crypto.randomUUID();
      if (
        operation.current?.fingerprint === fingerprint &&
        ["PENDING", "PAUSED"].includes(operation.current.state)
      )
        operationId = operation.current.operationId;
      try {
        const saved = JSON.parse(sessionStorage.getItem(key) || "null");
        if (
          saved?.fingerprint === fingerprint &&
          ["PENDING", "PAUSED"].includes(saved.state) &&
          typeof saved.operationId === "string"
        )
          operationId = saved.operationId;
        sessionStorage.setItem(
          key,
          JSON.stringify({
            selectionScope: currentDraftScope,
            fingerprint,
            operationId,
            recipientIds: ids,
            state: "PENDING",
            settings: {
              versionId,
              customerId,
              origin,
              groupName,
              customAccess,
              accessPolicy,
            },
          }),
        );
      } catch {
        /* The server still retains every completed row. */
      }
      operation.current = { fingerprint, operationId, state: "PENDING" };
      pendingInput.current = input;
      let report;
      do {
        report = await api<Awaited<ReturnType<typeof lms.assign>>>(
          "/lms/enrollments",
          {
            method: "POST",
            body: json({
              courseVersionId: versionId,
              recipientIds: ids,
              customerId,
              groupName,
              ...origin,
              operationId,
              ...(customAccess && !origin.groupId ? { accessPolicy } : {}),
            }),
          },
        );
        setResult(report);
        operation.current = { fingerprint, operationId, state: report.state };
        try {
          sessionStorage.setItem(
            key,
            JSON.stringify({
              selectionScope: currentDraftScope,
              fingerprint,
              operationId,
              recipientIds: ids,
              state: report.state,
              settings: {
                versionId,
                customerId,
                origin,
                groupName,
                customAccess,
                accessPolicy,
              },
            }),
          );
        } catch {
          /* Persisted server operation can still be retried in this session. */
        }
      } while (report.state === "PENDING");
      if (report.state === "COMPLETED")
        setSelected(new Set(report.failedRecipientIds));
      setResuming(report.state !== "COMPLETED");
      setAssignedIds(
        ids.filter((id) => !report.failedRecipientIds.includes(id)),
      );
      if (report.pauseError)
        setError({
          cause: new ApiError(409, "Assignment paused", report.pauseError),
          action: "assign",
        });
    } catch (caught) {
      setError({ cause: caught, action: "assign" });
      setResuming(assignmentOutcomeUnknown(caught));
      if (!assignmentOutcomeUnknown(caught) && operation.current) {
        operation.current.state = "REJECTED";
        try {
          const key = `demo:lms:assignment:${scope}`;
          const saved = JSON.parse(sessionStorage.getItem(key) || "null");
          if (saved?.operationId === operation.current.operationId)
            sessionStorage.setItem(
              key,
              JSON.stringify({ ...saved, state: "REJECTED" }),
            );
        } catch {
          /* The current draft remains available. */
        }
      }
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <LmsHeading title={t("Назначить обучение", "Оқуды тағайындау")}>
        {contextReady && !contextError && (
          <button
            disabled={busy || loadingContext || selectingAll || !!repairing}
            onClick={() => setRefresh((value) => value + 1)}
          >
            {loadingContext
              ? t("Обновляем…", "Жаңартылуда…")
              : t("Обновить список", "Тізімді жаңарту")}
          </button>
        )}
      </LmsHeading>
      {!!contextError && (
        <Notice>
          <strong>
            {deploymentBlocked ? t("Обучение для центра пока недоступно", "Орталық үшін оқу әзірге қолжетімсіз") : t(
              "Не удалось загрузить данные для назначения",
              "Тағайындау деректері жүктелмеді",
            )}
          </strong>
          <p>
            {deploymentBlocked ? lmsError(contextError, t) : t(
              "Ваш выбор сохранён.",
              "Таңдауыңыз сақталды.",
            )}
          </p>
          {!deploymentBlocked && contextError instanceof ApiError &&
            contextError.status >= 400 &&
            contextError.status < 500 && <p>{lmsError(contextError, t)}</p>}
          <LmsErrorDiagnostic error={contextError} t={t} />
          <button
            disabled={loadingContext || busy}
            onClick={() => setRefresh((value) => value + 1)}
          >
            {loadingContext
              ? t("Загружаем…", "Жүктелуде…")
              : deploymentBlocked ? t("Проверить доступ", "Қолжетімділікті тексеру") : t("Повторить загрузку", "Қайта жүктеу")}
          </button>
          {contextError instanceof ApiError &&
            [403, 404].includes(contextError.status) && (
              <p>
                <Link href="/lms/assign">
                  {t("Открыть новое назначение", "Жаңа тағайындауды ашу")}
                </Link>
              </p>
            )}
          {!contextReady &&
            canRepair &&
            sourceQuery.get("customerId") &&
            !sourceQuery.get("requestId") &&
            !sourceQuery.get("sourceRequestId") &&
            !sourceQuery.get("orderId") &&
            !sourceQuery.get("sourceOrderId") &&
            !sourceQuery.get("groupId") && (
              <OperatorOrganization
                value={sourceQuery.get("customerId")!}
                disabled={loadingContext || busy}
                t={t}
                onChange={changeOrganization}
              />
            )}
        </Notice>
      )}
      {!!error && (
        <Notice>
          <strong>
            {error.action === "assign"
              ? uncertainAssignment
                ? t(
                    "Результат назначения пока неизвестен",
                    "Тағайындау нәтижесі әзірге белгісіз",
                  )
                : t("Назначение не завершено", "Тағайындау аяқталмады")
              : error.action === "selection"
                ? t(
                    "Не удалось выбрать весь список",
                    "Бүкіл тізімді таңдау мүмкін болмады",
                  )
                : t(
                    "Не удалось подтвердить работодателя",
                    "Жұмыс берушіні растау мүмкін болмады",
                  )}
          </strong>
          <p>
            {uncertainAssignment
              ? t(
                  "Проверьте результат перед изменением выбора.",
                  "Таңдауды өзгертпес бұрын нәтижені тексеріңіз.",
                )
              : lmsError(error.cause, t)}
          </p>
          <LmsErrorDiagnostic error={error.cause} t={t} />
          <button
            disabled={
              busy ||
              loadingContext ||
              !!contextError ||
              !!repairing ||
              selectingAll ||
              (error.action === "assign" && !uncertainAssignment && !canSubmit)
            }
            onClick={() => {
              if (error.action === "assign") void assign();
              else if (error.action === "selection") void selectAllFiltered();
              else {
                const row = recipients.find(
                  (value) => value.id === error.recipientId,
                );
                if (row) void repairEmployment(row);
              }
            }}
          >
            {error.action === "assign"
              ? t("Повторить назначение", "Тағайындауды қайталау")
              : error.action === "selection"
                ? t("Повторить выбор списка", "Тізімді таңдауды қайталау")
                : t("Повторить подтверждение", "Растауды қайталау")}
          </button>
        </Notice>
      )}
      {loadingContext && !contextReady && (
        <p role="status">
          {t(
            "Загружаем программы и список людей…",
            "Бағдарламалар мен адамдар тізімі жүктелуде…",
          )}
        </p>
      )}
      {contextReady && (
        <section className="panel lms-panel" aria-busy={loadingContext || busy}>
          {source.title && (
            <p>
              <strong>{source.title}</strong>
              {source.applicationId && (
                <>
                  {" "}
                  ·{" "}
                  <Link href={`/lms/applications?id=${source.applicationId}`}>
                    {t("Заявка на обучение", "Оқуға өтінім")}
                  </Link>
                </>
              )}
              {origin.sourceOrderId && (
                <>
                  {" "}
                  ·{" "}
                  <Link href={`/workbench?orderId=${origin.sourceOrderId}`}>
                    {t("Заказ", "Тапсырыс")}
                  </Link>
                </>
              )}
            </p>
          )}
          {!completed && (
            <>
              {!loadingContext && !contextError && !courses.length && (
                <Notice kind="info">
                  <strong>
                    {t(
                      "Пока нет опубликованных программ",
                      "Әзірге жарияланған бағдарламалар жоқ",
                    )}
                  </strong>
                  <p>
                    {canRepair
                      ? t(
                          "Методист готовит программу, администратор публикует её.",
                          "Әдіскер бағдарламаны дайындайды, әкімші жариялайды.",
                        )
                      : t(
                          "Обратитесь в учебный центр для публикации программы.",
                          "Бағдарламаны жариялау үшін оқу орталығына хабарласыңыз.",
                        )}
                  </p>
                  {canRepair && (
                    <Link
                      href={`/lms?returnTo=${encodeURIComponent(`/lms/assign${queryString ? `?${queryString}` : ""}`)}`}
                    >
                      {t("Открыть программы", "Бағдарламаларды ашу")}
                    </Link>
                  )}
                </Notice>
              )}
              {canRepair &&
                !origin.sourceRequestId &&
                !origin.sourceOrderId &&
                !origin.groupId && (
                  <OperatorOrganization
                    value={customerId || ""}
                    disabled={controlsDisabled}
                    t={t}
                    onChange={changeOrganization}
                  />
                )}
              {!!customer &&
                (origin.sourceOrderId ||
                  origin.sourceRequestId ||
                  origin.groupId) && (
                  <p>
                    {t(customer.nameRu, customer.nameKz || customer.nameRu)}
                  </p>
                )}
              <div className="lms-toolbar">
                <label>
                  {t("Программа", "Бағдарлама")}
                  <select
                    value={versionId}
                    disabled={
                      controlsDisabled ||
                      !!origin.groupId ||
                      !!source.courseVersionId ||
                      !courses.length
                    }
                    aria-describedby="assignment-next-step"
                    onChange={(e) => {
                      setVersionId(e.target.value);
                      setResult(null);
                      try {
                        localStorage.setItem(
                          `demo:lms:course:${scope}`,
                          e.target.value,
                        );
                      } catch {
                        /* Optional preference. */
                      }
                    }}
                  >
                    <option value="">
                      {courses.length
                        ? t("Выберите программу", "Бағдарламаны таңдаңыз")
                        : t(
                            "Нет опубликованных программ",
                            "Жарияланған бағдарламалар жоқ",
                          )}
                    </option>
                    {courses.flatMap((course) => {
                      const version = publishedAssignmentVersion(course);
                      return version?.status === "PUBLISHED"
                        ? [
                            <option
                              key={version.id}
                              value={version.id}
                              disabled={course.assignmentPaused}
                            >
                              {t(
                                version.content.titleRu,
                                version.content.titleKz,
                              )}{" "}
                              · {version.version}
                              {course.assignmentPaused
                                ? ` · ${t("Назначения приостановлены", "Тағайындаулар тоқтатылған")}`
                                : ""}
                            </option>,
                          ]
                        : [];
                    })}
                  </select>
                </label>
                <button
                  className="primary lms-primary"
                  disabled={!canSubmit}
                  aria-describedby="assignment-next-step"
                  onClick={() => void assign()}
                >
                  {busy
                    ? t("Назначаем обучение…", "Оқу тағайындалуда…")
                    : `${resuming ? t("Продолжить назначение", "Тағайындауды жалғастыру") : t("Назначить обучение", "Оқуды тағайындау")} · ${selected.size}`}
                </button>
              </div>
              <p id="assignment-next-step" role="status">
                {loadingContext
                  ? t(
                      "Проверяем доступные программы и состав…",
                      "Қолжетімді бағдарламалар мен құрам тексерілуде…",
                    )
                  : contextError
                    ? t(
                        "Сначала повторите загрузку данных выше.",
                        "Алдымен жоғарыдағы деректерді қайта жүктеңіз.",
                      )
                    : uncertainAssignment
                      ? t(
                          "Сначала проверьте результат кнопкой «Повторить назначение» выше.",
                          "Алдымен жоғарыдағы «Тағайындауды қайталау» түймесімен нәтижені тексеріңіз.",
                        )
                      : versionId && !selectedCourse
                        ? t(
                            "Программа из заявки или группы сейчас недоступна. Учебный центр должен проверить её доступность.",
                            "Өтінімдегі немесе топтағы бағдарлама қазір қолжетімсіз. Оқу орталығы оның қолжетімділігін тексеруі керек.",
                          )
                        : selectedCourse?.assignmentPaused ||
                            (!!courses.length &&
                              courses.every(
                                (course) => course.assignmentPaused,
                              ))
                          ? t(
                              "Назначения приостановлены. Для возобновления обратитесь к методисту или администратору.",
                              "Тағайындаулар тоқтатылған. Қайта қосу үшін әдіскерге немесе әкімшіге хабарласыңыз.",
                            )
                          : !courses.length
                            ? t(
                                "Ожидаем публикации программы учебным центром.",
                                "Оқу орталығының бағдарламаны жариялауын күтеміз.",
                              )
                            : !versionId
                              ? t(
                                  "Выберите опубликованную программу.",
                                  "Жарияланған бағдарламаны таңдаңыз.",
                                )
                              : !selected.size
                                ? t(
                                    "Выберите людей в списке ниже или добавьте новых.",
                                    "Төмендегі тізімнен адамдарды таңдаңыз немесе жаңаларын қосыңыз.",
                                  )
                                : t(
                                    `Готово к назначению: ${selected.size} чел.`,
                                    `Тағайындауға дайын: ${selected.size} адам.`,
                                  )}
              </p>
              {selectedCourse?.assignmentPaused &&
                selectedCourse.assignmentPauseReason && (
                  <p>{selectedCourse.assignmentPauseReason}</p>
                )}
              {canRepair &&
                !loadingContext &&
                !contextError &&
                (selectedCourse?.assignmentPaused ||
                  (!!versionId && !selectedCourse) ||
                  (!!courses.length &&
                    courses.every((course) => course.assignmentPaused))) && (
                  <p>
                    <Link
                      href={`/lms?returnTo=${encodeURIComponent(`/lms/assign${queryString ? `?${queryString}` : ""}`)}`}
                    >
                      {t("Открыть программы", "Бағдарламаларды ашу")}
                    </Link>
                  </p>
                )}
              {!origin.groupId && (
                <details>
                  <summary>
                    {t(
                      "Группа и сроки",
                      "Топ және мерзімдер",
                    )}
                  </summary>
                  <label>
                    {t(
                      "Название группы · необязательно",
                      "Топ атауы · міндетті емес",
                    )}
                    <input
                      value={groupName}
                      maxLength={300}
                      disabled={controlsDisabled}
                      onChange={(event) => setGroupName(event.target.value)}
                    />
                  </label>
                  <label className="lms-inline-label">
                    <input
                      type="checkbox"
                      checked={customAccess}
                      disabled={controlsDisabled}
                      onChange={(event) =>
                        setCustomAccess(event.target.checked)
                      }
                    />
                    {t(
                      "Задать общий период доступа для состава",
                      "Құрамға ортақ қолжетімділік мерзімін белгілеу",
                    )}
                  </label>
                  {customAccess && (
                    <AccessPolicyEditor
                      value={accessPolicy}
                      onChange={setAccessPolicy}
                      disabled={controlsDisabled}
                      t={t}
                    />
                  )}
                </details>
              )}
            </>
          )}
          {result && (
            <Notice kind={result.errorCount ? "error" : "success"}>
              {t("Назначено", "Тағайындалды")}: {result.created}.{" "}
              {result.duplicates > 0 &&
                `${t("Уже назначено", "Бұрын тағайындалған")}: ${result.duplicates}. `}
              {result.errorCount > 0 &&
                `${t("Нужна проверка строк", "Тексерілетін жолдар")}: ${result.errorCount}.`}
              {!!result.conflicts && (
                <p>
                  {t(
                    "Уже назначено по другой заявке или группе",
                    "Басқа өтінім немесе топ бойынша тағайындалған",
                  )}
                  : {result.conflicts}
                </p>
              )}
              {result.state === "PENDING" && (
                <p>
                  {t("Обработано", "Өңделді")}: {result.cursor}/{result.total}
                </p>
              )}
              {result.groupId && (
                <p>
                  <Link href={`/lms/groups/${result.groupId}`}>
                    {t("Открыть группу", "Топты ашу")}
                  </Link>
                </p>
              )}
            </Notice>
          )}
          {canRepair && assignedIds.length > 0 && completed && (
            <LearnerAccess
              recipientIds={assignedIds}
              customerId={customerId}
              t={t}
            />
          )}
          {!canRepair && result?.state === "COMPLETED" && (
            <p>
              {t(
                "Для входа слушателей обратитесь в учебный центр.",
                "Тыңдаушылардың кіруі үшін оқу орталығына хабарласыңыз.",
              )}
            </p>
          )}
          {completed && (
            <button
              onClick={() => {
                setResult(null);
                setAssignedIds([]);
              }}
            >
              {t("Назначить ещё", "Тағы тағайындау")}
            </button>
          )}
          {!completed && (
            <>
              <div className="lms-toolbar">
                {canRepair && !origin.sourceRequestId && (
                  <button
                    disabled={controlsDisabled}
                    onClick={() => setAddingPerson((value) => !value)}
                    aria-expanded={addingPerson}
                  >
                    {addingPerson
                      ? t(
                          "Закрыть ввод нового человека",
                          "Жаңа адамды енгізуді жабу",
                        )
                      : t("Добавить человека", "Адам қосу")}
                  </button>
                )}
                {!origin.groupId && !controlsDisabled && (
                  <Link
                    href={`/lms/import?${new URLSearchParams({ ...(customerId ? { customerId } : {}), ...(versionId ? { versionId } : {}), ...(origin.sourceOrderId ? { orderId: origin.sourceOrderId } : {}), ...(origin.sourceRequestId ? { requestId: origin.sourceRequestId } : {}) })}`}
                  >
                    {t(
                      "Вставить список или импортировать Excel",
                      "Тізімді қою немесе Excel импорттау",
                    )}
                  </Link>
                )}
              </div>
              {addingPerson && canRepair && !origin.sourceRequestId && (
                <fieldset
                  disabled={controlsDisabled}
                  className="lms-assignment-person"
                >
                  <OperatorPerson
                    customerId={customerId}
                    t={t}
                    onCreated={(id) => {
                      setSelected((values) => new Set([...values, id]));
                      setSearch("");
                      setPage(1);
                      setRefresh((value) => value + 1);
                    }}
                  />
                </fieldset>
              )}
              <div className="lms-toolbar">
                <label>
                  {t("Найти сотрудника", "Қызметкерді табу")}
                  <input
                    type="search"
                    value={search}
                    maxLength={300}
                    disabled={busy || uncertainAssignment || selectingAll}
                    onChange={(e) => {
                      setSearch(e.target.value);
                      setPage(1);
                      setSelected(new Set());
                    }}
                  />
                </label>
                <label className="lms-inline-label">
                  <input
                    type="checkbox"
                    disabled={controlsDisabled}
                    checked={
                      visible.length > 0 &&
                      visible.every((r) => selected.has(r.id))
                    }
                    onChange={(e) =>
                      setSelected((current) => {
                        const next = new Set(current);
                        for (const row of visible) {
                          if (e.target.checked) next.add(row.id);
                          else next.delete(row.id);
                        }
                        return next;
                      })
                    }
                  />
                  {total > 250
                    ? t("Выбрать эту страницу", "Осы бетті таңдау")
                    : t("Выбрать видимый список", "Көрсетілген тізімді таңдау")}
                </label>
                {total > visible.length && (
                  <button
                    disabled={controlsDisabled || !!contextError}
                    onClick={() => void selectAllFiltered()}
                  >
                    {t(
                      "Выбрать всю отфильтрованную выборку",
                      "Сүзілген тізімді түгел таңдау",
                    )}{" "}
                    · {total}
                  </button>
                )}
                {!!selected.size && (
                  <span role="status">
                    {t("Выбрано", "Таңдалды")}: {selected.size}
                  </span>
                )}
              </div>
              <div
                className="lms-table-scroll"
                tabIndex={0}
                role="region"
                aria-label={t("Сотрудники", "Қызметкерлер")}
              >
                <table className="lms-table">
                  <thead>
                    <tr>
                      <th>{t("Сотрудник", "Қызметкер")}</th>
                      <th>{t("Должность", "Лауазым")}</th>
                      <th>{t("Организация", "Ұйым")}</th>
                      <th>{t("Проверка", "Тексеру")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visible.map((row) => (
                      <tr key={row.id}>
                        <td>
                          <label className="lms-inline-label">
                            <input
                              type="checkbox"
                              disabled={controlsDisabled}
                              checked={selected.has(row.id)}
                              onChange={() => toggle(row.id)}
                            />
                            <span>
                              {t(
                                row.data.fullNameRu,
                                row.data.fullNameKz || row.data.fullNameRu,
                              )}
                            </span>
                          </label>
                        </td>
                        <td>
                          {t(
                            row.data.positionRu || "",
                            row.data.positionKz || row.data.positionRu || "",
                          )}
                        </td>
                        <td>
                          {t(
                            row.data.workplaceRu || "",
                            row.data.workplaceKz || row.data.workplaceRu || "",
                          )}
                        </td>
                        <td>
                          {errors.has(row.id) && (
                            <div className="lms-error" role="alert">
                              {errors.get(row.id)}
                              {canRepair &&
                                customer &&
                                result?.errors.some(
                                  (entry) =>
                                    entry.recipientId === row.id &&
                                    entry.code === "EMPLOYMENT_REQUIRED",
                                ) && (
                                  <div>
                                    <p>
                                      {t(
                                        "Работодатель в заявке",
                                        "Өтінімдегі жұмыс беруші",
                                      )}
                                      :{" "}
                                      {t(
                                        customer.nameRu,
                                        customer.nameKz || customer.nameRu,
                                      )}
                                    </p>
                                    <button
                                      disabled={!!repairing || controlsDisabled}
                                      onClick={() => void repairEmployment(row)}
                                    >
                                      {t(
                                        "Подтвердить работодателя",
                                        "Жұмыс берушіні растау",
                                      )}
                                    </button>
                                  </div>
                                )}
                            </div>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {!visible.length && !loadingContext && !contextError && (
                <p className="lms-empty">
                  {t("Сотрудников не найдено.", "Қызметкерлер табылмады.")}
                </p>
              )}
              {!controlsDisabled && (
                <PageControls
                  page={page}
                  total={total}
                  pageSize={250}
                  onPage={setPage}
                  t={t}
                />
              )}
            </>
          )}
        </section>
      )}
    </>
  );
}
