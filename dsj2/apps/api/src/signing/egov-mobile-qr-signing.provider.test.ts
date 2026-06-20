import assert from "node:assert/strict";
import { test } from "node:test";
import { BadRequestException, UnauthorizedException } from "@nestjs/common";
import { EgovMobileQrSigningProvider } from "./providers/egov-mobile-qr-signing.provider";

const documentHash = "a".repeat(64);

function createProvider(callbackSecret = "callback-secret") {
  return new EgovMobileQrSigningProvider(
    {
      get: (key: string) =>
        ({
          NODE_ENV: "development",
          EGOV_MOBILE_QR_ALLOW_LOCAL_CALLBACK_SIMULATION: "true",
          EGOV_MOBILE_QR_CALLBACK_SECRET: callbackSecret,
        })[key],
    } as never,
    {} as never,
  );
}

function validCallback() {
  const signedAt = new Date();
  const validFrom = new Date(signedAt.getTime() - 60_000);
  const validTo = new Date(signedAt.getTime() + 60_000);

  return {
    callbackId: "callback-1",
    providerSessionId: "provider-session-1",
    correlationId: "correlation-1",
    status: "SIGNED" as const,
    documentHash,
    signerName: "Айгерим Садыкова",
    signerIin: "980317350011",
    certificateSerial: "CERT-000001",
    certificateThumbprint: "THUMBPRINT-1",
    certificateSubject: "CN=Айгерим Садыкова",
    certificateIssuer: "CN=LOCAL TEST CA",
    certificateValidFrom: validFrom.toISOString(),
    certificateValidTo: validTo.toISOString(),
    signedAt: signedAt.toISOString(),
    signaturePayload: "LOCAL-MOCK-CMS",
  };
}

test("local eGov provider rejects an invalid callback secret", () => {
  const provider = createProvider();

  assert.throws(
    () =>
      provider.verifyCallback({
        callback: validCallback(),
        callbackSecret: "wrong-secret",
        expectedCallbackSecret: "callback-secret",
        expectedProviderSessionId: "provider-session-1",
        expectedCorrelationId: "correlation-1",
        expectedDocumentHash: documentHash,
      }),
    (error) => error instanceof UnauthorizedException,
  );
});

test("local eGov provider rejects a mismatched document hash", () => {
  const provider = createProvider();

  assert.throws(
    () =>
      provider.verifyCallback({
        callback: { ...validCallback(), documentHash: "b".repeat(64) },
        callbackSecret: "callback-secret",
        expectedCallbackSecret: "callback-secret",
        expectedProviderSessionId: "provider-session-1",
        expectedCorrelationId: "correlation-1",
        expectedDocumentHash: documentHash,
      }),
    (error) => error instanceof BadRequestException && error.message.includes("documentHash"),
  );
});

test("local eGov provider rejects an expired certificate", () => {
  const provider = createProvider();
  const callback = validCallback();
  const expiredAt = new Date(Date.now() - 60_000);

  assert.throws(
    () =>
      provider.verifyCallback({
        callback: {
          ...callback,
          certificateValidFrom: new Date(expiredAt.getTime() - 60_000).toISOString(),
          certificateValidTo: expiredAt.toISOString(),
          signedAt: new Date(expiredAt.getTime() - 30_000).toISOString(),
        },
        callbackSecret: "callback-secret",
        expectedCallbackSecret: "callback-secret",
        expectedProviderSessionId: "provider-session-1",
        expectedCorrelationId: "correlation-1",
        expectedDocumentHash: documentHash,
      }),
    (error) => error instanceof BadRequestException,
  );
});

test("local eGov provider verifies the complete simulated callback", () => {
  const provider = createProvider();
  const result = provider.verifyCallback({
    callback: validCallback(),
    callbackSecret: "callback-secret",
    expectedCallbackSecret: "callback-secret",
    expectedProviderSessionId: "provider-session-1",
    expectedCorrelationId: "correlation-1",
    expectedDocumentHash: documentHash,
  });

  assert.equal(result.documentHash, documentHash);
  assert.equal(result.signerIin, "980317350011");
  assert.equal(result.verificationMode, "LOCAL_SIMULATION");
  assert.equal(result.signaturePayloadHash.length, 64);
});
