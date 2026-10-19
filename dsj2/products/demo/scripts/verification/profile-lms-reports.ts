import { readFile, writeFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import { Prisma } from "../../packages/database/src";
import { db, type Context } from "../../apps/api/src/core";
import {
  queryReport,
  normalizedReportFilters,
  reportCtes,
  reportRows,
  summarySql,
} from "../../apps/api/src/lms/report-query";

async function main() {
  if (
    new URL(process.env.DATABASE_URL!).pathname !==
    "/demo_test_lms_pass02_reports"
  )
    throw new Error("REPORT_TEST_DATABASE_REQUIRED");
  const directory = ".runtime/lms-pass02-operations-20261018/reports-evidence";
  const workload = JSON.parse(
    await readFile(`${directory}/load-5000.json`, "utf8"),
  );
  const user = await db.user.findFirstOrThrow({
    where: { tenantId: workload.tenantId, role: "DIRECTOR" },
  });
  const c: Context = {
    tenantId: user.tenantId,
    userId: user.id,
    role: user.role,
    sessionId: "report-query-profile",
    csrfHash: "",
    correlationId: "report-query-profile",
  };
  const filters = { customerId: workload.organizationId };
  const timezone = (
    await db.tenant.findUniqueOrThrow({ where: { id: c.tenantId } })
  ).timezone;
  const sql = Prisma.sql`${reportCtes(c, normalizedReportFilters(filters), "ru", new Date(), timezone)},rows AS MATERIALIZED (${reportRows("TRAINING", timezone)}),totals AS (${summarySql}) SELECT (SELECT count(*) FROM rows) AS total,COALESCE((SELECT jsonb_agg(page ORDER BY page."sourceId") FROM (SELECT * FROM rows ORDER BY "sourceId" LIMIT 30) page),'[]'::jsonb) AS items,totals.summary FROM totals`;
  const before = await db.$queryRaw(
    Prisma.sql`EXPLAIN (ANALYZE,BUFFERS,FORMAT JSON) ${sql}`,
  );
  // Statistics are part of synthetic workload preparation, not a product data edit.
  await db.$executeRawUnsafe(
    'ANALYZE "Enrollment", "Recipient", "CourseVersion", "VerifiedExamResult", "ExamAttempt", "LmsDocumentLink", "CustomerOrganization"',
  );
  const warmup = [];
  for (let i = 0; i < 3; i++) {
    const start = performance.now();
    await queryReport(c, { filters });
    warmup.push(performance.now() - start);
  }
  const samples = [];
  for (let i = 0; i < 10; i++) {
    const start = performance.now();
    const result = await queryReport(c, { filters, page: i + 1 });
    if (result.total !== 5000 || result.items.length !== 30)
      throw new Error("WORKLOAD_MISMATCH");
    samples.push(performance.now() - start);
  }
  const after = await db.$queryRaw(
    Prisma.sql`EXPLAIN (ANALYZE,BUFFERS,FORMAT JSON) ${sql}`,
  );
  const sorted = [...samples].sort((a, b) => a - b);
  const percent = (p: number) =>
    sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * p) - 1)];
  await writeFile(
    `${directory}/query-profile-5000.json`,
    JSON.stringify(
      {
        at: new Date(),
        workload: 5000,
        originalColdSamplesMs: workload.listQueryTimingsMs,
        method:
          "Same 5000-row tenant; actual report SQL, statistics refresh, 3 warmups and 10 serial samples; not mixed/concurrent capacity",
        warmupMs: warmup,
        samplesMs: samples,
        p50Ms: percent(0.5),
        p95Ms: percent(0.95),
        p99Ms: percent(0.99),
        budgetP95Ms: 1000,
        budgetPass: percent(0.95) < 1000,
        beforePlan: before,
        afterPlan: after,
        queriesPerReport: 2,
        noNewIndexAdded:
          "Existing tenant+enrollment/result indexes cover predicates; full actual plans retained",
      },
      null,
      2,
    ),
  );
}
main().finally(() => db.$disconnect());
