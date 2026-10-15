import { Prisma } from "@demo/database";
import { db, fail, parse, type Context } from "../core";
import { pagingSchema } from "./validation";

export type EnrollmentQuery = ReturnType<typeof pagingSchema.parse>;
export const parseEnrollmentQuery = (input: unknown) =>
  parse(pagingSchema, input);

/** e and v are fixed SQL aliases. Every caller uses this same scope before paging/count/export. */
export function enrollmentPredicate(
  c: Context,
  q: EnrollmentQuery,
  now = new Date(),
) {
  const clauses: Prisma.Sql[] = [Prisma.sql`e."tenantId"=${c.tenantId}`];
  if (c.role === "LEARNER")
    clauses.push(
      Prisma.sql`EXISTS (SELECT 1 FROM "LearnerProfile" lp WHERE lp."tenantId"=e."tenantId" AND lp."userId"=${c.userId} AND lp."recipientId"=e."recipientId")`,
    );
  else if (c.role === "EMPLOYER")
    clauses.push(
      Prisma.sql`EXISTS (SELECT 1 FROM "EmployerMembership" m WHERE m."tenantId"=e."tenantId" AND m."userId"=${c.userId} AND m."customerId"=e."customerId" AND m.active AND (m."expiresAt" IS NULL OR m."expiresAt">${now}) AND m.permissions @> '["READ"]'::jsonb AND (m."recipientIds"='[]'::jsonb OR m."recipientIds" @> jsonb_build_array(e."recipientId")))`,
    );
  else if (!["ADMIN", "DIRECTOR", "OPERATOR"].includes(c.role))
    fail(403, "ROLE_DENIED", "Недостаточно прав");
  if (q.search.trim()) {
    const search = `%${q.search.trim().replace(/[\\%_]/g, "\\$&")}%`;
    clauses.push(
      Prisma.sql`EXISTS (SELECT 1 FROM "Recipient" r WHERE r."tenantId"=e."tenantId" AND r.id=e."recipientId" AND (r.data->>'fullNameRu' ILIKE ${search} OR r.data->>'fullNameKz' ILIKE ${search}))`,
    );
  }
  if (q.customerId) clauses.push(Prisma.sql`e."customerId"=${q.customerId}`);
  if (q.courseId) clauses.push(Prisma.sql`v."courseId"=${q.courseId}`);
  if (q.courseVersionId)
    clauses.push(Prisma.sql`e."courseVersionId"=${q.courseVersionId}`);
  if (q.sourceRequestId)
    clauses.push(Prisma.sql`e."sourceRequestId"=${q.sourceRequestId}`);
  if (q.sourceOrderId)
    clauses.push(Prisma.sql`e."sourceOrderId"=${q.sourceOrderId}`);
  if (q.groupId)
    clauses.push(
      Prisma.sql`e."groupId"=${q.groupId} AND EXISTS (SELECT 1 FROM "LmsGroupMember" gm WHERE gm."tenantId"=e."tenantId" AND gm."groupId"=e."groupId" AND gm."enrollmentId"=e.id AND gm."excludedAt" IS NULL)`,
    );
  if (q.groupKey) clauses.push(Prisma.sql`e."groupKey"=${q.groupKey}`);
  if (q.status)
    clauses.push(
      ["ACTIVE", "COMPLETED", "CANCELLED"].includes(q.status)
        ? Prisma.sql`e.status=${q.status}`
        : Prisma.sql`COALESCE((SELECT ev.kind FROM "LmsResultEvent" ev WHERE ev."tenantId"=e."tenantId" AND ev."resultId"=latest.id AND ev.kind IN ('VOIDED','SUPERSEDED') ORDER BY ev."createdAt" DESC,ev.id DESC LIMIT 1),CASE WHEN latest."assessmentKind"='EXTERNAL_AUTHORIZED' AND latest."examAt" IS NULL THEN 'NEEDS_REVIEW' ELSE latest.verdict END)=${q.status}`,
    );
  if (q.dueFrom) clauses.push(Prisma.sql`e."dueAt">=${new Date(q.dueFrom)}`);
  if (q.dueTo) clauses.push(Prisma.sql`e."dueAt"<=${new Date(q.dueTo)}`);
  if (q.view === "EXPIRING")
    clauses.push(
      Prisma.sql`e.status='ACTIVE' AND e."dueAt">=${now} AND e."dueAt"<=${new Date(now.getTime() + q.expiringDays * 86400000)}`,
    );
  if (q.view === "INCOMPLETE")
    clauses.push(
      Prisma.sql`e.status='ACTIVE' AND (latest.id IS NULL OR latest.verdict<>'PASSED')`,
    );
  if (q.view === "NEEDS_REVIEW")
    clauses.push(
      Prisma.sql`(latest.id IS NOT NULL AND (NOT latest.eligible OR (latest."assessmentKind"='EXTERNAL_AUTHORIZED' AND latest."examAt" IS NULL) OR EXISTS (SELECT 1 FROM "LmsResultEvent" ev WHERE ev."tenantId"=e."tenantId" AND ev."resultId"=latest.id AND ev.kind IN ('VOIDED','SUPERSEDED'))))`,
    );
  if (q.view === "WAITING_DOCUMENTS")
    clauses.push(
      Prisma.sql`latest.eligible AND NOT EXISTS (SELECT 1 FROM "LmsResultEvent" ev WHERE ev."tenantId"=e."tenantId" AND ev."resultId"=latest.id AND ev.kind IN ('VOIDED','SUPERSEDED')) AND (NOT EXISTS (SELECT 1 FROM "LmsDocumentLink" dl WHERE dl."tenantId"=e."tenantId" AND dl."resultId"=latest.id) OR EXISTS (SELECT 1 FROM "LmsDocumentLink" dl LEFT JOIN "IssuanceWorkflow" iw ON iw."tenantId"=dl."tenantId" AND iw."issuanceId"=dl."issuanceId" WHERE dl."tenantId"=e."tenantId" AND dl."resultId"=latest.id AND (iw.status IS NULL OR iw.status<>'ISSUED')))`,
    );
  return Prisma.join(clauses, " AND ");
}

export const enrollmentJoins = Prisma.sql`FROM "Enrollment" e JOIN "CourseVersion" v ON v.id=e."courseVersionId" AND v."tenantId"=e."tenantId" LEFT JOIN LATERAL (SELECT r.* FROM "VerifiedExamResult" r WHERE r."tenantId"=e."tenantId" AND r."enrollmentId"=e.id ORDER BY r.revision DESC LIMIT 1) latest ON true`;

export async function scopedEnrollmentIds(
  c: Context,
  query: unknown,
  after?: { assignedAt: Date; id: string },
) {
  const q = parseEnrollmentQuery(query);
  const where = enrollmentPredicate(c, q);
  const cursor = after
    ? Prisma.sql`AND (e."assignedAt",e.id)<(${after.assignedAt},${after.id})`
    : Prisma.empty;
  return db.$queryRaw<Array<{ id: string; assignedAt: Date }>>(
    Prisma.sql`SELECT e.id,e."assignedAt" ${enrollmentJoins} WHERE ${where} ${cursor} ORDER BY e."assignedAt" DESC,e.id DESC LIMIT ${q.pageSize} OFFSET ${after ? 0 : (q.page - 1) * q.pageSize}`,
  );
}
