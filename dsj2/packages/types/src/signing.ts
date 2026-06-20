import { z } from "zod";

const normalizeSignatureProviderValue = (value: unknown) => {
  if (typeof value !== "string") {
    return value;
  }

  const normalized = value.trim().toUpperCase();

  if (normalized === "MOCK") {
    return "MOCK_NCALAYER";
  }

  return normalized;
};

export const signatureProviderSchema = z.preprocess(
  normalizeSignatureProviderValue,
  z.enum([
    "MOCK_NCALAYER",
    "NCALAYER",
    "MOCK_PROVIDER",
    "NCALAYER_PROVIDER",
    "EGOV_MOBILE_QR_PROVIDER",
    "TABLET_SIGNATURE_PROVIDER",
    "SMART_BRIDGE_PROVIDER",
    "DIGITAL_ID_PROVIDER",
  ]),
);

export const legalSigningProviderSchema = z.preprocess(
  normalizeSignatureProviderValue,
  z.enum([
    "MOCK_PROVIDER",
    "NCALAYER_PROVIDER",
    "EGOV_MOBILE_QR_PROVIDER",
    "TABLET_SIGNATURE_PROVIDER",
  ]),
);

export const signingSessionStatusSchema = z.enum([
  "CREATED",
  "QR_GENERATED",
  "WAITING_FOR_USER",
  "CALLBACK_RECEIVED",
  "SIGNATURE_RECEIVED",
  "VERIFYING",
  "COMPLETED",
  "EXPIRED",
  "FAILED",
  "CANCELLED",
]);

export const signingDocumentTypeSchema = z.enum([
  "BRIEFING_RECORD",
  "BRIEFING_JOURNAL_ENTRY",
  "EMPLOYEE_DOCUMENT",
  "PROTOCOL",
  "RESPONSIBILITY_ORDER",
  "WORK_PERMIT",
]);

export const documentHashSchema = z.string().regex(/^[a-f0-9]{64}$/i);

export const mockSignSchema = z.object({
  signerName: z.string().min(2),
  signerIin: z.string().regex(/^\d{12}$/),
  certificateSerial: z.string().min(6),
});

export const ncalayerCertificateMetadataSchema = z.object({
  signerName: z.string().min(2),
  signerIin: z.string().regex(/^\d{12}$/),
  certificateSerial: z.string().min(1),
  certificateThumbprint: z.string().min(1),
  certificateSubject: z.string().min(1),
  certificateIssuer: z.string().min(1),
  certificateValidFrom: z.string().datetime({ offset: true }),
  certificateValidTo: z.string().datetime({ offset: true }),
});

export const ncalayerBridgeHealthSchema = z.object({
  ok: z.boolean(),
  provider: z.literal("NCALAYER"),
  version: z.string().nullable().optional(),
  bridgeUrl: z.string().url().nullable().optional(),
});

export const ncalayerBridgeSignatureSchema = ncalayerCertificateMetadataSchema.extend({
  signingDigest: documentHashSchema,
  signedAt: z.string().datetime({ offset: true }),
  cms: z.string().min(1),
  bridgeVersion: z.string().nullable().optional(),
  bridgeUrl: z.string().url().nullable().optional(),
});

export const ncalayerBridgeSignRequestSchema = z.object({
  digest: documentHashSchema,
  testMode: z.boolean().default(false),
  context: z
    .object({
      briefingRecordId: z.string().optional(),
      briefingJournalEntryId: z.string().optional(),
      employeeDocumentId: z.string().optional(),
      protocolId: z.string().optional(),
      responsibilityOrderId: z.string().optional(),
      inviteToken: z.string().optional(),
      documentNumber: z.string().nullable().optional(),
    })
    .optional(),
});

export const briefingSignInputSchema = z.union([ncalayerBridgeSignatureSchema, mockSignSchema]);

export const createSigningSessionSchema = z.object({
  documentType: signingDocumentTypeSchema,
  documentId: z.string().min(1),
  provider: legalSigningProviderSchema.optional(),
  signerUserId: z.string().min(1).optional(),
});

export const cancelSigningSessionSchema = z.object({
  reason: z.string().max(500).optional(),
});

export const submitMockSigningSessionSchema = mockSignSchema;

export const submitNcalayerSigningSessionSchema = ncalayerBridgeSignatureSchema;

export const submitTabletSigningSessionSchema = z.object({
  signatureDataUrl: z
    .string()
    .max(350_000)
    .regex(/^data:image\/png;base64,[A-Za-z0-9+/=]+$/),
  strokeCount: z.number().int().min(1).max(10_000),
  confirmed: z.literal(true),
});

export const completeLocalEgovSigningSessionSchema = z.object({
  confirmed: z.literal(true),
});

export const egovMobileQrCallbackSchema = z
  .object({
    callbackId: z.string().min(1).optional(),
    providerSessionId: z.string().min(1).optional(),
    sessionId: z.string().min(1).optional(),
    correlationId: z.string().min(1).optional(),
    status: z.enum(["SIGNED", "FAILED", "CANCELLED", "EXPIRED"]).optional(),
    documentHash: documentHashSchema.optional(),
    signerName: z.string().min(2).optional(),
    signerIin: z.string().regex(/^\d{12}$/).optional(),
    certificateSerial: z.string().min(6).optional(),
    certificateThumbprint: z.string().min(1).optional(),
    certificateSubject: z.string().min(1).optional(),
    certificateIssuer: z.string().min(1).optional(),
    certificateValidFrom: z.string().datetime({ offset: true }).optional(),
    certificateValidTo: z.string().datetime({ offset: true }).optional(),
    signedAt: z.string().datetime({ offset: true }).optional(),
    signaturePayload: z.string().optional(),
    errorCode: z.string().optional(),
    errorMessage: z.string().optional(),
  })
  .passthrough();

const normalizeOptionalSigningPayload = (value: unknown) => {
  if (value && typeof value === "object" && !Array.isArray(value) && Object.keys(value).length === 0) {
    return undefined;
  }

  return value;
};

export const optionalBriefingSignInputSchema = z.preprocess(
  normalizeOptionalSigningPayload,
  briefingSignInputSchema.optional(),
);

const signingRuntimeConfigSchema = z.object({
  SIGNING_PROVIDER: signatureProviderSchema.optional(),
  NCALAYER_BRIDGE_URL: z.string().optional(),
  NCALAYER_BRIDGE_TIMEOUT_MS: z.string().optional(),
  SIGNING_TEST_MODE: z.string().optional(),
});

function parseBoolean(value: string | undefined, defaultValue: boolean) {
  if (value === undefined) {
    return defaultValue;
  }

  const normalized = value.trim().toLowerCase();
  return normalized === "true" || normalized === "1" || normalized === "yes";
}

function parseTimeout(value: string | undefined, defaultValue: number) {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : defaultValue;
}

export type SigningRuntimeConfig =
  | {
      isConfigured: true;
      provider: SignatureProvider;
      bridgeUrl: string | null;
      bridgeTimeoutMs: number;
      testMode: boolean;
      configError: null;
    }
  | {
      isConfigured: false;
      provider: SignatureProvider | null;
      bridgeUrl: string | null;
      bridgeTimeoutMs: number;
      testMode: boolean;
      configError: string;
    };

export function resolveSigningRuntimeConfig(
  rawEnv: Record<string, string | undefined>,
): SigningRuntimeConfig {
  const env = signingRuntimeConfigSchema.parse(rawEnv);
  const bridgeTimeoutMs = parseTimeout(env.NCALAYER_BRIDGE_TIMEOUT_MS, 15000);
  const testMode = parseBoolean(env.SIGNING_TEST_MODE, false);

  if (!env.SIGNING_PROVIDER) {
    return {
      isConfigured: false,
      provider: null,
      bridgeUrl: null,
      bridgeTimeoutMs,
      testMode,
      configError: "SIGNING_PROVIDER must be explicitly set to NCALAYER or MOCK_NCALAYER.",
    };
  }

  const provider = env.SIGNING_PROVIDER;
  const bridgeUrlRaw = env.NCALAYER_BRIDGE_URL?.trim();
  const bridgeUrl = bridgeUrlRaw?.length ? bridgeUrlRaw : null;

  if (provider === "NCALAYER" && !bridgeUrl) {
    return {
      isConfigured: false,
      provider,
      bridgeUrl: null,
      bridgeTimeoutMs,
      testMode,
      configError: "NCALAYER_BRIDGE_URL must be set when SIGNING_PROVIDER=NCALAYER.",
    };
  }

  if (bridgeUrl) {
    const parsedBridgeUrl = z.string().url().safeParse(bridgeUrl);

    if (!parsedBridgeUrl.success) {
      return {
        isConfigured: false,
        provider,
        bridgeUrl,
        bridgeTimeoutMs,
        testMode,
        configError: "NCALAYER_BRIDGE_URL must be a valid URL.",
      };
    }
  }

  return {
    isConfigured: true,
    provider,
    bridgeUrl,
    bridgeTimeoutMs,
    testMode,
    configError: null,
  };
}

export type SignatureProvider = z.infer<typeof signatureProviderSchema>;
export type LegalSigningProvider = z.infer<typeof legalSigningProviderSchema>;
export type SigningSessionStatus = z.infer<typeof signingSessionStatusSchema>;
export type SigningDocumentType = z.infer<typeof signingDocumentTypeSchema>;
export type MockSignInput = z.infer<typeof mockSignSchema>;
export type NcalayerCertificateMetadata = z.infer<typeof ncalayerCertificateMetadataSchema>;
export type NcalayerBridgeHealth = z.infer<typeof ncalayerBridgeHealthSchema>;
export type NcalayerBridgeSignature = z.infer<typeof ncalayerBridgeSignatureSchema>;
export type NcalayerBridgeSignRequest = z.infer<typeof ncalayerBridgeSignRequestSchema>;
export type BriefingSignInput = z.infer<typeof briefingSignInputSchema>;
export type OptionalBriefingSignInput = z.infer<typeof optionalBriefingSignInputSchema>;
export type CreateSigningSessionInput = z.infer<typeof createSigningSessionSchema>;
export type CancelSigningSessionInput = z.infer<typeof cancelSigningSessionSchema>;
export type SubmitMockSigningSessionInput = z.infer<typeof submitMockSigningSessionSchema>;
export type SubmitNcalayerSigningSessionInput = z.infer<typeof submitNcalayerSigningSessionSchema>;
export type SubmitTabletSigningSessionInput = z.infer<typeof submitTabletSigningSessionSchema>;
export type CompleteLocalEgovSigningSessionInput = z.infer<typeof completeLocalEgovSigningSessionSchema>;
export type EgovMobileQrCallbackInput = z.infer<typeof egovMobileQrCallbackSchema>;

export type SigningSessionResponse = {
  id: string;
  provider: LegalSigningProvider;
  status: SigningSessionStatus;
  documentType: SigningDocumentType;
  documentId: string;
  documentHash: string;
  hashAlgorithm: string;
  expiresAt: string;
  completedAt: string | null;
  cancelledAt: string | null;
  failureReason: string | null;
  qrUrl: string | null;
  deeplink: string | null;
  pollAfterMs: number;
  correlationId: string;
  localSimulation: boolean;
  verification: {
    status: "PENDING" | "PASS" | "FAIL" | "INDETERMINATE" | null;
    signatureId: string | null;
    evidenceId: string | null;
  };
};

export type DocumentSigningStateResponse = {
  documentType: SigningDocumentType;
  documentId: string;
  state:
    | "DRAFT"
    | "READY_FOR_SIGNING"
    | "SIGNING_IN_PROGRESS"
    | "SIGNED"
    | "FAILED"
    | "CANCELLED"
    | "EXPIRED";
  documentHash: string | null;
  requiredSigners: Array<{
    userId: string | null;
    employeeId: string | null;
    name: string;
    role: string | null;
    signed: boolean;
  }>;
};

export type DocumentSignaturesResponse = {
  documentType: SigningDocumentType;
  documentId: string;
  signatures: Array<{
    id: string;
    provider: SignatureProvider;
    signerName: string;
    signerRole: string | null;
    certificateSerial: string;
    documentHash: string;
    signatureHash: string | null;
    signedAt: string | null;
    verifiedAt: string | null;
    verificationStatus: "PASS" | "FAIL" | null;
    evidenceId: string | null;
  }>;
};
