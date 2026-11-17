import { isBlankText, type IssuerProfile } from "@demo/contracts";
import type { Commission } from "./commission";

export type CommissionTemplate = "umo-chair" | "director-chair";

export const COMMISSION_POSITIONS = [
  "Начальник УМО",
  "Директор",
  "Преподаватель",
] as const;

export function commissionTemplatePositions(template: CommissionTemplate) {
  return template === "director-chair"
    ? ([
        COMMISSION_POSITIONS[1],
        COMMISSION_POSITIONS[0],
        COMMISSION_POSITIONS[2],
      ] as const)
    : COMMISSION_POSITIONS;
}

/** Presets appear only for an entirely empty composition; saved staff keep their slots. */
export function commissionTemplateRows(
  value: Commission,
  template: CommissionTemplate,
): Commission {
  const empty = value.every((person) =>
    Object.values(person).every((field) => isBlankText(field)),
  );
  const positions = commissionTemplatePositions(template);
  return Array.from({ length: Math.max(3, value.length) }, (_, index) => {
    const person = value[index] || { name: "", position: "" };
    return empty && index < positions.length
      ? { ...person, position: positions[index] }
      : person;
  });
}

/** Explicitly complete missing job titles without assigning names or changing commission roles. */
export function fillCommissionPositions(
  value: Commission,
  template: CommissionTemplate,
): Commission {
  const positions = commissionTemplatePositions(template);
  return Array.from({ length: Math.max(3, value.length) }, (_, index) => {
    const person = value[index] || { name: "", position: "" };
    return index < positions.length && isBlankText(person.position)
      ? { ...person, position: positions[index] }
      : person;
  });
}

export function suggestedCommissionTemplate(
  value: Commission,
): CommissionTemplate {
  const directorPositions = commissionTemplatePositions("director-chair");
  return directorPositions.every(
    (position, index) => value[index]?.position === position,
  )
    ? "director-chair"
    : "umo-chair";
}

/** Recognize a commission slot label accidentally entered instead of a job title. */
export function commissionRoleAsPosition(value: string): boolean {
  return /^(?:Председатель(?:\s+комиссии)?|Член\s+комиссии(?:\s+[1-9]\d*)?)$/iu.test(
    value.trim(),
  );
}

function normalized(value: string) {
  return value.trim().replace(/\s+/g, " ").toLocaleLowerCase("ru");
}

/** Only an exact, unique job match can supply a name without choosing a person. */
export function fillKnownCommissionNames(
  rows: Commission,
  headName: string | undefined,
  people: IssuerProfile["people"] = [],
  eligible: (index: number) => boolean = () => true,
): Commission {
  const used = new Set(rows.map((row) => normalized(row.name)).filter(Boolean));
  return rows.map((row, index) => {
    const position = normalized(row.position);
    if (
      !eligible(index) ||
      !position ||
      !isBlankText(row.name) ||
      !isBlankText(row.nameEn)
    )
      return row;
    const names = people
      .filter((entry) => normalized(entry.position) === position)
      .map((entry) => entry.name.trim())
      .filter(Boolean);
    if (position === "директор" && headName?.trim())
      names.unshift(headName.trim());
    const candidate = names[0];
    if (!candidate) return row;
    const key = normalized(candidate);
    if (used.has(key) || names.some((name) => normalized(name) !== key))
      return row;
    used.add(key);
    return { ...row, name: candidate };
  });
}

export function staffFromCommission(
  person: NonNullable<IssuerProfile["people"]>[number],
  member: Commission[number],
) {
  return {
    ...person,
    name: member.name.trim(),
    position: person.position.trim() ? person.position : member.position.trim(),
  };
}
