"use client";
import { BulkDialog } from "./bulk-dialog";
import { RecordPicker } from "./record-picker";
import { EventContext } from "./event-context";
import { CustomerOutput } from "./customer-output";
import { CustomerReview } from "./customer-review";
import { RequestOperations } from "./request-operations";
import { GridPasteDialog } from "./grid-paste-dialog";
import type { GridField } from "@/lib/grid-paste";
import { BulkPhotoDialog } from "./bulk-photo-dialog";
import { TextQualityHint } from "./text-quality-hint";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { Icon, Modal, Notice } from "@demo/ui";
import { LIMITS, resolveDraft, documentPlan } from "@demo/contracts";
import { api, ApiError, errorText, json, BEFORE_LOGOUT_EVENT } from "@/lib/api";
import { AutosaveLane } from "@/lib/autosave";
import { recipientForRequest, requestBundles } from "@/lib/request-bundles";
import {
  draftPayload,
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

function validationErrors(caught: unknown): Validation["errors"] {
  if (!(caught instanceof ApiError)) return [];
  const details = (caught.details as { details?: unknown } | undefined)
    ?.details;
  if (!Array.isArray(details)) return [];
  return details.flatMap((issue: unknown) => {
    if (!issue || typeof issue !== "object" || !("message" in issue)) return [];
    const value = issue as {
      message: string;
      path?: string | (string | number)[];
      rowId?: string;
    };
    return [
      {
        message: value.message,
        path: (Array.isArray(value.path)
          ? value.path.join(".")
          : value.path || ""
        ).replace(/^draft\./, ""),
        itemId: value.rowId,
      },
    ];
  });
}

export function Editor({ id, context }: { id: string; context: AppContext }) {
  const router = useRouter();
  const [draft, setDraft] = useState<Draft | null>(null);
  const current = useRef<Draft | null>(null);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [checked, setChecked] = useState<string[]>([]);
  const [rowSearch, setRowSearch] = useState("");
  const [pastedRange, setPastedRange] = useState<{
    startRow: number;
    startField: GridField;
    text: string;
  } | null>(null);
  const [undo, setUndo] = useState<{ before: Draft; revision: number } | null>(
    null,
  );
  const [saveState, setSaveState] = useState("saved");
  const [rowScope, setRowScope] = useState("");
  const [error, setError] = useState("");
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
    | "finalize"
    | "customer"
    | "customerPicker"
    | "recipientPicker"
    | "photos"
    | "conflict"
    | null
  >(null);
  const [refreshFiles, setRefreshFiles] = useState(0);
  const [previewRevision, setPreviewRevision] = useState<number | null>(null);
  const lane = useRef<AutosaveLane<ReturnType<typeof draftPayload>> | null>(
    null,
  );
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const idempotency = useRef<{ revision: number; key: string } | null>(null);
  const errorsRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (validation) {
      errorsRef.current?.focus({ preventScroll: true });
      errorsRef.current?.scrollIntoView({ block: "start" });
    }
  }, [validation]);
  const alive = useRef(true);
  const initialize = useCallback(
    (value: Draft) => {
      current.current = value;
      setDraft(value);
      setServerResolution(null);
      setSelectedId((previous) =>
        value.items.some((item) => item.id === previous)
          ? previous
          : value.items[0]?.id || "",
      );
      setSaveState("saved");
      lane.current = new AutosaveLane(
        draftPayload(value),
        value.revision,
        (payload, expectedRevision) =>
          api<{ revision: number }>(`/print-requests/${id}`, {
            method: "PATCH",
            body: json({ expectedRevision, draft: payload }),
          }),
        (state, revision, caught) => {
          if (!alive.current) return;
          setSaveState(state);
          if (current.current) {
            current.current = { ...current.current, revision };
            setDraft(current.current);
          }
          if (caught) {
            setError(errorText(caught));
            const errors = validationErrors(caught);
            if (errors.length) {
              setValidation({ valid: false, errors });
              setValidationRevision(revision);
            }
            if (caught instanceof ApiError && caught.status === 409)
              setDialog("conflict");
          }
        },
      );
    },
    [id],
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
    const next = { ...current.current, ...patch };
    current.current = next;
    setDraft(next);
    lane.current.edit(draftPayload(next));
    setValidation(null);
    setServerResolution(null);
    setError("");
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      void lane.current?.flush().catch(() => undefined);
    }, 650);
  }
  function editRecipient(value: Recipient) {
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
  async function applyOperation(patch: Partial<Draft>) {
    if (!current.current || busy) return;
    setBusy("bulk");
    setError("");
    try {
      const expectedRevision = await flush();
      const before = structuredClone(current.current);
      const next = { ...before, ...patch };
      if (
        JSON.stringify(draftPayload(before)) ===
        JSON.stringify(draftPayload(next))
      )
        return true;
      const result = await api<{ revision: number }>(`/print-requests/${id}`, {
        method: "PATCH",
        body: json({ expectedRevision, draft: draftPayload(next) }),
      });
      initialize({ ...next, revision: result.revision });
      setUndo({ before, revision: result.revision });
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
        const resolved = await api<ReturnType<typeof resolveDraft>>(
          `/print-requests/${id}/resolved`,
        );
        setServerResolution({ revision, value: resolved });
        const result = await api<
          Validation & { issues?: Validation["errors"] }
        >(`/print-requests/${id}/validate`, {
          method: "POST",
          body: json({ expectedRevision: revision }),
        });
        setValidation({
          ...result,
          errors: result.errors || result.issues || [],
        });
        setValidationRevision(revision);
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
      }
    } catch (caught) {
      setError(errorText(caught));
      const errors = validationErrors(caught);
      if (errors.length) {
        setValidation({ valid: false, errors });
        setValidationRevision(lane.current?.currentRevision ?? null);
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
  const readonly = draft.status !== "DRAFT" || context.user.role === "VIEWER";
  const visibleItems = draft.items.filter(
    (item) =>
      [
        item.fullNameRu,
        item.fullNameKz,
        item.personnelNumber,
        item.externalId,
      ].some((value) =>
        value
          ?.toLocaleLowerCase("ru")
          .includes(rowSearch.toLocaleLowerCase("ru")),
      ) &&
      (!rowScope ||
        (rowScope === "selected"
          ? checked.includes(item.id)
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
              ? item.assignments.some((a) => a.eventId === rowScope.slice(6))
              : item.assignments.some((a) =>
                  a.templateId.startsWith(rowScope),
                ))),
  );
  const selected = draft.items.find((item) => item.id === selectedId);
  const resolved =
    serverResolution?.revision === draft.revision
      ? serverResolution.value
      : resolveDraft(draft);
  const plan = documentPlan(resolved.draft);
  const assignmentCount = draft.items.reduce(
    (sum, item) => sum + item.assignments.length,
    0,
  );
  const documentCount = plan.documentCount;
  const dirty =
    saveState === "dirty" || saveState === "saving" || saveState === "error";
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
            <h1>{draft.title || "Без названия"}</h1>
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
          {
            {
              saved: `Сохранено · редакция ${draft.revision}`,
              dirty: "Есть изменения",
              saving: "Сохраняем…",
              error: "Не сохранено",
            }[saveState]
          }
        </span>
      </div>
      <ol className="workflow" aria-label="Этапы оформления">
        <li className={readonly ? "complete" : "active"}>
          <span>1</span>Получатели и документы
        </li>
        <li className={validation?.valid ? "complete" : ""}>
          <span>2</span>Проверка и макет
        </li>
        <li className={readonly ? "active" : ""}>
          <span>3</span>Оформление и файлы
        </li>
      </ol>
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
          Название заявки
          <input
            aria-label="Название заявки"
            disabled={readonly || operationBusy}
            value={draft.title}
            maxLength={255}
            onChange={(event) => edit({ title: event.target.value })}
          />
        </label>
        {draft.kind === "COMPANY" && (
          <div>
            <label>
              Заказчик
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
      <EventContext
        draft={draft}
        selectedIds={checked}
        disabled={readonly || operationBusy}
        onChange={edit}
        onApply={applyOperation}
        onContextCommit={rememberContextOperation}
        onBusyChange={setContextBusy}
      />
      {!!draft.events?.length && (
        <section className="panel" aria-label="Состав комплекта">
          <h2>Состав комплекта</h2>
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
        </section>
      )}
      {undo && !readonly && (
        <Notice kind="info">
          Последнее массовое изменение сохранено.{" "}
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
                setUndo(null);
              } catch (caught) {
                setError(errorText(caught));
              } finally {
                setBusy("");
              }
            }}
          >
            Отменить массовое изменение
          </button>
          {(dirty || draft.revision !== undo.revision) && (
            <span>
              {" "}
              После следующей правки автоматическая отмена недоступна.
            </span>
          )}
        </Notice>
      )}
      <section className="panel recipients-panel">
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
                disabled={operationBusy || !draft.items.length}
                onClick={() => setDialog("photos")}
              >
                Сопоставить фото
              </button>
              <button
                disabled={operationBusy || draft.items.length >= LIMITS.rows}
                onClick={() => setDialog("recipientPicker")}
              >
                Найти человека
              </button>
              <button
                disabled={operationBusy}
                onClick={() => setDialog("import")}
              >
                <Icon name="upload" />
                Импорт / вставка
              </button>
              <button
                disabled={!checked.length || operationBusy}
                onClick={() => setDialog("bulk")}
              >
                Применить к выбранным ({checked.length})
              </button>
              <button
                disabled={draft.items.length >= LIMITS.rows || operationBusy}
                onClick={() => {
                  const row = recipientForRequest(draft);
                  edit({ items: [...draft.items, row] });
                  setSelectedId(row.id);
                }}
              >
                <Icon name="plus" />
                Получатель
              </button>
            </div>
          )}
        </div>
        <div className="toolbar selection-toolbar">
          <label className="search-field">
            Поиск в заявке
            <input
              value={rowSearch}
              onChange={(e) => setRowSearch(e.target.value)}
              placeholder="ФИО или табельный номер"
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
          </span>
          <label>
            Показать строки
            <select
              value={rowScope}
              onChange={(e) => setRowScope(e.target.value)}
            >
              <option value="">Все</option>
              <option value="selected">Выбранные</option>
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
        </div>
        <div className="editor-grid">
          <div className="recipient-table-wrap">
            <table className="recipient-table">
              <thead>
                <tr>
                  <th>
                    <input
                      type="checkbox"
                      aria-label="Выбрать всех получателей"
                      checked={
                        !!draft.items.length &&
                        checked.length === draft.items.length
                      }
                      onChange={(event) =>
                        setChecked(
                          event.target.checked
                            ? draft.items.map((item) => item.id)
                            : [],
                        )
                      }
                    />
                  </th>
                  <th>Получатель · RU / KZ</th>
                  <th>Документы</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {visibleItems.map((item) => {
                  const index = draft.items.indexOf(item);
                  return (
                    <tr
                      key={item.id}
                      className={item.id === selectedId ? "selected" : ""}
                    >
                      <td>
                        <input
                          type="checkbox"
                          aria-label={`Выбрать строку ${index + 1}`}
                          checked={checked.includes(item.id)}
                          onChange={(event) =>
                            setChecked(
                              event.target.checked
                                ? [...checked, item.id]
                                : checked.filter((value) => value !== item.id),
                            )
                          }
                        />
                        <small>{index + 1}</small>
                      </td>
                      <td>
                        <input
                          aria-label={`ФИО RU, строка ${index + 1}`}
                          onPaste={(event) => {
                            const text = event.clipboardData.getData("text");
                            if (/[\t\r\n]/.test(text)) {
                              event.preventDefault();
                              setPastedRange({
                                startRow: index,
                                startField: "fullNameRu",
                                text,
                              });
                            }
                          }}
                          data-field-path={`items.${index}.fullNameRu`}
                          aria-invalid={
                            !!fieldErrors[`items.${index}.fullNameRu`]
                          }
                          aria-describedby={
                            fieldErrors[`items.${index}.fullNameRu`]
                              ? `name-error-${item.id}`
                              : undefined
                          }
                          disabled={readonly || operationBusy}
                          value={item.fullNameRu}
                          placeholder="ФИО на русском"
                          onFocus={() => setSelectedId(item.id)}
                          onChange={(event) =>
                            editRecipient({
                              ...item,
                              fullNameRu: event.target.value,
                            })
                          }
                        />
                        {fieldErrors[`items.${index}.fullNameRu`] && (
                          <small
                            className="field-error"
                            id={`name-error-${item.id}`}
                          >
                            {fieldErrors[`items.${index}.fullNameRu`]}
                          </small>
                        )}
                        <TextQualityHint value={item.fullNameRu} />
                        <input
                          aria-label={`ФИО KZ, строка ${index + 1}`}
                          onPaste={(event) => {
                            const text = event.clipboardData.getData("text");
                            if (/[\t\r\n]/.test(text)) {
                              event.preventDefault();
                              setPastedRange({
                                startRow: index,
                                startField: "fullNameKz",
                                text,
                              });
                            }
                          }}
                          disabled={readonly || operationBusy}
                          value={item.fullNameKz}
                          placeholder="Қазақша аты-жөні"
                          onFocus={() => setSelectedId(item.id)}
                          onChange={(event) =>
                            editRecipient({
                              ...item,
                              fullNameKz: event.target.value,
                            })
                          }
                        />
                        <TextQualityHint value={item.fullNameKz} />
                      </td>
                      <td>
                        <button
                          className="document-count"
                          onClick={() => setSelectedId(item.id)}
                          aria-label={`Документы и даты получателя ${index + 1}`}
                        >
                          {item.assignments.length}
                          <Icon name="chevron" size={14} />
                        </button>
                      </td>
                      <td>
                        {!readonly && (
                          <button
                            className="icon-button"
                            disabled={operationBusy}
                            aria-label={`Удалить получателя ${index + 1}`}
                            onClick={() => {
                              edit({
                                items: draft.items.filter(
                                  (row) => row.id !== item.id,
                                ),
                              });
                              setChecked(
                                checked.filter((value) => value !== item.id),
                              );
                              if (selectedId === item.id)
                                setSelectedId(
                                  draft.items.find((row) => row.id !== item.id)
                                    ?.id || "",
                                );
                            }}
                          >
                            ×
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {!draft.items.length && (
              <div className="empty-state">
                <p>Добавьте получателя или импортируйте таблицу.</p>
              </div>
            )}
          </div>
          <aside className="recipient-details">
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
                fieldErrors={fieldErrors}
              />
            ) : (
              <p className="muted">
                Выберите получателя, чтобы настроить документы и даты.
              </p>
            )}
          </aside>
        </div>
      </section>
      {validation && (
        <div ref={errorsRef} tabIndex={-1} className="validation-result">
          <Notice kind={validation.valid ? "success" : "error"}>
            <strong>
              {validation.valid
                ? "Данные прошли проверку"
                : "Исправьте данные перед оформлением"}
            </strong>
            <span>
              Редакция {validationRevision}.{" "}
              {validation.valid
                ? `Документов: ${validation.documentCount ?? documentCount}. Проверьте макет перед оформлением.`
                : ""}
            </span>
            {validation.errors.length > 0 && (
              <ul>
                {validation.errors.map((issue, index) => (
                  <li key={index}>
                    <button
                      className="text-button"
                      onClick={() => {
                        if (typeof issue !== "string") {
                          const rowId =
                            (issue as { rowId?: string }).rowId || issue.itemId;
                          if (rowId) setSelectedId(rowId);
                          const path = Array.isArray(issue.path)
                            ? issue.path.join(".")
                            : issue.path || "";
                          const rowIndex = /items\.(\d+)/.exec(path)?.[1];
                          if (rowIndex && draft.items[Number(rowIndex)])
                            setSelectedId(draft.items[Number(rowIndex)].id);
                          requestAnimationFrame(() => {
                            window.dispatchEvent(
                              new CustomEvent("demo:focus-field", {
                                detail: path,
                              }),
                            );
                            const input = document.querySelector<HTMLElement>(
                              `[data-field-path="${CSS.escape(path)}"]`,
                            );
                            const details = input?.closest("details");
                            if (details) details.open = true;
                            input?.focus();
                            input?.scrollIntoView({ block: "center" });
                          });
                        }
                      }}
                    >
                      {typeof issue === "string" ? issue : issue.message}
                    </button>
                  </li>
                ))}
              </ul>
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
      <CustomerReview
        draft={draft}
        flush={flush}
        canManage={context.user.role !== "VIEWER"}
      />
      <CustomerOutput
        draft={draft}
        canManage={context.user.role !== "VIEWER"}
      />
      <RequestOperations
        draft={draft}
        selected={selected}
        flush={flush}
        canManage={context.user.role !== "VIEWER"}
      />
      <FilesPanel
        requestId={id}
        draft={draft}
        refresh={refreshFiles}
        previewStale={
          previewRevision !== null &&
          (previewRevision !== draft.revision || dirty)
        }
        readonly={readonly}
        canManage={context.user.role !== "VIEWER"}
        onChanged={() => void reload()}
      />
      {!readonly && (
        <div className="action-bar">
          <div>
            <strong>
              {draft.items.length} получателей · {documentCount} документов
            </strong>
            <small>Номера будут назначены при оформлении</small>
          </div>
          <div className="action-buttons">
            <button
              disabled={operationBusy}
              onClick={() => void command("save")}
            >
              {busy === "save" ? "Сохраняем…" : "Сохранить"}
            </button>
            <button
              disabled={operationBusy}
              onClick={() => void command("validate")}
            >
              {busy === "validate" ? "Проверяем…" : "Проверить"}
            </button>
            <button
              disabled={operationBusy}
              onClick={() => void command("preview")}
            >
              {busy === "preview" ? "Готовим…" : "Предпросмотр"}
            </button>
            <button
              className="primary"
              disabled={operationBusy || !draft.items.length}
              onClick={() => setDialog("finalize")}
            >
              <Icon name="print" />
              Оформить комплект
            </button>
          </div>
        </div>
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
            setSelectedId(person.id);
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
          existingCount={draft.items.length}
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
          onClose={() => setDialog(null)}
          onApply={async (items) => {
            if (await applyOperation({ items })) setDialog(null);
          }}
        />
      )}{" "}
      {dialog === "finalize" && (
        <Modal
          title="Оформить комплект документов?"
          onClose={() => {
            if (!busy) setDialog(null);
          }}
        >
          <p>
            Будет зарегистрирована последняя сохранённая редакция:{" "}
            {draft.items.length} получателей, {documentCount} документов. Сервер
            назначит номера и начнёт подготовку файлов.
          </p>
          <p>
            Зарегистрированную редакцию нельзя изменить. Для исправлений
            создаётся связанная заявка; оригиналы остаются в истории.
          </p>
          {error && <Notice>{error}</Notice>}
          <div className="modal-actions">
            <button disabled={operationBusy} onClick={() => setDialog(null)}>
              Вернуться к данным
            </button>
            <button
              className="primary"
              disabled={operationBusy}
              onClick={() => void command("finalize")}
            >
              {busy === "finalize" ? "Оформляем…" : "Оформить"}
            </button>
          </div>
        </Modal>
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
