import { z } from "@demo/contracts";
import {
  courseContentSchema,
  regulatoryProfileSchema,
  type CourseContent,
  type RegulatoryProfile,
  type LmsQuestion,
  learningAnswerSchema,
  accessPolicySchema,
} from "@demo/contracts/src/lms";
import { fail } from "../core";
import { validateLearningStructure } from "./publication-validation";
import { assertLocalAssessmentSupported, regulatoryEffectiveFromIssue } from "./course-validation";

export const courseInputSchema = z
  .object({
    content: courseContentSchema,
    profile: regulatoryProfileSchema,
  })
  .strict();
export const versionInputSchema = courseInputSchema.extend({
  revision: z.number().int().nonnegative(),
});
export const revisionSchema = z
  .object({ revision: z.number().int().nonnegative() })
  .strict();
export const enrollInputSchema = z
  .object({
    repeatTraining: z.boolean().default(false),
    courseVersionId: z.string().min(1).max(100),
    recipientIds: z.array(z.string().min(1).max(100)).min(1).max(10000),
    customerId: z.string().max(100).nullable().optional(),
    groupName: z.string().max(300).default(""),
    operationId: z.string().uuid().optional(),
    groupId: z.string().max(100).optional(),
    sourceRequestId: z.string().max(100).nullable().optional(),
    sourceOrderId: z.string().max(100).nullable().optional(),
    dueAt: z.string().datetime().nullable().optional(),
    accessPolicy: accessPolicySchema.optional(),
  })
  .strict();
export const progressInputSchema = z
  .object({
    sequence: z.number().int().nonnegative(),
    positionSeconds: z.number().min(0).max(86400).default(0),
    playing: z.boolean().default(false),
    acknowledge: z.boolean().default(false),
      interacting: z.boolean().default(false),
    playbackRate: z.number().min(0.25).max(3).default(1),
  })
  .strict();
export const answersInputSchema = z
  .object({
    sequence: z.number().int().nonnegative(),
    answers: z.record(z.string().max(100), learningAnswerSchema),
  })
  .strict();
export const pagingSchema = z
  .object({
    dateFrom: z.string().datetime().optional(),
    dateTo: z.string().datetime().optional(),
    bin: z.string().max(12).optional(),
    city: z.string().max(200).optional(),
    teacherUserId: z.string().max(100).optional(),
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(250).default(50),
    search: z.string().max(300).default(""),
    status: z.string().max(50).optional(),
    courseVersionId: z.string().max(100).optional(),
    customerId: z.string().max(100).optional(),
    courseId: z.string().max(100).optional(),
    enrollmentId: z.string().uuid().optional(),
    groupId: z.string().max(100).optional(),
    groupKey: z.string().max(300).optional(),
    sourceRequestId: z.string().max(100).optional(),
    sourceOrderId: z.string().max(100).optional(),
    dueFrom: z.string().datetime().optional(),
    dueTo: z.string().datetime().optional(),
    view: z
      .enum([
        "ALL",
        "EXPIRING",
        "INCOMPLETE",
        "NEEDS_REVIEW",
        "WAITING_DOCUMENTS",
      ])
      .default("ALL"),
    expiringDays: z.coerce.number().int().min(1).max(365).default(14),
  })
  .strict();

/** Structural validity is checked when saving; publication requires a usable immutable program. */
export function assertPublishable(
  content: CourseContent,
  profile: RegulatoryProfile,
) {
  assertLocalAssessmentSupported(content, profile);
  const periodIssue = regulatoryEffectiveFromIssue(content, profile);
  if (periodIssue) fail(400, periodIssue.code, periodIssue.messageRu);
  validateLearningStructure(content);
  if (!content.titleRu.trim() || !content.titleKz.trim())
    fail(
      400,
      "COURSE_TITLE_REQUIRED",
      "Укажите название на русском и казахском",
    );
  const lessons = content.modules.flatMap((module) => module.lessons);
  const ids = lessons.map((lesson) => lesson.id);
  if (
    !lessons.length ||
    new Set(ids).size !== ids.length ||
    ids.includes("FINAL")
  )
    fail(
      400,
      "LESSON_IDS_INVALID",
      "Добавьте уроки с уникальными идентификаторами",
    );
  const seen = new Set<string>();
  for (const module of content.modules)
    if (!module.titleRu.trim() || !module.titleKz.trim())
      fail(
        400,
        "MODULE_TITLE_REQUIRED",
        `Укажите название модуля «${module.titleRu || module.id}» на двух языках`,
        { moduleId: module.id },
      );
  for (const lesson of lessons) {
    if (!lesson.titleRu.trim() || !lesson.titleKz.trim())
      fail(
        400,
        "LESSON_TITLE_REQUIRED",
        "Укажите название каждого урока на двух языках",
      );
    const invalidDependency = lesson.prerequisiteLessonIds.find(
      (id) => !seen.has(id),
    );
    if (invalidDependency)
      fail(
        400,
        "PREREQUISITE_INVALID",
        `Урок «${lesson.titleRu}»: зависимость «${lessons.find((item) => item.id === invalidDependency)?.titleRu || invalidDependency}» должна находиться раньше`,
        { lessonId: lesson.id, prerequisiteLessonId: invalidDependency },
      );
    if (
      lesson.kind === "TEXT" &&
      (!lesson.textRu.trim() || !lesson.textKz.trim())
    )
      fail(400, "LESSON_TEXT_REQUIRED", "Добавьте текст урока на двух языках");
    if (["PDF", "VIDEO", "FILE"].includes(lesson.kind) && !lesson.materialId)
      fail(400, "MATERIAL_REQUIRED", "Загрузите материал урока");
    if (lesson.kind === "VIDEO" && !lesson.durationSeconds)
      fail(400, "VIDEO_DURATION_REQUIRED", "Укажите длительность видео");
    seen.add(lesson.id);
    if (lesson.kind === "ASSESSMENT" && lesson.assessment) {
      if (
        !lesson.assessment.questions.length ||
        lesson.assessment.questions.length < lesson.assessment.questionCount ||
        new Set(lesson.assessment.questions.map((q) => q.id)).size !==
          lesson.assessment.questions.length
      )
        fail(
          400,
          "QUESTION_COUNT_INVALID",
          "Проверьте вопросы промежуточного теста",
        );
      for (const question of lesson.assessment.questions)
        assertQuestionPublishable(question);
    }
  }
  const questions = content.exam.questions;
  if (
    content.learningOutcome === "LEARNING" ||
    profile.assessmentKind !== "EXTERNAL_AUTHORIZED"
  ) {
    if (!questions.length || questions.length < content.exam.questionCount)
      fail(
        400,
        "QUESTION_COUNT_INVALID",
        "Добавьте вопросы для выбранного размера теста",
      );
  }
  if (new Set(questions.map((q) => q.id)).size !== questions.length)
    fail(
      400,
      "QUESTION_IDS_INVALID",
      "У вопросов должны быть уникальные идентификаторы",
    );
  for (const question of questions) assertQuestionPublishable(question);
  if (
    profile.sanitary &&
    (content.exam.thresholdPercent !== 80 || content.exam.comparison !== "GT")
  )
    fail(
      400,
      "SANITARY_THRESHOLD",
      "Для этой санитарной программы нужен результат более 80%",
    );
  if (profile.status === "CONFIRMED") {
    if (
      !profile.reviewReference.trim() ||
      !profile.examiner.trim() ||
      !profile.issuer.trim()
    )
      fail(
        400,
        "POLICY_REVIEW_REQUIRED",
        "Укажите проверку маршрута, экзаменатора и эмитента",
      );
    if (!profile.synthetic && !profile.sources.length)
      fail(400, "POLICY_SOURCE_REQUIRED", "Добавьте нормативный источник");
    if (
      profile.competency === "GENERAL" &&
      profile.assessmentKind === "CENTER_EXAM"
    )
      fail(
        400,
        "GENERAL_COMPETENCY_ROUTE",
        "Для общих компетенций проверьте внешний маршрут экзамена",
      );
    if (profile.commissionKind !== "NONE" && !profile.commission.length)
      fail(400, "COMMISSION_REQUIRED", "Укажите состав комиссии");
  }
}

export function assertQuestionPublishable(question: LmsQuestion) {
  if (question.answerSpec) {
    const spec =
      question.answerSpec.kind === "CASE"
        ? question.answerSpec.response
        : question.answerSpec;
    const ids = question.options.map((option) => option.id);
    let valid = !!question.promptRu.trim() && !!question.promptKz.trim();
    if (question.answerSpec.kind === "CASE")
      valid &&=
        !!question.answerSpec.contextRu.trim() &&
        !!question.answerSpec.contextKz.trim();
    if (spec.kind !== "TEXT")
      valid &&=
        ids.length >= 2 &&
        new Set(ids).size === ids.length &&
        question.options.every(
          (option) => !!option.textRu.trim() && !!option.textKz.trim(),
        );
    if (spec.kind === "SINGLE" || spec.kind === "MULTIPLE")
      valid &&=
        spec.correctOptionIds.length > 0 &&
        (spec.kind !== "SINGLE" || spec.correctOptionIds.length === 1) &&
        new Set(spec.correctOptionIds).size === spec.correctOptionIds.length &&
        spec.correctOptionIds.every((id) => ids.includes(id));
    if (spec.kind === "MATCHING") {
      const right = spec.rightOptions.map((option) => option.id);
      valid &&=
        right.length >= 2 &&
        new Set(right).size === right.length &&
        spec.rightOptions.every(
          (option) => !!option.textRu.trim() && !!option.textKz.trim(),
        ) &&
        spec.pairs.length === ids.length &&
        new Set(spec.pairs.map((pair) => pair.leftId)).size === ids.length &&
        new Set(spec.pairs.map((pair) => pair.rightId)).size ===
          spec.pairs.length &&
        spec.pairs.every(
          (pair) => ids.includes(pair.leftId) && right.includes(pair.rightId),
        );
    }
    if (spec.kind === "ORDERING")
      valid &&=
        spec.correctOrderIds.length === ids.length &&
        new Set(spec.correctOrderIds).size === ids.length &&
        spec.correctOrderIds.every((id) => ids.includes(id));
    if (spec.kind === "TEXT")
      valid &&=
        spec.mode === "EXACT"
          ? spec.acceptedAnswers.some((answer) => !!answer.trim()) &&
            spec.acceptedAnswers.every((answer) => !!answer.trim())
          : !!spec.criteriaRu.trim() && !!spec.criteriaKz.trim();
    if (!valid)
      fail(
        400,
        "QUESTION_INVALID",
        `Вопрос «${question.promptRu || question.id}»: проверьте переводы и правила оценки`,
        { questionId: question.id },
      );
    return;
  }
  const options = question.options.map((option) => option.id);
  if (
    !question.promptRu.trim() ||
    !question.promptKz.trim() ||
    options.length < 2 ||
    new Set(options).size !== options.length ||
    !question.correctOptionIds.length ||
    question.correctOptionIds.some((id) => !options.includes(id)) ||
    (!question.multiple && question.correctOptionIds.length !== 1) ||
    new Set(question.correctOptionIds).size !==
      question.correctOptionIds.length ||
    question.options.some(
      (option) => !option.textRu.trim() || !option.textKz.trim(),
    )
  )
    fail(
      400,
      "QUESTION_INVALID",
      `Вопрос «${question.promptRu || question.id}»: проверьте переводы, минимум два варианта и правильные ответы`,
      { questionId: question.id },
    );
}

export function publicContent(content: CourseContent): Omit<
  CourseContent,
  "exam"
> & {
  exam: Omit<CourseContent["exam"], "questions">;
} {
  const { questions: _questions, ...exam } = content.exam;
  return {
    ...content,
    modules: content.modules.map((module) => ({
      ...module,
      lessons: module.lessons.map((lesson) => ({
        ...lesson,
        ...(lesson.assessment
          ? { assessment: { ...lesson.assessment, questions: [] } }
          : {}),
      })),
    })),
    exam,
  };
}

export function courseOutline(content: CourseContent) {
  const projected = publicContent(content);
  return {
    ...projected,
    modules: projected.modules.map((module) => ({
      ...module,
      lessons: module.lessons.map((lesson) => ({
        ...lesson,
        textRu: "",
        textKz: "",
        materialId: null,
        url: undefined,
        subtitles: [],
        assignment: undefined,
      })),
    })),
  };
}
