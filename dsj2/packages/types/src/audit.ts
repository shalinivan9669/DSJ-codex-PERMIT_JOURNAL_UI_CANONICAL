import { z } from "zod";

export const auditLogSchema = z.object({
  id: z.string(),
  action: z.string(),
  entityType: z.string(),
  entityId: z.string(),
  actorName: z.string().nullable(),
  createdAt: z.string(),
  metadata: z.record(z.string(), z.any()).nullable(),
});

export type AuditLog = z.infer<typeof auditLogSchema>;

