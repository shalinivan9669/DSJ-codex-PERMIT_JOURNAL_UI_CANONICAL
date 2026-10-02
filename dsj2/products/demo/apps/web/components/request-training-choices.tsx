"use client";

import { trainingDirection } from "@demo/contracts";
import { assignTrainingBundle } from "@/lib/request-bundles";
import type { Draft } from "@/lib/types";
import "./request-training-choices.css";

const choices = [
  { id: "BIOT", label: "БиОТ", name: "Безопасность и охрана труда" },
  { id: "PTM", label: "ПТМ", name: "Пожарно-технический минимум" },
  { id: "PB", label: "ПБ", name: "Промышленная безопасность" },
  { id: "PS", label: "ПС", name: "Обучение по профессии" },
] as const;

export function RequestTrainingChoices({
  draft,
  disabled,
  readonly,
  selectedIds,
  onChange,
}: {
  draft: Draft;
  disabled: boolean;
  readonly: boolean;
  selectedIds?: readonly string[];
  onChange: (nextDraft: Draft) => void;
}) {
  if (readonly) return null;
  const selected = selectedIds?.length ? new Set(selectedIds) : null;
  const recipients = selected
    ? draft.items.filter((item) => selected.has(item.id))
    : draft.items;
  const scope = selected ? "выбранным" : "всем";
  const targetIds = recipients.map((item) => item.id);
  return (
    <div
      className="request-training-choices"
      role="group"
      aria-label={`Добавить обучение ${scope} участникам`}
    >
      <span className="request-training-scope">
        Обучение {scope} ({recipients.length}):
      </span>
      {choices.map((choice) => {
        const assigned = recipients.filter((item) =>
          item.assignments.some(
            (assignment) =>
              trainingDirection(assignment.templateId) === choice.id,
          ),
        ).length;
        const complete =
          recipients.length > 0 && assigned === recipients.length;
        return (
          <button
            key={choice.id}
            type="button"
            className="request-training-chip"
            data-complete={complete || undefined}
            disabled={disabled || !recipients.length || complete}
            title={`${choice.name}. ${complete ? "Уже назначено всем участникам этого выбора." : `Добавить комплект документов ${scope} участникам.`}`}
            aria-label={`${choice.label}: ${complete ? `назначено всем (${assigned})` : `добавить ${scope} участникам (${recipients.length})`}`}
            onClick={() => {
              if (disabled || !recipients.length || complete) return;
              onChange(assignTrainingBundle(draft, targetIds, choice.id));
            }}
          >
            {choice.label}
            {complete ? (
              <span aria-hidden="true"> ✓</span>
            ) : assigned > 0 ? (
              <span className="request-training-count" aria-hidden="true">
                {assigned}/{recipients.length}
              </span>
            ) : null}
          </button>
        );
      })}
      {!recipients.length && (
        <span className="request-training-empty">
          {selected ? "Выберите участников." : "Сначала добавьте участника."}
        </span>
      )}
    </div>
  );
}
