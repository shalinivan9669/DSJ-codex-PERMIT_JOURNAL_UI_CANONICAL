import type {
  LegalSigningProvider,
  MockSignInput,
  NcalayerBridgeSignature,
  SigningDocumentType,
} from "@dsj/types";
import type { AuthenticatedUser } from "../common/types/authenticated-user.type";

export type SigningRequestContext = {
  ipAddress?: string | null;
  userAgent?: string | null;
};

export type ResolvedSigningTarget = {
  documentType: SigningDocumentType;
  documentId: string;
  organizationId: string;
  envelopeId: string | null;
  versionId: string | null;
  documentHash: string;
  title: string;
  documentNumber: string | null;
  isReadyForSigning: boolean;
  signerEmployeeId?: string | null;
  signerEmployeeName?: string | null;
  signerIinMasked?: string | null;
  signerIinHash?: string | null;
};

export type CompleteSigningSessionInput =
  | {
      provider: "MOCK_PROVIDER" | "EGOV_MOBILE_QR_PROVIDER";
      payload: MockSignInput;
      context?: SigningRequestContext;
    }
  | {
      provider: "NCALAYER_PROVIDER";
      payload: NcalayerBridgeSignature;
      context?: SigningRequestContext;
    };

export type CreateProviderSessionInput = {
  provider: LegalSigningProvider;
  target: ResolvedSigningTarget;
  sessionId: string;
  correlationId: string;
  expiresAt: Date;
};
