import { courseContentSchema } from "@demo/contracts/src/lms";
import { db, type Context } from "../core";
import { scopedEnrollment } from "./scope";
import { attemptView, startAttempt } from "./exams";
import { evaluateLearningEligibility } from "./learning-eligibility";

export async function listAssessments(c: Context, enrollmentId: string) {
  const enrollment = await scopedEnrollment(c, enrollmentId);
  const version = await db.courseVersion.findFirstOrThrow({
    where: { tenantId: c.tenantId, id: enrollment.courseVersionId },
  });
  const content = courseContentSchema.parse(version.content);
  const eligibility = await evaluateLearningEligibility(
    db,
    c,
    enrollment,
    content,
  );
  const rows = await db.examAttempt.findMany({
    where: { tenantId: c.tenantId, enrollmentId, purpose: "INTERMEDIATE" },
    orderBy: { ordinal: "desc" },
  });
  return {
    items: await Promise.all(
      content.modules
        .flatMap((module) => module.lessons)
        .filter((lesson) => lesson.kind === "ASSESSMENT" && lesson.assessment)
        .map(async (lesson) => {
          const attempts = rows.filter(
            (attempt) => attempt.assessmentId === lesson.id,
          );
          const available = eligibility.lessons.find(
            (item) => item.id === lesson.id,
          );
          const active = attempts.find((attempt) =>
            ["IN_PROGRESS", "AWAITING_REVIEW"].includes(attempt.state),
          );
          const expired =
            !!lesson.assessment!.dueAt &&
            new Date(lesson.assessment!.dueAt!) <= new Date();
          const reasonCode =
            enrollment.status === "CANCELLED"
              ? "ACCESS_CANCELLED"
              : enrollment.startsAt && enrollment.startsAt > new Date()
                ? "ACCESS_NOT_STARTED"
                : enrollment.dueAt && enrollment.dueAt <= new Date()
                  ? "ACCESS_EXPIRED"
                  : !available?.available
                    ? available?.reason || "LESSON_UNAVAILABLE"
                    : expired
                      ? "ASSESSMENT_EXPIRED"
                      : active
                        ? "ATTEMPT_ACTIVE"
                        : attempts.length >= lesson.assessment!.maxAttempts
                          ? "ATTEMPT_LIMIT"
                          : null;
          return {
            lessonId: lesson.id,
            titleRu: lesson.titleRu,
            titleKz: lesson.titleKz,
            attempts: await Promise.all(
              attempts.map((attempt) => attemptView(c, attempt)),
            ),
            canStart:
              (c.role === "LEARNER" || c.learningMode === true) && !reasonCode,
            reasonCode,
            maxAttempts: lesson.assessment!.maxAttempts,
          };
        }),
    ),
  };
}
export const startAssessment = (
  c: Context,
  enrollmentId: string,
  lessonId: string,
) => startAttempt(c, enrollmentId, lessonId);
