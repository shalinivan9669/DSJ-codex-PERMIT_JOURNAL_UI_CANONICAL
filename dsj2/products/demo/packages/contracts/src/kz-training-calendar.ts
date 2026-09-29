/** Immutable calendar edition. Add a new version instead of changing saved rules.
 * Working-time calendars are a schedule choice, not a statutory training-day length.
 */
export const KZ_TRAINING_CALENDAR_VERSION = "KZ_2025_2026_V1" as const;
export const KZ_TRAINING_CALENDAR_SOURCES = [
  "https://www.gov.kz/memleket/entities/enbek/documents/details/756543?lang=ru",
  "https://adilet.zan.kz/rus/docs/G24G0000436",
  "https://www.gov.kz/memleket/entities/enbek/documents/details/1034069?lang=ru",
  "https://old.adilet.zan.kz/rus/docs/Z2600000306",
] as const;

const nonWorkingWeekdays: Record<number, ReadonlySet<string>> = {
  2025: new Set([
    "01-01",
    "01-02",
    "01-03",
    "01-07",
    "03-10",
    "03-21",
    "03-24",
    "03-25",
    "05-01",
    "05-07",
    "05-09",
    "06-06",
    "07-07",
    "09-01",
    "10-27",
    "12-16",
  ]),
  // Constitution Day changed effective 01.07.2026: no retrospective 16 March
  // holiday and no 31 August holiday. Published balance: 247 working days.
  2026: new Set([
    "01-01",
    "01-02",
    "01-07",
    "03-09",
    "03-23",
    "03-24",
    "03-25",
    "05-01",
    "05-07",
    "05-11",
    "05-27",
    "07-06",
    "10-26",
    "12-16",
  ]),
};
const workingWeekends = new Set(["2025-01-05"]); // Order 436: rest moved to 3 January.

/** null means unverified coverage, never an inferred ordinary working day. */
export function kzTrainingDay(date: Date): boolean | null {
  const exceptions = nonWorkingWeekdays[date.getUTCFullYear()];
  if (!exceptions) return null;
  const iso = date.toISOString().slice(0, 10);
  if (workingWeekends.has(iso)) return true;
  return ![0, 6].includes(date.getUTCDay()) && !exceptions.has(iso.slice(5));
}

export const KZ_TRAINING_CALENDAR_LABEL =
  "Казахстан, пятидневка, праздники и переносы 2025–2026 (версия 1)";
