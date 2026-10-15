import { Prisma } from "@demo/database";
import { db, type Context } from "../core";
import { effectiveResult } from "./enrollments";
import { documentViews } from "./document-views";
import {
  enrollmentJoins,
  enrollmentPredicate,
  parseEnrollmentQuery,
  scopedEnrollmentIds,
} from "./enrollment-query";

export async function listEnrollmentPage(c: Context, query: unknown) {
  const q = parseEnrollmentQuery(query);
  const where = enrollmentPredicate(c, q);
  const [page, count] = await Promise.all([
    scopedEnrollmentIds(c, q),
    db.$queryRaw<Array<{ total: bigint }>>(
      Prisma.sql`SELECT count(*) AS total ${enrollmentJoins} WHERE ${where}`,
    ),
  ]);
  return {
    items: await enrollmentPageFacts(
      c,
      page.map((e) => e.id),
    ),
    total: Number(count[0].total),
    page: q.page,
    pageSize: q.pageSize,
  };
}

export async function resultFilterOptions(c: Context) {
  const scope = enrollmentPredicate(c, parseEnrollmentQuery({}));
  const [customers, courses, groups] = await Promise.all([
    db.$queryRaw<Array<{ id: string; labelRu: string; labelKz: string }>>(
      Prisma.sql`SELECT co.id,co."nameRu" AS "labelRu",co."nameKz" AS "labelKz" FROM "CustomerOrganization" co WHERE co."tenantId"=${c.tenantId} AND EXISTS (SELECT 1 ${enrollmentJoins} WHERE ${scope} AND e."customerId"=co.id) ORDER BY co."nameRu",co.id LIMIT 250`,
    ),
    db.$queryRaw<
      Array<{ id: string; courseId: string; labelRu: string; labelKz: string }>
    >(
      Prisma.sql`SELECT cv.id,cv."courseId",(cv.content->>'titleRu')||' · '||cv.version::text AS "labelRu",(cv.content->>'titleKz')||' · '||cv.version::text AS "labelKz" FROM "CourseVersion" cv WHERE cv."tenantId"=${c.tenantId} AND EXISTS (SELECT 1 ${enrollmentJoins} WHERE ${scope} AND e."courseVersionId"=cv.id) ORDER BY cv.content->>'titleRu',cv.version DESC,cv.id LIMIT 250`,
    ),
    db.$queryRaw<Array<{ id: string; labelRu: string; labelKz: string }>>(
      Prisma.sql`SELECT g.id,g.name AS "labelRu",g.name AS "labelKz" FROM "LmsGroup" g WHERE g."tenantId"=${c.tenantId} AND EXISTS (SELECT 1 ${enrollmentJoins} JOIN "LmsGroupMember" gm ON gm."tenantId"=e."tenantId" AND gm."enrollmentId"=e.id AND gm."groupId"=g.id AND gm."excludedAt" IS NULL WHERE ${scope} AND e."groupId"=g.id) ORDER BY g.name,g.id LIMIT 250`,
    ),
  ]);
  return { customers, courses, groups };
}

export async function enrollmentPageFacts(c: Context, ids: string[]) {
  if (!ids.length) return [];
  // JSON projection keeps full teaching material and answer keys outside the list read path.
  const rows = await db.$queryRaw<
    Array<{
      id: string;
      courseVersionId: string;
      recipientId: string;
      learnerUserId: string | null;
      customerId: string | null;
      groupId: string | null;
      groupKey: string;
      status: string;
      dueAt: Date;
      sourceOrderId: string | null;
      sourceRequestId: string | null;
      assignedAt: Date;
      version: number;
      courseId: string;
      courseStatus: string;
      titleRu: string;
      titleKz: string;
      recipientData: Record<string, string>;
      customer: { id: string; nameRu: string; nameKz: string } | null;
      group: { id: string; name: string } | null;
      requiredCount: bigint;
      completedCount: bigint;
    }>
  >(Prisma.sql`SELECT e.id,e."courseVersionId",e."recipientId",e."learnerUserId",e."customerId",e."groupId",e."groupKey",e.status,e."dueAt",e."sourceOrderId",e."sourceRequestId",e."assignedAt",v.version,v."courseId",v.status AS "courseStatus",v.content->>'titleRu' AS "titleRu",v.content->>'titleKz' AS "titleKz",
    jsonb_build_object('fullNameRu',r.data->>'fullNameRu','fullNameKz',r.data->>'fullNameKz','positionRu',r.data->>'positionRu','positionKz',r.data->>'positionKz') AS "recipientData",
    CASE WHEN co.id IS NOT NULL THEN jsonb_build_object('id',co.id,'nameRu',co."nameRu",'nameKz',co."nameKz") END AS customer,
    CASE WHEN g.id IS NOT NULL THEN jsonb_build_object('id',g.id,'name',g.name) END AS "group",
    progress.required AS "requiredCount",progress.completed AS "completedCount"
    FROM "Enrollment" e JOIN "CourseVersion" v ON v."tenantId"=e."tenantId" AND v.id=e."courseVersionId"
    JOIN "Recipient" r ON r."tenantId"=e."tenantId" AND r.id=e."recipientId"
    LEFT JOIN "CustomerOrganization" co ON co."tenantId"=e."tenantId" AND co.id=e."customerId"
    LEFT JOIN "LmsGroup" g ON g."tenantId"=e."tenantId" AND g.id=e."groupId"
    LEFT JOIN LATERAL (SELECT count(*) AS required,count(*) FILTER (WHERE EXISTS (SELECT 1 FROM "LessonProgress" lp WHERE lp."tenantId"=e."tenantId" AND lp."enrollmentId"=e.id AND lp."lessonId"=lesson->>'id' AND lp."completedAt" IS NOT NULL)) AS completed FROM jsonb_array_elements(v.content->'modules') module CROSS JOIN LATERAL jsonb_array_elements(module->'lessons') lesson WHERE COALESCE((lesson->>'required')::boolean,true)) progress ON true
    WHERE e."tenantId"=${c.tenantId} AND e.id IN (${Prisma.join(ids)}) ORDER BY e."assignedAt" DESC,e.id DESC`);
  const results = await db.$queryRaw<
    Array<{
      id: string;
      enrollmentId: string;
      verdict: string;
      assessmentKind: string;
      eligible: boolean;
      examAt: Date | null;
      score: number | null;
      maximum: number | null;
      confirmedAt: Date;
    }>
  >(
    Prisma.sql`SELECT r.id,r."enrollmentId",r.verdict,r."assessmentKind",r.eligible,r."examAt",r.score,r.maximum,r."confirmedAt" FROM "Enrollment" e CROSS JOIN LATERAL (SELECT * FROM "VerifiedExamResult" result WHERE result."tenantId"=e."tenantId" AND result."enrollmentId"=e.id ORDER BY result.revision DESC LIMIT 1) r WHERE e."tenantId"=${c.tenantId} AND e.id IN (${Prisma.join(ids)})`,
  );
  const [events, documents] = await Promise.all([
    db.lmsResultEvent.findMany({
      where: {
        tenantId: c.tenantId,
        resultId: { in: results.map((r) => r.id) },
        kind: { in: ["VOIDED", "SUPERSEDED"] },
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    }),
    documentViews(
      c,
      results.map((r) => r.id),
    ),
  ]);
  const resultMap = new Map(
    results.map((r) => [r.enrollmentId, effectiveResult(r, events)]),
  );
  const documentMap = new Map<string, typeof documents>();
  for (const document of documents)
    documentMap.set(document.resultId, [
      ...(documentMap.get(document.resultId) || []),
      document,
    ]);
  return rows.map(
    ({
      version,
      courseId,
      courseStatus,
      titleRu,
      titleKz,
      recipientData,
      requiredCount,
      completedCount,
      ...e
    }) => {
      const result = resultMap.get(e.id) || null;
      return {
        ...e,
        recipient: { id: e.recipientId, data: recipientData },
        courseVersion: {
          id: e.courseVersionId,
          courseId,
          version,
          status: courseStatus,
          content: { titleRu, titleKz },
        },
        progressPercent: Number(requiredCount)
          ? Math.floor((100 * Number(completedCount)) / Number(requiredCount))
          : 100,
        result,
        documents: documentMap.get(result?.id || "") || [],
      };
    },
  );
}
