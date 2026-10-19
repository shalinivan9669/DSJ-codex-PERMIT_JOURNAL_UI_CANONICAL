import { Prisma } from "@demo/database";
import { db, fail, parse, type Context } from "../core";
import { enrollmentStatusSql } from "./enrollment-state";
import {
  directoryCtes,
  employeeDirectoryRows,
  organizationDirectoryRows,
  directoryOrganizationScope,
} from "./report-directory";
import { registryCte } from "./report-registry";
import {
  enrollmentJoins,
  enrollmentPredicate,
  parseEnrollmentQuery,
  type EnrollmentQuery,
} from "./enrollment-query";
import {
  reportColumns,
  reportDefinitions,
  reportQuerySchema,
  type ReportKind,
  type ReportLanguage,
  type ReportPayload,
  type ReportMetric,
} from "./report-definitions";

export function normalizedReportFilters(input: unknown) {
  const parsed = parseEnrollmentQuery(input);
  if (parsed.dateFrom && parsed.dateTo && parsed.dateFrom > parsed.dateTo)
    fail(400, "VALIDATION", "Начало периода должно быть раньше окончания");
  return { ...parsed, page: 1, pageSize: 100 };
}

/** A shared, scope-first cohort: dates/status describe the assignment, never the document issue date. */
export function reportCohort(
  c: Context,
  q: EnrollmentQuery,
  language: ReportLanguage,
  at: Date,
) {
  const nameField =
    language === "kz"
      ? Prisma.sql`COALESCE(NULLIF(r.data->>'fullNameKz',''),r.data->>'fullNameRu')`
      : Prisma.sql`r.data->>'fullNameRu'`;
  const orgField =
    language === "kz"
      ? Prisma.sql`COALESCE(NULLIF(co."nameKz",''),co."nameRu")`
      : Prisma.sql`co."nameRu"`;
  const titleField =
    language === "kz"
      ? Prisma.sql`COALESCE(NULLIF(v.content->>'titleKz',''),v.content->>'titleRu')`
      : Prisma.sql`v.content->>'titleRu'`;
  const posField =
    language === "kz"
      ? Prisma.sql`COALESCE(NULLIF(r.data->>'positionKz',''),r.data->>'positionRu')`
      : Prisma.sql`r.data->>'positionRu'`;
  // Regulatory results historically set completedAt while keeping raw ACTIVE.
  // Completion is a historical learning fact, independent of later document revocation.
  return Prisma.sql`SELECT e.*,${enrollmentStatusSql()} AS "assignmentStatus",${nameField} AS name,${orgField} AS organization,co.bin,CASE WHEN co."citySource" IS NOT NULL THEN co.city END AS city,
    ${titleField}||' / v'||v.version::text AS course,${posField} AS position,
    COALESCE((SELECT ev.kind FROM "LmsResultEvent" ev WHERE ev."tenantId"=e."tenantId" AND ev."resultId"=latest.id AND ev.kind IN ('VOIDED','SUPERSEDED') ORDER BY ev."createdAt" DESC,ev.id DESC LIMIT 1),latest.verdict,'NOT_STARTED') AS result
    ${enrollmentJoins} JOIN "Recipient" r ON r."tenantId"=e."tenantId" AND r.id=e."recipientId"
    LEFT JOIN "CustomerOrganization" co ON co."tenantId"=e."tenantId" AND co.id=e."customerId" WHERE ${enrollmentPredicate(c, q, at, c.role === "VIEWER" ? Prisma.sql`e."tenantId"=${c.tenantId}` : undefined)}`;
}

const basePayload = Prisma.sql`jsonb_build_object('name',e.name,'organization',e.organization,'course',e.course)`;
export function reportDocuments(today: string) {
  const validUntil = Prisma.sql`CASE WHEN frozen.assignment->>'validityMode'='UNLIMITED' THEN NULL ELSE COALESCE(NULLIF(frozen.assignment->>'validUntil',''),rn."documentValidUntil") END`;
  return Prisma.sql`SELECT e.id AS "enrollmentId",dl.id AS "sourceId",e.name,e.organization,e.course,dl."documentType",d.number,d."documentDate",${validUntil} AS "validUntil",rn."nextCheckDate",rn."policySource",
    iw.status='ISSUED' AND d.id IS NOT NULL AS "wasIssued",
    CASE WHEN rev.kind IS NOT NULL THEN rev.kind WHEN invalid.kind='REPLACED' THEN 'SUPERSEDED' WHEN invalid.kind='CANCELLED' OR pr.status='CANCELLED' THEN 'VOIDED'
      WHEN iw.status='ISSUED' AND d.id IS NOT NULL THEN CASE WHEN ${validUntil} IS NULL THEN 'UNKNOWN_VALIDITY' WHEN ${validUntil}<${today} THEN 'EXPIRED' WHEN ${validUntil}<=to_char(${today}::date+30,'YYYY-MM-DD') THEN 'EXPIRING' ELSE 'VALID' END
      ELSE COALESCE(iw.status,'AWAITING_APPROVAL') END AS status
    FROM cohort e JOIN "VerifiedExamResult" vr ON vr."tenantId"=e."tenantId" AND vr."enrollmentId"=e.id
    JOIN "LmsDocumentLink" dl ON dl."tenantId"=e."tenantId" AND dl."resultId"=vr.id
    LEFT JOIN "IssuedDocument" d ON d."tenantId"=e."tenantId" AND d."issuanceId"=dl."issuanceId" AND d."assignmentId"=vr.id||'-'||dl."documentType" AND d."rowId"=vr."recipientId"
    LEFT JOIN "Issuance" issued ON issued."tenantId"=d."tenantId" AND issued.id=d."issuanceId"
    LEFT JOIN LATERAL (SELECT a.value AS assignment FROM jsonb_array_elements(COALESCE(issued.snapshot->'draft'->'items','[]'::jsonb)) person(value) CROSS JOIN LATERAL jsonb_array_elements(COALESCE(person.value->'assignments','[]'::jsonb)) a(value) WHERE person.value->>'id'=d."rowId" AND a.value->>'id'=d."assignmentId" LIMIT 1) frozen ON true
    LEFT JOIN "IssuanceWorkflow" iw ON iw."tenantId"=e."tenantId" AND iw."issuanceId"=dl."issuanceId"
    LEFT JOIN "PrintRequest" pr ON pr."tenantId"=e."tenantId" AND pr.id=dl."requestId"
    LEFT JOIN LATERAL (SELECT ev.kind FROM "LmsResultEvent" ev WHERE ev."tenantId"=e."tenantId" AND ev."resultId"=vr.id AND ev.kind IN ('VOIDED','SUPERSEDED') ORDER BY ev."createdAt" DESC,ev.id DESC LIMIT 1) rev ON true
    LEFT JOIN LATERAL (SELECT ev.kind FROM "IssuanceEvent" ev WHERE ev."tenantId"=e."tenantId" AND ev."issuanceId"=dl."issuanceId" AND ev.kind IN ('CANCELLED','REPLACED') ORDER BY ev."createdAt" DESC,ev.id DESC LIMIT 1) invalid ON true
    LEFT JOIN LATERAL (SELECT rn."documentValidUntil",rn."nextCheckDate",rn."policySource" FROM "RenewalNeed" rn WHERE rn."tenantId"=e."tenantId" AND rn."sourceRequestId"=dl."requestId" AND rn."assignmentId"=vr.id||'-'||dl."documentType" AND rn.confirmed ORDER BY rn."updatedAt" DESC,rn.id DESC LIMIT 1) rn ON true`;
}

function rawReportRows(kind: ReportKind, timezone: string) {
  if (kind === "DOCUMENT_REGISTRY")
    return Prisma.sql`SELECT "sourceId","enrollmentId",payload FROM registry`;
  if (kind === "EMPLOYEE_DIRECTORY") return employeeDirectoryRows;
  if (kind === "ORGANIZATION_DIRECTORY") return organizationDirectoryRows;
  if (kind === "TRAINING")
    return Prisma.sql`SELECT e.id AS "sourceId",e.id AS "enrollmentId",${basePayload}||jsonb_build_object('assignedAt',to_char(e."assignedAt" AT TIME ZONE 'UTC' AT TIME ZONE ${timezone},'YYYY-MM-DD HH24:MI'),'completedAt',to_char(e."completedAt" AT TIME ZONE 'UTC' AT TIME ZONE ${timezone},'YYYY-MM-DD HH24:MI'),'dueAt',to_char(e."dueAt" AT TIME ZONE 'UTC' AT TIME ZONE ${timezone},'YYYY-MM-DD HH24:MI'),'status',e."assignmentStatus",'result',e.result) AS payload FROM cohort e`;
  if (kind === "EMPLOYEES")
    return Prisma.sql`SELECT e."recipientId" AS "sourceId",NULL::text AS "enrollmentId",jsonb_build_object('name',min(e.name),'organization',string_agg(DISTINCT e.organization,', '),'position',min(e.position),'assignments',count(*),'active',count(*) FILTER (WHERE e."assignmentStatus"='ACTIVE'),'completed',count(*) FILTER (WHERE e."assignmentStatus"='COMPLETED'),'account',CASE WHEN bool_or(e."learnerUserId" IS NOT NULL) THEN 'CONNECTED' ELSE 'NOT_CONNECTED' END) AS payload FROM cohort e GROUP BY e."recipientId"`;
  if (kind === "ORGANIZATIONS")
    return Prisma.sql`SELECT COALESCE(e."customerId",'NO_ORGANIZATION') AS "sourceId",NULL::text AS "enrollmentId",jsonb_build_object('organization',min(e.organization),'bin',min(e.bin),'city',min(e.city),'participants',count(DISTINCT e."recipientId"),'assignments',count(*),'active',count(*) FILTER (WHERE e."assignmentStatus"='ACTIVE'),'completed',count(*) FILTER (WHERE e."assignmentStatus"='COMPLETED')) AS payload FROM cohort e GROUP BY e."customerId"`;
  if (kind === "TESTING")
    return Prisma.sql`SELECT a.id AS "sourceId",e.id AS "enrollmentId",${basePayload}||jsonb_build_object('purpose',a.purpose,'ordinal',a.ordinal,'eventAt',to_char(COALESCE(a."submittedAt",a."finishedAt") AT TIME ZONE 'UTC' AT TIME ZONE ${timezone},'YYYY-MM-DD HH24:MI'),'status',a.state,'score',a.score,'maximum',a.maximum,'result',a.verdict) AS payload FROM cohort e JOIN "ExamAttempt" a ON a."tenantId"=e."tenantId" AND a."enrollmentId"=e.id WHERE a."submittedAt" IS NOT NULL OR a."finishedAt" IS NOT NULL`;
  if (kind === "DEADLINES")
    return Prisma.sql`SELECT e.id||':ACCESS' AS "sourceId",e.id AS "enrollmentId",${basePayload}||jsonb_build_object('deadlineKind','ACCESS','deadline',to_char(e."dueAt" AT TIME ZONE 'UTC' AT TIME ZONE ${timezone},'YYYY-MM-DD HH24:MI'),'status',CASE WHEN e."dueAt" IS NULL THEN 'UNKNOWN' ELSE 'KNOWN' END,'basis',${"Назначение / Тағайындау"}) AS payload FROM cohort e
    UNION ALL SELECT d."sourceId"||':DOCUMENT',d."enrollmentId",jsonb_build_object('name',d.name,'organization',d.organization,'course',d.course,'deadlineKind','DOCUMENT','deadline',d."validUntil",'status',d.status,'basis',d."policySource") FROM documents d
    UNION ALL SELECT d."sourceId"||':NEXT_CHECK',d."enrollmentId",jsonb_build_object('name',d.name,'organization',d.organization,'course',d.course,'deadlineKind','NEXT_CHECK','deadline',d."nextCheckDate",'status',CASE WHEN d."nextCheckDate" IS NULL THEN 'UNKNOWN' ELSE 'KNOWN' END,'basis',d."policySource") FROM documents d`;
  const type =
    kind === "CREDENTIALS"
      ? "CREDENTIAL"
      : kind === "CERTIFICATES"
        ? "CERTIFICATE"
        : null;
  return Prisma.sql`SELECT d."sourceId",d."enrollmentId",jsonb_build_object('name',d.name,'organization',d.organization,'course',d.course,'number',d.number,'documentType',d."documentType",'status',d.status,'documentDate',d."documentDate",'validUntil',d."validUntil",'wasIssued',CASE WHEN d."wasIssued" THEN 'YES' ELSE 'NO' END) AS payload FROM documents d ${type ? Prisma.sql`WHERE d."documentType"=${type} AND d.number IS NOT NULL` : Prisma.empty}`;
}

export const metricKinds: Record<ReportMetric, ReportKind> = {
  participants: "EMPLOYEES",
  accounts: "EMPLOYEES",
  organizations: "ORGANIZATIONS",
  activeAssignments: "TRAINING",
  completedAssignments: "TRAINING",
  attempts: "TESTING",
  passedAttempts: "TESTING",
  issuedDocuments: "DOCUMENTS",
  validDocuments: "DOCUMENTS",
  expiringDocuments: "DOCUMENTS",
  voidedDocuments: "DOCUMENTS",
  supersededDocuments: "DOCUMENTS",
  unknownValidity: "DOCUMENTS",
};
export function reportRows(
  kind: ReportKind,
  timezone: string,
  metric?: ReportMetric,
) {
  if (metric && metricKinds[metric] !== kind)
    fail(400, "VALIDATION", "Выберите отчёт, соответствующий показателю");
  if (metric === "accounts")
    return Prisma.sql`SELECT e."learnerUserId" AS "sourceId",NULL::text AS "enrollmentId",jsonb_build_object('name',min(e.name),'organization',string_agg(DISTINCT e.organization,', '),'position',min(e.position),'assignments',count(*),'active',count(*) FILTER (WHERE e."assignmentStatus"='ACTIVE'),'completed',count(*) FILTER (WHERE e."assignmentStatus"='COMPLETED'),'account','CONNECTED') AS payload FROM cohort e WHERE e."learnerUserId" IS NOT NULL GROUP BY e."learnerUserId"`;
  const clauses: Partial<Record<ReportMetric, Prisma.Sql>> = {
    organizations: Prisma.sql`r."sourceId"<>'NO_ORGANIZATION'`,
    activeAssignments: Prisma.sql`r.payload->>'status'='ACTIVE'`,
    completedAssignments: Prisma.sql`r.payload->>'status'='COMPLETED'`,
    passedAttempts: Prisma.sql`r.payload->>'result'='PASSED'`,
    issuedDocuments: Prisma.sql`r.payload->>'wasIssued'='YES'`,
    validDocuments: Prisma.sql`r.payload->>'status' IN ('VALID','EXPIRING')`,
    expiringDocuments: Prisma.sql`r.payload->>'status'='EXPIRING'`,
    voidedDocuments: Prisma.sql`r.payload->>'status'='VOIDED'`,
    supersededDocuments: Prisma.sql`r.payload->>'status'='SUPERSEDED'`,
    unknownValidity: Prisma.sql`r.payload->>'status'='UNKNOWN_VALIDITY'`,
  };
  return Prisma.sql`SELECT * FROM (${rawReportRows(kind, timezone)}) r ${metric && clauses[metric] ? Prisma.sql`WHERE ${clauses[metric]}` : Prisma.empty}`;
}

export function reportCohortFilters(q: EnrollmentQuery, kind?: ReportKind) {
  return kind === "ORGANIZATION_DIRECTORY"
    ? { ...q, search: "" }
    : kind === "DOCUMENT_REGISTRY"
      ? {
          ...q,
          search: "",
          dateFrom: undefined,
          dateTo: undefined,
          status: undefined,
        }
      : q;
}
export function reportCtes(
  c: Context,
  q: EnrollmentQuery,
  language: ReportLanguage,
  at: Date,
  timezone: string,
  kind?: ReportKind,
) {
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(at);
  const cohortFilters = reportCohortFilters(q, kind);
  return Prisma.sql`WITH cohort AS MATERIALIZED (${reportCohort(c, cohortFilters, language, at)}), documents AS MATERIALIZED (${reportDocuments(today)}),${directoryCtes(c, q, language)},${registryCte(c, q, language, today, timezone)}`;
}
export const summarySql = Prisma.sql`SELECT jsonb_build_object(
 'participants',(SELECT count(DISTINCT "recipientId") FROM cohort),
 'accounts',(SELECT count(DISTINCT "learnerUserId") FROM cohort),
 'organizations',(SELECT count(DISTINCT "customerId") FROM cohort),
 'activeAssignments',(SELECT count(*) FROM cohort WHERE "assignmentStatus"='ACTIVE'),
 'completedAssignments',(SELECT count(*) FROM cohort WHERE "assignmentStatus"='COMPLETED'),
 'attempts',(SELECT count(*) FROM "ExamAttempt" a JOIN cohort e ON e."tenantId"=a."tenantId" AND e.id=a."enrollmentId" WHERE a."submittedAt" IS NOT NULL OR a."finishedAt" IS NOT NULL),
 'passedAttempts',(SELECT count(*) FROM "ExamAttempt" a JOIN cohort e ON e."tenantId"=a."tenantId" AND e.id=a."enrollmentId" WHERE (a."submittedAt" IS NOT NULL OR a."finishedAt" IS NOT NULL) AND a.verdict='PASSED'),
 'issuedDocuments',(SELECT count(*) FROM documents WHERE "wasIssued"),
 'validDocuments',(SELECT count(*) FROM documents WHERE status IN ('VALID','EXPIRING')),
 'expiringDocuments',(SELECT count(*) FROM documents WHERE status='EXPIRING'),
 'voidedDocuments',(SELECT count(*) FROM documents WHERE status='VOIDED'),
 'supersededDocuments',(SELECT count(*) FROM documents WHERE status='SUPERSEDED'),
 'unknownValidity',(SELECT count(*) FROM documents WHERE status='UNKNOWN_VALIDITY')
) AS summary`;

export async function queryReport(c: Context, input: unknown) {
  const data = parse(reportQuerySchema, input);
  const q = normalizedReportFilters(data.filters);
  const tenant = await db.tenant.findUniqueOrThrow({
    where: { id: c.tenantId },
    select: { timezone: true },
  });
  const at = new Date();
  const [result] = await db.$queryRaw<
    Array<{
      total: bigint;
      items: Array<{
        sourceId: string;
        enrollmentId: string | null;
        payload: ReportPayload;
      }>;
      summary: Record<string, number>;
    }>
  >(
    Prisma.sql`${reportCtes(c, q, data.language, at, tenant.timezone, data.kind)}, rows AS MATERIALIZED (${reportRows(data.kind, tenant.timezone, data.metric)}), totals AS (${summarySql})
    SELECT (SELECT count(*) FROM rows) AS total,COALESCE((SELECT jsonb_agg(page ORDER BY page."sourceId") FROM (SELECT * FROM rows ORDER BY "sourceId" LIMIT ${data.pageSize} OFFSET ${(data.page - 1) * data.pageSize}) page),'[]'::jsonb) AS items,totals.summary FROM totals`,
  );
  return {
    ...result,
    total: Number(result.total),
    page: data.page,
    pageSize: data.pageSize,
    kind: data.kind,
    metric: data.metric,
    columns: reportColumns(data.kind, data.language),
    definition:
      reportDefinitions[data.kind][data.language === "kz" ? "rowKz" : "rowRu"],
    snapshotAt: at.toISOString(),
    timezone: tenant.timezone,
    filters: q,
  };
}

export async function reportFilterOptions(c: Context) {
  const scope = enrollmentPredicate(
    c,
    parseEnrollmentQuery({}),
    new Date(),
    c.role === "VIEWER" ? Prisma.sql`e."tenantId"=${c.tenantId}` : undefined,
  );
  const [customers, courses, teachers, cities] = await Promise.all([
    db.$queryRaw<Array<{ id: string; labelRu: string; labelKz: string }>>(
      Prisma.sql`WITH cohort AS (${reportCohort(c, parseEnrollmentQuery({}), "ru", new Date())}) SELECT co.id,co."nameRu" AS "labelRu",COALESCE(NULLIF(co."nameKz",''),co."nameRu") AS "labelKz" FROM "CustomerOrganization" co WHERE ${directoryOrganizationScope(c)} ORDER BY co."nameRu",co.id LIMIT 250`,
    ),
    db.$queryRaw<Array<{ id: string; labelRu: string; labelKz: string }>>(
      Prisma.sql`SELECT cv.id,cv.content->>'titleRu'||' / v'||cv.version::text AS "labelRu",COALESCE(NULLIF(cv.content->>'titleKz',''),cv.content->>'titleRu')||' / v'||cv.version::text AS "labelKz" FROM "CourseVersion" cv WHERE cv."tenantId"=${c.tenantId} AND EXISTS(SELECT 1 ${enrollmentJoins} WHERE ${scope} AND e."courseVersionId"=cv.id) ORDER BY cv.id LIMIT 250`,
    ),
    db.$queryRaw<Array<{ id: string; labelRu: string; labelKz: string }>>(
      Prisma.sql`SELECT u.id,u."displayName" AS "labelRu",u."displayName" AS "labelKz" FROM "User" u WHERE u."tenantId"=${c.tenantId} AND EXISTS(SELECT 1 ${enrollmentJoins} JOIN "LmsTeachingBinding" b ON b."tenantId"=e."tenantId" AND b."userId"=u.id AND b."courseId"=v."courseId" WHERE ${scope} AND b."revokedAt" IS NULL AND b.permissions @> '["READ"]'::jsonb AND (b."groupId" IS NULL OR b."groupId"=e."groupId")) ORDER BY u."displayName",u.id LIMIT 250`,
    ),
    db.$queryRaw<Array<{ city: string }>>(
      Prisma.sql`SELECT DISTINCT co.city FROM "CustomerOrganization" co WHERE co."tenantId"=${c.tenantId} AND co.city IS NOT NULL AND co."citySource" IS NOT NULL AND EXISTS(SELECT 1 ${enrollmentJoins} WHERE ${scope} AND e."customerId"=co.id) ORDER BY co.city LIMIT 250`,
    ),
  ]);
  return { customers, courses, teachers, cities: cities.map((r) => r.city) };
}
