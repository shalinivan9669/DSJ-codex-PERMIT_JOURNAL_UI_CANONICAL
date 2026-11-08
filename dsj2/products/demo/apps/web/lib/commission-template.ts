import { isBlankText } from "@demo/contracts";
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
