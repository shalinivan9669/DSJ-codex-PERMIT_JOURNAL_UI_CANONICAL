import "reflect-metadata";
import { db } from "../../api/src/core";
import { preparationTick } from "../../api/src/regulatory-results/preparation";
import { expireLmsAttempts } from "../../api/src/lms/exams";
import { advanceLmsDocuments } from "../../api/src/lms/document-bridge";
import { randomUUID } from "node:crypto";
import { INTEGRATION_WORKER_VERSION } from "../../api/src/integration-health";

const preparationLimit = Number(process.env.DEMO_INTEGRATION_BATCH || 20);
if (
  !Number.isInteger(preparationLimit) ||
  preparationLimit < 1 ||
  preparationLimit > 100
)
  throw new Error("INVALID_INTEGRATION_BATCH");

/** The shipping worker prepares local facts only. No provider is selected or contacted. */
export async function integrationTick() {
  await expireLmsAttempts();
  let prepared = 0;
  while (prepared < preparationLimit && (await preparationTick())) prepared++;
  const documents = await advanceLmsDocuments();
  return { prepared, documents, connection: "NOT_CONNECTED" };
}
async function main() {
  const owner = `integration:${randomUUID()}`;
  let stopping = false;
  let lastError: string | null = null;
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
    while (!stopping) {
      try {
        await integrationTick();
        lastError = null;
      } catch (error) {
        lastError =
          error instanceof Error &&
          error.message === "SANITARY_PREPARATION_FAILED"
            ? "SANITARY_PREPARATION_FAILED"
            : "LMS_WORKER_TICK_FAILED";
        console.error(
          JSON.stringify({ level: "error", code: "LMS_WORKER_TICK_FAILED" }),
        );
      }
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
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
