import {
  addZonedDays,
  isoToZonedInput,
  zonedInputToIso,
} from "@demo/contracts/src/lms/time";

/** Calendar dates follow the centre's zone, regardless of the browser's zone. */
export function learningCalendarToday(
  timezone: string,
  now = new Date(),
): string {
  try {
    return isoToZonedInput(now, timezone).slice(0, 10);
  } catch {
    return "";
  }
}

export function learningCalendarRange(
  fromDate: string,
  timezone: string,
): { from: string; to: string } | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fromDate)) return null;
  const date = new Date(`${fromDate}T00:00:00.000Z`);
  if (
    !Number.isFinite(date.getTime()) ||
    date.toISOString().slice(0, 10) !== fromDate
  )
    return null;
  try {
    const from = zonedInputToIso(`${fromDate}T00:00`, timezone);
    const to = addZonedDays(new Date(from), 31, timezone).toISOString();
    if (
      from.startsWith("+") ||
      from.startsWith("-") ||
      to.startsWith("+") ||
      to.startsWith("-")
    )
      return null;
    return { from, to };
  } catch {
    return null;
  }
}
