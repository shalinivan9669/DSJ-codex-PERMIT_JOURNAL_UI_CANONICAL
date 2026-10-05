import { BIOT_CATEGORIES, type Assignment } from "@demo/contracts";

/** Program is an independent print contract. A newer neutral form must never
 * silently replace the special-competence form selected by an assignment. */
export function assignmentTemplateKey(
  assignment: Pick<Assignment, "templateId" | "biotCategory">,
  templateId: string = assignment.templateId,
) {
  return assignment.biotCategory &&
    BIOT_CATEGORIES[assignment.biotCategory].program === "SPECIAL"
    ? `${templateId}:SPECIAL`
    : templateId;
}

export function registeredTemplateKey(template: {
  templateId: string;
  contract: unknown;
}) {
  return (template.contract as Record<string, unknown>).program === "SPECIAL"
    ? `${template.templateId}:SPECIAL`
    : template.templateId;
}
