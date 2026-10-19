import { Prisma } from "@demo/database";
import { isLmsStaffRole } from "@demo/contracts";
import type { Context } from "../core";
import type { EnrollmentQuery } from "./enrollment-query";
import type { ReportLanguage } from "./report-definitions";
import { registryJoins, registryScope } from "./report-registry";

/** Only current grants count. Empty directories never manufacture an enrollment. */
export function directoryPersonScope(c: Context, download = false) {
  const tenant = Prisma.sql`r."tenantId"=${c.tenantId}`;
  if (
    !c.learningMode &&
    !c.teachingMode &&
    (isLmsStaffRole(c.role) || (!download && c.role === "VIEWER"))
  )
    return tenant;
  if (c.role === "EMPLOYER")
    return Prisma.sql`${tenant} AND EXISTS (
    SELECT 1 FROM "EmployerMembership" em WHERE em."tenantId"=r."tenantId" AND em."userId"=${c.userId} AND em.active
    AND (em."expiresAt" IS NULL OR em."expiresAt">CURRENT_TIMESTAMP)
    AND em.permissions @> ${JSON.stringify(download ? ["READ", "DOWNLOAD"] : ["READ"])}::jsonb
    AND (em."recipientIds"='[]'::jsonb OR em."recipientIds" @> jsonb_build_array(r.id))
    AND (EXISTS(SELECT 1 FROM "RecipientEmployment" re WHERE re."tenantId"=r."tenantId" AND re."recipientId"=r.id AND re."employerId"=em."customerId")
      OR EXISTS(SELECT 1 FROM "Enrollment" de WHERE de."tenantId"=r."tenantId" AND de."recipientId"=r.id AND de."customerId"=em."customerId")))`;
  return Prisma.sql`${tenant} AND EXISTS(SELECT 1 FROM cohort e WHERE e."recipientId"=r.id)`;
}
export function directoryOrganizationScope(c: Context, download = false) {
  const tenant = Prisma.sql`co."tenantId"=${c.tenantId}`;
  if (
    !c.learningMode &&
    !c.teachingMode &&
    (isLmsStaffRole(c.role) || (!download && c.role === "VIEWER"))
  )
    return tenant;
  if (c.role === "EMPLOYER")
    return Prisma.sql`${tenant} AND EXISTS(SELECT 1 FROM "EmployerMembership" em WHERE em."tenantId"=co."tenantId" AND em."customerId"=co.id AND em."userId"=${c.userId} AND em.active AND (em."expiresAt" IS NULL OR em."expiresAt">CURRENT_TIMESTAMP) AND em.permissions @> ${JSON.stringify(download ? ["READ", "DOWNLOAD"] : ["READ"])}::jsonb)`;
  return Prisma.sql`${tenant} AND EXISTS(SELECT 1 FROM cohort e WHERE e."customerId"=co.id)`;
}

export function directoryCtes(
  c: Context,
  q: EnrollmentQuery,
  language: ReportLanguage,
) {
  const name =
    language === "kz"
      ? Prisma.sql`COALESCE(NULLIF(r.data->>'fullNameKz',''),r.data->>'fullNameRu')`
      : Prisma.sql`r.data->>'fullNameRu'`;
  const orgName =
    language === "kz"
      ? Prisma.sql`COALESCE(NULLIF(co."nameKz",''),co."nameRu")`
      : Prisma.sql`co."nameRu"`;
  const position =
    language === "kz"
      ? Prisma.sql`COALESCE(NULLIF(r.data->>'positionKz',''),r.data->>'positionRu','')`
      : Prisma.sql`COALESCE(r.data->>'positionRu','')`;
  const search = `%${q.search.trim().replace(/[\\%_]/g, "\\$&")}%`;
  const orgFilters = [directoryOrganizationScope(c)];
  if (q.customerId) orgFilters.push(Prisma.sql`co.id=${q.customerId}`);
  if (q.bin) orgFilters.push(Prisma.sql`co.bin=${q.bin}`);
  if (q.city)
    orgFilters.push(
      Prisma.sql`co."citySource" IS NOT NULL AND lower(co.city)=lower(${q.city})`,
    );
  const personFilters = [directoryPersonScope(c)];
  if (q.search.trim())
    personFilters.push(
      Prisma.sql`(r.data->>'fullNameRu' ILIKE ${search} OR r.data->>'fullNameKz' ILIKE ${search})`,
    );
  if (q.customerId || q.bin || q.city)
    personFilters.push(
      Prisma.sql`EXISTS(SELECT 1 FROM directory_organizations org WHERE EXISTS(SELECT 1 FROM "RecipientEmployment" re WHERE re."tenantId"=r."tenantId" AND re."recipientId"=r.id AND re."employerId"=org.id) OR EXISTS(SELECT 1 FROM cohort e WHERE e."recipientId"=r.id AND e."customerId"=org.id))`,
    );
  return Prisma.sql`directory_organizations AS MATERIALIZED (
    SELECT co.id,${orgName} AS organization,co.bin,CASE WHEN co."citySource" IS NOT NULL THEN co.city END AS city,${q.search.trim() ? Prisma.sql`(co."nameRu" ILIKE ${search} OR co."nameKz" ILIKE ${search} OR co.bin ILIKE ${search})` : Prisma.sql`TRUE`} AS matches
    FROM "CustomerOrganization" co WHERE ${Prisma.join(orgFilters, " AND ")}
  ),directory_people AS MATERIALIZED (
    SELECT r.id,${name} AS name,${position} AS position,
    (SELECT string_agg(DISTINCT org.organization,', ') FROM directory_organizations org WHERE EXISTS(SELECT 1 FROM "RecipientEmployment" re WHERE re."tenantId"=r."tenantId" AND re."recipientId"=r.id AND re."employerId"=org.id) OR EXISTS(SELECT 1 FROM cohort e WHERE e."recipientId"=r.id AND e."customerId"=org.id)) AS organization,
    EXISTS(SELECT 1 FROM "LearnerProfile" lp WHERE lp."tenantId"=r."tenantId" AND lp."recipientId"=r.id) AS connected
    FROM "Recipient" r WHERE ${Prisma.join(personFilters, " AND ")}
  )`;
}

export const employeeDirectoryRows = Prisma.sql`SELECT p.id AS "sourceId",NULL::text AS "enrollmentId",jsonb_build_object('name',p.name,'organization',p.organization,'position',p.position,'assignments',count(e.id),'active',count(e.id) FILTER(WHERE e."assignmentStatus"='ACTIVE'),'completed',count(e.id) FILTER(WHERE e."assignmentStatus"='COMPLETED'),'account',CASE WHEN p.connected THEN 'CONNECTED' ELSE 'NOT_CONNECTED' END) AS payload FROM directory_people p LEFT JOIN cohort e ON e."recipientId"=p.id GROUP BY p.id,p.name,p.organization,p.position,p.connected`;
export const organizationDirectoryRows = Prisma.sql`SELECT p.id AS "sourceId",NULL::text AS "enrollmentId",jsonb_build_object('organization',p.organization,'bin',p.bin,'city',p.city,'participants',count(DISTINCT e."recipientId"),'assignments',count(e.id),'active',count(e.id) FILTER(WHERE e."assignmentStatus"='ACTIVE'),'completed',count(e.id) FILTER(WHERE e."assignmentStatus"='COMPLETED')) AS payload FROM directory_organizations p LEFT JOIN cohort e ON e."customerId"=p.id WHERE p.matches GROUP BY p.id,p.organization,p.bin,p.city`;

/** s is LmsReportEntityScope; tenant and mutable membership are rechecked at download. */
export function reportEntityAllowedSql(c: Context) {
  if (!c.learningMode && !c.teachingMode && isLmsStaffRole(c.role))
    return Prisma.sql`TRUE`;
  const document = Prisma.sql`(s."entityKind"='DOCUMENT' AND EXISTS(SELECT 1 ${registryJoins} WHERE d.id=s."entityId" AND ${registryScope(c, true)}))`;
  if (c.role === "EMPLOYER")
    return Prisma.sql`(${document} OR (s."entityKind"='RECIPIENT' AND EXISTS(SELECT 1 FROM "Recipient" r WHERE r.id=s."entityId" AND ${directoryPersonScope(c, true)})) OR (s."entityKind"='ORGANIZATION' AND EXISTS(SELECT 1 FROM "CustomerOrganization" co WHERE co.id=s."entityId" AND ${directoryOrganizationScope(c, true)})))`;
  // Teaching/learner directory rows are all backed by LmsReportScope, checked separately.
  return Prisma.sql`(s."entityKind"<>'DOCUMENT' OR ${document})`;
}
