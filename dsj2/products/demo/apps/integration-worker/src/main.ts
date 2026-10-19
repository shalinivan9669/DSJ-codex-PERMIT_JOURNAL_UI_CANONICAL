import "reflect-metadata";
import { db } from "../../api/src/core";
import { preparationTick } from "../../api/src/regulatory-results/preparation";
import { expireLmsAttempts } from "../../api/src/lms/exams";
import { advanceLmsDocuments } from "../../api/src/lms/document-bridge";
import { randomUUID } from "node:crypto";
import { INTEGRATION_WORKER_VERSION } from "../../api/src/integration-health";
import { runEmployerImportTick } from "../../api/src/lms/employer-import-worker";
import { reportTick } from "../../api/src/lms/report-worker";
import { notificationTick } from "../../api/src/lms/notification-worker";

const preparationLimit = Number(process.env.DEMO_INTEGRATION_BATCH || 20);
if (
  !Number.isInteger(preparationLimit) ||
  preparationLimit < 1 ||
  preparationLimit > 100
)
  throw new Error("INVALID_INTEGRATION_BATCH");

/** The shipping worker prepares local facts only. No provider is selected or contacted. */
export async function integrationTick() {
  const [maintenance, imported, report, notifications] = await Promise.all([
    maintenanceTick(),
    runEmployerImportTick(),
    reportTick(),
    notificationTick(),
  ]);
  return {
    ...maintenance,
    imported,
    report,
    notifications,
    connection: "NOT_CONNECTED",
  };
}
async function maintenanceTick() {
  await expireLmsAttempts();
  let prepared = 0;
  while (prepared < preparationLimit && (await preparationTick())) prepared++;
  const documents = await advanceLmsDocuments();
  return { prepared, documents };
}
async function main() {
  const owner = `integration:${randomUUID()}`;
  let stopping = false;
  let lastError: string | null = null;
  const laneErrors = new Set<string>();
  let pendingPulse: Promise<void> | undefined;
  const pulse = async (stoppedAt: Date | null = null) => {
    await db.workerHeartbeat.upsert({
      where: { id: owner },
      create: {
        id: owner,
        seenAt: new Date(),
        version: INTEGRATION_WORKER_VERSION,
        lastError,
        stoppedAt,
      },
      update: { seenAt: new Date(), lastError, stoppedAt },
    });
  };
  process.once("SIGTERM", () => {
    stopping = true;
  });
  process.once("SIGINT", () => {
    stopping = true;
  });
  await pulse();
  const timer = setInterval(() => {
    if (pendingPulse) return;
    pendingPulse = pulse()
      .catch(() => {})
      .finally(() => {
        pendingPulse = undefined;
      });
  }, 5_000);
  console.log(
    JSON.stringify({
      event: "integration.started",
      pid: process.pid,
      concurrency: 1,
      preparationLimit,
    }),
  );
  try {
    // A long report must not delay notifications, imports or document preparation.
    // Each lane has one in-flight tick; durable database leases coordinate other processes.
    const lanes = {
      maintenance: maintenanceTick,
      imports: runEmployerImportTick,
      reports: reportTick,
      notifications: notificationTick,
    };
    await Promise.all(
      Object.entries(lanes).map(async ([lane, tick]) => {
        while (!stopping) {
          try {
            await tick();
            laneErrors.delete(lane);
          } catch {
            laneErrors.add(lane);
            console.error(
              JSON.stringify({
                level: "error",
                code: "LMS_WORKER_TICK_FAILED",
                lane,
              }),
            );
          }
          lastError = laneErrors.size
            ? `LMS_WORKER_TICK_FAILED:${[...laneErrors].sort().join(",")}`
            : null;
          if (!stopping)
            await new Promise((resolve) => setTimeout(resolve, 1000));
        }
      }),
    );
  } finally {
    clearInterval(timer);
    await pendingPulse;
    await pulse(new Date()).catch(() => {});
    await db.$disconnect();
  }
}
if (require.main === module)
  void main().catch(() => {
    process.exitCode = 1;
  });
