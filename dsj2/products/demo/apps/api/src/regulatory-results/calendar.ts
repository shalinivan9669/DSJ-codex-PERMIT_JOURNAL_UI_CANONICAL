import { calendarDefinitionSchema } from "@demo/contracts/src/regulatory-results";
import { today } from "@demo/contracts";

export function preparationDeadline(
  examAt: Date | null,
  calendar: {
    id: string;
    timezone: string;
    coverageFrom: string;
    coverageUntil: string;
    definition: unknown;
  } | null,
  cutoff: string,
) {
  if (!examAt || !calendar)
    return { state: "NEEDS_REVIEW", dueDate: null, dueAt: null } as const;
  const definition = calendarDefinitionSchema.parse(calendar.definition);
  const start = today(calendar.timezone, examAt);
  if (start < calendar.coverageFrom || start > calendar.coverageUntil)
    return { state: "NEEDS_REVIEW", dueDate: null, dueAt: null } as const;
  let day = new Date(start + "T12:00:00Z");
  for (let count = 0; count < 370; count++) {
    day = new Date(day.getTime() + 86400_000);
    const dueDate = day.toISOString().slice(0, 10);
    if (dueDate > calendar.coverageUntil) break;
    const working =
      definition.workingDates.includes(dueDate) ||
      (!definition.nonWorkingDates.includes(dueDate) &&
        !definition.weekendDays.includes(day.getUTCDay()));
    if (!working) continue;
    // Resolve local wall time through Intl instead of assuming the host's timezone.
    const local = new Date(`${dueDate}T${cutoff}:00Z`);
    let dueAt = local;
    for (let i = 0; i < 3; i++) {
      const parts = new Intl.DateTimeFormat("en-CA", {
        timeZone: calendar.timezone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hourCycle: "h23",
      }).formatToParts(dueAt);
      const value = (type: string) => parts.find((p) => p.type === type)!.value;
      const represented = new Date(
        `${value("year")}-${value("month")}-${value("day")}T${value("hour")}:${value("minute")}:${value("second")}Z`,
      );
      dueAt = new Date(
        dueAt.getTime() + local.getTime() - represented.getTime(),
      );
    }
    return { state: "PREPARED", dueDate, dueAt } as const;
  }
  return { state: "NEEDS_REVIEW", dueDate: null, dueAt: null } as const;
}
