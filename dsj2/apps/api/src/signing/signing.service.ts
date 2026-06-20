import { randomUUID } from "node:crypto";
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { Prisma } from "@prisma/client";
import type {
  CancelSigningSessionInput,
  CompleteLocalEgovSigningSessionInput,
  CreateSigningSessionInput,
  EgovMobileQrCallbackInput,
  MockSignInput,
  NcalayerBridgeSignature,
  SigningDocumentType,
  SubmitTabletSigningSessionInput,
} from "@dsj/types";
import { decryptSensitiveValue, encryptSensitiveValue, hashSensitiveValue, maskIin } from "@dsj/database";
import { hashDocumentPayload } from "@dsj/utils";
import { AuditService } from "../audit/audit.service";
import { assertOrganizationAccess } from "../common/utils/tenant-scope";
import { parseBoolean } from "../common/utils/security-preflight";
import type { AuthenticatedUser } from "../common/types/authenticated-user.type";
import { CorePlatformService } from "../core-platform/core-platform.service";
import { WorkPermitsService } from "../core-platform/work-permits.service";
import { PrismaService } from "../database/prisma.service";
import { ProtocolsService } from "../protocols/protocols.service";
import { ResponsibilityOrdersService } from "../responsibility-orders/responsibility-orders.service";
import { EmployeeDocumentsService } from "../employee-documents/employee-documents.service";
import { SigningProviderRegistry } from "./signing-provider.registry";
import { EgovMobileQrSigningProvider } from "./providers/egov-mobile-qr-signing.provider";
import type { CompleteSigningSessionInput, ResolvedSigningTarget, SigningRequestContext } from "./signing.types";

const TERMINAL_SESSION_STATUSES = new Set(["COMPLETED", "EXPIRED", "FAILED", "CANCELLED"]);
const BRIEFING_EMPLOYEE_PROVIDERS = new Set([
  "EGOV_MOBILE_QR_PROVIDER",
  "TABLET_SIGNATURE_PROVIDER",
]);

type VerifiedBriefingEmployeeSignature = {
  provider: "EGOV_MOBILE_QR_PROVIDER" | "TABLET_SIGNATURE_PROVIDER";
  signerName: string | null;
  signerIin: string | null;
  certificateSerial: string;
  certificateThumbprint: string | null;
  certificateSubject: string | null;
  certificateIssuer: string | null;
  certificateValidFrom: string | null;
  certificateValidTo: string | null;
  signedAt: string;
  signaturePayloadHash: string;
  verificationMode: string;
  source: "EGOV_MOBILE_QR_CALLBACK" | "TABLET_HANDWRITTEN_SIGNATURE";
  evidenceReferenceId: string | null;
  providerPayload: Prisma.JsonObject;
};

function parsePositiveInt(value: string | undefined, fallback: number) {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function jsonObject(value: Prisma.JsonValue | null | undefined) {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function signatureFormatForProvider(provider: CompleteSigningSessionInput["provider"]) {
  switch (provider) {
    case "NCALAYER_PROVIDER":
      return "CMS";
    case "EGOV_MOBILE_QR_PROVIDER":
      return "EGOV_MOBILE_QR_CALLBACK_JSON";
    case "MOCK_PROVIDER":
      return "MOCK_JSON";
  }
}

@Injectable()
export class SigningService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    private readonly auditService: AuditService,
    private readonly corePlatformService: CorePlatformService,
    private readonly workPermitsService: WorkPermitsService,
    private readonly providerRegistry: SigningProviderRegistry,
    private readonly protocolsService: ProtocolsService,
    private readonly responsibilityOrdersService: ResponsibilityOrdersService,
    private readonly employeeDocumentsService: EmployeeDocumentsService,
    private readonly egovMobileQrProvider: EgovMobileQrSigningProvider,
  ) {}

  private terminal(status: string) {
    return TERMINAL_SESSION_STATUSES.has(status);
  }

  private getTtlSeconds() {
    return parsePositiveInt(this.configService.get<string>("SIGNING_SESSION_TTL_SECONDS"), 300);
  }

  private async findProtocolTarget(user: AuthenticatedUser, documentId: string): Promise<ResolvedSigningTarget> {
    const protocol = await this.prisma.protocol.findUnique({
      where: { id: documentId },
      include: {
        documentEnvelope: {
          include: {
            currentVersion: true,
          },
        },
      },
    });

    if (!protocol) {
      throw new NotFoundException("Protocol not found.");
    }

    assertOrganizationAccess(user, protocol.organizationId);

    const envelope = protocol.documentEnvelope;
    const currentVersion = envelope?.currentVersion;
    const documentHash = currentVersion?.renderedHash ?? null;

    if (!envelope || !currentVersion || !documentHash) {
      throw new BadRequestException("Protocol must be prepared for signing first.");
    }

    return {
      documentType: "PROTOCOL",
      documentId: protocol.id,
      organizationId: protocol.organizationId,
      envelopeId: envelope.id,
      versionId: currentVersion.id,
      documentHash,
      title: `Protocol ${protocol.number}`,
      documentNumber: protocol.number,
      isReadyForSigning:
        protocol.status === "SIGNING_READY" && envelope.status === "SIGNING_READY" && currentVersion.status === "FINAL",
    };
  }

  private async findResponsibilityOrderTarget(
    user: AuthenticatedUser,
    documentId: string,
  ): Promise<ResolvedSigningTarget> {
    const order = await this.prisma.responsibilityOrder.findUnique({
      where: { id: documentId },
      include: {
        documentEnvelope: {
          include: {
            currentVersion: true,
          },
        },
      },
    });

    if (!order) {
      throw new NotFoundException("Responsibility order not found.");
    }

    assertOrganizationAccess(user, order.organizationId);

    const envelope = order.documentEnvelope;
    const currentVersion = envelope?.currentVersion;
    const documentHash = currentVersion?.renderedHash ?? null;

    if (!envelope || !currentVersion || !documentHash) {
      throw new BadRequestException("Responsibility order must be prepared for signing first.");
    }

    return {
      documentType: "RESPONSIBILITY_ORDER",
      documentId: order.id,
      organizationId: order.organizationId,
      envelopeId: envelope.id,
      versionId: currentVersion.id,
      documentHash,
      title: order.title,
      documentNumber: order.number,
      isReadyForSigning:
        order.status === "SIGNING_READY" && envelope.status === "SIGNING_READY" && currentVersion.status === "FINAL",
    };
  }

  private async findEmployeeDocumentTarget(
    user: AuthenticatedUser,
    documentId: string,
  ): Promise<ResolvedSigningTarget> {
    const document = await this.prisma.employeeDocument.findUnique({
      where: { id: documentId },
      include: {
        documentEnvelope: {
          include: {
            currentVersion: true,
          },
        },
        employee: true,
      },
    });

    if (!document) {
      throw new NotFoundException("Employee document not found.");
    }

    assertOrganizationAccess(user, document.companyId);

    if (user.role === "EMPLOYEE_SIGNER" && document.employee.userId !== user.userId) {
      throw new ForbiddenException("Employee document does not belong to the current signer.");
    }

    const envelope = document.documentEnvelope;
    const currentVersion = envelope?.currentVersion;
    const documentHash = currentVersion?.renderedHash ?? null;

    if (!envelope || !currentVersion || !documentHash) {
      throw new BadRequestException("Employee document must be prepared for signing first.");
    }

    return {
      documentType: "EMPLOYEE_DOCUMENT",
      documentId: document.id,
      organizationId: document.companyId,
      envelopeId: envelope.id,
      versionId: currentVersion.id,
      documentHash,
      title: document.title,
      documentNumber: document.documentNumber,
      isReadyForSigning: envelope.status === "SIGNING_READY" && currentVersion.status === "FINAL",
    };
  }

  private async findBriefingJournalEntryTarget(
    user: AuthenticatedUser,
    documentId: string,
  ): Promise<ResolvedSigningTarget> {
    const entry = await this.prisma.briefingJournalEntry.findUnique({
      where: { id: documentId },
      include: {
        documentEnvelope: {
          include: {
            currentVersion: true,
          },
        },
      },
    });

    if (!entry) {
      throw new NotFoundException("Запись инструктажа не найдена.");
    }

    assertOrganizationAccess(user, entry.organizationId);

    const employee = await this.prisma.employee.findFirst({
      where: {
        id: entry.employeeId,
        companyId: entry.organizationId,
        isArchived: false,
      },
      select: {
        id: true,
        fullName: true,
        iinHash: true,
        iinLast4: true,
      },
    });

    if (!employee) {
      throw new BadRequestException("Сотрудник инструктажа не найден в текущей компании.");
    }

    const envelope = entry.documentEnvelope;
    const currentVersion = envelope?.currentVersion;
    const documentHash = currentVersion?.renderedHash ?? entry.documentHash ?? null;

    if (!envelope || !currentVersion || !documentHash) {
      throw new BadRequestException("Сначала подготовьте инструктаж к подписанию.");
    }

    const existingEmployeeSignature = await this.prisma.signature.findFirst({
      where: {
        briefingJournalEntryId: entry.id,
        signerRole: "BRIEFED_EMPLOYEE",
        status: { in: ["SIGNED", "VERIFIED"] },
      },
      select: { id: true },
    });

    return {
      documentType: "BRIEFING_JOURNAL_ENTRY",
      documentId: entry.id,
      organizationId: entry.organizationId,
      envelopeId: envelope.id,
      versionId: currentVersion.id,
      documentHash,
      title: `Инструктаж ${entry.registrationNo ?? `№${entry.entryNo}`}`,
      documentNumber: entry.registrationNo,
      isReadyForSigning:
        !existingEmployeeSignature &&
        ["SIGNING_READY", "PARTIALLY_SIGNED"].includes(entry.status) &&
        envelope.status === "SIGNING_READY" &&
        currentVersion.status === "FINAL",
      signerEmployeeId: employee.id,
      signerEmployeeName: employee.fullName,
      signerIinMasked: `********${employee.iinLast4}`,
      signerIinHash: employee.iinHash,
    };
  }

  async resolveTarget(
    user: AuthenticatedUser,
    documentType: SigningDocumentType,
    documentId: string,
  ): Promise<ResolvedSigningTarget> {
    switch (documentType) {
      case "PROTOCOL":
        return this.findProtocolTarget(user, documentId);
      case "RESPONSIBILITY_ORDER":
        return this.findResponsibilityOrderTarget(user, documentId);
      case "EMPLOYEE_DOCUMENT":
        return this.findEmployeeDocumentTarget(user, documentId);
      case "BRIEFING_JOURNAL_ENTRY":
        return this.findBriefingJournalEntryTarget(user, documentId);
      case "WORK_PERMIT":
        return this.workPermitsService.signingTarget(user, documentId);
      default:
        throw new BadRequestException(`${documentType} is not wired into generic signing sessions yet.`);
    }
  }

  async createSession(user: AuthenticatedUser, input: CreateSigningSessionInput, idempotencyKey?: string | null) {
    const provider = this.providerRegistry.normalizeProvider(input.provider);
    this.providerRegistry.assertProviderEnabled(provider);
    const target = await this.resolveTarget(user, input.documentType, input.documentId);

    if (target.documentType === "BRIEFING_JOURNAL_ENTRY" && !BRIEFING_EMPLOYEE_PROVIDERS.has(provider)) {
      throw new BadRequestException(
        "Сотрудник подписывает инструктаж через eGov Mobile QR или на планшете.",
      );
    }

    if (target.documentType === "BRIEFING_JOURNAL_ENTRY" && input.signerUserId) {
      throw new BadRequestException("Для подписи сотрудника по QR не требуется пользовательский аккаунт.");
    }

    if (!target.isReadyForSigning) {
      throw new ConflictException("Document is not ready for signing.");
    }

    if (idempotencyKey) {
      const existing = await this.prisma.signingSession.findUnique({
        where: {
          organizationId_idempotencyKey: {
            organizationId: target.organizationId,
            idempotencyKey,
          },
        },
        include: {
          evidence: {
            orderBy: { createdAt: "desc" },
            take: 1,
          },
          signatures: {
            orderBy: { createdAt: "desc" },
            take: 1,
            include: { verification: true },
          },
        },
      });

      if (existing) {
        return this.mapSession(existing);
      }
    }

    const now = new Date();
    const expiresAt = new Date(now.getTime() + this.getTtlSeconds() * 1000);
    const id = randomUUID();
    const correlationId = randomUUID();
    const providerSession = await this.providerRegistry.createProviderSession({
      provider,
      target,
      sessionId: id,
      correlationId,
      expiresAt,
    });

    const session = await this.prisma.signingSession.create({
      data: {
        id,
        organizationId: target.organizationId,
        documentType: target.documentType,
        documentId: target.documentId,
        documentEnvelopeId: target.envelopeId,
        documentVersionId: target.versionId,
        signerUserId: target.documentType === "BRIEFING_JOURNAL_ENTRY" ? null : (input.signerUserId ?? user.userId),
        signerEmployeeId: target.signerEmployeeId ?? null,
        initiatedByUserId: user.userId,
        signerIinMasked: target.signerIinMasked ?? null,
        signerIinHash: target.signerIinHash ?? null,
        provider,
        status: providerSession.status,
        providerSessionId: providerSession.providerSessionId,
        documentHash: target.documentHash,
        hashAlgorithm: this.configService.get<string>("SIGNATURE_HASH_ALGORITHM") ?? "SHA-256",
        idempotencyKey: idempotencyKey ?? null,
        providerPublicJson: providerSession.providerPublicJson,
        expiresAt,
        correlationId,
      },
      include: {
        evidence: {
          orderBy: { createdAt: "desc" },
          take: 1,
        },
        signatures: {
          orderBy: { createdAt: "desc" },
          take: 1,
          include: { verification: true },
        },
      },
    });

    await this.prisma.auditLog.create({
      data: {
        companyId: target.organizationId,
        actorUserId: user.userId,
        action: "signing.session.created",
        entityType: "SigningSession",
        entityId: session.id,
        metadata: {
          provider,
          documentType: target.documentType,
          documentId: target.documentId,
          correlationId,
        },
      },
    });

    return this.mapSession(session);
  }

  async getSession(user: AuthenticatedUser, id: string) {
    let session = await this.prisma.signingSession.findUnique({
      where: { id },
      include: {
        evidence: {
          orderBy: { createdAt: "desc" },
          take: 1,
        },
        signatures: {
          orderBy: { createdAt: "desc" },
          take: 1,
          include: { verification: true },
        },
      },
    });

    if (!session) {
      throw new NotFoundException("Signing session not found.");
    }

    assertOrganizationAccess(user, session.organizationId);

    if (!this.terminal(session.status) && session.expiresAt.getTime() <= Date.now()) {
      session = await this.prisma.signingSession.update({
        where: { id: session.id },
        data: {
          status: "EXPIRED",
          failureReason: "Сессия подписания истекла.",
        },
        include: {
          evidence: { orderBy: { createdAt: "desc" }, take: 1 },
          signatures: {
            orderBy: { createdAt: "desc" },
            take: 1,
            include: { verification: true },
          },
        },
      });
    }

    return this.mapSession(session);
  }

  async cancelSession(user: AuthenticatedUser, id: string, input: CancelSigningSessionInput) {
    const session = await this.prisma.signingSession.findUnique({
      where: { id },
    });

    if (!session) {
      throw new NotFoundException("Signing session not found.");
    }

    assertOrganizationAccess(user, session.organizationId);

    if (this.terminal(session.status)) {
      throw new ConflictException("Terminal signing sessions cannot be cancelled.");
    }

    const updated = await this.prisma.signingSession.update({
      where: { id },
      data: {
        status: "CANCELLED",
        cancelledAt: new Date(),
        failureReason: input.reason ?? null,
      },
      include: {
        evidence: { orderBy: { createdAt: "desc" }, take: 1 },
        signatures: {
          orderBy: { createdAt: "desc" },
          take: 1,
          include: { verification: true },
        },
      },
    });

    await this.prisma.auditLog.create({
      data: {
        companyId: session.organizationId,
        actorUserId: user.userId,
        action: "signing.session.cancelled",
        entityType: "SigningSession",
        entityId: id,
        metadata: {
          reason: input.reason ?? null,
          correlationId: session.correlationId,
        },
      },
    });

    return this.mapSession(updated);
  }

  async submitMock(user: AuthenticatedUser, id: string, payload: MockSignInput, context?: SigningRequestContext) {
    return this.completeSession(user, id, {
      provider: "MOCK_PROVIDER",
      payload,
      context,
    });
  }

  async submitNcalayer(
    user: AuthenticatedUser,
    id: string,
    payload: NcalayerBridgeSignature,
    context?: SigningRequestContext,
  ) {
    return this.completeSession(user, id, {
      provider: "NCALAYER_PROVIDER",
      payload,
      context,
    });
  }

  async submitTablet(
    user: AuthenticatedUser,
    id: string,
    payload: SubmitTabletSigningSessionInput,
    context?: SigningRequestContext,
  ) {
    const session = await this.prisma.signingSession.findUnique({ where: { id } });

    if (!session) {
      throw new NotFoundException("Сессия подписи на планшете не найдена.");
    }

    assertOrganizationAccess(user, session.organizationId);
    this.providerRegistry.assertProviderEnabled("TABLET_SIGNATURE_PROVIDER");

    if (
      session.provider !== "TABLET_SIGNATURE_PROVIDER" ||
      session.documentType !== "BRIEFING_JOURNAL_ENTRY"
    ) {
      throw new BadRequestException("Сессия не предназначена для подписи сотрудника на планшете.");
    }

    if (this.terminal(session.status)) {
      if (session.status === "COMPLETED") {
        return this.getSession(user, id);
      }

      throw new ConflictException("Завершённая сессия не принимает подпись.");
    }

    if (session.expiresAt.getTime() <= Date.now()) {
      await this.prisma.signingSession.update({
        where: { id },
        data: { status: "EXPIRED", failureReason: "Сессия подписи на планшете истекла." },
      });
      throw new ConflictException("Сессия подписи на планшете истекла.");
    }

    try {
      await this.prisma.signingSession.update({
        where: { id },
        data: { status: "VERIFYING" },
      });
      const signedAt = new Date().toISOString();
      const signaturePayloadHash = hashDocumentPayload(payload.signatureDataUrl);
      const signature = await this.completeBriefingEmployeeSession(session, {
        provider: "TABLET_SIGNATURE_PROVIDER",
        signerName: null,
        signerIin: null,
        certificateSerial: `TABLET-${session.id.slice(0, 16).toUpperCase()}`,
        certificateThumbprint: null,
        certificateSubject: null,
        certificateIssuer: null,
        certificateValidFrom: null,
        certificateValidTo: null,
        signedAt,
        signaturePayloadHash,
        verificationMode: "IN_PERSON_TABLET_ATTESTATION",
        source: "TABLET_HANDWRITTEN_SIGNATURE",
        evidenceReferenceId: null,
        providerPayload: {
          signaturePayloadHash,
          strokeCount: payload.strokeCount,
          confirmed: payload.confirmed,
          rawSignatureRetained: false,
          ipAddress: context?.ipAddress ?? null,
          userAgent: context?.userAgent ?? null,
        },
      });
      const evidence = await this.prisma.signatureEvidence.create({
        data: {
          organizationId: session.organizationId,
          signingSessionId: session.id,
          signatureId: signature.id,
          documentType: session.documentType,
          documentId: session.documentId,
          documentEnvelopeId: session.documentEnvelopeId,
          documentVersionId: session.documentVersionId,
          provider: session.provider,
          documentHash: session.documentHash,
          hashAlgorithm: session.hashAlgorithm,
          signatureFormat: "HANDWRITTEN_SIGNATURE_HASH",
          signaturePayloadLocation: "Raw tablet drawing discarded after hashing",
          signaturePayloadHash,
          certificateSerial: `TABLET-${session.id.slice(0, 16).toUpperCase()}`,
          signedAt: new Date(signedAt),
          verifiedAt: null,
          verificationStatus: "INDETERMINATE",
          redactedProviderResponse: {
            verificationMode: "IN_PERSON_TABLET_ATTESTATION",
            strokeCount: payload.strokeCount,
            rawSignatureRetained: false,
          },
          correlationId: session.correlationId,
        },
      });

      await this.prisma.signingSession.update({
        where: { id },
        data: { status: "COMPLETED", completedAt: new Date(signedAt) },
      });
      await this.prisma.auditLog.create({
        data: {
          companyId: session.organizationId,
          actorUserId: user.userId,
          action: "signing.session.completed",
          entityType: "SigningSession",
          entityId: session.id,
          metadata: {
            signatureId: signature.id,
            evidenceId: evidence.id,
            provider: session.provider,
            correlationId: session.correlationId,
          },
        },
      });

      return this.getSession(user, id);
    } catch (error) {
      await this.prisma.signingSession.updateMany({
        where: { id, status: { notIn: ["COMPLETED", "EXPIRED", "CANCELLED"] } },
        data: {
          status: "FAILED",
          failureReason: error instanceof Error ? error.message : "Подпись на планшете не сохранена.",
        },
      });
      throw error;
    }
  }

  async completeLocalEgov(
    user: AuthenticatedUser,
    id: string,
    _input: CompleteLocalEgovSigningSessionInput,
  ) {
    const localSimulationEnabled =
      this.configService.get<string>("NODE_ENV") !== "production" &&
      parseBoolean(
        this.configService.get<string>("EGOV_MOBILE_QR_ALLOW_LOCAL_CALLBACK_SIMULATION"),
        false,
      );

    if (!localSimulationEnabled) {
      throw new ServiceUnavailableException("Локальная симуляция eGov Mobile отключена.");
    }

    const session = await this.prisma.signingSession.findUnique({ where: { id } });
    if (!session) {
      throw new NotFoundException("Сессия eGov Mobile QR не найдена.");
    }

    assertOrganizationAccess(user, session.organizationId);

    if (session.provider !== "EGOV_MOBILE_QR_PROVIDER" || !session.signerEmployeeId) {
      throw new BadRequestException("Сессия не предназначена для локальной eGov-симуляции.");
    }

    if (session.status === "COMPLETED") {
      return this.getSession(user, id);
    }

    const employee = await this.prisma.employee.findFirst({
      where: {
        id: session.signerEmployeeId,
        companyId: session.organizationId,
        isArchived: false,
      },
      select: { fullName: true, iinEncrypted: true },
    });

    if (!employee) {
      throw new NotFoundException("Сотрудник для eGov-симуляции не найден.");
    }

    const signedAt = new Date();
    const signaturePayload = `LOCAL-EGOV-CMS:${session.id}:${session.documentHash}`;
    await this.acceptEgovCallback(
      {
        callbackId: `local-${randomUUID()}`,
        providerSessionId: session.providerSessionId ?? undefined,
        sessionId: session.id,
        correlationId: session.correlationId,
        status: "SIGNED",
        documentHash: session.documentHash,
        signerName: employee.fullName,
        signerIin: decryptSensitiveValue(employee.iinEncrypted),
        certificateSerial: `LOCAL-EGOV-${session.id.slice(0, 12).toUpperCase()}`,
        certificateThumbprint: hashDocumentPayload(signaturePayload),
        certificateSubject: `CN=${employee.fullName}`,
        certificateIssuer: "CN=DSJ LOCAL EGOV SIMULATION",
        certificateValidFrom: new Date(signedAt.getTime() - 60_000).toISOString(),
        certificateValidTo: new Date(signedAt.getTime() + 3_600_000).toISOString(),
        signedAt: signedAt.toISOString(),
        signaturePayload,
      },
      this.configService.get<string>("EGOV_MOBILE_QR_CALLBACK_SECRET"),
    );

    return this.getSession(user, id);
  }

  private async completeSession(user: AuthenticatedUser, id: string, input: CompleteSigningSessionInput) {
    const session = await this.prisma.signingSession.findUnique({
      where: { id },
    });

    if (!session) {
      throw new NotFoundException("Signing session not found.");
    }

    assertOrganizationAccess(user, session.organizationId);

    if (session.provider !== input.provider) {
      throw new BadRequestException("Signing session provider does not match submit endpoint.");
    }

    if (this.terminal(session.status)) {
      if (session.status === "COMPLETED") {
        return this.getSession(user, id);
      }

      throw new ConflictException("Terminal signing sessions cannot accept signatures.");
    }

    if (session.expiresAt.getTime() <= Date.now()) {
      const expired = await this.prisma.signingSession.update({
        where: { id },
        data: {
          status: "EXPIRED",
          failureReason: "Signing session expired before submit.",
        },
        include: {
          evidence: { orderBy: { createdAt: "desc" }, take: 1 },
          signatures: {
            orderBy: { createdAt: "desc" },
            take: 1,
            include: { verification: true },
          },
        },
      });
      return this.mapSession(expired);
    }

    try {
      await this.prisma.signingSession.update({
        where: { id },
        data: { status: "VERIFYING" },
      });

      await this.signDomainDocument(user, session, input);
      const signature = await this.findCompletedSignature(session, user.userId);

      if (!signature) {
        throw new BadRequestException("Signature was not persisted by the domain signing flow.");
      }

      await this.prisma.signature.update({
        where: { id: signature.id },
        data: { signingSessionId: session.id },
      });

      const signerIin = "payload" in input && "signerIin" in input.payload ? input.payload.signerIin : null;
      const redactedProviderResponse = this.buildRedactedProviderResponse(input, signature);

      const evidence = await this.prisma.signatureEvidence.create({
        data: {
          organizationId: session.organizationId,
          signingSessionId: session.id,
          signatureId: signature.id,
          documentType: session.documentType,
          documentId: session.documentId,
          documentEnvelopeId: session.documentEnvelopeId,
          documentVersionId: session.documentVersionId,
          provider: session.provider,
          documentHash: session.documentHash,
          hashAlgorithm: session.hashAlgorithm,
          signatureFormat: signatureFormatForProvider(input.provider),
          signaturePayloadLocation: "Signature.payload",
          signaturePayloadHash: signature.signatureHash,
          certificateSubject: input.provider === "NCALAYER_PROVIDER" ? input.payload.certificateSubject : null,
          certificateIssuer: input.provider === "NCALAYER_PROVIDER" ? input.payload.certificateIssuer : null,
          certificateSerial: signature.certificateSerial,
          signedAt: signature.signedAt,
          verifiedAt: signature.verifiedAt,
          verificationStatus: signature.verification?.result ?? "PASS",
          redactedProviderResponse: redactedProviderResponse as Prisma.InputJsonValue,
          correlationId: session.correlationId,
        },
      });

      await this.prisma.signingSession.update({
        where: { id: session.id },
        data: {
          status: "COMPLETED",
          completedAt: signature.signedAt ?? new Date(),
          signerIinMasked: signerIin ? maskIin(signerIin) : session.signerIinMasked,
          signerIinHash: signerIin ? hashSensitiveValue(signerIin) : session.signerIinHash,
        },
      });

      await this.prisma.auditLog.create({
        data: {
          companyId: session.organizationId,
          actorUserId: user.userId,
          action: "signing.session.completed",
          entityType: "SigningSession",
          entityId: session.id,
          metadata: {
            signatureId: signature.id,
            evidenceId: evidence.id,
            correlationId: session.correlationId,
          },
        },
      });

      return this.getSession(user, id);
    } catch (error) {
      await this.prisma.signingSession.update({
        where: { id },
        data: {
          status: "FAILED",
          failureReason: error instanceof Error ? error.message : "Signing failed.",
        },
      });
      throw error;
    }
  }

  private async signDomainDocument(
    user: AuthenticatedUser,
    session: {
      id: string;
      organizationId: string;
      documentType: SigningDocumentType;
      documentId: string;
      documentEnvelopeId: string | null;
      documentVersionId: string | null;
      documentHash: string;
      correlationId: string;
    },
    input: CompleteSigningSessionInput,
  ) {
    const payload = input.payload;

    switch (session.documentType) {
      case "PROTOCOL":
        if (input.provider === "MOCK_PROVIDER" || input.provider === "EGOV_MOBILE_QR_PROVIDER") {
          await this.signProtocolDirect(user, session, input.provider, payload as MockSignInput, input.context);
          return;
        }

        await this.protocolsService.sign(user, session.documentId, payload, input.context);
        return;
      case "RESPONSIBILITY_ORDER":
        await this.responsibilityOrdersService.sign(user, session.documentId, payload, input.context);
        return;
      case "EMPLOYEE_DOCUMENT":
        await this.employeeDocumentsService.sign(user, session.documentId, payload, input.context);
        return;
      case "WORK_PERMIT":
        await this.workPermitsService.completeSigning(user, session, input.provider, payload, input.context);
        return;
      default:
        throw new BadRequestException(`${session.documentType} submit is not wired into generic signing sessions yet.`);
    }
  }

  private async signProtocolDirect(
    user: AuthenticatedUser,
    session: {
      id: string;
      organizationId: string;
      documentId: string;
      documentEnvelopeId: string | null;
      documentVersionId: string | null;
      documentHash: string;
      correlationId: string;
    },
    provider: "MOCK_PROVIDER" | "EGOV_MOBILE_QR_PROVIDER",
    payload: MockSignInput,
    context?: SigningRequestContext,
  ) {
    const protocol = await this.prisma.protocol.findUnique({
      where: { id: session.documentId },
      include: {
        documentEnvelope: {
          include: {
            currentVersion: true,
          },
        },
      },
    });

    if (!protocol) {
      throw new NotFoundException("Protocol not found.");
    }

    assertOrganizationAccess(user, protocol.organizationId);

    const envelope = protocol.documentEnvelope;
    const currentVersion = envelope?.currentVersion;

    if (
      !envelope ||
      !currentVersion ||
      envelope.id !== session.documentEnvelopeId ||
      currentVersion.id !== session.documentVersionId ||
      currentVersion.renderedHash !== session.documentHash
    ) {
      throw new BadRequestException("Signing session no longer matches the protocol revision.");
    }

    if (
      protocol.status !== "SIGNING_READY" ||
      envelope.status !== "SIGNING_READY" ||
      currentVersion.status !== "FINAL"
    ) {
      throw new ConflictException("Protocol must be prepared for signing first.");
    }

    const signedAt = new Date();
    const signerIinMasked = maskIin(payload.signerIin);
    const providerPayload = {
      provider,
      signerName: payload.signerName,
      signerIinMasked,
      certificateSerial: payload.certificateSerial,
      signedAt: signedAt.toISOString(),
      documentHash: session.documentHash,
      correlationId: session.correlationId,
    } as Prisma.JsonObject;
    const signaturePayload = {
      subjectType: "PROTOCOL",
      subjectId: protocol.id,
      source: "GENERIC_SIGNING_SESSION",
      signingContext: {
        signingSessionId: session.id,
        protocolId: protocol.id,
        documentNumber: envelope.documentNumber,
        versionId: currentVersion.id,
      },
      requestContext: {
        ipAddress: context?.ipAddress ?? null,
        userAgent: context?.userAgent ?? null,
      },
      providerPayload,
    } as Prisma.JsonObject;
    const signatureHash = hashDocumentPayload(JSON.stringify(providerPayload));

    const signature = await this.corePlatformService.createSignature(user, {
      envelopeId: envelope.id,
      versionId: currentVersion.id,
      companyId: protocol.organizationId,
      organizationId: protocol.organizationId,
      briefingRecordId: null,
      signerUserId: user.userId,
      signerEmployeeId: null,
      signerRole: user.role,
      provider,
      signerName: payload.signerName,
      signerIinMasked,
      certificateSerial: payload.certificateSerial,
      certificateMetadataId: null,
      documentHash: session.documentHash,
      signatureHash,
      signedAt: signedAt.toISOString(),
      status: "SIGNED",
      payload: signaturePayload as never,
    });

    const resolvedRetention = await this.corePlatformService.ensureRetentionPolicyResolved(user, {
      organizationId: protocol.organizationId,
      documentKind: "PROTOCOL",
      scopeType: envelope.scopeType,
      effectiveAt: signedAt.toISOString(),
    });

    if (!resolvedRetention) {
      throw new BadRequestException("Retention policy could not be resolved for the protocol.");
    }

    const archiveRecord = await this.corePlatformService.createArchiveRecord(user, {
      organizationId: protocol.organizationId,
      envelopeId: envelope.id,
      versionId: currentVersion.id,
      retentionPolicyId: resolvedRetention.policy.id,
      status: "SEALED",
      sealedAt: signedAt.toISOString(),
      archiveManifestHash: signature.signatureHash ?? signature.documentHash,
      storageUri: null,
    });

    const evidencePackage = await this.corePlatformService.buildEvidencePackage(user, envelope.id);

    await this.prisma.signatureVerification.update({
      where: { signatureId: signature.id },
      data: {
        checkedAt: new Date(),
        evidenceJson: {
          subjectType: "PROTOCOL",
          subjectId: protocol.id,
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
      },
    });

    await this.prisma.protocol.update({
      where: { id: protocol.id },
      data: {
        status: "SIGNED",
        signedAt,
        archiveRecordId: archiveRecord.id,
        retentionPolicyId: resolvedRetention.policy.id,
        currentVersionId: currentVersion.id,
        currentVersionNo: currentVersion.versionNo,
        updatedByUserId: user.userId,
      },
    });

    await this.auditService.log({
      actorUserId: user.userId,
      companyId: protocol.organizationId,
      action: "protocol.signed",
      entityType: "Protocol",
      entityId: protocol.id,
      metadata: {
        envelopeId: envelope.id,
        signatureId: signature.id,
        archiveRecordId: archiveRecord.id,
        signingSessionId: session.id,
        archiveRetentionCode: resolvedRetention.policy.retentionCode,
        archiveRetentionSource: resolvedRetention.source,
        evidenceSignatureCount: evidencePackage.signatures.length,
        evidenceArchiveRecordCount: evidencePackage.archiveRecords.length,
      },
    });
  }

  private async findCompletedSignature(
    session: {
      documentEnvelopeId: string | null;
      documentVersionId: string | null;
      documentHash: string;
    },
    signerUserId: string,
  ) {
    return this.prisma.signature.findFirst({
      where: {
        documentEnvelopeId: session.documentEnvelopeId,
        documentVersionId: session.documentVersionId,
        documentHash: session.documentHash,
        signerUserId,
      },
      orderBy: { createdAt: "desc" },
      include: { verification: true },
    });
  }

  private buildRedactedProviderResponse(
    input: CompleteSigningSessionInput,
    signature: {
      provider: string;
      certificateSerial: string;
      documentHash: string;
      signatureHash: string | null;
    },
  ) {
    if (input.provider === "NCALAYER_PROVIDER") {
      return {
        provider: input.provider,
        bridgeVersion: input.payload.bridgeVersion ?? null,
        bridgeUrl: input.payload.bridgeUrl ?? null,
        signingDigest: input.payload.signingDigest,
        certificateSerial: input.payload.certificateSerial,
        certificateThumbprint: input.payload.certificateThumbprint,
        certificateSubject: input.payload.certificateSubject,
        certificateIssuer: input.payload.certificateIssuer,
        signedAt: input.payload.signedAt,
        cmsStoredIn: "Signature.payload.providerPayload.cms",
      };
    }

    return {
      provider: input.provider,
      persistedSignatureProvider: signature.provider,
      certificateSerial: signature.certificateSerial,
      documentHash: signature.documentHash,
      signatureHash: signature.signatureHash,
    };
  }

  private callbackKey(input: EgovMobileQrCallbackInput) {
    return hashDocumentPayload(
      JSON.stringify(
        input.callbackId
          ? {
              provider: "EGOV_MOBILE_QR_PROVIDER",
              providerSessionId: input.providerSessionId ?? null,
              callbackId: input.callbackId,
            }
          : {
              providerSessionId: input.providerSessionId ?? null,
              sessionId: input.sessionId ?? null,
              correlationId: input.correlationId ?? null,
              status: input.status ?? null,
              documentHash: input.documentHash ?? null,
              signedAt: input.signedAt ?? null,
              certificateSerial: input.certificateSerial ?? null,
              signaturePayloadHash: input.signaturePayload ? hashDocumentPayload(input.signaturePayload) : null,
            },
      ),
    );
  }

  private async resolveInitiatingUser(userId: string | null): Promise<AuthenticatedUser> {
    if (!userId) {
      throw new BadRequestException("У сессии не указан пользователь, инициировавший подписание.");
    }

    const user = await this.prisma.user.findUnique({ where: { id: userId } });

    if (!user || !user.isActive) {
      throw new BadRequestException("Инициатор сессии больше недоступен.");
    }

    return {
      userId: user.id,
      companyId: user.companyId,
      email: user.email,
      fullName: user.fullName,
      role: user.role,
    };
  }

  private async completeBriefingEmployeeSession(
    session: {
      id: string;
      organizationId: string;
      documentId: string;
      documentEnvelopeId: string | null;
      documentVersionId: string | null;
      documentHash: string;
      provider: string;
      signerEmployeeId: string | null;
      initiatedByUserId: string | null;
      correlationId: string;
    },
    verified: VerifiedBriefingEmployeeSignature,
  ) {
    if (!session.signerEmployeeId) {
      throw new BadRequestException("В сессии не указан сотрудник-подписант.");
    }

    const actor = await this.resolveInitiatingUser(session.initiatedByUserId);
    assertOrganizationAccess(actor, session.organizationId);

    const [entry, employee] = await Promise.all([
      this.prisma.briefingJournalEntry.findUnique({
        where: { id: session.documentId },
        include: {
          documentEnvelope: {
            include: {
              currentVersion: true,
            },
          },
          signatures: {
            where: {
              status: { in: ["SIGNED", "VERIFIED"] },
            },
          },
        },
      }),
      this.prisma.employee.findFirst({
        where: {
          id: session.signerEmployeeId,
          companyId: session.organizationId,
          isArchived: false,
        },
        select: {
          id: true,
          fullName: true,
          iinEncrypted: true,
        },
      }),
    ]);

    if (!entry || entry.organizationId !== session.organizationId) {
      throw new NotFoundException("Запись инструктажа для сессии не найдена.");
    }

    if (!employee || entry.employeeId !== employee.id) {
      throw new BadRequestException("Сотрудник сессии не совпадает с участником инструктажа.");
    }

    const envelope = entry.documentEnvelope;
    const currentVersion = envelope?.currentVersion;

    if (
      !envelope ||
      !currentVersion ||
      envelope.id !== session.documentEnvelopeId ||
      currentVersion.id !== session.documentVersionId ||
      currentVersion.renderedHash !== session.documentHash ||
      entry.documentHash !== session.documentHash
    ) {
      throw new ConflictException("Версия инструктажа изменилась после создания сессии подписи.");
    }

    if (
      !["SIGNING_READY", "PARTIALLY_SIGNED"].includes(entry.status) ||
      envelope.status !== "SIGNING_READY" ||
      currentVersion.status !== "FINAL"
    ) {
      throw new ConflictException("Инструктаж больше не находится в состоянии подписания.");
    }

    if (session.provider !== verified.provider) {
      throw new BadRequestException("Провайдер подписи не совпадает с провайдером сессии.");
    }

    const expectedIin = decryptSensitiveValue(employee.iinEncrypted).replace(/\D/g, "");
    const signerIin = verified.signerIin?.replace(/\D/g, "") ?? expectedIin;
    if (expectedIin !== signerIin) {
      throw new BadRequestException("ИИН сертификата не совпадает с ИИН сотрудника.");
    }

    const existingEmployeeSignature = entry.signatures.find((signature) => signature.signerRole === "BRIEFED_EMPLOYEE");
    if (existingEmployeeSignature) {
      return this.prisma.signature.findUniqueOrThrow({
        where: { id: existingEmployeeSignature.id },
        include: { verification: true },
      });
    }

    const instructorSigned = entry.signatures.some((signature) => signature.signerRole === "BRIEFING_INSTRUCTOR");
    const hasCertificateMetadata = Boolean(
      verified.certificateThumbprint &&
        verified.certificateSubject &&
        verified.certificateIssuer &&
        verified.certificateValidFrom &&
        verified.certificateValidTo,
    );
    const certificateMetadata = hasCertificateMetadata
      ? await this.prisma.certificateMetadata.upsert({
          where: {
            organizationId_serial: {
              organizationId: session.organizationId,
              serial: verified.certificateSerial,
            },
          },
          update: {
            thumbprint: verified.certificateThumbprint!,
            subjectDn: verified.certificateSubject!,
            issuerDn: verified.certificateIssuer!,
            validFrom: new Date(verified.certificateValidFrom!),
            validTo: new Date(verified.certificateValidTo!),
            source: "EGOV_MOBILE_QR_LOCAL_SIMULATION",
          },
          create: {
            organizationId: session.organizationId,
            provider: verified.provider,
            serial: verified.certificateSerial,
            thumbprint: verified.certificateThumbprint!,
            subjectDn: verified.certificateSubject!,
            issuerDn: verified.certificateIssuer!,
            validFrom: new Date(verified.certificateValidFrom!),
            validTo: new Date(verified.certificateValidTo!),
            source: "EGOV_MOBILE_QR_LOCAL_SIMULATION",
            isRevoked: false,
          },
        })
      : null;
    const signedAt = new Date(verified.signedAt);
    const isTabletSignature = verified.provider === "TABLET_SIGNATURE_PROVIDER";
    const signature = await this.corePlatformService.createSignature(actor, {
      envelopeId: envelope.id,
      versionId: currentVersion.id,
      companyId: session.organizationId,
      organizationId: session.organizationId,
      briefingJournalEntryId: entry.id,
      signerUserId: null,
      signerEmployeeId: employee.id,
      signerRole: "BRIEFED_EMPLOYEE",
      provider: verified.provider,
      signerName: verified.signerName ?? employee.fullName,
      signerIinMasked: maskIin(signerIin),
      certificateSerial: verified.certificateSerial,
      certificateMetadataId: certificateMetadata?.id ?? null,
      documentHash: session.documentHash,
      signatureHash: verified.signaturePayloadHash,
      signedAt: verified.signedAt,
      status: isTabletSignature ? "PREPARED" : "SIGNED",
      finalizeDocumentOnSign: isTabletSignature ? false : instructorSigned,
      payload: {
        subjectType: "BRIEFING_JOURNAL_ENTRY",
        subjectId: entry.id,
        signRole: "BRIEFED_EMPLOYEE",
        source: verified.source,
        evidenceReferenceId: verified.evidenceReferenceId,
        correlationId: session.correlationId,
        providerPayload: verified.providerPayload,
      } as Prisma.JsonObject,
    });
    if (isTabletSignature) {
      await this.prisma.$transaction(async (transaction) => {
        await transaction.signature.update({
          where: { id: signature.id },
          data: {
            signingSessionId: session.id,
            status: "SIGNED",
            signedAt,
            verifiedAt: null,
          },
        });

        if (instructorSigned) {
          await transaction.documentVersion.update({
            where: { id: currentVersion.id },
            data: { status: "SIGNED", signedAt },
          });
          await transaction.documentEnvelope.update({
            where: { id: envelope.id },
            data: { currentVersionId: currentVersion.id, status: "SIGNED" },
          });
        }
      });
    } else {
      await this.prisma.signature.update({
        where: { id: signature.id },
        data: { signingSessionId: session.id },
      });
    }

    if (!instructorSigned) {
      await this.prisma.briefingJournalEntry.update({
        where: { id: entry.id },
        data: {
          status: "PARTIALLY_SIGNED",
          employeeStatus: "SIGNED",
          signedAt,
          openedAt: entry.openedAt ?? signedAt,
          acknowledgedAt: entry.acknowledgedAt ?? signedAt,
          updatedByUserId: actor.userId,
        },
      });
    } else {
      const retention = await this.corePlatformService.ensureRetentionPolicyResolved(actor, {
        organizationId: session.organizationId,
        documentKind: "BRIEFING_JOURNAL_ENTRY",
        scopeType: envelope.scopeType,
        effectiveAt: verified.signedAt,
      });

      if (!retention) {
        throw new BadRequestException("Не удалось определить срок хранения инструктажа.");
      }

      const archive = await this.corePlatformService.createArchiveRecord(actor, {
        organizationId: session.organizationId,
        envelopeId: envelope.id,
        versionId: currentVersion.id,
        retentionPolicyId: retention.policy.id,
        status: "SEALED",
        sealedAt: verified.signedAt,
        archiveManifestHash: signature.signatureHash ?? signature.documentHash,
        storageUri: null,
      });

      await this.prisma.briefingJournalEntry.update({
        where: { id: entry.id },
        data: {
          status: "SIGNED",
          employeeStatus: "SIGNED",
          signedAt,
          finalSignedAt: signedAt,
          openedAt: entry.openedAt ?? signedAt,
          acknowledgedAt: entry.acknowledgedAt ?? signedAt,
          archiveRecordId: archive.id,
          retentionPolicyId: retention.policy.id,
          updatedByUserId: actor.userId,
        },
      });
    }

    await this.auditService.log({
      actorUserId: actor.userId,
      companyId: session.organizationId,
      action:
        verified.provider === "EGOV_MOBILE_QR_PROVIDER"
          ? "briefing.entry_employee_signed_via_egov"
          : "briefing.entry_employee_signed_on_tablet",
      entityType: "BriefingJournalEntry",
      entityId: entry.id,
      metadata: {
        signatureId: signature.id,
        signingSessionId: session.id,
        evidenceReferenceId: verified.evidenceReferenceId,
        employeeId: employee.id,
        provider: verified.provider,
        verificationMode: verified.verificationMode,
      },
    });

    return this.prisma.signature.findUniqueOrThrow({
      where: { id: signature.id },
      include: { verification: true },
    });
  }

  async acceptEgovCallback(input: EgovMobileQrCallbackInput, secret?: string | null) {
    const callbackKey = this.callbackKey(input);
    const existingEvent = await this.prisma.providerCallbackEvent.findUnique({
      where: { callbackKey },
    });

    if (existingEvent) {
      return {
        accepted: existingEvent.processingStatus === "PROCESSED",
        replayed: true,
        correlationId: existingEvent.correlationId,
      };
    }

    const rawPayload = JSON.stringify(input);
    const event = await this.prisma.providerCallbackEvent.create({
      data: {
        provider: "EGOV_MOBILE_QR_PROVIDER",
        providerSessionId: input.providerSessionId ?? null,
        callbackKey,
        validationStatus: "RECEIVED",
        processingStatus: "PENDING",
        redactedPayloadJson: this.redactCallbackPayload(input),
        rawPayloadEncrypted: encryptSensitiveValue(rawPayload),
        rawPayloadHash: hashDocumentPayload(rawPayload),
        correlationId: input.correlationId ?? randomUUID(),
      },
    });
    let matchedSession: { id: string } | null = null;

    try {
      const expectedSecret = this.configService.get<string>("EGOV_MOBILE_QR_CALLBACK_SECRET");
      this.egovMobileQrProvider.assertCallbackAuthorized(secret, expectedSecret);

      const session = await this.findSessionForCallback(input);
      matchedSession = session;
      if (!session || session.provider !== "EGOV_MOBILE_QR_PROVIDER") {
        throw new NotFoundException("Сессия eGov Mobile QR не найдена.");
      }

      await this.prisma.providerCallbackEvent.update({
        where: { id: event.id },
        data: {
          organizationId: session.organizationId,
          signingSessionId: session.id,
          validationStatus: "AUTHENTICATED",
          correlationId: session.correlationId,
        },
      });

      if (input.providerSessionId !== session.providerSessionId || input.correlationId !== session.correlationId) {
        throw new BadRequestException("Callback не соответствует providerSessionId/correlationId.");
      }

      if (session.status === "COMPLETED") {
        await this.prisma.providerCallbackEvent.update({
          where: { id: event.id },
          data: { processingStatus: "PROCESSED", processedAt: new Date() },
        });
        return {
          accepted: true,
          replayed: true,
          correlationId: session.correlationId,
        };
      }

      if (this.terminal(session.status)) {
        throw new ConflictException("Завершённая сессия не принимает callback.");
      }

      if (session.expiresAt.getTime() <= Date.now()) {
        await this.prisma.signingSession.update({
          where: { id: session.id },
          data: {
            status: "EXPIRED",
            failureReason: "Сессия подписания истекла.",
          },
        });
        throw new ConflictException("Сессия подписания истекла.");
      }

      await this.prisma.signingSession.update({
        where: { id: session.id },
        data: { status: "CALLBACK_RECEIVED" },
      });

      if (input.status !== "SIGNED") {
        const status = input.status === "CANCELLED" ? "CANCELLED" : input.status === "EXPIRED" ? "EXPIRED" : "FAILED";
        await this.prisma.signingSession.update({
          where: { id: session.id },
          data: {
            status,
            failureReason:
              input.errorMessage ??
              input.errorCode ??
              (status === "CANCELLED" ? "Подписание отклонено сотрудником." : "Провайдер не завершил подписание."),
          },
        });
      } else {
        await this.prisma.signingSession.update({
          where: { id: session.id },
          data: { status: "VERIFYING" },
        });
        const verified = this.egovMobileQrProvider.verifyCallback({
          callback: input,
          callbackSecret: secret,
          expectedCallbackSecret: expectedSecret,
          expectedProviderSessionId: session.providerSessionId ?? "",
          expectedCorrelationId: session.correlationId,
          expectedDocumentHash: session.documentHash,
        });

        if (session.documentType !== "BRIEFING_JOURNAL_ENTRY") {
          throw new BadRequestException("eGov callback для этого типа документа ещё не подключён.");
        }

        const signature = await this.completeBriefingEmployeeSession(session, {
          provider: "EGOV_MOBILE_QR_PROVIDER",
          signerName: verified.signerName,
          signerIin: verified.signerIin,
          certificateSerial: verified.certificateSerial,
          certificateThumbprint: verified.certificateThumbprint,
          certificateSubject: verified.certificateSubject,
          certificateIssuer: verified.certificateIssuer,
          certificateValidFrom: verified.certificateValidFrom,
          certificateValidTo: verified.certificateValidTo,
          signedAt: verified.signedAt,
          signaturePayloadHash: verified.signaturePayloadHash,
          verificationMode: verified.verificationMode,
          source: "EGOV_MOBILE_QR_CALLBACK",
          evidenceReferenceId: event.id,
          providerPayload: {
            certificateSerial: verified.certificateSerial,
            certificateThumbprint: verified.certificateThumbprint,
            certificateSubject: verified.certificateSubject,
            certificateIssuer: verified.certificateIssuer,
            certificateValidFrom: verified.certificateValidFrom,
            certificateValidTo: verified.certificateValidTo,
            signaturePayloadHash: verified.signaturePayloadHash,
            verificationMode: verified.verificationMode,
          },
        });
        const evidence = await this.prisma.signatureEvidence.create({
          data: {
            organizationId: session.organizationId,
            signingSessionId: session.id,
            signatureId: signature.id,
            documentType: session.documentType,
            documentId: session.documentId,
            documentEnvelopeId: session.documentEnvelopeId,
            documentVersionId: session.documentVersionId,
            provider: session.provider,
            documentHash: session.documentHash,
            hashAlgorithm: session.hashAlgorithm,
            signatureFormat: "CMS_OR_PROVIDER_SIGNATURE",
            signaturePayloadLocation: `ProviderCallbackEvent:${event.id}`,
            signaturePayloadHash: verified.signaturePayloadHash,
            certificateSubject: verified.certificateSubject,
            certificateIssuer: verified.certificateIssuer,
            certificateSerial: verified.certificateSerial,
            signedAt: new Date(verified.signedAt),
            verifiedAt: new Date(),
            verificationStatus: "PASS",
            redactedProviderResponse: {
              certificateSerial: verified.certificateSerial,
              certificateThumbprint: verified.certificateThumbprint,
              verificationMode: verified.verificationMode,
            },
            storageKey: `provider-callback-event:${event.id}`,
            correlationId: session.correlationId,
          },
        });

        await this.prisma.signingSession.update({
          where: { id: session.id },
          data: {
            status: "COMPLETED",
            completedAt: new Date(verified.signedAt),
            signerIinMasked: maskIin(verified.signerIin),
            signerIinHash: hashSensitiveValue(verified.signerIin),
          },
        });

        await this.prisma.auditLog.create({
          data: {
            companyId: session.organizationId,
            actorUserId: session.initiatedByUserId,
            action: "signing.session.completed",
            entityType: "SigningSession",
            entityId: session.id,
            metadata: {
              signatureId: signature.id,
              evidenceId: evidence.id,
              callbackEventId: event.id,
              correlationId: session.correlationId,
            },
          },
        });
      }

      await this.prisma.providerCallbackEvent.update({
        where: { id: event.id },
        data: { processingStatus: "PROCESSED", processedAt: new Date() },
      });

      return {
        accepted: true,
        replayed: false,
        correlationId: session.correlationId,
      };
    } catch (error) {
      if (matchedSession && !(error instanceof UnauthorizedException)) {
        await this.prisma.signingSession.updateMany({
          where: {
            id: matchedSession.id,
            status: {
              in: [
                "CREATED",
                "QR_GENERATED",
                "WAITING_FOR_USER",
                "CALLBACK_RECEIVED",
                "SIGNATURE_RECEIVED",
                "VERIFYING",
              ],
            },
          },
          data: {
            status: "FAILED",
            failureReason: error instanceof Error ? error.message : "Проверка подписи завершилась ошибкой.",
          },
        });
      }

      await this.prisma.providerCallbackEvent.update({
        where: { id: event.id },
        data: {
          validationStatus: error instanceof UnauthorizedException ? "REJECTED" : undefined,
          processingStatus: "FAILED",
          processedAt: new Date(),
          error: error instanceof Error ? error.message : "Callback reconciliation failed.",
        },
      });
      throw error;
    }
  }

  private async findSessionForCallback(input: EgovMobileQrCallbackInput) {
    const allowLocalSessionId =
      this.configService.get<string>("NODE_ENV") !== "production" &&
      parseBoolean(this.configService.get<string>("EGOV_MOBILE_QR_ALLOW_LOCAL_CALLBACK_SIMULATION"), false);

    if (allowLocalSessionId && input.sessionId) {
      return this.prisma.signingSession.findUnique({
        where: { id: input.sessionId },
      });
    }

    if (input.providerSessionId) {
      return this.prisma.signingSession.findFirst({
        where: {
          provider: "EGOV_MOBILE_QR_PROVIDER",
          providerSessionId: input.providerSessionId,
        },
      });
    }

    return null;
  }

  private redactCallbackPayload(input: EgovMobileQrCallbackInput) {
    return {
      callbackId: input.callbackId ?? null,
      providerSessionId: input.providerSessionId ?? null,
      sessionId: input.sessionId ?? null,
      correlationId: input.correlationId ?? null,
      status: input.status ?? null,
      documentHash: input.documentHash ?? null,
      signerName: input.signerName ?? null,
      signerIinMasked: input.signerIin ? maskIin(input.signerIin) : null,
      certificateSerial: input.certificateSerial ?? null,
      certificateThumbprint: input.certificateThumbprint ?? null,
      signedAt: input.signedAt ?? null,
      hasSignaturePayload: Boolean(input.signaturePayload),
      errorCode: input.errorCode ?? null,
      errorMessage: input.errorMessage ?? null,
    };
  }

  async expireOverdueSessions(limit = 100) {
    const sessions = await this.prisma.signingSession.findMany({
      where: {
        status: {
          in: ["CREATED", "QR_GENERATED", "WAITING_FOR_USER", "CALLBACK_RECEIVED", "VERIFYING"],
        },
        expiresAt: {
          lte: new Date(),
        },
      },
      take: limit,
      orderBy: { expiresAt: "asc" },
    });

    for (const session of sessions) {
      await this.prisma.signingSession.updateMany({
        where: {
          id: session.id,
          status: session.status,
        },
        data: {
          status: "EXPIRED",
          failureReason: "Signing session expired.",
        },
      });
    }

    return sessions.length;
  }

  async listDocumentSignatures(user: AuthenticatedUser, documentType: SigningDocumentType, documentId: string) {
    const target = await this.resolveTarget(user, documentType, documentId);
    const signatures = await this.prisma.signature.findMany({
      where: {
        documentEnvelopeId: target.envelopeId,
      },
      orderBy: [{ signedAt: "desc" }, { createdAt: "desc" }],
      include: {
        verification: true,
        evidence: {
          orderBy: { createdAt: "desc" },
          take: 1,
        },
      },
    });

    return {
      documentType,
      documentId,
      signatures: signatures.map((signature) => ({
        id: signature.id,
        provider: signature.provider,
        signerName: signature.signerName,
        signerRole: signature.signerRole,
        certificateSerial: signature.certificateSerial,
        documentHash: signature.documentHash,
        signatureHash: signature.signatureHash,
        signedAt: signature.signedAt?.toISOString() ?? null,
        verifiedAt: signature.verifiedAt?.toISOString() ?? null,
        verificationStatus: signature.verification?.result ?? null,
        evidenceId: signature.evidence[0]?.id ?? null,
      })),
    };
  }

  async getDocumentSigningState(user: AuthenticatedUser, documentType: SigningDocumentType, documentId: string) {
    const target = await this.resolveTarget(user, documentType, documentId);
    const activeSession = await this.prisma.signingSession.findFirst({
      where: {
        organizationId: target.organizationId,
        documentType,
        documentId,
        status: {
          in: ["CREATED", "QR_GENERATED", "WAITING_FOR_USER", "CALLBACK_RECEIVED", "VERIFYING"],
        },
      },
      orderBy: { createdAt: "desc" },
    });
    const signed = await this.prisma.signature.count({
      where: {
        documentEnvelopeId: target.envelopeId,
        status: {
          in: ["SIGNED", "VERIFIED"],
        },
      },
    });

    return {
      documentType,
      documentId,
      state:
        signed > 0
          ? "SIGNED"
          : activeSession
            ? "SIGNING_IN_PROGRESS"
            : target.isReadyForSigning
              ? "READY_FOR_SIGNING"
              : "DRAFT",
      documentHash: target.documentHash,
      requiredSigners: [
        {
          userId: user.userId,
          employeeId: null,
          name: user.fullName,
          role: user.role,
          signed: signed > 0,
        },
      ],
    };
  }

  private mapSession(session: {
    id: string;
    provider: string;
    status: string;
    documentType: string;
    documentId: string;
    documentHash: string;
    hashAlgorithm: string;
    providerPublicJson: Prisma.JsonValue | null;
    expiresAt: Date;
    completedAt: Date | null;
    cancelledAt: Date | null;
    failureReason: string | null;
    correlationId: string;
    evidence?: Array<{
      id: string;
      verificationStatus: string;
    }>;
    signatures?: Array<{
      id: string;
      verification?: { result: string } | null;
    }>;
  }) {
    const providerPublic = jsonObject(session.providerPublicJson);
    const evidence = session.evidence?.[0] ?? null;
    const signature = session.signatures?.[0] ?? null;

    return {
      id: session.id,
      provider: session.provider,
      status: session.status,
      documentType: session.documentType,
      documentId: session.documentId,
      documentHash: session.documentHash,
      hashAlgorithm: session.hashAlgorithm,
      expiresAt: session.expiresAt.toISOString(),
      completedAt: session.completedAt?.toISOString() ?? null,
      cancelledAt: session.cancelledAt?.toISOString() ?? null,
      failureReason: session.failureReason,
      qrUrl: typeof providerPublic.qrUrl === "string" ? providerPublic.qrUrl : null,
      deeplink: typeof providerPublic.deeplink === "string" ? providerPublic.deeplink : null,
      pollAfterMs: typeof providerPublic.pollAfterMs === "number" ? providerPublic.pollAfterMs : 2000,
      correlationId: session.correlationId,
      localSimulation: providerPublic.localSimulation === true,
      verification: {
        status: evidence?.verificationStatus ?? signature?.verification?.result ?? null,
        signatureId: signature?.id ?? null,
        evidenceId: evidence?.id ?? null,
      },
    };
  }
}
