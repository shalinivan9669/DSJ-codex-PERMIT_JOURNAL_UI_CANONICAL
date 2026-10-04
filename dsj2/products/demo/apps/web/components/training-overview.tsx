"use client";

import { setTrainingProtocolMode } from "@/lib/request-bundles";
import { trainingDisplayTitle } from "@/lib/training-display";
import type { Draft } from "@/lib/types";

export function TrainingOverview({
  draft,
  disabled,
  onChange,
  resolvedEvents,
  selectedIds = [],
  onRemove,
}: {
  draft: Draft;
  disabled: boolean;
  onChange: (patch: Partial<Draft>) => void;
  resolvedEvents?: Draft["events"];
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
      <p className="muted">
        Дата общего протокола задаётся здесь. Дату выдачи комплекта каждому
        человеку можно изменить в его карточке.
      </p>
      {events.map((event, eventIndex) => {
        const displayedEvent =
          resolvedEvents?.find((row) => row.id === event.id) || event;
        const displayTitle = trainingDisplayTitle(event.title);
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
