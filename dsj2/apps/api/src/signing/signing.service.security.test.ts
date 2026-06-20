import assert from "node:assert/strict";
import { test } from "node:test";
import { ServiceUnavailableException, UnauthorizedException } from "@nestjs/common";
import { SigningService } from "./signing.service";

process.env.FIELD_ENCRYPTION_KEY ??= "test-field-encryption-key";
process.env.FIELD_HASH_PEPPER ??= "test-field-hash-pepper";

function createService(config: Record<string, string | undefined>, authorizationError: Error) {
  const state = {
    providerCallbackEventCreates: 0,
    signingSessionReads: 0,
  };

  const service = new SigningService(
    {
      providerCallbackEvent: {
        findUnique: async () => null,
        create: async ({ data }: { data: Record<string, unknown> }) => {
          state.providerCallbackEventCreates += 1;
          return {
            id: "callback-event-1",
            correlationId: data.correlationId,
          };
        },
        update: async () => undefined,
      },
      signingSession: {
        findUnique: async () => {
          state.signingSessionReads += 1;
          return null;
        },
        findFirst: async () => {
          state.signingSessionReads += 1;
          return null;
        },
      },
    } as never,
    {
      get: (key: string) => config[key],
    } as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {
      assertCallbackAuthorized: () => {
        throw authorizationError;
      },
    } as never,
  );

  return { service, state };
}

test("eGov callback rejects unsigned callbacks when no local simulation flag is set", async () => {
  const { service, state } = createService(
    {
      NODE_ENV: "development",
      EGOV_MOBILE_QR_CALLBACK_SECRET: "",
      EGOV_MOBILE_QR_ALLOW_LOCAL_CALLBACK_SIMULATION: "false",
    },
    new ServiceUnavailableException("Official callback contract is unavailable."),
  );

  await assert.rejects(
    () =>
      service.acceptEgovCallback({
        sessionId: "session-1",
        status: "SIGNED",
        signerName: "Signer",
        signerIin: "980317350011",
        certificateSerial: "CERT-1",
      }),
    (error) => error instanceof ServiceUnavailableException,
  );

  assert.equal(state.providerCallbackEventCreates, 1);
  assert.equal(state.signingSessionReads, 0);
});

test("eGov callback rejects wrong callback secret before session completion", async () => {
  const { service, state } = createService(
    {
      NODE_ENV: "production",
      EGOV_MOBILE_QR_CALLBACK_SECRET: "expected-callback-secret",
    },
    new UnauthorizedException("Invalid callback secret."),
  );

  await assert.rejects(
    () =>
      service.acceptEgovCallback(
        {
          sessionId: "session-1",
          status: "SIGNED",
          signerName: "Signer",
          signerIin: "980317350011",
          certificateSerial: "CERT-1",
        },
        "wrong-secret",
      ),
    (error) => error instanceof UnauthorizedException,
  );

  assert.equal(state.providerCallbackEventCreates, 1);
  assert.equal(state.signingSessionReads, 0);
});
