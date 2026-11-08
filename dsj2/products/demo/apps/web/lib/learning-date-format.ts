/** Keep calendar dates unambiguous even when the browser lacks Kazakh ICU data. */
export function formatLearningDateTime(
  value: string,
  timezone: string,
  requestedLocale: string,
) {
  const locale =
    Intl.DateTimeFormat.supportedLocalesOf(
      [requestedLocale, "ru-KZ", "ru-RU"],
      { localeMatcher: "lookup" },
    )[0] || "en-GB";
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat(locale, {
      timeZone: timezone,
      calendar: "gregory",
      numberingSystem: "latn",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(new Date(value))
      .map((part) => [part.type, part.value]),
  );
  // Numeric day-month-year order also remains stable on minimal ICU builds.
  return `${parts.day}.${parts.month}.${parts.year}, ${parts.hour}:${parts.minute}`;
}
