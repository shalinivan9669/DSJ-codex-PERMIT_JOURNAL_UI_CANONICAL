function parts(date: Date, timezone: string) {
  const values = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  return Object.fromEntries(
    values.filter((p) => p.type !== "literal").map((p) => [p.type, p.value]),
  );
}
export function isoToZonedInput(
  value: string | Date | null | undefined,
  timezone: string,
) {
  if (!value) return "";
  const p = parts(new Date(value), timezone);
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}
/** Interpret the selected zone explicitly; the browser/computer zone is irrelevant. */
export function zonedInputToIso(value: string, timezone: string) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/.test(value))
    throw new Error("Укажите дату и время");
  const wanted = Date.parse(value.length === 16 ? `${value}:00Z` : `${value}Z`);
  if (!Number.isFinite(wanted)) throw new Error("Некорректная дата");
  const offsets = new Set(
    [-36, 0, 36].map((hours) => {
      const probe = wanted + hours * 3600000;
      const p = parts(new Date(probe), timezone);
      return (
        Date.parse(
          `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}Z`,
        ) - probe
      );
    }),
  );
  const candidates = [...offsets]
    .map((offset) => wanted - offset)
    .filter(
      (candidate) =>
        isoToZonedInput(new Date(candidate), timezone) === value.slice(0, 16),
    );
  if (candidates.length !== 1) throw new Error("EVENT_LOCAL_TIME_AMBIGUOUS");
  return new Date(candidates[0]).toISOString();
}
export function addZonedDays(value: Date, days: number, timezone: string) {
  const p = parts(value, timezone);
  const local = new Date(
    Date.UTC(
      Number(p.year),
      Number(p.month) - 1,
      Number(p.day) + days,
      Number(p.hour),
      Number(p.minute),
      Number(p.second),
    ),
  );
  return new Date(zonedInputToIso(local.toISOString().slice(0, 19), timezone));
}
