import { BIOT_CATEGORIES, z, type Assignment } from "@demo/contracts";

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

export const originalArchivePolicy = "ORIGINAL_ARCHIVE_20261117";

const kazakhSource = z.object({
  storageKey: z.string().min(1),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
});

/** Frozen with the primary bytes in snapshots, never resolved against a newer form. */
export function templateRenderSource(template: {
  templateId: string;
  storageKey: string;
  checksum: string;
  contract: unknown;
}) {
  const contract = template.contract as Record<string, unknown>;
  const originalPair =
    template.templateId === "ps-protocol" &&
    contract.renderPolicy === originalArchivePolicy;
  return {
    templateStorageKey: template.storageKey,
    templateChecksum: template.checksum,
    ...(originalPair
      ? {
          originalKazakhSource: kazakhSource.parse(
            contract.originalKazakhSource,
          ),
        }
      : {}),
  };
}
