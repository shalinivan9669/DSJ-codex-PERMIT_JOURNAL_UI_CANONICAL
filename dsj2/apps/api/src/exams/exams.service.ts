import { BadRequestException, ConflictException, Injectable, NotFoundException } from "@nestjs/common";
import type {
  CreateExamInput,
  ExamFilters,
  SubmitExamInput,
} from "@dsj/types";
import { Prisma } from "@prisma/client";
import { AuditService } from "../audit/audit.service";
import type { AuthenticatedUser } from "../common/types/authenticated-user.type";
import { requireEmployeeScope } from "../common/utils/employee-scope";
import {
  assertCompanyAccess,
  getCompanyScope,
  requireCompanyScope,
} from "../common/utils/tenant-scope";
import { PrismaService } from "../database/prisma.service";
import { TrainingProgramsService } from "../training-programs/training-programs.service";
import { lockTrainingAssignment } from "../training-programs/training-assignment-lock";

const employeeExamAssignmentInclude = {
  employee: true,
  trainingProgram: {
    include: {
      exam: {
        include: {
          questions: {
            orderBy: {
              sortOrder: "asc",
            },
            include: {
              options: {
                orderBy: {
                  sortOrder: "asc",
                },
              },
            },
          },
        },
      },
    },
  },
  examAttempts: {
    orderBy: [{ submittedAt: "desc" }, { createdAt: "desc" }],
  },
} satisfies Prisma.TrainingAssignmentInclude;

type EmployeeExamAssignment = Prisma.TrainingAssignmentGetPayload<{
  include: typeof employeeExamAssignmentInclude;
}>;

@Injectable()
export class ExamsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly trainingProgramsService: TrainingProgramsService,
  ) {}

  private getEffectiveTrainingStatus(assignment: {
    status: EmployeeExamAssignment["status"];
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

  private getEmployeeExamStatus(assignment: EmployeeExamAssignment) {
    const exam = assignment.trainingProgram.exam;

    if (!exam) {
      return null;
    }

    const latestAttempt = assignment.examAttempts[0] ?? null;
    const submittedAttempts = assignment.examAttempts.filter((attempt) => attempt.status === "SUBMITTED");

    if (assignment.examPassedAt || latestAttempt?.passed) {
      return {
        status: "PASSED" as const,
        result: latestAttempt?.score ?? null,
        attemptsUsed: submittedAttempts.length,
      };
    }

    if (latestAttempt?.status === "IN_PROGRESS") {
      return {
        status: "IN_PROGRESS" as const,
        result: null,
        attemptsUsed: submittedAttempts.length,
      };
    }

    if (latestAttempt?.status === "SUBMITTED" && latestAttempt.passed === false && submittedAttempts.length >= exam.maxAttempts) {
      return {
        status: "FAILED" as const,
        result: latestAttempt.score ?? null,
        attemptsUsed: submittedAttempts.length,
      };
    }

    if (assignment.progressPercent >= 80 || assignment.completedAt) {
      return {
        status: "AVAILABLE" as const,
        result: latestAttempt?.score ?? null,
        attemptsUsed: submittedAttempts.length,
      };
    }

    return {
      status: "NOT_STARTED" as const,
      result: latestAttempt?.score ?? null,
      attemptsUsed: submittedAttempts.length,
    };
  }

  private async ensureTrainingProgram(companyId: string, trainingProgramId: string) {
    const program = await this.prisma.trainingProgram.findFirst({
      where: {
        id: trainingProgramId,
        companyId,
      },
      include: {
        exam: true,
      },
    });

    if (!program) {
      throw new NotFoundException("Программа обучения не найдена.");
    }

    return program;
  }

  private async findEmployeeAssignmentById(id: string) {
    const assignment = await this.prisma.trainingAssignment.findUnique({
      where: { id },
      include: employeeExamAssignmentInclude,
    });

    if (!assignment) {
      throw new NotFoundException("Назначенный тест не найден.");
    }

    if (!assignment.trainingProgram.exam) {
      throw new NotFoundException("Для этого обучения тест не назначен.");
    }

    return assignment;
  }

  private async ensureEmployeeAccess(user: AuthenticatedUser, assignment: EmployeeExamAssignment, prisma: PrismaService = this.prisma) {
    const employee = await requireEmployeeScope(prisma, user);

    if (employee.id !== assignment.employeeId) {
      throw new NotFoundException("Назначенный тест не найден.");
    }

    return employee;
  }

  private ensureSameAssignment(
    before: Pick<EmployeeExamAssignment, "companyId" | "employeeId" | "trainingProgramId">,
    current: Pick<EmployeeExamAssignment, "companyId" | "employeeId" | "trainingProgramId">,
  ) {
    if (before.companyId !== current.companyId || before.employeeId !== current.employeeId || before.trainingProgramId !== current.trainingProgramId) {
      throw new ConflictException("Назначение изменилось. Обновите страницу.");
    }
  }

  private mapEmployeeExam(assignment: EmployeeExamAssignment) {
    const exam = assignment.trainingProgram.exam;

    if (!exam) {
      throw new NotFoundException("Для этого обучения тест не назначен.");
    }

    const status = this.getEmployeeExamStatus(assignment);
    const currentAttempt = assignment.examAttempts.find((attempt) => attempt.status === "IN_PROGRESS") ?? null;
    const latestSubmittedAttempt =
      assignment.examAttempts.find((attempt) => attempt.status === "SUBMITTED") ?? null;
    const passedAttempt = assignment.examAttempts.find(
      (attempt) => attempt.status === "SUBMITTED" && attempt.passed,
    ) ?? null;

    return {
      id: exam.id,
      assignmentId: assignment.id,
      companyId: assignment.companyId,
      trainingTitle: assignment.trainingProgram.title,
      description: exam.description,
      passingScore: exam.passingScore,
      maxAttempts: exam.maxAttempts,
      questionCount: exam.questions.length,
      dueAt: assignment.dueAt,
      trainingStatus: this.getEffectiveTrainingStatus(assignment),
      status: status?.status ?? "NOT_STARTED",
      result: assignment.examPassedAt ? passedAttempt?.score ?? null : latestSubmittedAttempt?.score ?? null,
      passed: assignment.examPassedAt ? true : latestSubmittedAttempt?.passed ?? false,
      passedAt: assignment.examPassedAt ??
        (latestSubmittedAttempt?.passed ? latestSubmittedAttempt.submittedAt : null),
      attemptsUsed: status?.attemptsUsed ?? 0,
      attemptsRemaining: Math.max(exam.maxAttempts - (status?.attemptsUsed ?? 0), 0),
      currentAttempt: currentAttempt
        ? {
            id: currentAttempt.id,
            startedAt: currentAttempt.startedAt,
          }
        : null,
      questions: exam.questions.map((question) => ({
        id: question.id,
        prompt: question.prompt,
        options: question.options.map((option) => ({
          id: option.id,
          text: option.text,
        })),
      })),
    };
  }

  async list(user: AuthenticatedUser, filters: ExamFilters) {
    const companyId = getCompanyScope(user, filters.companyId);
    const exams = await this.prisma.exam.findMany({
      where: {
        ...(companyId ? { companyId } : {}),
        ...(filters.search
          ? {
              OR: [
                {
                  title: {
                    contains: filters.search,
                    mode: "insensitive",
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
      include: {
        trainingProgram: true,
        questions: {
          include: {
            options: true,
          },
          orderBy: {
            sortOrder: "asc",
          },
        },
        _count: {
          select: {
            attempts: true,
          },
        },
      },
      orderBy: [{ createdAt: "desc" }],
    });

    return exams.map((exam) => ({
      id: exam.id,
      companyId: exam.companyId,
      trainingProgramId: exam.trainingProgramId,
      title: exam.title,
      description: exam.description,
      passingScore: exam.passingScore,
      maxAttempts: exam.maxAttempts,
      isActive: exam.isActive,
      attemptCount: exam._count.attempts,
      questionCount: exam.questions.length,
      trainingProgram: {
        id: exam.trainingProgram.id,
        title: exam.trainingProgram.title,
      },
      questions: exam.questions.map((question) => ({
        id: question.id,
        prompt: question.prompt,
        options: question.options.map((option) => ({
          id: option.id,
          text: option.text,
          isCorrect: option.isCorrect,
        })),
      })),
    }));
  }

  async findOne(user: AuthenticatedUser, id: string) {
    const exam = await this.prisma.exam.findUnique({
      where: { id },
      include: {
        trainingProgram: true,
        questions: {
          include: {
            options: true,
          },
          orderBy: {
            sortOrder: "asc",
          },
        },
      },
    });

    if (!exam) {
      throw new NotFoundException("Тест не найден.");
    }

    assertCompanyAccess(user, exam.companyId);

    return {
      id: exam.id,
      companyId: exam.companyId,
      trainingProgramId: exam.trainingProgramId,
      title: exam.title,
      description: exam.description,
      passingScore: exam.passingScore,
      maxAttempts: exam.maxAttempts,
      isActive: exam.isActive,
      trainingProgram: {
        id: exam.trainingProgram.id,
        title: exam.trainingProgram.title,
      },
      questions: exam.questions.map((question) => ({
        id: question.id,
        prompt: question.prompt,
        options: question.options.map((option) => ({
          id: option.id,
          text: option.text,
          isCorrect: option.isCorrect,
        })),
      })),
    };
  }

  async listMy(user: AuthenticatedUser) {
    const employee = await requireEmployeeScope(this.prisma, user);
    const assignments = await this.prisma.trainingAssignment.findMany({
      where: {
        employeeId: employee.id,
        trainingProgram: {
          exam: {
            isNot: null,
          },
        },
      },
      include: employeeExamAssignmentInclude,
      orderBy: [{ dueAt: "asc" }, { createdAt: "desc" }],
    });

    return assignments.map((assignment) => {
      const mapped = this.mapEmployeeExam(assignment);
      return {
        id: mapped.id,
        assignmentId: mapped.assignmentId,
        trainingTitle: mapped.trainingTitle,
        description: mapped.description,
        passingScore: mapped.passingScore,
        maxAttempts: mapped.maxAttempts,
        questionCount: mapped.questionCount,
        dueAt: mapped.dueAt,
        status: mapped.status,
        result: mapped.result,
        attemptsUsed: mapped.attemptsUsed,
        passedAt: mapped.passedAt,
      };
    });
  }

  async findMy(user: AuthenticatedUser, assignmentId: string) {
    const assignment = await this.findEmployeeAssignmentById(assignmentId);
    await this.ensureEmployeeAccess(user, assignment);
    return this.mapEmployeeExam(assignment);
  }

  async create(user: AuthenticatedUser, input: CreateExamInput) {
    const companyId = requireCompanyScope(user, input.companyId);
    const trainingProgram = await this.ensureTrainingProgram(companyId, input.trainingProgramId);

    if (!trainingProgram.isActive) {
      throw new BadRequestException("Нельзя создать тест для неактивной программы обучения.");
    }

    if (trainingProgram.exam) {
      throw new ConflictException("Для этой программы обучения тест уже создан.");
    }

    const exam = await this.prisma.$transaction(async (transaction) => {
      const createdExam = await transaction.exam.create({
      data: {
        companyId,
        trainingProgramId: input.trainingProgramId,
        title: input.title,
        description: input.description ?? null,
        passingScore: input.passingScore,
        maxAttempts: input.maxAttempts,
        questions: {
          create: input.questions.map((question, questionIndex) => ({
            prompt: question.prompt,
            sortOrder: questionIndex,
            options: {
              create: question.options.map((option, optionIndex) => ({
                text: option,
                sortOrder: optionIndex,
                isCorrect: optionIndex === question.correctOptionIndex,
              })),
            },
          })),
        },
      },
      });

      await transaction.trainingProgram.update({
        where: { id: trainingProgram.id },
        data: { requiresExam: true },
      });
      await this.auditService.log({
        actorUserId: user.userId,
        companyId,
        action: "exam.created",
        entityType: "Exam",
        entityId: createdExam.id,
        metadata: { trainingProgramId: createdExam.trainingProgramId, title: createdExam.title },
      }, transaction);
      return createdExam;
    });

    return this.findOne(user, exam.id);
  }

  async startMy(user: AuthenticatedUser, assignmentId: string) {
    const assignment = await this.findEmployeeAssignmentById(assignmentId);
    await this.ensureEmployeeAccess(user, assignment);

    const attempt = await this.prisma.$transaction(async (transaction) => {
      await lockTrainingAssignment(transaction, assignmentId);
      const current = await transaction.trainingAssignment.findUnique({
        where: { id: assignmentId }, include: employeeExamAssignmentInclude,
      });
      if (!current) throw new NotFoundException("Назначенный тест не найден.");
      await this.ensureEmployeeAccess(user, current, transaction as unknown as PrismaService);
      this.ensureSameAssignment(assignment, current);
      const exam = current.trainingProgram.exam;
      if (!exam) throw new NotFoundException("Для этого обучения тест не назначен.");
      if (current.examPassedAt) throw new BadRequestException("Тест уже успешно сдан.");
      if (current.progressPercent < 80) throw new BadRequestException("Сначала завершите изучение материала обучения.");
      if (current.examAttempts.some((item) => item.status === "IN_PROGRESS")) return null;
      const submitted = current.examAttempts.filter((item) => item.status === "SUBMITTED");
      if (submitted.length >= exam.maxAttempts) throw new BadRequestException("Лимит попыток исчерпан.");

      const createdAttempt = await transaction.examAttempt.create({
        data: {
          companyId: current.companyId,
          examId: exam.id,
          trainingAssignmentId: current.id,
          employeeId: current.employeeId,
          status: "IN_PROGRESS",
        },
      });
      await this.auditService.log({
        actorUserId: user.userId,
        companyId: assignment.companyId,
        action: "exam.started",
        entityType: "ExamAttempt",
        entityId: createdAttempt.id,
        metadata: { examId: createdAttempt.examId, trainingAssignmentId: assignment.id },
      }, transaction);
      return createdAttempt;
    });

    if (!attempt) return this.findMy(user, assignmentId);

    return this.findMy(user, assignmentId);
  }

  async submitMy(user: AuthenticatedUser, assignmentId: string, input: SubmitExamInput) {
    const assignment = await this.findEmployeeAssignmentById(assignmentId);
    await this.ensureEmployeeAccess(user, assignment);

    const exam = assignment.trainingProgram.exam;

    if (!exam) {
      throw new NotFoundException("Для этого обучения тест не назначен.");
    }

    const currentAttempt = assignment.examAttempts.find((attempt) => attempt.status === "IN_PROGRESS");

    if (!currentAttempt) {
      throw new BadRequestException("Сначала начните попытку тестирования.");
    }

    const questionsById = new Map(exam.questions.map((question) => [question.id, question]));
    const answeredQuestionIds = new Set<string>();

    if (!exam.questions.length || input.answers.length !== exam.questions.length) {
      throw new BadRequestException("Ответьте на каждый вопрос, выбрав один из предложенных вариантов.");
    }

    for (const answer of input.answers) {
      const question = questionsById.get(answer.questionId);
      if (
        !question ||
        answeredQuestionIds.has(answer.questionId) ||
        !question.options.some((option) => option.id === answer.optionId)
      ) {
        throw new BadRequestException("Ответьте на каждый вопрос, выбрав один из предложенных вариантов.");
      }
      answeredQuestionIds.add(answer.questionId);
    }

    const answersByQuestionId = new Map(
      input.answers.map((answer) => [answer.questionId, answer.optionId]),
    );

    let correctAnswers = 0;

    for (const question of exam.questions) {
      const selectedOptionId = answersByQuestionId.get(question.id);
      const correctOption = question.options.find((option) => option.isCorrect);

      if (selectedOptionId && correctOption && selectedOptionId === correctOption.id) {
        correctAnswers += 1;
      }
    }

    const score = Math.round((correctAnswers / exam.questions.length) * 100);
    const passed = score >= exam.passingScore;

    const submitAttempt = async (transaction: Pick<Prisma.TransactionClient, "examAttempt" | "trainingAssignment">) => {
      const current = await transaction.trainingAssignment.findUnique({
        where: { id: assignmentId },
        select: { companyId: true, employeeId: true, trainingProgramId: true },
      });
      if (!current) throw new NotFoundException("Назначенный тест не найден.");
      this.ensureSameAssignment(assignment, current);
      const result = await transaction.examAttempt.updateMany({
        where: { id: currentAttempt.id, status: "IN_PROGRESS" },
        data: {
          status: "SUBMITTED",
          score,
          passed,
          submittedAt: new Date(),
          answers: input.answers as Prisma.InputJsonValue,
        },
      });

      if (result.count !== 1) {
        throw new ConflictException("Попытка уже завершена. Обновите страницу.");
      }
    };

    const auditSubmission = async (transaction: Prisma.TransactionClient) => {
      await this.auditService.log({
        actorUserId: user.userId,
        companyId: assignment.companyId,
        action: "exam.submitted",
        entityType: "ExamAttempt",
        entityId: currentAttempt.id,
        metadata: { examId: exam.id, trainingAssignmentId: assignment.id, score, passed },
      }, transaction);
    };

    if (passed) {
      await this.trainingProgramsService.completeAfterPassedExam(assignmentId, user, true, submitAttempt, auditSubmission);
    } else {
      await this.prisma.$transaction(async (transaction) => {
        await lockTrainingAssignment(transaction, assignmentId);
        const current = await transaction.trainingAssignment.findUnique({
          where: { id: assignmentId }, include: employeeExamAssignmentInclude,
        });
        if (!current) throw new NotFoundException("Назначенный тест не найден.");
        await this.ensureEmployeeAccess(user, current, transaction as unknown as PrismaService);
        if (!assignment.examPassedAt && current.examPassedAt) {
          throw new ConflictException("Тест уже успешно сдан. Обновите страницу.");
        }
        await submitAttempt(transaction);
        await auditSubmission(transaction);
      });
    }

    return this.findMy(user, assignmentId);
  }
}
