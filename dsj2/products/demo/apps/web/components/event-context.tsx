"use client";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Notice } from "@demo/ui";
import {
  BIOT_CATEGORIES,
  resolveDraft,
  resolveCommonDates,
  calculatedDateKeys,
  commonFieldKeys,
  courseProgramKeys,
  courseResultText,
  hasAutomaticPositiveOutcome,
  positiveAssignmentDefaults,
  trainingDirection,
  type CommonFields,
  type BiotCategory,
  type TrainingEventInput,
} from "@demo/contracts";
import { api, errorText } from "@/lib/api";
import { bulkFields } from "@/lib/bulk-edit";
import { trainingDisplayTitle } from "@/lib/training-display";
import { newAssignment, type Assignment, type Draft } from "@/lib/types";
import {
  eligibleForEvent,
  joinEventAssignmentKit,
} from "@/lib/event-assignment";
import {
  applyEventOutcomes,
  eventOutcomeRecipients,
} from "@/lib/event-outcomes";
import { TrainingDateSettings } from "./training-date-settings";
import { DateCalculationStatus } from "./date-calculation-status";
import {
  flushPreparations,
  useDurablePreparation,
} from "@/lib/use-durable-preparation";
import {
  emptyOutcomePreparation,
  eventPreparationContext,
  preparationPrefix,
  parsePreparation,
  validOutcomePreparation,
  type OutcomePreparation,
  type PreparationOwner,
  type PreparationRecord,
} from "@/lib/preparation-storage";
import { biotCategoryDescription } from "@/lib/validity-display";
import { validCalendarCandidate } from "@/lib/calendar-preparation";

const directions = [
  {
    key: "pb",
    label: "Промышленная безопасность",
    card: "pb-card",
    protocol: "pb-protocol",
  },
  {
    key: "ptm",
    label: "Пожарно-технический минимум",
    card: "ptm-card",
    protocol: "ptm-protocol",
  },
  {
    key: "biot",
    label: "БиОТ рабочих",
    card: "biot-worker-card",
    protocol: "biot-protocol",
  },
  {
    key: "biot-itr",
    label: "БиОТ специальных компетенций ИТР",
    card: "biot-itr-certificate",
    protocol: "biot-itr-protocol",
  },
  { key: "ps", label: "ПС", card: "ps-card", protocol: "ps-protocol" },
] as const;

function AdvancedTrainingSettings({
  primary,
  title,
  children,
}: {
  primary: boolean;
  title: string;
  children: ReactNode;
}) {
  return primary ? (
    <details className="training-advanced-settings">
      <summary>{title}</summary>
      {children}
    </details>
  ) : (
    <>{children}</>
  );
}

export function EventContext({
  draft,
  centerCommon = {},
  selectedIds,
  disabled: externalDisabled,
  onChange,
  onApply,
  onContextCommit,
  onBusyChange,
  embedded = false,
  primary = false,
  fieldHints = {},
  preparationOwner,
}: {
  draft: Draft;
  centerCommon?: CommonFields;
  selectedIds: string[];
  disabled: boolean;
  onChange: (patch: Partial<Draft>) => void;
  onApply: (patch: Partial<Draft>) => Promise<boolean | undefined>;
  onContextCommit: (previousEvents: TrainingEventInput[]) => Promise<void>;
  onBusyChange: (busy: boolean) => void;
  embedded?: boolean;
  primary?: boolean;
  fieldHints?: Record<string, string>;
  preparationOwner?: PreparationOwner;
}) {
  const [expanded, setExpanded] = useState(embedded || primary);
  const sectionRef = useRef<HTMLElement>(null);
  const [focusTarget, setFocusTarget] = useState<{
    eventId: string;
    field: string;
  } | null>(null);
  const [contextBusy, setContextBusy] = useState(false);
  const applying = useRef(false);
  const disabled = externalDisabled || contextBusy;
  const contextBefore = useRef<TrainingEventInput[] | null>(null);
  async function commitContext() {
    const before = contextBefore.current;
    contextBefore.current = null;
    if (before) await onContextCommit(before);
  }
  async function apply(patch: Partial<Draft>) {
    if (applying.current) return false;
    applying.current = true;
    setContextBusy(true);
    onBusyChange(true);
    try {
      await commitContext();
      return await onApply(patch);
    } finally {
      applying.current = false;
      setContextBusy(false);
      onBusyChange(false);
    }
  }
  const [direction, setDirection] = useState("pb");
  const [activeId, setActiveId] = useState(draft.events?.[0]?.id || "");
  const [review, setReview] = useState(false);
  const [reviewSignature, setReviewSignature] = useState("");
  const [replaceEmpty, setReplaceEmpty] = useState(false);
  const [joinExisting, setJoinExisting] = useState(false);
  const [joinError, setJoinError] = useState("");
  const [moveTarget, setMoveTarget] = useState("");
  const [moveConfirmed, setMoveConfirmed] = useState(false);
  const requestCommon = draft.commonFields || {};
  function setRequestCommon(update: (previous: CommonFields) => CommonFields) {
    onChange({ schemaVersion: 2, commonFields: update(requestCommon) });
  }
  const pristine = (assignment: Assignment) =>
    !assignment.eventId &&
    !assignment.documentDate &&
    !assignment.trainingStart &&
    !assignment.trainingEnd &&
    !assignment.protocolDate &&
    (!assignment.trainingSubject ||
      assignment.fieldOrigins?.trainingSubject === "COURSE") &&
    (!assignment.result ||
      (hasAutomaticPositiveOutcome(assignment) &&
        assignment.fieldOrigins?.result === "COURSE" &&
        assignment.result ===
          courseResultText(assignment.templateId, "PASSED"))) &&
    !assignment.externalBasisNumber &&
    !assignment.reason &&
    !assignment.education &&
    !assignment.biotManualFields?.length &&
    !Object.values(assignment.fieldOrigins || {}).some(
      (source) =>
        source === "MANUAL" || source === "IMPORTED" || source === "CLEARED",
    );
  const [profiles, setProfiles] = useState<
    {
      id: string;
      version: number;
      profile: {
        nameRu?: string;
        approved?: boolean;
        commissionTitle?: string;
      };
    }[]
  >([]);
  const [profileError, setProfileError] = useState("");
  const [rules, setRules] = useState<
    {
      id: string;
      title: string;
      version: number;
      status: string;
      applicability: string;
      definition: { compatibleTemplateIds: string[] };
    }[]
  >([]);
  useEffect(() => {
    if (expanded)
      void Promise.all([
        api<{ items: typeof profiles }>("/settings/profiles"),
        api<{ items: typeof rules }>("/service-rules"),
      ])
        .then(([p, r]) => {
          setProfiles(p.items);
          setRules(r.items.filter((rule) => rule.status === "APPROVED"));
        })
        .catch((c) => setProfileError(errorText(c)));
  }, [expanded]);
  const events = draft.events || [];
  const event = events.find((e) => e.id === activeId) || events[0];
  const activeEventId = event?.id || "";
  const eventIndex = events.findIndex((row) => row.id === activeEventId);
  const [topics, setTopics] = useState<
    (Pick<CommonFields, (typeof courseProgramKeys)[number]> & {
      id: string;
      origin: "COURSE" | "SAVED";
    })[]
  >([]);
  const [topicStatus, setTopicStatus] = useState<"loading" | "ready" | "error">(
    "loading",
  );
  const [topicError, setTopicError] = useState("");
  const [topicRetry, setTopicRetry] = useState(0);
  const [topicChoice, setTopicChoice] = useState("");
  const [topicReviewed, setTopicReviewed] = useState(false);
  useEffect(() => {
    let active = true;
    setTopicChoice("");
    setTopicReviewed(false);
    if (!expanded || !event) return;
    setTopicStatus("loading");
    const direction = trainingDirection(event.protocolTemplateId);
    const category =
      event.protocolTemplateId === "biot-itr-protocol" ? "ITR" : "WORKER";
    void api<{ items: typeof topics }>(
      `/training-topics?direction=${direction}&category=${category}`,
    )
      .then((result) => {
        if (active) {
          setTopics(result.items);
          setTopicStatus("ready");
          setTopicError("");
        }
      })
      .catch((error) => {
        if (active) {
          setTopics([]);
          setTopicStatus("error");
          setTopicError(errorText(error));
        }
      });
    return () => {
      active = false;
    };
  }, [expanded, activeEventId, event?.protocolTemplateId, topicRetry]);
  const preparation = useDurablePreparation<OutcomePreparation>({
    identity:
      preparationOwner && activeEventId
        ? {
            ...preparationOwner,
            requestId: draft.id,
            targetId: activeEventId,
            kind: "outcome",
          }
        : undefined,
    defaults: emptyOutcomePreparation,
    context: eventPreparationContext(draft, event),
    revision: draft.revision,
    title: event?.title || "Удалённое обучение",
    validate: validOutcomePreparation,
  });
  const {
    status: outcome,
    source,
    knowledge,
    proctoring,
    scope: outcomeScope,
  } = preparation.value;
  const updatePreparation = (patch: Partial<OutcomePreparation>) => {
    preparation.setValue({ ...preparation.value, ...patch });
    setReview(false);
  };
  const [removedPreparations, setRemovedPreparations] = useState<
    PreparationRecord<unknown>[]
  >([]);
  const [removedPreparationError, setRemovedPreparationError] = useState("");
  const eventIds = events.map((row) => row.id).join(":");
  useEffect(() => {
    if (!preparationOwner) return;
    try {
      const prefix = preparationPrefix(preparationOwner, draft.id);
      const removed: PreparationRecord<unknown>[] = [];
      for (let index = 0; index < localStorage.length; index++) {
        const key = localStorage.key(index);
        if (!key?.startsWith(prefix)) continue;
        const [kind, encodedTarget] = key.slice(prefix.length).split(":");
        if ((kind !== "outcome" && kind !== "calendar") || !encodedTarget)
          continue;
        const targetId = decodeURIComponent(encodedTarget);
        if (targetId === "request" || events.some((row) => row.id === targetId))
          continue;
        const record = parsePreparation<unknown>(
          localStorage.getItem(key),
          { ...preparationOwner, requestId: draft.id, targetId, kind },
          (value): value is unknown =>
            kind === "outcome"
              ? validOutcomePreparation(value)
              : validCalendarCandidate(value),
        );
        if (record) removed.push(record);
      }
      setRemovedPreparations(removed);
      setRemovedPreparationError("");
    } catch {
      setRemovedPreparationError(
        "Не удалось проверить подготовку удалённых обучений. Сохранённый ввод не удалён.",
      );
    }
  }, [
    draft.id,
    eventIds,
    preparationOwner?.tenantId,
    preparationOwner?.userId,
  ]);
  const resolvedForDisplay = expanded
    ? resolveDraft(draft, centerCommon).draft
    : undefined;
  const displayedCommon =
    (expanded
      ? resolvedForDisplay?.events?.find((e) => e.id === activeEventId)
          ?.commonFields
      : undefined) ||
    event?.commonFields ||
    {};
  const resolvedExpiryDates = [
    ...new Set(
      (resolvedForDisplay?.items || []).flatMap((item) =>
        item.assignments
          .filter((assignment) => assignment.eventId === activeEventId)
          .map((assignment) =>
            assignment.validityMode === "UNLIMITED"
              ? "Бессрочно"
              : assignment.validUntil || "Дата документа не указана",
          ),
      ),
    ),
  ];
  const displayedRequestCommon = expanded
    ? resolveCommonDates(
        requestCommon,
        centerCommon,
        draft.presetFields,
        draft.businessRuleVersion === "LIVE_V1",
      )
    : requestCommon;
  const eventAssignments = expanded
    ? draft.items.flatMap((item) =>
        item.assignments
          .filter((a) => a.eventId === activeEventId)
          .map((assignment) => ({ item, assignment })),
      )
    : [];
  const selectedAssignments = eventAssignments.filter(({ item }) =>
    selectedIds.includes(item.id),
  );
  const outcomeRecipients = eventOutcomeRecipients(
    draft,
    activeEventId,
    primary && outcomeScope === "event" ? undefined : selectedIds,
  );
  const selectedParticipantCount = outcomeRecipients.length;
  const outcomeStatistics = (
    [
      ["PASSED", "сдали"],
      ["FAILED", "не сдали"],
      ["ABSENT", "не явились"],
      ["UNKNOWN", "не подтверждены"],
    ] as const
  ).map(([status, label]) => ({
    status,
    label,
    count: new Set(
      eventAssignments
        .filter(
          ({ assignment }) =>
            (assignment.outcome?.status || "UNKNOWN") === status,
        )
        .map(({ item }) => item.id),
    ).size,
  }));
  const hasUnconfirmedResults = outcomeStatistics.some(
    (entry) => entry.status === "UNKNOWN" && entry.count > 0,
  );
  const outcomeSignature = JSON.stringify([
    activeEventId,
    outcomeRecipients.map((item) => item.id),
    outcome,
    source,
    knowledge,
    proctoring,
    eventPreparationContext(
      draft,
      event,
      outcomeRecipients.map((item) => item.id),
    ),
  ]);
  const reviewed =
    review && reviewSignature === outcomeSignature && !preparation.stale;
  const outcomeLengthErrors = {
    source: source.length > 500,
    knowledge: knowledge.length > 500,
    proctoring: proctoring.length > 500,
  };
  useEffect(() => {
    function focusTraining(nativeEvent: Event) {
      const target = (
        nativeEvent as CustomEvent<{ eventId: string; field: string }>
      ).detail;
      if (!target?.eventId || !target.field) return;
      if (target.eventId !== activeEventId && !flushPreparations()) return;
      if (target.eventId !== activeEventId) setReview(false);
      setActiveId(target.eventId);
      setExpanded(true);
      setFocusTarget(target);
    }
    window.addEventListener("demo:focus-training", focusTraining);
    return () =>
      window.removeEventListener("demo:focus-training", focusTraining);
  }, [activeEventId]);
  useEffect(() => {
    if (!focusTarget || focusTarget.eventId !== activeEventId) return;
    const frame = requestAnimationFrame(() => {
      const field = focusTarget.field.startsWith("outcomes.")
        ? focusTarget.field.slice("outcomes.".length)
        : focusTarget.field.startsWith("outcome") ||
            focusTarget.field === "result"
          ? "outcomes"
          : focusTarget.field.replace(/^commonFields\./, "");
      const target =
        Array.from(
          sectionRef.current?.querySelectorAll<HTMLElement>(
            "[data-training-field]",
          ) || [],
        ).find((element) => element.dataset.trainingField === field) ||
        Array.from(
          document.querySelectorAll<HTMLElement>("[data-field-path]"),
        ).find(
          (element) =>
            element.dataset.fieldPath ===
            `events.${eventIndex}.commonFields.${field}`,
        );
      if (!target) return;
      if (target instanceof HTMLDetailsElement) target.open = true;
      let parent = target.parentElement;
      while (parent && parent !== sectionRef.current) {
        if (parent instanceof HTMLDetailsElement) parent.open = true;
        parent = parent.parentElement;
      }
      target.focus({ preventScroll: true });
      target.scrollIntoView({ block: "center" });
    });
    return () => cancelAnimationFrame(frame);
  }, [activeEventId, eventIndex, focusTarget]);
  const moveTargets = event
    ? events.filter(
        (target) =>
          target.id !== event.id &&
          target.protocolTemplateId === event.protocolTemplateId &&
          target.commonFields.biotCategory === event.commonFields.biotCategory,
      )
    : [];
  const moveConflicts = selectedAssignments.filter(({ item, assignment }) =>
    item.assignments.some(
      (other) =>
        other.eventId === moveTarget &&
        other.templateId === assignment.templateId,
    ),
  );
  function updateEvent(patch: Partial<TrainingEventInput>) {
    if (!contextBefore.current) contextBefore.current = structuredClone(events);
    if (event)
      onChange({
        events: events.map((e) =>
          e.id === event.id ? { ...e, ...patch, revision: e.revision + 1 } : e,
        ),
      });
  }
  function changeEventCommon(patch: Partial<CommonFields>) {
    if (!event) return;
    const next = { ...event.commonFields, ...patch };
    for (const key of courseProgramKeys)
      if (Object.hasOwn(patch, key))
        next.fieldOrigins = {
          ...next.fieldOrigins,
          [key]: patch[key] ? "MANUAL" : "CLEARED",
        };
    for (const key of calculatedDateKeys)
      if (Object.hasOwn(patch, key))
        next.dateOrigins = {
          ...next.dateOrigins,
          [key]: patch[key] ? "MANUAL" : "CLEARED",
        };
    updateEvent({ commonFields: next });
  }
  const selectedTopic = topics.find((topic) => topic.id === topicChoice);
  const topicSettings = event && (
    <details className="training-topic-settings">
      <summary>Выбрать типовую или сохранённую программу</summary>
      <p className="fine-print">
        Сохраняются только темы этого направления вашего центра. Выбор программы
        не переносит результаты, оценки, даты и основания.
      </p>
      {topicStatus === "loading" ? (
        <p role="status">Загружаются программы…</p>
      ) : topicStatus === "error" ? (
        <Notice kind="error">
          {topicError}
          <button
            type="button"
            onClick={() => setTopicRetry((value) => value + 1)}
          >
            Повторить загрузку программ
          </button>
        </Notice>
      ) : (
        <label>
          Программа из списка
          <select
            aria-label="Типовая или сохранённая программа"
            disabled={disabled}
            value={topicChoice}
            onChange={(change) => {
              setTopicChoice(change.target.value);
              setTopicReviewed(false);
            }}
          >
            <option value="">Текущее или собственное значение</option>
            {topics.map((topic) => (
              <option key={topic.id} value={topic.id}>
                {topic.origin === "COURSE" ? "Типовая" : "Сохранённая"}:{" "}
                {topic.trainingSubject}
              </option>
            ))}
          </select>
        </label>
      )}
      {selectedTopic && (
        <>
          <p>
            Выбранная программа: {selectedTopic.trainingSubject}
            {selectedTopic.trainingSubjectKz
              ? ` · KZ: ${selectedTopic.trainingSubjectKz}`
              : " · отдельный KZ не задан"}
            .
          </p>
          {topicReviewed && (
            <Notice kind="info">
              Будет заменена программа этого обучения «
              {displayedCommon.trainingSubject || "не задана"}» и её KZ-вариант
              «{displayedCommon.trainingSubjectKz || "не задан"}». Дисциплины ПС
              будут заменены значениями выбранной программы. Индивидуальные
              ручные исключения сохраняются.
            </Notice>
          )}
          <button
            type="button"
            disabled={disabled}
            onClick={() => {
              if (!topicReviewed) {
                setTopicReviewed(true);
                return;
              }
              const patch = Object.fromEntries(
                courseProgramKeys.map((key) => [key, selectedTopic[key] || ""]),
              );
              changeEventCommon(patch);
              setTopicChoice("");
              setTopicReviewed(false);
            }}
          >
            {topicReviewed
              ? "Применить выбранную программу"
              : "Проверить замену программы"}
          </button>
        </>
      )}
    </details>
  );
  function renderEventField([field, label, type]: (typeof bulkFields)[number]) {
    const hint = fieldHints[`events.${eventIndex}.commonFields.${field}`];
    const value = String(displayedCommon[field] || "");
    const limit =
      field === "hours" ? 30 : field === "externalBasisNumber" ? 100 : 500;
    const lengthError = type === "text" && value.length > limit;
    const feedbackId = `event-${activeEventId}-${field}-feedback`;
    return (
      <label key={field}>
        {label}
        <input
          aria-label={label}
          data-training-field={field}
          data-field-path={`events.${eventIndex}.commonFields.${field}`}
          type={type}
          disabled={disabled}
          aria-invalid={lengthError || !!hint || undefined}
          aria-describedby={feedbackId}
          value={value}
          onChange={(change) =>
            changeEventCommon({ [field]: change.target.value })
          }
        />
        {lengthError ? (
          <small className="field-error" id={feedbackId}>
            Не больше {limit} символов; сейчас {value.length}. Сократите текст
            для сохранения.
          </small>
        ) : hint ? (
          <small className="field-hint" id={feedbackId}>
            {hint}
          </small>
        ) : (
          <small id={feedbackId}>
            {field === "trainingSubject"
              ? event?.commonFields.fieldOrigins?.trainingSubject === "CLEARED"
                ? "Программа явно очищена"
                : event?.commonFields.trainingSubject &&
                    event.commonFields.fieldOrigins?.trainingSubject !==
                      "COURSE"
                  ? "Программа этого обучения"
                  : draft.commonFields?.trainingSubject
                    ? "Общая программа заявки"
                    : draft.presetFields?.trainingSubject
                      ? "Программа пользовательского набора"
                      : centerCommon.trainingSubject
                        ? "Программа из настроек центра"
                        : "Типовая программа курса"
              : primary
                ? "\u00a0"
                : "Общее значение события"}
          </small>
        )}
      </label>
    );
  }
  function fieldHint(field: string, group = "commonFields") {
    const hint = fieldHints[`events.${eventIndex}.${group}.${field}`];
    return hint ? <small className="field-hint">{hint}</small> : null;
  }
  function addEvent() {
    const choice = directions.find((d) => d.key === direction)!;
    const next: TrainingEventInput = {
      id: crypto.randomUUID(),
      title: choice.label,
      protocolTemplateId: choice.protocol,
      revision: 0,
      commonFields: {
        ...(choice.key === "biot"
          ? {
              biotCategory: "WORKER" as const,
              biotCheckType: "PERIODIC" as const,
              hours: "10",
              productionHours: "16",
            }
          : {}),
      },
    };
    if (choice.key === "biot-itr")
      next.commonFields = {
        ...next.commonFields,
        biotCategory: "OHS_SPECIALIST_SPECIAL",
        biotCheckType: "PERIODIC",
        hours: "40",
      };
    void apply({ schemaVersion: 2, events: [...events, next] });
    setActiveId(next.id);
  }
  function assignSet() {
    if (!event) return;
    const choice = directions.find(
      (d) => d.protocol === event.protocolTemplateId,
    );
    if (!choice) return;
    const joined = new Map<string, Assignment[]>();
    const conflicts: string[] = [];
    if (joinExisting)
      for (const item of draft.items) {
        if (!selectedIds.includes(item.id)) continue;
        const candidates = item.assignments.filter((a) =>
          eligibleForEvent(a, choice.card),
        );
        if (candidates.length !== 1) continue;
        const kit = joinEventAssignmentKit(
          draft,
          item,
          candidates[0],
          event.id,
        );
        if (kit) joined.set(item.id, kit);
        else conflicts.push(item.fullNameRu || item.id);
      }
    if (conflicts.length) {
      setJoinError(
        `Присоединение не выполнено: в индивидуальном протоколе есть отдельные изменения у ${conflicts.length} получателей (${conflicts.slice(0, 3).join(", ")}). Проверьте индивидуальные документы перед объединением; введённые сведения сохранены.`,
      );
      return;
    }
    setJoinError("");
    void apply({
      items: draft.items.map((item) => {
        if (
          !selectedIds.includes(item.id) ||
          item.assignments.some(
            (a) => a.eventId === event.id && a.templateId === choice.card,
          )
        )
          return item;
        const candidates = item.assignments.filter((a) =>
          eligibleForEvent(a, choice.card),
        );
        if (joinExisting && candidates.length === 1)
          return {
            ...item,
            assignments: joined.get(item.id)!,
          };
        const assignment: Assignment = {
          ...newAssignment(choice.card),
          eventId: event.id,
          protocolMode: "GROUP",
          ...positiveAssignmentDefaults(choice.card),
          fieldOrigins: {
            ...Object.fromEntries(
              commonFieldKeys.map((key) => [key, "INHERITED" as const]),
            ),
            ...positiveAssignmentDefaults(choice.card).fieldOrigins,
          },
        };
        return {
          ...item,
          assignments: [
            ...item.assignments.filter(
              (a) =>
                !(
                  (a.templateId === choice.card || replaceEmpty) &&
                  pristine(a) &&
                  !a.eventId &&
                  !a.documentDate &&
                  (!a.trainingSubject ||
                    a.fieldOrigins?.trainingSubject === "COURSE")
                ),
            ),
            assignment,
          ],
        };
      }),
    });
  }
  const joinSettings = (
    <AdvancedTrainingSettings
      primary={primary}
      title="Присоединение ранее назначенных документов"
    >
      <label className="checkbox-label">
        <input
          type="checkbox"
          checked={joinExisting}
          disabled={disabled}
          onChange={(e) => setJoinExisting(e.target.checked)}
        />
        Присоединить к событию существующее назначение той же формы без
        результата и основания, если оно одно. Импортированные и ручные
        исключения сохраняются.
      </label>
      <label className="checkbox-label">
        <input
          type="checkbox"
          checked={replaceEmpty}
          disabled={disabled}
          onChange={(e) => setReplaceEmpty(e.target.checked)}
        />
        При назначении набора убрать пустые начальные назначения других
        направлений у выбранных людей. Введённые и импортированные сведения
        сохраняются.
      </label>
    </AdvancedTrainingSettings>
  );
  const creationSettings = (
    <AdvancedTrainingSettings
      primary={primary}
      title="Создать отдельную группу обучения"
    >
      <div>
        <label>
          Направление нового события
          <select
            value={direction}
            disabled={disabled}
            onChange={(e) => setDirection(e.target.value)}
          >
            {directions.map((d) => (
              <option key={d.key} value={d.key}>
                {d.label}
              </option>
            ))}
          </select>
        </label>
        <button disabled={disabled} onClick={addEvent}>
          Добавить событие
        </button>
      </div>
    </AdvancedTrainingSettings>
  );
  const metadataSettings = event ? (
    <AdvancedTrainingSettings
      primary={primary}
      title="Название группы, профиль центра и паспорт услуги"
    >
      <label>
        Название события
        <input
          value={event.title}
          disabled={disabled}
          onChange={(e) => updateEvent({ title: e.target.value })}
        />
      </label>
      {profileError && <Notice>{profileError}</Notice>}
      <label>
        Утверждённый паспорт услуги
        <select
          data-training-field="serviceRuleVersionId"
          data-field-path={`events.${eventIndex}.serviceRuleVersionId`}
          value={event.serviceRuleVersionId || ""}
          disabled={disabled}
          onChange={(e) =>
            updateEvent({
              serviceRuleVersionId: e.target.value || undefined,
            })
          }
        >
          <option value="">Без выбранного паспорта</option>
          {rules
            .filter(
              (rule) =>
                rule.definition.compatibleTemplateIds.includes(
                  event.protocolTemplateId,
                ) ||
                rule.definition.compatibleTemplateIds.includes(
                  directions.find(
                    (d) => d.protocol === event.protocolTemplateId,
                  )?.card || "",
                ),
            )
            .map((rule) => (
              <option key={rule.id} value={rule.id}>
                {rule.title} · версия {rule.version}
              </option>
            ))}
        </select>
      </label>
      {event.serviceRuleVersionId && (
        <p className="fine-print">
          Применимость:{" "}
          {rules.find((rule) => rule.id === event.serviceRuleVersionId)
            ?.applicability ||
            "Паспорт зафиксирован в событии; проверьте актуальность версии."}
        </p>
      )}
      <label>
        Профиль эмитента и комиссия
        <select
          aria-label="Профиль эмитента и комиссия"
          data-training-field="profileVersionId"
          data-field-path={`events.${eventIndex}.profileVersionId`}
          value={event.profileVersionId || ""}
          disabled={disabled}
          onChange={(e) =>
            updateEvent({
              profileVersionId: e.target.value || undefined,
            })
          }
        >
          <option value="">Действующая версия центра</option>
          {profiles.map((p) => (
            <option value={p.id} key={p.id}>
              {p.profile.commissionTitle ||
                p.profile.nameRu ||
                "Профиль центра"}{" "}
              · версия {p.version}
              {p.profile.approved ? " · утверждён" : " · не утверждён"}
            </option>
          ))}
        </select>
        <small>
          В выпуске сохраняется выбранная версия профиля и комиссии. График
          обучения наследуется от настроек заявки; при необходимости измените
          его ниже для этой группы.
        </small>
      </label>
    </AdvancedTrainingSettings>
  ) : null;
  const eventDateSettings = event ? (
    <>
      <TrainingDateSettings
        key={event.id}
        rule={displayedCommon.trainingDateRule}
        preparationIdentity={
          preparationOwner
            ? {
                ...preparationOwner,
                requestId: draft.id,
                targetId: event.id,
                kind: "calendar",
              }
            : undefined
        }
        preparationContext={eventPreparationContext(draft, event)}
        requestRevision={draft.revision}
        targetTitle={event.title}
        fieldPath={`events.${eventIndex}.commonFields.trainingDateRule`}
        fieldHints={fieldHints}
        disabled={disabled}
        onChange={(rule) =>
          updateEvent({
            commonFields: {
              ...event.commonFields,
              trainingDateRule: rule,
            },
          })
        }
      />
      <DateCalculationStatus
        values={displayedCommon}
        forceValidity={draft.businessRuleVersion === "LIVE_V1"}
        validityDescription={`Сроки документов участников: ${resolvedExpiryDates.join("; ") || "дата документа не указана"}. Рабочий — 1 год, ИТР — 3 года от даты документа; ПС — бессрочно. Ручные и импортированные исключения сохраняются.`}
        rule={displayedCommon.trainingDateRule}
        origins={Object.fromEntries(
          calculatedDateKeys.map((key) => [
            key,
            event.commonFields.dateOrigins?.[key] ||
              (Object.hasOwn(event.commonFields, key)
                ? "EVENT"
                : draft.commonFields?.dateOrigins?.[key] ||
                  (Object.hasOwn(draft.commonFields || {}, key)
                    ? "REQUEST"
                    : undefined)),
          ]),
        )}
        disabled={disabled}
        onRestore={(key) =>
          updateEvent({
            commonFields: {
              ...event.commonFields,
              [key]: "",
              dateOrigins: {
                ...event.commonFields.dateOrigins,
                [key]: "AUTO",
              },
            },
          })
        }
      />
    </>
  ) : null;
  const assignmentSettings = event ? (
    <AdvancedTrainingSettings
      primary={primary}
      title="Добавить выбранных людей в это обучение"
    >
      <div className="toolbar-actions">
        <button disabled={disabled || !selectedIds.length} onClick={assignSet}>
          Назначить набор выбранным ({selectedIds.length})
        </button>
        <span className="muted">
          {eventAssignments.length} назначений · 1 общий протокол при оформлении
        </span>
      </div>
      {joinError && <Notice>{joinError}</Notice>}
    </AdvancedTrainingSettings>
  ) : null;
  const moveSettings = event ? (
    <details className="outcome-entry">
      <summary>Перенести выбранных участников в другое событие</summary>
      <p>
        Перенос доступен только в черновике и в совместимое событие.
        Индивидуальные и импортированные исключения сохраняются; наследуемые
        значения берутся из нового события. Результаты старого события снимаются
        и требуют нового подтверждения.
      </p>
      <label>
        Событие назначения
        <select
          value={moveTarget}
          disabled={disabled}
          onChange={(e) => {
            setMoveTarget(e.target.value);
            setMoveConfirmed(false);
          }}
        >
          <option value="">Выберите совместимое событие</option>
          {moveTargets.map((target) => (
            <option key={target.id} value={target.id}>
              {trainingDisplayTitle(target.title)} ·{" "}
              {target.commonFields.trainingStart || "дата не задана"}
            </option>
          ))}
        </select>
      </label>
      <p>
        Будет перенесено: {selectedAssignments.length} назначений из события «
        {trainingDisplayTitle(event.title)}».
      </p>
      {moveConflicts.length > 0 && (
        <Notice>
          У {moveConflicts.length} выбранных участников уже есть эта форма в
          целевом событии. Уберите этих людей из выбора, чтобы не создать дубли.
        </Notice>
      )}
      <label className="checkbox-label">
        <input
          type="checkbox"
          checked={moveConfirmed}
          disabled={disabled}
          onChange={(e) => setMoveConfirmed(e.target.checked)}
        />
        Подтверждаю перенос выбранных участников и снятие прежних результатов.
        Состав и общие параметры нового события проверены.
      </label>
      <button
        disabled={
          disabled ||
          !moveConfirmed ||
          !moveTargets.some((target) => target.id === moveTarget) ||
          !selectedAssignments.length ||
          !!moveConflicts.length
        }
        onClick={async () => {
          const sourceId = event.id;
          const applied = await apply({
            events: events.map((value) =>
              [sourceId, moveTarget].includes(value.id)
                ? { ...value, revision: value.revision + 1 }
                : value,
            ),
            items: draft.items.map((item) =>
              !selectedIds.includes(item.id)
                ? item
                : {
                    ...item,
                    assignments: item.assignments.map((assignment) =>
                      assignment.eventId !== sourceId
                        ? assignment
                        : {
                            ...assignment,
                            eventId: moveTarget,
                            result: "",
                            outcome: {
                              status: "UNKNOWN",
                              source: "",
                            },
                            ...(assignment.templateId.startsWith("biot-")
                              ? {
                                  biotKnowledgeResult: "",
                                  biotProctoringResult: "",
                                  biotUniqueNumber: "",
                                }
                              : {}),
                          },
                    ),
                  },
            ),
          });
          if (applied) {
            setActiveId(moveTarget);
            setMoveTarget("");
            setMoveConfirmed(false);
          }
        }}
      >
        Перенести выбранные назначения
      </button>
    </details>
  ) : null;
  const requestSettings = (
    <details open={!primary}>
      <summary>Даты и программа для всей заявки</summary>
      <p>
        Применяются к документам без индивидуальных изменений. У отдельной
        группы могут быть свои даты. «Убрать значение» возвращает настройки
        центра.
      </p>
      <div className="form-grid">
        {bulkFields
          .filter(([field]) =>
            [
              "documentDate",
              "trainingStart",
              "trainingEnd",
              "protocolDate",
              "trainingSubject",
              "hours",
            ].includes(field),
          )
          .map(([field, label, type]) => (
            <div key={field}>
              <label>
                {label} для заявки
                <input
                  aria-label={`${label} для заявки`}
                  type={type}
                  disabled={disabled}
                  value={String(
                    displayedRequestCommon[
                      field as keyof typeof requestCommon
                    ] || "",
                  )}
                  onChange={(e) =>
                    setRequestCommon((old) => ({
                      ...old,
                      [field]: e.target.value,
                      ...(calculatedDateKeys.includes(
                        field as (typeof calculatedDateKeys)[number],
                      )
                        ? {
                            dateOrigins: {
                              ...old.dateOrigins,
                              [field]: e.target.value ? "MANUAL" : "CLEARED",
                            },
                          }
                        : {}),
                    }))
                  }
                />
              </label>
              <button
                disabled={disabled || !Object.hasOwn(requestCommon, field)}
                aria-label={`Убрать общее значение: ${label}`}
                onClick={() =>
                  setRequestCommon((old) => {
                    const next = { ...old };
                    delete next[field as keyof typeof next];
                    if (next.dateOrigins && field in next.dateOrigins) {
                      next.dateOrigins = { ...next.dateOrigins };
                      delete next.dateOrigins[
                        field as keyof typeof next.dateOrigins
                      ];
                    }
                    return next;
                  })
                }
              >
                Убрать значение
              </button>
            </div>
          ))}
      </div>
      <TrainingDateSettings
        key="request-calendar"
        rule={displayedRequestCommon.trainingDateRule}
        preparationIdentity={
          preparationOwner
            ? {
                ...preparationOwner,
                requestId: draft.id,
                targetId: "request",
                kind: "calendar",
              }
            : undefined
        }
        preparationContext={JSON.stringify({
          commonFields: draft.commonFields,
          eventIds,
        })}
        requestRevision={draft.revision}
        targetTitle="Общий график заявки"
        fieldPath="commonFields.trainingDateRule"
        fieldHints={fieldHints}
        disabled={disabled}
        onChange={(rule) =>
          setRequestCommon((old) => ({ ...old, trainingDateRule: rule }))
        }
      />
      <DateCalculationStatus
        values={displayedRequestCommon}
        forceValidity={draft.businessRuleVersion === "LIVE_V1"}
        rule={displayedRequestCommon.trainingDateRule}
        origins={Object.fromEntries(
          calculatedDateKeys.map((key) => [
            key,
            requestCommon.dateOrigins?.[key] ||
              (Object.hasOwn(requestCommon, key) ? "REQUEST" : undefined),
          ]),
        )}
        disabled={disabled}
        onRestore={(key) =>
          setRequestCommon((old) => ({
            ...old,
            [key]: "",
            dateOrigins: { ...old.dateOrigins, [key]: "AUTO" },
          }))
        }
      />
      <p className="fine-print">
        Общие значения сохраняются автоматически вместе с заявкой.
        Индивидуальные исключения сохраняются.
      </p>
    </details>
  );
  return (
    <section
      ref={sectionRef}
      className={
        embedded
          ? primary
            ? "training-primary-context"
            : undefined
          : "panel common-context"
      }
      onBlurCapture={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null))
          void commitContext();
      }}
    >
      {!embedded && (
        <div className="toolbar">
          <div>
            <h2>
              {primary
                ? "Данные обучения и результаты"
                : "Общие даты и групповые протоколы"}
            </h2>
            <span className="muted">
              {events.length
                ? `${events.length} событий · ${events.reduce((n, e) => n + draft.items.filter((i) => i.assignments.some((a) => a.eventId === e.id)).length, 0)} участников событий`
                : "Период обучения, программа и протокол для группы"}
            </span>
          </div>
          {!primary && (
            <button
              onClick={() => {
                if (expanded && !flushPreparations()) return;
                setExpanded(!expanded);
              }}
              aria-expanded={expanded}
            >
              {expanded ? "Свернуть" : "Настроить даты и протоколы"}
            </button>
          )}
        </div>
      )}
      {expanded && (
        <div className="context-body">
          {removedPreparationError && (
            <Notice kind="error">{removedPreparationError}</Notice>
          )}
          {removedPreparations.map((record) => (
            <Notice
              key={`${record.identity.kind}:${record.identity.targetId}`}
              kind="info"
            >
              Подготовка{" "}
              {record.identity.kind === "outcome" ? "результата" : "графика"}{" "}
              для «{trainingDisplayTitle(record.title)}» сохранена в этом
              браузере, но обучение удалено. Она не применяется к другому
              обучению. Восстановите исходное обучение командой отмены снятия,
              чтобы продолжить, либо отмените эту подготовку.
              <details>
                <summary>Сохранённый ввод</summary>
                <pre>{JSON.stringify(record.value, null, 2)}</pre>
              </details>
              <button
                type="button"
                disabled={disabled}
                onClick={() => {
                  try {
                    const prefix = preparationPrefix(
                      preparationOwner!,
                      draft.id,
                    );
                    const key =
                      prefix +
                      [record.identity.kind, record.identity.targetId]
                        .map(encodeURIComponent)
                        .join(":");
                    localStorage.removeItem(key);
                    setRemovedPreparations((rows) =>
                      rows.filter((row) => row !== record),
                    );
                  } catch {
                    setRemovedPreparationError(
                      "Не удалось отменить подготовку. Сохранённый ввод остаётся в браузере.",
                    );
                  }
                }}
              >
                Отменить подготовку удалённого обучения
              </button>
            </Notice>
          ))}
          {!primary && (
            <p>
              Задайте общие даты и программу для группы. Индивидуальные
              изменения у людей сохраняются. Для отдельного курса можно создать
              новую группу.
            </p>
          )}
          {!primary && requestSettings}
          {!primary && joinSettings}
          {(!primary || events.length !== 1) && (
            <div className="form-grid">
              <label>
                {primary ? "Обучение" : "Событие"}
                <select
                  aria-label={
                    primary
                      ? "Обучение для общих данных и результатов"
                      : undefined
                  }
                  value={activeEventId}
                  disabled={disabled}
                  onChange={(e) => {
                    if (!flushPreparations()) return;
                    setActiveId(e.target.value);
                    setReview(false);
                  }}
                >
                  <option value="">
                    {primary
                      ? "Сначала назначьте обучение людям"
                      : "Выберите событие"}
                  </option>
                  {events.map((e) => (
                    <option key={e.id} value={e.id}>
                      {trainingDisplayTitle(e.title)}
                    </option>
                  ))}
                </select>
              </label>
              {!primary && creationSettings}
            </div>
          )}
          {event && (
            <>
              {!primary && metadataSettings}
              <div className="form-grid">
                {bulkFields
                  .filter(
                    ([field]) =>
                      !primary || ["trainingSubject", "hours"].includes(field),
                  )
                  .map(renderEventField)}
                <label>
                  Программа — отдельный KZ-вариант
                  <input
                    aria-label="Программа — отдельный KZ-вариант"
                    data-training-field="trainingSubjectKz"
                    data-field-path={`events.${eventIndex}.commonFields.trainingSubjectKz`}
                    disabled={disabled}
                    value={displayedCommon.trainingSubjectKz || ""}
                    onChange={(change) =>
                      changeEventCommon({
                        trainingSubjectKz: change.target.value,
                      })
                    }
                  />
                  <small>
                    Необязательно. Без отдельного варианта используется
                    введённая программа; это не автоматический перевод.
                  </small>
                </label>
              </div>
              {topicSettings}
              {event.protocolTemplateId === "ps-protocol" && (
                <AdvancedTrainingSettings
                  primary={primary}
                  title="Дисциплины удостоверения ПС"
                >
                  <div className="form-grid">
                    {(
                      [
                        [
                          "psGeneralSubjectRu",
                          "Общепрофессиональная дисциплина — RU",
                        ],
                        [
                          "psGeneralSubjectKz",
                          "Общепрофессиональная дисциплина — KZ",
                        ],
                        ["psSpecialSubjectRu", "Специальная дисциплина — RU"],
                        ["psSpecialSubjectKz", "Специальная дисциплина — KZ"],
                      ] as const
                    ).map(([key, label]) => (
                      <label key={key}>
                        {label}
                        <input
                          aria-label={label}
                          data-training-field={key}
                          data-field-path={`events.${eventIndex}.commonFields.${key}`}
                          disabled={disabled}
                          value={displayedCommon[key] || ""}
                          onChange={(change) =>
                            changeEventCommon({ [key]: change.target.value })
                          }
                        />
                      </label>
                    ))}
                  </div>
                  <small>
                    Названия исходной формы подставляются автоматически. Оценки
                    берутся только из подтверждённых сведений.
                  </small>
                </AdvancedTrainingSettings>
              )}
              {primary && (
                <AdvancedTrainingSettings
                  primary
                  title="Отдельные даты и основания этого обучения"
                >
                  <p className="fine-print">
                    Здесь можно уточнить период обучения и изменить общую дату
                    выдачи только для этой группы.
                  </p>
                  <div className="form-grid">
                    {bulkFields
                      .filter(
                        ([field]) =>
                          !["trainingSubject", "hours"].includes(field),
                      )
                      .map(renderEventField)}
                  </div>
                  {eventDateSettings}
                </AdvancedTrainingSettings>
              )}
              {!primary && eventDateSettings}
              {event.protocolTemplateId.startsWith("biot-") && (
                <div className="form-grid">
                  {!primary && (
                    <label>
                      Категория БиОТ события
                      <select
                        data-training-field="biotCategory"
                        data-field-path={`events.${eventIndex}.commonFields.biotCategory`}
                        disabled={disabled}
                        value={event.commonFields.biotCategory || "WORKER"}
                        onChange={(e) =>
                          updateEvent({
                            commonFields: {
                              ...event.commonFields,
                              biotCategory: e.target.value as BiotCategory,
                            },
                          })
                        }
                      >
                        {event.protocolTemplateId === "biot-protocol" ? (
                          <option value="WORKER">
                            {BIOT_CATEGORIES.WORKER.label}
                          </option>
                        ) : (
                          <option value="OHS_SPECIALIST_SPECIAL">
                            {BIOT_CATEGORIES.OHS_SPECIALIST_SPECIAL.label}
                          </option>
                        )}
                      </select>
                      {fieldHint("biotCategory")}
                    </label>
                  )}
                  <label>
                    {primary ? "Вид проверки" : "Вид проверки БиОТ события"}
                    <select
                      data-training-field="biotCheckType"
                      data-field-path={`events.${eventIndex}.commonFields.biotCheckType`}
                      disabled={disabled}
                      value={event.commonFields.biotCheckType || ""}
                      onChange={(e) =>
                        updateEvent({
                          commonFields: {
                            ...event.commonFields,
                            biotCheckType: e.target.value as
                              | "PERIODIC"
                              | "REPEAT",
                          },
                        })
                      }
                    >
                      <option value="">Выберите фактический вид</option>
                      <option value="PERIODIC">Периодическая</option>
                      <option value="REPEAT">Повторная</option>
                    </select>
                    {fieldHint("biotCheckType")}
                  </label>
                  {event.protocolTemplateId === "biot-protocol" && (
                    <label>
                      {primary
                        ? "Производственное обучение, часов"
                        : "Производственное обучение события, часов"}
                      <input
                        data-training-field="productionHours"
                        data-field-path={`events.${eventIndex}.commonFields.productionHours`}
                        disabled={disabled}
                        value={event.commonFields.productionHours || ""}
                        onChange={(e) =>
                          updateEvent({
                            commonFields: {
                              ...event.commonFields,
                              productionHours: e.target.value,
                            },
                          })
                        }
                      />
                      {fieldHint("productionHours")}
                    </label>
                  )}
                  {event.protocolTemplateId === "biot-itr-protocol" && (
                    <>
                      {(
                        [
                          [
                            "biotIndustryRu",
                            "Отрасль специальных компетенций события · RU",
                          ],
                          [
                            "biotIndustryKz",
                            "Отрасль специальных компетенций события · KZ",
                          ],
                        ] as const
                      ).map(([field, label]) => (
                        <label key={field}>
                          {primary ? label.replace(" события", "") : label}
                          <input
                            data-training-field={field}
                            data-field-path={`events.${eventIndex}.commonFields.${field}`}
                            disabled={disabled}
                            value={event.commonFields[field] || ""}
                            onChange={(e) =>
                              updateEvent({
                                commonFields: {
                                  ...event.commonFields,
                                  [field]: e.target.value,
                                },
                              })
                            }
                          />
                          {fieldHint(field)}
                        </label>
                      ))}
                    </>
                  )}
                  <label>
                    {primary
                      ? "Срок действия документов"
                      : "Срок действия документов события"}
                    <input
                      data-training-field="validUntil"
                      data-field-path={`events.${eventIndex}.commonFields.validUntil`}
                      type="date"
                      disabled={disabled}
                      value={
                        draft.businessRuleVersion === "LIVE_V1"
                          ? resolvedExpiryDates.length === 1 &&
                            /^\d{4}-\d{2}-\d{2}$/.test(resolvedExpiryDates[0])
                            ? resolvedExpiryDates[0]
                            : ""
                          : displayedCommon.validUntil || ""
                      }
                      onChange={(e) =>
                        changeEventCommon({ validUntil: e.target.value })
                      }
                    />
                    {fieldHint("validUntil")}
                    <small>
                      {draft.businessRuleVersion === "LIVE_V1"
                        ? "Стандартный срок: рабочий — 1 год, ИТР — 3 года; ПС — бессрочно. Общая дата применяется к людям без индивидуального исключения. Ручные и импортированные даты сохраняются; верните автоматический расчёт, чтобы снова использовать стандартный срок."
                        : "Расчёт предлагается по категории. Ручная дата сохраняется в этой версии заявки."}
                    </small>
                    {draft.businessRuleVersion === "LIVE_V1" && (
                      <small>
                        Расчётные сроки участников:{" "}
                        {resolvedExpiryDates.join("; ") ||
                          "Сначала назначьте обучение людям"}
                        .
                      </small>
                    )}
                  </label>
                </div>
              )}

              {!primary && event.protocolTemplateId === "biot-protocol" && (
                <p className="fine-print">
                  {biotCategoryDescription(
                    "WORKER",
                    draft.businessRuleVersion === "LIVE_V1",
                  )}
                </p>
              )}
              {!primary && assignmentSettings}
              {draft.status === "DRAFT" &&
                eventAssignments.some(
                  ({ assignment }) =>
                    !assignment.outcome ||
                    assignment.outcome.status === "UNKNOWN",
                ) && (
                  <Notice kind="info">
                    Не подтверждены результаты:{" "}
                    {
                      new Set(
                        eventAssignments
                          .filter(
                            ({ assignment }) =>
                              !assignment.outcome ||
                              assignment.outcome.status === "UNKNOWN",
                          )
                          .map(({ item }) => item.id),
                      ).size
                    }
                    . Удостоверения этих участников не включаются в комплект.
                    {primary
                      ? " Укажите ниже проверенный результат и его источник."
                      : " Для их оформления откройте «Подтвердить фактические результаты события» и укажите проверенный результат с источником."}
                  </Notice>
                )}
              {!primary && moveSettings}
              {primary &&
                outcomeStatistics.some(
                  (entry) => entry.status !== "UNKNOWN" && entry.count > 0,
                ) && (
                  <p className="saved-training-results" aria-live="polite">
                    Сохранённые результаты:{" "}
                    {outcomeStatistics
                      .filter((entry) => entry.count > 0)
                      .map((entry) => `${entry.label} — ${entry.count}`)
                      .join(" · ")}
                    .
                  </p>
                )}
              <details
                className="outcome-entry"
                key={`${activeEventId}:${hasUnconfirmedResults}`}
                open={(primary && hasUnconfirmedResults) || undefined}
              >
                <summary
                  data-training-field="outcomes"
                  data-field-path={`events.${eventIndex}.outcomes`}
                >
                  {primary
                    ? hasUnconfirmedResults
                      ? "Фактические результаты обучения"
                      : "Изменить результаты обучения"
                    : "Подтвердить фактические результаты события"}
                </summary>
                <p
                  className="preparation-status"
                  role="status"
                  aria-live="polite"
                >
                  Подготовка для «{trainingDisplayTitle(event.title)}»:{" "}
                  {preparation.status === "loading"
                    ? "загружается"
                    : preparation.status === "pending"
                      ? "сохраняется в этом браузере"
                      : preparation.status === "error"
                        ? "не сохранена"
                        : preparation.record
                          ? "сохранена в этом браузере, не применена"
                          : "ещё не заполнена"}
                  . Подготовка не меняет подтверждённые результаты.
                </p>
                {preparation.error && (
                  <Notice kind="error">
                    {preparation.error}
                    <button type="button" onClick={preparation.retry}>
                      Повторить сохранение подготовки
                    </button>
                    <button type="button" onClick={preparation.reload}>
                      Загрузить сохранённую подготовку
                    </button>
                  </Notice>
                )}
                {preparation.stale && (
                  <Notice kind="info">
                    Данные обучения изменились после подготовки. Ввод сохранён;
                    проверьте программу и состав людей перед применением.
                    <button
                      type="button"
                      disabled={disabled}
                      onClick={() => {
                        preparation.acceptContext();
                        setReview(false);
                      }}
                    >
                      Подготовить применение к текущим данным
                    </button>
                  </Notice>
                )}
                {primary && (
                  <label>
                    Кому подтвердить результат
                    <select
                      aria-label="Кому подтвердить результат"
                      value={outcomeScope}
                      disabled={disabled}
                      onChange={(change) => {
                        updatePreparation({
                          scope: change.target.value as "event" | "selected",
                        });
                      }}
                    >
                      <option value="event">
                        Всем участникам этого обучения
                      </option>
                      <option value="selected">
                        Только отмеченным в списке людям
                      </option>
                    </select>
                  </label>
                )}
                <p>
                  {primary
                    ? "Результат будет применён к людям:"
                    : "Выбрано участников этого события:"}{" "}
                  {selectedParticipantCount}.{" "}
                  {primary
                    ? "Другие обучения не меняются."
                    : "Участники других событий не меняются."}
                </p>
                {primary && selectedParticipantCount === 0 && (
                  <Notice kind="info">
                    Отметьте нужных людей в списке или выберите всех участников
                    этого обучения.
                  </Notice>
                )}
                <div className="form-grid">
                  <label>
                    Известный результат
                    <select
                      aria-label="Известный результат"
                      disabled={disabled}
                      value={outcome}
                      onChange={(e) => {
                        updatePreparation({
                          status: e.target.value as typeof outcome,
                        });
                      }}
                    >
                      <option value="UNKNOWN">Не подтверждён</option>
                      <option value="PASSED">Сдал</option>
                      <option value="FAILED">Не сдал</option>
                      <option value="ABSENT">Не явился</option>
                    </select>
                  </label>
                  <label>
                    Источник подтверждения
                    <input
                      aria-label="Источник подтверждения"
                      data-training-field="source"
                      data-field-path={`events.${eventIndex}.outcomes.source`}
                      disabled={disabled}
                      value={source}
                      aria-invalid={outcomeLengthErrors.source || undefined}
                      aria-describedby={`preparation-${event.id}-source-feedback`}
                      onChange={(e) => {
                        updatePreparation({ source: e.target.value });
                      }}
                      placeholder="Ведомость, дата и ответственный"
                    />
                    {fieldHint("source", "outcomes")}
                    <small
                      id={`preparation-${event.id}-source-feedback`}
                      className={
                        outcomeLengthErrors.source
                          ? "field-error"
                          : "field-hint"
                      }
                    >
                      {outcomeLengthErrors.source
                        ? `Не больше 500 символов; сейчас ${source.length}. Сократите источник для применения.`
                        : "Источник сохраняется только в подготовке до явного подтверждения результатов."}
                    </small>
                  </label>
                </div>
                {event.protocolTemplateId === "biot-itr-protocol" && (
                  <div className="form-grid">
                    <label>
                      Фактический результат проверки знаний
                      <input
                        data-training-field="biotKnowledgeResult"
                        data-field-path={`events.${eventIndex}.outcomes.biotKnowledgeResult`}
                        disabled={disabled}
                        value={knowledge}
                        aria-invalid={
                          outcomeLengthErrors.knowledge || undefined
                        }
                        aria-describedby={
                          outcomeLengthErrors.knowledge
                            ? `preparation-${event.id}-knowledge-feedback`
                            : undefined
                        }
                        onChange={(e) => {
                          updatePreparation({ knowledge: e.target.value });
                        }}
                        placeholder="Только подтверждённые сведения ведомости"
                      />
                      {fieldHint("biotKnowledgeResult", "outcomes")}
                      {outcomeLengthErrors.knowledge && (
                        <small
                          id={`preparation-${event.id}-knowledge-feedback`}
                          className="field-error"
                        >
                          Не больше 500 символов; сейчас {knowledge.length}.
                          Сократите текст для применения.
                        </small>
                      )}
                      <small>
                        Заполненное значение применяется к указанным выше людям.
                        Пустое поле сохраняет их индивидуальные результаты.
                      </small>
                    </label>
                    <label>
                      Фактический результат прокторинга
                      <input
                        data-training-field="biotProctoringResult"
                        data-field-path={`events.${eventIndex}.outcomes.biotProctoringResult`}
                        disabled={disabled}
                        value={proctoring}
                        aria-invalid={
                          outcomeLengthErrors.proctoring || undefined
                        }
                        aria-describedby={
                          outcomeLengthErrors.proctoring
                            ? `preparation-${event.id}-proctoring-feedback`
                            : undefined
                        }
                        onChange={(e) => {
                          updatePreparation({ proctoring: e.target.value });
                        }}
                      />
                      {fieldHint("biotProctoringResult", "outcomes")}
                      {outcomeLengthErrors.proctoring && (
                        <small
                          id={`preparation-${event.id}-proctoring-feedback`}
                          className="field-error"
                        >
                          Не больше 500 символов; сейчас {proctoring.length}.
                          Сократите текст для применения.
                        </small>
                      )}
                      <small>
                        Оставьте пустым, чтобы сохранить индивидуальные
                        результаты.
                      </small>
                    </label>
                  </div>
                )}
                {reviewed && (
                  <Notice kind="info">
                    Будет заменён результат у {selectedParticipantCount}{" "}
                    участников {primary ? "обучения" : "события"} «
                    {trainingDisplayTitle(event.title)}
                    ». Основание: {source}. Это действие не регистрирует
                    документы.
                  </Notice>
                )}
                <button
                  disabled={
                    disabled ||
                    !selectedParticipantCount ||
                    (outcome !== "UNKNOWN" && !source.trim()) ||
                    preparation.stale ||
                    preparation.status !== "saved" ||
                    Object.values(outcomeLengthErrors).some(Boolean)
                  }
                  onClick={() => {
                    if (!reviewed) {
                      setReviewSignature(outcomeSignature);
                      setReview(true);
                      return;
                    }
                    void apply({
                      items: applyEventOutcomes(
                        draft,
                        event.id,
                        outcomeRecipients.map((item) => item.id),
                        { status: outcome, source, knowledge, proctoring },
                      ),
                    }).then((saved) => {
                      if (saved) preparation.discard();
                    });
                    setReview(false);
                  }}
                >
                  {" "}
                  {reviewed
                    ? "Подтвердить результаты"
                    : "Проверить применение результатов"}
                </button>
                {(preparation.record || preparation.status === "error") && (
                  <button
                    type="button"
                    className="text-button"
                    disabled={disabled}
                    onClick={() => {
                      preparation.discard();
                      setReview(false);
                    }}
                  >
                    Отменить только подготовку результата
                  </button>
                )}
              </details>
            </>
          )}
          {primary && (
            <details className="training-advanced-settings">
              <summary>Дополнительные настройки обучения</summary>
              {metadataSettings}
              {joinSettings}
              {creationSettings}
              {assignmentSettings}
              {moveSettings}
              {requestSettings}
              {event?.protocolTemplateId === "biot-protocol" && (
                <p className="fine-print">
                  {biotCategoryDescription(
                    "WORKER",
                    draft.businessRuleVersion === "LIVE_V1",
                  )}
                </p>
              )}
            </details>
          )}
        </div>
      )}
    </section>
  );
}
