import { z } from "zod";

const label = z.string().trim().max(1000).default("");
export const assessmentKindSchema = z.enum([
  "PRACTICE",
  "CENTER_EXAM",
  "EXTERNAL_AUTHORIZED",
]);
export const legalFormSchema = z.enum([
  "PAPER_ORIGINAL",
  "ELECTRONIC_ORIGINAL",
  "COPY_OF_ORIGINAL",
  "INFORMATION_CARD",
]);
export const regulatoryProfileSchema = z
  .object({
    title: z.string().trim().min(1).max(500),
    status: z
      .enum(["DRAFT", "CONFIRMED", "NEEDS_LEGAL_REVIEW"])
      .default("NEEDS_LEGAL_REVIEW"),
    synthetic: z.boolean().default(false),
    category: label,
    competency: z
      .enum(["GENERAL", "SPECIAL", "HYGIENE", "OTHER"])
      .default("OTHER"),
    sources: z
      .array(
        z.object({
          title: z.string().min(1).max(1000),
          url: z.string().max(2000),
          revision: label,
          number: z.string().max(300).optional(),
          date: z.string().date().nullable().optional(),
          authority: z.string().max(1000).optional(),
          article: z.string().max(300).optional(),
          paragraph: z.string().max(300).optional(),
          subparagraph: z.string().max(300).optional(),
          effectiveOn: z.string().date().nullable().optional(),
          status: z
            .enum([
              "CURRENT",
              "CHANGES_EXPECTED",
              "CHANGED",
              "REPEALED",
              "REVIEW_REQUIRED",
            ])
            .optional(),
        }),
      )
      .max(50)
      .default([]),
    effectiveFrom: z.string().date().nullable().default(null),
    effectiveUntil: z.string().date().nullable().default(null),
    reviewReference: label,
    assessmentKind: assessmentKindSchema.default("PRACTICE"),
    examiner: label,
    issuer: label,
    commissionKind: z
      .enum(["NONE", "CENTER", "EMPLOYER", "EXTERNAL"])
      .default("NONE"),
    commission: z
      .array(
        z.object({
          name: z.string().min(1).max(300),
          role: z.string().min(1).max(300),
        }),
      )
      .max(30)
      .default([]),
    requiredSignatures: z.array(z.string().min(1).max(200)).max(30).default([]),
    requiresApproval: z.boolean().default(true),
    requiresPractice: z.boolean().default(false),
    requiresProctoring: z.boolean().default(false),
    externalEvidenceLevel: z
      .enum(["DOCUMENT_REVIEWED", "MACHINE_VERIFIED"])
      .default("MACHINE_VERIFIED"),
    legalForm: legalFormSchema.default("INFORMATION_CARD"),
    documentTypes: z
      .array(z.enum(["PROTOCOL", "CERTIFICATE", "CREDENTIAL"]))
      .max(3)
      .default([]),
    templateIds: z.record(z.string(), z.string().max(100)).default({}),
    sanitary: z.boolean().default(false),
    destination: z.string().max(100).default("NOT_CONNECTED"),
    calendarVersionId: z.string().max(100).nullable().default(null),
    timezone: z.string().max(100).default("Asia/Qyzylorda"),
    cutoff: z
      .string()
      .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
      .default("18:00"),
    requiresEmployeeSignature: z.boolean().default(true),
  })
  .strict();
export type RegulatoryProfile = z.infer<typeof regulatoryProfileSchema>;

export const lmsQuestionSchema = z
  .object({
    id: z.string().min(1).max(100),
    version: z.number().int().positive().default(1),
    category: label,
    promptRu: label,
    promptKz: label,
    topic: z.string().max(1000).optional(),
    explanationRu: z.string().max(10000).optional(),
    explanationKz: z.string().max(10000).optional(),
    difficulty: z.enum(["UNKNOWN", "EASY", "MEDIUM", "HARD"]).optional(),
    source: z.string().max(2000).optional(),
    libraryQuestionId: z.string().max(100).nullable().optional(),
    libraryRevisionId: z.string().max(100).nullable().optional(),
    options: z
      .array(
        z.object({
          id: z.string().min(1).max(100),
          textRu: label,
          textKz: label,
        }),
      )
      .max(20),
    correctOptionIds: z.array(z.string().min(1).max(100)).max(20),
    multiple: z.boolean().default(false),
  })
  .strict();
export const lmsLessonSchema = z
  .object({
    id: z.string().min(1).max(100),
    titleRu: label,
    titleKz: label,
    kind: z.enum(["TEXT", "PDF", "VIDEO"]),
    textRu: z.string().max(100000).default(""),
    textKz: z.string().max(100000).default(""),
    materialId: z.string().max(100).nullable().default(null),
    durationSeconds: z.number().positive().max(86400).nullable().default(null),
    required: z.boolean().default(true),
    prerequisiteLessonIds: z.array(z.string().max(100)).max(1000).default([]),
  })
  .strict();
export const courseContentSchema = z
  .object({
    titleRu: label,
    titleKz: label,
    descriptionRu: z.string().max(20000).default(""),
    descriptionKz: z.string().max(20000).default(""),
    category: label,
    hours: z.number().min(0).max(10000).default(1),
    accessDays: z.number().int().min(1).max(3650).default(90),
    modules: z
      .array(
        z.object({
          id: z.string().min(1).max(100),
          titleRu: label,
          titleKz: label,
          lessons: z.array(lmsLessonSchema).max(1000),
        }),
      )
      .max(100),
    exam: z
      .object({
        questions: z.array(lmsQuestionSchema).max(5000),
        questionCount: z.number().int().min(1).max(500).default(10),
        durationMinutes: z.number().int().min(1).max(480).default(30),
        maxAttempts: z.number().int().min(1).max(20).default(3),
        thresholdPercent: z.number().min(0).max(100).default(80),
        comparison: z.enum(["GT", "GTE"]).default("GTE"),
        revealAnswers: z.boolean().default(false),
      })
      .strict(),
  })
  .strict();
export type CourseContent = z.infer<typeof courseContentSchema>;
export type LmsLesson = z.infer<typeof lmsLessonSchema>;
export type LmsQuestion = z.infer<typeof lmsQuestionSchema>;
export type AssessmentKind = z.infer<typeof assessmentKindSchema>;
export type LegalForm = z.infer<typeof legalFormSchema>;

export const consentVersion = "lms-personal-data-2026-10-15-v1";
export const consentText = {
  ru: "Согласен на обработку учебным центром данных моей учётной записи, обучения и результатов для организации обучения и подготовки документов. Внешняя передача требует отдельного применимого основания.",
  kz: "Оқуды ұйымдастыру және құжаттарды дайындау үшін оқу орталығының тіркелгі, оқу және нәтижелер туралы деректерімді өңдеуіне келісемін. Сыртқа беру үшін бөлек тиісті негіз қажет.",
};
