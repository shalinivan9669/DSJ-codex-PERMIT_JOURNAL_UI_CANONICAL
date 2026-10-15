import { z } from "zod";
export const personalDataLocations = [
  "DATABASE",
  "REPLICAS",
  "FILES",
  "BACKUPS",
  "TEMP",
  "RENDER_CACHE",
  "QUEUES",
  "LOGS",
  "EXPORTS",
  "EVIDENCE",
  "SUBPROCESSORS",
] as const;
export const lmsDeploymentEvidenceSchema = z
  .object({
    tenantId: z.string().uuid(),
    operator: z.string().trim().min(1),
    approvedBy: z.string().trim().min(1),
    approvalReference: z.string().trim().min(1),
    lawfulBasis: z.string().trim().min(1),
    subjectAccountingReference: z.string().trim().min(1),
    retentionPolicy: z.string().trim().min(1),
    incidentAndDeletionProcedure: z.string().trim().min(1),
    inventory: z.array(
      z
        .object({
          kind: z.enum(personalDataLocations),
          applicable: z.boolean(),
          country: z.string().default(""),
          operatorOrProcessor: z.string().trim().min(1),
          evidence: z.string().trim().min(1),
          access: z.string().trim().min(1),
          retention: z.string().trim().min(1),
        })
        .strict(),
    ),
  })
  .strict();
/** A completeness gate for deployment evidence; it cannot itself establish legal validity. */
export function lmsDeploymentEvidenceAllowed(
  input: unknown,
  tenantId: string,
): boolean {
  const parsed = lmsDeploymentEvidenceSchema.safeParse(input);
  if (!parsed.success || parsed.data.tenantId !== tenantId) return false;
  const rows = parsed.data.inventory;
  return (
    rows.length === personalDataLocations.length &&
    personalDataLocations.every(
      (kind) => rows.filter((row) => row.kind === kind).length === 1,
    ) &&
    rows.every((row) => !row.applicable || row.country === "KZ")
  );
}
