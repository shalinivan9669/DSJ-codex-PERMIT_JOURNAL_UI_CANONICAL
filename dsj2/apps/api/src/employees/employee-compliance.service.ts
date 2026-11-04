import {
  ConflictException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type { EmployeeAdmissionSummary } from "@dsj/types";
import {
  briefingComplianceCodeFromBriefingType,
  evaluateEmployeeAdmissionSummary,
  getEmployeeDocumentLifecycleStatus,
  parsePositionComplianceMatrixPayload,
} from "@dsj/utils";
import { AuditService } from "../audit/audit.service";
import type { AuthenticatedUser } from "../common/types/authenticated-user.type";
import { getCompanyScope } from "../common/utils/tenant-scope";
import { PrismaService } from "../database/prisma.service";

const employeeCardDocumentInclude = Prisma.validator<Prisma.EmployeeDocumentInclude>()({
  documentTypeDefinition: true,
  verifiedByUser: true,
  documentEnvelope: {
    include: {
      currentVersion: true,
      signatures: {
        orderBy: [{ signedAt: "desc" }, { createdAt: "desc" }],
        take: 1,
        include: {
          certificateMetadata: true,
          verification: true,
        },
      },
      archiveRecords: {
        orderBy: [{ sealedAt: "desc" }, { createdAt: "desc" }],
        take: 1,
        include: {
          retentionPolicy: true,
        },
      },
    },
  },
});

type ComplianceEmployeeDocument = Prisma.EmployeeDocumentGetPayload<{
  include: typeof employeeCardDocumentInclude;
}>;

const employeeCardProtocolInclude = Prisma.validator<Prisma.ProtocolInclude>()({
  department: true,
  workSite: true,
  employees: {
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
  },
  commissionMembers: {
    orderBy: [{ role: "asc" }, { sortOrder: "asc" }, { createdAt: "asc" }],
  },
  documentEnvelope: {
    include: {
      currentVersion: true,
      signatures: {
        orderBy: [{ signedAt: "desc" }, { createdAt: "desc" }],
        take: 1,
        include: {
          verification: true,
        },
      },
      archiveRecords: {
        orderBy: [{ sealedAt: "desc" }, { createdAt: "desc" }],
        take: 1,
        include: {
          retentionPolicy: true,
        },
      },
    },
  },
});

type ComplianceProtocol = Prisma.ProtocolGetPayload<{
  include: typeof employeeCardProtocolInclude;
}>;

const employeeCardBriefingInclude = Prisma.validator<Prisma.BriefingJournalEntryInclude>()({
  signatures: {
    orderBy: [{ signedAt: "desc" }, { createdAt: "desc" }],
    take: 1,
    include: {
      verification: true,
    },
  },
  documentEnvelope: {
    include: {
      currentVersion: true,
      signatures: {
        orderBy: [{ signedAt: "desc" }, { createdAt: "desc" }],
        take: 1,
        include: {
          verification: true,
        },
      },
      archiveRecords: {
        orderBy: [{ sealedAt: "desc" }, { createdAt: "desc" }],
        take: 1,
        include: {
          retentionPolicy: true,
        },
      },
    },
  },
});

type ComplianceBriefingEntry = Prisma.BriefingJournalEntryGetPayload<{
  include: typeof employeeCardBriefingInclude;
}>;

@Injectable()
export class EmployeeComplianceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  private toIsoString(value: Date | null | undefined) {
    return value ? value.toISOString() : null;
  }

  private toCanonicalStatus(document: ComplianceEmployeeDocument) {
    const envelope = document.documentEnvelope;

    if (!envelope) {
      return null;
    }

    const effectiveTo = envelope.currentVersion?.effectiveTo;

    if (effectiveTo && effectiveTo.getTime() < Date.now()) {
      return "expired" as const;
    }

    switch (envelope.status) {
      case "DRAFT":
        return "draft" as const;
      case "IN_APPROVAL":
        return "on_approval" as const;
      case "SIGNING_READY":
      case "ACTIVE":
        return "approved" as const;
      case "SIGNED":
        return "signed" as const;
      case "ANNULLED":
        return "annulled" as const;
      case "SUPERSEDED":
      case "ARCHIVED":
        return "replaced" as const;
      default:
        return "draft" as const;
    }
  }

  private isSigned(document: ComplianceEmployeeDocument) {
    return (
      document.documentEnvelope?.status === "SIGNED" ||
      document.documentEnvelope?.currentVersion?.status === "SIGNED"
    );
  }

  private isTerminalCanonicalState(document: ComplianceEmployeeDocument) {
    return (
      document.documentEnvelope?.status === "ANNULLED" ||
      document.documentEnvelope?.status === "SUPERSEDED" ||
      document.documentEnvelope?.status === "ARCHIVED"
    );
  }

  private retentionSource(retentionPolicy: {
    retentionCode: string;
    legalBasis: string;
  } | null) {
    if (!retentionPolicy) {
      return "configured" as const;
    }

    return retentionPolicy.retentionCode === "EMPLOYEE_DOCUMENT_5Y" ||
      retentionPolicy.legalBasis.startsWith("P0 baseline:")
      ? "baseline" as const
      : "configured" as const;
  }

  private hasEvidenceTrail(document: {
    documentEnvelope?: {
      signatures?: Array<unknown>;
      archiveRecords?: Array<unknown>;
    } | null;
  }) {
    return Boolean(
      document.documentEnvelope &&
        ((document.documentEnvelope.signatures?.length ?? 0) > 0 ||
          (document.documentEnvelope.archiveRecords?.length ?? 0) > 0),
    );
  }

  private buildAllowedActions(document: ComplianceEmployeeDocument) {
    const envelope = document.documentEnvelope;
    const currentVersion = envelope?.currentVersion;
    const isSigned = this.isSigned(document);
    const isTerminal = this.isTerminalCanonicalState(document);
    const isReadyForSigning =
      envelope?.status === "SIGNING_READY" && currentVersion?.status === "FINAL";

    return {
      canPrepareSign: Boolean(!isSigned && !isTerminal),
      canSign: Boolean(isReadyForSigning),
      canAnnul: Boolean(envelope && (isSigned || isReadyForSigning) && !isTerminal),
      canReplace: Boolean(isSigned && !isTerminal),
      canDownloadEvidence: this.hasEvidenceTrail(document),
    };
  }

  private protocolRetentionSource(retentionPolicy: {
    retentionCode: string;
    legalBasis: string;
  } | null) {
    if (!retentionPolicy) {
      return "configured" as const;
    }

    return retentionPolicy.retentionCode === "PROTOCOL_10Y" ||
      retentionPolicy.legalBasis.startsWith("P0 baseline:")
      ? "baseline" as const
      : "configured" as const;
  }

  private protocolCanonicalStatus(protocol: ComplianceProtocol) {
    const envelope = protocol.documentEnvelope;

    if (!envelope) {
      return null;
    }

    const effectiveTo = envelope.currentVersion?.effectiveTo;

    if (effectiveTo && effectiveTo.getTime() < Date.now()) {
      return "expired" as const;
    }

    switch (envelope.status) {
      case "DRAFT":
        return "draft" as const;
      case "IN_APPROVAL":
        return "on_approval" as const;
      case "SIGNING_READY":
      case "ACTIVE":
        return "approved" as const;
      case "SIGNED":
        return "signed" as const;
      case "ANNULLED":
        return "annulled" as const;
      case "SUPERSEDED":
      case "ARCHIVED":
        return "replaced" as const;
      default:
        return "draft" as const;
    }
  }

  private isActiveProtocolBasis(protocol: ComplianceProtocol) {
    return protocol.status === "SIGNED";
  }

  private responsibilityOrderRetentionSource(retentionPolicy: {
    retentionCode: string;
    legalBasis: string;
  } | null) {
    if (!retentionPolicy) {
      return "configured" as const;
    }

    return retentionPolicy.retentionCode === "RESPONSIBILITY_ORDER_10Y" ||
      retentionPolicy.legalBasis.startsWith("P1 baseline:") ||
      retentionPolicy.legalBasis.startsWith("P0 baseline:")
      ? "baseline" as const
      : "configured" as const;
  }

  private resolveResponsibilityOrderStatus(args: {
    status: string;
    appointments: Array<{
      effectiveFrom: Date;
      effectiveTo: Date | null;
    }>;
  }) {
    if (
      args.status === "DRAFT" ||
      args.status === "SIGNING_READY" ||
      args.status === "ANNULLED" ||
      args.status === "SUPERSEDED"
    ) {
      return args.status;
    }

    const now = Date.now();
    const hasActiveAppointment = args.appointments.some((appointment) => {
      const starts = appointment.effectiveFrom.getTime();
      const ends = appointment.effectiveTo?.getTime() ?? Number.MAX_SAFE_INTEGER;
      return starts <= now && ends >= now;
    });
    const hasFutureAppointment = args.appointments.some(
      (appointment) => appointment.effectiveFrom.getTime() > now,
    );

    if (hasActiveAppointment) {
      return "ACTIVE" as const;
    }

    if (args.appointments.length > 0 && !hasFutureAppointment) {
      return "EXPIRED" as const;
    }

    return "SIGNED" as const;
  }

  private resolveResponsibilityAppointmentStatus(args: {
    orderStatus: string;
    effectiveFrom: Date;
    effectiveTo: Date | null;
  }) {
    if (args.orderStatus === "ANNULLED" || args.orderStatus === "SUPERSEDED") {
      return {
        active: false,
        derivedStatus: "INACTIVE" as const,
      };
    }

    const now = Date.now();
    const effectiveFrom = args.effectiveFrom.getTime();
    const effectiveTo = args.effectiveTo?.getTime() ?? Number.MAX_SAFE_INTEGER;

    if (effectiveTo < now) {
      return {
        active: false,
        derivedStatus: "EXPIRED" as const,
      };
    }

    if (effectiveFrom > now) {
      return {
        active: false,
        derivedStatus: "INACTIVE" as const,
      };
    }

    return {
      active: true,
      derivedStatus: "ACTIVE" as const,
    };
  }

  private async ensureInstructionDocumentTypes(organizationId: string) {
    const definitions = [
      {
        code: "BRIEFING_INTRODUCTORY",
        name: "Вводный инструктаж",
      },
      {
        code: "BRIEFING_WORKPLACE_PRIMARY",
        name: "Первичный инструктаж на рабочем месте",
      },
      {
        code: "BRIEFING_WORKPLACE_REPEATED",
        name: "Повторный инструктаж на рабочем месте",
      },
      {
        code: "BRIEFING_WORKPLACE_UNSCHEDULED",
        name: "Внеплановый инструктаж на рабочем месте",
      },
      {
        code: "BRIEFING_WORKPLACE_TARGETED",
        name: "Целевой инструктаж на рабочем месте",
      },
    ] as const;

    const initialize = () => this.prisma.$transaction(async (tx) => {
      const company = await tx.company.findUnique({ where: { id: organizationId } });
      if (!company) {
        throw new NotFoundException("Company not found.");
      }

      const existing = await tx.organization.findUnique({ where: { id: organizationId } });
      if (existing && existing.legacyCompanyId !== company.id) {
        throw new ConflictException("Organization does not match the employee's company.");
      }
      if (!existing) {
        // Create only. Never upsert/update a colliding organization owned by another company.
        await tx.organization.create({
          data: {
            id: company.id,
            legacyCompanyId: company.id,
            code: company.bin ? `BIN-${company.bin}` : `LEGACY-${company.id.toUpperCase()}`,
            name: company.name,
            bin: company.bin,
            timezone: company.timezone,
            isActive: company.isActive,
          },
        });
      }

      for (const definition of definitions) {
        await tx.complianceDocumentType.upsert({
          where: {
            organizationId_code: {
              organizationId,
              code: definition.code,
            },
          },
          update: {
            name: definition.name,
            category: "INSTRUCTION",
            requiresExpiry: false,
            requiresVerification: true,
            isActive: true,
          },
          create: {
            organizationId,
            code: definition.code,
            name: definition.name,
            category: "INSTRUCTION",
            requiresExpiry: false,
            requiresVerification: true,
            isActive: true,
          },
        });
      }
    });

    try {
      await initialize();
    } catch (error) {
      // Another request may have created the same organization concurrently.
      // Retry in a new transaction; an unrelated uniqueness collision still fails.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        await initialize();
        return;
      }
      throw error;
    }
  }

  private mapBriefingInstructionDocument(
    briefing: ComplianceBriefingEntry,
    documentTypeId: string | null,
  ) {
    return {
      id: `briefing:${briefing.id}`,
      briefingJournalEntryId: briefing.id,
      documentTypeDefinitionId: documentTypeId,
      title: briefing.topic,
      documentNumber: briefing.registrationNo ?? briefing.topic,
      issueDate: briefing.finalSignedAt ?? briefing.signedAt ?? briefing.briefingDate,
      expiryDate: null,
      status: "ACTIVE",
      verificationStatus: "VERIFIED" as const,
    };
  }

  private mapBriefingEntryForCard(
    briefing: ComplianceBriefingEntry,
    instructorName: string | null,
  ) {
    const latestSignature = briefing.documentEnvelope?.signatures[0] ?? briefing.signatures[0] ?? null;
    const latestArchiveRecord = briefing.documentEnvelope?.archiveRecords[0] ?? null;

    return {
      id: briefing.id,
      registrationNo: briefing.registrationNo,
      journalKind: briefing.journalKind,
      briefingType: briefing.briefingType,
      status: briefing.status,
      briefingDate: briefing.briefingDate,
      topic: briefing.topic,
      notes: briefing.notes,
      finalSignedAt: briefing.finalSignedAt ?? briefing.signedAt ?? null,
      evidenceAvailable: this.hasEvidenceTrail(briefing),
      latestSignature: latestSignature
        ? {
            id: latestSignature.id,
            provider: latestSignature.provider,
            status: latestSignature.status,
            signerName: latestSignature.signerName,
            signerIinMasked: latestSignature.signerIinMasked,
            certificateSerial: latestSignature.certificateSerial,
            signedAt: this.toIsoString(latestSignature.signedAt),
            verifiedAt: this.toIsoString(latestSignature.verification?.checkedAt),
            verificationResult: latestSignature.verification?.result ?? null,
            chainStatus: latestSignature.verification?.chainStatus ?? null,
            revocationStatus: latestSignature.verification?.revocationStatus ?? null,
            signatureHash: latestSignature.signatureHash ?? null,
          }
        : null,
      archiveRecordSummary: latestArchiveRecord
        ? {
            id: latestArchiveRecord.id,
            status: latestArchiveRecord.status,
            sealedAt: this.toIsoString(latestArchiveRecord.sealedAt),
            archivedAt: this.toIsoString(latestArchiveRecord.archivedAt),
            disposalEligibleAt: this.toIsoString(latestArchiveRecord.disposalEligibleAt),
            storageUri: latestArchiveRecord.storageUri ?? null,
            retentionCode: latestArchiveRecord.retentionPolicy.retentionCode,
            retentionSource:
              latestArchiveRecord.retentionPolicy.retentionCode === "JOURNAL_10Y" ||
              latestArchiveRecord.retentionPolicy.legalBasis.startsWith("P1 baseline:")
                ? ("baseline" as const)
                : ("configured" as const),
          }
        : null,
      instructor: instructorName
        ? {
            fullName: instructorName,
          }
        : null,
    };
  }

  private mapSummaryStatusToLegacy(
    status: EmployeeAdmissionSummary["status"],
  ): "DOPUSHEN" | "OGRANICHENNO_DOPUSHEN" | "NE_DOPUSHEN" {
    switch (status) {
      case "admitted":
        return "DOPUSHEN";
      case "limited":
        return "OGRANICHENNO_DOPUSHEN";
      case "blocked":
        return "NE_DOPUSHEN";
    }
  }

  private mapLegacyStatus(
    status: "DOPUSHEN" | "OGRANICHENNO_DOPUSHEN" | "NE_DOPUSHEN",
  ): EmployeeAdmissionSummary["status"] {
    switch (status) {
      case "DOPUSHEN":
        return "admitted";
      case "OGRANICHENNO_DOPUSHEN":
        return "limited";
      case "NE_DOPUSHEN":
        return "blocked";
    }
  }

  private async findEmployeeOrThrow(employeeId: string, companyId: string) {
    const employee = await this.prisma.employee.findFirst({
      where: { id: employeeId, companyId },
      include: {
        department: true,
        site: true,
        position: true,
        contractorCompany: true,
        user: true,
      },
    });

    if (!employee) {
      throw new NotFoundException("Employee not found.");
    }

    return employee;
  }

  private async resolveActiveMatrix(companyId: string, positionId: string | null) {
    if (!positionId) {
      return null;
    }

    const matrices = await this.prisma.jobRequirementMatrix.findMany({
      where: {
        organizationId: companyId,
        positionId,
        currentVersionId: { not: null },
      },
      include: {
        position: true,
        currentVersion: true,
      },
      orderBy: [{ effectiveFrom: "desc" }, { updatedAt: "desc" }],
      take: 10,
    });

    const now = Date.now();
    const activeMatrix =
      matrices.find((matrix) => {
        const matrixEffectiveFrom = matrix.effectiveFrom?.getTime() ?? Number.MIN_SAFE_INTEGER;
        const matrixEffectiveTo = matrix.effectiveTo?.getTime() ?? Number.MAX_SAFE_INTEGER;
        const versionEffectiveFrom =
          matrix.currentVersion?.effectiveFrom?.getTime() ?? Number.MIN_SAFE_INTEGER;
        const versionEffectiveTo =
          matrix.currentVersion?.effectiveTo?.getTime() ?? Number.MAX_SAFE_INTEGER;

        return (
          Boolean(matrix.currentVersion) &&
          (matrix.currentVersion?.status === "ACTIVE" ||
            matrix.currentVersion?.status === "APPROVED") &&
          matrixEffectiveFrom <= now &&
          matrixEffectiveTo >= now &&
          versionEffectiveFrom <= now &&
          versionEffectiveTo >= now
        );
      }) ??
      matrices.find(
        (matrix) =>
          Boolean(matrix.currentVersion) &&
          (matrix.currentVersion?.status === "ACTIVE" ||
            matrix.currentVersion?.status === "APPROVED"),
      ) ??
      null;

    if (!activeMatrix?.currentVersion) {
      return null;
    }

    return activeMatrix;
  }

  private async buildAdmissionState(user: AuthenticatedUser, employeeId: string) {
    const scope = await this.prisma.employee.findUnique({
      where: { id: employeeId },
      select: { companyId: true },
    });
    if (!scope) {
      throw new NotFoundException("Employee not found.");
    }
    getCompanyScope(user, scope.companyId);
    const employee = await this.findEmployeeOrThrow(employeeId, scope.companyId);
    const [documents, protocols, latestEvaluation, matrix, briefings] = await Promise.all([
      this.prisma.employeeDocument.findMany({
        where: { employeeId },
        include: employeeCardDocumentInclude,
        orderBy: [{ issueDate: "desc" }, { createdAt: "desc" }],
      }),
      this.prisma.protocol.findMany({
        where: {
          organizationId: employee.companyId,
          employees: {
            some: {
              employeeId,
            },
          },
        },
        include: employeeCardProtocolInclude,
        orderBy: [{ date: "desc" }, { createdAt: "desc" }],
      }),
      this.prisma.admissionEvaluation.findFirst({
        where: {
          organizationId: employee.companyId,
          employeeId,
        },
        orderBy: { evaluatedAt: "desc" },
      }),
      this.resolveActiveMatrix(employee.companyId, employee.positionId ?? null),
      this.prisma.briefingJournalEntry.findMany({
        where: {
          organizationId: employee.companyId,
          employeeId,
          status: "SIGNED",
        },
        include: employeeCardBriefingInclude,
        orderBy: [{ finalSignedAt: "desc" }, { briefingDate: "desc" }, { createdAt: "desc" }],
      }),
    ]);

    await this.ensureInstructionDocumentTypes(employee.companyId);

    const matrixPayload = matrix?.currentVersion
      ? parsePositionComplianceMatrixPayload(matrix.currentVersion.payloadJson)
      : null;
    const requiredTypeIds = Array.from(
      new Set(
        matrixPayload
          ? [
              ...matrixPayload.requiredDocuments.map((item) => item.documentTypeId),
              ...matrixPayload.requiredTrainings.map((item) => item.documentTypeId),
              ...matrixPayload.requiredInstructions.map((item) => item.documentTypeId),
            ]
          : [],
      ),
    );
    const documentTypeMap = new Map(
      (
        requiredTypeIds.length
          ? await this.prisma.complianceDocumentType.findMany({
              where: {
                organizationId: employee.companyId,
                id: { in: requiredTypeIds },
              },
            })
          : []
      ).map((documentType) => [documentType.id, documentType]),
    );
    const briefingInstructorIds = Array.from(
      new Set(briefings.map((briefing) => briefing.instructorUserId)),
    );
    const briefingInstructorMap = new Map(
      (
        briefingInstructorIds.length
          ? await this.prisma.user.findMany({
              where: {
                companyId: employee.companyId,
                id: {
                  in: briefingInstructorIds,
                },
              },
              select: {
                id: true,
                fullName: true,
              },
            })
          : []
      ).map((instructor) => [instructor.id, instructor.fullName]),
    );
    const requirements = matrixPayload
      ? [
          ...matrixPayload.requiredDocuments.map((item) => ({
            documentTypeId: item.documentTypeId,
            code:
              documentTypeMap.get(item.documentTypeId)?.code ??
              `missing-${item.documentTypeId}`,
            name:
              documentTypeMap.get(item.documentTypeId)?.name ??
              item.documentTypeId,
            category: "DOCUMENT" as const,
            requiresVerification:
              documentTypeMap.get(item.documentTypeId)?.requiresVerification ?? true,
          })),
          ...matrixPayload.requiredTrainings.map((item) => ({
            documentTypeId: item.documentTypeId,
            code:
              documentTypeMap.get(item.documentTypeId)?.code ??
              `missing-${item.documentTypeId}`,
            name:
              documentTypeMap.get(item.documentTypeId)?.name ??
              item.documentTypeId,
            category: "TRAINING" as const,
            requiresVerification:
              documentTypeMap.get(item.documentTypeId)?.requiresVerification ?? true,
          })),
          ...matrixPayload.requiredInstructions.map((item) => ({
            documentTypeId: item.documentTypeId,
            code:
              documentTypeMap.get(item.documentTypeId)?.code ??
              `missing-${item.documentTypeId}`,
            name:
              documentTypeMap.get(item.documentTypeId)?.name ??
              item.documentTypeId,
            category: "INSTRUCTION" as const,
            requiresVerification:
              documentTypeMap.get(item.documentTypeId)?.requiresVerification ?? true,
          })),
        ]
      : [];
    const briefingEvidenceDocuments = briefings.map((briefing) =>
      this.mapBriefingInstructionDocument(
        briefing,
        (
          [...documentTypeMap.values()].find(
            (documentType) =>
              documentType.category === "INSTRUCTION" &&
              documentType.code === briefingComplianceCodeFromBriefingType(briefing.briefingType),
          ) ?? null
        )?.id ?? null,
      ),
    );

    const summary = evaluateEmployeeAdmissionSummary({
      checkedAt: new Date(),
      hasPosition: Boolean(employee.positionId),
      matrixId: matrix?.id ?? null,
      matrixVersionId: matrix?.currentVersionId ?? null,
      requirements,
      documents: [
        ...documents
          .filter((document) => !this.isTerminalCanonicalState(document))
          .map((document) => ({
            id: document.id,
            documentTypeDefinitionId: document.documentTypeDefinitionId,
            title: document.title,
            documentNumber: document.documentNumber,
            issueDate: document.issueDate,
            expiryDate: document.expiryDate,
            status: document.status,
            verificationStatus: document.verificationStatus,
          })),
        ...briefingEvidenceDocuments,
      ],
      protocols: protocols.map((protocol) => ({
        id: protocol.id,
        number: protocol.number,
        status: protocol.status,
        signedAt: protocol.signedAt,
      })),
    });
    const requiredInstructionTypeIds = new Set(
      requirements
        .filter((requirement) => requirement.category === "INSTRUCTION")
        .map((requirement) => requirement.documentTypeId),
    );
    const effectiveBriefingEntry =
      briefings.find((briefing) => {
        const mappedDocument = briefingEvidenceDocuments.find(
          (candidate) => candidate.briefingJournalEntryId === briefing.id,
        );

        return Boolean(
          mappedDocument?.documentTypeDefinitionId &&
            requiredInstructionTypeIds.has(mappedDocument.documentTypeDefinitionId),
        );
      }) ?? null;

    const mappedDocuments = documents.map((document) => {
      const latestSignature = document.documentEnvelope?.signatures[0] ?? null;
      const latestArchiveRecord = document.documentEnvelope?.archiveRecords[0] ?? null;
      const evidenceAvailable = this.hasEvidenceTrail(document);

      return {
        id: document.id,
        title: document.title,
        documentNumber: document.documentNumber,
        documentType: document.documentType,
        issueDate: document.issueDate,
        expiryDate: document.expiryDate,
        issuerName: document.issuerName,
        status: getEmployeeDocumentLifecycleStatus({
          status: document.status,
          expiryDate: document.expiryDate,
        }),
        verificationStatus: document.verificationStatus,
        verifiedAt: document.verifiedAt,
        verificationNotes: document.verificationNotes,
        fileName: document.fileName,
        fileUrl: document.fileUrl,
        documentEnvelopeId: document.documentEnvelopeId,
        canonicalStatus: this.toCanonicalStatus(document),
        documentEnvelopeStatus: document.documentEnvelope?.status ?? null,
        documentVersionId: document.documentEnvelope?.currentVersionId ?? null,
        documentVersionStatus: document.documentEnvelope?.currentVersion?.status ?? null,
        currentVersionNo: document.documentEnvelope?.currentVersion?.versionNo ?? null,
        signingDigest: document.documentEnvelope?.currentVersion?.renderedHash ?? null,
        isSigned: this.isSigned(document),
        signedAt: this.toIsoString(document.documentEnvelope?.currentVersion?.signedAt ?? null),
        annulledAt: this.toIsoString(document.documentEnvelope?.currentVersion?.annulledAt ?? null),
        evidenceAvailable,
        latestSignature: latestSignature
          ? {
              id: latestSignature.id,
              provider: latestSignature.provider,
              status: latestSignature.status,
              signerName: latestSignature.signerName,
              signerIinMasked: latestSignature.signerIinMasked,
              certificateSerial: latestSignature.certificateSerial,
              signedAt: this.toIsoString(latestSignature.signedAt),
              verifiedAt: this.toIsoString(latestSignature.verification?.checkedAt),
              verificationResult: latestSignature.verification?.result ?? null,
              chainStatus: latestSignature.verification?.chainStatus ?? null,
              revocationStatus: latestSignature.verification?.revocationStatus ?? null,
              signatureHash: latestSignature.signatureHash ?? null,
            }
          : null,
        archiveRecordSummary: latestArchiveRecord
          ? {
              id: latestArchiveRecord.id,
              status: latestArchiveRecord.status,
              sealedAt: this.toIsoString(latestArchiveRecord.sealedAt),
              archivedAt: this.toIsoString(latestArchiveRecord.archivedAt),
              disposalEligibleAt: this.toIsoString(latestArchiveRecord.disposalEligibleAt),
              storageUri: latestArchiveRecord.storageUri ?? null,
              retentionCode: latestArchiveRecord.retentionPolicy.retentionCode,
              retentionSource: this.retentionSource(latestArchiveRecord.retentionPolicy),
            }
          : null,
        allowedActions: this.buildAllowedActions(document),
        documentTypeDefinition: document.documentTypeDefinition
          ? {
              id: document.documentTypeDefinition.id,
              code: document.documentTypeDefinition.code,
              name: document.documentTypeDefinition.name,
              category: document.documentTypeDefinition.category,
              requiresExpiry: document.documentTypeDefinition.requiresExpiry,
              requiresVerification:
                document.documentTypeDefinition.requiresVerification,
            }
          : null,
        verifiedByUser: document.verifiedByUser
          ? {
              id: document.verifiedByUser.id,
              fullName: document.verifiedByUser.fullName,
            }
          : null,
      };
    });
    const mappedBriefings = briefings.map((briefing) =>
      this.mapBriefingEntryForCard(
        briefing,
        briefingInstructorMap.get(briefing.instructorUserId) ?? null,
      ),
    );

    const activeProtocol =
      protocols.find((protocol) => this.isActiveProtocolBasis(protocol)) ?? null;

    const mappedProtocols = protocols.map((protocol) => {
      const latestSignature = protocol.documentEnvelope?.signatures[0] ?? null;
      const latestArchiveRecord = protocol.documentEnvelope?.archiveRecords[0] ?? null;

      return {
        id: protocol.id,
        number: protocol.number,
        date: protocol.date,
        protocolType: protocol.protocolType,
        basis: protocol.basis,
        status: protocol.status,
        decision: protocol.decision,
        notes: protocol.notes,
        department: protocol.department,
        workSite: protocol.workSite,
        documentEnvelopeId: protocol.documentEnvelopeId,
        canonicalStatus: this.protocolCanonicalStatus(protocol),
        currentVersionId: protocol.currentVersionId,
        currentVersionNo:
          protocol.currentVersionNo ?? protocol.documentEnvelope?.currentVersion?.versionNo ?? null,
        signedAt: protocol.signedAt,
        evidenceAvailable:
          (protocol.documentEnvelope?.signatures.length ?? 0) > 0 ||
          (protocol.documentEnvelope?.archiveRecords.length ?? 0) > 0,
        latestSignature: latestSignature
          ? {
              id: latestSignature.id,
              provider: latestSignature.provider,
              status: latestSignature.status,
              signerName: latestSignature.signerName,
              signerIinMasked: latestSignature.signerIinMasked,
              certificateSerial: latestSignature.certificateSerial,
              signedAt: this.toIsoString(latestSignature.signedAt),
              verifiedAt: this.toIsoString(latestSignature.verification?.checkedAt),
              verificationResult: latestSignature.verification?.result ?? null,
              chainStatus: latestSignature.verification?.chainStatus ?? null,
              revocationStatus: latestSignature.verification?.revocationStatus ?? null,
              signatureHash: latestSignature.signatureHash ?? null,
            }
          : null,
        archiveRecordSummary: latestArchiveRecord
          ? {
              id: latestArchiveRecord.id,
              status: latestArchiveRecord.status,
              sealedAt: this.toIsoString(latestArchiveRecord.sealedAt),
              archivedAt: this.toIsoString(latestArchiveRecord.archivedAt),
              disposalEligibleAt: this.toIsoString(latestArchiveRecord.disposalEligibleAt),
              storageUri: latestArchiveRecord.storageUri ?? null,
              retentionCode: latestArchiveRecord.retentionPolicy.retentionCode,
              retentionSource: this.protocolRetentionSource(latestArchiveRecord.retentionPolicy),
            }
          : null,
        commission: protocol.commissionMembers.map((member) => ({
          role: member.role,
          fullName: member.fullName,
          jobTitle: member.jobTitle,
        })),
      };
    });

    return {
      employee,
      matrix,
      matrixPayload,
      latestEvaluation,
      summary,
      documents: mappedDocuments,
      briefings: mappedBriefings,
      protocols: mappedProtocols,
      activeProtocol,
      effectiveBriefingEntry,
      requirements,
    };
  }

  async getCard(user: AuthenticatedUser, employeeId: string) {
    const state = await this.buildAdmissionState(user, employeeId);
    getCompanyScope(user, state.employee.companyId);
    const responsibilityAppointments = await this.prisma.responsibilityAppointment.findMany({
      where: {
        organizationId: state.employee.companyId,
        employeeId,
        order: {
          status: {
            notIn: ["DRAFT", "SIGNING_READY"],
          },
        },
      },
      include: {
        branch: true,
        department: true,
        workSite: true,
        order: {
          include: {
            branch: true,
            department: true,
            workSite: true,
            appointments: {
              select: {
                effectiveFrom: true,
                effectiveTo: true,
              },
            },
            documentEnvelope: {
              include: {
                signatures: {
                  orderBy: [{ signedAt: "desc" }, { createdAt: "desc" }],
                  take: 1,
                },
                archiveRecords: {
                  orderBy: [{ sealedAt: "desc" }, { createdAt: "desc" }],
                  take: 1,
                  include: {
                    retentionPolicy: true,
                  },
                },
              },
            },
          },
        },
      },
      orderBy: [{ effectiveFrom: "desc" }, { createdAt: "desc" }],
    });

    return {
      employee: {
        id: state.employee.id,
        companyId: state.employee.companyId,
        departmentId: state.employee.departmentId,
        siteId: state.employee.siteId,
        positionId: state.employee.positionId,
        fullName: state.employee.fullName,
        employeeNumber: state.employee.employeeNumber,
        jobTitle: state.employee.jobTitle,
        jobTitleKz: state.employee.jobTitleKz,
        email: state.employee.email,
        phone: state.employee.phone,
        employeeKind: state.employee.employeeKind,
        status: state.employee.status,
        department: state.employee.department,
        site: state.employee.site,
        position: state.employee.position,
        contractorCompany: state.employee.contractorCompany,
        hasAccount: Boolean(state.employee.userId),
        accountEmail: state.employee.user?.email ?? null,
      },
      documents: state.documents,
      briefings: state.briefings,
      protocols: state.protocols,
      matrix: state.matrix && state.matrix.currentVersion && state.matrixPayload
        ? {
            id: state.matrix.id,
            matrixCode: state.matrix.matrixCode,
            positionId: state.matrix.positionId,
            position: state.matrix.position,
            currentVersionId: state.matrix.currentVersionId,
            currentVersionNo: state.matrix.currentVersion.versionNo,
            payload: state.matrixPayload,
          }
        : null,
      admission: state.summary,
      latestEvaluation: state.latestEvaluation
        ? {
            id: state.latestEvaluation.id,
            status: this.mapLegacyStatus(state.latestEvaluation.status),
            decisionCode: state.latestEvaluation.decisionCode,
            evaluatedAt: state.latestEvaluation.evaluatedAt,
            nextReviewAt: state.latestEvaluation.nextReviewAt,
            briefingJournalEntryId: state.latestEvaluation.briefingJournalEntryId,
            protocolId: state.latestEvaluation.protocolId,
          }
        : null,
      briefingComplianceImpact: {
        activeBriefingEntryId: state.effectiveBriefingEntry?.id ?? null,
        signedBriefingCount: state.briefings.length,
        instructionRequirementCount: state.requirements.filter(
          (requirement) => requirement.category === "INSTRUCTION",
        ).length,
      },
      responsibilityAppointments: responsibilityAppointments.map((appointment) => {
        const latestArchiveRecord = appointment.order.documentEnvelope?.archiveRecords[0] ?? null;
        const orderStatus = this.resolveResponsibilityOrderStatus({
          status: appointment.order.status,
          appointments: appointment.order.appointments,
        });
        const appointmentStatus = this.resolveResponsibilityAppointmentStatus({
          orderStatus: appointment.order.status,
          effectiveFrom: appointment.effectiveFrom,
          effectiveTo: appointment.effectiveTo ?? null,
        });

        return {
          id: appointment.id,
          orderId: appointment.orderId,
          orderNumber: appointment.order.number,
          orderDate: appointment.order.date,
          orderTitle: appointment.order.title,
          orderBasis: appointment.order.basis,
          orderStatus,
          responsibilityType: appointment.responsibilityType,
          scopeType: appointment.scopeType,
          branch: appointment.branch ?? appointment.order.branch ?? null,
          department: appointment.department ?? appointment.order.department ?? null,
          workSite: appointment.workSite ?? appointment.order.workSite ?? null,
          effectiveFrom: appointment.effectiveFrom,
          effectiveTo: appointment.effectiveTo,
          zoneOfResponsibility: appointment.zoneOfResponsibility,
          roleNotes: appointment.roleNotes,
          active: appointmentStatus.active,
          derivedStatus: appointmentStatus.derivedStatus,
          documentEnvelopeId: appointment.order.documentEnvelopeId,
          signedAt: appointment.order.signedAt,
          evidenceAvailable:
            (appointment.order.documentEnvelope?.signatures.length ?? 0) > 0 ||
            (appointment.order.documentEnvelope?.archiveRecords.length ?? 0) > 0,
          archiveRecordSummary: latestArchiveRecord
            ? {
                id: latestArchiveRecord.id,
                status: latestArchiveRecord.status,
                sealedAt: this.toIsoString(latestArchiveRecord.sealedAt),
                archivedAt: this.toIsoString(latestArchiveRecord.archivedAt),
                disposalEligibleAt: this.toIsoString(latestArchiveRecord.disposalEligibleAt),
                storageUri: latestArchiveRecord.storageUri ?? null,
                retentionCode: latestArchiveRecord.retentionPolicy.retentionCode,
                retentionSource: this.responsibilityOrderRetentionSource(
                  latestArchiveRecord.retentionPolicy,
                ),
              }
            : null,
        };
      }),
    };
  }

  async recalculate(user: AuthenticatedUser, employeeId: string) {
    const state = await this.buildAdmissionState(user, employeeId);
    getCompanyScope(user, state.employee.companyId);

    const nextReviewAt =
      state.documents
        .map((document) => document.expiryDate)
        .filter((value): value is Date => value instanceof Date)
        .sort((left, right) => left.getTime() - right.getTime())[0] ?? null;

    const evaluation = await this.prisma.admissionEvaluation.create({
      data: {
        organizationId: state.employee.companyId,
        subjectType: "EMPLOYEE",
        subjectId: state.employee.id,
        employeeId: state.employee.id,
        contractorWorkerId: null,
        branchId: null,
        departmentId: state.employee.departmentId,
        workSiteId: null,
        positionId: state.employee.positionId,
        workType: "OTHER",
        matrixId: state.matrix?.id ?? null,
        matrixVersionId: state.matrix?.currentVersionId ?? null,
        trainingPlanVersionId: null,
        briefingJournalEntryId: state.effectiveBriefingEntry?.id ?? null,
        protocolId: state.activeProtocol?.id ?? null,
        workPermitId: null,
        status: this.mapSummaryStatusToLegacy(state.summary.status),
        decisionCode: state.summary.decisionCode,
        ruleVersion: "employee-compliance-p0-v1",
        evaluatedAt: new Date(state.summary.checkedAt),
        nextReviewAt,
        checksJson: state.summary.checks as never,
        warningsJson: state.summary.warnings as never,
        nextActionsJson: state.summary.nextActions as never,
        resultJson: {
          ...state.summary,
          employeeId: state.employee.id,
          positionId: state.employee.positionId,
          briefingJournalEntryId: state.effectiveBriefingEntry?.id ?? null,
          protocolId: state.activeProtocol?.id ?? null,
        } as never,
      },
    });

    await this.auditService.log({
      actorUserId: user.userId,
      companyId: state.employee.companyId,
      action: "admission.recalculated",
      entityType: "AdmissionEvaluation",
      entityId: evaluation.id,
      metadata: {
        employeeId: state.employee.id,
        positionId: state.employee.positionId,
        briefingJournalEntryId: state.effectiveBriefingEntry?.id ?? null,
        protocolId: state.activeProtocol?.id ?? null,
        status: state.summary.status,
        decisionCode: state.summary.decisionCode,
      },
    });

    return {
      id: evaluation.id,
      ...state.summary,
      evaluatedAt: evaluation.evaluatedAt,
      nextReviewAt: evaluation.nextReviewAt,
    };
  }
}
