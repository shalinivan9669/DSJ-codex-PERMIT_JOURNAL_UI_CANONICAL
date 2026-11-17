"use client";

import { setTrainingProtocolMode } from "@/lib/request-bundles";
import { documentPlan, type Draft as ContractDraft } from "@demo/contracts";
import { trainingDisplayTitle } from "@/lib/training-display";
import type { Draft } from "@/lib/types";

export function TrainingOverview({
  draft,
  disabled,
  onChange,
  resolvedEvents,
  resolvedDraft,
  selectedIds = [],
  onRemove,
}: {
  draft: Draft;
  disabled: boolean;
  onChange: (patch: Partial<Draft>) => void;
  resolvedEvents?: Draft["events"];
  resolvedDraft?: ContractDraft;
  selectedIds?: string[];
  onRemove?: (eventId: string, recipientIds: string[], all: boolean) => void;
}) {
  const events = draft.events || [];
  if (!events.length) return null;
  return (
    <section
      className="panel training-overview"
      aria-label="Обучения и протоколы"
    >
      <h2>Обучения и протоколы</h2>

      {events.map((event, eventIndex) => {
        const displayedEvent =
          resolvedEvents?.find((row) => row.id === event.id) || event;
        const displayTitle = trainingDisplayTitle(event.title);
        const protocolGroups = documentPlan(
          resolvedDraft || draft,
        ).groups.filter((group) => group.event.id === event.id);
        const members = draft.items.filter((item) =>
          item.assignments.some(
            (assignment) => assignment.eventId === event.id,
          ),
        );
        const mode =
          event.protocolMode ||
          (members.some((item) =>
            item.assignments.some(
              (assignment) =>
                assignment.eventId === event.id &&
                assignment.protocolMode === "GROUP",
            ),
          )
            ? "GROUP"
            : "INDIVIDUAL");
        return (
          <div className="training-event-row" key={event.id}>
            <div>
              <strong>{displayTitle}</strong>
              <small>Сотрудников: {members.length}</small>
              {protocolGroups.length > 1 && (
                <ul aria-label={`Состав протоколов: ${displayTitle}`}>
                  {protocolGroups.map((group) => (
                    <li key={group.members[0].item.id}>
                      {group.members[0].assignment.hours || "—"} ч ·{" "}
                      {group.members[0].assignment.trainingSubject || "—"}:{" "}
                      {group.members
                        .map(
                          ({ item }) =>
                            item.fullNameRu || item.fullNameKz || "Без ФИО",
                        )
                        .join(", ")}
                    </li>
                  ))}
                </ul>
              )}
              {!disabled && (
                <button
                  className="text-button danger-text"
                  onClick={() =>
                    onRemove?.(
                      event.id,
                      members
                        .filter(
                          (item) =>
                            !selectedIds.length ||
                            selectedIds.includes(item.id),
                        )
                        .map((item) => item.id),
                      !selectedIds.length,
                    )
                  }
                >
                  Снять обучение{" "}
                  {selectedIds.length
                    ? `у отмеченных (${members.filter((item) => selectedIds.includes(item.id)).length})`
                    : `у всех ${members.length} в этой группе`}
                </button>
              )}
            </div>
            <label>
              Протокол
              <select
                aria-label={`Протокол: ${displayTitle}`}
                value={mode}
                disabled={disabled}
                onChange={(change) => {
                  const next = setTrainingProtocolMode(
                    draft,
                    event.id,
                    change.target.value as "GROUP" | "INDIVIDUAL",
                  );
                  onChange({ items: next.items, events: next.events });
                }}
              >
                <option value="GROUP">Общий по обучению</option>
                <option value="INDIVIDUAL">Отдельный на каждого</option>
              </select>
            </label>
            <label>
              Дата протокола
              <input
                type="date"
                data-field-path={`events.${eventIndex}.commonFields.protocolDate`}
                value={displayedEvent.commonFields.protocolDate || ""}
                disabled={disabled}
                onChange={(change) =>
                  onChange({
                    events: events.map((row) =>
                      row.id === event.id
                        ? {
                            ...row,
                            revision: row.revision + 1,
                            commonFields: {
                              ...row.commonFields,
                              protocolDate: change.target.value,
                              dateOrigins: {
                                ...row.commonFields.dateOrigins,
                                protocolDate: change.target.value
                                  ? "MANUAL"
                                  : "CLEARED",
                              },
                            },
                          }
                        : row,
                    ),
                  })
                }
              />
            </label>
          </div>
        );
      })}
    </section>
  );
}
