"use client";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Notice } from "@demo/ui";
import {
  BIOT_CATEGORIES,
  resolveDraft,
  resolveCommonDates,
  calculatedDateKeys,
  commonFieldKeys,
  type CommonFields,
  type BiotCategory,
  type TrainingEventInput,
} from "@demo/contracts";
import { api, errorText } from "@/lib/api";
import { bulkFields } from "@/lib/bulk-edit";
import { newAssignment, type Assignment, type Draft } from "@/lib/types";
import { eligibleForEvent, joinEventAssignment } from "@/lib/event-assignment";
import {
  applyEventOutcomes,
  eventOutcomeRecipients,
} from "@/lib/event-outcomes";
import { TrainingDateSettings } from "./training-date-settings";
import { DateCalculationStatus } from "./date-calculation-status";

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
  const [outcome, setOutcome] = useState<
    "UNKNOWN" | "PASSED" | "FAILED" | "ABSENT"
  >("UNKNOWN");
  const [source, setSource] = useState("");
  const [knowledge, setKnowledge] = useState("");
  const [proctoring, setProctoring] = useState("");
  const [review, setReview] = useState(false);
  const [reviewSignature, setReviewSignature] = useState("");
  const [outcomeScope, setOutcomeScope] = useState<"event" | "selected">(
    "event",
  );
  const [replaceEmpty, setReplaceEmpty] = useState(false);
  const [joinExisting, setJoinExisting] = useState(false);
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
    !assignment.trainingSubject &&
    !assignment.result &&
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
  const displayedCommon =
    (expanded
      ? resolveDraft(draft, centerCommon).draft.events?.find(
          (e) => e.id === activeEventId,
        )?.commonFields
      : undefined) ||
    event?.commonFields ||
    {};
  const displayedRequestCommon = expanded
    ? resolveCommonDates(requestCommon, centerCommon, draft.presetFields)
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
  ]);
  const reviewed = review && reviewSignature === outcomeSignature;
  useEffect(() => {
    function focusTraining(nativeEvent: Event) {
      const target = (
        nativeEvent as CustomEvent<{ eventId: string; field: string }>
      ).detail;
      if (!target?.eventId || !target.field) return;
      if (target.eventId !== activeEventId) {
        setOutcome("UNKNOWN");
        setSource("");
        setKnowledge("");
        setProctoring("");
        setReview(false);
      }
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
    for (const key of calculatedDateKeys)
      if (Object.hasOwn(patch, key))
        next.dateOrigins = {
          ...next.dateOrigins,
          [key]: patch[key] ? "MANUAL" : "CLEARED",
        };
    updateEvent({ commonFields: next });
  }
  function renderEventField([field, label, type]: (typeof bulkFields)[number]) {
    const hint = fieldHints[`events.${eventIndex}.commonFields.${field}`];
    return (
      <label key={field}>
        {label}
        <input
          aria-label={label}
          data-training-field={field}
          data-field-path={`events.${eventIndex}.commonFields.${field}`}
          type={type}
          disabled={disabled}
          value={String(displayedCommon[field] || "")}
          onChange={(change) =>
            changeEventCommon({ [field]: change.target.value })
          }
        />
        {hint ? (
          <small className="field-hint">{hint}</small>
        ) : (
          !primary && <small>Общее значение события</small>
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
            assignments: item.assignments.map((a) =>
              a.id === candidates[0].id ? joinEventAssignment(a, event.id) : a,
            ),
          };
        const assignment: Assignment = {
          ...newAssignment(choice.card),
          eventId: event.id,
          protocolMode: "GROUP",
          fieldOrigins: Object.fromEntries(
            commonFieldKeys.map((key) => [key, "INHERITED" as const]),
          ),
          outcome: { status: "UNKNOWN", source: "" },
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
                  !a.result &&
                  !a.trainingSubject
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
        rule={displayedCommon.trainingDateRule}
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
              {target.title} ·{" "}
              {target.commonFields.trainingStart || "дата не задана"}
            </option>
          ))}
        </select>
      </label>
      <p>
        Будет перенесено: {selectedAssignments.length} назначений из события «
        {event.title}».
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
        rule={displayedRequestCommon.trainingDateRule}
        disabled={disabled}
        onChange={(rule) =>
          setRequestCommon((old) => ({ ...old, trainingDateRule: rule }))
        }
      />
      <DateCalculationStatus
        values={displayedRequestCommon}
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
              onClick={() => setExpanded(!expanded)}
              aria-expanded={expanded}
            >
              {expanded ? "Свернуть" : "Настроить даты и протоколы"}
            </button>
          )}
        </div>
      )}
      {expanded && (
        <div className="context-body">
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
                    setActiveId(e.target.value);
                    setOutcome("UNKNOWN");
                    setSource("");
                    setKnowledge("");
                    setProctoring("");
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
                      {e.title}
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
              </div>
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
                          ![
                            "trainingSubject",
                            "hours",
                            "protocolDate",
                          ].includes(field),
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
                      value={displayedCommon.validUntil || ""}
                      onChange={(e) =>
                        changeEventCommon({ validUntil: e.target.value })
                      }
                    />
                    {fieldHint("validUntil")}
                    {!primary && (
                      <small>
                        Расчёт предлагается по категории. Проверяйте
                        применимость к фактическому событию.
                      </small>
                    )}
                  </label>
                </div>
              )}

              {!primary && event.protocolTemplateId === "biot-protocol" && (
                <p className="fine-print">{BIOT_CATEGORIES.WORKER.hint}</p>
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
                data-training-field="outcomes"
                data-field-path={`events.${eventIndex}.outcomes`}
                tabIndex={-1}
              >
                <summary>
                  {primary
                    ? hasUnconfirmedResults
                      ? "Фактические результаты обучения"
                      : "Изменить результаты обучения"
                    : "Подтвердить фактические результаты события"}
                </summary>
                {primary && (
                  <label>
                    Кому подтвердить результат
                    <select
                      aria-label="Кому подтвердить результат"
                      value={outcomeScope}
                      disabled={disabled}
                      onChange={(change) => {
                        setOutcomeScope(
                          change.target.value as "event" | "selected",
                        );
                        setReview(false);
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
                        setOutcome(e.target.value as typeof outcome);
                        setReview(false);
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
                      onChange={(e) => {
                        setSource(e.target.value);
                        setReview(false);
                      }}
                      placeholder="Ведомость, дата и ответственный"
                    />
                    {fieldHint("source", "outcomes")}
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
                        onChange={(e) => {
                          setKnowledge(e.target.value);
                          setReview(false);
                        }}
                        placeholder="Только подтверждённые сведения ведомости"
                      />
                      {fieldHint("biotKnowledgeResult", "outcomes")}
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
                        onChange={(e) => {
                          setProctoring(e.target.value);
                          setReview(false);
                        }}
                      />
                      {fieldHint("biotProctoringResult", "outcomes")}
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
                    участников {primary ? "обучения" : "события"} «{event.title}
                    ». Основание: {source}. Это действие не регистрирует
                    документы.
                  </Notice>
                )}
                <button
                  disabled={
                    disabled ||
                    !selectedParticipantCount ||
                    !source.trim() ||
                    outcome === "UNKNOWN"
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
                    });
                    setReview(false);
                  }}
                >
                  {" "}
                  {reviewed
                    ? "Подтвердить результаты"
                    : "Проверить применение результатов"}
                </button>
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
                <p className="fine-print">{BIOT_CATEGORIES.WORKER.hint}</p>
              )}
            </details>
          )}
        </div>
      )}
    </section>
  );
}
