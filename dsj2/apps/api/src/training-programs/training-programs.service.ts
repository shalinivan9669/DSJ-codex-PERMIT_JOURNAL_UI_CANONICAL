import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import type {
  CreateTrainingProgramInput,
  TrainingProgramFilters,
} from "@dsj/types";
import { Prisma } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { AuditService } from "../audit/audit.service";
import type { AuthenticatedUser } from "../common/types/authenticated-user.type";
import { requireEmployeeScope } from "../common/utils/employee-scope";
import {
  assertCompanyAccess,
  getCompanyScope,
  requireCompanyScope,
} from "../common/utils/tenant-scope";
import { PrismaService } from "../database/prisma.service";
import { lockTrainingAssignment } from "./training-assignment-lock";

const trainingAssignmentInclude = {
  employee: true,
  assignedByUser: true,
  trainingProgram: {
    include: {
      exam: true,
    },
  },
  generatedDocuments: true,
  generatedCertificates: true,
  examAttempts: {
    orderBy: [{ submittedAt: "desc" }, { createdAt: "desc" }],
  },
} satisfies Prisma.TrainingAssignmentInclude;

type RawTrainingAssignment = Prisma.TrainingAssignmentGetPayload<{
  include: typeof trainingAssignmentInclude;
}>;

@Injectable()
export class TrainingProgramsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  private getEffectiveStatus(assignment: {
    status: RawTrainingAssignment["status"];
    dueAt: Date | null;
    completedAt: Date | null;
  }) {
    if (assignment.completedAt || assignment.status === "COMPLETED") {
      return "COMPLETED" as const;
    }

    if (assignment.dueAt && assignment.dueAt.getTime() < Date.now()) {
      return "OVERDUE" as const;
    }

    return assignment.status;
  }

  private getEffectiveDocumentStatus(document: {
    status: RawTrainingAssignment["generatedDocuments"][number]["status"];
    expiryDate: Date | null;
  }) {
    if (document.status === "DRAFT") {
      return "DRAFT" as const;
    }

    if (!document.expiryDate) {
      return "ACTIVE" as const;
    }

    const now = Date.now();
    const expiryTime = document.expiryDate.getTime();
    const thirtyDaysAhead = now + 1000 * 60 * 60 * 24 * 30;

    if (expiryTime < now) {
      return "EXPIRED" as const;
    }

    if (expiryTime <= thirtyDaysAhead) {
      return "EXPIRING" as const;
    }

    return "ACTIVE" as const;
  }

  private getEffectiveCertificateStatus(certificate: {
    expiryDate: Date;
    status: RawTrainingAssignment["generatedCertificates"][number]["status"];
  }) {
    const now = Date.now();
    const expiryTime = certificate.expiryDate.getTime();
    const thirtyDaysAhead = now + 1000 * 60 * 60 * 24 * 30;

    if (expiryTime < now || certificate.status === "EXPIRED") {
      return "EXPIRED" as const;
    }

    if (expiryTime <= thirtyDaysAhead) {
      return "EXPIRING_SOON" as const;
    }

    return "ACTIVE" as const;
  }

  private getExamStatus(assignment: RawTrainingAssignment) {
    const exam = assignment.trainingProgram.exam;

    if (!exam) {
      return null;
    }

    const latestAttempt = assignment.examAttempts[0] ?? null;
    const submittedAttempts = assignment.examAttempts.filter((attempt) => attempt.status === "SUBMITTED").length;

    if (assignment.examPassedAt) {
      const passedAttempt = assignment.examAttempts.find(
        (attempt) => attempt.status === "SUBMITTED" && attempt.passed,
      );
      return {
        examId: exam.id,
        title: exam.title,
        passingScore: exam.passingScore,
        maxAttempts: exam.maxAttempts,
        attemptsUsed: submittedAttempts,
        status: "PASSED" as const,
        result: passedAttempt?.score ?? null,
        passedAt: assignment.examPassedAt,
      };
    }

    if (latestAttempt?.status === "IN_PROGRESS") {
      return {
        examId: exam.id,
        title: exam.title,
        passingScore: exam.passingScore,
        maxAttempts: exam.maxAttempts,
        attemptsUsed: submittedAttempts,
        status: "IN_PROGRESS" as const,
        result: null,
        passedAt: null,
      };
    }

    if (latestAttempt?.status === "SUBMITTED" && latestAttempt.passed === false && submittedAttempts >= exam.maxAttempts) {
      return {
        examId: exam.id,
        title: exam.title,
        passingScore: exam.passingScore,
        maxAttempts: exam.maxAttempts,
        attemptsUsed: submittedAttempts,
        status: "FAILED" as const,
        result: latestAttempt.score ?? null,
        passedAt: null,
      };
    }

    if (assignment.progressPercent >= 80 || assignment.completedAt) {
      return {
        examId: exam.id,
        title: exam.title,
        passingScore: exam.passingScore,
        maxAttempts: exam.maxAttempts,
        attemptsUsed: submittedAttempts,
        status:
          latestAttempt?.status === "SUBMITTED" && latestAttempt.passed === false
            ? ("AVAILABLE" as const)
            : ("AVAILABLE" as const),
        result: latestAttempt?.score ?? null,
        passedAt: null,
      };
    }

    return {
      examId: exam.id,
      title: exam.title,
      passingScore: exam.passingScore,
      maxAttempts: exam.maxAttempts,
      attemptsUsed: submittedAttempts,
      status: "NOT_STARTED" as const,
      result: latestAttempt?.score ?? null,
      passedAt: null,
    };
  }

  private mapAssignment(assignment: RawTrainingAssignment) {
    const status = this.getEffectiveStatus(assignment);
    const exam = this.getExamStatus(assignment);
    const progressPercent =
      status === "COMPLETED" ? 100 : exam?.status === "AVAILABLE" && assignment.progressPercent < 80 ? 80 : assignment.progressPercent;

    return {
      id: assignment.id,
      companyId: assignment.companyId,
      employeeId: assignment.employeeId,
      trainingProgramId: assignment.trainingProgramId,
      dueAt: assignment.dueAt,
      status,
      rawStatus: assignment.status,
      progressPercent,
      startedAt: assignment.startedAt,
      completedAt: assignment.completedAt,
      examPassedAt: assignment.examPassedAt,
      employee: {
        id: assignment.employee.id,
        fullName: assignment.employee.fullName,
        employeeNumber: assignment.employee.employeeNumber,
        jobTitle: assignment.employee.jobTitle,
      },
      assignedByUser: assignment.assignedByUser
        ? {
            id: assignment.assignedByUser.id,
            fullName: assignment.assignedByUser.fullName,
          }
        : null,
      trainingProgram: {
        id: assignment.trainingProgram.id,
        title: assignment.trainingProgram.title,
        description: assignment.trainingProgram.description,
        materialContent: assignment.trainingProgram.materialContent,
        materialFileName: assignment.trainingProgram.materialFileName,
        materialFileUrl: assignment.trainingProgram.materialFileUrl,
        videoUrl: assignment.trainingProgram.videoUrl,
        issuerName: assignment.trainingProgram.issuerName,
        requiresExam: assignment.trainingProgram.requiresExam,
        createsDocument: assignment.trainingProgram.createsDocument,
        createsSafetyCertificate: assignment.trainingProgram.createsSafetyCertificate,
        isActive: assignment.trainingProgram.isActive,
      },
      exam,
      generatedDocuments: assignment.generatedDocuments.map((document) => ({
        id: document.id,
        title: document.title,
        documentType: document.documentType,
        issueDate: document.issueDate,
        expiryDate: document.expiryDate,
        status: this.getEffectiveDocumentStatus(document),
      })),
      generatedCertificates: assignment.generatedCertificates.map((certificate) => ({
        id: certificate.id,
        certificateNumber: certificate.certificateNumber,
        issueDate: certificate.issueDate,
        expiryDate: certificate.expiryDate,
        status: this.getEffectiveCertificateStatus(certificate),
      })),
      canStart: status !== "COMPLETED" && !assignment.startedAt,
      canCompleteMaterial:
        status !== "COMPLETED" &&
        (assignment.trainingProgram.requiresExam ? progressPercent < 80 : progressPercent < 100),
      canTakeExam: exam ? exam.status === "AVAILABLE" || exam.status === "IN_PROGRESS" : false,
    };
  }

  private async ensureEmployees(companyId: string, employeeIds: string[]) {
    const employees = await this.prisma.employee.findMany({
      where: {
        companyId,
        id: {
          in: employeeIds,
        },
        isArchived: false,
      },
      select: {
        id: true,
      },
    });

    if (employees.length !== employeeIds.length) {
      throw new NotFoundException("Не все выбранные сотрудники найдены в компании.");
    }
  }

  private async findRawById(id: string) {
    const assignment = await this.prisma.trainingAssignment.findUnique({
      where: { id },
      include: trainingAssignmentInclude,
    });

    if (!assignment) {
      throw new NotFoundException("Назначенное обучение не найдено.");
    }

    return assignment;
  }

  private async ensureAccess(user: AuthenticatedUser, assignment: RawTrainingAssignment, prisma: PrismaService = this.prisma) {
    if (user.role === "EMPLOYEE_SIGNER") {
      const employee = await requireEmployeeScope(prisma, user);

      if (employee.id !== assignment.employeeId) {
        throw new NotFoundException("Назначенное обучение не найдено.");
      }

      return;
    }

    assertCompanyAccess(user, assignment.companyId);
  }

  private getArtifactIssuerName(trainingProgram: { issuerName: string | null }) {
    return trainingProgram.issuerName ?? "Цифровой журнал по ТБ";
  }

  private async ensureCompletionArtifacts(
    transaction: Prisma.TransactionClient,
    assignmentId: string,
  ) {
    const assignment = await transaction.trainingAssignment.findUnique({
      where: { id: assignmentId },
      include: {
        employee: true,
        trainingProgram: true,
        generatedDocuments: true,
        generatedCertificates: true,
      },
    });

    if (!assignment) {
      throw new NotFoundException("Назначенное обучение не найдено.");
    }

    const issuerName = this.getArtifactIssuerName(assignment.trainingProgram);
    const now = new Date();
    const expiryDate = new Date(now);
    expiryDate.setFullYear(expiryDate.getFullYear() + 1);

    if (assignment.trainingProgram.createsDocument) {
      const completionDocument = assignment.generatedDocuments.find(
        (document) => document.documentType === "COMPLETION_CONFIRMATION",
      );

      if (!completionDocument) {
        await transaction.employeeDocument.create({
          data: {
            companyId: assignment.companyId,
            employeeId: assignment.employeeId,
            trainingAssignmentId: assignment.id,
            title: `Подтверждение прохождения: ${assignment.trainingProgram.title}`,
            documentType: "COMPLETION_CONFIRMATION",
            issueDate: now,
            issuerName,
            status: "ACTIVE",
          },
        });
      }
    }

    if (assignment.trainingProgram.createsSafetyCertificate) {
      let certificateDocument = assignment.generatedDocuments.find(
        (document) => document.documentType === "SAFETY_CERTIFICATE",
      );

      if (!certificateDocument) {
        certificateDocument = await transaction.employeeDocument.create({
          data: {
            companyId: assignment.companyId,
            employeeId: assignment.employeeId,
            trainingAssignmentId: assignment.id,
            title: `Удостоверение по ТБ: ${assignment.trainingProgram.title}`,
            documentType: "SAFETY_CERTIFICATE",
            issueDate: now,
            expiryDate,
            issuerName,
            status: "ACTIVE",
          },
        });
      }

      const existingCertificate = assignment.generatedCertificates[0];

      if (!existingCertificate) {
        await transaction.safetyCertificate.create({
          data: {
            companyId: assignment.companyId,
            employeeId: assignment.employeeId,
            trainingAssignmentId: assignment.id,
            documentId: certificateDocument.id,
            certificateNumber: `TB-${new Date().getFullYear()}-${randomUUID().slice(0, 8).toUpperCase()}`,
            issueDate: now,
            expiryDate,
            issuerName,
            status: "ACTIVE",
          },
        });
      }
    }
  }

  async list(user: AuthenticatedUser, filters: TrainingProgramFilters) {
    const companyId = getCompanyScope(user, filters.companyId);
    const assignments = await this.prisma.trainingAssignment.findMany({
      where: {
        ...(companyId ? { companyId } : {}),
        ...(filters.employeeId ? { employeeId: filters.employeeId } : {}),
        ...(filters.search
          ? {
              OR: [
                {
                  employee: {
                    fullName: {
                      contains: filters.search,
                      mode: "insensitive",
                    },
                  },
                },
                {
                  trainingProgram: {
                    title: {
                      contains: filters.search,
                      mode: "insensitive",
                    },
                  },
                },
              ],
            }
          : {}),
      },
      include: trainingAssignmentInclude,
      orderBy: [{ dueAt: "asc" }, { createdAt: "desc" }],
    });

    const mapped = assignments.map((assignment) => this.mapAssignment(assignment));

    if (filters.status) {
      return mapped.filter((assignment) => assignment.status === filters.status);
    }

    return mapped;
  }

  async listMy(user: AuthenticatedUser) {
    const employee = await requireEmployeeScope(this.prisma, user);
    const assignments = await this.prisma.trainingAssignment.findMany({
      where: {
        employeeId: employee.id,
      },
      include: trainingAssignmentInclude,
      orderBy: [{ dueAt: "asc" }, { createdAt: "desc" }],
    });

    return assignments.map((assignment) => this.mapAssignment(assignment));
  }

  async findOne(user: AuthenticatedUser, id: string) {
    const assignment = await this.findRawById(id);
    await this.ensureAccess(user, assignment);
    return this.mapAssignment(assignment);
  }

  async create(user: AuthenticatedUser, input: CreateTrainingProgramInput) {
    const companyId = requireCompanyScope(user, input.companyId);
    const employeeIds = [...new Set(input.employeeIds)];

    await this.ensureEmployees(companyId, employeeIds);

    let programId = "";

    try {
      await this.prisma.$transaction(async (transaction) => {
        const program = await transaction.trainingProgram.create({
          data: {
            companyId,
            title: input.title,
            description: input.description,
            materialContent: input.materialContent ?? null,
            materialFileName: input.materialFileName ?? null,
            materialFileUrl: input.materialFileUrl ?? null,
            videoUrl: input.videoUrl ?? null,
            issuerName: input.issuerName ?? null,
            requiresExam: input.requiresExam,
            createsDocument: input.createsDocument,
            createsSafetyCertificate: input.createsSafetyCertificate,
          },
        });

        programId = program.id;

        await transaction.trainingAssignment.createMany({
          data: employeeIds.map((employeeId) => ({
            companyId,
            employeeId,
            trainingProgramId: program.id,
            assignedByUserId: user.userId,
            dueAt: input.dueAt ? new Date(input.dueAt) : null,
            status: "ASSIGNED",
            progressPercent: 0,
          })),
        });
        await this.auditService.log({
          actorUserId: user.userId,
          companyId,
          action: "training.created",
          entityType: "TrainingProgram",
          entityId: programId,
          metadata: {
            title: input.title,
            assigneeCount: employeeIds.length,
            requiresExam: input.requiresExam,
          },
        }, transaction);
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        throw new ConflictException("Обучение с таким названием уже существует в этой компании.");
      }

      throw error;
    }

    return {
      id: programId,
    };
  }

  async startMy(user: AuthenticatedUser, id: string) {
    const assignment = await this.findRawById(id);
    await this.ensureAccess(user, assignment);

    if (assignment.completedAt) {
      throw new BadRequestException("Обучение уже завершено.");
    }

    await this.prisma.$transaction(async (transaction) => {
      await lockTrainingAssignment(transaction, id);
      const current = await transaction.trainingAssignment.findUnique({
        where: { id }, include: trainingAssignmentInclude,
      });
      if (!current) throw new NotFoundException("Назначенное обучение не найдено.");
      await this.ensureAccess(user, current, transaction as unknown as PrismaService);
      if (assignment.companyId !== current.companyId || assignment.employeeId !== current.employeeId || assignment.trainingProgramId !== current.trainingProgramId) {
        throw new ConflictException("Назначение изменилось. Обновите страницу.");
      }
      if (current.completedAt) throw new BadRequestException("Обучение уже завершено.");
      await transaction.trainingAssignment.update({
        where: { id },
        data: {
          status: "IN_PROGRESS",
          startedAt: current.startedAt ?? new Date(),
          progressPercent: Math.max(current.progressPercent, 25),
        },
      });
      await this.auditService.log({
        actorUserId: user.userId,
        companyId: assignment.companyId,
        action: "training.started",
        entityType: "TrainingAssignment",
        entityId: assignment.id,
        metadata: { trainingProgramId: assignment.trainingProgramId },
      }, transaction);
    });

    return this.findOne(user, id);
  }

  async completeMy(user: AuthenticatedUser, id: string) {
    const assignment = await this.findRawById(id);
    await this.ensureAccess(user, assignment);

    if (assignment.completedAt) {
      throw new BadRequestException("Обучение уже завершено.");
    }

    if (assignment.trainingProgram.requiresExam) {
      await this.prisma.$transaction(async (transaction) => {
        await lockTrainingAssignment(transaction, id);
        const current = await transaction.trainingAssignment.findUnique({
          where: { id }, include: trainingAssignmentInclude,
        });
        if (!current) throw new NotFoundException("Назначенное обучение не найдено.");
        await this.ensureAccess(user, current, transaction as unknown as PrismaService);
        if (assignment.companyId !== current.companyId || assignment.employeeId !== current.employeeId || assignment.trainingProgramId !== current.trainingProgramId) {
          throw new ConflictException("Назначение изменилось. Обновите страницу.");
        }
        if (current.completedAt) throw new BadRequestException("Обучение уже завершено.");
        if (!current.trainingProgram.requiresExam) throw new ConflictException("Программа обучения изменилась. Обновите страницу.");
        await transaction.trainingAssignment.update({
          where: { id },
          data: {
            status: "IN_PROGRESS",
            startedAt: current.startedAt ?? new Date(),
            progressPercent: Math.max(current.progressPercent, 80),
          },
        });
        await this.auditService.log({
          actorUserId: user.userId,
          companyId: assignment.companyId,
          action: "training.material_completed",
          entityType: "TrainingAssignment",
          entityId: assignment.id,
          metadata: { trainingProgramId: assignment.trainingProgramId, requiresExam: true },
        }, transaction);
      });

      return this.findOne(user, id);
    }

    await this.completeAfterPassedExam(id, user, false);
    return this.findOne(user, id);
  }

  async completeAfterPassedExam(
    assignmentId: string,
    user: AuthenticatedUser,
    fromExam = true,
    commitExamAttempt?: (transaction: Prisma.TransactionClient) => Promise<void>,
    auditExamSubmission?: (transaction: Prisma.TransactionClient) => Promise<void>,
  ) {
    const assignment = await this.findRawById(assignmentId);
    await this.ensureAccess(user, assignment);

    if (assignment.completedAt && !commitExamAttempt) {
      return this.mapAssignment(assignment);
    }

    const completed = await this.prisma.$transaction(async (transaction) => {
      await lockTrainingAssignment(transaction, assignmentId);
      const current = await transaction.trainingAssignment.findUnique({
        where: { id: assignmentId }, include: trainingAssignmentInclude,
      });
      if (!current) throw new NotFoundException("Назначенное обучение не найдено.");
      await this.ensureAccess(user, current, transaction as unknown as PrismaService);
      if (assignment.companyId !== current.companyId || assignment.employeeId !== current.employeeId || assignment.trainingProgramId !== current.trainingProgramId) {
        throw new ConflictException("Назначение изменилось. Обновите страницу.");
      }
      if (assignment.completedAt && current.completedAt) {
        if (commitExamAttempt) await commitExamAttempt(transaction);
        if (auditExamSubmission) await auditExamSubmission(transaction);
        return false;
      }
      if (current.completedAt) {
        throw new ConflictException("Обучение уже завершено. Обновите страницу.");
      }
      const completedAt = new Date();

      const result = await transaction.trainingAssignment.updateMany({
        where: { id: assignmentId, completedAt: null },
        data: {
          status: "COMPLETED",
          startedAt: current.startedAt ?? completedAt,
          progressPercent: 100,
          completedAt,
          ...(fromExam ? { examPassedAt: completedAt } : {}),
        },
      });

      if (result.count === 0) {
        throw new ConflictException("Обучение уже завершено. Обновите страницу.");
      }

      if (commitExamAttempt) {
        await commitExamAttempt(transaction);
      }
      await this.ensureCompletionArtifacts(transaction, assignmentId);
      await this.auditService.log({
        actorUserId: user.userId,
        companyId: assignment.companyId,
        action: "training.completed",
        entityType: "TrainingAssignment",
        entityId: assignment.id,
        metadata: {
          trainingProgramId: assignment.trainingProgramId,
          completedViaExam: fromExam,
        },
      }, transaction);
      if (auditExamSubmission) await auditExamSubmission(transaction);
      return true;
    });

    return completed ? this.findOne(user, assignmentId) : this.mapAssignment(assignment);
  }
}
