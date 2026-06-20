import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  Optional,
} from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import type {
  AnnulBriefingInput,
  BriefingAllowedActions,
  BriefingFilters,
  BriefingJournalEntry,
  BriefingReadModelStatus,
  BriefingRegistryItem,
  CreateBriefingInput,
  MyBriefingInstruction,
  PrepareBriefingForSigningResponse,
  ReplaceBriefingInput,
  UpdateBriefingInput,
} from "@dsj/types";
import { resolveSigningRuntimeConfig } from "@dsj/types";
import { formatDate, hashDocumentPayload } from "@dsj/utils";
import { AuditService } from "../audit/audit.service";
import type { AuthenticatedUser } from "../common/types/authenticated-user.type";
import {
  assertCompanyAccess,
  getCompanyScope,
  requireCompanyScope,
} from "../common/utils/tenant-scope";
import { CorePlatformService } from "../core-platform/core-platform.service";
import { PrismaService } from "../database/prisma.service";
import { EmployeeComplianceService } from "../employees/employee-compliance.service";
import { NotificationsService } from "../notifications/notifications.service";
import { PdfService } from "../pdf/pdf.service";

const briefingEntryInclude = {
  documentEnvelope: {
    include: {
      currentVersion: true,
      signatures: {
        orderBy: [{ signedAt: "desc" }, { createdAt: "desc" }],
        include: {
          verification: true,
        },
      },
      archiveRecords: {
        orderBy: [{ sealedAt: "desc" }, { createdAt: "desc" }],
        include: {
          retentionPolicy: true,
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

type RawBriefingEntry = Prisma.BriefingJournalEntryGetPayload<{
  include: typeof briefingEntryInclude;
}>;

type EmployeeRef = {
  id: string;
  fullName: string;
  employeeNumber: string;
  jobTitle: string | null;
  departmentId: string | null;
  siteId: string | null;
  companyId: string;
  userId: string | null;
  user: {
    id: string;
    email: string;
    role: string;
    isActive: boolean;
  } | null;
};

type ScopeRefs = {
  employees: Map<string, EmployeeRef>;
  instructors: Map<string, { id: string; fullName: string; role: string }>;
  departments: Map<string, { id: string; code: string | null; name: string }>;
  workSites: Map<string, { id: string; code: string | null; name: string; location: string | null }>;
};

type RequestContext = {
  ipAddress?: string | null;
  userAgent?: string | null;
};

type BriefingPersonaPolicy = {
  key: "director" | "safety-engineer" | "shop-chief" | "admin" | "employee";
  readOnly: boolean;
  allowedBriefingTypes: Array<CreateBriefingInput["briefingType"]>;
  scopeDepartmentId?: string | null;
  scopeSiteId?: string | null;
};

const directorDemoEmail = "director@alpina.local";
const safetyEngineerDemoEmail = "safety.engineer@alpina.local";
const shopChiefDemoEmail = "shop.chief@alpina.local";
const nonPrimaryBriefingTypes: Array<CreateBriefingInput["briefingType"]> = [
  "INTRODUCTORY",
  "REPEATED",
  "UNSCHEDULED",
  "TARGETED",
];
const allBriefingTypes: Array<CreateBriefingInput["briefingType"]> = [
  "INTRODUCTORY",
  "PRIMARY",
  "REPEATED",
  "UNSCHEDULED",
  "TARGETED",
];

function resolveAppUrl() {
  const trimmed = process.env.APP_URL?.trim();

  if (trimmed) {
    return trimmed.replace(/\/+$/, "");
  }

  if (process.env.NODE_ENV === "production") {
    throw new Error("APP_URL is required in production.");
  }

  return "http://localhost:3000";
}

@Injectable()
export class BriefingRecordsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly notificationsService: NotificationsService,
    private readonly pdfService: PdfService,
    @Optional() private readonly corePlatformService?: CorePlatformService,
    @Optional() private readonly employeeComplianceService?: EmployeeComplianceService,
  ) {}

  private requireCorePlatform() {
    if (!this.corePlatformService) {
      throw new BadRequestException("Canonical briefing flow is not available.");
    }

    return this.corePlatformService;
  }

  private getSigningRuntimeConfig() {
    return resolveSigningRuntimeConfig({
      SIGNING_PROVIDER: process.env.SIGNING_PROVIDER,
      NCALAYER_BRIDGE_URL: process.env.NCALAYER_BRIDGE_URL,
      NCALAYER_BRIDGE_TIMEOUT_MS: process.env.NCALAYER_BRIDGE_TIMEOUT_MS,
      SIGNING_TEST_MODE: process.env.SIGNING_TEST_MODE,
    });
  }

  private isCompletedSignatureStatus(status?: string | null) {
    return status === "SIGNED" || status === "VERIFIED";
  }

  private toIsoString(value: Date | null | undefined) {
    return value ? value.toISOString() : null;
  }

  private getInviteUrl(token: string | null) {
    return token ? `${resolveAppUrl()}/invite/${token}` : null;
  }

  private normalizeEmail(value?: string | null) {
    return value?.trim().toLowerCase() ?? "";
  }

  private async resolvePersonaPolicy(user: AuthenticatedUser): Promise<BriefingPersonaPolicy> {
    const email = this.normalizeEmail(user.email);

    if (user.role === "EMPLOYEE_SIGNER") {
      return {
        key: "employee",
        readOnly: false,
        allowedBriefingTypes: [],
      };
    }

    if (email === directorDemoEmail) {
      return {
        key: "director",
        readOnly: true,
        allowedBriefingTypes: [],
      };
    }

    if (email === shopChiefDemoEmail) {
      const shopChief = await this.prisma.user.findUnique({
        where: { id: user.userId },
        select: {
          departmentId: true,
          siteId: true,
        },
      });

      return {
        key: "shop-chief",
        readOnly: false,
        allowedBriefingTypes: ["PRIMARY"],
        scopeDepartmentId: shopChief?.departmentId ?? null,
        scopeSiteId: shopChief?.siteId ?? null,
      };
    }

    if (user.role === "SAFETY_ENGINEER" || email === safetyEngineerDemoEmail) {
      return {
        key: "safety-engineer",
        readOnly: false,
        allowedBriefingTypes: nonPrimaryBriefingTypes,
      };
    }

    return {
      key: "admin",
      readOnly: false,
      allowedBriefingTypes: allBriefingTypes,
    };
  }

  private assertMutablePersona(policy: BriefingPersonaPolicy) {
    if (policy.readOnly || policy.key === "employee") {
      throw new ForbiddenException("This demo persona can view briefing records but cannot mutate them.");
    }
  }

  private employeeMatchesPersonaScope(policy: BriefingPersonaPolicy, employee: EmployeeRef) {
    if (policy.key !== "shop-chief") {
      return true;
    }

    return (
      Boolean(policy.scopeDepartmentId) &&
      Boolean(policy.scopeSiteId) &&
      employee.departmentId === policy.scopeDepartmentId &&
      employee.siteId === policy.scopeSiteId
    );
  }

  private entryMatchesPersonaScope(
    policy: BriefingPersonaPolicy,
    entry: RawBriefingEntry,
    refs?: ScopeRefs,
  ) {
    if (policy.key !== "shop-chief") {
      return true;
    }

    const employee = refs?.employees.get(entry.employeeId);
    const departmentMatches =
      Boolean(policy.scopeDepartmentId) &&
      (entry.departmentId === policy.scopeDepartmentId ||
        employee?.departmentId === policy.scopeDepartmentId);
    const siteMatches =
      Boolean(policy.scopeSiteId) &&
      (entry.workSiteId === policy.scopeSiteId || employee?.siteId === policy.scopeSiteId);

    return departmentMatches && siteMatches;
  }

  private canOperateOnEntry(
    user: AuthenticatedUser,
    policy: BriefingPersonaPolicy,
    entry: RawBriefingEntry,
    refs?: ScopeRefs,
  ) {
    if (policy.readOnly || policy.key === "employee") {
      return false;
    }

    if (!policy.allowedBriefingTypes.includes(entry.briefingType)) {
      return false;
    }

    if (policy.key === "shop-chief" && entry.journalKind !== "WORKPLACE") {
      return false;
    }

    if (!this.entryMatchesPersonaScope(policy, entry, refs)) {
      return false;
    }

    return user.role === "SUPER_ADMIN" || entry.instructorUserId === user.userId;
  }

  private assertCanOperateOnEntry(
    user: AuthenticatedUser,
    policy: BriefingPersonaPolicy,
    entry: RawBriefingEntry,
    refs?: ScopeRefs,
  ) {
    if (!this.canOperateOnEntry(user, policy, entry, refs)) {
      throw new ForbiddenException("This demo persona is not allowed to mutate this briefing entry.");
    }
  }

  private assertCreateInputAllowed(
    user: AuthenticatedUser,
    policy: BriefingPersonaPolicy,
    input: CreateBriefingInput | UpdateBriefingInput,
    employees: EmployeeRef[],
    journalKind: "INTRODUCTORY" | "WORKPLACE",
  ) {
    this.assertMutablePersona(policy);

    const briefingType = input.briefingType;

    if (briefingType && !policy.allowedBriefingTypes.includes(briefingType)) {
      throw new ForbiddenException("This demo persona cannot create this briefing type.");
    }

    if (policy.key === "shop-chief" && journalKind !== "WORKPLACE") {
      throw new ForbiddenException("Shop Chief can create only workplace briefing entries.");
    }

    if (policy.key === "shop-chief" && employees.some((employee) => !this.employeeMatchesPersonaScope(policy, employee))) {
      throw new ForbiddenException("Shop Chief can select only employees from the scoped department and site.");
    }

    if (
      policy.key === "shop-chief" &&
      (input.departmentId && input.departmentId !== policy.scopeDepartmentId)
    ) {
      throw new ForbiddenException("Shop Chief can use only the scoped department.");
    }

    const requestedSiteId = input.workSiteId ?? input.siteId ?? null;

    if (policy.key === "shop-chief" && requestedSiteId && requestedSiteId !== policy.scopeSiteId) {
      throw new ForbiddenException("Shop Chief can use only the scoped site.");
    }

    if (policy.key === "safety-engineer" || policy.key === "shop-chief") {
      const instructorUserId = input.instructorUserId;

      if (instructorUserId && instructorUserId !== user.userId) {
        throw new ForbiddenException("This demo persona can sign only as the selected instructor.");
      }
    }

  }

  private hasEmployeeSignerAccount(employee: EmployeeRef | undefined) {
    return employee?.user?.role === "EMPLOYEE_SIGNER" && employee.user.isActive;
  }

  private normalizeStatus(
    status: RawBriefingEntry["status"],
  ): BriefingReadModelStatus {
    switch (status) {
      case "OPENED":
      case "ACKNOWLEDGED":
        return "SIGNING_READY";
      default:
        return status;
    }
  }

  private isImmutableSigned(entry: RawBriefingEntry) {
    return (
      entry.status === "SIGNED" ||
      entry.documentEnvelope?.status === "SIGNED" ||
      entry.documentEnvelope?.currentVersion?.status === "SIGNED"
    );
  }

  private isTerminalState(entry: RawBriefingEntry) {
    return (
      entry.status === "ANNULLED" ||
      entry.status === "SUPERSEDED" ||
      entry.status === "ARCHIVED" ||
      entry.documentEnvelope?.status === "ANNULLED" ||
      entry.documentEnvelope?.status === "SUPERSEDED" ||
      entry.documentEnvelope?.status === "ARCHIVED"
    );
  }

  private buildAllowedActions(
    entry: RawBriefingEntry,
    user: AuthenticatedUser,
    policy: BriefingPersonaPolicy,
    refs?: ScopeRefs,
  ): BriefingAllowedActions {
    const signatures = entry.signatures;
    const hasInstructorSignature = signatures.some(
      (signature) =>
        signature.signerRole === "BRIEFING_INSTRUCTOR" &&
        this.isCompletedSignatureStatus(signature.status),
    );
    const hasEmployeeSignature = signatures.some(
      (signature) =>
        signature.signerRole === "BRIEFED_EMPLOYEE" &&
        this.isCompletedSignatureStatus(signature.status),
    );
    const envelope = entry.documentEnvelope;
    const currentVersion = envelope?.currentVersion;
    const readyForSigning =
      this.normalizeStatus(entry.status) === "SIGNING_READY" &&
      envelope?.status === "SIGNING_READY" &&
      currentVersion?.status === "FINAL";
    const partiallySigned = entry.status === "PARTIALLY_SIGNED";
    const terminal = this.isTerminalState(entry);
    const immutable = this.isImmutableSigned(entry);
    const hasEvidence = Boolean(
      envelope && ((envelope.signatures?.length ?? 0) > 0 || (envelope.archiveRecords?.length ?? 0) > 0),
    );
    const canMutateEntry = this.canOperateOnEntry(user, policy, entry, refs);
    const canInstructorSign = Boolean(
      canMutateEntry && (readyForSigning || partiallySigned) && !hasInstructorSignature,
    );

    return {
      canEditDraft: canMutateEntry && entry.status === "DRAFT" && !immutable && !terminal,
      canPrepareSign: canMutateEntry && entry.status === "DRAFT" && !immutable && !terminal,
      canInstructorSign,
      canEmployeeSign:
        user.role === "EMPLOYEE_SIGNER" &&
        Boolean(partiallySigned && hasInstructorSignature && !hasEmployeeSignature),
      canAnnul: Boolean(
        canMutateEntry &&
          envelope &&
          !terminal &&
          (readyForSigning || partiallySigned || entry.status === "SIGNED"),
      ),
      canReplace: Boolean(canMutateEntry && entry.status === "SIGNED" && !terminal),
      canDownloadEvidence: hasEvidence,
      canViewArchive: Boolean(entry.archiveRecordId ?? envelope?.archiveRecords[0]),
    };
  }

  private mapCanonicalStatus(
    status?: Prisma.DocumentEnvelopeGetPayload<{}>["status"] | null,
  ) {
    switch (status) {
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
        return null;
    }
  }

  private parseDateBoundary(value?: string, endOfDay = false) {
    if (!value) {
      return undefined;
    }

    const date = new Date(value);

    if (Number.isNaN(date.getTime())) {
      throw new BadRequestException("Invalid date filter value.");
    }

    if (endOfDay) {
      date.setHours(23, 59, 59, 999);
    } else {
      date.setHours(0, 0, 0, 0);
    }

    return date;
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

  private assertEntryAccess(user: AuthenticatedUser, refs: ScopeRefs, entry: RawBriefingEntry) {
    if (user.role === "EMPLOYEE_SIGNER") {
      const employee = refs.employees.get(entry.employeeId);

      if (!employee || employee.userId !== user.userId) {
        throw new ForbiddenException("You do not have access to this briefing entry.");
      }

      if (entry.status === "DRAFT") {
        throw new ForbiddenException("Draft briefing entries are not visible to employees.");
      }

      return;
    }

    assertCompanyAccess(user, entry.organizationId);
  }

  private async findRawById(id: string) {
    const entry = await this.prisma.briefingJournalEntry.findUnique({
      where: { id },
      include: briefingEntryInclude,
    });

    if (!entry) {
      throw new NotFoundException("Briefing journal entry not found.");
    }

    return entry;
  }

  private async ensureEmployees(companyId: string, employeeIds: string[]) {
    const uniqueEmployeeIds = [...new Set(employeeIds)];
    const employees = await this.prisma.employee.findMany({
      where: {
        companyId,
        isArchived: false,
        id: {
          in: uniqueEmployeeIds,
        },
      },
      select: {
        id: true,
        companyId: true,
        fullName: true,
        employeeNumber: true,
        jobTitle: true,
        departmentId: true,
        siteId: true,
        userId: true,
        user: {
          select: {
            id: true,
            email: true,
            role: true,
            isActive: true,
          },
        },
      },
    });

    if (employees.length !== uniqueEmployeeIds.length) {
      throw new NotFoundException("One or more employees were not found.");
    }

    const employeeById = new Map(employees.map((employee) => [employee.id, employee]));
    return uniqueEmployeeIds.map((employeeId) => employeeById.get(employeeId)!);
  }

  private async ensureEmployee(companyId: string, employeeId: string) {
    const [employee] = await this.ensureEmployees(companyId, [employeeId]);
    return employee;
  }

  private async ensureInstructor(companyId: string, instructorUserId: string) {
    const instructor = await this.prisma.user.findFirst({
      where: {
        id: instructorUserId,
        companyId,
      },
      select: {
        id: true,
        fullName: true,
        role: true,
      },
    });

    if (!instructor) {
      throw new NotFoundException("Instructor was not found.");
    }

    return instructor;
  }

  private async ensureDepartment(companyId: string, departmentId?: string | null) {
    if (!departmentId) {
      return null;
    }

    const department = await this.prisma.department.findFirst({
      where: {
        id: departmentId,
        companyId,
      },
      select: {
        id: true,
        code: true,
        name: true,
      },
    });

    if (!department) {
      throw new BadRequestException("Department must belong to the same company.");
    }

    return department;
  }

  private async ensureWorkSiteRef(companyId: string, workSiteId?: string | null) {
    if (!workSiteId) {
      return null;
    }

    const [workSite, site] = await Promise.all([
      this.prisma.workSite.findFirst({
        where: {
          id: workSiteId,
          organizationId: companyId,
        },
        select: {
          id: true,
          code: true,
          name: true,
          location: true,
        },
      }),
      this.prisma.site.findFirst({
        where: {
          id: workSiteId,
          companyId,
        },
        select: {
          id: true,
          name: true,
          location: true,
        },
      }),
    ]);

    if (!workSite && !site) {
      throw new BadRequestException("Work site must belong to the same company.");
    }

    return (
      workSite ?? {
        id: site!.id,
        code: null,
        name: site!.name,
        location: site!.location,
      }
    );
  }

  private ensureEditableDraft(entry: RawBriefingEntry) {
    if (this.isImmutableSigned(entry)) {
      throw new BadRequestException(
        "Signed briefing entries are immutable. Use replace or annul instead of editing.",
      );
    }

    if (this.isTerminalState(entry)) {
      throw new BadRequestException("Terminal briefing entries cannot be edited.");
    }

    if (entry.status !== "DRAFT") {
      throw new BadRequestException("Only draft briefing entries can be edited.");
    }
  }

  private async resolveScopeRefs(organizationId: string, entries: RawBriefingEntry[]): Promise<ScopeRefs> {
    const employeeIds = [...new Set(entries.map((entry) => entry.employeeId))];
    const instructorIds = [...new Set(entries.map((entry) => entry.instructorUserId))];
    const departmentIds = [
      ...new Set(
        entries
          .map((entry) => entry.departmentId)
          .filter((value): value is string => Boolean(value)),
      ),
    ];
    const workSiteIds = [
      ...new Set(
        entries
          .map((entry) => entry.workSiteId)
          .filter((value): value is string => Boolean(value)),
      ),
    ];

    const [employees, instructors, departments, workSites, sites] = await Promise.all([
      employeeIds.length
        ? this.prisma.employee.findMany({
            where: {
              companyId: organizationId,
              id: {
                in: employeeIds,
              },
            },
            select: {
              id: true,
              companyId: true,
              fullName: true,
              employeeNumber: true,
              jobTitle: true,
              departmentId: true,
              siteId: true,
              userId: true,
              user: {
                select: {
                  id: true,
                  email: true,
                  role: true,
                  isActive: true,
                },
              },
            },
          })
        : Promise.resolve([]),
      instructorIds.length
        ? this.prisma.user.findMany({
            where: {
              companyId: organizationId,
              id: {
                in: instructorIds,
              },
            },
            select: {
              id: true,
              fullName: true,
              role: true,
            },
          })
        : Promise.resolve([]),
      departmentIds.length
        ? this.prisma.department.findMany({
            where: {
              companyId: organizationId,
              id: {
                in: departmentIds,
              },
            },
            select: {
              id: true,
              code: true,
              name: true,
            },
          })
        : Promise.resolve([]),
      workSiteIds.length
        ? this.prisma.workSite.findMany({
            where: {
              organizationId,
              id: {
                in: workSiteIds,
              },
            },
            select: {
              id: true,
              code: true,
              name: true,
              location: true,
            },
          })
        : Promise.resolve([]),
      workSiteIds.length
        ? this.prisma.site.findMany({
            where: {
              companyId: organizationId,
              id: {
                in: workSiteIds,
              },
            },
            select: {
              id: true,
              name: true,
              location: true,
            },
          })
        : Promise.resolve([]),
    ]);

    const workSiteMap: ScopeRefs["workSites"] = new Map(
      workSites.map((workSite) => [workSite.id, workSite] as const),
    );

    for (const site of sites) {
      if (!workSiteMap.has(site.id)) {
        workSiteMap.set(site.id, {
          id: site.id,
          code: null,
          name: site.name,
          location: site.location,
        });
      }
    }

    return {
      employees: new Map(employees.map((employee) => [employee.id, employee] as const)),
      instructors: new Map(instructors.map((instructor) => [instructor.id, instructor] as const)),
      departments: new Map(departments.map((department) => [department.id, department] as const)),
      workSites: workSiteMap,
    };
  }

  private buildPayload(entry: RawBriefingEntry, refs: ScopeRefs) {
    const employee = refs.employees.get(entry.employeeId);
    const instructor = refs.instructors.get(entry.instructorUserId);
    const department = entry.departmentId ? refs.departments.get(entry.departmentId) : null;
    const workSite = entry.workSiteId ? refs.workSites.get(entry.workSiteId) : null;

    return {
      subjectType: "BRIEFING_JOURNAL_ENTRY",
      subjectId: entry.id,
      registrationNo: entry.registrationNo,
      journalKind: entry.journalKind,
      entryNo: entry.entryNo,
      briefingType: entry.briefingType,
      briefingDate: entry.briefingDate.toISOString(),
      briefingTime: this.toIsoString(entry.briefingTime),
      topic: entry.topic,
      program: entry.program ?? null,
      basis: entry.basis ?? null,
      unscheduledReason: entry.unscheduledReason ?? null,
      notes: entry.notes ?? null,
      employee: employee
        ? {
            employeeId: employee.id,
            fullName: employee.fullName,
            employeeNumber: employee.employeeNumber,
            jobTitle: employee.jobTitle,
          }
        : {
            employeeId: entry.employeeId,
            fullName: "Unknown employee",
            employeeNumber: null,
            jobTitle: null,
          },
      instructor: instructor
        ? {
            userId: instructor.id,
            fullName: instructor.fullName,
            role: instructor.role,
          }
        : {
            userId: entry.instructorUserId,
            fullName: "Unknown instructor",
            role: null,
          },
      scope: {
        department: department
          ? {
              id: department.id,
              code: department.code,
              name: department.name,
            }
          : null,
        workSite: workSite
          ? {
              id: workSite.id,
              code: workSite.code,
              name: workSite.name,
              location: workSite.location,
            }
          : null,
      },
      replacement: entry.replacesEntryId
        ? {
            replacesEntryId: entry.replacesEntryId,
          }
        : null,
    } satisfies Prisma.JsonObject;
  }

  private async getHistorySummary(entry: RawBriefingEntry) {
    const [totalEvents, lastEvent] = await Promise.all([
      this.prisma.auditLog.count({
        where: {
          entityType: "BriefingJournalEntry",
          entityId: entry.id,
        },
      }),
      this.prisma.auditLog.findFirst({
        where: {
          entityType: "BriefingJournalEntry",
          entityId: entry.id,
        },
        orderBy: {
          createdAt: "desc",
        },
        select: {
          action: true,
          createdAt: true,
        },
      }),
    ]);

    return {
      totalEvents,
      lastAction: lastEvent?.action ?? null,
      lastAt: this.toIsoString(lastEvent?.createdAt),
    };
  }

  private mapArchiveSummary(entry: RawBriefingEntry) {
    const archiveRecord =
      entry.documentEnvelope?.archiveRecords.find((record) => record.id === entry.archiveRecordId) ??
      entry.documentEnvelope?.archiveRecords[0];
    const retentionPolicy = archiveRecord?.retentionPolicy;

    if (!archiveRecord || !retentionPolicy) {
      return null;
    }

    return {
      id: archiveRecord.id,
      status: archiveRecord.status,
      sealedAt: this.toIsoString(archiveRecord.sealedAt),
      archivedAt: this.toIsoString(archiveRecord.archivedAt),
      disposalEligibleAt: this.toIsoString(archiveRecord.disposalEligibleAt),
      storageUri: archiveRecord.storageUri,
      retentionCode: retentionPolicy.retentionCode,
      retentionSource:
        retentionPolicy.retentionCode === "JOURNAL_10Y" ||
        retentionPolicy.legalBasis.startsWith("P1 baseline:")
          ? ("baseline" as const)
          : ("configured" as const),
    };
  }

  private mapPendingSigners(entry: RawBriefingEntry) {
    const instructorSignature = entry.signatures.find(
      (signature) =>
        signature.signerRole === "BRIEFING_INSTRUCTOR" &&
        this.isCompletedSignatureStatus(signature.status),
    );
    const employeeSignature = entry.signatures.find(
      (signature) =>
        signature.signerRole === "BRIEFED_EMPLOYEE" &&
        this.isCompletedSignatureStatus(signature.status),
    );

    return [
      {
        role: "BRIEFING_INSTRUCTOR" as const,
        status: instructorSignature ? ("SIGNED" as const) : ("PENDING" as const),
        signedAt: this.toIsoString(instructorSignature?.signedAt),
        signerName: instructorSignature?.signerName ?? null,
      },
      {
        role: "BRIEFED_EMPLOYEE" as const,
        status: employeeSignature ? ("SIGNED" as const) : ("PENDING" as const),
        signedAt: this.toIsoString(employeeSignature?.signedAt),
        signerName: employeeSignature?.signerName ?? null,
      },
    ];
  }

  private async mapEntry(
    entry: RawBriefingEntry,
    refs: ScopeRefs,
    user: AuthenticatedUser,
    policy: BriefingPersonaPolicy,
  ): Promise<BriefingJournalEntry> {
    const employee = refs.employees.get(entry.employeeId);
    const instructor = refs.instructors.get(entry.instructorUserId);
    const department = entry.departmentId ? refs.departments.get(entry.departmentId) : null;
    const workSite = entry.workSiteId ? refs.workSites.get(entry.workSiteId) : null;
    const historySummary = await this.getHistorySummary(entry);
    const archiveSummary = this.mapArchiveSummary(entry);

    return {
      id: entry.id,
      organizationId: entry.organizationId,
      journalId: entry.journalId,
      entryNo: entry.entryNo,
      registrationNo: entry.registrationNo,
      journalKind: entry.journalKind,
      employeeId: entry.employeeId,
      instructorUserId: entry.instructorUserId,
      departmentId: entry.departmentId,
      workSiteId: entry.workSiteId,
      briefingType: entry.briefingType,
      status: this.normalizeStatus(entry.status),
      briefingDate: entry.briefingDate.toISOString(),
      briefingTime: this.toIsoString(entry.briefingTime),
      topic: entry.topic,
      program: entry.program,
      basis: entry.basis,
      unscheduledReason: entry.unscheduledReason,
      notes: entry.notes,
      annulReason: entry.annulReason,
      finalSignedAt: this.toIsoString(entry.finalSignedAt),
      documentEnvelopeId: entry.documentEnvelopeId,
      currentVersionId: entry.documentEnvelope?.currentVersionId ?? null,
      currentVersionNo: entry.documentEnvelope?.currentVersion?.versionNo ?? null,
      canonicalStatus: this.mapCanonicalStatus(entry.documentEnvelope?.status),
      documentEnvelopeStatus: entry.documentEnvelope?.status ?? null,
      documentVersionStatus: entry.documentEnvelope?.currentVersion?.status ?? null,
      signingDigest:
        entry.documentEnvelope?.currentVersion?.renderedHash ?? entry.documentHash ?? null,
      evidenceAvailable: Boolean(
        (entry.documentEnvelope?.signatures.length ?? 0) > 0 ||
          (entry.documentEnvelope?.archiveRecords.length ?? 0) > 0,
      ),
      archiveRecordSummary: archiveSummary,
      signatures: entry.signatures.map((signature) => ({
        id: signature.id,
        signerRole:
          signature.signerRole === "BRIEFING_INSTRUCTOR" ||
          signature.signerRole === "BRIEFED_EMPLOYEE"
            ? signature.signerRole
            : null,
        provider: signature.provider,
        status: signature.status,
        signerName: signature.signerName,
        signerIinMasked: signature.signerIinMasked,
        certificateSerial: signature.certificateSerial,
        signedAt: this.toIsoString(signature.signedAt),
        verifiedAt: this.toIsoString(signature.verifiedAt),
        verificationResult: signature.verification?.result ?? null,
        chainStatus: signature.verification?.chainStatus ?? null,
        revocationStatus: signature.verification?.revocationStatus ?? null,
        signatureHash: signature.signatureHash ?? null,
      })),
      pendingSigners: this.mapPendingSigners(entry),
      historySummary,
      allowedActions: this.buildAllowedActions(entry, user, policy, refs),
      employee: {
        employeeId: entry.employeeId,
        fullName: employee?.fullName ?? "Unknown employee",
        employeeNumber: employee?.employeeNumber ?? null,
        jobTitle: employee?.jobTitle ?? null,
        departmentId: employee?.departmentId ?? entry.departmentId ?? null,
        departmentName:
          (employee?.departmentId ? refs.departments.get(employee.departmentId)?.name : null) ??
          department?.name ??
          null,
        hasAccount: Boolean(employee?.user),
        accountRole: employee?.user?.role ?? null,
        hasEmployeeSignerAccount: this.hasEmployeeSignerAccount(employee),
      },
      instructor: {
        userId: entry.instructorUserId,
        fullName: instructor?.fullName ?? "Unknown instructor",
        role: instructor?.role ?? null,
      },
      department: department
        ? {
            id: department.id,
            code: department.code,
            name: department.name,
            location: null,
          }
        : null,
      workSite: workSite
        ? {
            id: workSite.id,
            code: workSite.code,
            name: workSite.name,
            location: workSite.location,
          }
        : null,
      complianceImpact: null,
    };
  }

  private async ensureJournal(
    user: AuthenticatedUser,
    organizationId: string,
    journalKind: "INTRODUCTORY" | "WORKPLACE",
  ) {
    await this.requireCorePlatform().ensureOrganizationForScope(user, organizationId);

    const journalCode =
      journalKind === "INTRODUCTORY" ? "BRIEFING_INTRODUCTORY" : "BRIEFING_WORKPLACE";

    return this.prisma.briefingJournal.upsert({
      where: {
        organizationId_journalCode: {
          organizationId,
          journalCode,
        },
      },
      update: {
        title:
          journalKind === "INTRODUCTORY"
            ? "Журнал вводного инструктажа"
            : "Журнал инструктажа на рабочем месте",
        status: "ACTIVE",
      },
      create: {
        organizationId,
        journalCode,
        title:
          journalKind === "INTRODUCTORY"
            ? "Журнал вводного инструктажа"
            : "Журнал инструктажа на рабочем месте",
        scopeType: "ORGANIZATION",
        status: "ACTIVE",
      },
    });
  }

  private async nextEntryNo(journalId: string) {
    const latest = await this.prisma.briefingJournalEntry.findFirst({
      where: { journalId },
      orderBy: {
        entryNo: "desc",
      },
      select: {
        entryNo: true,
      },
    });

    return (latest?.entryNo ?? 0) + 1;
  }

  private async nextRegistrationNo(organizationId: string) {
    const year = new Date().getFullYear();
    const count = await this.prisma.briefingJournalEntry.count({
      where: {
        organizationId,
        createdAt: {
          gte: new Date(`${year}-01-01T00:00:00.000Z`),
          lt: new Date(`${year + 1}-01-01T00:00:00.000Z`),
        },
      },
    });

    return `DSJ-${year}-${String(count + 1).padStart(4, "0")}`;
  }

  private async resolveEnvelopeWorkSiteId(organizationId: string, workSiteId?: string | null) {
    if (!workSiteId) {
      return null;
    }

    const workSite = await this.prisma.workSite.findFirst({
      where: {
        id: workSiteId,
        organizationId,
      },
      select: {
        id: true,
      },
    });

    return workSite?.id ?? null;
  }

  private async recalculateEmployees(user: AuthenticatedUser, employeeIds: string[]) {
    if (!this.employeeComplianceService) {
      return;
    }

    const uniqueEmployeeIds = [...new Set(employeeIds.filter(Boolean))];

    await Promise.all(
      uniqueEmployeeIds.map((employeeId) =>
        this.employeeComplianceService!.recalculate(user, employeeId),
      ),
    );
  }

  private resolveJournalKind(input: {
    journalKind?: "INTRODUCTORY" | "WORKPLACE";
    briefingType: RawBriefingEntry["briefingType"] | CreateBriefingInput["briefingType"];
  }) {
    return input.journalKind ?? (input.briefingType === "INTRODUCTORY" ? "INTRODUCTORY" : "WORKPLACE");
  }

  private parseBriefingTime(briefingDate: Date, value?: string | null) {
    if (!value) {
      return null;
    }

    const trimmed = value.trim();

    if (/^\d{2}:\d{2}$/.test(trimmed)) {
      const [hours, minutes] = trimmed.split(":").map(Number);
      const resolved = new Date(briefingDate);
      resolved.setHours(hours, minutes, 0, 0);
      return resolved;
    }

    const resolved = new Date(trimmed);

    if (Number.isNaN(resolved.getTime())) {
      throw new BadRequestException("Invalid briefing time.");
    }

    return resolved;
  }

  private notImplemented(): never {
    throw new BadRequestException("Briefing journal service is being rewired.");
  }

  async list(user: AuthenticatedUser, filters: BriefingFilters): Promise<BriefingRegistryItem[]> {
    const organizationId = getCompanyScope(user, filters.companyId) ?? undefined;
    const policy = await this.resolvePersonaPolicy(user);
    const entries = await this.prisma.briefingJournalEntry.findMany({
      where: {
        ...(organizationId ? { organizationId } : {}),
        ...(policy.key === "shop-chief"
          ? {
              departmentId: policy.scopeDepartmentId ?? "__no_department_scope__",
              workSiteId: policy.scopeSiteId ?? "__no_site_scope__",
            }
          : {}),
        ...(filters.journalKind ? { journalKind: filters.journalKind } : {}),
        ...(filters.briefingType ? { briefingType: filters.briefingType } : {}),
        ...(filters.employeeId ? { employeeId: filters.employeeId } : {}),
        ...(filters.instructorUserId ? { instructorUserId: filters.instructorUserId } : {}),
        ...(filters.departmentId ? { departmentId: filters.departmentId } : {}),
        ...(filters.workSiteId ? { workSiteId: filters.workSiteId } : {}),
        ...(filters.status
          ? {
              status:
                filters.status === "SIGNING_READY"
                  ? { in: ["SIGNING_READY", "OPENED", "ACKNOWLEDGED"] }
                  : filters.status,
            }
          : {}),
        ...(filters.search
          ? {
              OR: [
                { registrationNo: { contains: filters.search, mode: "insensitive" } },
                { topic: { contains: filters.search, mode: "insensitive" } },
              ],
            }
          : {}),
        briefingDate: {
          ...(this.parseDateBoundary(filters.startDate)
            ? { gte: this.parseDateBoundary(filters.startDate) }
            : {}),
          ...(this.parseDateBoundary(filters.endDate, true)
            ? { lte: this.parseDateBoundary(filters.endDate, true) }
            : {}),
        },
      },
      include: briefingEntryInclude,
      orderBy: [{ briefingDate: "desc" }, { createdAt: "desc" }],
      take: 200,
    });

    const refs = await this.resolveScopeRefs(organizationId ?? user.companyId ?? "", entries);
    const mapped = await Promise.all(
      entries.map((entry) => this.mapEntry(entry, refs, user, policy)),
    );

    return mapped.map((entry) => ({
      id: entry.id,
      organizationId: entry.organizationId,
      registrationNo: entry.registrationNo,
      journalKind: entry.journalKind,
      briefingType: entry.briefingType,
      status: entry.status,
      briefingDate: entry.briefingDate,
      topic: entry.topic,
      finalSignedAt: entry.finalSignedAt,
      canonicalStatus: entry.canonicalStatus,
      evidenceAvailable: entry.evidenceAvailable,
      archiveRecordSummary: entry.archiveRecordSummary,
      historySummary: entry.historySummary,
      allowedActions: entry.allowedActions,
      employee: entry.employee,
      instructor: entry.instructor,
      department: entry.department,
      workSite: entry.workSite,
    }));
  }

  async listMy(user: AuthenticatedUser): Promise<MyBriefingInstruction[]> {
    const employee = await this.requireEmployeeAccount(user);
    const policy = await this.resolvePersonaPolicy(user);
    const entries = await this.prisma.briefingJournalEntry.findMany({
      where: {
        organizationId: employee.companyId,
        employeeId: employee.id,
        status: {
          not: "DRAFT",
        },
      },
      include: briefingEntryInclude,
      orderBy: [{ briefingDate: "desc" }, { createdAt: "desc" }],
    });
    const refs = await this.resolveScopeRefs(employee.companyId, entries);
    const mapped = await Promise.all(
      entries.map((entry) => this.mapEntry(entry, refs, user, policy)),
    );

    return mapped.map((entry) => ({
      id: entry.id,
      organizationId: entry.organizationId,
      registrationNo: entry.registrationNo,
      journalKind: entry.journalKind,
      briefingType: entry.briefingType,
      status: entry.status,
      briefingDate: entry.briefingDate,
      briefingTime: entry.briefingTime,
      topic: entry.topic,
      notes: entry.notes,
      finalSignedAt: entry.finalSignedAt,
      signingDigest: entry.signingDigest,
      evidenceAvailable: entry.evidenceAvailable,
      archiveRecordSummary: entry.archiveRecordSummary,
      pendingSigners: entry.pendingSigners,
      allowedActions: entry.allowedActions,
      employee: entry.employee,
      instructor: entry.instructor,
      department: entry.department,
      workSite: entry.workSite,
    }));
  }

  async findOne(user: AuthenticatedUser, id: string): Promise<BriefingJournalEntry> {
    const entry = await this.findRawById(id);
    const refs = await this.resolveScopeRefs(entry.organizationId, [entry]);
    const policy = await this.resolvePersonaPolicy(user);
    this.assertEntryAccess(user, refs, entry);
    if (policy.key === "shop-chief" && !this.entryMatchesPersonaScope(policy, entry, refs)) {
      throw new ForbiddenException("You do not have access to this scoped briefing entry.");
    }

    return this.mapEntry(entry, refs, user, policy);
  }

  async create(user: AuthenticatedUser, input: CreateBriefingInput) {
    const organizationId = requireCompanyScope(user, input.companyId);
    const policy = await this.resolvePersonaPolicy(user);
    const employees = await this.ensureEmployees(organizationId, input.employeeIds);
    const journalKind = this.resolveJournalKind({
      journalKind: input.journalKind,
      briefingType: input.briefingType,
    });
    this.assertCreateInputAllowed(user, policy, input, employees, journalKind);
    await Promise.all([
      this.ensureInstructor(organizationId, input.instructorUserId),
      this.ensureDepartment(
        organizationId,
        policy.key === "shop-chief" ? policy.scopeDepartmentId : input.departmentId ?? null,
      ),
      this.ensureWorkSiteRef(
        organizationId,
        policy.key === "shop-chief" ? policy.scopeSiteId : input.workSiteId ?? input.siteId ?? null,
      ),
    ]);

    const briefingDate = new Date(input.briefingDate);

    if (Number.isNaN(briefingDate.getTime())) {
      throw new BadRequestException("Invalid briefing date.");
    }

    const journal = await this.ensureJournal(user, organizationId, journalKind);
    const createdIds: string[] = [];

    for (const employee of employees) {
      const entryNo = await this.nextEntryNo(journal.id);
      const registrationNo = await this.nextRegistrationNo(organizationId);
      const created = await this.prisma.briefingJournalEntry.create({
        data: {
          organizationId,
          journalId: journal.id,
          entryNo,
          registrationNo,
          journalKind,
          employeeId: employee.id,
          instructorUserId: input.instructorUserId,
          departmentId:
            policy.key === "shop-chief"
              ? policy.scopeDepartmentId
              : input.departmentId ?? employee.departmentId ?? null,
          workSiteId:
            policy.key === "shop-chief"
              ? policy.scopeSiteId
              : input.workSiteId ?? input.siteId ?? employee.siteId ?? null,
          briefingType: input.briefingType,
          status: "DRAFT",
          employeeStatus: "ASSIGNED",
          briefingDate,
          briefingTime: this.parseBriefingTime(briefingDate, input.briefingTime),
          topic: input.topic,
          program: input.program ?? null,
          basis: input.basis ?? null,
          unscheduledReason: input.unscheduledReason ?? null,
          notes: input.notes ?? null,
          createdByUserId: user.userId,
          updatedByUserId: user.userId,
        },
        select: {
          id: true,
        },
      });

      createdIds.push(created.id);

      await this.auditService.log({
        actorUserId: user.userId,
        companyId: organizationId,
        action: "briefing.entry_created",
        entityType: "BriefingJournalEntry",
        entityId: created.id,
        metadata: {
          registrationNo,
          journalKind,
        },
      });
    }

    if (input.status === "SIGNING_READY" || input.status === "READY_FOR_SIGNING") {
      await Promise.all(createdIds.map((entryId) => this.prepareForSigning(user, entryId)));
    }

    return this.findOne(user, createdIds[0]!);
  }

  async update(user: AuthenticatedUser, id: string, input: UpdateBriefingInput) {
    const existing = await this.findRawById(id);
    assertCompanyAccess(user, existing.organizationId);
    this.ensureEditableDraft(existing);
    const policy = await this.resolvePersonaPolicy(user);

    const employeeId = input.employeeId ?? existing.employeeId;
    const instructorUserId = input.instructorUserId ?? existing.instructorUserId;
    const journalKind = this.resolveJournalKind({
      journalKind: input.journalKind ?? existing.journalKind,
      briefingType: input.briefingType ?? existing.briefingType,
    });
    const resolvedBriefingType = input.briefingType ?? existing.briefingType;
    const [employee] = await Promise.all([
      this.ensureEmployee(existing.organizationId, employeeId),
      this.ensureInstructor(existing.organizationId, instructorUserId),
      this.ensureDepartment(
        existing.organizationId,
        policy.key === "shop-chief"
          ? policy.scopeDepartmentId
          : input.departmentId ?? existing.departmentId,
      ),
      this.ensureWorkSiteRef(
        existing.organizationId,
        policy.key === "shop-chief"
          ? policy.scopeSiteId
          : input.workSiteId ?? input.siteId ?? existing.workSiteId,
      ),
    ]);
    this.assertCreateInputAllowed(
      user,
      policy,
      {
        ...input,
        instructorUserId,
        briefingType: resolvedBriefingType,
      },
      [employee],
      journalKind,
    );
    const journal =
      journalKind === existing.journalKind
        ? { id: existing.journalId }
        : await this.ensureJournal(user, existing.organizationId, journalKind);
    const briefingDate = input.briefingDate ? new Date(input.briefingDate) : existing.briefingDate;

    if (Number.isNaN(briefingDate.getTime())) {
      throw new BadRequestException("Invalid briefing date.");
    }

    await this.prisma.briefingJournalEntry.update({
      where: { id: existing.id },
      data: {
        journalId: journal.id,
        journalKind,
        employeeId,
        instructorUserId,
        departmentId:
          policy.key === "shop-chief"
            ? policy.scopeDepartmentId
            : input.departmentId === undefined
              ? existing.departmentId
              : input.departmentId ?? null,
        workSiteId:
          policy.key === "shop-chief"
            ? policy.scopeSiteId
            : input.workSiteId !== undefined || input.siteId !== undefined
            ? input.workSiteId ?? input.siteId ?? null
            : existing.workSiteId,
        briefingType: resolvedBriefingType,
        briefingDate,
        briefingTime:
          input.briefingTime === undefined
            ? existing.briefingTime
            : this.parseBriefingTime(briefingDate, input.briefingTime),
        topic: input.topic ?? existing.topic,
        program: input.program === undefined ? existing.program : input.program,
        basis: input.basis === undefined ? existing.basis : input.basis,
        unscheduledReason:
          input.unscheduledReason === undefined
            ? existing.unscheduledReason
            : input.unscheduledReason,
        notes: input.notes === undefined ? existing.notes : input.notes,
        updatedByUserId: user.userId,
      },
    });

    await this.auditService.log({
      actorUserId: user.userId,
      companyId: existing.organizationId,
      action: "briefing.entry_updated",
      entityType: "BriefingJournalEntry",
      entityId: existing.id,
      metadata: {
        registrationNo: existing.registrationNo,
        employeeId: employee.id,
      },
    });

    if (input.status === "SIGNING_READY" || input.status === "READY_FOR_SIGNING") {
      return this.prepareForSigning(user, existing.id);
    }

    return this.findOne(user, existing.id);
  }

  async prepareForSigning(
    user: AuthenticatedUser,
    id: string,
  ): Promise<PrepareBriefingForSigningResponse> {
    const existing = await this.findRawById(id);
    assertCompanyAccess(user, existing.organizationId);
    const refs = await this.resolveScopeRefs(existing.organizationId, [existing]);
    const policy = await this.resolvePersonaPolicy(user);
    this.assertCanOperateOnEntry(user, policy, existing, refs);
    const alreadyPrepared =
      this.normalizeStatus(existing.status) === "SIGNING_READY" &&
      existing.documentEnvelope?.status === "SIGNING_READY" &&
      existing.documentEnvelope.currentVersion?.status === "FINAL";

    if (!alreadyPrepared) {
      this.ensureEditableDraft(existing);
    }

    const payloadJson = this.buildPayload(existing, refs);
    const digest = hashDocumentPayload(JSON.stringify(payloadJson));
    let envelopeId = existing.documentEnvelopeId;

    if (!envelopeId) {
      const envelope = await this.requireCorePlatform().createDocumentEnvelope(user, {
        documentKind: "BRIEFING_JOURNAL_ENTRY",
        scope: {
          organizationId: existing.organizationId,
          departmentId: existing.departmentId ?? null,
          workSiteId: await this.resolveEnvelopeWorkSiteId(existing.organizationId, existing.workSiteId),
        },
        businessObjectType: "BRIEFING_JOURNAL_ENTRY",
        businessObjectId: existing.id,
        documentNumber: existing.registrationNo ?? `${existing.journalKind}-${existing.entryNo}`,
        title: `Briefing entry ${existing.registrationNo ?? existing.entryNo}`,
        status: "DRAFT",
      });

      envelopeId = envelope.id;
    }

    const version = await this.requireCorePlatform().createDocumentVersion(user, {
      envelopeId,
      payloadJson,
      renderedHash: digest,
      changeReason: "Prepared briefing entry for signing.",
      status: "FINAL",
    });

    await this.prisma.briefingJournalEntry.update({
      where: { id: existing.id },
      data: {
        status: "SIGNING_READY",
        documentEnvelopeId: envelopeId,
        documentHash: digest,
        updatedByUserId: user.userId,
      },
    });

    await this.auditService.log({
      actorUserId: user.userId,
      companyId: existing.organizationId,
      action: "briefing.entry_ready_for_signing",
      entityType: "BriefingJournalEntry",
      entityId: existing.id,
      metadata: {
        envelopeId,
        versionId: version.id,
        digest,
      },
    });

    const prepared = await this.findOne(user, id);
    const signingConfig = this.getSigningRuntimeConfig();

    if (!prepared.signingDigest || !prepared.documentEnvelopeId || !prepared.currentVersionId) {
      throw new BadRequestException("Signing contract is not available after preparation.");
    }

    if (!prepared.currentVersionNo) {
      throw new BadRequestException("Version number is not available after preparation.");
    }

    return {
      briefing: prepared,
      envelopeId: prepared.documentEnvelopeId,
      versionId: prepared.currentVersionId,
      versionNo: prepared.currentVersionNo,
      digest: prepared.signingDigest,
      pendingSigners: prepared.pendingSigners,
      allowedActions: prepared.allowedActions,
      contract: {
        mode: "ORGANIZATION",
        requiresExternalSignature: true,
        documentHash: prepared.signingDigest,
        provider: signingConfig.isConfigured ? signingConfig.provider : null,
        signRole: "BRIEFING_INSTRUCTOR",
        bridgeContext: {
          briefingJournalEntryId: prepared.id,
          registrationNo: prepared.registrationNo,
        },
      },
    };
  }

  async markOpened(user: AuthenticatedUser, id: string) {
    const employee = await this.requireEmployeeAccount(user);
    const entry = await this.findRawById(id);
    const refs = await this.resolveScopeRefs(entry.organizationId, [entry]);
    this.assertEntryAccess(user, refs, entry);

    if (entry.employeeId !== employee.id) {
      throw new ForbiddenException("You do not have access to this briefing entry.");
    }

    if (entry.status === "SIGNED" || entry.status === "ANNULLED" || entry.status === "SUPERSEDED") {
      return this.findOne(user, id);
    }

    if (entry.openedAt) {
      return this.findOne(user, id);
    }

    const openedAt = new Date();

    await this.prisma.briefingJournalEntry.update({
      where: { id },
      data: {
        openedAt,
        employeeStatus: "OPENED",
      },
    });

    await this.auditService.log({
      actorUserId: user.userId,
      companyId: entry.organizationId,
      action: "briefing.entry_opened",
      entityType: "BriefingJournalEntry",
      entityId: entry.id,
      metadata: {
        employeeId: entry.employeeId,
      },
    });

    return this.findOne(user, id);
  }

  async acknowledge(user: AuthenticatedUser, id: string) {
    const employee = await this.requireEmployeeAccount(user);
    const entry = await this.findRawById(id);
    const refs = await this.resolveScopeRefs(entry.organizationId, [entry]);
    this.assertEntryAccess(user, refs, entry);

    if (entry.employeeId !== employee.id) {
      throw new ForbiddenException("You do not have access to this briefing entry.");
    }

    if (
      !["SIGNING_READY", "PARTIALLY_SIGNED", "SIGNED"].includes(this.normalizeStatus(entry.status))
    ) {
      throw new BadRequestException("The briefing entry must be prepared before acknowledgement.");
    }

    if (entry.acknowledgedAt) {
      return this.findOne(user, id);
    }

    const acknowledgedAt = new Date();

    await this.prisma.briefingJournalEntry.update({
      where: { id },
      data: {
        openedAt: entry.openedAt ?? acknowledgedAt,
        acknowledgedAt,
        employeeStatus: "ACKNOWLEDGED",
      },
    });

    await this.auditService.log({
      actorUserId: user.userId,
      companyId: entry.organizationId,
      action: "briefing.entry_acknowledged",
      entityType: "BriefingJournalEntry",
      entityId: entry.id,
      metadata: {
        employeeId: entry.employeeId,
      },
    });

    return this.findOne(user, id);
  }

  async archive(user: AuthenticatedUser, id: string) {
    await this.findOne(user, id);
    throw new BadRequestException(
      "Briefing entries are archived automatically after the final signature.",
    );
  }

  async annul(user: AuthenticatedUser, id: string, input: AnnulBriefingInput) {
    const entry = await this.findRawById(id);
    assertCompanyAccess(user, entry.organizationId);
    const refs = await this.resolveScopeRefs(entry.organizationId, [entry]);
    const policy = await this.resolvePersonaPolicy(user);
    this.assertCanOperateOnEntry(user, policy, entry, refs);
    const envelope = entry.documentEnvelope;
    const currentVersion = envelope?.currentVersion;

    if (!envelope || !currentVersion) {
      throw new BadRequestException("Canonical briefing revision is not available.");
    }

    if (!this.buildAllowedActions(entry, user, policy, refs).canAnnul) {
      throw new BadRequestException("Only prepared or signed briefing entries can be annulled.");
    }

    const annulledAt = new Date();

    await this.prisma.$transaction(async (transaction) => {
      await transaction.documentVersion.update({
        where: { id: currentVersion.id },
        data: {
          status: "VOIDED",
          annulledAt,
        },
      });

      await transaction.documentEnvelope.update({
        where: { id: envelope.id },
        data: {
          status: "ANNULLED",
        },
      });

      await transaction.briefingJournalEntry.update({
        where: { id: entry.id },
        data: {
          status: "ANNULLED",
          annulReason: input.reason ?? null,
          updatedByUserId: user.userId,
        },
      });
    });

    await this.auditService.log({
      actorUserId: user.userId,
      companyId: entry.organizationId,
      action: "briefing.entry_annulled",
      entityType: "BriefingJournalEntry",
      entityId: entry.id,
      metadata: {
        envelopeId: envelope.id,
        reason: input.reason ?? null,
      },
    });

    await this.recalculateEmployees(user, [entry.employeeId]);

    return this.findOne(user, id);
  }

  async replace(user: AuthenticatedUser, id: string, input: ReplaceBriefingInput) {
    const source = await this.findRawById(id);
    assertCompanyAccess(user, source.organizationId);
    const refs = await this.resolveScopeRefs(source.organizationId, [source]);
    const policy = await this.resolvePersonaPolicy(user);
    this.assertCanOperateOnEntry(user, policy, source, refs);

    if (!this.buildAllowedActions(source, user, policy, refs).canReplace) {
      throw new BadRequestException("Only signed briefing entries can be replaced.");
    }

    const replacement = await this.create(user, {
      companyId: source.organizationId,
      employeeIds: input.employeeIds,
      journalKind: input.journalKind ?? source.journalKind,
      departmentId: input.departmentId ?? source.departmentId ?? null,
      workSiteId: input.workSiteId ?? input.siteId ?? source.workSiteId ?? null,
      instructorUserId: input.instructorUserId,
      briefingType: input.briefingType,
      briefingDate: input.briefingDate,
      briefingTime: input.briefingTime ?? this.toIsoString(source.briefingTime),
      topic: input.topic,
      program: input.program ?? source.program ?? null,
      basis: input.basis ?? source.basis ?? null,
      unscheduledReason: input.unscheduledReason ?? source.unscheduledReason ?? null,
      notes: input.notes ?? source.notes ?? null,
      status: "DRAFT",
    });

    await this.prisma.briefingJournalEntry.update({
      where: { id: replacement.id },
      data: {
        replacesEntryId: source.id,
        updatedByUserId: user.userId,
      },
    });

    await this.auditService.log({
      actorUserId: user.userId,
      companyId: source.organizationId,
      action: "briefing.entry_replacement_created",
      entityType: "BriefingJournalEntry",
      entityId: replacement.id,
      metadata: {
        replacesEntryId: source.id,
        reason: input.reason ?? null,
      },
    });

    return this.findOne(user, replacement.id);
  }

  async evidence(user: AuthenticatedUser, id: string) {
    const entry = await this.findRawById(id);
    const refs = await this.resolveScopeRefs(entry.organizationId, [entry]);
    this.assertEntryAccess(user, refs, entry);

    if (!entry.documentEnvelopeId) {
      throw new BadRequestException("Evidence is not available before canonical preparation.");
    }

    const evidencePackage = await this.requireCorePlatform().buildEvidencePackage(
      user,
      entry.documentEnvelopeId,
    );

    return {
      briefingJournalEntryId: entry.id,
      registrationNo: entry.registrationNo,
      archiveRecordId: entry.archiveRecordId,
      retentionPolicyId: entry.retentionPolicyId,
      evidencePackage,
    };
  }

  async archiveSummary(user: AuthenticatedUser, id: string) {
    const entry = await this.findRawById(id);
    const refs = await this.resolveScopeRefs(entry.organizationId, [entry]);
    this.assertEntryAccess(user, refs, entry);
    return this.mapArchiveSummary(entry);
  }

  async exportRecordPdf(user: AuthenticatedUser, id: string) {
    const entry = await this.findRawById(id);
    const refs = await this.resolveScopeRefs(entry.organizationId, [entry]);
    this.assertEntryAccess(user, refs, entry);
    const policy = await this.resolvePersonaPolicy(user);
    const mapped = await this.mapEntry(entry, refs, user, policy);
    const workSite = entry.workSiteId ? refs.workSites.get(entry.workSiteId) : null;

    return this.pdfService.renderBriefingRecord({
      documentNumber: mapped.registrationNo ?? null,
      briefingType: mapped.briefingType,
      briefingDate: new Date(mapped.briefingDate),
      topic: mapped.topic,
      notes: mapped.notes ?? null,
      status: mapped.status,
      signedAt: mapped.finalSignedAt ? new Date(mapped.finalSignedAt) : null,
      instructor: {
        fullName: mapped.instructor.fullName,
      },
      department: mapped.department
        ? {
            name: mapped.department.name,
          }
        : null,
      site: workSite
        ? {
            name: workSite.name,
          }
        : null,
      participants: [
        {
          fullName: mapped.employee.fullName,
          employeeNumber: mapped.employee.employeeNumber ?? "—",
          jobTitle: mapped.employee.jobTitle ?? "—",
          contractorCompanyName: null,
          status: mapped.status,
          inviteLink: null,
          signatures: mapped.signatures.map((signature) => ({
            signerName: signature.signerName,
            signerIinMasked: signature.signerIinMasked,
            certificateSerial: signature.certificateSerial,
            signedAt: signature.signedAt ? new Date(signature.signedAt) : null,
          })),
        },
      ],
    });
  }

  async exportJournalPdf(user: AuthenticatedUser, filters: BriefingFilters) {
    const records = await this.list(user, filters);

    return this.pdfService.renderJournal(
      records.map((record) => ({
        documentNumber: record.registrationNo ?? null,
        briefingType: record.briefingType,
        briefingDate: new Date(record.briefingDate),
        status: record.status,
        topic: record.topic,
        participantsLabel: `${record.employee.fullName} (${record.employee.employeeNumber ?? "—"})`,
      })),
      `Выгрузка журнала инструктажей от ${formatDate(new Date())}`,
    );
  }
}
