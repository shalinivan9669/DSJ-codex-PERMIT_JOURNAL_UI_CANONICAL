/** Human KZT input to integer tiyn, without binary floating point. */
export function kztToMinor(value: string): string {
  const normalized = value.trim().replaceAll(" ", "").replace(",", ".");
  const match = /^(\d{1,12})(?:\.(\d{1,2}))?$/.exec(normalized);
  if (!match)
    throw new Error(
      "Укажите сумму в тенге: не более двух знаков после запятой.",
    );
  return (
    BigInt(match[1]) * 100n +
    BigInt((match[2] || "").padEnd(2, "0"))
  ).toString();
}
export function minorToKzt(value?: string | null): string {
  if (value === undefined || value === null) return "не определена";
  const minor = BigInt(value);
  const sign = minor < 0n ? "−" : "";
  const absolute = minor < 0n ? -minor : minor;
  return `${sign}${absolute / 100n},${(absolute % 100n).toString().padStart(2, "0")}`;
}
