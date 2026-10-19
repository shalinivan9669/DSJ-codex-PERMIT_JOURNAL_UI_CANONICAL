import { courseContentSchema, regulatoryProfileSchema } from "@demo/contracts/src/lms";
import { db, type Context } from "../core";
import { listCourses } from "./courses";

/** A saved order/group keeps its exact published version when a newer one appears. */
export async function operatorProgrammes(c: Context, selectedVersionId?: string | null) {
  const page = await listCourses(c, { pageSize: 250, status: "PUBLISHED" });
  if (!selectedVersionId || page.items.some((course) => course.latestVersion.id === selectedVersionId)) return page.items;
  const version = await db.courseVersion.findFirst({ where: { tenantId: c.tenantId, id: selectedVersionId, status: "PUBLISHED" }, include: { teachingCourse: true } });
  if (!version || version.teachingCourse.archived) return page.items;
  const profile = await db.regulatoryProfileVersion.findFirstOrThrow({ where: { tenantId: c.tenantId, id: version.regulatoryProfileVersionId } });
  const content = courseContentSchema.parse(version.content), definition = regulatoryProfileSchema.parse(profile.definition);
  const selected = {
    id: version.id, version: version.version, status: version.status,
    content: { titleRu: content.titleRu, titleKz: content.titleKz, category: content.category, hours: content.hours, accessDays: content.accessDays },
    profile: { status: definition.status, assessmentKind: definition.assessmentKind, legalForm: definition.legalForm },
  };
  const row = {
    id: version.courseId, titleRu: version.teachingCourse.titleRu, titleKz: version.teachingCourse.titleKz,
    assignmentPaused: version.teachingCourse.assignmentPaused, assignmentPauseReason: version.teachingCourse.assignmentPauseReason,
    latestVersion: selected, publishedVersion: selected, currentReview: null, allowedActions: [] as string[],
  };
  return [row, ...page.items.filter((course) => course.id !== version.courseId)];
}
