import { Prisma } from "@demo/database";
import { isLmsStaffRole } from "@demo/contracts";
import type { Context } from "../core";
import type { EnrollmentQuery } from "./enrollment-query";
import type { ReportLanguage } from "./report-definitions";
import { enrollmentScopeSql } from "./learning-permissions";

export function registryScope(c: Context, download = false) {
  if (
    !c.learningMode &&
    !c.teachingMode &&
    (isLmsStaffRole(c.role) || (!download && c.role === "VIEWER"))
  )
    return Prisma.sql`d."tenantId"=${c.tenantId}`;
  const downloadScope =
    c.role === "EMPLOYER" && download
      ? Prisma.sql`AND EXISTS(SELECT 1 FROM "EmployerMembership" dm WHERE dm."tenantId"=e."tenantId" AND dm."userId"=${c.userId} AND dm."customerId"=e."customerId" AND dm.active AND (dm."expiresAt" IS NULL OR dm."expiresAt">CURRENT_TIMESTAMP) AND dm.permissions @> '["READ","DOWNLOAD"]'::jsonb AND (dm."recipientIds"='[]'::jsonb OR dm."recipientIds" @> jsonb_build_array(e."recipientId")))`
      : Prisma.empty;
  const linked = Prisma.sql`EXISTS(SELECT 1 FROM "LmsDocumentLink" dl JOIN "VerifiedExamResult" vr ON vr."tenantId"=dl."tenantId" AND vr.id=dl."resultId" JOIN "Enrollment" e ON e."tenantId"=vr."tenantId" AND e.id=vr."enrollmentId" WHERE dl."tenantId"=d."tenantId" AND dl."issuanceId"=d."issuanceId" AND ${enrollmentScopeSql(c)} ${downloadScope})`;
  if (c.role !== "EMPLOYER") return linked;
  const group = Prisma.sql`d."ownerKind"='GROUP' AND EXISTS(SELECT 1 FROM "GroupDocumentMember" gm WHERE gm."tenantId"=d."tenantId" AND gm."documentId"=d.id) AND NOT EXISTS(SELECT 1 FROM "GroupDocumentMember" gm WHERE gm."tenantId"=d."tenantId" AND gm."documentId"=d.id AND NOT EXISTS(SELECT 1 FROM "EmployerMembership" em WHERE em."tenantId"=d."tenantId" AND em."userId"=${c.userId} AND em.active AND (em."expiresAt" IS NULL OR em."expiresAt">CURRENT_TIMESTAMP) AND em.permissions @> ${JSON.stringify(download ? ["READ", "DOWNLOAD"] : ["READ"])}::jsonb AND em."customerId"=gm."employerId" AND (em."recipientIds"='[]'::jsonb OR em."recipientIds" @> jsonb_build_array(gm."recipientId"))))`;
  return Prisma.sql`d."tenantId"=${c.tenantId} AND (${linked} OR (${group}) OR (d."ownerKind"='INDIVIDUAL' AND EXISTS(SELECT 1 FROM "EmployerMembership" em WHERE em."tenantId"=d."tenantId" AND em."userId"=${c.userId} AND em.active AND (em."expiresAt" IS NULL OR em."expiresAt">CURRENT_TIMESTAMP) AND em.permissions @> ${JSON.stringify(download ? ["READ", "DOWNLOAD"] : ["READ"])}::jsonb AND em."customerId"=COALESCE(person.item->>'employerId',i.snapshot->'draft'->>'customerId') AND (em."recipientIds"='[]'::jsonb OR em."recipientIds" @> jsonb_build_array(person.item->>'recipientId')))))`;
}
export const registryJoins = Prisma.sql`FROM "IssuedDocument" d JOIN "Issuance" i ON i."tenantId"=d."tenantId" AND i.id=d."issuanceId"
  LEFT JOIN LATERAL(SELECT item FROM jsonb_array_elements(COALESCE(i.snapshot->'draft'->'items','[]'::jsonb)) item WHERE item->>'id'=d."rowId" LIMIT 1) person ON true
  LEFT JOIN LATERAL(SELECT assignment FROM jsonb_array_elements(COALESCE(person.item->'assignments','[]'::jsonb)) assignment WHERE assignment->>'id'=d."assignmentId" LIMIT 1) study ON true
  LEFT JOIN LATERAL(SELECT event FROM jsonb_array_elements(COALESCE(i.snapshot->'draft'->'events','[]'::jsonb)) event WHERE event->>'id'=d."groupEventId" LIMIT 1) group_study ON true
  LEFT JOIN "CustomerOrganization" co ON co."tenantId"=d."tenantId" AND co.id=COALESCE(person.item->>'employerId',i.snapshot->'draft'->>'customerId')
  LEFT JOIN "IssuanceWorkflow" iw ON iw."tenantId"=d."tenantId" AND iw."issuanceId"=d."issuanceId"
  LEFT JOIN "PrintRequest" pr ON pr."tenantId"=d."tenantId" AND pr.id=d."requestId"
  LEFT JOIN LATERAL(SELECT ev.kind FROM "LmsDocumentLink" dl JOIN "LmsResultEvent" ev ON ev."tenantId"=dl."tenantId" AND ev."resultId"=dl."resultId" WHERE dl."tenantId"=d."tenantId" AND dl."issuanceId"=d."issuanceId" AND ev.kind IN ('VOIDED','SUPERSEDED') ORDER BY ev."createdAt" DESC,ev.id DESC LIMIT 1) result_invalid ON true
  LEFT JOIN LATERAL(SELECT kind FROM "IssuanceEvent" ev WHERE ev."tenantId"=d."tenantId" AND ev."issuanceId"=d."issuanceId" AND kind IN ('CANCELLED','REPLACED') ORDER BY ev."createdAt" DESC,ev.id DESC LIMIT 1) invalid ON true
  LEFT JOIN LATERAL(SELECT rn."documentValidUntil" FROM "RenewalNeed" rn WHERE rn."tenantId"=d."tenantId" AND rn."sourceRequestId"=d."requestId" AND rn."assignmentId"=d."assignmentId" AND rn.confirmed ORDER BY rn."updatedAt" DESC,rn.id DESC LIMIT 1) renewal ON true`;

export function registryCte(
  c: Context,
  q: EnrollmentQuery,
  language: ReportLanguage,
  today: string,
  timezone: string,
) {
  const localDate = (iso: string) =>
    new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date(iso));
  const clauses = [registryScope(c)];
  if (q.customerId) clauses.push(Prisma.sql`co.id=${q.customerId}`);
  if (q.bin) clauses.push(Prisma.sql`co.bin=${q.bin}`);
  if (q.city)
    clauses.push(
      Prisma.sql`co."citySource" IS NOT NULL AND lower(co.city)=lower(${q.city})`,
    );
  if (q.dateFrom)
    clauses.push(Prisma.sql`d."documentDate">=${localDate(q.dateFrom)}`);
  if (q.dateTo)
    clauses.push(Prisma.sql`d."documentDate"<=${localDate(q.dateTo)}`);
  if (q.sourceRequestId)
    clauses.push(Prisma.sql`d."requestId"=${q.sourceRequestId}`);
  if (q.sourceOrderId)
    clauses.push(
      Prisma.sql`(EXISTS(SELECT 1 FROM "ServiceOrderRequest" sor WHERE sor."tenantId"=d."tenantId" AND sor."requestId"=d."requestId" AND sor."orderId"=${q.sourceOrderId}) OR EXISTS(SELECT 1 FROM "LmsDocumentLink" dl JOIN "VerifiedExamResult" vr ON vr.id=dl."resultId" AND vr."tenantId"=dl."tenantId" JOIN cohort e ON e.id=vr."enrollmentId" WHERE dl."tenantId"=d."tenantId" AND dl."issuanceId"=d."issuanceId"))`,
    );
  if (
    q.courseVersionId ||
    q.courseId ||
    q.teacherUserId ||
    q.groupId ||
    q.enrollmentId
  )
    clauses.push(
      Prisma.sql`EXISTS(SELECT 1 FROM "LmsDocumentLink" dl JOIN "VerifiedExamResult" vr ON vr.id=dl."resultId" AND vr."tenantId"=dl."tenantId" JOIN cohort e ON e.id=vr."enrollmentId" WHERE dl."tenantId"=d."tenantId" AND dl."issuanceId"=d."issuanceId")`,
    );
  const name =
    language === "kz"
      ? Prisma.sql`COALESCE(NULLIF(person.item->>'fullNameKz',''),person.item->>'fullNameRu')`
      : Prisma.sql`person.item->>'fullNameRu'`;
  const groupNames = Prisma.sql`(SELECT string_agg(member.value->>${language === "kz" ? "fullNameKz" : "fullNameRu"},', ' ORDER BY member.value->>'fullNameRu') FROM jsonb_array_elements(COALESCE(i.snapshot->'draft'->'items','[]'::jsonb)) AS member(value) WHERE EXISTS(SELECT 1 FROM "GroupDocumentMember" gm WHERE gm."tenantId"=d."tenantId" AND gm."documentId"=d.id AND gm."rowId"=member.value->>'id'))`;
  const org =
    language === "kz"
      ? Prisma.sql`COALESCE(NULLIF(person.item->>'workplaceKz',''),person.item->>'workplaceRu',co."nameKz",co."nameRu")`
      : Prisma.sql`COALESCE(person.item->>'workplaceRu',co."nameRu")`;
  const title =
    language === "kz"
      ? Prisma.sql`COALESCE(NULLIF(study.assignment->>'trainingSubjectKz',''),study.assignment->>'trainingSubject',NULLIF(group_study.event->'commonFields'->>'trainingSubjectKz',''),group_study.event->'commonFields'->>'trainingSubject',group_study.event->>'title')`
      : Prisma.sql`COALESCE(study.assignment->>'trainingSubject',group_study.event->'commonFields'->>'trainingSubject',group_study.event->>'title')`;
  const search = `%${q.search.trim().replace(/[\\%_]/g, "\\$&")}%`;
  if (q.search.trim())
    clauses.push(
      Prisma.sql`(d.number ILIKE ${search} OR ${name} ILIKE ${search} OR ${groupNames} ILIKE ${search} OR ${org} ILIKE ${search} OR ${title} ILIKE ${search})`,
    );
  const validUntil = Prisma.sql`CASE WHEN COALESCE(study.assignment->>'validityMode',group_study.event->'commonFields'->>'validityMode')='UNLIMITED' THEN NULL ELSE COALESCE(NULLIF(study.assignment->>'validUntil',''),NULLIF(group_study.event->'commonFields'->>'validUntil',''),renewal."documentValidUntil") END`;
  const status = Prisma.sql`CASE WHEN result_invalid.kind IS NOT NULL THEN result_invalid.kind WHEN invalid.kind='CANCELLED' OR pr.status='CANCELLED' THEN 'VOIDED' WHEN invalid.kind='REPLACED' THEN 'SUPERSEDED' WHEN iw.status IS NOT NULL AND iw.status<>'ISSUED' THEN iw.status WHEN ${validUntil} IS NULL THEN 'UNKNOWN_VALIDITY' WHEN ${validUntil}<${today} THEN 'EXPIRED' WHEN ${validUntil}<=to_char(${today}::date+30,'YYYY-MM-DD') THEN 'EXPIRING' ELSE 'VALID' END`;
  if (q.status) clauses.push(Prisma.sql`${status}=${q.status}`);
  return Prisma.sql`registry AS MATERIALIZED(SELECT d.id AS "sourceId",d."requestId",NULL::text AS "enrollmentId",
    jsonb_build_object('number',d.number,'name',COALESCE(${name},${groupNames}),'organization',${org},'course',${title},'documentType',CASE WHEN d."templateId" LIKE '%protocol' THEN 'PROTOCOL' WHEN d."templateId" LIKE '%certificate' THEN 'CERTIFICATE' ELSE 'CREDENTIAL' END,
    'origin',CASE WHEN EXISTS(SELECT 1 FROM "LmsDocumentLink" dl WHERE dl."tenantId"=d."tenantId" AND dl."issuanceId"=d."issuanceId") THEN 'LMS' ELSE 'PRINTING' END,
    'requestId',d."requestId",'documentDate',d."documentDate",'validUntil',${validUntil},
    'status',${status}) AS payload
    ${registryJoins} WHERE ${Prisma.join(clauses, " AND ")})`;
}
