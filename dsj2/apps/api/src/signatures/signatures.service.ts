import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { ConfigService } from "@nestjs/config";
import { decryptSensitiveValue, hashInviteToken } from "@dsj/database";
import { resolveSigningRuntimeConfig, type PublicBriefingInvite } from "@dsj/types";
import { AuditService } from "../audit/audit.service";
import type { AuthenticatedUser } from "../common/types/authenticated-user.type";
import { assertCompanyAccess } from "../common/utils/tenant-scope";
import { CorePlatformService } from "../core-platform/core-platform.service";
import { PrismaService } from "../database/prisma.service";
import { EmployeeComplianceService } from "../employees/employee-compliance.service";
import { NotificationsService } from "../notifications/notifications.service";
import { MockSigningProvider } from "./providers/mock-signing.provider";
import { NcalayerSigningProvider } from "./providers/ncalayer-signing.provider";
import { normalizeIin } from "./signing.utils";
import type {
  MockSigningInput,
  NcalayerSigningInput,
  SigningInput,
  SigningResult,
} from "./signing.types";

const canonicalBriefingInclude = {
  documentEnvelope: {
    include: {
      currentVersion: true,
      archiveRecords: {
        orderBy: [{ sealedAt: "desc" }, { createdAt: "desc" }],
        include: {
          retentionPolicy: true,
        },
      },
      signatures: {
        orderBy: [{ signedAt: "asc" }, { createdAt: "asc" }],
        include: {
          verification: true,
        },
      },
    },
  },
  signatures: {
    orderBy: [{ signedAt: "asc" }, { createdAt: "asc" }],
    include: {
      verification: true,
    },
  },
} satisfies Prisma.BriefingJournalEntryInclude;

type CanonicalBriefingEntry = Prisma.BriefingJournalEntryGetPayload<{
  include: typeof canonicalBriefingInclude;
}>;

type CanonicalSigningContext = {
  entry: CanonicalBriefingEntry;
  employee: {
    id: string;
    companyId: string;
    fullName: string;
    email: string | null;
    iinEncrypted: string;
    userId: string | null;
  };
  instructor: {
    id: string;
    companyId: string | null;
    fullName: string;
    role: string;
  } | null;
};

type AuthenticatedBriefingRecord = Awaited<ReturnType<SignaturesService["findBriefingRecord"]>>;
type SignableBriefingRecord = {
  id: string;
  companyId: string;
  employeeId: string;
  status: AuthenticatedBriefingRecord["status"];
  openedAt: Date | null;
  acknowledgedAt: Date | null;
  documentHash: string | null;
  employee: {
    fullName: string;
    iinEncrypted: string;
    email?: string | null;
  };
};
type PublicInviteRecord = Awaited<ReturnType<SignaturesService["findPublicInviteRecordByInviteToken"]>>;

const directorDemoEmail = "director@alpina.local";

@Injectable()
export class SignaturesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly notificationsService: NotificationsService,
    private readonly mockSigningProvider: MockSigningProvider,
    private readonly ncalayerSigningProvider: NcalayerSigningProvider,
    private readonly configService: ConfigService,
    private readonly corePlatformService?: CorePlatformService,
    private readonly employeeComplianceService?: EmployeeComplianceService,
  ) {}

  private requireCorePlatform() {
    if (!this.corePlatformService) {
      throw new BadRequestException("Canonical core platform is not available.");
    }

    return this.corePlatformService;
  }

  private getSigningRuntimeConfig() {
    return resolveSigningRuntimeConfig({
      SIGNING_PROVIDER: this.configService.get<string>("SIGNING_PROVIDER"),
      NCALAYER_BRIDGE_URL: this.configService.get<string>("NCALAYER_BRIDGE_URL"),
      NCALAYER_BRIDGE_TIMEOUT_MS: this.configService.get<string>("NCALAYER_BRIDGE_TIMEOUT_MS"),
      SIGNING_TEST_MODE: this.configService.get<string>("SIGNING_TEST_MODE"),
    });
  }

  private isCompletedSignatureStatus(status?: string | null) {
    return status === "SIGNED" || status === "VERIFIED";
  }

  private requireSigningRuntimeConfig() {
    const config = this.getSigningRuntimeConfig();

    if (!config.isConfigured) {
      throw new ServiceUnavailableException(config.configError);
    }

    return config;
  }

  private isPublicMockSigningEnabled() {
    const nodeEnv = (this.configService.get<string>("NODE_ENV") ?? "development")
      .trim()
      .toLowerCase();
    const allowFlag = (this.configService.get<string>("ALLOW_PUBLIC_INVITE_MOCK_SIGNING") ?? "")
      .trim()
      .toLowerCase();

    return (
      nodeEnv !== "production" &&
      (allowFlag === "true" || allowFlag === "1" || allowFlag === "yes")
    );
  }

  private assertPublicMockSigningEnabled() {
    if (!this.isPublicMockSigningEnabled()) {
      throw new ForbiddenException("Public invite mock signing is disabled in this environment.");
    }
  }

  private isMockPayload(input: SigningInput | undefined): input is MockSigningInput {
    return Boolean(input && !("cms" in input));
  }

  private isNcalayerPayload(input: SigningInput | undefined): input is NcalayerSigningInput {
    return Boolean(input && "cms" in input);
  }

  private assertSignatureDigest(record: { documentHash: string | null }) {
    if (!record.documentHash) {
      throw new BadRequestException("A document hash must exist before signing can complete.");
    }
  }

  private assertSignerMatchesEmployee(expectedIinEncrypted: string, signerIin: string) {
    const expected = normalizeIin(decryptSensitiveValue(expectedIinEncrypted));
    const actual = normalizeIin(signerIin);

    if (expected !== actual) {
      throw new BadRequestException("Signer IIN does not match the employee record.");
    }
  }

  private async requireEmployeeAccount(user: AuthenticatedUser) {
    if (user.role !== "EMPLOYEE_SIGNER") {
      throw new ForbiddenException("This action is only available to employee signers.");
    }

    const employee = await this.prisma.employee.findFirst({
      where: {
        userId: user.userId,
        isArchived: false,
      },
      select: {
        id: true,
        companyId: true,
      },
    });

    if (!employee) {
      throw new ForbiddenException("The account is not linked to an employee record.");
    }

    return employee;
  }

  private async findCanonicalBriefingEntry(briefingJournalEntryId: string): Promise<CanonicalSigningContext> {
    const entry = await this.prisma.briefingJournalEntry.findUnique({
      where: { id: briefingJournalEntryId },
      include: canonicalBriefingInclude,
    });

    if (!entry) {
      throw new NotFoundException("Briefing journal entry not found.");
    }

    const [employee, instructor] = await Promise.all([
      this.prisma.employee.findFirst({
        where: {
          id: entry.employeeId,
          companyId: entry.organizationId,
          isArchived: false,
        },
        select: {
          id: true,
          companyId: true,
          fullName: true,
          email: true,
          iinEncrypted: true,
          userId: true,
        },
      }),
      this.prisma.user.findFirst({
        where: {
          id: entry.instructorUserId,
          companyId: entry.organizationId,
        },
        select: {
          id: true,
          companyId: true,
          fullName: true,
          role: true,
        },
      }),
    ]);

    if (!employee) {
      throw new NotFoundException("Employee linked to the briefing entry was not found.");
    }

    return {
      entry,
      employee,
      instructor,
    };
  }

  private async tryFindCanonicalBriefingEntry(briefingJournalEntryId: string) {
    try {
      return await this.findCanonicalBriefingEntry(briefingJournalEntryId);
    } catch (error) {
      if (error instanceof NotFoundException) {
        return null;
      }

      throw error;
    }
  }

  private assertCanonicalAccess(user: AuthenticatedUser, context: CanonicalSigningContext) {
    if (user.role === "EMPLOYEE_SIGNER") {
      if (context.employee.userId !== user.userId) {
        throw new ForbiddenException("You do not have access to this briefing entry.");
      }

      if (context.entry.status === "DRAFT") {
        throw new ForbiddenException("Draft briefing entries cannot be signed by employees.");
      }

      return;
    }

    assertCompanyAccess(user, context.entry.organizationId);
  }

  private assertCanonicalInstructorSigner(user: AuthenticatedUser, context: CanonicalSigningContext) {
    if (user.email.trim().toLowerCase() === directorDemoEmail) {
      throw new ForbiddenException("Director is read-only for briefing signing.");
    }

    if (user.role !== "SUPER_ADMIN" && context.entry.instructorUserId !== user.userId) {
      throw new ForbiddenException("Only the selected instructor can sign this briefing entry.");
    }
  }

  private ensureInstructorCanSign(context: CanonicalSigningContext) {
    this.assertSignatureDigest({
      documentHash:
        context.entry.documentEnvelope?.currentVersion?.renderedHash ?? context.entry.documentHash ?? null,
    });

    if (!context.entry.documentEnvelope?.currentVersion || !context.entry.documentEnvelope) {
      throw new BadRequestException("Briefing entry is not prepared in the canonical document flow.");
    }

    if (!["SIGNING_READY", "PARTIALLY_SIGNED"].includes(context.entry.status)) {
      throw new BadRequestException("Briefing entry must be prepared for instructor signature first.");
    }

    if (
      context.entry.signatures.some(
        (signature) =>
          signature.signerRole === "BRIEFING_INSTRUCTOR" &&
          this.isCompletedSignatureStatus(signature.status),
      )
    ) {
      throw new BadRequestException("Instructor signature is already registered.");
    }
  }

  private ensureEmployeeCanSign(context: CanonicalSigningContext) {
    this.assertSignatureDigest({
      documentHash:
        context.entry.documentEnvelope?.currentVersion?.renderedHash ?? context.entry.documentHash ?? null,
    });

    if (!context.entry.documentEnvelope?.currentVersion || !context.entry.documentEnvelope) {
      throw new BadRequestException("Briefing entry is not prepared in the canonical document flow.");
    }

    const instructorSignature = context.entry.signatures.find(
      (signature) =>
        signature.signerRole === "BRIEFING_INSTRUCTOR" &&
        this.isCompletedSignatureStatus(signature.status),
    );

    if (!instructorSignature) {
      throw new BadRequestException("Employee cannot sign before the instructor signature is present.");
    }

    if (
      context.entry.signatures.some(
        (signature) =>
          signature.signerRole === "BRIEFED_EMPLOYEE" &&
          this.isCompletedSignatureStatus(signature.status),
      )
    ) {
      throw new BadRequestException("Employee signature is already registered.");
    }

    if (!["PARTIALLY_SIGNED", "SIGNING_READY"].includes(context.entry.status)) {
      throw new BadRequestException("Briefing entry is not in a signable state.");
    }
  }

  private assertRecordAccess(user: AuthenticatedUser, record: AuthenticatedBriefingRecord) {
    if (user.role === "EMPLOYEE_SIGNER") {
      if (record.employee.userId !== user.userId) {
        throw new ForbiddenException("You do not have access to this briefing record.");
      }

      if (record.status === "DRAFT") {
        throw new ForbiddenException("Draft briefing records cannot be signed by employees.");
      }

      return;
    }

    assertCompanyAccess(user, record.companyId);
  }

  private ensureLegacySignableState(record: SignableBriefingRecord) {
    this.assertSignatureDigest(record);

    if (record.status === "ARCHIVED") {
      throw new BadRequestException("Archived briefing records cannot be signed.");
    }

    if (record.status === "SIGNED") {
      throw new BadRequestException("This briefing record is already signed.");
    }

    if (record.status !== "READY_FOR_SIGNING") {
      throw new BadRequestException("The briefing record must be prepared for signing first.");
    }
  }

  private resolveSigningResult(args: {
    entityId: string;
    input?: SigningInput;
    documentHash: string;
    expectedIinEncrypted?: string | null;
    mockFallback?: () => Parameters<MockSigningProvider["sign"]>[0];
  }): SigningResult {
    const config = this.requireSigningRuntimeConfig();

    if (config.provider === "NCALAYER") {
      if (!this.isNcalayerPayload(args.input)) {
        throw new BadRequestException("NCALayer signing requires a bridge payload.");
      }

      const result = this.ncalayerSigningProvider.sign({
        entityId: args.entityId,
        entityType: "BRIEFING_RECORD",
        documentHash: args.documentHash,
        ...args.input,
      });

      if (args.expectedIinEncrypted) {
        this.assertSignerMatchesEmployee(args.expectedIinEncrypted, result.signerIin);
      }

      return result;
    }

    if (args.input) {
      if (!this.isMockPayload(args.input)) {
        throw new BadRequestException("Mock signing expects a mock payload.");
      }

      const result = this.mockSigningProvider.sign({
        entityId: args.entityId,
        entityType: "BRIEFING_RECORD",
        documentHash: args.documentHash,
        ...args.input,
      });

      if (args.expectedIinEncrypted) {
        this.assertSignerMatchesEmployee(args.expectedIinEncrypted, result.signerIin);
      }

      return result;
    }

    if (!args.mockFallback) {
      throw new BadRequestException("Mock signing requires explicit signer data for this flow.");
    }

    return this.mockSigningProvider.sign(args.mockFallback());
  }

  private async recalculateEmployees(user: AuthenticatedUser, employeeIds: string[]) {
    if (!this.employeeComplianceService) {
      return;
    }

    const uniqueEmployeeIds = [...new Set(employeeIds.filter(Boolean))];

    await Promise.all(
      uniqueEmployeeIds.map((employeeId) => this.employeeComplianceService!.recalculate(user, employeeId)),
    );
  }

  private resolveLegacySigningResult(args: {
    record: SignableBriefingRecord;
    input?: SigningInput;
    mockFallback?: () => Parameters<MockSigningProvider["sign"]>[0];
  }) {
    const config = this.requireSigningRuntimeConfig();

    if (config.provider === "NCALAYER") {
      if (!this.isNcalayerPayload(args.input)) {
        throw new BadRequestException("NCALayer signing requires a bridge payload.");
      }

      const result = this.ncalayerSigningProvider.sign({
        briefingRecordId: args.record.id,
        entityId: args.record.id,
        entityType: "BRIEFING_RECORD",
        documentHash: args.record.documentHash,
        ...args.input,
      } as never);

      this.assertSignerMatchesEmployee(args.record.employee.iinEncrypted, result.signerIin);
      return result;
    }

    if (args.input) {
      if (!this.isMockPayload(args.input)) {
        throw new BadRequestException("Mock signing expects a mock payload.");
      }

      return this.mockSigningProvider.sign({
        briefingRecordId: args.record.id,
        entityId: args.record.id,
        entityType: "BRIEFING_RECORD",
        documentHash: args.record.documentHash,
        ...args.input,
      } as never);
    }

    if (!args.mockFallback) {
      throw new BadRequestException("Mock signing requires explicit signer data for this flow.");
    }

    return this.mockSigningProvider.sign(args.mockFallback());
  }

  private async completeLegacySignature(args: {
    record: SignableBriefingRecord;
    signerUserId?: string | null;
    result: SigningResult;
    markRegistrationComplete?: boolean;
    ipAddress?: string | null;
    userAgent?: string | null;
  }) {
    this.ensureLegacySignableState(args.record);

    const signature = await this.prisma.signature.create({
      data: {
        companyId: args.record.companyId,
        briefingRecordId: args.record.id,
        signerUserId: args.signerUserId ?? null,
        signerEmployeeId: args.record.employeeId,
        provider: args.result.provider,
        status: args.result.status,
        signerName: args.result.signerName,
        signerIinMasked: args.result.signerIinMasked,
        certificateSerial: args.result.certificateSerial,
        documentHash: args.result.documentHash,
        signedAt: args.result.signedAt,
        ipAddress: args.ipAddress ?? null,
        userAgent: args.userAgent ?? null,
        payload: args.result.payload,
      },
    });

    await this.prisma.briefingRecord.update({
      where: { id: args.record.id },
      data: {
        status: "SIGNED",
        employeeStatus: "SIGNED",
        openedAt: args.record.openedAt ?? args.result.signedAt,
        acknowledgedAt: args.record.acknowledgedAt ?? args.result.signedAt,
        signedAt: args.result.signedAt,
        documentHash: args.result.documentHash,
        registrationCompletedAt: args.markRegistrationComplete ? args.result.signedAt : undefined,
      },
    });

    await this.notificationsService.resolveBriefingReminders(args.record.companyId, args.record.id);

    return {
      ...signature,
      payload: args.result.payload,
    };
  }

  private notImplemented(): never {
    throw new BadRequestException("Canonical signatures service is being rewired.");
  }

  async listForRecord(user: AuthenticatedUser, briefingRecordId: string) {
    const canonical = await this.tryFindCanonicalBriefingEntry(briefingRecordId);

    if (canonical) {
      this.assertCanonicalAccess(user, canonical);
      return canonical.entry.signatures;
    }

    const record = await this.findBriefingRecord(briefingRecordId);
    this.assertRecordAccess(user, record);
    return record.signatures;
  }

  async signBriefingRecord(
    user: AuthenticatedUser,
    briefingRecordId: string,
    input?: SigningInput,
    context?: {
      ipAddress?: string | null;
      userAgent?: string | null;
    },
  ) {
    if (user.role === "EMPLOYEE_SIGNER") {
      return this.employeeSign(user, briefingRecordId, input, context);
    }

    if (user.email.trim().toLowerCase() === directorDemoEmail) {
      throw new ForbiddenException("Director is read-only for briefing signing.");
    }

    const canonical = await this.tryFindCanonicalBriefingEntry(briefingRecordId);

    if (!canonical) {
      const record = await this.findBriefingRecord(briefingRecordId);
      assertCompanyAccess(user, record.companyId);

      const signature = await this.completeLegacySignature({
        record,
        signerUserId: user.userId,
        result: this.resolveLegacySigningResult({
          record,
          input,
        }),
        ipAddress: context?.ipAddress ?? null,
        userAgent: context?.userAgent ?? null,
      });

      await this.auditService.log({
        actorUserId: user.userId,
        companyId: record.companyId,
        briefingRecordId,
        action: "briefing.signed",
        entityType: "BriefingRecord",
        entityId: briefingRecordId,
        metadata: {
          signatureId: signature.id,
          provider: signature.provider,
        },
        ipAddress: context?.ipAddress ?? null,
        userAgent: context?.userAgent ?? null,
      });

      return signature;
    }

    this.assertCanonicalAccess(user, canonical);
    this.assertCanonicalInstructorSigner(user, canonical);
    this.ensureInstructorCanSign(canonical);

    if (this.requireSigningRuntimeConfig().provider !== "NCALAYER") {
      throw new ServiceUnavailableException(
        "Инструктор подписывает инструктаж только через NCALayer на компьютере.",
      );
    }

    const envelope = canonical.entry.documentEnvelope!;
    const currentVersion = envelope.currentVersion!;
    const documentHash = currentVersion.renderedHash ?? canonical.entry.documentHash;

    if (!documentHash) {
      throw new BadRequestException("Signing digest is missing for the canonical briefing entry.");
    }

    const signingResult = this.resolveSigningResult({
      entityId: canonical.entry.id,
      input,
      documentHash,
    });
    const employeeAlreadySigned = canonical.entry.signatures.some(
      (candidate) =>
        candidate.signerRole === "BRIEFED_EMPLOYEE" &&
        this.isCompletedSignatureStatus(candidate.status),
    );

    const signature = await this.requireCorePlatform().createSignature(user, {
      envelopeId: envelope.id,
      versionId: currentVersion.id,
      companyId: canonical.entry.organizationId,
      organizationId: canonical.entry.organizationId,
      briefingJournalEntryId: canonical.entry.id,
      signerUserId: user.userId,
      signerEmployeeId: null,
      signerRole: "BRIEFING_INSTRUCTOR",
      provider: signingResult.provider,
      signerName: signingResult.signerName,
      signerIinMasked: signingResult.signerIinMasked,
      certificateSerial: signingResult.certificateSerial,
      documentHash: signingResult.documentHash,
      signatureHash: null,
      signedAt: signingResult.signedAt.toISOString(),
      status: "SIGNED",
      payload: {
        subjectType: "BRIEFING_JOURNAL_ENTRY",
        subjectId: canonical.entry.id,
        signRole: "BRIEFING_INSTRUCTOR",
        requestContext: {
          ipAddress: context?.ipAddress ?? null,
          userAgent: context?.userAgent ?? null,
        },
        providerPayload: signingResult.payload as Prisma.JsonValue,
      } as Prisma.JsonObject,
      finalizeDocumentOnSign: employeeAlreadySigned,
    });

    if (employeeAlreadySigned) {
      const resolvedRetention = await this.requireCorePlatform().ensureRetentionPolicyResolved(
        user,
        {
          organizationId: canonical.entry.organizationId,
          documentKind: "BRIEFING_JOURNAL_ENTRY",
          scopeType: envelope.scopeType,
          effectiveAt: signingResult.signedAt.toISOString(),
        },
      );

      if (!resolvedRetention) {
        throw new BadRequestException(
          "Retention policy could not be resolved for the briefing entry.",
        );
      }

      const archiveRecord = await this.requireCorePlatform().createArchiveRecord(user, {
        organizationId: canonical.entry.organizationId,
        envelopeId: envelope.id,
        versionId: currentVersion.id,
        retentionPolicyId: resolvedRetention.policy.id,
        status: "SEALED",
        sealedAt: signingResult.signedAt.toISOString(),
        archiveManifestHash: signature.signatureHash ?? signature.documentHash,
        storageUri: null,
      });

      await this.prisma.briefingJournalEntry.update({
        where: { id: canonical.entry.id },
        data: {
          status: "SIGNED",
          finalSignedAt: signingResult.signedAt,
          signedAt: canonical.entry.signedAt ?? signingResult.signedAt,
          employeeStatus: "SIGNED",
          archiveRecordId: archiveRecord.id,
          retentionPolicyId: resolvedRetention.policy.id,
          updatedByUserId: user.userId,
        },
      });
    } else {
      await this.prisma.briefingJournalEntry.update({
        where: { id: canonical.entry.id },
        data: {
          status: "PARTIALLY_SIGNED",
          updatedByUserId: user.userId,
        },
      });
    }

    await this.auditService.log({
      actorUserId: user.userId,
      companyId: canonical.entry.organizationId,
      action: "briefing.entry_instructor_signed",
      entityType: "BriefingJournalEntry",
      entityId: canonical.entry.id,
      metadata: {
        signatureId: signature.id,
        envelopeId: envelope.id,
        completedBothSignatures: employeeAlreadySigned,
      },
      ipAddress: context?.ipAddress ?? null,
      userAgent: context?.userAgent ?? null,
    });

    return {
      ...signature,
      payload: signingResult.payload,
    };
  }

  async mockSign(
    user: AuthenticatedUser,
    briefingRecordId: string,
    input: SigningInput,
    context?: {
      ipAddress?: string | null;
      userAgent?: string | null;
    },
  ) {
    return this.signBriefingRecord(user, briefingRecordId, input, context);
  }

  async employeeSign(
    user: AuthenticatedUser,
    briefingRecordId: string,
    input?: SigningInput,
    context?: {
      ipAddress?: string | null;
      userAgent?: string | null;
    },
  ) {
    const employeeAccount = await this.requireEmployeeAccount(user);
    const canonical = await this.tryFindCanonicalBriefingEntry(briefingRecordId);

    if (!canonical) {
      const record = await this.findBriefingRecord(briefingRecordId);
      this.assertRecordAccess(user, record);

      if (record.employeeId !== employeeAccount.id) {
        throw new ForbiddenException("You do not have access to this briefing record.");
      }

      if (record.status === "SIGNED" || record.employeeStatus === "SIGNED") {
        if (!record.signatures[0]) {
          throw new BadRequestException(
            "The record is marked as signed, but the signature entry is missing.",
          );
        }

        return record.signatures[0];
      }

      if (record.employeeStatus !== "ACKNOWLEDGED") {
        throw new BadRequestException("The employee must acknowledge the briefing before signing.");
      }

      const signature = await this.completeLegacySignature({
        record,
        signerUserId: user.userId,
        markRegistrationComplete: true,
        result: this.resolveLegacySigningResult({
          record,
          input,
          mockFallback: () => ({
            briefingRecordId: record.id,
            entityId: record.id,
            entityType: "BRIEFING_RECORD",
            documentHash: record.documentHash,
            signerName: record.employee.fullName,
            signerIin: decryptSensitiveValue(record.employee.iinEncrypted),
            certificateSerial: `MOCK-ACCOUNT-${record.id.slice(-8).toUpperCase()}`,
          } as never),
        }),
        ipAddress: context?.ipAddress ?? null,
        userAgent: context?.userAgent ?? null,
      });

      await this.auditService.log({
        actorUserId: user.userId,
        companyId: record.companyId,
        briefingRecordId,
        action: "briefing.signed",
        entityType: "BriefingRecord",
        entityId: briefingRecordId,
        metadata: {
          signatureId: signature.id,
          provider: signature.provider,
          employeePortal: true,
        },
        ipAddress: context?.ipAddress ?? null,
        userAgent: context?.userAgent ?? null,
      });

      return signature;
    }

    this.assertCanonicalAccess(user, canonical);

    if (canonical.entry.employeeId !== employeeAccount.id) {
      throw new ForbiddenException("You do not have access to this briefing entry.");
    }

    this.ensureEmployeeCanSign(canonical);

    const envelope = canonical.entry.documentEnvelope!;
    const currentVersion = envelope.currentVersion!;
    const documentHash = currentVersion.renderedHash ?? canonical.entry.documentHash;

    if (!documentHash) {
      throw new BadRequestException("Signing digest is missing for the canonical briefing entry.");
    }

    const signingResult = this.resolveSigningResult({
      entityId: canonical.entry.id,
      input,
      documentHash,
      expectedIinEncrypted: canonical.employee.iinEncrypted,
      mockFallback: () => ({
        entityId: canonical.entry.id,
        entityType: "BRIEFING_RECORD",
        documentHash,
        signerName: canonical.employee.fullName,
        signerIin: decryptSensitiveValue(canonical.employee.iinEncrypted),
        certificateSerial: `MOCK-BRIEFING-${canonical.entry.id.slice(-8).toUpperCase()}`,
      }),
    });

    const signature = await this.requireCorePlatform().createSignature(user, {
      envelopeId: envelope.id,
      versionId: currentVersion.id,
      companyId: canonical.entry.organizationId,
      organizationId: canonical.entry.organizationId,
      briefingJournalEntryId: canonical.entry.id,
      signerUserId: user.userId,
      signerEmployeeId: canonical.employee.id,
      signerRole: "BRIEFED_EMPLOYEE",
      provider: signingResult.provider,
      signerName: signingResult.signerName,
      signerIinMasked: signingResult.signerIinMasked,
      certificateSerial: signingResult.certificateSerial,
      documentHash: signingResult.documentHash,
      signatureHash: null,
      signedAt: signingResult.signedAt.toISOString(),
      status: "SIGNED",
      payload: {
        subjectType: "BRIEFING_JOURNAL_ENTRY",
        subjectId: canonical.entry.id,
        signRole: "BRIEFED_EMPLOYEE",
        requestContext: {
          ipAddress: context?.ipAddress ?? null,
          userAgent: context?.userAgent ?? null,
        },
        providerPayload: signingResult.payload as Prisma.JsonValue,
      } as Prisma.JsonObject,
    });

    const resolvedRetention = await this.requireCorePlatform().ensureRetentionPolicyResolved(user, {
      organizationId: canonical.entry.organizationId,
      documentKind: "BRIEFING_JOURNAL_ENTRY",
      scopeType: envelope.scopeType,
      effectiveAt: signingResult.signedAt.toISOString(),
    });

    if (!resolvedRetention) {
      throw new BadRequestException(
        "Retention policy could not be resolved for the briefing entry.",
      );
    }

    const archiveRecord = await this.requireCorePlatform().createArchiveRecord(user, {
      organizationId: canonical.entry.organizationId,
      envelopeId: envelope.id,
      versionId: currentVersion.id,
      retentionPolicyId: resolvedRetention.policy.id,
      status: "SEALED",
      sealedAt: signingResult.signedAt.toISOString(),
      archiveManifestHash: signature.signatureHash ?? signature.documentHash,
      storageUri: null,
    });

    const evidencePackage = await this.requireCorePlatform().buildEvidencePackage(user, envelope.id);

    await this.requireCorePlatform().createSignatureVerification(user, {
      signatureId: signature.id,
      result: "PASS",
      chainStatus: "VALID",
      revocationStatus: "CLEAR",
      evidenceJson: {
        subjectType: "BRIEFING_JOURNAL_ENTRY",
        subjectId: canonical.entry.id,
        envelopeId: envelope.id,
        versionId: currentVersion.id,
        provider: signature.provider,
        certificateSerial: signature.certificateSerial,
        documentHash: signature.documentHash,
        signatureHash: signature.signatureHash ?? null,
        archiveRecordId: archiveRecord.id,
        archiveManifestHash: archiveRecord.archiveManifestHash,
        retentionPolicyId: resolvedRetention.policy.id,
        retentionCode: resolvedRetention.policy.retentionCode,
        retentionSource: resolvedRetention.source,
        evidencePackage: {
          generatedAt: evidencePackage.generatedAt.toISOString(),
          canonicalStatus: evidencePackage.document.canonicalStatus,
          currentVersionId: evidencePackage.document.currentVersionId ?? null,
          signatureCount: evidencePackage.signatures.length,
          archiveRecordCount: evidencePackage.archiveRecords.length,
          exportSnapshotCount: evidencePackage.exportSnapshots.length,
        },
      } as Prisma.JsonObject,
    });

    const sourceEntry = canonical.entry.replacesEntryId
      ? await this.prisma.briefingJournalEntry.findUnique({
          where: { id: canonical.entry.replacesEntryId },
          select: {
            id: true,
            employeeId: true,
            documentEnvelopeId: true,
          },
        })
      : null;

    await this.prisma.$transaction(async (transaction) => {
      await transaction.briefingJournalEntry.update({
        where: { id: canonical.entry.id },
        data: {
          status: "SIGNED",
          finalSignedAt: signingResult.signedAt,
          signedAt: signingResult.signedAt,
          openedAt: canonical.entry.openedAt ?? signingResult.signedAt,
          acknowledgedAt: canonical.entry.acknowledgedAt ?? signingResult.signedAt,
          employeeStatus: "SIGNED",
          archiveRecordId: archiveRecord.id,
          retentionPolicyId: resolvedRetention.policy.id,
          updatedByUserId: user.userId,
        },
      });

      if (sourceEntry?.documentEnvelopeId) {
        await transaction.briefingJournalEntry.update({
          where: { id: sourceEntry.id },
          data: {
            status: "SUPERSEDED",
            updatedByUserId: user.userId,
          },
        });

        await transaction.documentEnvelope.update({
          where: { id: sourceEntry.documentEnvelopeId },
          data: {
            status: "SUPERSEDED",
          },
        });
      }
    });

    await this.auditService.log({
      actorUserId: user.userId,
      companyId: canonical.entry.organizationId,
      action: "briefing.entry_employee_signed",
      entityType: "BriefingJournalEntry",
      entityId: canonical.entry.id,
      metadata: {
        signatureId: signature.id,
        archiveRecordId: archiveRecord.id,
        archiveRetentionCode: resolvedRetention.policy.retentionCode,
        archiveRetentionSource: resolvedRetention.source,
        replacesEntryId: canonical.entry.replacesEntryId ?? null,
      },
      ipAddress: context?.ipAddress ?? null,
      userAgent: context?.userAgent ?? null,
    });

    if (sourceEntry) {
      await this.auditService.log({
        actorUserId: user.userId,
        companyId: canonical.entry.organizationId,
        action: "briefing.entry_superseded",
        entityType: "BriefingJournalEntry",
        entityId: sourceEntry.id,
        metadata: {
          supersededByEntryId: canonical.entry.id,
        },
      });
    }

    await this.recalculateEmployees(user, [
      canonical.entry.employeeId,
      ...(sourceEntry ? [sourceEntry.employeeId] : []),
    ]);

    return {
      ...signature,
      payload: signingResult.payload,
    };
  }

  async getPublicInvite(_inviteToken: string): Promise<PublicBriefingInvite> {
    const record = await this.findPublicInviteRecordByInviteToken(_inviteToken);

    if (record.inviteTokenExpiresAt && record.inviteTokenExpiresAt.getTime() < Date.now()) {
      throw new BadRequestException("The signing invite has expired.");
    }

    const signingConfig = this.getSigningRuntimeConfig();
    const signingAvailable =
      signingConfig.isConfigured &&
      Boolean(record.documentHash) &&
      record.status !== "SIGNED" &&
      (signingConfig.provider === "NCALAYER" || this.isPublicMockSigningEnabled());

    return {
      documentNumber: record.documentNumber,
      briefingType: record.briefingType,
      briefingDate: record.briefingDate.toISOString(),
      topic: record.topic,
      notes: record.notes,
      status: record.status,
      signingDigest: record.documentHash,
      inviteTokenExpiresAt: record.inviteTokenExpiresAt?.toISOString() ?? null,
      signedAt: record.signedAt?.toISOString() ?? null,
      publicMockSignEnabled: this.isPublicMockSigningEnabled(),
      signingAvailable,
      employee: {
        fullName: record.employee.fullName,
        jobTitle: record.employee.jobTitle,
      },
      instructor: {
        fullName: record.instructor.fullName,
      },
      department: record.department
        ? {
            name: record.department.name,
          }
        : null,
    };
  }

  async signPublicInvite(
    inviteToken: string,
    input: SigningInput,
    context?: {
      ipAddress?: string | null;
      userAgent?: string | null;
    },
  ) {
    const config = this.requireSigningRuntimeConfig();

    if (config.provider === "MOCK_NCALAYER") {
      this.assertPublicMockSigningEnabled();
    }

    const record = await this.findBriefingRecordByInviteToken(inviteToken);

    if (record.inviteTokenExpiresAt && record.inviteTokenExpiresAt.getTime() < Date.now()) {
      throw new BadRequestException("The signing invite has expired.");
    }

    this.assertSignatureDigest(record);

    if (record.status === "SIGNED") {
      throw new BadRequestException("This briefing record is already signed.");
    }

    if (record.status !== "READY_FOR_SIGNING") {
      throw new BadRequestException("The legacy briefing record is not ready for public signing.");
    }

    const signingResult = this.resolveLegacySigningResult({
      record,
      input,
    });

    await this.prisma.signature.create({
      data: {
        companyId: record.companyId,
        briefingRecordId: record.id,
        signerEmployeeId: record.employeeId,
        provider: signingResult.provider,
        status: signingResult.status,
        signerName: signingResult.signerName,
        signerIinMasked: signingResult.signerIinMasked,
        certificateSerial: signingResult.certificateSerial,
        documentHash: signingResult.documentHash,
        signedAt: signingResult.signedAt,
        ipAddress: context?.ipAddress ?? null,
        userAgent: context?.userAgent ?? null,
        payload: signingResult.payload,
      },
    });

    await this.prisma.briefingRecord.update({
      where: { id: record.id },
      data: {
        status: "SIGNED",
        employeeStatus: "SIGNED",
        openedAt: record.openedAt ?? signingResult.signedAt,
        acknowledgedAt: record.acknowledgedAt ?? signingResult.signedAt,
        signedAt: signingResult.signedAt,
        registrationCompletedAt: signingResult.signedAt,
      },
    });

    await this.auditService.log({
      companyId: record.companyId,
      briefingRecordId: record.id,
      action: "briefing.signed",
      entityType: "BriefingRecord",
      entityId: record.id,
      metadata: {
        publicInvite: true,
      },
      ipAddress: context?.ipAddress ?? null,
      userAgent: context?.userAgent ?? null,
    });

    return this.getPublicInvite(inviteToken);
  }

  async publicMockSign(
    inviteToken: string,
    input: SigningInput,
    context?: {
      ipAddress?: string | null;
      userAgent?: string | null;
    },
  ) {
    return this.signPublicInvite(inviteToken, input, context);
  }

  private async findBriefingRecord(_briefingRecordId: string) {
    const record = await this.prisma.briefingRecord.findUnique({
      where: { id: _briefingRecordId },
      include: {
        employee: {
          include: {
            contractorCompany: true,
          },
        },
        instructor: true,
        department: true,
        site: true,
        signatures: {
          orderBy: {
            createdAt: "desc",
          },
        },
      },
    });

    if (!record) {
      throw new NotFoundException("Briefing record not found.");
    }

    return record;
  }

  private async findPublicInviteRecordByInviteToken(_inviteToken: string) {
    const inviteTokenHash = hashInviteToken(_inviteToken);
    const record = await this.prisma.briefingRecord.findFirst({
      where: {
        OR: [{ inviteTokenHash }, { inviteToken: _inviteToken }],
      },
      select: {
        documentNumber: true,
        briefingType: true,
        briefingDate: true,
        topic: true,
        notes: true,
        status: true,
        documentHash: true,
        inviteTokenExpiresAt: true,
        signedAt: true,
        employee: {
          select: {
            fullName: true,
            jobTitle: true,
          },
        },
        instructor: {
          select: {
            fullName: true,
          },
        },
        department: {
          select: {
            name: true,
          },
        },
      },
    });

    if (!record) {
      throw new NotFoundException("Signing invite not found.");
    }

    return record;
  }

  private async findBriefingRecordByInviteToken(inviteToken: string) {
    const inviteTokenHash = hashInviteToken(inviteToken);
    const record = await this.prisma.briefingRecord.findFirst({
      where: {
        OR: [{ inviteTokenHash }, { inviteToken }],
      },
      select: {
        id: true,
        companyId: true,
        employeeId: true,
        status: true,
        openedAt: true,
        acknowledgedAt: true,
        documentHash: true,
        inviteTokenExpiresAt: true,
        employee: {
          select: {
            fullName: true,
            email: true,
            iinEncrypted: true,
          },
        },
      },
    });

    if (!record) {
      throw new NotFoundException("Signing invite not found.");
    }

    return record;
  }
}
