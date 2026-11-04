import { z } from "zod";

export const trainingAssignmentStatusSchema = z.enum([
  "ASSIGNED",
  "IN_PROGRESS",
  "COMPLETED",
  "OVERDUE",
]);

export const examAttemptStatusSchema = z.enum(["IN_PROGRESS", "SUBMITTED"]);

export const trainingProgramSchema = z.object({
  id: z.string(),
  companyId: z.string(),
  title: z.string(),
  description: z.string(),
  materialContent: z.string().nullable(),
  materialFileName: z.string().nullable(),
  materialFileUrl: z.string().nullable(),
  videoUrl: z.string().nullable(),
  issuerName: z.string().nullable(),
  requiresExam: z.boolean(),
  createsDocument: z.boolean(),
  createsSafetyCertificate: z.boolean(),
  isActive: z.boolean(),
});

export const createTrainingProgramSchema = z.object({
  companyId: z.string().optional(),
  employeeIds: z.array(z.string()).min(1),
  title: z.string().min(3),
  description: z.string().min(10),
  materialContent: z.string().max(12000).nullable().optional(),
  materialFileName: z.string().max(255).nullable().optional(),
  materialFileUrl: z.string().url().max(2000).nullable().optional(),
  videoUrl: z.string().url().max(2000).nullable().optional(),
  issuerName: z.string().max(255).nullable().optional(),
  dueAt: z.string().nullable().optional(),
  requiresExam: z.boolean().default(false),
  createsDocument: z.boolean().default(false),
  createsSafetyCertificate: z.boolean().default(false),
});

export const trainingProgramFilterSchema = z.object({
  companyId: z.string().optional(),
  employeeId: z.string().optional(),
  status: trainingAssignmentStatusSchema.optional(),
  search: z.string().optional(),
});

export const examQuestionInputSchema = z.object({
  prompt: z.string().min(5),
  options: z.array(z.string().min(1)).min(2).max(4),
  correctOptionIndex: z.number().int().min(0).max(3),
}).superRefine((value, context) => {
  if (value.correctOptionIndex >= value.options.length) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Индекс правильного ответа выходит за пределы вариантов.",
      path: ["correctOptionIndex"],
    });
  }
});

export const createExamSchema = z.object({
  companyId: z.string().optional(),
  trainingProgramId: z.string(),
  title: z.string().min(3),
  description: z.string().max(2000).nullable().optional(),
  passingScore: z.number().int().min(1).max(100),
  maxAttempts: z.number().int().min(1).max(10).default(3),
  questions: z.array(examQuestionInputSchema).min(1).max(10),
});

export const submitExamSchema = z.object({
  answers: z.array(
    z.object({
      questionId: z.string(),
      optionId: z.string(),
    }),
  ).min(1).max(10),
});

export const examFilterSchema = z.object({
  companyId: z.string().optional(),
  employeeId: z.string().optional(),
  search: z.string().optional(),
});

export type TrainingAssignmentStatus = z.infer<typeof trainingAssignmentStatusSchema>;
export type ExamAttemptStatus = z.infer<typeof examAttemptStatusSchema>;
export type TrainingProgram = z.infer<typeof trainingProgramSchema>;
export type CreateTrainingProgramInput = z.infer<typeof createTrainingProgramSchema>;
export type TrainingProgramFilters = z.infer<typeof trainingProgramFilterSchema>;
export type CreateExamInput = z.infer<typeof createExamSchema>;
export type SubmitExamInput = z.infer<typeof submitExamSchema>;
export type ExamFilters = z.infer<typeof examFilterSchema>;
