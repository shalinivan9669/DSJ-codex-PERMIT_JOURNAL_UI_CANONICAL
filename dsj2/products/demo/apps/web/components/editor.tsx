"use client";
import { BulkDialog } from "./bulk-dialog";
import { RecordPicker } from "./record-picker";
import { EventContext } from "./event-context";
import { CustomerOutput } from "./customer-output";
import { CustomerReview } from "./customer-review";
import { RequestOperations } from "./request-operations";
import { GridPasteDialog } from "./grid-paste-dialog";
import { type GridField } from "@/lib/grid-paste";
import { BulkPhotoDialog } from "./bulk-photo-dialog";
import { RecipientGrid } from "./recipient-grid";
import { TrainingBundleDialog } from "./training-bundle-dialog";
import { TrainingOverview } from "./training-overview";
import { RequestActivity } from "./request-activity";
import { ApprovalBanner } from "./approvals";
import { SigningPanel } from "./signing-panel";
import { SharedEmployerDialog } from "./shared-employer-dialog";
import { groupValidationIssues } from "@/lib/validation-groups";
import { validationErrors } from "@/lib/validation-errors";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { Icon, Modal, Notice } from "@demo/ui";
import {
  LIMITS,
  resolveDraft,
  resolveRecipientText,
  documentPlan,
  type CommonFields,
  applyBusinessRules,
} from "@demo/contracts";
import { api, ApiError, errorText, json, BEFORE_LOGOUT_EVENT } from "@/lib/api";
import { AutosaveLane } from "@/lib/autosave";
import { requestActions } from "@/lib/request-actions";
import { useUnsavedNavigation } from "@/lib/use-unsaved-navigation";
import { recipientForRequest, requestBundles } from "@/lib/request-bundles";
import {
  draftPayload,
  personRequestName,
  newRecipient,
  type AppContext,
  type Customer,
  type Draft,
  type Page,
  type Recipient,
  type Validation,
} from "@/lib/types";
import { CustomerDialog } from "./customers";
import { RecipientDetails } from "./recipient-details";
import { ImportDialog } from "./import-dialog";
import { FilesPanel } from "./files-panel";
import { Status } from "./request-list";

export function Editor({ id, context }: { id: string; context: AppContext }) {
  const router = useRouter();
  const [draft, setDraft] = useState<Draft | null>(null);
  const current = useRef<Draft | null>(null);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [checked, setChecked] = useState<string[]>([]);
  const [documentTargets, setDocumentTargets] = useState<string[] | null>(null);
  const [employerTargets, setEmployerTargets] = useState<string[] | null>(null);
  const [rowSearch, setRowSearch] = useState("");
  const [editingSearchId, setEditingSearchId] = useState("");
  const [entryView, setEntryView] = useState<"table" | "card">("table");
  const [reviewStale, setReviewStale] = useState(false);
  const [focusFieldPath, setFocusFieldPath] = useState<string | null>(null);
  const validationRequested = useRef(false);
  const validationSerial = useRef(0);
  const focusValidation = useRef(false);
  const [removeId, setRemoveId] = useState<string | null>(null);
  const [pastedRange, setPastedRange] = useState<{
    startRow: number;
    startField: GridField;
    text: string;
    columns?: GridField[];
  } | null>(null);
  const [undo, setUndo] = useState<{
    before: Draft;
    revision: number;
    removedId?: string;
  } | null>(null);
  const [saveState, setSaveState] = useState("saved");
  const [rowScope, setRowScope] = useState("");
  const [error, setError] = useState("");
  const [pinnedCenter, setPinnedCenter] = useState<{
    id: string;
    commonFields: CommonFields;
  } | null>(null);
  useEffect(() => {
    const profileId = draft?.profileVersionId;
    if (!profileId || profileId === context.profileVersionId) return;
    let active = true;
    void api<{
      items: { id: string; profile: { commonFields?: CommonFields } }[];
    }>(`/settings/profiles?versionId=${encodeURIComponent(profileId)}`)
      .then(({ items }) => {
        if (!active) return;
        const profile = items.find((item) => item.id === profileId);
        if (!profile)
          throw new Error(
            "Не найдена сохранённая версия графика центра. Обновите заявку.",
          );
        setPinnedCenter({
          id: profileId,
          commonFields: profile.profile.commonFields || {},
        });
      })
      .catch((caught) => {
        if (active) setError(errorText(caught));
      });
    return () => {
      active = false;
    };
  }, [draft?.profileVersionId, context.profileVersionId]);
  const saveError = useRef("");
  const [busy, setBusy] = useState("");
  const [contextBusy, setContextBusy] = useState(false);
  const operationBusy = !!busy || contextBusy;
  const [validation, setValidation] = useState<Validation | null>(null);
  const [serverResolution, setServerResolution] = useState<{
    revision: number;
    value: ReturnType<typeof resolveDraft>;
  } | null>(null);
  const [validationRevision, setValidationRevision] = useState<number | null>(
    null,
  );
  const [dialog, setDialog] = useState<
    | "import"
    | "bulk"
    | "customer"
    | "customerPicker"
    | "recipientPicker"
    | "photos"
    | "conflict"
    | null
  >(null);
  const [extraPanel, setExtraPanel] = useState<
    "menu" | "dates" | "review" | "output" | "operations" | null
  >(null);
  function closeExtraPanel() {
    if (document.activeElement instanceof HTMLElement)
      document.activeElement.blur();
    setExtraPanel(null);
  }
  const [refreshFiles, setRefreshFiles] = useState(0);
  const [previewRevision, setPreviewRevision] = useState<number | null>(null);
  const lane = useRef<AutosaveLane<ReturnType<typeof draftPayload>> | null>(
    null,
  );
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const idempotency = useRef<{ revision: number; key: string } | null>(null);
  const errorsRef = useRef<HTMLDivElement>(null);
  const recipientDetailRef = useRef<HTMLElement>(null);
  const gridReturn = useRef<{
    element: HTMLElement | null;
    rowId: string;
    scrollTop: number;
    scrollLeft: number;
    windowY: number;
  } | null>(null);
  const lastGridField = useRef<HTMLElement | null>(null);
  const initialEntry = useRef("");
  useEffect(() => {
    if (!draft || draft.id !== id || initialEntry.current === id) return;
    initialEntry.current = id;
    if (
      draft.status === "DRAFT" &&
      context.user.role !== "VIEWER" &&
      draft.items.length === 1 &&
      !draft.items[0].fullNameRu &&
      !draft.items[0].fullNameKz
    ) {
      requestAnimationFrame(() => {
        const input = document.querySelector<HTMLInputElement>(
          '.operator-grid [data-field-path="items.0.fullNameRu"]',
        );
        input?.focus();
        input?.scrollIntoView({ block: "center" });
      });
    }
  }, [draft, id, context.user.role]);
  function openRecipient(id: string) {
    if (entryView === "table") {
      const grid = document.querySelector<HTMLElement>(
        ".recipient-grid-scroll",
      );
      const active = document.activeElement as HTMLElement | null;
      const opener = active?.closest(".operator-grid")
        ? active
        : lastGridField.current;
      gridReturn.current =
        opener
          ?.closest("tr[data-recipient-id]")
          ?.getAttribute("data-recipient-id") === id
          ? {
              element: opener,
              rowId: id,
              scrollTop: grid?.scrollTop || 0,
              scrollLeft: grid?.scrollLeft || 0,
              windowY: window.scrollY,
            }
          : null;
    }
    setSelectedId(id);
    setEntryView("card");
    requestAnimationFrame(() => {
      const panel = recipientDetailRef.current;
      panel?.focus({ preventScroll: true });
      panel?.scrollIntoView({ block: "nearest" });
    });
  }
  function returnToTable() {
    setEntryView("table");
    requestAnimationFrame(() => {
      const previous = gridReturn.current;
      const grid = document.querySelector<HTMLElement>(
        ".recipient-grid-scroll",
      );
      const index =
        current.current?.items.findIndex((item) => item.id === selectedId) ??
        -1;
      const fallback = document.querySelector<HTMLElement>(
        `.operator-grid [aria-label="Документы и даты получателя ${index + 1}"]`,
      );
      const target =
        previous?.rowId === selectedId && previous.element?.isConnected
          ? previous.element
          : fallback;
      if (grid && previous && previous.rowId === selectedId) {
        grid.scrollTop = previous.scrollTop;
        grid.scrollLeft = previous.scrollLeft;
        window.scrollTo({ top: previous.windowY });
      }
      target?.focus({ preventScroll: true });
      if (!previous || previous.rowId !== selectedId)
        target?.scrollIntoView({ block: "center", inline: "nearest" });
    });
  }
  useEffect(() => {
    if (validation && focusValidation.current) {
      focusValidation.current = false;
      errorsRef.current?.focus({ preventScroll: true });
      errorsRef.current?.scrollIntoView({ block: "start" });
    }
  }, [validation]);
  const alive = useRef(true);
  const refreshValidation = useCallback(
    async (revision: number) => {
      const serial = ++validationSerial.current;
      const [resolved, result] = await Promise.all([
        api<ReturnType<typeof resolveDraft>>(`/print-requests/${id}/resolved`),
        api<Validation & { issues?: Validation["errors"] }>(
          `/print-requests/${id}/validate`,
          {
            method: "POST",
            body: json({ expectedRevision: revision }),
          },
        ),
      ]);
      // A response from an older save must not replace feedback for newer input.
      if (
        !alive.current ||
        serial !== validationSerial.current ||
        current.current?.revision !== revision ||
        lane.current?.dirty
      )
        return;
      setServerResolution({ revision, value: resolved });
      setValidation({
        ...result,
        errors: result.errors || result.issues || [],
      });
      setValidationRevision(revision);
      setReviewStale(false);
    },
    [id],
  );
  const initialize = useCallback(
    (value: Draft) => {
      current.current = value;
      setDraft(value);
      setServerResolution(null);
      setValidation(null);
      validationRequested.current = false;
      validationSerial.current++;
      setFocusFieldPath(null);
      setReviewStale(false);
      setChecked((ids) =>
        ids.filter((itemId) => value.items.some((item) => item.id === itemId)),
      );
      setSelectedId((previous) =>
        value.items.some((item) => item.id === previous)
          ? previous
          : value.items[0]?.id || "",
      );
      setSaveState("saved");
      lane.current = new AutosaveLane(
        draftPayload(value),
        value.revision,
        async (payload, expectedRevision) => {
          const result = await api<
            Pick<Draft, "revision" | "approval" | "approvedRevision">
          >(`/print-requests/${id}`, {
            method: "PATCH",
            body: json({ expectedRevision, draft: payload }),
          });
          if (current.current)
            current.current = {
              ...current.current,
              approval: result.approval,
              approvedRevision: result.approvedRevision,
            };
          return result;
        },
        (state, revision, caught, capturedVersion) => {
          if (!alive.current) return;
          setSaveState(state);
          if (current.current) {
            current.current = { ...current.current, revision };
            setDraft(current.current);
          }
          if (caught) {
            saveError.current = errorText(caught);
            setError(saveError.current);
            const errors = validationErrors(caught);
            if (errors.length) {
              validationRequested.current = true;
              setValidation({ valid: false, errors });
              setValidationRevision(revision);
              setReviewStale(capturedVersion !== lane.current?.currentVersion);
            }
            if (caught instanceof ApiError && caught.status === 409)
              setDialog("conflict");
          } else if (state === "saved") {
            if (saveError.current) {
              const previousSaveError = saveError.current;
              setError((message) =>
                message === previousSaveError ? "" : message,
              );
              saveError.current = "";
            }
            if (validationRequested.current)
              void refreshValidation(revision).catch(() => {
                // Keep the last review visible if the connection drops.
                if (alive.current) setReviewStale(true);
              });
          }
        },
      );
      if (new URLSearchParams(window.location.search).get("check") === "1") {
        validationRequested.current = true;
        focusValidation.current = true;
        void refreshValidation(value.revision).catch((caught) => {
          if (alive.current) setError(errorText(caught));
        });
      }
    },
    [id, refreshValidation],
  );
  useEffect(() => {
    alive.current = true;
    api<Draft>(`/print-requests/${id}`)
      .then((value) => {
        if (alive.current) {
          initialize(value);
          if (value.customerId)
            void api<Customer>(`/customers/${value.customerId}`)
              .then((customer) =>
                setCustomers((old) => [
                  ...old.filter((c) => c.id !== customer.id),
                  customer,
                ]),
              )
              .catch(() => undefined);
        }
      })
      .catch((caught) => setError(errorText(caught)));
    api<Page<Customer>>("/customers?page=1&pageSize=100")
      .then((result) => {
        if (alive.current)
          setCustomers((old) => [
            ...result.items,
            ...old.filter((c) => !result.items.some((row) => row.id === c.id)),
          ]);
      })
      .catch((caught) => setError(errorText(caught)));
    return () => {
      alive.current = false;
      clearTimeout(timer.current);
    };
  }, [id, initialize]);
  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (lane.current?.dirty) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    const beforeLogout = (event: Event) => {
      if (!lane.current?.dirty) return;
      clearTimeout(timer.current);
      const request = event as CustomEvent<{
        waitUntil: (save: Promise<unknown>) => void;
      }>;
      request.detail.waitUntil(lane.current.flush());
    };
    const navigate = (event: MouseEvent) => {
      const link = (event.target as HTMLElement).closest("a");
      if (
        !link ||
        !lane.current?.dirty ||
        link.target === "_blank" ||
        link.hasAttribute("download") ||
        event.ctrlKey ||
        event.metaKey ||
        event.shiftKey
      )
        return;
      const target = new URL(link.href);
      if (
        target.origin !== window.location.origin ||
        target.pathname.startsWith("/api/")
      )
        return;
      event.preventDefault();
      event.stopPropagation();
      void lane.current
        .flush()
        .then(() => router.push(target.pathname + target.search))
        .catch((caught) => setError(errorText(caught)));
    };
    window.addEventListener("beforeunload", beforeUnload);
    window.addEventListener(BEFORE_LOGOUT_EVENT, beforeLogout);
    document.addEventListener("click", navigate, true);
    return () => {
      window.removeEventListener("beforeunload", beforeUnload);
      window.removeEventListener(BEFORE_LOGOUT_EVENT, beforeLogout);
      document.removeEventListener("click", navigate, true);
    };
  }, [router]);
  function edit(patch: Partial<Draft>) {
    if (!current.current || !lane.current) return;
    validationSerial.current++;
    if (patch.items) {
      const structure = (items: Recipient[]) =>
        JSON.stringify(
          items.map((item) => [
            item.id,
            item.assignments.map((assignment) => [
              assignment.id,
              assignment.templateId,
            ]),
          ]),
        );
      // Validation paths use array indices; discard them if their targets move.
      if (structure(patch.items) !== structure(current.current.items))
        setValidation(null);
    }
    const next = applyBusinessRules({
      ...current.current,
      ...patch,
      businessRuleVersion: "LIVE_V1" as const,
    });
    next.title = personRequestName(next) || next.title;
    current.current = next;
    setDraft(next);
    lane.current.edit(draftPayload(next));
    // Preserve feedback while typing; refresh it after the new revision saves.
    setReviewStale(true);
    setServerResolution(null);
    setError("");
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      void lane.current?.flush().catch(() => undefined);
    }, 650);
  }
  function editRecipient(value: Recipient) {
    // A matching row must not disappear halfway through correcting its name.
    if (rowSearch && visibleItems.some((item) => item.id === value.id))
      setEditingSearchId(value.id);
    if (current.current)
      edit({
        items: current.current.items.map((item) =>
          item.id === value.id ? value : item,
        ),
      });
  }
  async function flush() {
    clearTimeout(timer.current);
    if (!lane.current) throw new Error("Заявка ещё загружается.");
    return lane.current.flush();
  }
  useUnsavedNavigation({
    requestId: id,
    dirty: () => !!lane.current?.dirty,
    flush,
    onError: (caught) => setError(errorText(caught)),
    replace: (url) => router.replace(url),
  });
  async function applyOperation(patch: Partial<Draft>, removedId?: string) {
    if (!current.current || busy) return;
    setBusy("bulk");
    setError("");
    try {
      const expectedRevision = await flush();
      const before = structuredClone(current.current);
      const next = applyBusinessRules({
        ...before,
        ...patch,
        businessRuleVersion: "LIVE_V1" as const,
      });
      next.title = personRequestName(next) || next.title;
      if (
        JSON.stringify(draftPayload(before)) ===
        JSON.stringify(draftPayload(next))
      )
        return true;
      const result = await api<
        Pick<Draft, "revision" | "approval" | "approvedRevision">
      >(`/print-requests/${id}`, {
        method: "PATCH",
        body: json({ expectedRevision, draft: draftPayload(next) }),
      });
      initialize({ ...next, ...result });
      setUndo({ before, revision: result.revision, removedId });
      setValidation(null);
      return true;
    } catch (caught) {
      setError(errorText(caught));
      return false;
    } finally {
      setBusy("");
    }
  }
  async function rememberContextOperation(
    previousEvents: NonNullable<Draft["events"]>,
  ) {
    try {
      const revision = await flush();
      if (current.current?.status === "DRAFT")
        setUndo({
          before: {
            ...structuredClone(current.current),
            events: previousEvents,
          },
          revision,
        });
    } catch (caught) {
      setError(errorText(caught));
    }
  }
  async function command(kind: "save" | "validate" | "preview" | "finalize") {
    setBusy(kind);
    setError("");
    try {
      const revision = await flush();
      if (kind === "validate") {
        validationRequested.current = true;
        focusValidation.current = true;
        await refreshValidation(revision);
      } else if (kind === "preview") {
        await api(`/print-requests/${id}/preview`, {
          method: "POST",
          body: json({ expectedRevision: revision }),
        });
        setPreviewRevision(revision);
        setRefreshFiles((value) => value + 1);
      } else if (kind === "finalize") {
        if (!idempotency.current || idempotency.current.revision !== revision)
          idempotency.current = { revision, key: crypto.randomUUID() };
        await api(`/print-requests/${id}/finalize`, {
          method: "POST",
          headers: { "Idempotency-Key": idempotency.current.key },
          body: json({ expectedRevision: revision }),
        });
        const result = await api<Draft>(`/print-requests/${id}`);
        initialize(result);
        setDialog(null);
        setRefreshFiles((value) => value + 1);
        requestAnimationFrame(() => {
          document
            .getElementById("request-files")
            ?.scrollIntoView({ block: "start" });
        });
      }
    } catch (caught) {
      setError(errorText(caught));
      const errors = validationErrors(caught);
      if (errors.length) {
        validationRequested.current = true;
        focusValidation.current = true;
        setValidation({ valid: false, errors });
        setValidationRevision(lane.current?.currentRevision ?? null);
        setReviewStale(false);
        setDialog(null);
      }
    } finally {
      setBusy("");
    }
  }
  async function reload() {
    setBusy("reload");
    try {
      const result = await api<Draft>(`/print-requests/${id}`);
      initialize(result);
      setDialog(null);
      setError("");
    } catch (caught) {
      setError(errorText(caught));
    } finally {
      setBusy("");
    }
  }
  async function copyConflict() {
    if (!current.current) return;
    setBusy("copy");
    try {
      const result = await api<Draft>("/print-requests", {
        method: "POST",
        body: json({
          ...draftPayload(current.current),
          title: `${current.current.title} — копия изменений`,
        }),
      });
      router.push(`/requests/${result.id}/edit`);
    } catch (caught) {
      setError(errorText(caught));
    } finally {
      setBusy("");
    }
  }
  function addRecipient() {
    if (!current.current || current.current.items.length >= LIMITS.rows) return;
    const row = recipientForRequest(current.current, {
      ...newRecipient(),
      assignments: [],
    });
    const index = current.current.items.length;
    edit({ items: [...current.current.items, row] });
    setRowSearch("");
    setRowScope("");
    setSelectedId(row.id);
    setEntryView("table");
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        const input = document.querySelector<HTMLInputElement>(
          `.operator-grid [data-field-path="items.${index}.fullNameRu"], .operator-grid [data-field-path="items.${index}.fullNameKz"]`,
        );
        input?.focus();
        input?.scrollIntoView({ block: "nearest" });
      }),
    );
  }
  if (!draft)
    return (
      <>
        {error ? (
          <Notice>
            {error}
            <button onClick={() => void reload()}>Повторить</button>
          </Notice>
        ) : (
          <div className="initial-state" role="status">
            Загружаем заявку…
          </div>
        )}
      </>
    );
  const readonly =
    draft.status !== "DRAFT" ||
    !!draft.archived ||
    !!draft.archivedAt ||
    context.user.role === "VIEWER";
  const visibleItems = draft.items.filter(
    (item) =>
      (item.id === editingSearchId ||
        [
          item.fullNameRu,
          item.fullNameKz,
          item.personnelNumber,
          item.externalId,
          item.positionRu,
          item.positionKz,
          item.workplaceRu,
          item.workplaceKz,
        ].some((value) =>
          value
            ?.toLocaleLowerCase("ru")
            .includes(rowSearch.toLocaleLowerCase("ru")),
        )) &&
      (!rowScope ||
        (rowScope === "selected"
          ? checked.includes(item.id)
          : rowScope === "unnamed"
            ? !item.fullNameRu.trim()
            : rowScope === "unassigned"
              ? !item.assignments.length
              : rowScope === "errors"
                ? validation?.errors.some(
                    (issue) =>
                      typeof issue !== "string" &&
                      (issue.itemId === item.id ||
                        (issue as { rowId?: string }).rowId === item.id ||
                        String(issue.path || "").startsWith(
                          `items.${draft.items.indexOf(item)}.`,
                        )),
                  )
                : rowScope.startsWith("event:")
                  ? item.assignments.some(
                      (a) => a.eventId === rowScope.slice(6),
                    )
                  : item.assignments.some((a) =>
                      a.templateId.startsWith(rowScope),
                    ))),
  );
  const selected = draft.items.find((item) => item.id === selectedId);
  const centerCommon =
    draft.profileVersionId &&
    draft.profileVersionId !== context.profileVersionId
      ? pinnedCenter?.id === draft.profileVersionId
        ? pinnedCenter.commonFields
        : {}
      : context.profile?.commonFields || {};
  const requestEmployer =
    draft.kind === "COMPANY"
      ? (readonly
          ? draft.organizationSnapshots?.find(
              (entry) => entry.id === draft.customerId,
            )
          : undefined) ||
        customers.find((entry) => entry.id === draft.customerId) ||
        null
      : null;
  const employerRecords = new Map(
    [...customers, ...(readonly ? draft.organizationSnapshots || [] : [])].map(
      (entry) => [entry.id, entry],
    ),
  );
  const resolved =
    serverResolution?.revision === draft.revision
      ? serverResolution.value
      : resolveDraft(
          {
            ...draft,
            items: draft.items.map((item) => {
              const employer = item.employerId
                ? employerRecords.get(item.employerId)
                : requestEmployer;
              return resolveRecipientText({
                ...item,
                workplaceRu: item.workplaceRu || employer?.nameRu || "",
                workplaceKz:
                  item.workplaceKz ||
                  employer?.nameKz ||
                  employer?.nameRu ||
                  "",
              });
            }),
          },
          centerCommon,
        );
  const plan = documentPlan(resolved.draft);
  const assignmentCount = draft.items.reduce(
    (sum, item) => sum + item.assignments.length,
    0,
  );
  const documentCount = plan.documentCount;
  const reviewGroups = groupValidationIssues(
    validation?.errors || [],
    draft.items,
  );
  const missingNames = draft.items.filter(
    (item) => !item.fullNameRu.trim(),
  ).length;
  const missingDocuments = draft.items.filter(
    (item) => !item.assignments.length,
  ).length;
  const dirty =
    saveState === "dirty" || saveState === "saving" || saveState === "error";
  const saveLabel = {
    saved: `${draft.approval?.status === "APPROVED" ? "Согласовано" : "Рабочая версия сохранена"} · редакция ${draft.revision}`,
    dirty: "Есть изменения",
    saving: "Сохраняем…",
    error: "Не сохранено",
  }[saveState];
  const actions = requestActions({
    draft,
    role: context.user.role,
    dirty,
    busy: operationBusy,
  });
  const fieldErrors = Object.fromEntries(
    (validation?.errors || []).flatMap((issue) =>
      typeof issue !== "string" && issue.path
        ? [
            [
              Array.isArray(issue.path) ? issue.path.join(".") : issue.path,
              issue.message,
            ],
          ]
        : [],
    ),
  );
  return (
    <>
      <Link className="back-link" href="/requests">
        ← Все заявки
      </Link>
      <div className="page-heading editor-heading">
        <div>
          <div className="title-with-status">
            <h1>{personRequestName(draft) || draft.title || "Без названия"}</h1>
            <Status value={draft.status} />
          </div>
          <p>
            {draft.kind === "PERSON"
              ? "Заявка на человека"
              : "Заявка организации"}{" "}
            · {draft.items.length} получателей · {assignmentCount} назначений ·{" "}
            {plan.groups.length > 0
              ? `${plan.groups.length} общих протоколов · `
              : ""}
            {documentCount} документов
          </p>
        </div>
        <span className={`save-indicator ${saveState}`} role="status">
          {saveState === "saved" ? (
            <Icon name="check" size={16} />
          ) : (
            <span className="save-dot" />
          )}
          {saveLabel}
        </span>
      </div>
      <button
        className="text-button entry-jump"
        onClick={() => {
          setEntryView("table");
          requestAnimationFrame(() => {
            document
              .getElementById("recipient-workspace")
              ?.scrollIntoView({ block: "start" });
            document
              .querySelector<HTMLInputElement>(
                ".operator-grid tbody input[data-grid-field]",
              )
              ?.focus({ preventScroll: true });
          });
        }}
      >
        К списку получателей
      </button>
      {actions.showPrepareSigning ? (
        <button
          className="primary entry-jump"
          disabled={actions.prepareSigningDisabled}
          onClick={() => void command("finalize")}
        >
          <Icon name="print" />{" "}
          {busy === "finalize" ? "Готовим документы…" : "Подготовить документы"}
        </button>
      ) : actions.showDocuments ? (
        <a className="button primary entry-jump" href="#request-files">
          <Icon name="print" /> Документы и печать
        </a>
      ) : (
        actions.showValidate && (
          <button
            className="primary entry-jump"
            disabled={operationBusy}
            onClick={() => void command("validate")}
          >
            Проверить данные
          </button>
        )
      )}
      {actions.showPrepareSigning && (
        <p className="muted">
          Комплект получит номера и будет готов к печати. Исправления
          подготовленного комплекта оформляются отдельной заявкой.
        </p>
      )}
      <button
        className="entry-jump"
        aria-haspopup="dialog"
        onClick={() => setExtraPanel("menu")}
      >
        Прочее
      </button>
      <ol className="workflow" aria-label="Этапы оформления">
        <li className={readonly ? "complete" : "active"}>
          <span>1</span>Сотрудники и обучение
        </li>
        <li className={validation?.valid && !reviewStale ? "complete" : ""}>
          <span>2</span>Проверка и согласование
        </li>
        <li className={readonly ? "active" : ""}>
          <span>3</span>Документы и печать
        </li>
      </ol>
      <ApprovalBanner
        draft={draft}
        role={context.user.role}
        compact
        onRefresh={async () => {
          if (!readonly) await flush();
          await reload();
        }}
      />
      {error && (
        <Notice>
          {error}
          {saveState === "error" && (
            <button onClick={() => void command("save")}>
              Повторить сохранение
            </button>
          )}
        </Notice>
      )}
      {draft.demoMode && (
        <Notice kind="info">
          Тестовые данные. Файлы будут отмечены «ДЕМО — НЕ ЯВЛЯЕТСЯ ВЫДАННЫМ
          ДОКУМЕНТОМ».
        </Notice>
      )}
      <section className="panel request-meta">
        <label>
          {draft.kind === "PERSON"
            ? "Заказчик и название заявки"
            : "Название заявки"}
          <input
            aria-label="Название заявки"
            disabled={readonly || operationBusy}
            readOnly={draft.kind === "PERSON"}
            value={personRequestName(draft) || draft.title}
            maxLength={255}
            onChange={(event) => edit({ title: event.target.value })}
          />
          {draft.kind === "PERSON" && (
            <small>Заполняется из ФИО получателя ниже.</small>
          )}
        </label>
        {draft.kind === "COMPANY" && (
          <div className="request-customer">
            <label>
              Компания / работодатель всех сотрудников
              <select
                disabled={readonly || operationBusy}
                value={draft.customerId || ""}
                onChange={(event) =>
                  edit({ customerId: event.target.value || null })
                }
              >
                <option value="">Выберите организацию</option>
                {customers.map((customer) => (
                  <option key={customer.id} value={customer.id}>
                    {customer.nameRu}
                    {customer.archived ? " (архив)" : ""}
                  </option>
                ))}
              </select>
            </label>
            <small>
              Компания применяется ко всем получателям. Особые сведения старых
              заявок доступны в деталях сотрудника.
            </small>
            {!readonly && (
              <button
                className="text-button"
                onClick={() => setDialog("customerPicker")}
              >
                Найти в справочнике
              </button>
            )}
            {!readonly && (
              <button
                className="text-button"
                onClick={() => setDialog("customer")}
              >
                Добавить заказчика
              </button>
            )}
          </div>
        )}
        <label>
          Общая дата документов
          <input
            type="date"
            data-field-path="commonFields.documentDate"
            aria-describedby="common-document-date-hint"
            disabled={readonly || operationBusy}
            value={
              draft.commonFields?.documentDate ??
              draft.presetFields?.documentDate ??
              ""
            }
            onChange={(event) =>
              edit({
                schemaVersion: 2,
                commonFields: {
                  ...draft.commonFields,
                  documentDate: event.target.value,
                },
              })
            }
          />
          <small id="common-document-date-hint">
            Для документов без индивидуальной даты
          </small>
        </label>
        <label className="checkbox">
          <input
            type="checkbox"
            disabled={readonly || operationBusy || context.tenant.demoOnly}
            checked={draft.demoMode}
            onChange={(event) => edit({ demoMode: event.target.checked })}
          />
          Тестовый комплект
        </label>
      </section>
      {!!draft.events?.length && (
        <details
          className="panel bundle-overview"
          aria-label="Состав комплекта"
        >
          <summary>
            Состав комплекта: {documentCount} документов, общих протоколов —{" "}
            {plan.groups.length}
          </summary>
          {draft.events.map((event) => {
            const bundle = Object.values(requestBundles).find(
              (choice) => choice.protocol === event.protocolTemplateId,
            );
            if (!bundle) return null;
            const count = draft.items.filter((person) =>
              person.assignments.some(
                (assignment) => assignment.eventId === event.id,
              ),
            ).length;
            return (
              <p key={event.id}>
                <strong>{event.title}:</strong> {count} индивидуальных
                документов и 1 общий протокол. Документы участников выпускаются
                после подтверждения результата; номера назначаются при
                оформлении.
              </p>
            );
          })}
        </details>
      )}
      {undo && !readonly && (
        <Notice kind="info">
          {undo.removedId
            ? "Получатель убран из заявки. До следующей правки его можно восстановить."
            : "Последнее массовое изменение сохранено."}{" "}
          <button
            disabled={
              operationBusy || dirty || draft.revision !== undo.revision
            }
            onClick={async () => {
              setBusy("undo");
              setError("");
              try {
                const result = await api<{ revision: number }>(
                  `/print-requests/${id}`,
                  {
                    method: "PATCH",
                    body: json({
                      expectedRevision: undo.revision,
                      draft: draftPayload(undo.before),
                    }),
                  },
                );
                initialize({ ...undo.before, revision: result.revision });
                if (undo.removedId) {
                  setSelectedId(undo.removedId);
                  setEntryView("table");
                  setRowSearch("");
                  setRowScope("");
                  const restoredIndex = undo.before.items.findIndex(
                    (item) => item.id === undo.removedId,
                  );
                  requestAnimationFrame(() => {
                    const field = document.querySelector<HTMLInputElement>(
                      `.operator-grid [data-field-path="items.${restoredIndex}.fullNameRu"], .operator-grid [data-field-path="items.${restoredIndex}.fullNameKz"]`,
                    );
                    field?.focus();
                    field?.scrollIntoView({ block: "center" });
                  });
                }
                setUndo(null);
              } catch (caught) {
                setError(errorText(caught));
              } finally {
                setBusy("");
              }
            }}
          >
            {undo.removedId
              ? "Восстановить получателя"
              : "Отменить массовое изменение"}
          </button>
          {(dirty || draft.revision !== undo.revision) && (
            <span>
              {" "}
              После следующей правки автоматическая отмена недоступна.
            </span>
          )}
        </Notice>
      )}
      <section className="panel recipients-panel" id="recipient-workspace">
        <div className="toolbar">
          <div>
            <h2>Получатели</h2>
            <span className="muted">
              {draft.items.length} из {LIMITS.rows}
            </span>
          </div>
          {!readonly && (
            <div className="toolbar-actions">
              <button
                className="primary"
                disabled={operationBusy || !draft.items.length}
                onClick={() =>
                  setDocumentTargets(
                    checked.length
                      ? [...checked]
                      : draft.items.map((item) => item.id),
                  )
                }
              >
                <Icon name="plus" />
                {checked.length
                  ? `Обучение выбранным (${checked.length})`
                  : "Обучение для всех"}
              </button>
              <button
                disabled={operationBusy}
                onClick={() => setDialog("import")}
              >
                <Icon name="upload" />
                Импорт / вставка
              </button>
              <button
                disabled={draft.items.length >= LIMITS.rows || operationBusy}
                onClick={addRecipient}
              >
                <Icon name="plus" />
                Получатель
              </button>
              <details className="recipient-extra-tools">
                <summary>Ещё</summary>
                <div>
                  {draft.kind === "PERSON" && (
                    <button
                      disabled={operationBusy || !draft.items.length}
                      onClick={() =>
                        setEmployerTargets(
                          checked.length
                            ? [...checked]
                            : draft.items.map((item) => item.id),
                        )
                      }
                    >
                      Указать место работы
                    </button>
                  )}
                  <button
                    disabled={
                      operationBusy || draft.items.length >= LIMITS.rows
                    }
                    onClick={() => setDialog("recipientPicker")}
                  >
                    Найти человека
                  </button>
                  <button
                    disabled={operationBusy || !draft.items.length}
                    onClick={() => setDialog("photos")}
                  >
                    Сопоставить фото
                  </button>
                  <button
                    disabled={!checked.length || operationBusy}
                    onClick={() => setDialog("bulk")}
                  >
                    Изменить данные выбранных ({checked.length})
                  </button>
                </div>
              </details>
            </div>
          )}
        </div>
        {!readonly && (missingNames > 0 || missingDocuments > 0) && (
          <div className="entry-progress" role="status">
            <span>Продолжите заполнение:</span>
            {missingNames > 0 && (
              <button
                className="text-button"
                onClick={() => {
                  setRowSearch("");
                  setRowScope("unnamed");
                  setEntryView("table");
                }}
              >
                без ФИО — {missingNames}
              </button>
            )}
            {missingDocuments > 0 && (
              <button
                className="text-button"
                onClick={() =>
                  setDocumentTargets(
                    draft.items
                      .filter((item) => !item.assignments.length)
                      .map((item) => item.id),
                  )
                }
              >
                выбрать документы — {missingDocuments}
              </button>
            )}
          </div>
        )}
        <div className="toolbar selection-toolbar">
          <label className="search-field recipient-search">
            Поиск в заявке
            <input
              value={rowSearch}
              onChange={(e) => {
                setRowSearch(e.target.value);
                setEditingSearchId("");
              }}
              placeholder="ФИО, должность, организация или номер"
            />
          </label>
          <span aria-live="polite">
            Показано: {visibleItems.length}. Выбрано: {checked.length}, из них
            скрыто поиском:{" "}
            {
              checked.filter(
                (id) => !visibleItems.some((item) => item.id === id),
              ).length
            }
            .
            {rowScope === "errors" &&
              reviewStale &&
              " Замечания последней проверки; перепроверьте после исправлений."}
          </span>
          <label>
            Показать строки
            <select
              value={rowScope}
              onChange={(e) => setRowScope(e.target.value)}
            >
              <option value="">Все</option>
              <option value="selected">Выбранные</option>
              <option value="unnamed">Без ФИО на русском</option>
              <option value="unassigned">Без документов</option>
              <option value="errors">С ошибками последней проверки</option>
              <option value="pb-">Промышленная безопасность</option>
              <option value="ptm-">Пожарно-технический минимум</option>
              <option value="biot-">БиОТ</option>
              <option value="ps-">Промышленное свидетельство</option>
              {draft.events?.map((event) => (
                <option key={event.id} value={`event:${event.id}`}>
                  Событие: {event.title}
                </option>
              ))}
            </select>
          </label>
          {checked.length > 0 && (
            <button onClick={() => setChecked([])}>Снять выбор</button>
          )}
          {(rowSearch || rowScope) && (
            <button
              onClick={() => {
                setRowSearch("");
                setRowScope("");
              }}
            >
              Сбросить фильтры
            </button>
          )}
        </div>
        <div className="entry-view-toolbar">
          <div
            className="entry-view-switch"
            role="group"
            aria-label="Режим заполнения"
          >
            <button
              aria-pressed={entryView === "table"}
              onClick={returnToTable}
            >
              Таблица
            </button>
            <button
              aria-pressed={entryView === "card"}
              disabled={!selected}
              onClick={() => selected && openRecipient(selected.id)}
            >
              Карточка получателя
            </button>
          </div>
          <span className="muted">
            {entryView === "table"
              ? "Введите людей, укажите категорию и назначьте обучение. Обязательные документы включаются автоматически."
              : "Индивидуальные документы, даты и исключения выбранного человека."}
          </span>
        </div>
        <div
          hidden={entryView !== "table"}
          onFocusCapture={(event) => {
            if ((event.target as HTMLElement).matches("[data-grid-field]"))
              lastGridField.current = event.target as HTMLElement;
          }}
        >
          <RecipientGrid
            items={draft.items}
            visibleItems={visibleItems}
            resolvedItems={resolved.draft.items}
            selectedId={selectedId}
            checked={checked}
            disabled={operationBusy}
            readonly={readonly}
            fieldErrors={fieldErrors}
            onEdit={editRecipient}
            onSelect={setSelectedId}
            onOpen={openRecipient}
            onDocuments={(recipientId) => setDocumentTargets([recipientId])}
            onChecked={setChecked}
            onRemove={setRemoveId}
            onPaste={(range) => {
              if (rowSearch || rowScope) {
                setError(
                  "Перед вставкой диапазона сбросьте поиск и фильтры, чтобы видеть все изменяемые строки.",
                );
                return;
              }
              setPastedRange(range);
            }}
            onAdd={addRecipient}
            canAdd={
              draft.items.length < LIMITS.rows && !operationBusy && !readonly
            }
          />
          {!!draft.items.length && !visibleItems.length && (
            <div className="empty-state" role="status">
              <h3>Получатели не найдены</h3>
              <p>Измените запрос или сбросьте фильтры.</p>
              <button
                onClick={() => {
                  setRowSearch("");
                  setRowScope("");
                }}
              >
                Показать всех получателей
              </button>
            </div>
          )}
        </div>
        <div
          className="editor-grid operator-card-view"
          hidden={entryView !== "card"}
        >
          <div
            className="recipient-card-list"
            role="region"
            aria-label="Список получателей"
          >
            <button className="text-button" onClick={returnToTable}>
              Вернуться к таблице
            </button>
            {visibleItems.map((item) => (
              <button
                key={item.id}
                className="recipient-card-link"
                aria-pressed={selectedId === item.id}
                onClick={() => openRecipient(item.id)}
              >
                <span className="muted">{draft.items.indexOf(item) + 1}</span>
                <span>
                  <strong>
                    {item.fullNameRu || item.fullNameKz || "Без ФИО"}
                  </strong>
                  <small>{item.positionRu || "Должность не указана"}</small>
                </span>
                <span>{item.assignments.length} док.</span>
              </button>
            ))}
            {!visibleItems.length && (
              <p className="muted">По фильтру нет получателей.</p>
            )}
          </div>
          <aside
            ref={recipientDetailRef}
            className="recipient-details"
            aria-label="Редактор получателя"
            tabIndex={-1}
          >
            {selected ? (
              <RecipientDetails
                recipient={selected}
                resolvedRecipient={resolved.draft.items.find(
                  (item) => item.id === selected.id,
                )}
                provenance={resolved.provenance}
                disabled={readonly || operationBusy}
                onChange={editRecipient}
                context={context}
                rowIndex={draft.items.indexOf(selected)}
                focusFieldPath={focusFieldPath}
                fieldErrors={fieldErrors}
                liveRules={draft.businessRuleVersion === "LIVE_V1"}
                englishAppendix={draft.englishAppendix}
                requestEmployer={
                  requestEmployer
                    ? {
                        id: requestEmployer.id,
                        nameRu: requestEmployer.nameRu,
                        nameKz:
                          requestEmployer.nameKz || requestEmployer.nameRu,
                      }
                    : null
                }
              />
            ) : (
              <p className="muted">
                Выберите получателя, чтобы настроить документы и даты.
              </p>
            )}
          </aside>
        </div>
      </section>
      <section
        className="panel training-overview"
        aria-label="Языки документов"
      >
        <h2>Языки документов</h2>
        <label className="english-appendix-toggle">
          <input
            type="checkbox"
            checked={!!draft.englishAppendix}
            disabled={readonly || operationBusy}
            onChange={(event) =>
              edit({ englishAppendix: event.target.checked })
            }
          />
          <span>
            <strong>Добавить английскую страницу</strong>
            <small>
              Основные формы всегда казахско-русские. Английская версия
              добавляется в тот же документ с тем же номером.
            </small>
          </span>
        </label>
      </section>
      <TrainingOverview
        draft={draft}
        resolvedEvents={resolved.draft.events}
        disabled={readonly || operationBusy}
        onChange={edit}
      />
      {validation && (
        <div ref={errorsRef} tabIndex={-1} className="validation-result">
          <Notice
            kind={reviewStale ? "info" : validation.valid ? "success" : "error"}
          >
            <strong>
              {reviewStale
                ? "Данные изменены после проверки"
                : validation.valid
                  ? "Данные прошли проверку"
                  : "Исправьте данные перед оформлением"}
            </strong>
            <span>
              Редакция {validationRevision}.{" "}
              {reviewStale &&
                "После сохранения замечания обновятся автоматически. Можно также проверить заявку повторно."}
              {validation.valid
                ? `Документов: ${validation.documentCount ?? documentCount}. Проверьте макет перед оформлением.`
                : ""}
            </span>
            {reviewStale && (
              <button
                className="text-button"
                disabled={operationBusy}
                onClick={() => void command("validate")}
              >
                Проверить снова
              </button>
            )}
            {validation.errors.length > 0 && (
              <div className="review-issue-groups">
                {reviewGroups.map((group) => (
                  <section key={group.key} className="review-issue-group">
                    <h3>{group.title}</h3>
                    <ul>
                      {group.issues.map(
                        ({ issue, document: documentLabel }, index) => (
                          <li key={index}>
                            <button
                              className="text-button"
                              onClick={() => {
                                if (typeof issue !== "string") {
                                  const rowId =
                                    (issue as { rowId?: string }).rowId ||
                                    issue.itemId;
                                  if (rowId) setSelectedId(rowId);
                                  const path = Array.isArray(issue.path)
                                    ? issue.path.join(".")
                                    : issue.path || "";
                                  setFocusFieldPath(path);
                                  const targetRow =
                                    draft.items.find(
                                      (item) => item.id === rowId,
                                    ) ||
                                    draft.items[
                                      Number(/^items\.(\d+)/.exec(path)?.[1])
                                    ];
                                  if (
                                    /^items\.\d+\.assignments$/.test(path) &&
                                    targetRow &&
                                    !targetRow.assignments.length
                                  ) {
                                    setDocumentTargets([targetRow.id]);
                                    return;
                                  }
                                  const personField =
                                    /^items\.\d+\.([^.]+)$/.exec(path)?.[1];
                                  const inGrid =
                                    personField === "fullNameRu" ||
                                    personField === "positionRu";
                                  setEntryView(inGrid ? "table" : "card");
                                  const rowIndex = /items\.(\d+)/.exec(
                                    path,
                                  )?.[1];
                                  if (rowIndex && draft.items[Number(rowIndex)])
                                    setSelectedId(
                                      draft.items[Number(rowIndex)].id,
                                    );
                                  setRowSearch("");
                                  setRowScope("");
                                  requestAnimationFrame(() => {
                                    window.dispatchEvent(
                                      new CustomEvent("demo:focus-field", {
                                        detail: path,
                                      }),
                                    );
                                    const input = Array.from(
                                      document.querySelectorAll<HTMLElement>(
                                        `[data-field-path="${CSS.escape(path)}"]`,
                                      ),
                                    ).find(
                                      (element) =>
                                        element.getClientRects().length > 0,
                                    );
                                    let ancestor = input?.parentElement;
                                    while (ancestor) {
                                      if (
                                        ancestor instanceof HTMLDetailsElement
                                      )
                                        ancestor.open = true;
                                      ancestor = ancestor.parentElement;
                                    }
                                    input?.focus();
                                    input?.scrollIntoView({ block: "center" });
                                  });
                                }
                              }}
                            >
                              {documentLabel && (
                                <span className="review-document">
                                  {documentLabel}:{" "}
                                </span>
                              )}
                              {typeof issue === "string"
                                ? issue
                                : issue.message}
                            </button>
                          </li>
                        ),
                      )}
                    </ul>
                  </section>
                ))}
              </div>
            )}
            {validation.warnings?.map((warning, i) => (
              <p key={i}>
                {typeof warning === "string" ? warning : warning.message}
                {typeof warning !== "string" &&
                  warning.candidates
                    ?.filter((candidate) =>
                      /^\/requests\/[^/]+(?:\/edit)?$/.test(
                        candidate.historyPath,
                      ),
                    )
                    .map((candidate) => (
                      <Link
                        className="button"
                        key={candidate.historyPath + candidate.number}
                        href={candidate.historyPath}
                      >
                        Открыть прежний документ
                        {candidate.number ? ` № ${candidate.number}` : ""}
                      </Link>
                    ))}
              </p>
            ))}
          </Notice>
        </div>
      )}
      {draft.status !== "DRAFT" && (
        <details className="panel">
          <summary>Электронные подписи</summary>
          <SigningPanel
            requestId={id}
            role={context.user.role}
            onChanged={() => void reload()}
          />
        </details>
      )}
      <FilesPanel
        requestId={id}
        draft={draft}
        refresh={refreshFiles}
        previewStale={
          previewRevision !== null &&
          (previewRevision !== draft.revision || dirty)
        }
        readonly={readonly}
        allowPrint={actions.showDocuments}
        previewPrintAllowed={actions.canPrintCurrentPreview}
        canManage={context.user.role !== "VIEWER"}
        onChanged={() => void reload()}
      />
      <RequestActivity
        requestId={id}
        role={context.user.role}
        revision={draft.revision}
      />
      {extraPanel && (
        <Modal
          key={extraPanel}
          wide={extraPanel !== "menu"}
          title={
            {
              menu: "Прочее",
              dates: "Общие даты и протоколы",
              review: "Согласование и передача",
              output: "Комплект для заказчика",
              operations: "Связанные действия",
            }[extraPanel]
          }
          onClose={closeExtraPanel}
        >
          {extraPanel === "menu" && (
            <div className="request-more-actions">
              <div className="request-menu-group">
                {actions.showSave && (
                  <button
                    disabled={operationBusy}
                    onClick={() => {
                      closeExtraPanel();
                      void command("save");
                    }}
                  >
                    Сохранить изменения
                  </button>
                )}
                {actions.showValidate && (
                  <button
                    disabled={operationBusy}
                    onClick={() => {
                      closeExtraPanel();
                      void command("validate");
                    }}
                  >
                    Проверить заявку
                  </button>
                )}
                {actions.showPreview && (
                  <button
                    disabled={operationBusy}
                    onClick={() => {
                      closeExtraPanel();
                      void command("preview");
                    }}
                  >
                    Предпросмотр документов
                  </button>
                )}
                {actions.showDecision && draft.approval && (
                  <Link
                    className="button"
                    href={`/approvals?proposal=${encodeURIComponent(draft.approval.proposalId)}`}
                  >
                    Проверить и принять решение
                  </Link>
                )}
                {!actions.showDecision && draft.approval && (
                  <Link
                    className="button"
                    href={`/approvals?proposal=${encodeURIComponent(draft.approval.proposalId)}`}
                  >
                    Состояние согласования
                  </Link>
                )}
                <button
                  disabled={operationBusy}
                  onClick={() => {
                    closeExtraPanel();
                    void (readonly ? reload() : flush().then(reload)).catch(
                      (caught) => setError(errorText(caught)),
                    );
                  }}
                >
                  Обновить состояние
                </button>
              </div>
              <div className="request-menu-group">
                <button onClick={() => setExtraPanel("dates")}>
                  Общие даты и протоколы
                </button>
                <button onClick={() => setExtraPanel("review")}>
                  Согласование и передача
                </button>
                <button onClick={() => setExtraPanel("output")}>
                  Комплект для заказчика
                </button>
                <button onClick={() => setExtraPanel("operations")}>
                  Связанные действия
                </button>
              </div>
            </div>
          )}
          {extraPanel === "dates" && (
            <EventContext
              embedded
              draft={draft}
              centerCommon={centerCommon}
              selectedIds={checked}
              disabled={readonly || operationBusy}
              onChange={edit}
              onApply={applyOperation}
              onContextCommit={rememberContextOperation}
              onBusyChange={setContextBusy}
            />
          )}
          {extraPanel === "review" && (
            <CustomerReview
              embedded
              draft={draft}
              flush={flush}
              canManage={context.user.role !== "VIEWER"}
            />
          )}
          {extraPanel === "output" && (
            <CustomerOutput
              embedded
              draft={draft}
              canManage={context.user.role !== "VIEWER"}
            />
          )}
          {extraPanel === "operations" && (
            <RequestOperations
              embedded
              draft={draft}
              selected={selected}
              flush={flush}
              canManage={context.user.role !== "VIEWER"}
            />
          )}
          {extraPanel !== "menu" && (
            <div className="modal-actions">
              <button
                onClick={() => {
                  if (document.activeElement instanceof HTMLElement)
                    document.activeElement.blur();
                  setExtraPanel("menu");
                }}
              >
                ← К меню «Прочее»
              </button>
            </div>
          )}
        </Modal>
      )}
      {removeId && (
        <Modal
          title="Убрать получателя из заявки?"
          onClose={() => setRemoveId(null)}
        >
          <p>
            {draft.items.find((item) => item.id === removeId)?.fullNameRu ||
              "Получатель без ФИО"}
            : из этой заявки будут убраны данные и назначения документов.
          </p>
          <div className="modal-actions">
            <button disabled={operationBusy} onClick={() => setRemoveId(null)}>
              Оставить
            </button>
            <button
              disabled={operationBusy}
              onClick={async () => {
                const next = draft.items.filter((item) => item.id !== removeId);
                if (await applyOperation({ items: next }, removeId)) {
                  setChecked((ids) => ids.filter((item) => item !== removeId));
                  setRemoveId(null);
                }
              }}
            >
              Убрать из заявки
            </button>
          </div>
        </Modal>
      )}
      {pastedRange && (
        <GridPasteDialog
          items={draft.items}
          {...pastedRange}
          onClose={() => setPastedRange(null)}
          onApply={async (items) => {
            const existing = new Set(draft.items.map((person) => person.id));
            const addedToBundle = items.map((person) =>
              existing.has(person.id)
                ? person
                : recipientForRequest(draft, person),
            );
            if (await applyOperation({ items: addedToBundle }))
              setPastedRange(null);
          }}
        />
      )}
      {dialog === "photos" && (
        <BulkPhotoDialog
          items={draft.items}
          customerId={draft.customerId}
          disabled={operationBusy}
          onClose={() => setDialog(null)}
          onApply={async (updates) => {
            const applied = await applyOperation({
              items: draft.items.map((item) =>
                updates[item.id]
                  ? { ...item, photoAssetId: updates[item.id] }
                  : item,
              ),
            });
            if (applied) setDialog(null);
            return applied;
          }}
        />
      )}
      {dialog === "customerPicker" && (
        <RecordPicker
          kind="customers"
          onClose={() => setDialog(null)}
          onCustomer={(customer) => {
            setCustomers((old) => [
              ...old.filter((c) => c.id !== customer.id),
              customer,
            ]);
            edit({ customerId: customer.id });
            setDialog(null);
          }}
        />
      )}
      {dialog === "recipientPicker" && (
        <RecordPicker
          kind="recipients"
          onClose={() => setDialog(null)}
          onRecipient={(person) => {
            const empty =
              draft.items.length === 1 &&
              !draft.items[0].fullNameRu &&
              !draft.items[0].fullNameKz;
            const participant = recipientForRequest(draft, person);
            edit({
              items: empty ? [participant] : [...draft.items, participant],
            });
            setRowSearch("");
            setRowScope("");
            openRecipient(participant.id);
            setDialog(null);
          }}
        />
      )}
      {dialog === "customer" && (
        <CustomerDialog
          customer={{}}
          onClose={() => setDialog(null)}
          onSaved={(customer) => {
            setCustomers([...customers, customer]);
            edit({ customerId: customer.id });
            setDialog(null);
          }}
        />
      )}
      {dialog === "import" && (
        <ImportDialog
          requestId={id}
          bundleEvent={draft.events?.length === 1 ? draft.events[0] : undefined}
          existingDraft={draft}
          existingImportIds={draft.items.flatMap((item) =>
            item.importId ? [item.importId] : [],
          )}
          flush={flush}
          onClose={() => setDialog(null)}
          onApplied={(value) => {
            initialize(value);
            setDialog(null);
          }}
        />
      )}
      {dialog === "bulk" && (
        <BulkDialog
          items={draft.items}
          resolvedItems={resolved.draft.items}
          selectedIds={checked}
          operationError={error}
          onClose={() => setDialog(null)}
          onApply={async (items) => {
            if (await applyOperation({ items })) setDialog(null);
          }}
        />
      )}{" "}
      {documentTargets && !readonly && (
        <TrainingBundleDialog
          draft={draft}
          selectedIds={documentTargets}
          disabled={operationBusy}
          onClose={() => setDocumentTargets(null)}
          onApply={async (next) => {
            if (
              !(await applyOperation({
                items: next.items,
                events: next.events,
                businessRuleVersion: "LIVE_V1",
              }))
            )
              throw new Error(
                "Не удалось сохранить документы. Повторите попытку.",
              );
            setDocumentTargets(null);
          }}
        />
      )}
      {employerTargets && !readonly && (
        <SharedEmployerDialog
          items={draft.items}
          selectedIds={employerTargets}
          customer={customers.find(
            (customer) => customer.id === draft.customerId,
          )}
          onEmployerChosen={(customer) =>
            setCustomers((old) => [
              ...old.filter((entry) => entry.id !== customer.id),
              customer,
            ])
          }
          onClose={() => setEmployerTargets(null)}
          onApply={async (items) => {
            if (!(await applyOperation({ items })))
              throw new Error("Не удалось сохранить организацию.");
            setEmployerTargets(null);
          }}
        />
      )}
      {dialog === "conflict" && (
        <Modal
          title="Заявка изменена в другом окне"
          onClose={() => setDialog(null)}
        >
          <p>
            Ваш ввод сохранён на этой странице. Чтобы не затереть изменения
            коллеги, автоматическое сохранение остановлено.
          </p>
          <p>
            Можно перенести ваш ввод в отдельную заявку или загрузить актуальную
            версию с сервера. Загрузка заменит несохранённый ввод.
          </p>
          {error && <Notice>{error}</Notice>}
          <div className="modal-actions">
            <button disabled={operationBusy} onClick={() => void reload()}>
              Загрузить версию сервера
            </button>
            <button
              className="primary"
              disabled={operationBusy}
              onClick={() => void copyConflict()}
            >
              Сохранить мой ввод в копию
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}
