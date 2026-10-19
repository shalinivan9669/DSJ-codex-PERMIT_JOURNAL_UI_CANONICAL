import { randomUUID } from "node:crypto";
import { unlink } from "node:fs/promises";
import { ArtifactStore } from "@demo/printing";
import { Prisma, type LmsReportJob } from "@demo/database";
import { db, fail, hash, json, parse, audit, type Context } from "../core";
import { enrollmentScopeSql } from "./learning-permissions";
import { reportEntityAllowedSql } from "./report-directory";
import {
  normalizedReportFilters,
  reportCohort,
  reportCohortFilters,
  reportCtes,
  reportRows,
  summarySql,
} from "./report-query";
import {
  reportCreateSchema,
  reportColumns,
  reportDefinitions,
  type ReportKind,
  type ReportLanguage,
  type ReportMetric,
} from "./report-definitions";
import { openPrivateStream } from "./materials";

export const REPORT_RETENTION_DAYS = 7;
export const REPORT_MAX_ROWS = 5000;
export const reportMime: Record<string, string> = {
  CSV: "text/csv; charset=utf-8",
  XLSX: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  PDF: "application/pdf",
};
type ScopePolicy = {
  version: 1;
  timezone: string;
  learningMode: boolean;
  teachingMode: boolean;
  summary: Record<string, number>;
  metric?: ReportMetric;
};
export function reportPolicy(job: LmsReportJob) {
  return job.scopePolicy as unknown as ScopePolicy;
}

function employerReportMembershipSql(c: Context) {
  return Prisma.sql`report_em."tenantId"=${c.tenantId} AND report_em."userId"=${c.userId} AND report_em.active
    AND (report_em."expiresAt" IS NULL OR report_em."expiresAt">CURRENT_TIMESTAMP)
    AND report_em.permissions @> '["READ","DOWNLOAD"]'::jsonb`;
}
function reportDownloadGrantSql(c: Context) {
  return c.role === "EMPLOYER"
    ? Prisma.sql`EXISTS (SELECT 1 FROM "EmployerMembership" report_em WHERE ${employerReportMembershipSql(c)})`
    : Prisma.sql`TRUE`;
}
/** Both permissions must belong to the same current organisation/recipient grant. */
function reportDownloadScopeSql(c: Context) {
  return c.role === "EMPLOYER"
    ? Prisma.sql`EXISTS (SELECT 1 FROM "EmployerMembership" report_em WHERE ${employerReportMembershipSql(c)}
        AND report_em."customerId"=e."customerId"
        AND (report_em."recipientIds"='[]'::jsonb OR report_em."recipientIds" @> jsonb_build_array(e."recipientId")))`
    : Prisma.sql`TRUE`;
}
async function snapshotTransaction<T>(
  run: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await db.$transaction(run, {
        isolationLevel: "RepeatableRead",
        maxWait: 20000,
        timeout: 30000,
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        ["P2034", "P2002"].includes(error.code) &&
        attempt < 4
      ) {
        await new Promise((resolve) => setTimeout(resolve, 25 * (attempt + 1)));
        continue;
      }
      throw error;
    }
  }
}

/** Reconstruct authority from the current user and recheck every contributing enrollment. */
export async function assertReportAuthority(job: LmsReportJob, c?: Context) {
  if (c && (c.tenantId !== job.tenantId || c.userId !== job.requestedBy))
    fail(404, "NOT_FOUND", "Отчёт не найден");
  const user = await db.user.findFirst({
    where: { tenantId: job.tenantId, id: job.requestedBy, active: true },
    select: { role: true },
  });
  if (!user || user.role !== job.requestedRole)
    fail(
      403,
      "REPORT_ACCESS_REVOKED",
      "Доступ изменился. Создайте новый отчёт из доступных данных",
    );
  const policy = reportPolicy(job);
  const current: Context = {
    tenantId: job.tenantId,
    userId: job.requestedBy,
    role: user.role,
    sessionId: c?.sessionId || "report-worker",
    csrfHash: "",
    correlationId: c?.correlationId || job.id,
    learningMode: policy.learningMode,
    teachingMode: policy.teachingMode,
  };
  const [denied] = await db.$queryRaw<Array<{ denied: boolean }>>(
    Prisma.sql`SELECT NOT (${reportDownloadGrantSql(current)}) OR EXISTS (SELECT 1 FROM "LmsReportScope" s LEFT JOIN "Enrollment" e ON e."tenantId"=s."tenantId" AND e.id=s."enrollmentId" WHERE s."tenantId"=${job.tenantId} AND s."jobId"=${job.id} AND (e.id IS NULL OR NOT ((${enrollmentScopeSql(current)}) AND ${reportDownloadScopeSql(current)}))) OR EXISTS(SELECT 1 FROM "LmsReportEntityScope" s WHERE s."tenantId"=${job.tenantId} AND s."jobId"=${job.id} AND NOT (${reportEntityAllowedSql(current)})) AS denied`,
  );
  if (denied.denied)
    fail(
      403,
      "REPORT_ACCESS_REVOKED",
      "Область доступа изменилась. Создайте новый отчёт из доступных данных",
    );
  return current;
}

export async function createReport(c: Context, input: unknown) {
  if (c.role === "VIEWER")
    fail(
      403,
      "REPORT_DOWNLOAD_DENIED",
      "Право выгрузки отчётов не предоставлено",
    );
  const data = parse(reportCreateSchema, input);
  const filters = normalizedReportFilters(data.filters);
  const payloadHash = hash({ ...data, filters });
  const tenant = await db.tenant.findUniqueOrThrow({
    where: { id: c.tenantId },
    select: { timezone: true },
  });
  const actor = await db.user.findFirst({
    where: { id: c.userId, tenantId: c.tenantId, active: true },
    select: { role: true },
  });
  if (!actor || actor.role !== c.role)
    fail(403, "REPORT_ACCESS_REVOKED", "Права изменились. Обновите страницу");
  const created = await snapshotTransaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${"report:" + c.tenantId + ":" + c.userId},0))`;
    const existing = await tx.lmsReportJob.findUnique({
      where: {
        tenantId_requestedBy_requestKey: {
          tenantId: c.tenantId,
          requestedBy: c.userId,
          requestKey: data.requestKey,
        },
      },
    });
    if (existing) {
      if (existing.payloadHash !== payloadHash)
        fail(
          409,
          "IDEMPOTENCY_CONFLICT",
          "Эта операция уже использована с другими параметрами",
        );
      return existing;
    }
    const pending = await tx.lmsReportJob.count({
      where: {
        tenantId: c.tenantId,
        requestedBy: c.userId,
        status: { in: ["PENDING", "RUNNING"] },
      },
    });
    if (pending >= 3)
      fail(
        429,
        "REPORT_QUEUE_BUSY",
        "Дождитесь завершения или отмените один из отчётов",
      );
    const at = new Date();
    const cohortFilters = reportCohortFilters(filters, data.kind);
    const ctes = reportCtes(
      c,
      filters,
      data.language,
      at,
      tenant.timezone,
      data.kind,
    );
    if (c.role === "EMPLOYER") {
      const [authority] = await tx.$queryRaw<Array<{ allowed: boolean }>>(
        Prisma.sql`SELECT ${reportDownloadGrantSql(c)} AND NOT EXISTS (
          SELECT 1 FROM (${reportCohort(c, cohortFilters, data.language, at)}) e
          WHERE NOT (${reportDownloadScopeSql(c)})
        ) AS allowed`,
      );
      if (!authority.allowed)
        fail(
          403,
          "EMPLOYER_DOCUMENT_DOWNLOAD_DENIED",
          "Нет действующего права скачивать отчёт по выбранным сотрудникам",
        );
    }
    const [aggregate] = await tx.$queryRaw<
      Array<{ total: bigint; summary: Record<string, number> }>
    >(
      Prisma.sql`${ctes}, rows AS (${reportRows(data.kind, tenant.timezone, data.metric)}), totals AS (${summarySql}) SELECT (SELECT count(*) FROM rows) AS total,totals.summary FROM totals`,
    );
    if (Number(aggregate.total) > REPORT_MAX_ROWS)
      fail(
        422,
        "REPORT_TOO_LARGE",
        "В одном файле доступно до 5 000 строк. Разделите отчёт по организации, курсу или периоду",
      );
    const scopePolicy: ScopePolicy = {
      version: 1,
      timezone: tenant.timezone,
      learningMode: !!c.learningMode,
      teachingMode: !!c.teachingMode,
      summary: aggregate.summary,
      metric: data.metric,
    };
    const job = await tx.lmsReportJob.create({
      data: {
        tenantId: c.tenantId,
        requestedBy: c.userId,
        requestedRole: c.role,
        scopePolicy: json(scopePolicy),
        reportKind: data.kind,
        format: data.format,
        language: data.language,
        filters: json(filters),
        requestKey: data.requestKey,
        payloadHash,
        totalRows: Number(aggregate.total),
        snapshotAt: at,
        expiresAt: new Date(at.getTime() + REPORT_RETENTION_DAYS * 86400000),
      },
    });
    await tx.$executeRaw(
      Prisma.sql`INSERT INTO "LmsReportScope" ("tenantId","jobId","enrollmentId") SELECT ${c.tenantId},${job.id},cohort.id FROM (${reportCohort(c, cohortFilters, data.language, at)}) cohort`,
    );
    await tx.$executeRaw(
      Prisma.sql`${ctes}, rows AS (${reportRows(data.kind, tenant.timezone, data.metric)}) INSERT INTO "LmsReportRow" (id,"tenantId","jobId",ordinal,"enrollmentId",payload) SELECT gen_random_uuid()::text,${c.tenantId},${job.id},row_number() OVER(ORDER BY "sourceId")::int,"enrollmentId",payload FROM rows`,
    );
    if (
      [
        "EMPLOYEE_DIRECTORY",
        "ORGANIZATION_DIRECTORY",
        "DOCUMENT_REGISTRY",
      ].includes(data.kind)
    ) {
      await tx.$executeRaw(
        Prisma.sql`${ctes}, rows AS (${reportRows(data.kind, tenant.timezone)}) INSERT INTO "LmsReportEntityScope" ("tenantId","jobId","entityKind","entityId") SELECT ${c.tenantId},${job.id},${data.kind === "EMPLOYEE_DIRECTORY" ? "RECIPIENT" : data.kind === "ORGANIZATION_DIRECTORY" ? "ORGANIZATION" : "DOCUMENT"},"sourceId" FROM rows`,
      );
      const [access] = await tx.$queryRaw<Array<{ denied: boolean }>>(
        Prisma.sql`SELECT EXISTS(SELECT 1 FROM "LmsReportEntityScope" s WHERE s."tenantId"=${c.tenantId} AND s."jobId"=${job.id} AND NOT (${reportEntityAllowedSql(c)})) AS denied`,
      );
      if (access.denied)
        fail(
          403,
          "REPORT_ACCESS_REVOKED",
          "Нет права скачивания по всем строкам отчёта",
        );
    }
    await audit(tx, c, "LMS_REPORT_REQUESTED", job.id, {
      kind: data.kind,
      format: data.format,
      totalRows: job.totalRows,
      snapshotAt: at,
      filters,
      policyVersion: 1,
    });
    return job;
  });
  return reportStatus(c, created.id);
}

export async function reportRecord(c: Context, id: string) {
  const job = await db.lmsReportJob.findFirst({
    where: { id, tenantId: c.tenantId, requestedBy: c.userId },
  });
  if (!job) fail(404, "NOT_FOUND", "Отчёт не найден");
  await assertReportAuthority(job, c);
  return job;
}
export async function reportStatus(
  c: Context,
  id: string,
  page = 1,
  pageSize = 30,
) {
  const job = await reportRecord(c, id);
  const expired = job.expiresAt <= new Date();
  const kind = job.reportKind as ReportKind,
    language = job.language as ReportLanguage;
  const safePage = Math.max(1, Math.min(100000, Math.floor(page) || 1));
  const safeSize = Math.max(1, Math.min(100, Math.floor(pageSize) || 30));
  const rows = expired
    ? []
    : await db.lmsReportRow.findMany({
        where: { tenantId: c.tenantId, jobId: job.id },
        orderBy: { ordinal: "asc" },
        skip: (safePage - 1) * safeSize,
        take: safeSize,
        select: { ordinal: true, enrollmentId: true, payload: true },
      });
  return {
    id: job.id,
    status: expired ? "EXPIRED" : job.status,
    kind,
    format: job.format,
    language,
    snapshotAt: job.snapshotAt,
    expiresAt: job.expiresAt,
    total: job.totalRows,
    totalRows: job.totalRows,
    progress: job.progress,
    errorCode: job.errorCode,
    createdAt: job.createdAt,
    filters: job.filters,
    timezone: reportPolicy(job).timezone,
    summary: reportPolicy(job).summary,
    metric: reportPolicy(job).metric,
    columns: reportColumns(kind, language),
    definition: reportDefinitions[kind][language === "kz" ? "rowKz" : "rowRu"],
    items: rows,
    page: safePage,
    pageSize: safeSize,
    fileName: `LMS-${kind.toLowerCase()}-${job.snapshotAt.toISOString().slice(0, 10)}.${job.format.toLowerCase()}`,
  };
}
export async function listReports(c: Context) {
  const items = await db.$queryRaw<
    Array<{
      id: string;
      kind: string;
      format: string;
      status: string;
      totalRows: number;
      snapshotAt: Date;
    }>
  >(Prisma.sql`
    SELECT j.id,j."reportKind" AS kind,j.format,CASE WHEN j."expiresAt"<=(clock_timestamp() AT TIME ZONE 'UTC') THEN 'EXPIRED' ELSE j.status END AS status,j."totalRows",j."snapshotAt"
    FROM "LmsReportJob" j JOIN "User" u ON u."tenantId"=j."tenantId" AND u.id=j."requestedBy" AND u.active AND u.role=j."requestedRole"
    WHERE j."tenantId"=${c.tenantId} AND j."requestedBy"=${c.userId}
      AND ${reportDownloadGrantSql(c)}
      AND NOT EXISTS(SELECT 1 FROM "LmsReportScope" s LEFT JOIN "Enrollment" e ON e."tenantId"=s."tenantId" AND e.id=s."enrollmentId" WHERE s."tenantId"=j."tenantId" AND s."jobId"=j.id
        AND (e.id IS NULL OR NOT((CASE WHEN COALESCE((j."scopePolicy"->>'learningMode')::boolean,false) THEN ${enrollmentScopeSql({ ...c, learningMode: true })} WHEN COALESCE((j."scopePolicy"->>'teachingMode')::boolean,false) THEN ${enrollmentScopeSql({ ...c, learningMode: false, teachingMode: true })} ELSE ${enrollmentScopeSql({ ...c, learningMode: false, teachingMode: false })} END) AND ${reportDownloadScopeSql(c)})))
      AND NOT EXISTS(SELECT 1 FROM "LmsReportEntityScope" s WHERE s."tenantId"=j."tenantId" AND s."jobId"=j.id AND NOT (${reportEntityAllowedSql(c)}))
    ORDER BY j."createdAt" DESC,j.id DESC LIMIT 30`);
  return { items };
}
export async function retryReport(c: Context, id: string) {
  const job = await reportRecord(c, id);
  if (job.expiresAt <= new Date())
    fail(409, "REPORT_EXPIRED", "Срок хранения истёк. Сформируйте новый отчёт");
  if (job.status !== "FAILED")
    fail(
      409,
      "REPORT_STATE_CONFLICT",
      "Состояние отчёта изменилось. Обновите список",
    );
  const changed = await db.lmsReportJob.updateMany({
    where: { id, status: "FAILED" },
    data: {
      status: "PENDING",
      attempts: 0,
      errorCode: null,
      runAfter: new Date(),
      leaseOwner: null,
      leaseUntil: null,
    },
  });
  if (!changed.count)
    fail(
      409,
      "REPORT_STATE_CONFLICT",
      "Состояние отчёта изменилось. Обновите список",
    );
  await audit(db, c, "LMS_REPORT_RETRIED", id);
  return reportStatus(c, id);
}
export async function cancelReport(c: Context, id: string) {
  const job = await reportRecord(c, id);
  if (job.status === "CANCELLED") return reportStatus(c, id);
  const changed = await db.lmsReportJob.updateMany({
    where: { id, status: { in: ["PENDING", "RUNNING", "FAILED"] } },
    data: {
      status: "CANCELLED",
      leaseUntil: null,
      leaseOwner: null,
      fencingToken: { increment: 1 },
    },
  });
  if (!changed.count)
    fail(409, "REPORT_STATE_CONFLICT", "Готовый отчёт уже нельзя отменить");
  await audit(db, c, "LMS_REPORT_CANCELLED", id);
  return reportStatus(c, id);
}
export async function reportFile(c: Context, id: string) {
  const job = await reportRecord(c, id);
  if (job.expiresAt <= new Date())
    fail(410, "REPORT_EXPIRED", "Срок хранения истёк. Сформируйте новый отчёт");
  if (
    job.status !== "READY" ||
    !job.storageKey ||
    !job.sha256 ||
    job.size === null
  )
    fail(409, "REPORT_NOT_READY", "Дождитесь готовности отчёта");
  const opened = await openPrivateStream({
    storageKey: job.storageKey,
    sha256: job.sha256,
    size: job.size,
  });
  try {
    await audit(db, c, "LMS_REPORT_DOWNLOADED", id, {
      format: job.format,
      sha256: job.sha256,
    });
  } catch (error) {
    if (!opened.invalid) opened.stream.destroy();
    throw error;
  }
  return {
    opened,
    mimeType: reportMime[job.format],
    fileName: `LMS-${job.reportKind.toLowerCase()}-${job.snapshotAt.toISOString().slice(0, 10)}.${job.format.toLowerCase()}`,
  };
}
export async function expireReportFiles() {
  const jobs = await db.lmsReportJob.findMany({
    where: { expiresAt: { lt: new Date() }, status: { not: "EXPIRED" } },
    take: 10,
    orderBy: { expiresAt: "asc" },
  });
  for (const job of jobs) {
    await db.lmsReportJob.update({
      where: { id: job.id },
      data: {
        status: "EXPIRED",
        fencingToken: { increment: 1 },
        leaseOwner: null,
        leaseUntil: null,
      },
    });
    if (job.storageKey)
      await unlink(new ArtifactStore().path(job.storageKey)).catch(() => {});
    await db.lmsReportRow.deleteMany({
      where: { tenantId: job.tenantId, jobId: job.id },
    });
    await db.lmsReportJob.update({
      where: { id: job.id },
      data: { storageKey: null, sha256: null, size: null },
    });
  }
  return jobs.length;
}

export const newReportOwner = () => `report:${randomUUID()}`;
