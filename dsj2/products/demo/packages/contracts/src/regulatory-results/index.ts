import { z } from "zod";
export const calendarDefinitionSchema = z
  .object({
    weekendDays: z.array(z.number().int().min(0).max(6)).max(7).default([0, 6]),
    nonWorkingDates: z.array(z.string().date()).max(5000).default([]),
    workingDates: z.array(z.string().date()).max(5000).default([]),
    sources: z.array(z.string().min(1).max(2000)).min(1).max(50),
    synthetic: z.boolean().default(false),
  })
  .strict();
export const dataAccessPolicySchema = z
  .object({
    legalBasis: z.string().max(2000).default(""),
    consentEvidence: z.string().max(2000).default(""),
    accessControl: z
      .enum(["UNKNOWN", "REQUIRED", "NOT_APPLICABLE"])
      .default("UNKNOWN"),
    accessControlEvidence: z.string().max(2000).default(""),
    operatorAuthorization: z.string().max(2000).default(""),
    storageCountry: z.string().max(2).default(""),
    storageInventoryEvidence: z.string().max(2000).default(""),
  })
  .strict();
export type DataAccessPolicy = z.infer<typeof dataAccessPolicySchema>;
export function dataAccessAllowed(policy: DataAccessPolicy): boolean {
  return (
    !!policy.legalBasis &&
    !!policy.consentEvidence &&
    policy.accessControl !== "UNKNOWN" &&
    !!policy.accessControlEvidence &&
    !!policy.operatorAuthorization &&
    policy.storageCountry === "KZ" &&
    !!policy.storageInventoryEvidence
  );
}
export type DeliveryOutcome = "PENDING" | "ACCEPTED" | "REJECTED" | "UNKNOWN";
export interface ProviderReceipt {
  receiptId: string;
  externalId: string;
  correlationId: string;
  payloadHash: string;
  outcome: DeliveryOutcome;
  lmkConfirmed?: boolean;
  evidence: Record<string, unknown>;
}
export interface ProviderResponse {
  transportStatus?: number;
  externalId?: string;
  receipt?: ProviderReceipt;
  retryAfterMs?: number;
}
export interface RegulatoryAdapter {
  environment: "TEST";
  contractVersion: string;
  capabilities: {
    idempotentSubmit: boolean;
    lookup: boolean;
    correction: boolean;
    revocation: boolean;
    lmkConfirmation: boolean;
  };
  submit(input: {
    idempotencyKey: string;
    correlationId: string;
    payloadHash: string;
    payload: unknown;
  }): Promise<ProviderResponse>;
  correct?(input: {
    idempotencyKey: string;
    correlationId: string;
    payloadHash: string;
    payload: unknown;
    previousExternalId: string;
  }): Promise<ProviderResponse>;
  lookup?(input: {
    correlationId: string;
    externalId: string | null;
    payloadHash: string;
  }): Promise<ProviderResponse>;
}
