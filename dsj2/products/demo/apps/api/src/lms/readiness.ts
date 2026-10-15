import type { CourseContent } from "@demo/contracts/src/lms";

/** Exact facts from the pinned course version. Rounded progress is display-only. */
export function examReadiness(
  content: CourseContent,
  progress: ReadonlyArray<{
    lessonId: string;
    completedAt?: Date | string | null;
  }>,
) {
  const completed = new Set(
    progress
      .filter((row) => row.completedAt != null)
      .map((row) => row.lessonId),
  );
  const required = content.modules
    .flatMap((module) => module.lessons)
    .filter((lesson) => lesson.required);
  const missingLessonIds = required
    .filter((lesson) => !completed.has(lesson.id))
    .map((lesson) => lesson.id);
  return {
    ready: missingLessonIds.length === 0,
    requiredCount: required.length,
    completedCount: required.length - missingLessonIds.length,
    missingLessonIds,
    reasonCode: missingLessonIds.length ? "LESSONS_REQUIRED" : null,
  };
}
