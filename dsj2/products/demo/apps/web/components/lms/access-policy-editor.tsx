"use client";
import { useState } from "react";
import type { AccessPolicy } from "@demo/contracts/src/lms";
import { isoToZonedInput, zonedInputToIso } from "@/lib/learning-time";
import type { Translate } from "./common";

export function LocalDeadline({
  value,
  onChange,
  timezone,
  t,
}: {
  value?: string | null;
  onChange: (value: string | null) => void;
  timezone: string;
  t: Translate;
}) {
  const [invalid, setInvalid] = useState(false);
  return (
    <label>
      {t("Срок выполнения", "Орындау мерзімі")} · {timezone}
      <input
        type="datetime-local"
        value={value ? isoToZonedInput(value, timezone) : ""}
        onChange={(event) => {
          try {
            onChange(
              event.target.value
                ? zonedInputToIso(event.target.value, timezone)
                : null,
            );
            setInvalid(false);
          } catch {
            setInvalid(true);
          }
        }}
      />
      {invalid && (
        <span role="alert">
          {t("Проверьте дату и время", "Күн мен уақытты тексеріңіз")}
        </span>
      )}
    </label>
  );
}

export function AccessPolicyEditor({
  value,
  onChange,
  t,
  disabled = false,
}: {
  value: AccessPolicy;
  onChange: (value: AccessPolicy) => void;
  t: Translate;
  disabled?: boolean;
}) {
  const [invalid, setInvalid] = useState(false);
  const zones = [
    ...new Set([
      value.timezone,
      "Asia/Qyzylorda",
      "Asia/Almaty",
      "Asia/Aqtau",
      "Asia/Aqtobe",
      "Asia/Atyrau",
      "Asia/Oral",
      "UTC",
    ]),
  ];
  function date(field: "startsAt" | "endsAt", input: string) {
    try {
      onChange({
        ...value,
        [field]: input ? zonedInputToIso(input, value.timezone) : null,
      });
      setInvalid(false);
    } catch {
      setInvalid(true);
    }
  }
  return (
    <fieldset disabled={disabled} className="lms-access-policy">
      <legend>{t("Период доступа", "Қолжетімділік мерзімі")}</legend>
      <div className="lms-fields">
        <label>
          {t("Режим доступа", "Қолжетімділік режимі")}
          <select
            value={value.mode}
            onChange={(event) =>
              onChange({
                mode: event.target.value as AccessPolicy["mode"],
                timezone: value.timezone,
                ...(event.target.value === "DAYS"
                  ? { days: value.days || 90 }
                  : event.target.value === "FIXED"
                    ? {
                        startsAt: value.startsAt || null,
                        endsAt: value.endsAt || null,
                      }
                    : {}),
              })
            }
          >
            <option value="UNLIMITED">
              {t("Без ограничения срока", "Мерзімі шектелмеген")}
            </option>
            <option value="DAYS">{t("Количество дней", "Күн саны")}</option>
            <option value="FIXED">
              {t("Фиксированный период", "Белгіленген кезең")}
            </option>
          </select>
        </label>
        <label>
          {t("Часовой пояс", "Уақыт белдеуі")}
          <select
            value={value.timezone}
            onChange={(event) =>
              onChange({ ...value, timezone: event.target.value })
            }
          >
            {zones.map((zone) => (
              <option value={zone} key={zone}>
                {zone}
              </option>
            ))}
          </select>
        </label>
        {value.mode === "DAYS" && (
          <label>
            {t("Дней доступа", "Қолжетімділік күндері")}
            <input
              type="number"
              min={1}
              max={3650}
              value={value.days || 90}
              onChange={(event) =>
                onChange({ ...value, days: Number(event.target.value) || 1 })
              }
            />
          </label>
        )}
        {value.mode === "FIXED" && (
          <>
            <label>
              {t("Начало доступа", "Қолжетімділіктің басталуы")}
              <input
                type="datetime-local"
                value={
                  value.startsAt
                    ? isoToZonedInput(value.startsAt, value.timezone)
                    : ""
                }
                onChange={(event) => date("startsAt", event.target.value)}
              />
            </label>
            <label>
              {t("Окончание доступа", "Қолжетімділіктің аяқталуы")}
              <input
                type="datetime-local"
                value={
                  value.endsAt
                    ? isoToZonedInput(value.endsAt, value.timezone)
                    : ""
                }
                onChange={(event) => date("endsAt", event.target.value)}
              />
            </label>
          </>
        )}
      </div>
      {invalid && (
        <p role="alert">
          {t(
            "Проверьте дату, время и часовой пояс",
            "Күнді, уақытты және уақыт белдеуін тексеріңіз",
          )}
        </p>
      )}
      {value.mode === "FIXED" &&
        value.startsAt &&
        value.endsAt &&
        value.startsAt >= value.endsAt && (
          <p role="alert">
            {t(
              "Окончание должно быть позже начала",
              "Аяқталу басталудан кейін болуы керек",
            )}
          </p>
        )}
    </fieldset>
  );
}
