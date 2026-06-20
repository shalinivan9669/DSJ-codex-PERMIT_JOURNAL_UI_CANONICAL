import assert from "node:assert/strict";
import { test } from "node:test";
import { BadRequestException, ConflictException, ForbiddenException } from "@nestjs/common";
import { encryptSensitiveValue } from "@dsj/database";
import type { AuthenticatedUser } from "../common/types/authenticated-user.type";
import { SigningService } from "./signing.service";

const user: AuthenticatedUser = {
  userId: "engineer-1",
  companyId: "company-1",
  email: "engineer@example.com",
  fullName: "Инженер ОТ",
  role: "SAFETY_ENGINEER",
};

process.env.FIELD_ENCRYPTION_KEY ??= "test-field-encryption-key";
process.env.FIELD_HASH_PEPPER ??= "test-field-hash-pepper";

function createService(prisma: Record<string, unknown>, providerRegistry?: Record<string, unknown>) {
  return new SigningService(
    prisma as never,
    {
      get: (key: string) =>
        ({
          SIGNING_SESSION_TTL_SECONDS: "300",
          SIGNATURE_HASH_ALGORITHM: "SHA-256",
          NODE_ENV: "development",
          EGOV_MOBILE_QR_ALLOW_LOCAL_CALLBACK_SIMULATION: "true",
        })[key],
    } as never,
    { log: async () => undefined } as never,
    {} as never,
    {} as never,
    (providerRegistry ?? {}) as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  );
}

test("briefing eGov session is assigned to Employee without signer User", async () => {
  const state: { createdData: Record<string, unknown> | null } = {
    createdData: null,
  };
  const service = createService(
    {
      signingSession: {
        create: async ({ data }: { data: Record<string, unknown> }) => {
          state.createdData = data;
          return {
            ...data,
            completedAt: null,
            cancelledAt: null,
            failureReason: null,
            evidence: [],
            signatures: [],
            providerPublicJson: {
              qrUrl: "dsj-egov-mock://sign/provider-session-1",
              deeplink: "dsj-egov-mock://sign/provider-session-1",
              pollAfterMs: 1500,
              localSimulation: true,
            },
          };
        },
      },
      auditLog: {
        create: async () => undefined,
      },
    },
    {
      normalizeProvider: () => "EGOV_MOBILE_QR_PROVIDER",
      assertProviderEnabled: () => undefined,
      createProviderSession: async () => ({
        status: "QR_GENERATED",
        providerSessionId: "provider-session-1",
        providerPublicJson: {
          qrUrl: "dsj-egov-mock://sign/provider-session-1",
          deeplink: "dsj-egov-mock://sign/provider-session-1",
          pollAfterMs: 1500,
          localSimulation: true,
        },
      }),
    },
  );
  (service as any).resolveTarget = async () => ({
    documentType: "BRIEFING_JOURNAL_ENTRY",
    documentId: "briefing-1",
    organizationId: "company-1",
    envelopeId: "envelope-1",
    versionId: "version-1",
    documentHash: "a".repeat(64),
    title: "Инструктаж DSJ-1",
    documentNumber: "DSJ-1",
    isReadyForSigning: true,
    signerEmployeeId: "employee-1",
    signerEmployeeName: "Айгерим Садыкова",
    signerIinMasked: "********0011",
    signerIinHash: "iin-hash",
  });

  const result = await service.createSession(user, {
    documentType: "BRIEFING_JOURNAL_ENTRY",
    documentId: "briefing-1",
    provider: "EGOV_MOBILE_QR_PROVIDER",
  });

  assert.equal(state.createdData?.signerEmployeeId, "employee-1");
  assert.equal(state.createdData?.signerUserId, null);
  assert.equal(state.createdData?.initiatedByUserId, user.userId);
  assert.equal(result.localSimulation, true);
  assert.match(result.qrUrl ?? "", /^dsj-egov-mock:/);
});

test("briefing target rejects a user from another company", async () => {
  const service = createService({
    briefingJournalEntry: {
      findUnique: async () => ({
        id: "briefing-foreign",
        organizationId: "company-2",
      }),
    },
  });

  await assert.rejects(
    () => service.resolveTarget(user, "BRIEFING_JOURNAL_ENTRY", "briefing-foreign"),
    (error) => error instanceof ForbiddenException,
  );
});

test("replayed provider callback is idempotent", async () => {
  const service = createService({
    providerCallbackEvent: {
      findUnique: async () => ({
        processingStatus: "PROCESSED",
        correlationId: "correlation-1",
      }),
    },
  });

  const result = await service.acceptEgovCallback({
    callbackId: "callback-1",
    providerSessionId: "provider-session-1",
    correlationId: "correlation-1",
    status: "SIGNED",
  });

  assert.deepEqual(result, {
    accepted: true,
    replayed: true,
    correlationId: "correlation-1",
  });
});

test("expired session is terminal before any signature can complete", async () => {
  const expiredSession = {
    id: "session-expired",
    organizationId: "company-1",
    provider: "EGOV_MOBILE_QR_PROVIDER",
    status: "QR_GENERATED",
    documentType: "BRIEFING_JOURNAL_ENTRY",
    documentId: "briefing-1",
    documentHash: "a".repeat(64),
    hashAlgorithm: "SHA-256",
    providerPublicJson: {
      qrUrl: "dsj-egov-mock://sign/provider-session-1",
      localSimulation: true,
    },
    expiresAt: new Date(Date.now() - 1_000),
    completedAt: null,
    cancelledAt: null,
    failureReason: null,
    correlationId: "correlation-1",
    evidence: [],
    signatures: [],
  };
  const service = createService({
    signingSession: {
      findUnique: async () => expiredSession,
      update: async () => ({
        ...expiredSession,
        status: "EXPIRED",
        failureReason: "Сессия подписания истекла.",
      }),
    },
  });

  const result = await service.getSession(user, "session-expired");

  assert.equal(result.status, "EXPIRED");
  assert.equal(result.verification.signatureId, null);
});

function verifiedSignature(overrides: Record<string, unknown> = {}) {
  const signedAt = new Date();

  return {
    provider: "EGOV_MOBILE_QR_PROVIDER",
    signerName: "Айгерим Садыкова",
    signerIin: "980317350011",
    certificateSerial: "CERT-000001",
    certificateThumbprint: "THUMBPRINT-1",
    certificateSubject: "CN=Айгерим Садыкова",
    certificateIssuer: "CN=LOCAL TEST CA",
    certificateValidFrom: new Date(signedAt.getTime() - 60_000).toISOString(),
    certificateValidTo: new Date(signedAt.getTime() + 60_000).toISOString(),
    signedAt: signedAt.toISOString(),
    documentHash: "a".repeat(64),
    signaturePayloadHash: "b".repeat(64),
    verificationMode: "LOCAL_SIMULATION",
    source: "EGOV_MOBILE_QR_CALLBACK",
    evidenceReferenceId: "callback-event-1",
    providerPayload: {
      signaturePayloadHash: "b".repeat(64),
      verificationMode: "LOCAL_SIMULATION",
    },
    ...overrides,
  };
}

function employeeSession(overrides: Record<string, unknown> = {}) {
  return {
    id: "session-1",
    organizationId: "company-1",
    documentId: "briefing-1",
    documentEnvelopeId: "envelope-1",
    documentVersionId: "version-1",
    documentHash: "a".repeat(64),
    provider: "EGOV_MOBILE_QR_PROVIDER",
    signerEmployeeId: "employee-1",
    initiatedByUserId: "engineer-1",
    correlationId: "correlation-1",
    ...overrides,
  };
}

test("employee callback rejects an IIN that does not match Employee", async () => {
  const service = createService({
    user: {
      findUnique: async () => ({ ...user, id: user.userId, isActive: true }),
    },
    briefingJournalEntry: {
      findUnique: async () => ({
        id: "briefing-1",
        organizationId: "company-1",
        employeeId: "employee-1",
        status: "SIGNING_READY",
        documentHash: "a".repeat(64),
        openedAt: null,
        acknowledgedAt: null,
        documentEnvelope: {
          id: "envelope-1",
          status: "SIGNING_READY",
          scopeType: "ORGANIZATION",
          currentVersion: {
            id: "version-1",
            status: "FINAL",
            renderedHash: "a".repeat(64),
          },
        },
        signatures: [],
      }),
    },
    employee: {
      findFirst: async () => ({
        id: "employee-1",
        fullName: "Айгерим Садыкова",
        iinEncrypted: encryptSensitiveValue("980317350011"),
      }),
    },
  });

  await assert.rejects(
    () =>
      (service as any).completeBriefingEmployeeSession(
        employeeSession(),
        verifiedSignature({ signerIin: "990101450022" }),
      ),
    (error) => error instanceof BadRequestException && error.message.includes("ИИН"),
  );
});

test("employee callback cannot sign a changed briefing revision", async () => {
  const service = createService({
    user: {
      findUnique: async () => ({ ...user, id: user.userId, isActive: true }),
    },
    briefingJournalEntry: {
      findUnique: async () => ({
        id: "briefing-1",
        organizationId: "company-1",
        employeeId: "employee-1",
        status: "SIGNING_READY",
        documentHash: "c".repeat(64),
        documentEnvelope: {
          id: "envelope-1",
          status: "SIGNING_READY",
          currentVersion: {
            id: "version-1",
            status: "FINAL",
            renderedHash: "c".repeat(64),
          },
        },
        signatures: [],
      }),
    },
    employee: {
      findFirst: async () => ({
        id: "employee-1",
        fullName: "Айгерим Садыкова",
        iinEncrypted: encryptSensitiveValue("980317350011"),
      }),
    },
  });

  await assert.rejects(
    () => (service as any).completeBriefingEmployeeSession(employeeSession(), verifiedSignature()),
    (error) => error instanceof ConflictException && error.message.includes("Версия"),
  );
});

test("successful employee callback creates canonical BRIEFED_EMPLOYEE signature", async () => {
  const state: {
    signatureInput: Record<string, unknown> | null;
    briefingUpdate: Record<string, unknown> | null;
    signingSessionId: string | null;
  } = {
    signatureInput: null,
    briefingUpdate: null,
    signingSessionId: null,
  };
  const prisma = {
    user: {
      findUnique: async () => ({ ...user, id: user.userId, isActive: true }),
    },
    briefingJournalEntry: {
      findUnique: async () => ({
        id: "briefing-1",
        organizationId: "company-1",
        employeeId: "employee-1",
        status: "PARTIALLY_SIGNED",
        documentHash: "a".repeat(64),
        openedAt: null,
        acknowledgedAt: null,
        documentEnvelope: {
          id: "envelope-1",
          status: "SIGNING_READY",
          scopeType: "ORGANIZATION",
          currentVersion: {
            id: "version-1",
            status: "FINAL",
            renderedHash: "a".repeat(64),
          },
        },
        signatures: [
          {
            id: "instructor-signature-1",
            signerRole: "BRIEFING_INSTRUCTOR",
            status: "SIGNED",
          },
        ],
      }),
      update: async ({ data }: { data: Record<string, unknown> }) => {
        state.briefingUpdate = data;
      },
    },
    employee: {
      findFirst: async () => ({
        id: "employee-1",
        fullName: "Айгерим Садыкова",
        iinEncrypted: encryptSensitiveValue("980317350011"),
      }),
    },
    certificateMetadata: {
      upsert: async () => ({ id: "certificate-1" }),
    },
    signature: {
      update: async ({ data }: { data: { signingSessionId: string } }) => {
        state.signingSessionId = data.signingSessionId;
      },
      findUniqueOrThrow: async () => ({
        id: "employee-signature-1",
        provider: "EGOV_MOBILE_QR_PROVIDER",
        signerEmployeeId: "employee-1",
        signerUserId: null,
        signerRole: "BRIEFED_EMPLOYEE",
        verification: { result: "PASS" },
      }),
    },
  };
  const service = new SigningService(
    prisma as never,
    { get: () => undefined } as never,
    { log: async () => undefined } as never,
    {
      createSignature: async (_actor: unknown, input: Record<string, unknown>) => {
        state.signatureInput = input;
        return {
          id: "employee-signature-1",
          signatureHash: "b".repeat(64),
          documentHash: "a".repeat(64),
        };
      },
      ensureRetentionPolicyResolved: async () => ({
        policy: { id: "retention-1" },
      }),
      createArchiveRecord: async () => ({ id: "archive-1" }),
    } as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  );

  const signature = await (service as any).completeBriefingEmployeeSession(
    employeeSession(),
    verifiedSignature(),
  );

  assert.equal(state.signatureInput?.signerEmployeeId, "employee-1");
  assert.equal(state.signatureInput?.signerUserId, null);
  assert.equal(state.signatureInput?.signerRole, "BRIEFED_EMPLOYEE");
  assert.equal(state.signatureInput?.provider, "EGOV_MOBILE_QR_PROVIDER");
  assert.equal(state.briefingUpdate?.status, "SIGNED");
  assert.equal(state.signingSessionId, "session-1");
  assert.equal(signature.id, "employee-signature-1");
});

test("tablet signing is persisted without fake certificate verification", async () => {
  const state: {
    signatureInput: Record<string, unknown> | null;
    signatureUpdate: Record<string, unknown> | null;
    certificateMetadataCalls: number;
  } = {
    signatureInput: null,
    signatureUpdate: null,
    certificateMetadataCalls: 0,
  };
  const transaction = {
    signature: {
      update: async ({ data }: { data: Record<string, unknown> }) => {
        state.signatureUpdate = data;
      },
    },
    documentVersion: { update: async () => undefined },
    documentEnvelope: { update: async () => undefined },
  };
  const prisma = {
    $transaction: async (callback: (client: typeof transaction) => Promise<void>) => callback(transaction),
    user: {
      findUnique: async () => ({ ...user, id: user.userId, isActive: true }),
    },
    briefingJournalEntry: {
      findUnique: async () => ({
        id: "briefing-1",
        organizationId: "company-1",
        employeeId: "employee-1",
        status: "PARTIALLY_SIGNED",
        documentHash: "a".repeat(64),
        openedAt: null,
        acknowledgedAt: null,
        documentEnvelope: {
          id: "envelope-1",
          status: "SIGNING_READY",
          scopeType: "ORGANIZATION",
          currentVersion: {
            id: "version-1",
            status: "FINAL",
            renderedHash: "a".repeat(64),
          },
        },
        signatures: [
          {
            id: "instructor-signature-1",
            signerRole: "BRIEFING_INSTRUCTOR",
            status: "SIGNED",
          },
        ],
      }),
      update: async () => undefined,
    },
    employee: {
      findFirst: async () => ({
        id: "employee-1",
        fullName: "Айгерим Садыкова",
        iinEncrypted: encryptSensitiveValue("980317350011"),
      }),
    },
    certificateMetadata: {
      upsert: async () => {
        state.certificateMetadataCalls += 1;
        return { id: "unexpected-certificate" };
      },
    },
    signature: {
      findUniqueOrThrow: async () => ({
        id: "tablet-signature-1",
        provider: "TABLET_SIGNATURE_PROVIDER",
        verification: null,
      }),
    },
  };
  const service = new SigningService(
    prisma as never,
    { get: () => undefined } as never,
    { log: async () => undefined } as never,
    {
      createSignature: async (_actor: unknown, input: Record<string, unknown>) => {
        state.signatureInput = input;
        return {
          id: "tablet-signature-1",
          signatureHash: "c".repeat(64),
          documentHash: "a".repeat(64),
        };
      },
      ensureRetentionPolicyResolved: async () => ({ policy: { id: "retention-1" } }),
      createArchiveRecord: async () => ({ id: "archive-1" }),
    } as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  );

  const signature = await (service as any).completeBriefingEmployeeSession(
    employeeSession({ provider: "TABLET_SIGNATURE_PROVIDER" }),
    verifiedSignature({
      provider: "TABLET_SIGNATURE_PROVIDER",
      signerName: null,
      signerIin: null,
      certificateSerial: "TABLET-SESSION-1",
      certificateThumbprint: null,
      certificateSubject: null,
      certificateIssuer: null,
      certificateValidFrom: null,
      certificateValidTo: null,
      verificationMode: "IN_PERSON_TABLET_ATTESTATION",
      source: "TABLET_HANDWRITTEN_SIGNATURE",
      evidenceReferenceId: null,
      providerPayload: { rawSignatureRetained: false },
    }),
  );

  assert.equal(state.signatureInput?.provider, "TABLET_SIGNATURE_PROVIDER");
  assert.equal(state.signatureInput?.status, "PREPARED");
  assert.equal(state.signatureUpdate?.status, "SIGNED");
  assert.equal(state.signatureUpdate?.verifiedAt, null);
  assert.equal(state.certificateMetadataCalls, 0);
  assert.equal(signature.verification, null);
});
