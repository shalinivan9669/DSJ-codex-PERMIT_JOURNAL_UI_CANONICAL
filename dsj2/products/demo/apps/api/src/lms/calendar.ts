import { Prisma } from "@demo/database";
import { z } from "@demo/contracts";
import { db, fail, parse, type Context } from "../core";
import { enrollmentScopeSql, isTeachingRole } from "./learning-permissions";
import { teachingVisibilitySql } from "./teaching-events";

export async function learningCalendar(c: Context, input: unknown) {
  const q = parse(
    z
      .object({
        from: z.string().datetime(),
        to: z.string().datetime(),
        page: z.coerce.number().int().min(1).max(100000).default(1),
        pageSize: z.coerce.number().int().min(1).max(250).default(50),
      })
      .strict(),
    input,
  );
  const from = new Date(q.from),
    to = new Date(q.to);
  if (to <= from || to.getTime() - from.getTime() > 366 * 86400000)
    fail(400, "CALENDAR_RANGE", "Выберите период до одного года");
  const enrollment = enrollmentScopeSql(c, "n"),
    events = await teachingVisibilitySql(c, "e");
  const destination =
    c.learningMode || (c.role === "LEARNER" && !isTeachingRole(c))
      ? Prisma.sql`'/learn/'||n.id`
      : Prisma.sql`CASE WHEN n."groupId" IS NULL THEN '/lms/results' ELSE '/lms/groups/'||n."groupId" END`;
  const union = Prisma.sql`
    SELECT 'event:'||e.id AS id,'SESSION' AS kind,e."titleRu",e."titleKz",e."startsAt",e."endsAt",e.timezone,e."groupId",NULL::text AS "enrollmentId",'/lms/calendar?eventId='||e.id AS href,e.status FROM "LmsTeachingEvent" e WHERE (${events}) AND e."startsAt"<${to} AND e."endsAt">=${from}
    UNION ALL
    SELECT 'start:'||n.id,'COURSE_START',v."content"->>'titleRu',v."content"->>'titleKz',n."startsAt",NULL::timestamp,'UTC',n."groupId",n.id,${destination},n.status FROM "Enrollment" n JOIN "CourseVersion" v ON v."tenantId"=n."tenantId" AND v.id=n."courseVersionId" WHERE (${enrollment}) AND n."startsAt">=${from} AND n."startsAt"<${to}
    UNION ALL
    SELECT 'due:'||n.id,'COURSE_DUE',v."content"->>'titleRu',v."content"->>'titleKz',n."dueAt",NULL::timestamp,'UTC',n."groupId",n.id,${destination},n.status FROM "Enrollment" n JOIN "CourseVersion" v ON v."tenantId"=n."tenantId" AND v.id=n."courseVersionId" WHERE (${enrollment}) AND n."dueAt">=${from} AND n."dueAt"<${to}
    UNION ALL
    SELECT 'exam:'||n.id,'EXAM_DUE',v."content"->>'titleRu',v."content"->>'titleKz',(v."content"->'exam'->>'dueAt')::timestamp,NULL::timestamp,'UTC',n."groupId",n.id,${destination},n.status FROM "Enrollment" n JOIN "CourseVersion" v ON v."tenantId"=n."tenantId" AND v.id=n."courseVersionId" WHERE (${enrollment}) AND (v."content"->'exam'->>'dueAt')::timestamp>=${from} AND (v."content"->'exam'->>'dueAt')::timestamp<${to}
    UNION ALL
    SELECT 'assessment:'||n.id||':'||(lesson->>'id'),'ASSESSMENT_DUE',lesson->>'titleRu',lesson->>'titleKz',COALESCE(lesson->'assessment'->>'dueAt',lesson->'assignment'->>'dueAt')::timestamp,NULL::timestamp,'UTC',n."groupId",n.id,${destination},n.status FROM "Enrollment" n JOIN "CourseVersion" v ON v."tenantId"=n."tenantId" AND v.id=n."courseVersionId" CROSS JOIN LATERAL jsonb_array_elements(v."content"->'modules') module CROSS JOIN LATERAL jsonb_array_elements(module->'lessons') lesson WHERE (${enrollment}) AND COALESCE(lesson->'assessment'->>'dueAt',lesson->'assignment'->>'dueAt')::timestamp>=${from} AND COALESCE(lesson->'assessment'->>'dueAt',lesson->'assignment'->>'dueAt')::timestamp<${to}`;
  const [items, count] = await Promise.all([
    db.$queryRaw(
      Prisma.sql`WITH entries AS (${union}) SELECT * FROM entries ORDER BY "startsAt",id LIMIT ${q.pageSize} OFFSET ${(q.page - 1) * q.pageSize}`,
    ),
    db.$queryRaw<{ total: bigint }[]>(
      Prisma.sql`WITH entries AS (${union}) SELECT count(*) AS total FROM entries`,
    ),
  ]);
  return {
    items,
    total: Number(count[0]?.total || 0),
    page: q.page,
    pageSize: q.pageSize,
  };
}
