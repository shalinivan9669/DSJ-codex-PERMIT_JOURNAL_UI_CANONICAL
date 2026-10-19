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
          sourceId: z.string().uuid().optional(),
          sourceRevisionId: z.string().uuid().optional(),
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
    practiceEvidenceMode: z
      .enum(["UNSPECIFIED", "REVIEWED_ASSIGNMENTS", "IN_PERSON"])
      .optional(),
    requiresProctoring: z.boolean().default(false),
    proctoringMode: z.enum(["UNSPECIFIED", "LOCAL_SUPERVISED"]).optional(),
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

const answerIds = z.array(z.string().min(1).max(100)).max(20);
const answerOption = z
  .object({ id: z.string().min(1).max(100), textRu: label, textKz: label })
  .strict();
const responseSpecs = [
  z.object({ kind: z.literal("SINGLE"), correctOptionIds: answerIds }).strict(),
  z
    .object({ kind: z.literal("MULTIPLE"), correctOptionIds: answerIds })
    .strict(),
  z
    .object({
      kind: z.literal("MATCHING"),
      pairs: z
        .array(
          z
            .object({
              leftId: z.string().min(1).max(100),
              rightId: z.string().min(1).max(100),
            })
            .strict(),
        )
        .max(20),
      rightOptions: z.array(answerOption).max(20),
    })
    .strict(),
  z
    .object({ kind: z.literal("ORDERING"), correctOrderIds: answerIds })
    .strict(),
  z
    .object({
      kind: z.literal("TEXT"),
      mode: z.literal("EXACT"),
      acceptedAnswers: z.array(z.string().max(10000)).max(100),
      caseSensitive: z.boolean(),
      collapseWhitespace: z.boolean(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("TEXT"),
      mode: z.literal("MANUAL"),
      criteriaRu: z.string().max(10000),
      criteriaKz: z.string().max(10000),
    })
    .strict(),
] as const;
export const questionResponseSpecSchema = z.union(responseSpecs);
export const questionAnswerSpecSchema = z.union([
  ...responseSpecs,
  z
    .object({
      kind: z.literal("CASE"),
      contextRu: z.string().max(20000),
      contextKz: z.string().max(20000),
      response: questionResponseSpecSchema,
    })
    .strict(),
]);
export const learningAnswerSchema = z.union([
  answerIds,
  z
    .object({ kind: z.enum(["SINGLE", "MULTIPLE"]), optionIds: answerIds })
    .strict(),
  z
    .object({
      kind: z.literal("MATCHING"),
      pairs: z
        .array(
          z
            .object({
              leftId: z.string().min(1).max(100),
              rightId: z.string().min(1).max(100),
            })
            .strict(),
        )
        .max(20),
    })
    .strict(),
  z.object({ kind: z.literal("ORDERING"), optionIds: answerIds }).strict(),
  z.object({ kind: z.literal("TEXT"), text: z.string().max(10000) }).strict(),
]);
export type LearningAnswer = z.infer<typeof learningAnswerSchema>;
export type LearningAnswers = Record<string, LearningAnswer>;
export type QuestionAnswerSpec = z.infer<typeof questionAnswerSpecSchema>;
export const accessPolicySchema = z
  .object({
    mode: z.enum(["UNLIMITED", "DAYS", "FIXED"]),
    days: z.number().int().min(1).max(3650).optional(),
    startsAt: z.string().datetime().nullable().optional(),
    endsAt: z.string().datetime().nullable().optional(),
    timezone: z.string().max(100),
  })
  .strict();
export type AccessPolicy = z.infer<typeof accessPolicySchema>;

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
    answerSpec: questionAnswerSpecSchema.optional(),
  })
  .strict();
export const lmsAssessmentSchema = z
  .object({
    questions: z.array(lmsQuestionSchema).max(5000),
    questionCount: z.number().int().min(1).max(500).default(10),
    durationMinutes: z.number().int().min(1).max(480).default(30),
    maxAttempts: z.number().int().min(1).max(20).default(3),
    thresholdPercent: z.number().min(0).max(100).default(80),
    comparison: z.enum(["GT", "GTE"]).default("GTE"),
    revealAnswers: z.boolean().default(false),
    dueAt: z.string().datetime().nullable().optional(),
  })
  .strict();
export const lmsAssignmentSchema = z
  .object({
    instructionsRu: z.string().max(30000),
    instructionsKz: z.string().max(30000),
    criteriaRu: z.string().max(10000),
    criteriaKz: z.string().max(10000),
    allowText: z.boolean(),
    allowFiles: z.boolean(),
    maxSubmissions: z.number().int().min(1).max(100),
    dueAt: z.string().datetime().nullable().optional(),
  })
  .strict();
export const lmsLessonSchema = z
  .object({
    id: z.string().min(1).max(100),
    titleRu: label,
    titleKz: label,
    kind: z.enum([
      "TEXT",
      "PDF",
      "VIDEO",
      "FILE",
      "LINK",
      "ASSESSMENT",
      "ASSIGNMENT",
      "SESSION",
    ]),
    textRu: z.string().max(100000).default(""),
    textKz: z.string().max(100000).default(""),
    materialId: z.string().max(100).nullable().default(null),
    durationSeconds: z.number().positive().max(86400).nullable().default(null),
    required: z.boolean().default(true),
    prerequisiteLessonIds: z.array(z.string().max(100)).max(1000).default([]),
    assessment: lmsAssessmentSchema.optional(),
    assignment: lmsAssignmentSchema.optional(),
    session: z.object({ attendanceRequired: z.boolean() }).strict().optional(),
    url: z.string().max(2000).optional(),
    videoPolicy: z
      .object({
        minimumPercent: z.number().min(1).max(100),
        allowSeekAhead: z.boolean(),
        playbackRates: z.array(z.number().min(0.25).max(3)).min(1).max(10),
      })
      .strict()
      .optional(),
    subtitles: z
      .array(
        z
          .object({
            materialId: z.string().min(1).max(100),
            language: z.string().min(2).max(20),
            label: z.string().max(100),
          })
          .strict(),
      )
      .max(10)
      .optional(),
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
    accessPolicy: accessPolicySchema.optional(),
    learningOutcome: z.enum(["LEARNING", "REGULATED"]).optional(),
    metadata: z
      .object({
        goalRu: z.string().max(10000),
        goalKz: z.string().max(10000),
        audienceRu: z.string().max(10000),
        audienceKz: z.string().max(10000),
        format: z.enum(["ONLINE", "BLENDED", "IN_PERSON"]),
        durationDays: z.number().int().min(1).max(3650).optional(),
        documentValidity: z.string().max(1000),
        trainingRecurrence: z.string().max(1000),
        parameterSource: z.string().max(3000),
        updatedOn: z.string().date().nullable().optional(),
      })
      .strict()
      .optional(),
    coursePrerequisites: z
      .array(
        z
          .object({
            courseId: z.string().min(1).max(100),
            basis: z.enum([
              "ELEMENTS",
              "LEARNING_COMPLETION",
              "OFFICIAL_RESULT",
            ]),
            versionPolicy: z.enum(["ANY", "AT_LEAST"]),
            minimumVersion: z.number().int().positive().optional(),
          })
          .strict(),
      )
      .max(100)
      .optional(),
    modules: z
      .array(
        z.object({
          id: z.string().min(1).max(100),
          titleRu: label,
          titleKz: label,
          prerequisiteModuleIds: z
            .array(z.string().min(1).max(100))
            .max(100)
            .optional(),
          lessons: z.array(lmsLessonSchema).max(1000),
        }),
      )
      .max(100),
    exam: lmsAssessmentSchema,
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
