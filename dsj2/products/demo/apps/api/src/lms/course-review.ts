import { z } from "@demo/contracts";
import {
  courseContentSchema,
  regulatoryProfileSchema,
} from "@demo/contracts/src/lms";
import {
  audit,
  fail,
  hash,
  json,
  parse,
  transaction,
  type Context,
} from "../core";
import { assertLearningPermission } from "./learning-permissions";
import { assertPublishable } from "./validation";
import { versionView } from "./courses";
import { validatePublishedDependencies } from "./publication-validation";
import { normalizeCourseQuestions } from "./questions";

export async function reviewCourseVersion(
  c: Context,
  id: string,
  input: unknown,
) {
  const value = parse(
    z
      .object({
        revision: z.number().int().nonnegative(),
        action: z.enum(["SUBMIT", "APPROVE", "RETURN"]),
        feedback: z.string().trim().max(10000).default(""),
      })
      .strict(),
    input,
  );
  return transaction(async (tx) => {
    await tx.$executeRaw`SELECT id FROM "CourseVersion" WHERE "tenantId"=${c.tenantId} AND id=${id} FOR UPDATE`;
    let version = await tx.courseVersion.findFirst({
      where: { tenantId: c.tenantId, id },
    });
    if (!version) fail(404, "NOT_FOUND", "Редакция не найдена");
    await assertLearningPermission(
      c,
      version.courseId,
      null,
      value.action === "SUBMIT" ? "EDIT" : "PUBLISH",
      tx,
    );
    if (version.status !== "DRAFT" || version.revision !== value.revision)
      fail(409, "REVISION_CONFLICT", "Проверьте актуальную редакцию курса");
    const profile = await tx.regulatoryProfileVersion.findFirstOrThrow({
      where: { tenantId: c.tenantId, id: version.regulatoryProfileVersionId },
    });
    if (value.action === "SUBMIT") {
      const prior = courseContentSchema.parse(version.content);
      const content = await normalizeCourseQuestions(
        tx,
        c,
        version.courseId,
        prior,
        prior,
        true,
      );
      if (hash(content) !== hash(version.content))
        version = await tx.courseVersion.update({
          where: { id },
          data: { content: json(content), revision: { increment: 1 } },
        });
    }
    const contentHash = hash({
      content: version.content,
      profile: profile.definition,
    });
    const latest = await tx.lmsCourseReview.findFirst({
      where: {
        tenantId: c.tenantId,
        courseVersionId: id,
        revision: version.revision,
        contentHash,
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    });
    const state =
      value.action === "SUBMIT"
        ? "PENDING"
        : value.action === "APPROVE"
          ? "APPROVED"
          : "RETURNED";
    if (latest?.state === state) return versionView(c, version, tx);
    if (value.action !== "SUBMIT" && latest?.state !== "PENDING")
      fail(
        409,
        "COURSE_REVIEW_REQUIRED",
        "Сначала отправьте эту редакцию на проверку",
      );
    if (value.action === "RETURN" && !value.feedback)
      fail(400, "FEEDBACK_REQUIRED", "Укажите причину возврата");
    if (value.action !== "RETURN") {
      const content = courseContentSchema.parse(version.content);
      assertPublishable(
        content,
        regulatoryProfileSchema.parse(profile.definition),
      );
      await validatePublishedDependencies(tx, c, version.courseId, content);
    }
    const saved = await tx.lmsCourseReview.create({
      data: {
        tenantId: c.tenantId,
        courseVersionId: id,
        revision: version.revision,
        contentHash,
        state,
        feedback: value.feedback,
        actorId: c.userId,
      },
    });
    await audit(tx, c, "LMS_COURSE_REVIEW", id, {
      reviewId: saved.id,
      revision: value.revision,
      contentHash,
      state,
    });
    return versionView(c, version, tx);
  });
}

export async function archiveLearningCourse(
  c: Context,
  id: string,
  input: unknown,
) {
  const value = z
    .object({
      archived: z.boolean(),
      reason: z.string().trim().min(1).max(2000),
    })
    .strict()
    .parse(input);
  return transaction(async (tx) => {
    await assertLearningPermission(c, id, null, "MANAGE", tx);
    await tx.$executeRaw`SELECT id FROM "Course" WHERE "tenantId"=${c.tenantId} AND id=${id} FOR UPDATE`;
    const before = await tx.course.findFirst({
      where: { tenantId: c.tenantId, id },
    });
    if (!before) fail(404, "NOT_FOUND", "Курс не найден");
    const saved = await tx.course.update({
      where: { id },
      data: { archived: value.archived },
    });
    await audit(
      tx,
      c,
      value.archived ? "LMS_COURSE_ARCHIVED" : "LMS_COURSE_UNARCHIVED",
      id,
      { before: before.archived, after: value.archived, reason: value.reason },
    );
    return saved;
  });
}
