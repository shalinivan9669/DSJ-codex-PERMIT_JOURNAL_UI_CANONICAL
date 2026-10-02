"use client";
import { useEffect, useRef, useState } from "react";
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
}) {
  const [expanded, setExpanded] = useState(embedded);
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
  const event = events.find((e) => e.id === activeId);
  const displayedCommon =
    (expanded
      ? resolveDraft(draft, centerCommon).draft.events?.find(
          (e) => e.id === activeId,
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
          .filter((a) => a.eventId === activeId)
          .map((assignment) => ({ item, assignment })),
      )
    : [];
  const selectedAssignments = eventAssignments.filter(({ item }) =>
    selectedIds.includes(item.id),
  );
  const selectedParticipantCount = new Set(
    selectedAssignments.map(({ item }) => item.id),
  ).size;
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
  return (
    <section
      className={embedded ? undefined : "panel common-context"}
      onBlurCapture={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null))
          void commitContext();
      }}
    >
      {!embedded && (
        <div className="toolbar">
          <div>
            <h2>Общие даты и групповые протоколы</h2>
            <span className="muted">
              {events.length
                ? `${events.length} событий · ${events.reduce((n, e) => n + draft.items.filter((i) => i.assignments.some((a) => a.eventId === e.id)).length, 0)} участников событий`
                : "Период обучения, программа и протокол для группы"}
            </span>
          </div>
          <button
            onClick={() => setExpanded(!expanded)}
            aria-expanded={expanded}
          >
            {expanded ? "Свернуть" : "Настроить даты и протоколы"}
          </button>
        </div>
      )}
      {expanded && (
        <div className="context-body">
          <p>
            Задайте общие даты и программу для группы. Индивидуальные изменения
            у людей сохраняются. Для отдельного курса можно создать новую
            группу.
          </p>
          <details open>
            <summary>Даты и программа для всей заявки</summary>
            <p>
              Применяются к документам без индивидуальных изменений. У отдельной
              группы могут быть свои даты. «Убрать значение» возвращает
              настройки центра.
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
                                    [field]: e.target.value
                                      ? "MANUAL"
                                      : "CLEARED",
                                  },
                                }
                              : {}),
                          }))
                        }
                      />
                    </label>
                    <button
                      disabled={
                        disabled || !Object.hasOwn(requestCommon, field)
                      }
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
          <div className="form-grid">
            <label>
              Событие
              <select
                value={activeId}
                disabled={disabled}
                onChange={(e) => {
                  setActiveId(e.target.value);
                  setReview(false);
                }}
              >
                <option value="">Выберите событие</option>
                {events.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.title}
                  </option>
                ))}
              </select>
            </label>
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
          </div>
          {event && (
            <>
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
                  В выпуске сохраняется выбранная версия профиля и комиссии.
                  График обучения наследуется от настроек заявки; при
                  необходимости измените его ниже для этой группы.
                </small>
              </label>
              <div className="form-grid">
                {bulkFields.map(([field, label, type]) => (
                  <label key={field}>
                    {label}
                    <input
                      aria-label={label}
                      type={type}
                      disabled={disabled}
                      value={String(displayedCommon[field] || "")}
                      onChange={(e) =>
                        changeEventCommon({ [field]: e.target.value })
                      }
                    />
                    <small>Общее значение события</small>
                  </label>
                ))}
              </div>
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
              {event.protocolTemplateId.startsWith("biot-") && (
                <div className="form-grid">
                  <label>
                    Категория БиОТ события
                    <select
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
                  </label>
                  <label>
                    Вид проверки БиОТ события
                    <select
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
                  </label>
                  {event.protocolTemplateId === "biot-protocol" && (
                    <label>
                      Производственное обучение события, часов
                      <input
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
                          {label}
                          <input
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
                        </label>
                      ))}
                    </>
                  )}
                  <label>
                    Срок действия документов события
                    <input
                      type="date"
                      disabled={disabled}
                      value={displayedCommon.validUntil || ""}
                      onChange={(e) =>
                        changeEventCommon({ validUntil: e.target.value })
                      }
                    />
                    <small>
                      Расчёт предлагается по категории. Проверяйте применимость
                      к фактическому событию.
                    </small>
                  </label>
                </div>
              )}
              {event.protocolTemplateId === "biot-itr-protocol" && (
                <div className="form-grid">
                  <label>
                    Фактический результат проверки знаний выбранных
                    <input
                      disabled={disabled}
                      value={knowledge}
                      onChange={(e) => {
                        setKnowledge(e.target.value);
                        setReview(false);
                      }}
                      placeholder="Только подтверждённые сведения ведомости"
                    />
                  </label>
                  <label>
                    Фактический результат прокторинга выбранных
                    <input
                      disabled={disabled}
                      value={proctoring}
                      onChange={(e) => {
                        setProctoring(e.target.value);
                        setReview(false);
                      }}
                    />
                  </label>
                </div>
              )}
              {event.protocolTemplateId === "biot-protocol" && (
                <p className="fine-print">{BIOT_CATEGORIES.WORKER.hint}</p>
              )}
              <div className="toolbar-actions">
                <button
                  disabled={disabled || !selectedIds.length}
                  onClick={assignSet}
                >
                  Назначить набор выбранным ({selectedIds.length})
                </button>
                <span className="muted">
                  {eventAssignments.length} назначений · 1 общий протокол при
                  оформлении
                </span>
              </div>
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
                    Для их оформления откройте «Подтвердить фактические
                    результаты события» и укажите проверенный результат с
                    источником.
                  </Notice>
                )}
              <details className="outcome-entry">
                <summary>
                  Перенести выбранных участников в другое событие
                </summary>
                <p>
                  Перенос доступен только в черновике и в совместимое событие.
                  Индивидуальные и импортированные исключения сохраняются;
                  наследуемые значения берутся из нового события. Результаты
                  старого события снимаются и требуют нового подтверждения.
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
                  Будет перенесено: {selectedAssignments.length} назначений из
                  события «{event.title}».
                </p>
                {moveConflicts.length > 0 && (
                  <Notice>
                    У {moveConflicts.length} выбранных участников уже есть эта
                    форма в целевом событии. Уберите этих людей из выбора, чтобы
                    не создать дубли.
                  </Notice>
                )}
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={moveConfirmed}
                    disabled={disabled}
                    onChange={(e) => setMoveConfirmed(e.target.checked)}
                  />
                  Подтверждаю перенос выбранных участников и снятие прежних
                  результатов. Состав и общие параметры нового события
                  проверены.
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
                                      ...(assignment.templateId.startsWith(
                                        "biot-",
                                      )
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
              <details className="outcome-entry">
                <summary>Подтвердить фактические результаты события</summary>
                <p>
                  Выбрано участников этого события: {selectedParticipantCount}.
                  Участники других событий не меняются.
                </p>
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
                      disabled={disabled}
                      value={source}
                      onChange={(e) => {
                        setSource(e.target.value);
                        setReview(false);
                      }}
                      placeholder="Ведомость, дата и ответственный"
                    />
                  </label>
                </div>
                {review && (
                  <Notice kind="info">
                    Будет заменён результат у {selectedParticipantCount}{" "}
                    участников события «{event.title}». Основание: {source}. Это
                    действие не регистрирует документы.
                  </Notice>
                )}
                <button
                  disabled={
                    disabled ||
                    !selectedAssignments.length ||
                    !source.trim() ||
                    outcome === "UNKNOWN"
                  }
                  onClick={() => {
                    if (!review) {
                      setReview(true);
                      return;
                    }
                    void apply({
                      items: draft.items.map((item) =>
                        !selectedIds.includes(item.id)
                          ? item
                          : {
                              ...item,
                              assignments: item.assignments.map((a) =>
                                a.eventId !== event.id
                                  ? a
                                  : {
                                      ...a,
                                      ...(event.protocolTemplateId ===
                                      "biot-itr-protocol"
                                        ? {
                                            biotKnowledgeResult: knowledge,
                                            biotProctoringResult: proctoring,
                                          }
                                        : {}),
                                      result:
                                        outcome === "PASSED"
                                          ? "Сдал"
                                          : outcome === "FAILED"
                                            ? "Не сдал"
                                            : "Не явился",
                                      outcome: {
                                        status: outcome,
                                        source: source.trim(),
                                      },
                                    },
                              ),
                            },
                      ),
                    });
                    setReview(false);
                  }}
                >
                  {" "}
                  {review
                    ? "Подтвердить результаты"
                    : "Проверить применение результатов"}
                </button>
              </details>
            </>
          )}
        </div>
      )}
    </section>
  );
}
