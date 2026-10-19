import { Prisma } from "@demo/database";
import { db, parse, type Context } from "../core";
import { enrollmentScopeSql } from "./learning-permissions";
import { pagingSchema } from "./validation";
import { enrollmentStatusSql } from "./enrollment-state";

export type EnrollmentQuery = ReturnType<typeof pagingSchema.parse>;
export const parseEnrollmentQuery = (input: unknown) =>
  parse(pagingSchema, input);

// Date binds are timestamptz; persisted Prisma timestamps contain UTC without a
// timezone. Keep filtering/keyset ordering independent of the PG session zone.
const utcTimestamp = (value: Date) =>
  Prisma.sql`(${value}::timestamptz AT TIME ZONE 'UTC')`;

/** e and v are fixed SQL aliases. Every caller uses this same scope before paging/count/export. */
export function enrollmentPredicate(
  c: Context,
  q: EnrollmentQuery,
  now = new Date(),
  readScope?: Prisma.Sql,
) {
  const clauses: Prisma.Sql[] = [readScope || enrollmentScopeSql(c)];
  if (q.enrollmentId) clauses.push(Prisma.sql`e.id=${q.enrollmentId}`);
  if (q.search.trim()) {
    const search = `%${q.search.trim().replace(/[\\%_]/g, "\\$&")}%`;
    clauses.push(
      Prisma.sql`EXISTS (SELECT 1 FROM "Recipient" r WHERE r."tenantId"=e."tenantId" AND r.id=e."recipientId" AND (r.data->>'fullNameRu' ILIKE ${search} OR r.data->>'fullNameKz' ILIKE ${search}))`,
    );
  }
  if (q.customerId) clauses.push(Prisma.sql`e."customerId"=${q.customerId}`);
  if (q.dateFrom)
    clauses.push(
      Prisma.sql`e."assignedAt">=${utcTimestamp(new Date(q.dateFrom))}`,
    );
  if (q.dateTo)
    clauses.push(
      Prisma.sql`e."assignedAt"<=${utcTimestamp(new Date(q.dateTo))}`,
    );
  if (q.bin)
    clauses.push(
      Prisma.sql`EXISTS (SELECT 1 FROM "CustomerOrganization" filter_co WHERE filter_co."tenantId"=e."tenantId" AND filter_co.id=e."customerId" AND filter_co.bin=${q.bin})`,
    );
  if (q.city)
    clauses.push(
      Prisma.sql`EXISTS (SELECT 1 FROM "CustomerOrganization" filter_co WHERE filter_co."tenantId"=e."tenantId" AND filter_co.id=e."customerId" AND filter_co."citySource" IS NOT NULL AND lower(filter_co.city)=lower(${q.city}))`,
    );
  if (q.teacherUserId)
    clauses.push(
      Prisma.sql`EXISTS (SELECT 1 FROM "LmsTeachingBinding" filter_tb WHERE filter_tb."tenantId"=e."tenantId" AND filter_tb."userId"=${q.teacherUserId} AND filter_tb."courseId"=v."courseId" AND filter_tb."revokedAt" IS NULL AND filter_tb.permissions @> '["READ"]'::jsonb AND (filter_tb."groupId" IS NULL OR (filter_tb."groupId"=e."groupId" AND EXISTS (SELECT 1 FROM "LmsGroupMember" filter_gm WHERE filter_gm."tenantId"=e."tenantId" AND filter_gm."enrollmentId"=e.id AND filter_gm."groupId"=e."groupId" AND filter_gm."excludedAt" IS NULL))))`,
    );
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
        ? Prisma.sql`${enrollmentStatusSql()}=${q.status}`
        : Prisma.sql`COALESCE((SELECT ev.kind FROM "LmsResultEvent" ev WHERE ev."tenantId"=e."tenantId" AND ev."resultId"=latest.id AND ev.kind IN ('VOIDED','SUPERSEDED') ORDER BY ev."createdAt" DESC,ev.id DESC LIMIT 1),CASE WHEN latest."assessmentKind"='EXTERNAL_AUTHORIZED' AND latest."examAt" IS NULL THEN 'NEEDS_REVIEW' ELSE latest.verdict END)=${q.status}`,
    );
  if (q.dueFrom)
    clauses.push(Prisma.sql`e."dueAt">=${utcTimestamp(new Date(q.dueFrom))}`);
  if (q.dueTo)
    clauses.push(Prisma.sql`e."dueAt"<=${utcTimestamp(new Date(q.dueTo))}`);
  if (q.view === "EXPIRING")
    clauses.push(
      Prisma.sql`e.status='ACTIVE' AND e."dueAt">=${utcTimestamp(now)} AND e."dueAt"<=${utcTimestamp(new Date(now.getTime() + q.expiringDays * 86400000))}`,
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
      Prisma.sql`NOT (latest."assessmentKind"='EXTERNAL_AUTHORIZED' AND latest."examAt" IS NULL)`,
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
    ? Prisma.sql`AND (e."assignedAt",e.id)<(${utcTimestamp(after.assignedAt)},${after.id})`
    : Prisma.empty;
  return db.$queryRaw<Array<{ id: string; assignedAt: Date }>>(
    Prisma.sql`SELECT e.id,e."assignedAt" ${enrollmentJoins} WHERE ${where} ${cursor} ORDER BY e."assignedAt" DESC,e.id DESC LIMIT ${q.pageSize} OFFSET ${after ? 0 : (q.page - 1) * q.pageSize}`,
  );
}
