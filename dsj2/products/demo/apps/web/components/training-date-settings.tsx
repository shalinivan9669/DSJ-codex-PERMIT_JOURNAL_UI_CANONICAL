"use client";
import { useEffect, useState } from "react";
import {
  trainingDateRuleSchema,
  trainingRuleDescription,
  KZ_TRAINING_CALENDAR_LABEL,
  KZ_TRAINING_CALENDAR_VERSION,
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
  const suggested: Partial<TrainingDateRule> = {
    hoursSource: "THEORY",
    calendar: "KZ_FIVE_DAY",
    calendarVersion: KZ_TRAINING_CALENDAR_VERSION,
    anchor: "DOCUMENT_AFTER_TRAINING",
    protocolDate: "MANUAL",
    source: "График учебного центра",
  };
  const [candidate, setCandidate] = useState<Partial<TrainingDateRule>>(
    rule || suggested,
  );
  const ruleKey = JSON.stringify(rule || suggested);
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
      <p className="fine-print">
        Продолжительность учебного дня задаёт центр по программе. Например, 16
        часов при 8 часах в день — 2 учебных дня; 8 часов здесь не норматив и не
        заполнено автоматически. Производственные часы учитываются только в
        выбранном режиме.
      </p>
      <details className="fine-print">
        <summary>Как выбрать часы программы</summary>
        <p>
          Объём программы и часы в учебном дне — разные настройки. По{" "}
          <a
            href="https://old.adilet.zan.kz/rus/docs/V1500012665"
            target="_blank"
            rel="noreferrer"
          >
            правилам БиОТ
          </a>{" "}
          рабочим предусмотрено не менее 10 академических часов теории и 16
          часов производства; объём для ИТР зависит от категории. Академические
          и производственные часы задаются отдельно.
        </p>
        <p>
          По{" "}
          <a
            href="https://old.adilet.zan.kz/rus/docs/V2100023461"
            target="_blank"
            rel="noreferrer"
          >
            правилам ПБ, пункт 7
          </a>{" "}
          программа рабочих опасных объектов — не менее 10 часов, руководителей,
          специалистов и ИТР — не менее 40. В{" "}
          <a
            href="https://old.adilet.zan.kz/rus/docs/V1400009510"
            target="_blank"
            rel="noreferrer"
          >
            программах ПТМ
          </a>{" "}
          объём различается: например, руководители — 8 часов, педагогические
          работники — 6. Выберите фактическую программу центра; единого объёма
          для всех документов нет.
        </p>
      </details>
      <div className="form-grid compact">
        <label>
          Часов в учебном дне
          <input
            aria-label="Часов в учебном дне"
            type="number"
            min="0.01"
            max="24"
            step="any"
            placeholder="Например, 8 — по вашей программе"
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
              Сумма — только при подтверждённых одинаковых единицах
            </option>
            <option value="SEPARATE_BLOCKS">
              Теория и производство — последовательные отдельные блоки
            </option>
          </select>
        </label>
        {candidate.hoursSource === "THEORY_AND_PRODUCTION" && (
          <p className="fine-print">
            Академические часы теории и часы производства нельзя складывать без
            подтверждения единиц в графике. Для разных единиц выберите отдельные
            блоки.
          </p>
        )}
        {candidate.hoursSource === "SEPARATE_BLOCKS" && (
          <label>
            Производственных часов в дне
            <input
              aria-label="Производственных часов в дне"
              type="number"
              min="0.01"
              max="24"
              step="any"
              disabled={disabled}
              value={candidate.productionHoursPerDay || ""}
              onChange={(e) =>
                setCandidate({
                  ...candidate,
                  productionHoursPerDay: Number(e.target.value) || undefined,
                })
              }
            />
            <small>
              Первое поле задаёт академические часы теории в день; каждый блок
              округляется до целого учебного дня отдельно.
            </small>
          </label>
        )}
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
                calendarVersion:
                  e.target.value === "KZ_FIVE_DAY"
                    ? KZ_TRAINING_CALENDAR_VERSION
                    : undefined,
              })
            }
          >
            <option value="">Выберите по графику</option>
            <option value="KZ_FIVE_DAY">{KZ_TRAINING_CALENDAR_LABEL}</option>
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
            <option value="DOCUMENT_AFTER_TRAINING">
              Обучение до даты документа — выходные и праздники пропускаются по
              графику
            </option>
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
        type="button"
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
          type="button"
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
