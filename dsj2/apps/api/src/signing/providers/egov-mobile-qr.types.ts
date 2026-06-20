import type { EgovMobileQrCallbackInput } from "@dsj/types";
import type { CreateProviderSessionInput } from "../signing.types";

export const EGOV_MOBILE_QR_SERVICE_ID = "NITEC-S-5096";
export const EGOV_MOBILE_QR_SERVICE_KEY = "EGOVMOBILE_QR_SIGN_SERVICE";

export type EgovMobileQrProviderSession = {
  status: "QR_GENERATED";
  providerSessionId: string;
  providerPublicJson: {
    qrUrl: string;
    deeplink: string | null;
    pollAfterMs: number;
    expiresAt: string;
    localSimulation: boolean;
  };
};

export type VerifiedEgovMobileQrSignature = {
  signerName: string;
  signerIin: string;
  certificateSerial: string;
  certificateThumbprint: string;
  certificateSubject: string;
  certificateIssuer: string;
  certificateValidFrom: string;
  certificateValidTo: string;
  signedAt: string;
  documentHash: string;
  signaturePayloadHash: string;
  verificationMode: "LOCAL_SIMULATION";
};

export interface EgovMobileQrTransport {
  createSession(input: CreateProviderSessionInput): Promise<EgovMobileQrProviderSession>;
}

export type VerifyEgovCallbackInput = {
  callback: EgovMobileQrCallbackInput;
  callbackSecret?: string | null;
  expectedCallbackSecret?: string | null;
  expectedProviderSessionId: string;
  expectedCorrelationId: string;
  expectedDocumentHash: string;
};
