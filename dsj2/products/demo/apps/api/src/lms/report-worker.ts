import { createHash } from "node:crypto";
import { mkdtemp, open, readFile, rm, stat, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ArtifactStore, runRender } from "@demo/printing";
import { Prisma, type LmsReportJob } from "@demo/database";
import { db } from "../core";
import {
  reportCell,
  reportColumns,
  reportDefinitions,
  type ReportKind,
  type ReportLanguage,
  type ReportPayload,
} from "./report-definitions";
import {
  assertReportAuthority,
  expireReportFiles,
  newReportOwner,
  reportPolicy,
} from "./reports";
import { safeCsvCell } from "./results-export";

const leaseMs = 60000,
  chunkSize = 200;
export async function claimReport(owner: string) {
  const rows = await db.$queryRaw<
    LmsReportJob[]
  >(Prisma.sql`UPDATE "LmsReportJob" j SET status='RUNNING',"leaseOwner"=${owner},"leaseUntil"=(clock_timestamp() AT TIME ZONE 'UTC')+interval '60 seconds',attempts=attempts+1,"fencingToken"="fencingToken"+1,"updatedAt"=(clock_timestamp() AT TIME ZONE 'UTC')
    WHERE j.id=(SELECT id FROM "LmsReportJob" WHERE "expiresAt">(clock_timestamp() AT TIME ZONE 'UTC') AND attempts<3 AND ((status='PENDING' AND "runAfter"<=(clock_timestamp() AT TIME ZONE 'UTC')) OR (status='RUNNING' AND "leaseUntil"<(clock_timestamp() AT TIME ZONE 'UTC'))) ORDER BY "createdAt",id FOR UPDATE SKIP LOCKED LIMIT 1) RETURNING j.*`);
  return rows[0] || null;
}
async function heartbeat(job: LmsReportJob, progress?: number) {
  const result = await db.lmsReportJob.updateMany({
    where: {
      id: job.id,
      status: "RUNNING",
      leaseOwner: job.leaseOwner,
      fencingToken: job.fencingToken,
    },
    data: {
      leaseUntil: new Date(Date.now() + leaseMs),
      ...(progress === undefined ? {} : { progress }),
    },
  });
  if (!result.count) throw new Error("REPORT_LEASE_LOST");
}
export async function executeReport(job: LmsReportJob) {
  const temp = await mkdtemp(join(tmpdir(), "demo-lms-report-"));
  const store = new ArtifactStore();
  const abort = new AbortController();
  let stored: string | undefined;
  let pulse: Promise<void> | undefined;
  const timer = setInterval(() => {
    if (!pulse)
      pulse = heartbeat(job)
        .catch(() => abort.abort())
        .finally(() => {
          pulse = undefined;
        });
  }, 10000);
  try {
    await assertReportAuthority(job);
    const kind = job.reportKind as ReportKind,
      language = job.language as ReportLanguage;
    const columns = reportColumns(kind, language);
    const spool = await open(join(temp, "rows.jsonl"), "wx", 0o600);
    const csv =
      job.format === "CSV"
        ? await open(join(temp, "report.csv"), "wx", 0o600)
        : null;
    let processed = 0;
    const snapshotDigest = createHash("sha256");
    try {
      if (csv)
        await csv.write(
          "\uFEFF" +
            columns.map((c) => safeCsvCell(c.title)).join(";") +
            "\r\n",
        );
      while (!abort.signal.aborted) {
        const rows = await db.lmsReportRow.findMany({
          where: {
            tenantId: job.tenantId,
            jobId: job.id,
            ordinal: { gt: processed },
          },
          orderBy: { ordinal: "asc" },
          take: chunkSize,
          select: { ordinal: true, payload: true },
        });
        if (!rows.length) break;
        await assertReportAuthority(job);
        for (const row of rows) {
          const raw = row.payload as ReportPayload;
          const payload = Object.fromEntries(
            columns.map((c) => [c.field, reportCell(raw, c.field, language)]),
          );
          const line = JSON.stringify(payload) + "\n";
          snapshotDigest.update(line);
          await spool.write(line);
          if (csv)
            await csv.write(
              columns.map((c) => safeCsvCell(payload[c.field])).join(";") +
                "\r\n",
            );
          processed = row.ordinal;
        }
        await heartbeat(
          job,
          Math.floor((80 * processed) / Math.max(1, job.totalRows)),
        );
      }
    } finally {
      await spool.close();
      await csv?.close();
    }
    if (abort.signal.aborted) throw new Error("REPORT_LEASE_LOST");
    if (processed !== job.totalRows)
      throw new Error("REPORT_SNAPSHOT_INCOMPLETE");
    const payload = {
      itemsFile: join(temp, "rows.jsonl"),
      columns,
      title: reportDefinitions[kind][language],
      definition:
        reportDefinitions[kind][language === "kz" ? "rowKz" : "rowRu"],
      snapshotAt: job.snapshotAt.toISOString(),
      timezone: reportPolicy(job).timezone,
      totalRows: job.totalRows,
      language,
      filters: job.filters,
      summary: reportPolicy(job).summary,
    };
    let bytes: Buffer;
    if (csv) {
      if ((await stat(join(temp, "report.csv"))).size > 100 * 1024 * 1024)
        throw new Error("REPORT_FILE_LIMIT");
      bytes = await readFile(join(temp, "report.csv"));
    } else
      bytes = (
        await runRender(job.format === "PDF" ? "lms-report" : "xlsx", payload, {
          signal: abort.signal,
          timeoutMs: 120000,
        })
      ).buffer;
    await assertReportAuthority(job);
    await heartbeat(job, 95);
    const artifact = await store.put(bytes, job.format.toLowerCase());
    stored = artifact.storageKey;
    // A grant may be revoked during storage; never publish that artifact as ready.
    await assertReportAuthority(job);
    const changed = await db.lmsReportJob.updateMany({
      where: {
        id: job.id,
        status: "RUNNING",
        leaseOwner: job.leaseOwner,
        fencingToken: job.fencingToken,
      },
      data: {
        ...artifact,
        status: "READY",
        progress: 100,
        errorCode: null,
        leaseOwner: null,
        leaseUntil: null,
      },
    });
    if (!changed.count) throw new Error("REPORT_LEASE_LOST");
    stored = undefined;
    await db.auditEvent.create({
      data: {
        tenantId: job.tenantId,
        actorId: job.requestedBy,
        action: "LMS_REPORT_READY",
        entityId: job.id,
        correlationId: job.id,
        metadata: {
          totalRows: processed,
          format: job.format,
          sha256: artifact.sha256,
          snapshotHash: snapshotDigest.digest("hex"),
          source: "local-report-worker",
        },
      },
    });
  } catch (error) {
    const response = (
      error as { getResponse?: () => { code?: string } }
    ).getResponse?.();
    const denied = response?.code === "REPORT_ACCESS_REVOKED";
    const code = denied
      ? "REPORT_ACCESS_REVOKED"
      : error instanceof Error && error.message === "REPORT_SNAPSHOT_INCOMPLETE"
        ? "REPORT_SNAPSHOT_INCOMPLETE"
        : "REPORT_PREPARATION_FAILED";
    await db.lmsReportJob.updateMany({
      where: {
        id: job.id,
        status: "RUNNING",
        leaseOwner: job.leaseOwner,
        fencingToken: job.fencingToken,
      },
      data: {
        status: !denied && job.attempts < 3 ? "PENDING" : "FAILED",
        runAfter: new Date(Date.now() + 1000 * job.attempts),
        errorCode: code,
        leaseOwner: null,
        leaseUntil: null,
      },
    });
  } finally {
    clearInterval(timer);
    await pulse;
    if (stored) await unlink(store.path(stored)).catch(() => {});
    await rm(temp, { recursive: true, force: true });
  }
}
export async function reportTick(owner = newReportOwner()) {
  const expired = await expireReportFiles();
  await db.lmsReportJob.updateMany({
    where: {
      status: "RUNNING",
      leaseUntil: { lt: new Date() },
      attempts: { gte: 3 },
    },
    data: {
      status: "FAILED",
      errorCode: "REPORT_PREPARATION_FAILED",
      leaseOwner: null,
      leaseUntil: null,
    },
  });
  const job = await claimReport(owner);
  if (job) await executeReport(job);
  return { processed: job ? 1 : 0, expired };
}
