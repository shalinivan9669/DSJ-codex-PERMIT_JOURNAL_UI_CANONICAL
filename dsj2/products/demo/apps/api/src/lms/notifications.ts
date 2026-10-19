import { Prisma, type LmsTeachingEvent } from "@demo/database";
import { db, fail, parse, audit, type Context } from "../core";
import { learningPageSchema, teachingVisibilitySql } from "./teaching-events";
import { enrollmentScopeSql, teachingBindingPermissionSql } from "./learning-permissions";

/** Insert from the current roster in one statement; retries cannot duplicate a revision. */
export async function notifyTeachingEvent(
  tx: Prisma.TransactionClient,
  event: LmsTeachingEvent,
  kind: string,
) {
  await tx.$executeRaw(Prisma.sql`INSERT INTO "LmsLearningNotification" (id,"tenantId","userId","eventId","eventRevision",kind,"createdAt")
    SELECT gen_random_uuid()::text,${event.tenantId},recipients.id,${event.id},${event.revision},${kind},(CURRENT_TIMESTAMP AT TIME ZONE 'UTC') FROM (
      SELECT lp."userId" AS id FROM "LmsGroupMember" m JOIN "Enrollment" n ON n."tenantId"=m."tenantId" AND n.id=m."enrollmentId" JOIN "LearnerProfile" lp ON lp."tenantId"=n."tenantId" AND lp."recipientId"=n."recipientId" JOIN "User" u ON u."tenantId"=lp."tenantId" AND u.id=lp."userId" AND u.active
      WHERE m."tenantId"=${event.tenantId} AND m."groupId"=${event.groupId} AND m."excludedAt" IS NULL AND n.status<>'CANCELLED'
      UNION SELECT ${event.teacherUserId}::text
    ) recipients ON CONFLICT ("tenantId","userId","eventId","eventRevision") DO NOTHING`);
}
export async function listLearningNotifications(c: Context, input: unknown) {
  const q = parse(learningPageSchema, input),
    where = await notificationVisibilitySql(c);
  const learning = c.learningMode || (c.role === "LEARNER" && !c.teachingMode);
  const destination = learning ? "/learn/" : "/lms/results?enrollmentId=";
  const [items, count] = await Promise.all([
    db.$queryRaw<Array<{ id: string; href: string | null; sourceType: string; enrollmentId: string | null; sourceElementId: string | null }>>(
      Prisma.sql`SELECT n.id,n."eventId",n.kind,n."sourceType",n."sourceId",n."enrollmentId",n."readAt",n."createdAt",COALESCE(e."titleRu",n."titleRu") AS "titleRu",COALESCE(e."titleKz",n."titleKz") AS "titleKz",COALESCE(e."startsAt",n."createdAt") AS "startsAt",e.status,
        CASE WHEN n."sourceType" IN ('REVIEW_SUBMISSION','REVIEW_ATTEMPT') THEN n.href WHEN n."enrollmentId" IS NOT NULL THEN ${destination}||n."enrollmentId" ELSE n.href END AS href,
        CASE WHEN n."sourceType"='REVIEW_SUBMISSION' THEN (SELECT s.state FROM "LmsSubmission" s WHERE s."tenantId"=n."tenantId" AND s.id=n."sourceId")
          WHEN n."sourceType"='REVIEW_ATTEMPT' THEN (SELECT a.state FROM "ExamAttempt" a WHERE a."tenantId"=n."tenantId" AND a.id=n."sourceId") END AS "reviewState",
        CASE WHEN n."sourceType"='SUBMISSION' THEN (SELECT s."elementId" FROM "LmsSubmission" s WHERE s."tenantId"=n."tenantId" AND s.id=n."sourceId" AND s."enrollmentId"=n."enrollmentId") END AS "sourceElementId"
        FROM "LmsLearningNotification" n LEFT JOIN "LmsTeachingEvent" e ON e."tenantId"=n."tenantId" AND e.id=n."eventId" WHERE ${where} ORDER BY n."createdAt" DESC,n.id DESC LIMIT ${q.pageSize} OFFSET ${(q.page - 1) * q.pageSize}`,
    ),
    db.$queryRaw<{ total: bigint; unread: bigint }[]>(
      Prisma.sql`SELECT count(*) AS total,count(*) FILTER (WHERE n."readAt" IS NULL) AS unread FROM "LmsLearningNotification" n WHERE ${where}`,
    ),
  ]);
  return {
    items: items.map(({ sourceElementId, ...item }) => ({
      ...item,
      href: learning && item.enrollmentId && sourceElementId
        ? `/learn/${item.enrollmentId}?lessonId=${encodeURIComponent(sourceElementId)}`
        : item.href,
    })),
    total: Number(count[0]?.total || 0),
    unread: Number(count[0]?.unread || 0),
    page: q.page,
    pageSize: q.pageSize,
  };
}
export async function readLearningNotification(c: Context, id: string) {
  const where = await notificationVisibilitySql(c);
  const updated = await db.$queryRaw<{ id: string; readAt: Date }[]>(
    Prisma.sql`UPDATE "LmsLearningNotification" n SET "readAt"=COALESCE(n."readAt",(CURRENT_TIMESTAMP AT TIME ZONE 'UTC')) WHERE n.id=${id} AND (${where}) RETURNING n.id,n."readAt"`,
  );
  if (!updated[0]) fail(404, "NOT_FOUND", "Уведомление не найдено");
  return updated[0];
}

/** Identical current-scope predicate for inbox list, count and mutation. */
export async function notificationVisibilitySql(
  c: Context,
  eventTable = false,
) {
  const teaching = await teachingVisibilitySql(c, "s"),
    enrollment = enrollmentScopeSql(c, "scope_n");
  const own = Prisma.sql`n."tenantId"=${c.tenantId} AND n."userId"=${c.userId}`;
  const accessDate = Prisma.sql`n.kind NOT IN ('ACCESS_EXPIRING','ACCESS_EXPIRED') OR (
    scope_n."dueAt" IS NOT NULL AND n."deliveryKey"='ACCESS:'||(CASE WHEN n.kind='ACCESS_EXPIRED' THEN 'EXPIRED' ELSE '7' END)||':'||scope_n.id||':'||to_char(scope_n."dueAt",'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AND
    ((n.kind='ACCESS_EXPIRED' AND scope_n."dueAt"<=(CURRENT_TIMESTAMP AT TIME ZONE 'UTC')) OR
     (n.kind='ACCESS_EXPIRING' AND scope_n."dueAt">(CURRENT_TIMESTAMP AT TIME ZONE 'UTC') AND scope_n."dueAt"<=(CURRENT_TIMESTAMP AT TIME ZONE 'UTC')+interval '7 days'))
  )`;
  const reviewer = !c.learningMode && ["SUPER_ADMIN", "ADMIN", "DIRECTOR"].includes(c.role)
    ? Prisma.sql`TRUE`
    : !c.learningMode
      ? Prisma.sql`EXISTS (SELECT 1 FROM "LmsTeachingBinding" rb JOIN "CourseVersion" rv ON rv."tenantId"=rb."tenantId" AND rv."courseId"=rb."courseId" WHERE rb."tenantId"=scope_n."tenantId" AND rv.id=scope_n."courseVersionId" AND rb."userId"=${c.userId} AND rb."revokedAt" IS NULL AND rb.permissions @> '["READ"]'::jsonb AND ${teachingBindingPermissionSql("REVIEW", "rb")} AND (rb."groupId" IS NULL OR (rb."groupId"=scope_n."groupId" AND EXISTS (SELECT 1 FROM "LmsGroupMember" gm WHERE gm."tenantId"=scope_n."tenantId" AND gm."groupId"=rb."groupId" AND gm."enrollmentId"=scope_n.id AND gm."excludedAt" IS NULL))))`
      : Prisma.sql`FALSE`;
  const reviewScope = Prisma.sql`scope_n."tenantId"=${c.tenantId} AND ((n."sourceType" NOT IN ('REVIEW_SUBMISSION','REVIEW_ATTEMPT') AND (${enrollment})) OR (n."sourceType" IN ('REVIEW_SUBMISSION','REVIEW_ATTEMPT') AND (${reviewer}) AND NOT EXISTS (SELECT 1 FROM "LearnerProfile" self WHERE self."tenantId"=scope_n."tenantId" AND self."recipientId"=scope_n."recipientId" AND self."userId"=${c.userId})))`;
  const legacy = eventTable
    ? Prisma.sql`FALSE`
    : Prisma.sql`n."sourceType"='SESSION' AND EXISTS(SELECT 1 FROM "LmsTeachingEvent" s WHERE s."tenantId"=n."tenantId" AND s.id=n."eventId" AND (${teaching}))`;
  const regulatoryScope = c.learningMode
    ? Prisma.sql`FALSE`
    : ["ADMIN", "SUPER_ADMIN"].includes(c.role)
      ? Prisma.sql`TRUE`
      : Prisma.sql`EXISTS (SELECT 1 FROM "LmsTeachingBinding" b WHERE b."tenantId"=r."tenantId" AND b."courseId"=r."courseId" AND b."userId"=${c.userId} AND b.role='METHODIST' AND b."groupId" IS NULL AND b."revokedAt" IS NULL AND b.permissions @> '["READ","EDIT"]'::jsonb)`;
  const renewalScope =
    c.role === "EMPLOYER"
      ? Prisma.sql`EXISTS(SELECT 1 FROM "EmployerMembership" m WHERE m."tenantId"=r."tenantId" AND m."customerId"=r."customerId" AND m."userId"=${c.userId} AND m.active AND (m."expiresAt" IS NULL OR m."expiresAt">(CURRENT_TIMESTAMP AT TIME ZONE 'UTC')) AND m.permissions @> '["READ"]'::jsonb AND (m."recipientIds"='[]'::jsonb OR m."recipientIds" @> jsonb_build_array(r."recipientId")))`
      : ["SUPER_ADMIN", "ADMIN", "DIRECTOR", "OPERATOR"].includes(c.role) && !c.learningMode
        ? Prisma.sql`TRUE`
        : Prisma.sql`EXISTS(SELECT 1 FROM "LearnerProfile" p WHERE p."tenantId"=r."tenantId" AND p."recipientId"=r."recipientId" AND p."userId"=${c.userId})`;
  return Prisma.sql`${own} AND (
    (${legacy}) OR (n."sourceType"='ACCOUNT' AND n."sourceId"=${c.userId}) OR
    (n."sourceType"='REGULATORY' AND EXISTS (SELECT 1 FROM "RegulatoryReview" r JOIN "Course" course ON course."tenantId"=r."tenantId" AND course.id=r."courseId" AND NOT course.archived WHERE r."tenantId"=n."tenantId" AND r.id=n."sourceId" AND r.status<>'CURRENT' AND n."deliveryKey"='REGULATORY:'||r.id||':'||to_char(r."updatedAt",'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AND (${regulatoryScope}))) OR
    (n."sourceType"='RENEWAL' AND EXISTS(SELECT 1 FROM "RenewalNeed" r JOIN "PrintRequest" p ON p."tenantId"=r."tenantId" AND p.id=r."sourceRequestId" WHERE r."tenantId"=n."tenantId" AND r.id=n."sourceId" AND r.confirmed AND r.state<>'IRRELEVANT' AND p.status<>'CANCELLED' AND (${renewalScope}) AND ((n."deliveryKey" LIKE '%:DOCUMENT:'||r."documentValidUntil") OR (n."deliveryKey" LIKE '%:TRAINING:'||r."nextCheckDate")) AND NOT EXISTS(SELECT 1 FROM "Issuance" i JOIN "IssuanceEvent" x ON x."tenantId"=i."tenantId" AND x."issuanceId"=i.id WHERE i."tenantId"=p."tenantId" AND i."requestId"=p.id AND x.kind IN ('CANCELLED','REPLACED')))) OR
    (n."enrollmentId" IS NOT NULL AND EXISTS(SELECT 1 FROM "Enrollment" scope_n WHERE scope_n.id=n."enrollmentId" AND scope_n.status<>'CANCELLED' AND (${accessDate}) AND (${reviewScope})) AND
      (n."sourceType"<>'DOCUMENT' OR EXISTS(SELECT 1 FROM "LmsDocumentLink" d JOIN "IssuanceWorkflow" w ON w."tenantId"=d."tenantId" AND w."issuanceId"=d."issuanceId" JOIN "PrintRequest" p ON p."tenantId"=d."tenantId" AND p.id=d."requestId" WHERE d."tenantId"=n."tenantId" AND d.id=n."sourceId" AND w.status='ISSUED' AND p.status<>'CANCELLED' AND NOT EXISTS(SELECT 1 FROM "IssuanceEvent" x WHERE x."tenantId"=d."tenantId" AND x."issuanceId"=d."issuanceId" AND x.kind IN ('CANCELLED','REPLACED')) AND NOT EXISTS(SELECT 1 FROM "LmsResultEvent" x WHERE x."tenantId"=d."tenantId" AND x."resultId"=d."resultId" AND x.kind IN ('VOIDED','SUPERSEDED')))))
  )`;
}
export async function readAllLearningNotifications(c: Context) {
  const where = await notificationVisibilitySql(c);
  const count = await db.$executeRaw(
    Prisma.sql`UPDATE "LmsLearningNotification" n SET "readAt"=(CURRENT_TIMESTAMP AT TIME ZONE 'UTC') WHERE (${where}) AND n."readAt" IS NULL`,
  );
  await audit(db, c, "LMS_NOTIFICATIONS_READ", c.userId, { count });
  return { read: count };
}
