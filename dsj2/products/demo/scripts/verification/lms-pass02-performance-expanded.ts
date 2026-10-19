import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { join } from "node:path";

export async function expandedWorkload({
  db,
  root,
  fixture: f,
}: {
  db: any;
  root: string;
  fixture: any;
}) {
  assert.match(
    new URL(process.env.DATABASE_URL!).pathname,
    /^\/demo_test_lms_pass02_performance_expanded$/,
  );
  const requireSource = createRequire(join(root, "package.json"));
  const load = (path: string) => requireSource(join(root, path));
  const { queryReport } = load("apps/api/src/lms/report-query.ts");
  const reports = load("apps/api/src/lms/reports.ts");
  const { reportTick } = load("apps/api/src/lms/report-worker.ts");
  const imports = load("apps/api/src/lms/employer-import.ts");
  const { runEmployerImportTick } = load(
    "apps/api/src/lms/employer-import-worker.ts",
  );
  const { notificationTick } = load("apps/api/src/lms/notification-worker.ts");
  const { enqueueEnrollmentNotification } = load(
    "apps/api/src/lms/notification-events.ts",
  );
  const { listLearningNotifications } = load(
    "apps/api/src/lms/notifications.ts",
  );
  const owner = await db.user.findUniqueOrThrow({
    where: { id: f.context.userId },
  });
  const actors: any[] = [],
    learners: any[] = [];
  for (let vu = 0; vu < 50; vu++) {
    const actor = await db.user.create({
      data: {
        tenantId: f.context.tenantId,
        email: `${randomUUID()}@example.test`,
        displayName: `Synthetic load director ${vu}`,
        role: "DIRECTOR",
        passwordHash: owner.passwordHash,
      },
    });
    actors.push({
      ...f.context,
      userId: actor.id,
      correlationId: randomUUID(),
    });
    const learner = await db.user.create({
      data: {
        tenantId: f.context.tenantId,
        email: `${randomUUID()}@example.test`,
        displayName: `Synthetic load learner ${vu}`,
        role: "LEARNER",
        passwordHash: owner.passwordHash,
      },
    });
    await db.learnerProfile.create({
      data: {
        tenantId: f.context.tenantId,
        userId: learner.id,
        recipientId: f.recipients[vu],
        consentVersion: "synthetic-performance",
        consentAt: new Date(),
      },
    });
    const enrollment = await db.enrollment.findFirstOrThrow({
      where: {
        tenantId: f.context.tenantId,
        recipientId: f.recipients[vu],
        courseVersionId: f.courseVersionId,
      },
    });
    await db.enrollment.update({
      where: { id: enrollment.id },
      data: { learnerUserId: learner.id },
    });
    await enqueueEnrollmentNotification(db, enrollment, "ASSIGNED");
    learners.push({
      ...f.context,
      userId: learner.id,
      role: "LEARNER",
      correlationId: randomUUID(),
    });
  }
  const reportJobs: (string | undefined)[] = [],
    importJobs: (string | undefined)[] = [];
  let reportBusy = false,
    importBusy = false,
    notificationBusy = false;
  const workerCalls = { reports: 0, importChunks: 0, notificationTicks: 0 };
  const operations: Record<string, (vu: number) => Promise<unknown>> = {
    summary: async (vu) => {
      const result = await queryReport(actors[vu], {
        kind: "TRAINING",
        filters: { courseVersionId: f.courseVersionId },
        language: "kz",
        page: 1,
        pageSize: 30,
      });
      assert.equal(result.total, 5000);
    },
    inbox: async (vu) =>
      listLearningNotifications(learners[vu], { page: 1, pageSize: 30 }),
    report: async (vu) => {
      let job = reportJobs[vu]
        ? await reports.reportRecord(actors[vu], reportJobs[vu])
        : null;
      if (job?.status === "FAILED") throw new Error("REPORT_JOB_FAILED");
      if (!job || ["READY", "CANCELLED", "EXPIRED"].includes(job.status)) {
        const created = await reports.createReport(actors[vu], {
          kind: "TRAINING",
          filters: { courseVersionId: f.courseVersionId },
          language: "kz",
          format: "CSV",
          requestKey: randomUUID(),
        });
        reportJobs[vu] = created.id;
        job = created;
      }
      if (!reportBusy) {
        reportBusy = true;
        try {
          await reportTick(`performance-expanded-${vu}`);
          workerCalls.reports++;
        } finally {
          reportBusy = false;
        }
      }
      return job;
    },
    importChunk: async (vu) => {
      let job = importJobs[vu]
        ? await db.lmsEmployerImport.findUniqueOrThrow({
            where: { id: importJobs[vu] },
          })
        : null;
      if (job && ["FAILED", "PAUSED"].includes(job.state))
        throw new Error("IMPORT_JOB_FAILED");
      if (!job || ["COMPLETED", "CANCELLED"].includes(job.state)) {
        const id = randomUUID();
        const rows = Array.from({ length: 100 }, (_, index) => ({
          sourceRow: index + 1,
          fullNameRu: `Синтетический импорт ${id} ${index}`,
          positionRu: "Работник",
          resolution: "NEW",
        }));
        const draft = await imports.createEmployerImport(actors[vu], {
          id,
          customerId: f.organizations[0],
          courseVersionId: f.assignmentVersionId,
          rows,
        });
        await imports.confirmEmployerImport(actors[vu], id, {
          revision: draft.revision,
        });
        importJobs[vu] = id;
        job = draft;
      }
      if (!importBusy) {
        importBusy = true;
        try {
          await runEmployerImportTick();
          workerCalls.importChunks++;
        } finally {
          importBusy = false;
        }
      }
      return job;
    },
    notificationTick: async () => {
      if (notificationBusy) return;
      notificationBusy = true;
      try {
        const result = await notificationTick();
        workerCalls.notificationTicks++;
        return result;
      } finally {
        notificationBusy = false;
      }
    },
  };
  async function metrics() {
    const [reportStates, importStates, eventStates, inboxCount, reportRows] =
      await Promise.all([
        db.lmsReportJob.groupBy({
          by: ["status"],
          where: { tenantId: f.context.tenantId },
          _count: true,
        }),
        db.lmsEmployerImport.groupBy({
          by: ["state"],
          where: { tenantId: f.context.tenantId },
          _count: true,
        }),
        db.lmsNotificationEvent.groupBy({
          by: ["state"],
          where: { tenantId: f.context.tenantId },
          _count: true,
        }),
        db.lmsLearningNotification.count({
          where: {
            tenantId: f.context.tenantId,
            sourceType: { not: "SESSION" },
          },
        }),
        db.lmsReportRow.count({ where: { tenantId: f.context.tenantId } }),
      ]);
    return {
      workerCalls,
      reportStates,
      importStates,
      eventStates,
      inboxCount,
      reportRows,
    };
  }
  async function drain() {
    const began = performance.now();
    while (performance.now() - began < 120000) {
      const [reportsPending, importsPending, notificationsPending] =
        await Promise.all([
          db.lmsReportJob.count({
            where: {
              tenantId: f.context.tenantId,
              status: { in: ["PENDING", "RUNNING"] },
            },
          }),
          db.lmsEmployerImport.count({
            where: {
              tenantId: f.context.tenantId,
              state: { in: ["QUEUED", "PROCESSING", "ASSIGNING"] },
            },
          }),
          db.lmsNotificationEvent.count({
            where: {
              tenantId: f.context.tenantId,
              state: { in: ["PENDING", "RUNNING"] },
            },
          }),
        ]);
      if (!reportsPending && !importsPending && !notificationsPending)
        return { completed: true, ms: performance.now() - began };
      if (reportsPending) await reportTick("performance-expanded-drain");
      if (importsPending) await runEmployerImportTick();
      if (notificationsPending) await notificationTick();
    }
    return {
      completed: false,
      ms: performance.now() - began,
      reason: "BOUNDED_DRAIN_LIMIT",
    };
  }
  return {
    operations,
    metrics,
    drain,
    method: {
      baseline: "NOT_AVAILABLE",
      actors: 50,
      learnerAccounts: 50,
      report:
        "5000-row durable CSV; one real report worker; create/poll/repeat after READY",
      import:
        "100 new rows per import; one worker tick per operation, worker chunk50; next import only after COMPLETED",
      notifications:
        "50 real synthetic assignment outbox events plus current source scanner; bounded100 delivery/tick; dedicated learners' inbox",
    },
  };
}
