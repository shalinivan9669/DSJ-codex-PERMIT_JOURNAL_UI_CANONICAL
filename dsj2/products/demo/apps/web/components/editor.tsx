"use client";
import "./operator-form.css";
import { BulkDialog } from "./bulk-dialog";
import { RecordPicker } from "./record-picker";
import { EventContext } from "./event-context";
import { CustomerOutput } from "./customer-output";
import { CustomerReview } from "./customer-review";
import { RequestOperations } from "./request-operations";
import { GridPasteDialog } from "./grid-paste-dialog";
import { quickGridPaste, type GridField } from "@/lib/grid-paste";
import {
  organizationPreparationKey,
  parseOrganizationPreparation,
  assertOrganizationPreparationCurrent,
  writeOrganizationPreparation,
  OrganizationPreparationConflictError,
  type OrganizationPreparation,
} from "@/lib/organization-preparation";
import { BulkPhotoDialog } from "./bulk-photo-dialog";
import { RecipientGrid } from "./recipient-grid";
import { RequestTrainingChoices } from "./request-training-choices";
import { TrainingBundleDialog } from "./training-bundle-dialog";
import { TrainingOverview } from "./training-overview";
import { RequestActivity } from "./request-activity";
import { ApprovalBanner } from "./approvals";
import { BatchReadyPanel } from "./batch-ready-panel";
import { SigningPanel } from "./signing-panel";
import { SharedEmployerDialog } from "./shared-employer-dialog";
import { CourseSharedFields } from "./course-shared-fields";
import { groupValidationIssues } from "@/lib/validation-groups";
import { validationErrors } from "@/lib/validation-errors";
import { draftReadiness, trainingOutcomeSummary } from "@/lib/draft-readiness";
import { recipientRowDate } from "@/lib/recipient-row-date";
import { trainingDisplayTitle } from "@/lib/training-display";
import { effectiveRecipientEmployer } from "@/lib/recipient-employer";
import { addressIssue, type AddressedIssue } from "@/lib/validation-address";
import {
  trainingRemovalTarget,
  type TrainingRemoval,
  type RemovalTarget,
} from "@/lib/training-removal";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { Icon, Modal, Notice } from "@demo/ui";
import {
  LIMITS,
  isBlankText,
  resolveDraft,
  resolveRecipientText,
  documentPlan,
  type CommonFields,
  applyBusinessRules,
  commonFieldKeys,
  trainingDirection,
  type TrainingDirection,
  isTechnicalBlankRecipient,
} from "@demo/contracts";
import {
  api,
  ApiError,
  errorText,
  json,
  BEFORE_LOGOUT_EVENT,
  NavigationBlockedError,
} from "@/lib/api";
import { AutosaveLane } from "@/lib/autosave";
import {
  prepareConflictCopy,
  type ConflictCopyAttempt,
} from "@/lib/conflict-copy";
import {
  flushPreparations,
  preparationsNeedSave,
} from "@/lib/use-durable-preparation";
import { requestActions } from "@/lib/request-actions";
import { useUnsavedNavigation } from "@/lib/use-unsaved-navigation";
import {
  recipientForRequest,
  assignTrainingBundle,
} from "@/lib/request-bundles";
import { PersonEditor } from "./person-editor";
import type { PersonStage } from "@/lib/person-flow";
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
  type Profile,
} from "@/lib/types";
import { CustomerDialog } from "./customers";
import {
  RequestOrganizationFields,
  emptyRequestOrganization,
  createRequestCustomer,
  type RequestOrganizationSelection,
} from "./request-organization-fields";
import { PhotoDialog, RecipientDetails } from "./recipient-details";
import { ImportDialog } from "./import-dialog";
import { FilesPanel } from "./files-panel";
import { DocumentPreview } from "./document-preview";
import type { PreviewTarget } from "@demo/contracts";
import { Status } from "./request-list";

export function Editor({ id, context }: { id: string; context: AppContext }) {
  const router = useRouter();
  const [draft, setDraft] = useState<Draft | null>(null);
  const current = useRef<Draft | null>(null);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [organizationSelection, setOrganizationSelection] =
    useState<RequestOrganizationSelection | null>(null);
  const [organizationError, setOrganizationError] = useState("");
  const [editingCustomer, setEditingCustomer] = useState<Customer | null>(null);
  const pendingOrganization = useRef(false);
  const organizationGeneration = useRef(0);
  const organizationInFlight = useRef(false);
  const [organizationBusy, setOrganizationBusy] = useState(false);
  const [organizationSaved, setOrganizationSaved] = useState(false);
  const organizationPreparation = useRef<OrganizationPreparation | null>(null);
  const organizationExpectedRaw = useRef<string | null>(null);
  const [organizationConflict, setOrganizationConflict] = useState(false);
  const organizationSelectionRef = useRef(organizationSelection);
  const organizationStorageReady = useRef(true);
  organizationSelectionRef.current = organizationSelection;
  const organizationKey = organizationPreparationKey(
    context.tenant.id,
    context.user.id,
    id,
  );
  pendingOrganization.current =
    organizationSelection?.mode === "new" &&
    !!(
      organizationSelection.names.ownNameRu?.trim() ||
      organizationSelection.names.nameRu.trim() ||
      organizationSelection.names.ownNameKz?.trim() ||
      organizationSelection.names.nameKz.trim()
    );
  const [selectedId, setSelectedId] = useState("");
  const [personStage, setPersonStage] = useState<PersonStage>("identity");
  const [checked, setChecked] = useState<string[]>([]);
  const [documentTargets, setDocumentTargets] = useState<string[] | null>(null);
  const [employerTargets, setEmployerTargets] = useState<string[] | null>(null);
  const [rowSearch, setRowSearch] = useState("");
  const [listToolsOpen, setListToolsOpen] = useState<boolean | null>(null);
  const [editingSearchId, setEditingSearchId] = useState("");
  const [entryView, setEntryView] = useState<"table" | "card">("table");
  const previousEntryView = useRef<"table">("table");
  const [photoRecipientId, setPhotoRecipientId] = useState<string | null>(null);
  const [targetPreview, setTargetPreview] = useState<{
    target?: PreviewTarget;
    revision: number;
  } | null>(null);
  useEffect(() => {
    setTargetPreview((preview) =>
      preview && preview.revision !== draft?.revision ? null : preview,
    );
  }, [draft?.revision]);
  const [reviewStale, setReviewStale] = useState(false);
  const [focusFieldPath, setFocusFieldPath] = useState<string | null>(null);
  const validationRequested = useRef(false);
  const validationSerial = useRef(0);
  const focusValidation = useRef(false);
  const focusIssueAction = useRef<
    (issue: Validation["errors"][number]) => void
  >(() => undefined);
  const consumedIssueQuery = useRef("");
  useEffect(() => {
    const focus = (event: Event) =>
      focusIssueAction.current(
        (event as CustomEvent<Validation["errors"][number]>).detail,
      );
    window.addEventListener("demo:focus-issue", focus);
    return () => window.removeEventListener("demo:focus-issue", focus);
  }, []);
  useEffect(() => {
    if (!draft || draft.id !== id) return;
    const query = new URLSearchParams(window.location.search);
    const path = query.get("issuePath");
    const signature = id + ":" + query.toString();
    if (!path || consumedIssueQuery.current === signature) return;
    consumedIssueQuery.current = signature;
    const issue: AddressedIssue = {
      message: "Замечание к выбранному составу",
      path,
      rowId: query.get("issueRow") || undefined,
      assignmentId: query.get("issueAssignment") || undefined,
      eventId: query.get("issueEvent") || undefined,
      field: query.get("issueField") || undefined,
    };
    let inner = 0;
    const frame = requestAnimationFrame(() => {
      inner = requestAnimationFrame(() => focusIssueAction.current(issue));
    });
    return () => {
      cancelAnimationFrame(frame);
      cancelAnimationFrame(inner);
    };
  }, [id, draft?.id]);
  const [removeId, setRemoveId] = useState<string | null>(null);
  const [trainingRemoval, setTrainingRemoval] = useState<RemovalTarget | null>(
    null,
  );
  const [removedTrainings, setRemovedTrainings] = useState<TrainingRemoval[]>(
    [],
  );
  const trainingOperationInFlight = useRef(false);
  const trainingRemoveAttempt = useRef<{
    scope: string;
    operationId: string;
  } | null>(null);
  const [restoreConflict, setRestoreConflict] = useState<{
    message: string;
    conflicts: { recipientId?: string; eventId?: string; field: string }[];
  } | null>(null);
  useEffect(() => {
    if (!draft || draft.id !== id) return;
    let active = true;
    void api<{ items: TrainingRemoval[] }>(
      `/print-requests/${id}/training-removals`,
    )
      .then((result) => {
        if (active)
          setRemovedTrainings(
            result.items.filter((operation) => !operation.restored),
          );
      })
      .catch((caught) => {
        if (active) setError(errorText(caught));
      });
    return () => {
      active = false;
    };
  }, [id, draft?.revision]);
  const [pastedRange, setPastedRange] = useState<{
    startRow: number;
    startField: GridField;
    text: string;
    columns?: GridField[];
    reason?: string;
  } | null>(null);
  const [pasteMessage, setPasteMessage] = useState("");
  const [undo, setUndo] = useState<{
    before: Draft;
    revision: number;
    removedId?: string;
  } | null>(null);
  const [saveState, setSaveState] = useState("saved");
  const [conflictPaused, setConflictPaused] = useState(false);
  const copyInFlight = useRef(false);
  const copyAttempt = useRef<ConflictCopyAttempt | null>(null);
  const moreTools = useRef<HTMLDetailsElement>(null);
  const [moreOpen, setMoreOpen] = useState(false);
  const [rowScope, setRowScope] = useState("");
  const [error, setError] = useState("");
  const [referenceRetry, setReferenceRetry] = useState(0);
  const [profileLoadError, setProfileLoadError] = useState("");
  const [organizationLoadError, setOrganizationLoadError] = useState("");
  const [pinnedCenter, setPinnedCenter] = useState<{
    id: string;
    commonFields: CommonFields;
    profile: Profile;
  } | null>(null);
  useEffect(() => {
    const profileId = draft?.profileVersionId;
    setProfileLoadError("");
    if (!profileId || profileId === context.profileVersionId) return;
    let active = true;
    void api<{
      items: { id: string; profile: Profile }[];
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
          profile: profile.profile,
        });
      })
      .catch((caught) => {
        if (active) setProfileLoadError(errorText(caught));
      });
    return () => {
      active = false;
    };
  }, [draft?.profileVersionId, context.profileVersionId, referenceRetry]);
  const missingOrganizationKey = JSON.stringify(
    draft
      ? [
          ...new Set(
            [draft.customerId, ...draft.items.map((item) => item.employerId)]
              .filter((entry): entry is string => !!entry)
              .filter(
                (organizationId) =>
                  !customers.some((customer) => customer.id === organizationId),
              ),
          ),
        ].sort()
      : [],
  );
  useEffect(() => {
    const organizationIds = JSON.parse(missingOrganizationKey) as string[];
    setOrganizationLoadError("");
    if (!organizationIds.length) return;
    let active = true;
    void Promise.allSettled(
      organizationIds.map((organizationId) =>
        api<Customer>(`/customers/${organizationId}`),
      ),
    ).then((results) => {
      if (!active) return;
      const organizations = results.flatMap((result) =>
        result.status === "fulfilled" ? [result.value] : [],
      );
      if (organizations.length)
        setCustomers((old) => [
          ...old.filter(
            (entry) =>
              !organizations.some(
                (organization) => organization.id === entry.id,
              ),
          ),
          ...organizations,
        ]);
      const failed = results.find((result) => result.status === "rejected");
      if (failed?.status === "rejected")
        setOrganizationLoadError(errorText(failed.reason));
    });
    return () => {
      active = false;
    };
  }, [missingOrganizationKey, referenceRetry]);
  const saveError = useRef("");
  const [busy, setBusy] = useState("");
  const [contextBusy, setContextBusy] = useState(false);
  const operationBusy = !!busy || contextBusy || organizationBusy;
  const [pendingRecipientFocus, setPendingRecipientFocus] = useState("");
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
    setExtraPanel(null);
  }
  useEffect(() => {
    if (!moreOpen) return;
    const close = (event: Event) => {
      if (moreTools.current?.contains(event.target as Node)) return;
      if (moreTools.current) moreTools.current.open = false;
    };
    const escape = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape" || document.querySelector("dialog[open]"))
        return;
      if (moreTools.current) {
        moreTools.current.open = false;
        moreTools.current.querySelector("summary")?.focus();
      }
      event.preventDefault();
    };
    document.addEventListener("pointerdown", close);
    document.addEventListener("focusin", close);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("focusin", close);
      document.removeEventListener("keydown", escape);
    };
  }, [moreOpen]);
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
    selectionStart: number | null;
    selectionEnd: number | null;
  } | null>(null);
  const lastGridField = useRef<HTMLElement | null>(null);
  useEffect(() => {
    const rememberWindowScroll = () => {
      const place = gridReturn.current;
      if (
        place?.element?.isConnected &&
        document.activeElement === place.element
      )
        place.windowY = window.scrollY;
    };
    window.addEventListener("scroll", rememberWindowScroll);
    return () => window.removeEventListener("scroll", rememberWindowScroll);
  }, []);
  const initialEntry = useRef("");
  useEffect(() => {
    if (!draft || draft.id !== id || initialEntry.current === id) return;
    initialEntry.current = id;
    if (
      draft.status === "DRAFT" &&
      draft.kind === "PERSON" &&
      context.user.role !== "VIEWER" &&
      draft.items.length === 1 &&
      !draft.items[0].fullNameRu &&
      !draft.items[0].fullNameKz
    ) {
      requestAnimationFrame(() => {
        const input = document.querySelector<HTMLInputElement>(
          '.person-editor [data-field-path="items.0.fullNameRu"]',
        );
        input?.focus();
        input?.scrollIntoView({ block: "center" });
      });
    }
  }, [draft, id, context.user.role]);
  function openRecipient(id: string) {
    if (entryView !== "card") previousEntryView.current = entryView;
    if (entryView === "table") {
      const grid = document.querySelector<HTMLElement>(
        ".recipient-grid-scroll",
      );
      const active = document.activeElement as HTMLElement | null;
      const remembered = lastGridField.current;
      const opener =
        remembered?.isConnected &&
        remembered
          .closest("tr[data-recipient-id]")
          ?.getAttribute("data-recipient-id") === id
          ? remembered
          : active?.closest(".operator-grid")
            ? active
            : remembered;
      const editingPlace =
        gridReturn.current?.element === opener &&
        gridReturn.current.rowId === id
          ? gridReturn.current
          : null;
      gridReturn.current =
        opener
          ?.closest("tr[data-recipient-id]")
          ?.getAttribute("data-recipient-id") === id
          ? {
              element: opener,
              rowId: id,
              scrollTop: editingPlace?.scrollTop ?? grid?.scrollTop ?? 0,
              scrollLeft: editingPlace?.scrollLeft ?? grid?.scrollLeft ?? 0,
              windowY: editingPlace?.windowY ?? window.scrollY,
              selectionStart:
                opener instanceof HTMLInputElement
                  ? opener.selectionStart
                  : null,
              selectionEnd:
                opener instanceof HTMLInputElement ? opener.selectionEnd : null,
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
  function rememberGridField(element: HTMLElement) {
    const grid = element.closest<HTMLElement>(".recipient-grid-scroll");
    const rowId = element
      .closest("tr[data-recipient-id]")
      ?.getAttribute("data-recipient-id");
    if (!grid || !rowId) return;
    lastGridField.current = element;
    gridReturn.current = {
      element,
      rowId,
      scrollTop: grid.scrollTop,
      scrollLeft: grid.scrollLeft,
      windowY: window.scrollY,
      selectionStart:
        element instanceof HTMLInputElement ? element.selectionStart : null,
      selectionEnd:
        element instanceof HTMLInputElement ? element.selectionEnd : null,
    };
  }
  function returnToTable() {
    setEntryView(previousEntryView.current);
    requestAnimationFrame(() => {
      const previous = gridReturn.current;
      const grid = document.querySelector<HTMLElement>(
        ".recipient-grid-scroll",
      );
      const index =
        current.current?.items.findIndex((item) => item.id === selectedId) ??
        -1;
      const fallback = document.querySelector<HTMLElement>(
        `.operator-grid [aria-label="Детали получателя ${index + 1}"]`,
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
      if (
        target instanceof HTMLInputElement &&
        previous?.selectionStart !== null &&
        previous?.selectionStart !== undefined &&
        previous.selectionEnd !== null
      )
        target.setSelectionRange(
          previous.selectionStart,
          previous.selectionEnd,
        );
      if (!previous || previous.rowId !== selectedId)
        target?.scrollIntoView({ block: "center", inline: "nearest" });
      else if (target && grid) {
        const field = target.getBoundingClientRect();
        const viewport = grid.getBoundingClientRect();
        if (
          field.left < viewport.left ||
          field.right > viewport.right ||
          field.top < 0 ||
          field.bottom > window.innerHeight
        )
          target.scrollIntoView({ block: "nearest", inline: "nearest" });
      }
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
      organizationGeneration.current++;
      pendingOrganization.current = false;
      setOrganizationSelection(null);
      setOrganizationError("");
      try {
        const raw = localStorage.getItem(organizationKey);
        organizationExpectedRaw.current = raw;
        const staged = parseOrganizationPreparation(raw);
        setOrganizationConflict(false);
        organizationPreparation.current = staged;
        if (staged) {
          setOrganizationSelection({ mode: "new", names: staged.names });
          organizationSelectionRef.current = {
            mode: "new",
            names: staged.names,
          };
          setOrganizationSaved(true);
          organizationStorageReady.current = true;
        }
      } catch (caught) {
        setOrganizationError(errorText(caught));
      }
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
      setConflictPaused(false);
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
            if (caught instanceof ApiError && caught.status === 409) {
              lane.current?.pause(caught);
              setConflictPaused(true);
              clearTimeout(timer.current);
              setSaveState("paused");
              setDialog("conflict");
            }
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
        focusValidation.current = !new URLSearchParams(
          window.location.search,
        ).has("issuePath");
        void refreshValidation(value.revision).catch((caught) => {
          if (alive.current) setError(errorText(caught));
        });
      }
    },
    [id, refreshValidation, organizationKey],
  );
  useEffect(() => {
    alive.current = true;
    api<Draft>(`/print-requests/${id}`)
      .then((value) => {
        if (alive.current) {
          initialize(value);
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
    const changed = (event: StorageEvent) => {
      if (
        event.key !== organizationKey ||
        event.newValue === organizationExpectedRaw.current
      )
        return;
      organizationStorageReady.current = false;
      setOrganizationSaved(false);
      setOrganizationConflict(true);
      setOrganizationError(new OrganizationPreparationConflictError().message);
    };
    window.addEventListener("storage", changed);
    return () => window.removeEventListener("storage", changed);
  }, [organizationKey]);
  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (
        lane.current?.dirty ||
        (pendingOrganization.current && !organizationStorageReady.current) ||
        preparationsNeedSave()
      ) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    const beforeLogout = (event: Event) => {
      if (
        !lane.current?.dirty &&
        !pendingOrganization.current &&
        !preparationsNeedSave()
      )
        return;
      clearTimeout(timer.current);
      const request = event as CustomEvent<{
        waitUntil: (save: Promise<unknown>) => void;
      }>;
      request.detail.waitUntil(flush(false));
    };
    const navigate = (event: MouseEvent) => {
      const link = (event.target as HTMLElement).closest("a");
      if (
        !link ||
        (!lane.current?.dirty &&
          !pendingOrganization.current &&
          !preparationsNeedSave()) ||
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
      void flush(false)
        .then(() => {
          if (
            target.pathname === window.location.pathname &&
            target.search === window.location.search &&
            target.hash
          ) {
            window.history.pushState(
              window.history.state,
              "",
              target.pathname + target.search + target.hash,
            );
            const anchor = document.getElementById(
              decodeURIComponent(target.hash.slice(1)),
            );
            anchor?.focus();
            anchor?.scrollIntoView({ block: "start" });
          } else router.push(target.pathname + target.search + target.hash);
        })
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
    current.current = next;
    setDraft(next);
    lane.current.edit(draftPayload(next));
    // Preserve feedback while typing; refresh it after the new revision saves.
    setReviewStale(true);
    setServerResolution(null);
    if (!lane.current.paused) setError("");
    clearTimeout(timer.current);
    if (!lane.current.paused)
      timer.current = setTimeout(() => {
        void lane.current?.flush().catch(() => undefined);
      }, 650);
  }
  function editRecipient(value: Recipient) {
    // A matching row must not disappear halfway through correcting its name.
    if (
      (rowSearch || rowScope) &&
      visibleItems.some((item) => item.id === value.id)
    )
      setEditingSearchId(value.id);
    if (current.current)
      edit({
        items: current.current.items.map((item) =>
          item.id === value.id ? value : item,
        ),
      });
  }
  async function flush(applyOrganization = true) {
    clearTimeout(timer.current);
    if (!flushPreparations())
      throw new Error(
        "Подготовка результата или графика не сохранена. Повторите сохранение в блоке обучения перед переходом.",
      );
    if (pendingOrganization.current && applyOrganization)
      await ensureOrganization();
    if (
      pendingOrganization.current &&
      !applyOrganization &&
      !organizationStorageReady.current
    )
      throw new NavigationBlockedError(
        "Ввод компании ещё не сохранён. Сохраните его повторно перед переходом.",
      );
    if (!lane.current) throw new Error("Заявка ещё загружается.");
    return lane.current.flush();
  }
  function stageOrganization(value: RequestOrganizationSelection | null) {
    // Retain an unsaved new candidate on screen; switching/clearing must only
    // take effect after the scoped storage record has been safely changed.
    if (value?.mode === "new") {
      organizationSelectionRef.current = value;
      setOrganizationSelection(value);
    }
    setOrganizationSaved(false);
    organizationStorageReady.current = false;
    try {
      if (value?.mode === "new") {
        const old = organizationPreparation.current;
        const same =
          old && JSON.stringify(old.names) === JSON.stringify(value.names);
        const record: OrganizationPreparation = same
          ? old
          : {
              version: 1,
              names: value.names,
              operationKey: crypto.randomUUID(),
            };
        organizationExpectedRaw.current = writeOrganizationPreparation(
          localStorage,
          organizationKey,
          record,
          organizationExpectedRaw.current,
        );
        organizationPreparation.current = record;
        setOrganizationSaved(true);
        organizationStorageReady.current = true;
      } else {
        organizationExpectedRaw.current = writeOrganizationPreparation(
          localStorage,
          organizationKey,
          null,
          organizationExpectedRaw.current,
        );
        organizationPreparation.current = null;
        organizationStorageReady.current = true;
        organizationSelectionRef.current = value;
        setOrganizationSelection(value);
      }
      setOrganizationConflict(false);
      return true;
    } catch (caught) {
      setOrganizationConflict(
        caught instanceof OrganizationPreparationConflictError,
      );
      setOrganizationError(
        `Не удалось сохранить ввод компании: ${errorText(caught)}`,
      );
      return false;
    }
  }
  function reloadOrganizationPreparation() {
    try {
      const raw = localStorage.getItem(organizationKey);
      const record = parseOrganizationPreparation(raw);
      organizationExpectedRaw.current = raw;
      organizationPreparation.current = record;
      const selection = record
        ? { mode: "new" as const, names: record.names }
        : null;
      organizationSelectionRef.current = selection;
      setOrganizationSelection(selection);
      organizationGeneration.current++;
      organizationStorageReady.current = true;
      setOrganizationSaved(!!record);
      setOrganizationConflict(false);
      setOrganizationError("");
    } catch (caught) {
      setOrganizationError(errorText(caught));
    }
  }
  async function ensureOrganization() {
    const value = organizationSelectionRef.current;
    if (value?.mode !== "new") return;
    if (organizationInFlight.current)
      throw new Error(
        "Компания уже сохраняется. Дождитесь завершения команды.",
      );
    organizationInFlight.current = true;
    setOrganizationBusy(true);
    const generation = organizationGeneration.current;
    setOrganizationError("");
    try {
      assertOrganizationPreparationCurrent(
        localStorage,
        organizationKey,
        organizationExpectedRaw.current,
      );
      let record = organizationPreparation.current;
      if (
        !record ||
        JSON.stringify(record.names) !== JSON.stringify(value.names)
      ) {
        record = {
          version: 1,
          names: value.names,
          operationKey: crypto.randomUUID(),
        };
        organizationExpectedRaw.current = writeOrganizationPreparation(
          localStorage,
          organizationKey,
          record,
          organizationExpectedRaw.current,
        );
        organizationPreparation.current = record;
      }
      const operationRaw = organizationExpectedRaw.current;
      const customer =
        record.customer ||
        (await createRequestCustomer(value.names, record.operationKey));
      if (!alive.current || generation !== organizationGeneration.current)
        throw new Error(
          "Ввод компании изменился. Проверьте текущую компанию перед продолжением.",
        );
      record = { ...record, customer };
      organizationExpectedRaw.current = writeOrganizationPreparation(
        localStorage,
        organizationKey,
        record,
        operationRaw,
      );
      organizationPreparation.current = record;
      setCustomers((previous) => [
        ...previous.filter((row) => row.id !== customer.id),
        customer,
      ]);
      pendingOrganization.current = false;
      edit({ customerId: customer.id });
      await lane.current?.flush();
      if (!alive.current || generation !== organizationGeneration.current)
        throw new Error(
          "Ввод компании изменился. Проверьте текущую компанию перед продолжением.",
        );
      if (!stageOrganization(null))
        throw new OrganizationPreparationConflictError();
    } catch (caught) {
      pendingOrganization.current = true;
      if (caught instanceof OrganizationPreparationConflictError) {
        setOrganizationConflict(true);
        organizationStorageReady.current = false;
      }
      setOrganizationError(errorText(caught));
      throw caught;
    } finally {
      organizationInFlight.current = false;
      setOrganizationBusy(false);
    }
  }
  async function removeRecipient(rowId: string) {
    const source = current.current;
    if (!source) return;
    const next = source.items.filter((item) => item.id !== rowId);
    if (!(await applyOperation({ items: next }, rowId))) return;
    setChecked((ids) => ids.filter((item) => item !== rowId));
    setRemoveId(null);
    const oldIndex = source.items.findIndex((item) => item.id === rowId);
    const neighbor = next[Math.min(oldIndex, next.length - 1)];
    if (neighbor) focusRecipient(neighbor.id);
    else
      requestAnimationFrame(() =>
        document
          .querySelector<HTMLButtonElement>("[data-add-recipient]")
          ?.focus(),
      );
  }
  function focusRecipient(rowId: string) {
    setSelectedId(rowId);
    setEditingSearchId(rowId);
    setPendingRecipientFocus(rowId);
  }
  useEffect(() => {
    if (!pendingRecipientFocus || operationBusy) return;
    const index =
      draft?.items.findIndex((item) => item.id === pendingRecipientFocus) ?? -1;
    if (index < 0) return;
    const frame = requestAnimationFrame(() => {
      const target = document.querySelector<HTMLInputElement>(
        `.operator-grid [data-field-path="items.${index}.fullNameRu"]`,
      );
      if (!target || target.disabled) return;
      target.focus({ preventScroll: true });
      target.scrollIntoView({ block: "center", inline: "nearest" });
      setPendingRecipientFocus("");
    });
    return () => cancelAnimationFrame(frame);
  }, [pendingRecipientFocus, operationBusy, draft?.items]);
  async function performTrainingRemoval(target: RemovalTarget) {
    if (trainingOperationInFlight.current) return;
    trainingOperationInFlight.current = true;
    setBusy("training-remove");
    try {
      const expectedRevision = await flush(false);
      const scope = JSON.stringify([
        target.direction,
        target.eventIds,
        target.recipientIds,
        target.removeDefault,
      ]);
      if (trainingRemoveAttempt.current?.scope !== scope)
        trainingRemoveAttempt.current = {
          scope,
          operationId: crypto.randomUUID(),
        };
      await api(`/print-requests/${id}/training-removals`, {
        method: "POST",
        body: json({
          expectedRevision,
          operationId: trainingRemoveAttempt.current.operationId,
          direction: target.direction,
          eventIds: target.eventIds,
          recipientIds: target.recipientIds,
          removeDefault: target.removeDefault,
        }),
      });
      initialize(await api<Draft>(`/print-requests/${id}`));
      setTrainingRemoval(null);
      trainingRemoveAttempt.current = null;
      if (target.recipientIds[0]) focusRecipient(target.recipientIds[0]);
    } catch (caught) {
      setError(errorText(caught));
    } finally {
      trainingOperationInFlight.current = false;
      setBusy("");
    }
  }
  function requestTrainingRemoval(
    direction: TrainingDirection,
    recipientIds: string[],
    all: boolean,
    eventIds?: string[],
  ) {
    if (!current.current) return;
    const target = trainingRemovalTarget(
      current.current,
      direction,
      recipientIds,
      all,
      eventIds,
    );
    if (target.protected) setTrainingRemoval(target);
    else void performTrainingRemoval(target);
  }
  async function restoreTraining(operation: TrainingRemoval) {
    if (trainingOperationInFlight.current) return;
    trainingOperationInFlight.current = true;
    setBusy("training-restore");
    try {
      const expectedRevision = await flush(false);
      await api(
        `/print-requests/${id}/training-removals/${operation.operationId}/restore`,
        { method: "POST", body: json({ expectedRevision }) },
      );
      initialize(await api<Draft>(`/print-requests/${id}`));
      if (operation.recipientIds[0]) focusRecipient(operation.recipientIds[0]);
    } catch (caught) {
      setError(errorText(caught));
      const detail =
        caught instanceof ApiError
          ? (caught.details as {
              code?: string;
              details?: {
                conflicts?: {
                  recipientId?: string;
                  eventId?: string;
                  field: string;
                }[];
              };
            })
          : undefined;
      if (detail?.code === "TRAINING_RESTORE_CONFLICT")
        setRestoreConflict({
          message: errorText(caught),
          conflicts: detail.details?.conflicts || [],
        });
    } finally {
      trainingOperationInFlight.current = false;
      setBusy("");
    }
  }
  useUnsavedNavigation({
    requestId: id,
    dirty: () =>
      !!lane.current?.dirty ||
      pendingOrganization.current ||
      preparationsNeedSave(),
    flush: () => flush(false),
    onError: (caught) => setError(errorText(caught)),
    replace: (url) => router.replace(url),
  });
  async function applyOperation(patch: Partial<Draft>, removedId?: string) {
    if (!current.current || busy) return;
    setBusy("bulk");
    setError("");
    try {
      const expectedRevision = await flush(false);
      const before = structuredClone(current.current);
      const next = applyBusinessRules({
        ...before,
        ...patch,
        businessRuleVersion: "LIVE_V1" as const,
      });
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
      const revision = await flush(false);
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
          body: json({
            expectedRevision: revision,
            assignments: current.current?.approval?.assignments,
          }),
        });
        setPreviewRevision(revision);
        setRefreshFiles((value) => value + 1);
      } else if (kind === "finalize") {
        if (!idempotency.current || idempotency.current.revision !== revision)
          idempotency.current = { revision, key: crypto.randomUUID() };
        await api(`/print-requests/${id}/finalize`, {
          method: "POST",
          headers: { "Idempotency-Key": idempotency.current.key },
          body: json({
            expectedRevision: revision,
            assignments: current.current?.approval?.assignments,
          }),
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
  async function openPreview(target?: PreviewTarget) {
    setBusy("preview-save");
    setError("");
    try {
      const revision = readonly ? draft!.revision : await flush();
      setTargetPreview({ target, revision });
    } catch (caught) {
      setError(errorText(caught));
    } finally {
      setBusy("");
    }
  }
  async function openImport() {
    setBusy("import-save");
    setError("");
    try {
      await flush();
      setDialog("import");
    } catch (caught) {
      setError(errorText(caught));
    } finally {
      setBusy("");
    }
  }
  async function reload(preserveLocalInput = false) {
    setBusy("reload");
    try {
      if (preserveLocalInput) await flush(false);
      const result = await api<Draft>(`/print-requests/${id}`);
      initialize(result);
      setReferenceRetry((attempt) => attempt + 1);
      setDialog(null);
      setError("");
    } catch (caught) {
      setError(errorText(caught));
    } finally {
      setBusy("");
    }
  }
  async function copyConflict() {
    if (!current.current || copyInFlight.current) return;
    copyInFlight.current = true;
    setBusy("copy");
    try {
      const attempt = prepareConflictCopy(
        current.current,
        lane.current?.currentVersion || 0,
        copyAttempt.current,
      );
      copyAttempt.current = attempt;
      const result = await api<Draft>("/print-requests", {
        method: "POST",
        headers: { "Idempotency-Key": attempt.key },
        body: attempt.body,
      });
      lane.current = null;
      pendingOrganization.current = false;
      router.push(`/requests/${result.id}/edit`);
    } catch (caught) {
      setError(errorText(caught));
    } finally {
      copyInFlight.current = false;
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
    setEntryView(previousEntryView.current);
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        window.dispatchEvent(
          new CustomEvent("demo:focus-field", {
            detail: `items.${index}.fullNameRu`,
          }),
        );
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
  const sourceEmployer =
    draft.kind === "COMPANY"
      ? (readonly
          ? draft.organizationSnapshots?.find(
              (entry) => entry.id === draft.customerId,
            )
          : undefined) ||
        customers.find((entry) => entry.id === draft.customerId) ||
        null
      : null;
  const requestEmployer = sourceEmployer
    ? {
        ...sourceEmployer,
        nameKz: sourceEmployer.nameKz || sourceEmployer.nameRu,
        bin: sourceEmployer.bin || "",
        addressRu: sourceEmployer.addressRu || "",
        addressKz: sourceEmployer.addressKz || "",
      }
    : null;
  const employerRecords = new Map(
    [...customers, ...(readonly ? draft.organizationSnapshots || [] : [])].map(
      (entry) => [entry.id, entry],
    ),
  );
  const visibleItems = draft.items.filter(
    (item) =>
      item.id === editingSearchId ||
      ([
        item.fullNameRu,
        item.fullNameKz,
        item.personnelNumber,
        item.externalId,
        item.positionRu,
        item.positionKz,
        effectiveRecipientEmployer(
          item,
          item.employerId
            ? employerRecords.get(item.employerId)
            : requestEmployer,
        ).workplaceRu,
        effectiveRecipientEmployer(
          item,
          item.employerId
            ? employerRecords.get(item.employerId)
            : requestEmployer,
        ).workplaceKz,
      ].some((value) =>
        value
          ?.toLocaleLowerCase("ru")
          .includes(rowSearch.toLocaleLowerCase("ru")),
      ) &&
        (!rowScope ||
          (rowScope === "selected"
            ? checked.includes(item.id)
            : rowScope === "unnamed"
              ? isBlankText(item.fullNameRu)
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
                      )))),
  );
  const selected = draft.items.find((item) => item.id === selectedId);
  const centerCommon =
    draft.profileVersionId &&
    draft.profileVersionId !== context.profileVersionId
      ? pinnedCenter?.id === draft.profileVersionId
        ? pinnedCenter.commonFields
        : {}
      : context.profile?.commonFields || {};
  const localResolved = resolveDraft(
    {
      ...draft,
      items: draft.items.map((item) => {
        const employer = item.employerId
          ? employerRecords.get(item.employerId)
          : requestEmployer;
        return resolveRecipientText(effectiveRecipientEmployer(item, employer));
      }),
    },
    centerCommon,
  );
  const resolved =
    serverResolution?.revision === draft.revision && !lane.current?.dirty
      ? serverResolution.value
      : localResolved;
  const readiness = draftReadiness(
    draft,
    draft.profileVersionId &&
      draft.profileVersionId !== context.profileVersionId
      ? pinnedCenter?.id === draft.profileVersionId
        ? pinnedCenter.profile
        : null
      : context.profile,
    localResolved,
  );
  const plan = documentPlan(resolved.draft);
  const documentCount = plan.documentCount;
  const legacyPersonGroupEventIds =
    draft.kind === "PERSON"
      ? [
          ...new Set(
            draft.items.flatMap((item) =>
              item.assignments.flatMap((assignment) =>
                assignment.protocolMode === "GROUP" && assignment.eventId
                  ? [assignment.eventId]
                  : [],
              ),
            ),
          ),
        ]
      : [];
  type Issue = Validation["errors"][number];
  function operatorIssue(issue: Issue): Issue {
    issue = addressIssue(issue, draft!.items, draft!.events);
    if (typeof issue === "string") return issue;
    // Normal PERSON courses use their personal card. Existing GROUP courses
    // still own shared facts in the event, so an inherited error must repair
    // that event instead of creating a conflicting personal override.
    if (draft!.kind === "PERSON" && !legacyPersonGroupEventIds.length)
      return issue;
    const path = Array.isArray(issue.path)
      ? issue.path.join(".")
      : issue.path || "";
    const match = /^items\.(\d+)\.assignments\.(\d+)\.(.+)$/.exec(path);
    if (!match) return issue;
    const person = draft!.items[Number(match[1])];
    const assignment = person?.assignments[Number(match[2])];
    const key = match[3];
    if (!assignment) return issue;
    if (draft!.kind === "PERSON" && assignment.protocolMode !== "GROUP")
      return issue;
    const commonKey = commonFieldKeys.find((field) => field === key);
    const individualOrigin = commonKey
      ? assignment.fieldOrigins?.[commonKey]
      : key === "result"
        ? assignment.fieldOrigins?.result
        : undefined;
    // Resolved CLEARED/MANUAL provenance can belong to the shared event.
    // Route by the recipient's raw override, as the resolver does, so editing
    // the indicated control repairs the cause without creating an exception.
    const individualOverride =
      ["MANUAL", "IMPORTED", "CLEARED"].includes(individualOrigin || "") ||
      (!individualOrigin && commonKey && !!assignment[commonKey]);
    const eventIndex =
      draft!.events?.findIndex((event) => event.id === assignment.eventId) ??
      -1;
    const event = draft!.events?.[eventIndex];
    if (
      event &&
      key.startsWith("trainingDateRule.") &&
      assignment.trainingDateRule === undefined
    )
      return {
        ...issue,
        path: `events.${eventIndex}.commonFields.${key}`,
        message: `${trainingDisplayTitle(event.title)}: ${issue.message}`,
      };
    if (commonKey && !individualOverride) {
      if (
        key === "documentDate" &&
        event?.commonFields.documentDate === undefined
      )
        return {
          ...issue,
          path: "commonFields.documentDate",
          message: issue.message,
        };
      if (event)
        return {
          ...issue,
          path: `events.${eventIndex}.commonFields.${key}`,
          message: `${trainingDisplayTitle(event.title)}: ${issue.message}`,
        };
    }
    if (
      event &&
      !individualOverride &&
      [
        "outcome",
        "outcome.source",
        "outcomeSource",
        "result",
        "biotKnowledgeResult",
        "biotProctoringResult",
      ].includes(key)
    )
      return {
        ...issue,
        path: `events.${eventIndex}.outcomes${["outcome.source", "outcomeSource"].includes(key) ? ".source" : ["outcome", "result"].includes(key) ? "" : `.${key}`}`,
        message: `${trainingDisplayTitle(event.title)}: ${issue.message}`,
      };
    return issue;
  }
  const nextIssues = [
    ...new Map(
      readiness.issues.map((issue) => {
        const mapped = operatorIssue(issue);
        const path =
          typeof mapped === "string" ? "" : String(mapped.path || "");
        return [
          typeof mapped === "string"
            ? mapped
            : JSON.stringify([
                path,
                mapped.message,
                /^(events|commonFields|profile|issuer)(\.|$)/.test(path)
                  ? "shared"
                  : (mapped as AddressedIssue).rowId,
              ]),
          mapped,
        ] as const;
      }),
    ).values(),
  ];
  const sharedHints = Object.fromEntries(
    nextIssues.flatMap((issue) =>
      typeof issue === "string"
        ? []
        : [[String(issue.path || ""), issue.message]],
    ),
  );
  const reviewGroups = groupValidationIssues(
    validation?.errors.map(operatorIssue) || [],
    draft.items,
  );
  function focusIssue(original: Issue) {
    const issue = operatorIssue(original);
    if (typeof issue === "string") return;
    const path = Array.isArray(issue.path)
      ? issue.path.join(".")
      : issue.path || "";
    if (path === "customerId") {
      const field =
        document.querySelector<HTMLElement>(
          "#request-customer input[required]",
        ) ||
        document.querySelector<HTMLElement>(
          '#request-customer [data-field-path="customerId"]',
        );
      field?.focus();
      field?.scrollIntoView({ block: "center" });
      return;
    }
    if (/^(profile|issuer)(\.|$)/.test(path)) {
      document
        .getElementById("request-readiness")
        ?.scrollIntoView({ block: "center" });
      return;
    }
    const sharedEventMatch = /^events\.(\d+)\./.exec(path);
    const legacyPersonSharedIssue =
      legacyPersonGroupEventIds.length > 0 &&
      (path.startsWith("commonFields.") ||
        (sharedEventMatch &&
          legacyPersonGroupEventIds.includes(
            draft!.events?.[Number(sharedEventMatch[1])]?.id || "",
          )));
    if (draft!.kind === "PERSON" && legacyPersonSharedIssue) {
      const rowId = (issue as AddressedIssue).rowId;
      if (rowId && draft!.items.some((person) => person.id === rowId))
        setSelectedId(rowId);
    }
    if (draft!.kind === "PERSON" && !legacyPersonSharedIssue) {
      const rowMatch = /^items\.(\d+)/.exec(path);
      let personPath = path;
      if (rowMatch) setSelectedId(draft!.items[Number(rowMatch[1])]?.id || "");
      const eventMatch = /^events\.(\d+)\.(?:commonFields\.)?(.+)$/.exec(path);
      if (eventMatch) {
        const eventId = draft!.events?.[Number(eventMatch[1])]?.id;
        const rowIndex = draft!.items.findIndex((row) =>
          row.assignments.some((a) => a.eventId === eventId),
        );
        if (rowIndex >= 0) {
          const row = draft!.items[rowIndex];
          setSelectedId(row.id);
          const field = eventMatch[2].replace(/^outcomes(?=\.|$)/, "outcome");
          personPath = `items.${rowIndex}.assignments.${row.assignments.findIndex((a) => a.eventId === eventId)}.${field}`;
        }
      }
      const commonMatch = /^commonFields\.(.+)$/.exec(path);
      if (commonMatch) {
        const rowIndex = Math.max(
          0,
          draft!.items.findIndex((row) => row.id === selectedId),
        );
        const row = draft!.items[rowIndex];
        if (row?.assignments.length) {
          setSelectedId(row.id);
          personPath = `items.${rowIndex}.assignments.0.${commonMatch[1]}`;
        }
      }
      setFocusFieldPath(personPath);
      requestAnimationFrame(() =>
        requestAnimationFrame(() =>
          window.dispatchEvent(
            new CustomEvent("demo:focus-field", { detail: personPath }),
          ),
        ),
      );
      return;
    }
    const training = /^events\.(\d+)\.(?:commonFields\.)?(.+)$/.exec(path);
    if (training) {
      const sharedInput = document.querySelector<HTMLInputElement>(
        `.course-shared-fields [data-field-path="${CSS.escape(path)}"]`,
      );
      if (sharedInput) {
        let parent = sharedInput.parentElement;
        while (parent) {
          if (parent instanceof HTMLDetailsElement) parent.open = true;
          parent = parent.parentElement;
        }
        sharedInput.focus();
        sharedInput.scrollIntoView({ block: "center" });
        return;
      }
      const event = draft!.events?.[Number(training[1])];
      const settings = document.getElementById("request-training");
      if (settings instanceof HTMLDetailsElement) settings.open = true;
      document
        .getElementById("request-training")
        ?.scrollIntoView({ block: "start" });
      window.dispatchEvent(
        new CustomEvent("demo:focus-training", {
          detail: { eventId: event?.id, field: training[2] },
        }),
      );
      return;
    }
    const rowMatch = /^items\.(\d+)(?:\.([^.]+))?/.exec(path);
    if (rowMatch) {
      const row = draft!.items[Number(rowMatch[1])];
      if (row) {
        const datePath = /^items\.\d+\.assignments\.(\d+)\.documentDate$/.exec(
          path,
        );
        const dateAssignment = datePath
          ? row.assignments[Number(datePath[1])]
          : null;
        const inlineDate =
          dateAssignment &&
          row.assignments.find(
            (assignment) => !assignment.templateId.endsWith("-protocol"),
          )?.id === dateAssignment.id &&
          recipientRowDate(
            row,
            resolved.draft.items.find((item) => item.id === row.id) || row,
          ).kind === "single";
        setSelectedId(row.id);
        setRowSearch("");
        setRowScope("");
        if (rowMatch[2] === "assignments" && !row.assignments.length) {
          setDocumentTargets([row.id]);
          return;
        }
        if (
          [
            "fullNameRu",
            "fullNameKz",
            "positionRu",
            "positionKz",
            "employeeCategory",
            "employerBin",
            "employerAddressRu",
            "workplaceRu",
          ].includes(rowMatch[2] || "") ||
          inlineDate
        )
          setEntryView(previousEntryView.current);
        else openRecipient(row.id);
      }
    }
    setFocusFieldPath(path);
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        window.dispatchEvent(
          new CustomEvent("demo:focus-field", { detail: path }),
        );
        const input = Array.from(
          document.querySelectorAll<HTMLElement>(
            `[data-field-path="${CSS.escape(path)}"]`,
          ),
        ).find((element) => {
          const modal = document.querySelector("dialog[open]");
          return (
            !element.closest("[hidden]") && (!modal || modal.contains(element))
          );
        });
        let ancestor = input?.parentElement;
        while (ancestor) {
          if (ancestor instanceof HTMLDetailsElement) ancestor.open = true;
          ancestor = ancestor.parentElement;
        }
        input?.focus();
        input?.scrollIntoView({ block: "center", inline: "nearest" });
      }),
    );
  }
  focusIssueAction.current = focusIssue;
  function issueLabel(issue: Issue) {
    if (typeof issue === "string") return issue;
    const addressed = addressIssue(
      issue,
      draft!.items,
      draft!.events,
    ) as AddressedIssue;
    const path = String(addressed.path || "");
    const index = /^items\.(\d+)/.exec(path);
    const person = index ? draft!.items[Number(index[1])] : undefined;
    const assignmentIndex = /\.assignments\.(\d+)/.exec(path);
    const assignment =
      person && assignmentIndex
        ? person.assignments[Number(assignmentIndex[1])]
        : undefined;
    const event = draft!.events?.find(
      (candidate) =>
        candidate.id === (addressed.eventId || assignment?.eventId),
    );
    return `${person ? `Строка ${Number(index![1]) + 1}${person.fullNameRu ? `, ${person.fullNameRu}` : ""}${event ? `, ${trainingDisplayTitle(event.title)}` : ""}: ` : ""}${issue.message}`;
  }
  const missingNames = draft.items.filter((item) =>
    isBlankText(item.fullNameRu),
  ).length;
  const missingDocuments = draft.items.filter(
    (item) => !item.assignments.length,
  ).length;
  const unconfirmedResults = trainingOutcomeSummary(draft);
  const missingTrainingFields = nextIssues.filter(
    (issue) =>
      typeof issue !== "string" && /^events\./.test(String(issue.path)),
  ).length;
  const dirty =
    saveState === "dirty" ||
    saveState === "saving" ||
    saveState === "error" ||
    conflictPaused ||
    pendingOrganization.current;
  const saveLabel = pendingOrganization.current
    ? organizationBusy
      ? "Сохраняем компанию…"
      : organizationSaved
        ? "Ввод компании сохранён"
        : "Ввод компании не сохранён"
    : {
        saved: `${draft.approval?.status === "APPROVED" ? "Согласовано" : "Рабочая версия сохранена"} · редакция ${draft.revision}`,
        dirty: "Есть изменения",
        saving: "Сохраняем…",
        error: "Не сохранено",
        paused: "Сохранение приостановлено: конфликт редакций",
      }[saveState];
  const actions = requestActions({
    draft,
    role: context.user.role,
    dirty,
    busy: operationBusy,
  });
  const fieldErrors = Object.fromEntries(
    (reviewStale ? [] : validation?.errors || [])
      .map(operatorIssue)
      .flatMap((issue) =>
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
    <div className="operator-form">
      <Link className="back-link" href="/requests">
        ← Все заявки
      </Link>
      <div className="page-heading editor-heading operator-heading">
        <div className="title-with-status">
          <h1>
            {personRequestName(draft) ||
              (draft.kind === "COMPANY" &&
              ["", "Новая заявка организации"].includes(draft.title || "")
                ? requestEmployer?.nameRu ||
                  (organizationSelection?.mode === "new"
                    ? organizationSelection.names.nameRu
                    : "") ||
                  draft.title
                : draft.title) ||
              "Новая заявка"}
          </h1>
          {draft.demoMode && <small className="muted">Тестовый комплект</small>}
          <Status value={draft.status} />
        </div>
        <div className="operator-heading-actions">
          <span className={`save-indicator ${saveState}`} role="status">
            {saveState === "saved" ? (
              <Icon name="check" size={16} />
            ) : (
              <span className="save-dot" />
            )}
            {saveLabel}
          </span>
          <button
            className="text-button"
            aria-haspopup="dialog"
            onClick={() => setExtraPanel("menu")}
          >
            Дополнительные действия
          </button>
        </div>
      </div>
      {error && (
        <Notice>
          {error}
          {saveState === "error" && !conflictPaused && (
            <button onClick={() => void command("save")}>
              Повторить сохранение
            </button>
          )}
        </Notice>
      )}
      {conflictPaused && (
        <Notice kind="info">
          Сохранение приостановлено: заявка изменена в другом окне. Можно
          продолжать ввод здесь; серверная версия не меняется до решения.
          <button
            disabled={operationBusy}
            onClick={() => setDialog("conflict")}
          >
            Разрешить конфликт
          </button>
        </Notice>
      )}
      {(profileLoadError || organizationLoadError) && (
        <Notice>
          Не удалось загрузить реквизиты для проверки заявки.{" "}
          {profileLoadError || organizationLoadError}
          <button
            disabled={operationBusy}
            onClick={() => setReferenceRetry((attempt) => attempt + 1)}
          >
            Повторить загрузку реквизитов
          </button>
        </Notice>
      )}
      {draft.kind === "COMPANY" && (
        <section
          className="panel operator-customer-panel"
          id="request-customer"
          aria-label="Заказчик заявки"
        >
          {draft.kind === "COMPANY" &&
            (readonly ? (
              <div className="organization-name-preview form-grid">
                <p>
                  <small>Название компании · RU</small>
                  <br />
                  {requestEmployer?.nameRu || draft.customerName || "—"}
                </p>
                <p>
                  <small>Название компании · KZ</small>
                  <br />
                  {requestEmployer?.nameKz || requestEmployer?.nameRu || "—"}
                </p>
              </div>
            ) : (
              <RequestOrganizationFields
                customers={customers}
                value={
                  organizationSelection ||
                  (draft.customerId
                    ? { mode: "existing", customerId: draft.customerId }
                    : emptyRequestOrganization())
                }
                disabled={operationBusy && !organizationBusy}
                busy={organizationBusy}
                error={organizationError}
                onChange={(value) => {
                  organizationGeneration.current++;
                  setOrganizationError("");
                  if (value.mode === "existing") {
                    if (stageOrganization(value))
                      edit({ customerId: value.customerId || null });
                  } else stageOrganization(value);
                }}
                onFind={() => setDialog("customerPicker")}
                onEdit={(customer) => {
                  setEditingCustomer(customer);
                  setDialog("customer");
                }}
              />
            ))}
          {organizationConflict && (
            <button
              type="button"
              disabled={organizationBusy}
              onClick={reloadOrganizationPreparation}
            >
              Загрузить сохранённый ввод компании
            </button>
          )}
        </section>
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
                const result = await api<Draft>(`/print-requests/${id}`, {
                  method: "PATCH",
                  body: json({
                    expectedRevision: undo.revision,
                    draft: draftPayload(undo.before),
                    ...(undo.removedId
                      ? { restoreRecipientId: undo.removedId }
                      : {}),
                  }),
                });
                initialize(
                  undo.removedId
                    ? { ...undo.before, ...result }
                    : { ...undo.before, revision: result.revision },
                );
                if (undo.removedId) {
                  setSelectedId(undo.removedId);
                  setEntryView(previousEntryView.current);
                  setRowSearch("");
                  setRowScope("");
                  focusRecipient(undo.removedId);
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
      {!!removedTrainings.length && !readonly && (
        <div className="training-restores" aria-label="Снятые обучения">
          {removedTrainings.map((operation) => (
            <Notice kind="info" key={operation.operationId}>
              Снято: {operation.titles.map(trainingDisplayTitle).join(", ")} у{" "}
              {operation.recipientIds.length} получателей. Исходные данные
              доступны для восстановления после сохранения и повторного
              открытия.
              <button
                disabled={operationBusy || conflictPaused}
                onClick={() => void restoreTraining(operation)}
              >
                Восстановить обучение
              </button>
            </Notice>
          ))}
        </div>
      )}
      {draft.kind === "PERSON" ? (
        <section className="panel" id="recipient-workspace">
          <PersonEditor
            draft={draft}
            resolvedDraft={resolved.draft as Draft}
            context={context}
            fieldErrors={fieldErrors}
            fieldHints={sharedHints}
            provenance={resolved.provenance}
            disabled={operationBusy}
            readonly={readonly}
            selectedId={selectedId}
            focusFieldPath={focusFieldPath}
            onSelect={setSelectedId}
            onChangeRecipient={editRecipient}
            onStageChange={setPersonStage}
            onChooseTraining={(rowId, direction) => {
              if (!current.current) return;
              const next = assignTrainingBundle(
                current.current,
                [rowId],
                direction,
              );
              edit({
                items: next.items,
                events: next.events,
                trainingDefaults: next.trainingDefaults,
              });
            }}
            onRemoveTraining={(rowId, direction) =>
              requestTrainingRemoval(direction, [rowId], false)
            }
            onPhoto={setPhotoRecipientId}
            onPreview={(rowId, assignmentId) =>
              void openPreview({ kind: "ASSIGNMENT", rowId, assignmentId })
            }
          />
          {legacyPersonGroupEventIds.length > 0 && (
            <details className="operator-common-settings" id="request-training">
              <summary>Общие параметры группового обучения</summary>
              <label className="operator-row-common-date">
                Общая дата документов
                <input
                  type="date"
                  data-field-path="commonFields.documentDate"
                  disabled={readonly || operationBusy}
                  aria-invalid={
                    !!(
                      fieldErrors["commonFields.documentDate"] ||
                      sharedHints["commonFields.documentDate"]
                    )
                  }
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
                        fieldOrigins: {
                          ...draft.commonFields?.fieldOrigins,
                          documentDate: event.target.value
                            ? "MANUAL"
                            : "CLEARED",
                        },
                      },
                    })
                  }
                />
                {(fieldErrors["commonFields.documentDate"] ||
                  sharedHints["commonFields.documentDate"]) && (
                  <small className="field-error">
                    {fieldErrors["commonFields.documentDate"] ||
                      sharedHints["commonFields.documentDate"]}
                  </small>
                )}
              </label>
              <EventContext
                primary
                embedded
                existingOnly
                visibleEventIds={legacyPersonGroupEventIds}
                preparationOwner={{
                  tenantId: context.tenant.id,
                  userId: context.user.id,
                }}
                fieldHints={sharedHints}
                draft={draft}
                centerCommon={centerCommon}
                selectedIds={[selectedId || draft.items[0]?.id].filter(Boolean)}
                disabled={readonly || operationBusy}
                onChange={edit}
                onApply={applyOperation}
                onContextCommit={rememberContextOperation}
                onBusyChange={setContextBusy}
              />
            </details>
          )}
        </section>
      ) : (
        <section className="panel recipients-panel" id="recipient-workspace">
          <div className="operator-common-bar">
            <RequestTrainingChoices
              draft={draft}
              disabled={operationBusy}
              readonly={readonly}
              selectedIds={checked}
              hiddenSelectedCount={
                checked.filter(
                  (rowId) => !visibleItems.some((item) => item.id === rowId),
                ).length
              }
              onRemove={requestTrainingRemoval}
              onChange={(next) =>
                edit({
                  items: next.items,
                  events: next.events,
                  trainingDefaults: next.trainingDefaults,
                })
              }
            />
            <label className="operator-row-common-date">
              Общая дата документов
              <input
                type="date"
                title="Для документов без индивидуальной даты в строке"
                data-field-path="commonFields.documentDate"
                aria-invalid={
                  !!(
                    fieldErrors["commonFields.documentDate"] ||
                    sharedHints["commonFields.documentDate"]
                  )
                }
                aria-describedby="request-common-date-feedback"
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
                      fieldOrigins: {
                        ...draft.commonFields?.fieldOrigins,
                        documentDate: event.target.value ? "MANUAL" : "CLEARED",
                      },
                    },
                  })
                }
              />
              <small
                id="request-common-date-feedback"
                className={
                  fieldErrors["commonFields.documentDate"]
                    ? "field-error"
                    : "field-hint"
                }
              >
                {fieldErrors["commonFields.documentDate"] ||
                  sharedHints["commonFields.documentDate"] ||
                  "Для документов без собственной даты; отдельная дата обучения и исключения сохраняются."}
              </small>
            </label>
          </div>
          <CourseSharedFields
            draft={draft}
            resolvedEvents={resolved.draft.events}
            fieldHints={sharedHints}
            disabled={readonly || operationBusy}
            onChange={edit}
          />
          <details className="operator-common-settings" id="request-training">
            <summary>
              <span>Параметры обучения и документов</span>
              <span className="muted">
                {missingTrainingFields
                  ? `Осталось заполнить: ${missingTrainingFields}`
                  : draft.events?.length
                    ? "Общие сведения заполнены"
                    : "Даты, программа и результаты"}
              </span>
            </summary>
            <div className="operator-training-panel">
              {!!draft.events?.length && (
                <>
                  <TrainingOverview
                    draft={draft}
                    resolvedEvents={resolved.draft.events}
                    disabled={readonly || operationBusy}
                    onChange={edit}
                    selectedIds={checked}
                    onRemove={(eventId, ids, all) => {
                      const event = draft.events?.find(
                        (entry) => entry.id === eventId,
                      );
                      if (event)
                        requestTrainingRemoval(
                          trainingDirection(event.protocolTemplateId),
                          ids,
                          all,
                          [eventId],
                        );
                    }}
                  />
                  <EventContext
                    preparationOwner={{
                      tenantId: context.tenant.id,
                      userId: context.user.id,
                    }}
                    primary
                    embedded
                    fieldHints={sharedHints}
                    draft={draft}
                    centerCommon={centerCommon}
                    selectedIds={checked}
                    disabled={readonly || operationBusy}
                    onChange={edit}
                    onApply={applyOperation}
                    onContextCommit={rememberContextOperation}
                    onBusyChange={setContextBusy}
                  />
                </>
              )}
            </div>
          </details>
          <div className="toolbar">
            <div>
              <h2>Сотрудники</h2>
              {draft.items.length > 1 && (
                <span className="muted">{draft.items.length} человек</span>
              )}
            </div>
            {!readonly && (
              <div className="toolbar-actions">
                <button
                  disabled={operationBusy}
                  onClick={() => void openImport()}
                >
                  <Icon name="upload" />
                  Импорт
                </button>
                <button
                  disabled={operationBusy}
                  onClick={() => void openImport()}
                >
                  Вставить список
                </button>
                {entryView === "table" && (
                  <button
                    disabled={
                      draft.items.length >= LIMITS.rows || operationBusy
                    }
                    onClick={addRecipient}
                    data-add-recipient
                  >
                    <Icon name="plus" />
                    Добавить сотрудника
                  </button>
                )}
                <details
                  ref={moreTools}
                  className="recipient-extra-tools"
                  onToggle={(event) => setMoreOpen(event.currentTarget.open)}
                >
                  <summary aria-expanded={moreOpen}>Ещё</summary>
                  <div
                    onClickCapture={(event) => {
                      if (
                        (event.target as HTMLElement).closest(
                          "button:not(:disabled)",
                        ) &&
                        moreTools.current
                      )
                        moreTools.current.open = false;
                    }}
                  >
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
          {!readonly &&
            entryView === "table" &&
            draft.items.length > 10 &&
            (missingNames > 0 || missingDocuments > 0) && (
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
          <details
            className="operator-list-tools"
            open={
              listToolsOpen ??
              (draft.items.length > 10 ||
                !!rowSearch ||
                !!rowScope ||
                checked.length > 0)
            }
            onToggle={(event) => setListToolsOpen(event.currentTarget.open)}
          >
            <summary>Поиск и действия со списком</summary>
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
                Показано: {visibleItems.length}. Выбрано: {checked.length}, из
                них скрыто фильтрами:{" "}
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
                  onChange={(e) => {
                    setEditingSearchId("");
                    setRowScope(e.target.value);
                  }}
                >
                  <option value="">Все</option>
                  <option value="selected">Выбранные</option>
                  <option value="unnamed">Без ФИО на русском</option>
                  <option value="unassigned">Без документов</option>
                  <option value="errors">С ошибками последней проверки</option>
                  <option value="pb-">Промышленная безопасность</option>
                  <option value="ptm-">Пожарно-технический минимум</option>
                  <option value="biot-">БиОТ</option>
                  <option value="ps-">ПС — обучение по профессии</option>
                  {draft.events?.map((event) => (
                    <option key={event.id} value={`event:${event.id}`}>
                      Событие: {trainingDisplayTitle(event.title)}
                    </option>
                  ))}
                </select>
              </label>
              {checked.length > 0 && (
                <button onClick={() => setChecked([])}>
                  Снять выделение строк
                </button>
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
          </details>
          <div
            onScrollCapture={() => {
              const field = document.activeElement;
              if (
                field instanceof HTMLElement &&
                field.matches("[data-grid-field]") &&
                field.closest(".operator-grid")
              )
                rememberGridField(field);
            }}
            onFocusCapture={(event) => {
              const row = (event.target as HTMLElement).closest(
                "tr[data-recipient-id]",
              );
              if (row && (rowSearch || rowScope))
                setEditingSearchId(row.getAttribute("data-recipient-id") || "");
              const field = event.target as HTMLElement;
              if (field.matches("[data-grid-field]")) {
                rememberGridField(field);
                requestAnimationFrame(() => {
                  if (field.isConnected && document.activeElement === field)
                    rememberGridField(field);
                });
              }
            }}
            onBlurCapture={(event) => {
              const row = (event.target as HTMLElement).closest(
                "tr[data-recipient-id]",
              );
              const next = (event.relatedTarget as HTMLElement | null)?.closest(
                "tr[data-recipient-id]",
              );
              if (row && row !== next) setEditingSearchId("");
            }}
          >
            <RecipientGrid
              issuedAssignments={draft.issuedAssignments}
              active={entryView === "table"}
              items={draft.items}
              requestEmployer={requestEmployer}
              visibleItems={visibleItems}
              resolvedItems={resolved.draft.items}
              liveRules={draft.businessRuleVersion === "LIVE_V1"}
              selectedId={selectedId}
              checked={checked}
              disabled={operationBusy}
              readonly={readonly}
              fieldErrors={fieldErrors}
              fieldHints={sharedHints}
              onPhoto={setPhotoRecipientId}
              onEdit={editRecipient}
              onSelect={setSelectedId}
              onOpen={openRecipient}
              onDocuments={(recipientId) => setDocumentTargets([recipientId])}
              onChecked={setChecked}
              onRemove={(rowId) => {
                const item = current.current?.items.find(
                  (row) => row.id === rowId,
                );
                if (item && isTechnicalBlankRecipient(item))
                  void removeRecipient(rowId);
                else setRemoveId(rowId);
              }}
              onPaste={(range) => {
                if (rowSearch || rowScope) {
                  setError(
                    "Перед вставкой диапазона сбросьте поиск и фильтры, чтобы видеть все изменяемые строки.",
                  );
                  return;
                }
                try {
                  const quick = quickGridPaste(
                    draft.items,
                    resolved.draft.items,
                    range,
                  );
                  if (!quick.eligible) {
                    setPastedRange({ ...range, reason: quick.reason });
                    return;
                  }
                  const existing = new Set(
                    draft.items.map((person) => person.id),
                  );
                  const items = quick.preview.items.map((person) =>
                    existing.has(person.id)
                      ? person
                      : recipientForRequest(draft, person),
                  );
                  void applyOperation({ items }).then((applied) => {
                    if (applied)
                      setPasteMessage(
                        `Вставлено строк: ${quick.preview.appliedRows}. Изменения сохранены; доступна отмена.`,
                      );
                    else
                      setPastedRange({
                        ...range,
                        reason:
                          "Быстрая вставка не сохранена. Диапазон остаётся для проверки и повторного применения.",
                      });
                  });
                } catch (caught) {
                  setPastedRange({ ...range, reason: errorText(caught) });
                }
              }}
              onAdd={addRecipient}
              canAdd={
                draft.items.length < LIMITS.rows && !operationBusy && !readonly
              }
            />
            {pasteMessage && (
              <p role="status" className="fine-print">
                {pasteMessage}
              </p>
            )}
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
          {entryView === "card" && selected && (
            <Modal
              title={`Настройки строки ${draft.items.indexOf(selected) + 1}`}
              onClose={returnToTable}
              wide
            >
              <aside
                ref={recipientDetailRef}
                className="recipient-details"
                aria-label="Редактор получателя"
                tabIndex={-1}
                onFocusCapture={(event) => {
                  const control = event.target as HTMLElement;
                  const footer = control
                    .closest("dialog")
                    ?.querySelector(".recipient-details-footer");
                  const head = control
                    .closest("dialog")
                    ?.querySelector(".modal-head");
                  const rect = control.getBoundingClientRect();
                  if (
                    (footer &&
                      rect.bottom > footer.getBoundingClientRect().top - 8) ||
                    (head && rect.top < head.getBoundingClientRect().bottom + 8)
                  )
                    requestAnimationFrame(() =>
                      control.scrollIntoView({
                        block: "center",
                        inline: "nearest",
                      }),
                    );
                }}
              >
                {selected ? (
                  <RecipientDetails
                    issuedAssignmentIds={draft.issuedAssignments
                      ?.filter((entry) => entry.rowId === selected.id)
                      .map((entry) => entry.assignmentId)}
                    recipient={selected}
                    onPhoto={setPhotoRecipientId}
                    onPreview={(rowId, assignmentId) =>
                      void openPreview({
                        kind: "ASSIGNMENT",
                        rowId,
                        assignmentId,
                      })
                    }
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
                    fieldHints={readiness.fieldHints}
                    liveRules={draft.businessRuleVersion === "LIVE_V1"}
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
              <div className="modal-actions recipient-details-footer">
                <div className="recipient-details-save" role="status">
                  <strong>{saveLabel}</strong>
                  <small>
                    Изменения сохраняются автоматически. Закрытие возвращает к
                    списку и сохраняет введённое.
                  </small>
                  {saveState === "error" && error && (
                    <span className="field-error">{error}</span>
                  )}
                  {conflictPaused && (
                    <button
                      onClick={() => {
                        returnToTable();
                        setDialog("conflict");
                      }}
                    >
                      Разрешить конфликт
                    </button>
                  )}
                </div>
                <button className="primary" onClick={returnToTable}>
                  Вернуться к списку
                </button>
              </div>
            </Modal>
          )}
        </section>
      )}
      {!readonly && (draft.kind !== "PERSON" || personStage === "summary") && (
        <section
          className="operator-readiness"
          id="request-readiness"
          aria-label="Проверка заполнения"
        >
          {nextIssues.length ? (
            <>
              <button
                className="text-button operator-next-action"
                onClick={() => focusIssue(nextIssues[0])}
              >
                Далее: {issueLabel(nextIssues[0])}
              </button>
              <details>
                <summary>Осталось заполнить · {nextIssues.length}</summary>
                <ul className="operator-next-fields">
                  {nextIssues.map((issue, index) => (
                    <li key={index}>
                      {typeof issue !== "string" &&
                      /^(profile|issuer)(\.|$)/.test(String(issue.path)) ? (
                        <Link href="/settings">{issue.message}</Link>
                      ) : (
                        <button
                          className="text-button"
                          onClick={() => focusIssue(issue)}
                        >
                          {issueLabel(issue)}
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              </details>
            </>
          ) : (
            <p className="muted">
              Основные поля заполнены · {documentCount} документов
            </p>
          )}
        </section>
      )}
      {(draft.kind !== "PERSON" || personStage === "summary" || readonly) && (
        <section
          className="operator-completion"
          aria-label="Подготовка документов"
        >
          <button disabled={operationBusy} onClick={() => void openPreview()}>
            Предпросмотр любого документа
          </button>
          {!readonly && (
            <BatchReadyPanel
              draft={draft}
              onSave={flush}
              onRefresh={async () => {
                initialize(await api<Draft>(`/print-requests/${id}`));
                setRefreshFiles((value) => value + 1);
              }}
            />
          )}
          {unconfirmedResults.trainings > 0 && (
            <p className="operator-result-reminder">
              Не подтверждены {unconfirmedResults.trainings} результатов по
              обучениям у {unconfirmedResults.recipients} получателей.
              Удостоверения, сертификаты и свидетельства по этим обучениям
              включаются только после результата «Сдал». Протоколы отражают
              фактические результаты, включая неподтверждённые; подтверждённые
              направления того же человека сохраняются. Подтвердите результаты в
              блоке обучения, если они уже известны.
            </p>
          )}
          <ApprovalBanner
            draft={draft}
            role={context.user.role}
            compact
            onRefresh={async () => {
              if (!readonly) await flush();
              await reload();
            }}
          />
          <div className="operator-final-actions">
            {actions.showPrepareSigning ? (
              <button
                className="primary"
                disabled={actions.prepareSigningDisabled || organizationBusy}
                onClick={() => void command("finalize")}
              >
                <Icon name="print" />
                {busy === "finalize"
                  ? "Готовим документы…"
                  : "Сформировать документы"}
              </button>
            ) : actions.showPreview ? (
              <button
                className="primary"
                disabled={operationBusy || !readiness.locallyComplete}
                onClick={() => void command("preview")}
              >
                {busy === "preview"
                  ? "Готовим предпросмотр…"
                  : "Посмотреть документы"}
              </button>
            ) : actions.showDocuments ? (
              <a className="button primary" href="#request-files">
                Документы и печать
              </a>
            ) : null}
            {actions.showValidate && (
              <button
                disabled={operationBusy}
                onClick={() => void command("validate")}
              >
                {busy === "validate" ? "Проверяем…" : "Проверить данные"}
              </button>
            )}
            {draft.approval && (
              <Link
                className="button"
                href={`/approvals?proposal=${encodeURIComponent(draft.approval.proposalId)}`}
              >
                {actions.showDecision
                  ? "Принять решение"
                  : "Состояние согласования"}
              </Link>
            )}
          </div>
          {actions.showPrepareSigning && (
            <p className="fine-print">
              При подготовке комплект получит номера. Дальнейшие исправления
              оформляются отдельно.
            </p>
          )}
        </section>
      )}
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
                              onClick={() => focusIssue(issue)}
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
      {(draft.status !== "DRAFT" || !!draft.issuances?.length) && (
        <details className="panel">
          <summary>Электронные подписи</summary>
          <SigningPanel
            requestId={id}
            issuances={draft.issuances}
            role={context.user.role}
            onChanged={() => void reload(true)}
          />
        </details>
      )}
      {(draft.kind !== "PERSON" || personStage === "summary" || readonly) && (
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
      )}
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
                    void (
                      readonly ? reload() : flush().then(() => reload())
                    ).catch((caught) => setError(errorText(caught)));
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
              preparationOwner={{
                tenantId: context.tenant.id,
                userId: context.user.id,
              }}
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
              onClick={() => void removeRecipient(removeId)}
            >
              Убрать из заявки
            </button>
          </div>
        </Modal>
      )}
      {restoreConflict && (
        <Modal
          title="Восстановление требует сверки изменений"
          onClose={() => setRestoreConflict(null)}
        >
          <Notice>{restoreConflict.message}</Notice>
          <p>
            Текущие сохранённые данные остаются на месте. Снятая операция хранит
            исходные назначения и результаты; восстановление не заменяет
            сведения, которые изменились позже.
          </p>
          <ul>
            {restoreConflict.conflicts.map((conflict, index) => (
              <li key={index}>
                {draft.items.find((row) => row.id === conflict.recipientId)
                  ?.fullNameRu ||
                  trainingDisplayTitle(
                    draft.events?.find((event) => event.id === conflict.eventId)
                      ?.title || "Сведения обучения",
                  )}{" "}
                · {conflict.field}
              </li>
            ))}
          </ul>
          <div className="modal-actions">
            <button onClick={() => setRestoreConflict(null)}>
              Оставить текущие данные
            </button>
            <button
              onClick={() => {
                const conflict = restoreConflict.conflicts[0];
                setRestoreConflict(null);
                if (conflict?.eventId) {
                  const eventIndex =
                    draft.events?.findIndex(
                      (event) => event.id === conflict.eventId,
                    ) ?? -1;
                  if (eventIndex >= 0)
                    focusIssue({
                      path: `events.${eventIndex}.commonFields.${conflict.field}`,
                      message: "Проверьте изменённые сведения обучения",
                    });
                } else if (conflict?.recipientId)
                  focusRecipient(conflict.recipientId);
              }}
            >
              Проверить текущие сведения
            </button>
          </div>
        </Modal>
      )}
      {trainingRemoval && (
        <Modal
          title="Снять обучение у этой группы?"
          onClose={() => {
            if (!operationBusy) setTrainingRemoval(null);
          }}
        >
          <p>
            <strong>{trainingRemoval.label}</strong> ·{" "}
            {trainingRemoval.recipientIds.length} получателей
            {trainingRemoval.removeDefault
              ? " · общее назначение новым людям будет снято"
              : " · остальные люди сохранят обучение"}
            .
          </p>
          <p>
            Из рабочей редакции будут убраны назначения с программой, датами,
            индивидуальными исключениями и имеющимися результатами. История и
            оформленные документы сохраняются. Эта операция доступна для
            восстановления с исходными идентификаторами и происхождением;
            последующие несвязанные правки останутся.
          </p>
          {error && <Notice>{error}</Notice>}
          <div className="modal-actions">
            <button
              disabled={operationBusy}
              onClick={() => setTrainingRemoval(null)}
            >
              Оставить обучение
            </button>
            <button
              disabled={operationBusy}
              onClick={() => void performTrainingRemoval(trainingRemoval)}
            >
              Снять обучение у {trainingRemoval.recipientIds.length} получателей
            </button>
          </div>
        </Modal>
      )}
      {pastedRange && (
        <GridPasteDialog
          items={draft.items}
          operationError={error}
          newRecipientsTraining={
            draft.trainingDefaults?.length
              ? draft.trainingDefaults
                  .map((value) => value.direction)
                  .join(", ") + " по совместимой категории"
              : "Без обучения — общего назначения новым людям нет"
          }
          {...pastedRange}
          onClose={() => setPastedRange(null)}
          onApply={async (items) => {
            const existing = new Set(draft.items.map((person) => person.id));
            const addedToBundle = items.map((person) =>
              existing.has(person.id)
                ? person
                : recipientForRequest(draft, person),
            );
            const applied = await applyOperation({ items: addedToBundle });
            if (applied) setPastedRange(null);
            return applied;
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
            pendingOrganization.current = false;
            setOrganizationSelection({
              mode: "existing",
              customerId: customer.id,
            });
            setOrganizationError("");
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
          customer={editingCustomer || {}}
          onClose={() => {
            setDialog(null);
            setEditingCustomer(null);
          }}
          onSaved={(customer) => {
            pendingOrganization.current = false;
            setOrganizationSelection({
              mode: "existing",
              customerId: customer.id,
            });
            setOrganizationError("");
            setCustomers((rows) => [
              ...rows.filter((row) => row.id !== customer.id),
              customer,
            ]);
            setEditingCustomer(null);
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
          company={requestEmployer}
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
          resolvedItems={localResolved.draft.items}
          events={draft.events}
          sourceRevision={draft.revision}
          selectedIds={checked}
          operationError={error}
          onClose={() => setDialog(null)}
          onApply={async (items) => {
            if (await applyOperation({ items })) setDialog(null);
          }}
        />
      )}{" "}
      {photoRecipientId && !readonly && (
        <PhotoDialog
          key={photoRecipientId}
          onClose={() => setPhotoRecipientId(null)}
          onSaved={async (assetId, { signal }) => {
            const recipient = current.current?.items.find(
              (item) => item.id === photoRecipientId,
            );
            if (!recipient || signal.aborted)
              throw new Error("Получатель изменился. Откройте фото повторно.");
            const previous = recipient.photoAssetId;
            editRecipient({ ...recipient, photoAssetId: assetId });
            try {
              await flush(false);
            } catch (caught) {
              const latest = current.current?.items.find(
                (item) => item.id === recipient.id,
              );
              if (latest?.photoAssetId === assetId)
                editRecipient({ ...latest, photoAssetId: previous });
              throw caught;
            }
          }}
        />
      )}
      {targetPreview && targetPreview.revision === draft.revision && (
        <Modal
          title="Предпросмотр документа"
          wide
          onClose={() => setTargetPreview(null)}
        >
          <DocumentPreview
            requestId={id}
            draft={draft}
            source={{ revision: targetPreview.revision }}
            initialTarget={targetPreview.target}
            onIssue={(issue) => {
              setTargetPreview(null);
              focusIssue(issue);
            }}
          />
        </Modal>
      )}
      {documentTargets && !readonly && (
        <TrainingBundleDialog
          draft={draft}
          selectedIds={documentTargets}
          disabled={operationBusy}
          onClose={() => setDocumentTargets(null)}
          onRemove={(direction, ids) => {
            setDocumentTargets(null);
            requestTrainingRemoval(direction, ids, false);
          }}
          onApply={async (next) => {
            const returnRecipient =
              documentTargets.length === 1 ? documentTargets[0] : undefined;
            // Adding documents can stop matching "without documents" while the
            // row's chooser is still open. Keep its actual return target present
            // until focus returns and the operator explicitly leaves the row.
            if (returnRecipient) setEditingSearchId(returnRecipient);
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
            if (returnRecipient) focusRecipient(returnRecipient);
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
    </div>
  );
}
