"use client";
import { useEffect, useRef, useState } from "react";
import { Notice } from "@demo/ui";
import {
  BIOT_CATEGORIES,
  biotValidUntil,
  commonFieldKeys,
  type BiotCategory,
  type TrainingEventInput,
} from "@demo/contracts";
import { api, errorText } from "@/lib/api";
import { bulkFields } from "@/lib/bulk-edit";
import { newAssignment, type Assignment, type Draft } from "@/lib/types";

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
  selectedIds,
  disabled,
  onChange,
  onApply,
  onContextCommit,
}: {
  draft: Draft;
  selectedIds: string[];
  disabled: boolean;
  onChange: (patch: Partial<Draft>) => void;
  onApply: (patch: Partial<Draft>) => Promise<boolean | undefined>;
  onContextCommit: (previousEvents: TrainingEventInput[]) => Promise<void>;
}) {
  const [expanded, setExpanded] = useState(!!draft.events?.length);
  const contextBefore = useRef<TrainingEventInput[] | null>(null);
  async function commitContext() {
    const before = contextBefore.current;
    contextBefore.current = null;
    if (before) await onContextCommit(before);
  }
  async function apply(patch: Partial<Draft>) {
    await commitContext();
    await onApply(patch);
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
  const eventAssignments = draft.items.flatMap((item) =>
    item.assignments
      .filter((a) => a.eventId === activeId)
      .map((assignment) => ({ item, assignment })),
  );
  const selectedAssignments = eventAssignments.filter(({ item }) =>
    selectedIds.includes(item.id),
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
  function addEvent() {
    const choice = directions.find((d) => d.key === direction)!;
    const next: TrainingEventInput = {
      id: crypto.randomUUID(),
      title: choice.label,
      protocolTemplateId: choice.protocol,
      revision: 0,
      commonFields: {
        ...(draft.commonFields?.documentDate
          ? { documentDate: draft.commonFields.documentDate }
          : {}),
        ...(choice.key === "biot"
          ? {
              biotCategory: "WORKER" as const,
              biotCheckType: "PERIODIC" as const,
              hours: "10",
              productionHours: "16",
              validUntil: draft.commonFields?.documentDate
                ? biotValidUntil(draft.commonFields.documentDate, "WORKER") ||
                  ""
                : "",
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
        validUntil: next.commonFields.documentDate
          ? biotValidUntil(
              next.commonFields.documentDate,
              "OHS_SPECIALIST_SPECIAL",
            ) || ""
          : "",
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
      className="panel common-context"
      onBlurCapture={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null))
          void commitContext();
      }}
    >
      <div className="toolbar">
        <div>
          <h2>Общие сведения и события</h2>
          <span className="muted">
            {events.length
              ? `${events.length} событий · ${events.reduce((n, e) => n + draft.items.filter((i) => i.assignments.some((a) => a.eventId === e.id)).length, 0)} участников событий`
              : "Для нескольких людей с одной программой и общим протоколом"}
          </span>
        </div>
        <button onClick={() => setExpanded(!expanded)} aria-expanded={expanded}>
          {expanded ? "Свернуть" : "Настроить общий контекст"}
        </button>
      </div>
      {expanded && (
        <div className="context-body">
          <p>
            Общие сведения вводятся один раз. Для нового курса создайте другое
            событие. Результаты участников подтверждаются отдельно.
          </p>
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
                      value={String(event.commonFields[field] || "")}
                      onChange={(e) => {
                        const common = {
                          ...event.commonFields,
                          [field]: e.target.value,
                        };
                        if (
                          field === "documentDate" &&
                          common.biotCategory &&
                          (!common.validUntil ||
                            common.validUntil ===
                              biotValidUntil(
                                event.commonFields.documentDate || "",
                                common.biotCategory,
                              ))
                        )
                          common.validUntil =
                            biotValidUntil(
                              e.target.value,
                              common.biotCategory,
                            ) || "";
                        updateEvent({ commonFields: common });
                      }}
                    />
                    <small>Общее значение события</small>
                  </label>
                ))}
              </div>
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
                      value={event.commonFields.validUntil || ""}
                      onChange={(e) =>
                        updateEvent({
                          commonFields: {
                            ...event.commonFields,
                            validUntil: e.target.value,
                          },
                        })
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
              <details className="outcome-entry">
                <summary>Подтвердить фактические результаты события</summary>
                <p>
                  Выбрано участников этого события: {selectedAssignments.length}
                  . Участники других событий не меняются.
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
                    Будет заменён результат у {selectedAssignments.length}{" "}
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
