"use client";
import { useEffect, useState } from "react";
import {
  trainingDateRuleSchema,
  trainingRuleDescription,
  type TrainingDateRule,
} from "@demo/contracts";

export function TrainingDateSettings({
  rule,
  disabled,
  onChange,
}: {
  rule?: TrainingDateRule | null;
  disabled: boolean;
  onChange: (rule: TrainingDateRule | null) => void;
}) {
  const [candidate, setCandidate] = useState<Partial<TrainingDateRule>>(
    rule || {},
  );
  const ruleKey = JSON.stringify(rule || {});
  useEffect(() => setCandidate(JSON.parse(ruleKey)), [ruleKey]);
  const parsed = trainingDateRuleSchema.safeParse(candidate);
  return (
    <details className="field-provenance">
      <summary>Правило расчёта периода обучения</summary>
      <p>{trainingRuleDescription(rule)}</p>
      <p className="fine-print">
        Укажите фактический график программы. Эти настройки рассчитывают даты и
        не подтверждают обучение или экзамен. Срок действия считается отдельно
        по категории БиОТ.
      </p>
      <div className="form-grid compact">
        <label>
          Часов в учебном дне
          <input
            aria-label="Часов в учебном дне"
            type="number"
            min="0.01"
            max="24"
            step="any"
            disabled={disabled}
            value={candidate.hoursPerDay || ""}
            onChange={(e) =>
              setCandidate({
                ...candidate,
                hoursPerDay: Number(e.target.value) || undefined,
              })
            }
          />
        </label>
        <label>
          Какие часы учитывать
          <select
            aria-label="Какие часы учитывать"
            disabled={disabled}
            value={candidate.hoursSource || ""}
            onChange={(e) =>
              setCandidate({
                ...candidate,
                hoursSource: e.target.value as TrainingDateRule["hoursSource"],
              })
            }
          >
            <option value="">Выберите по графику</option>
            <option value="THEORY">Часы обучения без производственных</option>
            <option value="THEORY_AND_PRODUCTION">
              Сумма учебных и производственных часов
            </option>
          </select>
        </label>
        <label>
          Учебные дни
          <select
            aria-label="Учебные дни"
            disabled={disabled}
            value={candidate.calendar || ""}
            onChange={(e) =>
              setCandidate({
                ...candidate,
                calendar: e.target.value as TrainingDateRule["calendar"],
              })
            }
          >
            <option value="">Выберите по графику</option>
            <option value="CALENDAR">Календарные, включая выходные</option>
            <option value="WEEKDAYS">
              Понедельник–пятница (без календаря праздников)
            </option>
          </select>
        </label>
        <label>
          Связь с датой документа
          <select
            aria-label="Связь с датой документа"
            disabled={disabled}
            value={candidate.anchor || ""}
            onChange={(e) =>
              setCandidate({
                ...candidate,
                anchor: e.target.value as TrainingDateRule["anchor"],
              })
            }
          >
            <option value="">Выберите по графику</option>
            <option value="DOCUMENT_IS_END">
              Дата документа — последний день обучения
            </option>
            <option value="DOCUMENT_IS_START">
              Дата документа — первый день обучения
            </option>
          </select>
        </label>
        <label>
          Расчёт даты протокола
          <select
            aria-label="Расчёт даты протокола"
            disabled={disabled}
            value={candidate.protocolDate || ""}
            onChange={(e) =>
              setCandidate({
                ...candidate,
                protocolDate: e.target
                  .value as TrainingDateRule["protocolDate"],
              })
            }
          >
            <option value="">Выберите по графику</option>
            <option value="MANUAL">Вводится отдельно</option>
            <option value="DOCUMENT_DATE">Совпадает с датой документа</option>
            <option value="TRAINING_END">Последний день обучения</option>
          </select>
        </label>
        <label>
          Источник графика
          <input
            aria-label="Источник графика"
            disabled={disabled}
            value={candidate.source || ""}
            placeholder="Название программы, расписание, решение центра"
            onChange={(e) =>
              setCandidate({ ...candidate, source: e.target.value })
            }
          />
        </label>
      </div>
      <button
        disabled={
          disabled ||
          !parsed.success ||
          JSON.stringify(parsed.data) === JSON.stringify(rule)
        }
        onClick={() => {
          if (parsed.success) onChange(parsed.data);
        }}
      >
        Применить правило расчёта
      </button>
      {rule && (
        <button
          className="text-button"
          disabled={disabled}
          onClick={() => onChange(null)}
        >
          Отключить автоматический период
        </button>
      )}
    </details>
  );
}
