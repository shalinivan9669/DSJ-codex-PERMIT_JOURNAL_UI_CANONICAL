// Dynamically loads immutable P01 or current P02 modules with the same harness.
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { cpus, totalmem, platform, release } from "node:os";
import { resolve, join } from "node:path";

const product = resolve(__dirname, "../..");
const root = resolve(process.env.PERF_SOURCE || product);
const mode = process.argv[2] || "run";
const label = process.env.PERF_LABEL || "after";
const out = resolve(
  product,
  ".runtime/lms-pass02-operations-20261018/performance",
);
const url = new URL(process.env.DATABASE_URL || "postgresql://invalid");
assert.equal(url.hostname, "127.0.0.1");
assert.equal(url.port, "55479");
assert.match(
  url.pathname,
  /^\/demo_test_lms_pass02_performance_(before|before_final|before_measured|before_utc|before_serial|after|after_measured|after_utc|after_serial|expanded)$/,
);
const requireSource = createRequire(join(root, "package.json"));
const load = (path: string): any => requireSource(join(root, path));
const { db, hash } = load("apps/api/src/core.ts");
const { Prisma } = load("packages/database/src/index.ts");
const courses = load("apps/api/src/lms/courses.ts");
const { listEnrollmentPage } = load("apps/api/src/lms/enrollment-list.ts");
const query = load("apps/api/src/lms/enrollment-query.ts");
const { runAssignmentChunk } = load(
  "apps/api/src/lms/assignment-operations.ts",
);
const { listLearningNotifications } = load("apps/api/src/lms/notifications.ts");
const { exportResults } = load("apps/api/src/lms/results-export.ts");
const materials = load("apps/api/src/lms/materials.ts");
const queue = load("apps/render-worker/src/queue.ts");
const { ArtifactStore } = load("packages/printing/src/index.ts");
const store = new ArtifactStore();

// Prisma event logging is enabled before the engine's first connection; no query
// text/parameters are persisted. Both code versions receive identical instrumentation.
db._engineConfig.logQueries = true;
if (db._engine?.config) db._engine.config.logQueries = true;
let queries = 0;
db.$on("query", () => {
  queries++;
});

const fixtureFile = join(out, "fixture.json");
const pause = (ms: number) => new Promise((done) => setTimeout(done, ms));
class ExportSink {
  destroyed = false;
  bytes = 0;
  lines = 0;
  write(chunk: Buffer | string) {
    this.bytes += chunk.length;
    this.lines += String(chunk).split("\n").length - 1;
    // The known seed has exactly 5000 rows. Stop a repeating old-source cursor
    // safely instead of manufacturing latency by exporting duplicate pages forever.
    if (this.lines > 5001) this.destroyed = true;
    return true;
  }
  type() {
    return this;
  }
  setHeader() {
    return this;
  }
  send(value: Buffer) {
    this.write(value);
    this.end();
    return this;
  }
  end() {
    this.destroyed = true;
  }
}

async function seed() {
  assert.equal(
    label,
    "before",
    "Seed only once on old source and snapshot the resulting database",
  );
  assert.equal(
    await db.tenant.count({ where: { name: "SYNTHETIC PERFORMANCE P02" } }),
    0,
  );
  const { lmsTenant, lmsCourse } = load("tests/integration/lms-fixture.ts");
  const center = await lmsTenant("performance-pass02"),
    foreign = await lmsTenant("performance-pass02-other");
  await db.tenant.update({
    where: { id: center.tenant.id },
    data: { name: "SYNTHETIC PERFORMANCE P02" },
  });
  const context = center.context;
  const organizations = await Promise.all(
    [0, 1].map((i) =>
      db.customerOrganization.create({
        data: {
          tenantId: context.tenantId,
          nameRu: `Синтетическая организация ${i}`,
          nameKz: `Синтетикалық ұйым ${i}`,
          bin: `00000000000${i}`,
        },
      }),
    ),
  );
  const definition = lmsCourse({ questions: 1, required: true });
  const created = await courses.createCourse(context, definition);
  // Data setup only: publication and legal gates are tested in dedicated workflow tests.
  await db.courseVersion.update({
    where: { id: created.version.id },
    data: { status: "PUBLISHED" },
  });
  const assignmentCourse = await courses.createCourse(context, definition);
  await db.courseVersion.update({
    where: { id: assignmentCourse.version.id },
    data: { status: "PUBLISHED" },
  });
  const drafts = [];
  for (let i = 0; i < 50; i++)
    drafts.push((await courses.createCourse(context, definition)).version.id);
  const group = await db.lmsGroup.create({
    data: {
      tenantId: context.tenantId,
      name: "Синтетическая нагрузочная группа",
      courseVersionId: created.version.id,
      customerId: organizations[0].id,
      createdBy: context.userId,
    },
  });
  const recipients = Array.from({ length: 15000 }, (_, i) => ({
    id: randomUUID(),
    tenantId: context.tenantId,
    data: {
      fullNameRu: `Нагрузочный слушатель ${String(i).padStart(5, "0")}`,
      fullNameKz: `Жүктеме тыңдаушысы Ә Қ Ұ ${String(i).padStart(5, "0")}`,
      positionRu: "Работник",
      positionKz: "Қызметкер",
    },
  }));
  for (let i = 0; i < recipients.length; i += 500)
    await db.recipient.createMany({ data: recipients.slice(i, i + 500) });
  const enrollments = recipients.slice(0, 5000).map((r: any, i: number) => ({
    id: randomUUID(),
    tenantId: context.tenantId,
    recipientId: r.id,
    courseVersionId: created.version.id,
    customerId: organizations[i % 2].id,
    groupId: i % 2 ? null : group.id,
    groupKey: "",
    assignedBy: context.userId,
    assignedAt: new Date("2026-10-18T00:00:00Z"),
    dueAt: i % 3 ? new Date("2027-10-18T00:00:00Z") : null,
    status: i % 5 === 0 ? "COMPLETED" : "ACTIVE",
  }));
  for (let i = 0; i < enrollments.length; i += 500)
    await db.enrollment.createMany({ data: enrollments.slice(i, i + 500) });
  await db.lmsGroupMember.createMany({
    data: enrollments
      .filter((e: any) => e.groupId)
      .map((e: any) => ({
        tenantId: context.tenantId,
        groupId: group.id,
        enrollmentId: e.id,
      })),
  });
  const event = await db.lmsTeachingEvent.create({
    data: {
      tenantId: context.tenantId,
      groupId: group.id,
      courseVersionId: created.version.id,
      titleRu: "Нагрузочное занятие",
      titleKz: "Жүктеме сабағы",
      startsAt: new Date("2027-10-18T00:00:00Z"),
      endsAt: new Date("2027-10-18T01:00:00Z"),
      timezone: "Asia/Qyzylorda",
      teacherUserId: context.userId,
      operationId: randomUUID(),
      createdBy: context.userId,
    },
  });
  await db.lmsLearningNotification.createMany({
    data: Array.from({ length: 1000 }, (_, i) => ({
      tenantId: context.tenantId,
      userId: context.userId,
      eventId: event.id,
      eventRevision: i,
      kind: "SESSION_SCHEDULED",
      readAt: i % 2 ? new Date("2026-10-18T00:00:00Z") : null,
    })),
  });
  const blob = await store.put(Buffer.alloc(16 * 1024 * 1024, 81), "pdf");
  const material = await db.lmsMaterial.create({
    data: {
      tenantId: context.tenantId,
      courseId: created.course.id,
      ...blob,
      originalName: "synthetic-performance.pdf",
      mimeType: "application/pdf",
      createdBy: context.userId,
    },
  });
  const assignmentInput = {
    operationId: randomUUID(),
    courseVersionId: assignmentCourse.version.id,
    recipientIds: recipients.slice(0, 251).map((r: any) => r.id),
  };
  const bulk = [];
  for (let i = 0; i < 3; i++)
    bulk.push(await runAssignmentChunk(context, assignmentInput));
  assert.equal(bulk[2].created, 251);
  const output = {
    schema: 1,
    source: "P01 pre-optimization snapshot",
    context,
    foreign: foreign.context,
    organizations: organizations.map((o: any) => o.id),
    courseVersionId: created.version.id,
    assignmentVersionId: assignmentCourse.version.id,
    drafts,
    definition,
    groupId: group.id,
    materialId: material.id,
    counts: {
      tenant: 2,
      organizations: 2,
      listedEnrollments: 5000,
      seededEnrollments: 5251,
      recipients: 15000,
      inbox: 1000,
    },
    recipients: recipients.map((r: any) => r.id),
    bulk: bulk.map((r: any) => ({
      state: r.state,
      cursor: r.cursor,
      created: r.created,
    })),
  };
  await writeFile(fixtureFile, JSON.stringify(output, null, 2));
  console.log(JSON.stringify({ seeded: output.counts, bulk: output.bulk }));
}

const percentile = (values: number[], p: number) =>
  values.length
    ? [...values].sort((a, b) => a - b)[
        Math.max(0, Math.ceil(values.length * p) - 1)
      ]
    : null;
async function run() {
  const databaseTimezone = (await db.$queryRawUnsafe("SHOW timezone"))[0].TimeZone;
  assert.equal(databaseTimezone, "UTC", "RESTORE_DATABASE_CONFIGURATION_REQUIRED");
  const fixtureBytes = await readFile(fixtureFile);
  const f = JSON.parse(fixtureBytes.toString("utf8"));
  const plan = JSON.parse(
    await readFile(
      join(
        product,
        "docs/evidence/lms-full-tz-pass-02-operations-20261018/PERFORMANCE_PLAN.json",
      ),
      "utf8",
    ),
  );
  const base = { courseVersionId: f.courseVersionId, pageSize: 30 };
  const revision = await Promise.all(
    f.drafts.map(
      async (id: string) =>
        (
          await db.courseVersion.findUniqueOrThrow({
            where: { id },
            select: { revision: true },
          })
        ).revision,
    ),
  );
  const rows = await listEnrollmentPage(f.context, base);
  assert.equal(rows.total, 5000);
  const queryCountStart = queries;
  await db.$queryRaw`SELECT 1`;
  assert.ok(queries > queryCountStart, "QUERY_EVENTS_REQUIRED");
  const q = query.parseEnrollmentQuery({
    ...base,
    customerId: f.organizations[0],
  });
  const plans = await db.$queryRaw(
    Prisma.sql`EXPLAIN (ANALYZE,BUFFERS,FORMAT JSON) SELECT e.id,e."assignedAt" ${query.enrollmentJoins} WHERE ${query.enrollmentPredicate(f.context, q)} ORDER BY e."assignedAt" DESC,e.id DESC LIMIT 30`,
  );
  const sizeGrowth = [];
  for (const pageSize of [10, 30, 100]) {
    const start = queries;
    const began = performance.now();
    await listEnrollmentPage(f.context, { ...base, pageSize });
    sizeGrowth.push({
      pageSize,
      queries: queries - start,
      ms: performance.now() - began,
    });
  }
  const assignmentGrowth = [];
  for (const rowCount of [1, 10, 100]) {
    const began = performance.now(), queryStart = queries;
    const result = await runAssignmentChunk(f.context, { operationId: randomUUID(), courseVersionId: f.assignmentVersionId, recipientIds: f.recipients.slice(0, rowCount) });
    assert.equal(result.created, 0);
    assert.equal(result.duplicates, rowCount);
    assignmentGrowth.push({ rowCount, queries: queries - queryStart, ms: performance.now() - began });
  }
  const initialAssignmentCursor =
    5000 +
    (await db.enrollment.count({
      where: {
        tenantId: f.context.tenantId,
        courseVersionId: f.assignmentVersionId,
      },
    })) -
    251;
  let assignmentCursor = initialAssignmentCursor;
  const queueProfile = await db.issuerProfileVersion.upsert({
    where: { tenantId_version: { tenantId: f.context.tenantId, version: 1 } },
    update: {},
    create: {
      tenantId: f.context.tenantId,
      version: 1,
      profile: { synthetic: true },
      createdBy: f.context.userId,
    },
  });
  const queueRequest = await db.printRequest.create({
    data: {
      tenantId: f.context.tenantId,
      kind: "COMPANY",
      title: "SYNTHETIC PERFORMANCE QUEUE",
      demoMode: true,
      draft: {},
      createdBy: f.context.userId,
    },
  });
  let workerBusy = false;
  const pending: Promise<unknown>[] = [];
  let workerError: string | null = null;
  async function worker() {
    if (workerBusy) return;
    workerBusy = true;
    try {
      const job = await queue.claimJob(
        db,
        `performance-${label}`,
        f.context.tenantId,
      );
      if (job) {
        try {
          await queue.executeJob(
            db,
            store,
            job,
            `performance-${label}`,
            new AbortController().signal,
          );
        } catch (error: any) {
          await queue.settleFailure(db, job, `performance-${label}`, error);
          workerError = String(error.message || "WORKER_ERROR").slice(0, 100);
        }
      }
    } finally {
      workerBusy = false;
    }
  }
  const operations: Record<string, (vu: number) => Promise<unknown>> = {
    list: async () => listEnrollmentPage(f.context, base),
    filter: async () =>
      listEnrollmentPage(f.context, {
        ...base,
        customerId: f.organizations[0],
        search: "слушатель 0",
        status: "ACTIVE",
      }),
    count: async () =>
      db.$queryRaw(
        Prisma.sql`SELECT count(*) AS total ${query.enrollmentJoins} WHERE ${query.enrollmentPredicate(f.context, q)}`,
      ),
    autosave: async (vu) => {
      const saved = await courses.updateVersion(f.context, f.drafts[vu], {
        ...f.definition,
        revision: revision[vu],
      });
      revision[vu] = saved.revision;
    },
    assignment: async () => {
      const next = f.recipients[assignmentCursor++];
      assert.ok(next, "ASSIGNMENT_POOL_EXHAUSTED");
      const result = await runAssignmentChunk(f.context, {
        operationId: randomUUID(),
        courseVersionId: f.assignmentVersionId,
        recipientIds: [...f.recipients.slice(0, 99), next],
      });
      assert.equal(result.created, 1);
    },
    sessionInbox: async () =>
      listLearningNotifications(f.context, { page: 1, pageSize: 30 }),
    resultExport: async () => {
      const response = new ExportSink();
      await exportResults(
        f.context,
        {
          filters: { courseVersionId: f.courseVersionId },
          format: "CSV",
          language: "kz",
        },
        response,
      );
      assert.equal(response.lines, 5001);
    },
    documentQueue: async () => {
      const waiting = await db.generationJob.count({
        where: {
          tenantId: f.context.tenantId,
          status: { in: ["PENDING", "RUNNING", "RETRY"] },
        },
      });
      // Bounded producer backpressure is part of this workload, not a product change.
      if (waiting >= 2) {
        await worker();
        return;
      }
      const payload = {
        columns: [{ field: "id", title: "Идентификатор" }],
        items: Array.from({ length: 100 }, (_, i) => ({
          id: String(i).padStart(8, "0"),
        })),
      };
      const snapshot = await db.renderInputSnapshot.create({
        data: {
          tenantId: f.context.tenantId,
          requestId: queueRequest.id,
          revision: 0,
          profileVersionId: queueProfile.id,
          input: payload,
          inputHash: hash(payload),
        },
      });
      await db.generationJob.create({
        data: {
          tenantId: f.context.tenantId,
          requestId: snapshot.requestId,
          snapshotId: snapshot.id,
          kind: "XLSX",
          logicalKey: randomUUID(),
        },
      });
      await worker();
    },
    range: async () => {
      const material = await materials.authorizedMaterial(
        f.context,
        f.materialId,
      );
      const opened = await materials.openPrivateStream(
        material,
        "bytes=1048576-1114111",
      );
      assert.equal(opened.invalid, false);
      let bytes = 0;
      for await (const chunk of opened.stream) bytes += chunk.length;
      assert.equal(bytes, 65536);
    },
  };
  const extra =
    process.env.PERF_EXPANDED === "1"
      ? await requireSource(
          join(
            product,
            "scripts/verification/lms-pass02-performance-expanded.ts",
          ),
        ).expandedWorkload({ db, root, fixture: f })
      : null;
  if (extra) Object.assign(operations, extra.operations);
  const order = [
    "list",
    "filter",
    "count",
    "autosave",
    "list",
    "sessionInbox",
    "range",
    "assignment",
    "list",
    "resultExport",
    "documentQueue",
    "range",
    ...(extra
      ? ["summary", "inbox", "report", "importChunk", "notificationTick"]
      : []),
  ];
  const sourceFiles = [
    "apps/api/src/core.ts",
    "apps/api/src/lms/enrollment-list.ts",
    "apps/api/src/lms/enrollment-query.ts",
    "apps/api/src/lms/assignment-operations.ts",
    "apps/api/src/lms/notifications.ts",
    "apps/api/src/lms/materials.ts",
    "apps/api/src/lms/courses.ts",
    "apps/api/src/lms/results-export.ts",
    "apps/render-worker/src/queue.ts",
    "packages/database/prisma/schema.prisma",
    ...(extra
      ? [
          "apps/api/src/lms/report-query.ts",
          "apps/api/src/lms/reports.ts",
          "apps/api/src/lms/report-worker.ts",
          "apps/api/src/lms/employer-import.ts",
          "apps/api/src/lms/employer-import-worker.ts",
          "apps/api/src/lms/notification-worker.ts",
        ]
      : []),
  ];
  const sources = await Promise.all(
    sourceFiles.map(async (path) => ({
      path,
      sha256: createHash("sha256")
        .update(await readFile(join(root, path)))
        .digest("hex"),
    })),
  );
  const report: any = {
    at: new Date().toISOString(),
    label,
    sourceRoot: root,
    sourceFiles: sources,
    harnessSha256: createHash("sha256")
      .update(await readFile(join(product, "scripts/verification/lms-pass02-performance.ts")))
      .digest("hex"),
    fixtureSha256: createHash("sha256").update(fixtureBytes).digest("hex"),
    seedDumpSha256: createHash("sha256")
      .update(await readFile(join(out, "common-seed.dump")))
      .digest("hex"),
    database: url.pathname.slice(1),
    databaseTimezone,
    profile: {
      cpu: cpus()[0].model,
      logicalCpus: cpus().length,
      memoryBytes: totalmem(),
      platform: platform(),
      release: release(),
      node: process.version,
      prismaPool: 4,
      renderConcurrency: 1,
    },
    method: {
      level:
        "service functions + real PostgreSQL/private filesystem/renderer, no HTTP/network/auth overhead",
      warmupSeconds: plan.warmupSeconds,
      steadySeconds: plan.steadySeconds,
      operationCycle: order,
      assignment:
        "100 rows: 99 already assigned + one new person; separate 251-new-person bulk completed in three chunks during setup",
      documentQueue:
        "real 100-row XLSX GenerationJob; producer checks pending threshold 2 (concurrent admission can exceed it by at most client count); one worker. Not full legal issuance throughput",
      cpuRss:
        "same Node process executes service and load clients; excludes Postgres/Python and other user processes",
      stopThresholds: plan.stopThresholds,
      newOperationsBaseline: "NOT_AVAILABLE",
      ...(extra ? { expanded: extra.method } : {}),
    },
    counts: f.counts,
    queryPlan: plans,
    pageGrowth: sizeGrowth,
    assignmentGrowth,
    stages: [],
  };
  await writeFile(
    join(out, `${label}-plan.json`),
    JSON.stringify(report, null, 2),
  );
  const requestedLevels = process.env.PERF_LEVELS?.split(",").map(Number);
  if (requestedLevels)
    assert.ok(
      requestedLevels.every((level) => plan.concurrency.includes(level)),
    );
  const levels =
    process.env.PERF_SMOKE === "1" ? [1] : requestedLevels || plan.concurrency;
  for (const concurrency of levels) {
    const warmupSeconds =
      process.env.PERF_SMOKE === "1" ? 1 : plan.warmupSeconds;
    const steadySeconds =
      process.env.PERF_SMOKE === "1" ? 3 : plan.steadySeconds;
    const stageStart = performance.now();
    const warmEnd = stageStart + warmupSeconds * 1000;
    const end = warmEnd + steadySeconds * 1000;
    const samples: any[] = [],
      resources: any[] = [];
    let stopped: string | null = null;
    let peakRss = process.memoryUsage().rss;
    const cpu = process.cpuUsage();
    let steadyQueryStart: number | undefined;
    const timer = setInterval(() => {
      peakRss = Math.max(peakRss, process.memoryUsage().rss);
      if (peakRss > plan.stopThresholds.rssGiB * 1024 ** 3)
        stopped = "RSS_STOP_THRESHOLD";
      if (performance.now() >= warmEnd && steadyQueryStart === undefined)
        steadyQueryStart = queries;
      const task = (async () => {
        const active = await db.$queryRaw(
          Prisma.sql`SELECT count(*)::int AS length, COALESCE(EXTRACT(EPOCH FROM ((clock_timestamp() AT TIME ZONE 'UTC')-min("createdAt"))),0)::float AS age FROM "GenerationJob" WHERE "tenantId"=${f.context.tenantId} AND status IN ('PENDING','RUNNING','RETRY')`,
        );
        const entry = {
          elapsedMs: performance.now() - stageStart,
          phase: performance.now() < warmEnd ? "warmup" : "steady",
          rssBytes: process.memoryUsage().rss,
          cpuMicros: process.cpuUsage(cpu),
          queue: active[0],
        };
        resources.push(entry);
        if (Number(active[0].age) > plan.stopThresholds.queueAgeSeconds)
          stopped = "QUEUE_AGE_STOP_THRESHOLD";
      })().catch((error: any) => {
        resources.push({
          elapsedMs: performance.now() - stageStart,
          phase: performance.now() < warmEnd ? "warmup" : "steady",
          error: error.code || "MONITORING_QUERY_FAILED",
          rssBytes: process.memoryUsage().rss,
        });
      });
      pending.push(task);
    }, 1000);
    await Promise.all(
      Array.from({ length: concurrency }, async (_, vu) => {
        let iteration = vu;
        while (performance.now() < end && !stopped) {
          const operation = order[iteration++ % order.length];
          const began = performance.now();
          let error: string | null = null;
          try {
            await operations[operation](vu);
          } catch (failure: any) {
            error =
              failure.getResponse?.()?.code ||
              failure.code ||
              String(failure.message || "ERROR").slice(0, 100);
          }
          const phase = began < warmEnd ? "warmup" : "steady";
          samples.push({
            phase,
            operation,
            vu,
            ms: performance.now() - began,
            error,
          });
          const recent = samples.filter((row) => row.phase === "steady");
          if (recent.length >= 20) {
            if (
              recent.filter((row) => row.error).length / recent.length >
              plan.stopThresholds.errorRatio
            )
              stopped = "ERROR_RATIO_STOP_THRESHOLD";
            else if (
              Number(
                percentile(
                  recent.map((row) => row.ms),
                  0.95,
                ),
              ) > plan.stopThresholds.p95Ms
            )
              stopped = "P95_STOP_THRESHOLD";
          }
        }
      }),
    );
    clearInterval(timer);
    await Promise.all(pending.splice(0));
    const steady = samples.filter((row) => row.phase === "steady");
    const elapsedMs = performance.now() - stageStart;
    const duration = Math.max(0.001, (elapsedMs - warmupSeconds * 1000) / 1000);
    const operationResults = Object.fromEntries(
      Object.keys(operations).map((name) => {
        const selected = steady.filter((row) => row.operation === name),
          durations = selected.map((row) => row.ms);
        return [
          name,
          {
            count: selected.length,
            p50Ms: percentile(durations, 0.5),
            p95Ms: percentile(durations, 0.95),
            p99Ms: percentile(durations, 0.99),
            errors: selected.filter((row) => row.error).length,
            timeouts: selected.filter(
              (row) => row.error && /TIME|P2028|P2024/.test(row.error),
            ).length,
            throughputPerSecond: selected.length / duration,
            errorCodes: [
              ...new Set(
                selected.filter((row) => row.error).map((row) => row.error),
              ),
            ],
          },
        ];
      }),
    );
    const stage = {
      concurrency,
      warmupSeconds,
      requestedSteadySeconds: steadySeconds,
      measuredSteadySeconds: duration,
      elapsedMs,
      completedFullSteady:
        !stopped && elapsedMs >= (warmupSeconds + steadySeconds) * 1000,
      stopped,
      operations: operationResults,
      throughputPerSecond: steady.length / duration,
      p50Ms: percentile(
        steady.map((row) => row.ms),
        0.5,
      ),
      p95Ms: percentile(
        steady.map((row) => row.ms),
        0.95,
      ),
      p99Ms: percentile(
        steady.map((row) => row.ms),
        0.99,
      ),
      errors: steady.filter((row) => row.error).length,
      retries: await db.generationJob.count({
        where: { tenantId: f.context.tenantId, attempts: { gt: 1 } },
      }),
      queryCount: queries - (steadyQueryStart ?? queries),
      peakRssBytes: peakRss,
      cpuMicros: process.cpuUsage(cpu),
      workerError,
      resources,
      samples,
    };
    report.stages.push(stage);
    if (extra) report.expanded = await extra.metrics();
    await writeFile(
      join(out, `${label}.json`),
      JSON.stringify(report, null, 2),
    );
    console.log(
      JSON.stringify({
        label,
        concurrency,
        stopped,
        completedFullSteady: stage.completedFullSteady,
        p95Ms: stage.p95Ms,
        errors: stage.errors,
        throughput: stage.throughputPerSecond,
        peakRssBytes: peakRss,
      }),
    );
    if (stopped) break;
    while (
      await db.generationJob.count({
        where: {
          tenantId: f.context.tenantId,
          status: { in: ["PENDING", "RUNNING", "RETRY"] },
        },
      })
    ) {
      await worker();
      if (workerError) break;
      await pause(20);
    }
  }
  const finalQueue = await db.generationJob.groupBy({
    by: ["status"],
    where: { tenantId: f.context.tenantId },
    _count: true,
  });
  report.finalQueue = finalQueue;
  if (extra) {
    report.expandedBeforeDrain = await extra.metrics();
    report.expandedDrain = await extra.drain();
    report.expanded = await extra.metrics();
  }
  report.actualAddedAssignments = assignmentCursor - initialAssignmentCursor;
  await writeFile(join(out, `${label}.json`), JSON.stringify(report, null, 2));
}

async function main() {
  await mkdir(out, { recursive: true });
  try {
    if (mode === "seed") await seed();
    else await run();
  } finally {
    await db.$disconnect();
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
