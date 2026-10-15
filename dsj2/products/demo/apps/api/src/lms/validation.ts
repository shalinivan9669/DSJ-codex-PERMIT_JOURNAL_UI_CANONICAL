import { z } from "@demo/contracts";
import {
  courseContentSchema,
  regulatoryProfileSchema,
  type CourseContent,
  type RegulatoryProfile,
} from "@demo/contracts/src/lms";
import { fail } from "../core";

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
    courseVersionId: z.string().min(1).max(100),
    recipientIds: z.array(z.string().min(1).max(100)).min(1).max(10000),
    customerId: z.string().max(100).nullable().optional(),
    groupName: z.string().max(300).default(""),
  })
  .strict();
export const progressInputSchema = z
  .object({
    sequence: z.number().int().nonnegative(),
    positionSeconds: z.number().min(0).max(86400).default(0),
    playing: z.boolean().default(false),
    acknowledge: z.boolean().default(false),
  })
  .strict();
export const answersInputSchema = z
  .object({
    sequence: z.number().int().nonnegative(),
    answers: z.record(
      z.string().max(100),
      z.array(z.string().max(100)).max(20),
    ),
  })
  .strict();
export const pagingSchema = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(250).default(50),
    search: z.string().max(300).default(""),
    status: z.string().max(50).optional(),
    courseVersionId: z.string().max(100).optional(),
  })
  .strict();

/** Structural validity is checked when saving; publication requires a usable immutable program. */
export function assertPublishable(
  content: CourseContent,
  profile: RegulatoryProfile,
) {
  if (!content.titleRu.trim() || !content.titleKz.trim())
    fail(
      400,
      "COURSE_TITLE_REQUIRED",
      "Укажите название на русском и казахском",
    );
  const lessons = content.modules.flatMap((module) => module.lessons);
  const ids = lessons.map((lesson) => lesson.id);
  if (!lessons.length || new Set(ids).size !== ids.length)
    fail(
      400,
      "LESSON_IDS_INVALID",
      "Добавьте уроки с уникальными идентификаторами",
    );
  const seen = new Set<string>();
  for (const lesson of lessons) {
    if (!lesson.titleRu.trim() || !lesson.titleKz.trim())
      fail(
        400,
        "LESSON_TITLE_REQUIRED",
        "Укажите название каждого урока на двух языках",
      );
    if (lesson.prerequisiteLessonIds.some((id) => !seen.has(id)))
      fail(
        400,
        "PREREQUISITE_INVALID",
        "Предыдущий урок должен находиться перед текущим",
      );
    if (
      lesson.kind === "TEXT" &&
      (!lesson.textRu.trim() || !lesson.textKz.trim())
    )
      fail(400, "LESSON_TEXT_REQUIRED", "Добавьте текст урока на двух языках");
    if (lesson.kind !== "TEXT" && !lesson.materialId)
      fail(400, "MATERIAL_REQUIRED", "Загрузите материал урока");
    if (lesson.kind === "VIDEO" && !lesson.durationSeconds)
      fail(400, "VIDEO_DURATION_REQUIRED", "Укажите длительность видео");
    seen.add(lesson.id);
  }
  const questions = content.exam.questions;
  if (profile.assessmentKind !== "EXTERNAL_AUTHORIZED") {
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
  for (const question of questions) {
    const options = question.options.map((o) => o.id);
    if (
      !question.promptRu.trim() ||
      !question.promptKz.trim() ||
      new Set(options).size !== options.length ||
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
        "Проверьте вопрос, переводы и правильные ответы",
      );
  }
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

export function publicContent(content: CourseContent): Omit<
  CourseContent,
  "exam"
> & {
  exam: Omit<CourseContent["exam"], "questions">;
} {
  const { questions: _questions, ...exam } = content.exam;
  return { ...content, exam };
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
      })),
    })),
  };
}
