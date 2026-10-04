"use client";
import { useEffect, useId, useState } from "react";
import { Notice } from "@demo/ui";
import {
  trainingDateRuleSchema,
  trainingRuleDescription,
  KZ_TRAINING_CALENDAR_LABEL,
  KZ_TRAINING_CALENDAR_VERSION,
  type TrainingDateRule,
} from "@demo/contracts";
import { useDurablePreparation } from "@/lib/use-durable-preparation";
import type { PreparationIdentity } from "@/lib/preparation-storage";
import { trainingDisplayTitle } from "@/lib/training-display";
import {
  calendarCandidate,
  calendarCandidateRule,
  calendarCandidateErrors,
  validCalendarCandidate,
  type CalendarCandidate,
} from "@/lib/calendar-preparation";

export function TrainingDateSettings({
  rule,
  disabled,
  onChange,
  preparationIdentity,
  preparationContext = "",
  requestRevision = 0,
  targetTitle = "этого документа",
  fieldPath,
  fieldHints = {},
}: {
  rule?: TrainingDateRule | null;
  disabled: boolean;
  onChange: (rule: TrainingDateRule | null) => void;
  preparationIdentity?: PreparationIdentity;
  preparationContext?: string;
  requestRevision?: number;
  targetTitle?: string;
  fieldPath?: string;
  fieldHints?: Record<string, string>;
}) {
  const id = useId();
  const defaults = calendarCandidate(rule);
  const preparation = useDurablePreparation<CalendarCandidate>({
    identity: preparationIdentity,
    defaults,
    context: preparationContext,
    revision: requestRevision,
    title: targetTitle,
    validate: validCalendarCandidate,
  });
  const [localCandidate, setLocalCandidate] = useState(defaults);
  const ruleKey = JSON.stringify(rule);
  useEffect(() => {
    if (!preparationIdentity) setLocalCandidate(calendarCandidate(rule));
  }, [ruleKey, !!preparationIdentity]);
  const candidate = preparationIdentity ? preparation.value : localCandidate;
  const [reviewSignature, setReviewSignature] = useState("");
  const [touched, setTouched] = useState<string[]>([]);
  const parsed = trainingDateRuleSchema.safeParse(
    calendarCandidateRule(candidate),
  );
  const errors = calendarCandidateErrors(candidate);
  const changed =
    JSON.stringify(parsed.success ? parsed.data : candidate) !==
    JSON.stringify(rule);
  const signature = JSON.stringify([
    preparationContext,
    candidate,
    targetTitle,
  ]);
  const reviewed = reviewSignature === signature && !preparation.stale;
  const blocked =
    disabled ||
    !parsed.success ||
    !changed ||
    (!!preparationIdentity &&
      (preparation.status !== "saved" || preparation.stale));
  function change(patch: Partial<CalendarCandidate>) {
    const next = { ...candidate, ...patch };
    if (preparationIdentity) preparation.setValue(next);
    else setLocalCandidate(next);
    setReviewSignature("");
    setTouched((old) => [...new Set([...old, ...Object.keys(patch)])]);
  }
  function error(field: keyof CalendarCandidate, fallback?: string) {
    const message = errors[field];
    const appliedCause = fieldPath
      ? fieldHints[`${fieldPath}.${field}`]
      : undefined;
    const visible =
      message && (touched.includes(field) || !!preparation.record);
    return (
      <small
        id={id + "-" + field}
        className={visible || appliedCause ? "field-error" : "field-hint"}
        aria-live="polite"
      >
        {visible
          ? message
          : appliedCause
            ? `Применённый график: ${appliedCause}`
            : fallback || "\u00a0"}
      </small>
    );
  }
  function attributes(field: keyof CalendarCandidate) {
    const appliedCause = fieldPath
      ? fieldHints[`${fieldPath}.${field}`]
      : undefined;
    const candidateMatchesApplied =
      String(candidate[field] ?? "") === String(rule?.[field] ?? "");
    return {
      "data-training-field": "trainingDateRule." + field,
      "data-field-path": fieldPath ? fieldPath + "." + field : undefined,
      "aria-invalid":
        (errors[field] && (touched.includes(field) || !!preparation.record)) ||
        (appliedCause && candidateMatchesApplied)
          ? true
          : undefined,
      "aria-describedby": id + "-" + field,
    };
  }
  return (
    <details className="field-provenance">
      <summary>Правило расчёта периода обучения</summary>
      <p>{trainingRuleDescription(rule)}</p>
      <p className="fine-print">
        Укажите фактический график программы для «
        {trainingDisplayTitle(targetTitle)}». Он рассчитывает даты и не
        подтверждает обучение или экзамен. Срок действия документа определяется
        отдельно.
      </p>
      {preparationIdentity && (
        <p className="preparation-status" role="status" aria-live="polite">
          {preparation.status === "loading"
            ? "Подготовка графика загружается"
            : preparation.status === "pending"
              ? "Подготовка графика сохраняется в этом браузере"
              : preparation.status === "error"
                ? "Подготовка графика не сохранена"
                : preparation.record
                  ? "График подготовлен и сохранён в этом браузере, не применён"
                  : "Подготовка графика ещё не изменена"}
          .
        </p>
      )}
      {preparation.error && (
        <Notice kind="error">
          {preparation.error}
          <button type="button" onClick={preparation.retry}>
            Повторить сохранение графика
          </button>
          <button type="button" onClick={preparation.reload}>
            Загрузить сохранённую подготовку графика
          </button>
        </Notice>
      )}
      {preparation.stale && (
        <Notice kind="info">
          Исходные данные «{trainingDisplayTitle(targetTitle)}» изменились.
          Кандидат сохранён; проверьте часы, даты и состав участников перед
          применением.
          <button
            type="button"
            disabled={disabled}
            onClick={() => {
              preparation.acceptContext();
              setReviewSignature("");
            }}
          >
            Подготовить график к текущим данным
          </button>
        </Notice>
      )}
      <div className="form-grid compact">
        <label>
          Часов в учебном дне
          <input
            {...attributes("hoursPerDay")}
            aria-label="Часов в учебном дне"
            type="text"
            inputMode="decimal"
            disabled={disabled}
            value={candidate.hoursPerDay}
            placeholder="Например, 8 — по вашей программе"
            onChange={(e) => change({ hoursPerDay: e.target.value })}
          />
          {error(
            "hoursPerDay",
            "Больше 0 и не больше 24; дробные значения допустимы. Это часы в дне, не общий объём программы.",
          )}
        </label>
        <label>
          Какие часы учитывать
          <select
            {...attributes("hoursSource")}
            aria-label="Какие часы учитывать"
            disabled={disabled}
            value={candidate.hoursSource}
            onChange={(e) =>
              change({
                hoursSource: e.target.value as CalendarCandidate["hoursSource"],
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
          {error("hoursSource")}
        </label>
        {candidate.hoursSource === "THEORY_AND_PRODUCTION" && (
          <p className="fine-print">
            Академические часы теории и часы производства нельзя складывать без
            подтверждения одинаковых единиц в графике. Для разных единиц
            выберите отдельные блоки.
          </p>
        )}
        {candidate.hoursSource === "SEPARATE_BLOCKS" && (
          <label>
            Производственных часов в дне
            <input
              {...attributes("productionHoursPerDay")}
              aria-label="Производственных часов в дне"
              type="text"
              inputMode="decimal"
              disabled={disabled}
              value={candidate.productionHoursPerDay}
              onChange={(e) =>
                change({ productionHoursPerDay: e.target.value })
              }
            />
            {error(
              "productionHoursPerDay",
              "Больше 0 и не больше 24; каждый блок округляется до целого учебного дня отдельно.",
            )}
          </label>
        )}
        <label>
          Учебные дни
          <select
            {...attributes("calendar")}
            aria-label="Учебные дни"
            disabled={disabled}
            value={candidate.calendar}
            onChange={(e) =>
              change({
                calendar: e.target.value as CalendarCandidate["calendar"],
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
          {error("calendar")}
        </label>
        <label>
          Связь с датой документа
          <select
            {...attributes("anchor")}
            aria-label="Связь с датой документа"
            disabled={disabled}
            value={candidate.anchor}
            onChange={(e) =>
              change({ anchor: e.target.value as CalendarCandidate["anchor"] })
            }
          >
            <option value="">Выберите по графику</option>
            <option value="DOCUMENT_AFTER_TRAINING">
              Обучение до даты документа — по выбранным учебным дням
            </option>
            <option value="DOCUMENT_IS_END">
              Дата документа — последний день обучения
            </option>
            <option value="DOCUMENT_IS_START">
              Дата документа — первый день обучения
            </option>
          </select>
          {error("anchor")}
        </label>
        <label>
          Расчёт даты протокола
          <select
            {...attributes("protocolDate")}
            aria-label="Расчёт даты протокола"
            disabled={disabled}
            value={candidate.protocolDate}
            onChange={(e) =>
              change({
                protocolDate: e.target
                  .value as CalendarCandidate["protocolDate"],
              })
            }
          >
            <option value="">Выберите по графику</option>
            <option value="MANUAL">Вводится отдельно</option>
            <option value="DOCUMENT_DATE">Совпадает с датой документа</option>
            <option value="TRAINING_END">Последний день обучения</option>
          </select>
          {error("protocolDate")}
        </label>
        <label>
          Источник графика
          <input
            {...attributes("source")}
            aria-label="Источник графика"
            disabled={disabled}
            value={candidate.source}
            placeholder="Название программы, расписание, решение центра"
            onChange={(e) => change({ source: e.target.value })}
          />
          {error(
            "source",
            "От 3 до 500 символов: программа, расписание или решение центра.",
          )}
        </label>
      </div>
      {!parsed.success && (
        <p className="fine-print" role="status">
          Для применения заполните график по пояснениям у полей. Некорректное
          правило не записано в заявку.
        </p>
      )}
      {reviewed && (
        <Notice kind="info">
          График будет применён только к «{trainingDisplayTitle(targetTitle)}».
          Подтверждённые результаты не изменятся; ручные и импортированные
          исключения дат сохраняются.
        </Notice>
      )}
      <button
        type="button"
        disabled={blocked}
        onClick={() => {
          if (!parsed.success) return;
          if (!reviewed) {
            setReviewSignature(signature);
            return;
          }
          onChange(parsed.data);
          if (preparationIdentity) preparation.discard();
          setReviewSignature("");
        }}
      >
        {reviewed
          ? "Применить правило расчёта"
          : "Проверить применение графика"}
      </button>
      {(preparation.record ||
        preparation.status === "error" ||
        (!preparationIdentity && changed)) && (
        <button
          type="button"
          className="text-button"
          disabled={disabled}
          onClick={() => {
            if (preparationIdentity) preparation.discard();
            else setLocalCandidate(defaults);
            setReviewSignature("");
            setTouched([]);
          }}
        >
          Отменить только подготовку графика
        </button>
      )}
      {rule && (
        <button
          type="button"
          className="text-button"
          disabled={disabled}
          onClick={() => onChange(null)}
        >
          Отключить применённый автоматический период
        </button>
      )}
      <details className="fine-print">
        <summary>Как график рассчитывает даты</summary>
        <p>
          Продолжительность учебного дня задаёт центр по программе. Например, 16
          часов при 8 часах в день — 2 учебных дня; 8 часов здесь не норматив и
          не заполнено автоматически. Производственные часы учитываются только в
          выбранном режиме.
        </p>
        <p>
          Минимальные часы программ задаются отдельно по категории обучения.
          График не подтверждает объём, обучение или результат. Выберите
          календарь, соответствующий фактическому расписанию центра.
        </p>
        <p>
          Календарь Казахстана: версия {KZ_TRAINING_CALENDAR_VERSION}. Для
          периода вне доступного календаря нужно отдельное проверенное правило;
          даты не выдумываются.
        </p>
      </details>
    </details>
  );
}
