import { isBlankText, type IssuerProfile } from "@demo/contracts";

export type Commission = IssuerProfile["commission"];

export function commissionRole(index: number): string {
  return index === 0 ? "Председатель комиссии" : `Член комиссии ${index}`;
}

function hasCommissionData(person: Commission[number]): boolean {
  return Object.values(person).some((value) => value?.trim());
}

/** Empty display slots are not records; never shift a member into the chair slot. */
export function prepareCommissionForSave(value: Commission): Commission {
  const result = value.map((person) => ({
    ...person,
    name: person.name.trim(),
    position: person.position.trim(),
  }));
  while (result.length && !hasCommissionData(result[result.length - 1])) {
    result.pop();
  }
  return result;
}

export function commissionMissingNames(
  value: Commission,
  requiredCount = 3,
): number[] {
  const rows = prepareCommissionForSave(value);
  return Array.from(
    { length: Math.max(requiredCount, rows.length) },
    (_, index) => index,
  ).filter((index) => isBlankText(rows[index]?.name));
}

export function requestReturnPath(
  value: string | null | undefined,
): string | undefined {
  if (!value || !/^\/requests\/[a-zA-Z0-9_-]+(?:\?|$)/.test(value))
    return undefined;
  const url = new URL(value, "https://local.invalid");
  if (!/^\/requests\/[a-zA-Z0-9_-]+$/.test(url.pathname) || url.hash)
    return undefined;
  for (const [key, entry] of url.searchParams) {
    if (key === "commission" && entry === "1") continue;
    if (key === "profile" && entry === "1") continue;
    if (key === "commissionEvent" && /^[a-zA-Z0-9_-]+$/.test(entry)) continue;
    return undefined;
  }
  return `${url.pathname}${url.search}`;
}
