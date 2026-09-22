import { PrismaClient } from "@demo/database";
import { ArtifactStore, RENDERER_VERSION, runRender } from "@demo/printing";
import productPolicy from "../../../packages/contracts/src/product-policy.json";
import { randomUUID } from "node:crypto";
import {
  claimJob,
  executeJob,
  expireExhausted,
  heartbeat,
  settleFailure,
} from "./queue";

if (
  productPolicy.productId !== "DEMO" ||
  productPolicy.version !== 1 ||
  productPolicy.demoProductId !== "demo-product"
)
  throw new Error("INVALID_PRODUCT_POLICY");
let db: PrismaClient;
const store = new ArtifactStore();
const owner = randomUUID();
const concurrency = Number(process.env.DEMO_RENDER_CONCURRENCY || 2);
if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 4)
  throw new Error("INVALID_RENDER_CONCURRENCY");
let closing = false;
const controllers = new Set<AbortController>();
const stop = () => {
  closing = true;
  for (const c of controllers) c.abort();
};
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
async function loop() {
  while (!closing) {
    try {
      const job = await claimJob(db, owner);
      if (!job) {
        await delay(750);
        continue;
      }
      const controller = new AbortController();
      controllers.add(controller);
      let checking = false;
      const timer = setInterval(() => {
        if (checking) return;
        checking = true;
        heartbeat(db, job, owner)
          .then((ok) => {
            if (!ok) controller.abort();
          })
          .catch(() => controller.abort())
          .finally(() => {
            checking = false;
          });
      }, 5000);
      try {
        await executeJob(db, store, job, owner, controller.signal);
      } catch (error) {
        await settleFailure(db, job, owner, error);
        console.error(
          JSON.stringify({
            event: "render.failed",
            jobId: job.id,
            correlationId: job.correlationId,
          }),
        );
      } finally {
        clearInterval(timer);
        controllers.delete(controller);
      }
    } catch {
      console.error(JSON.stringify({ event: "worker.database_unavailable" }));
      await delay(2500);
    }
  }
}
async function main() {
  const runtime = await runRender("health", {}, { timeoutMs: 30000 });
  if (runtime.metadata.rendererVersion !== RENDERER_VERSION)
    throw new Error("RENDERER_VERSION_MISMATCH");
  db = new PrismaClient();
  await db.$connect();
  const pulse = async () => {
    await expireExhausted(db);
    await db.workerHeartbeat.upsert({
      where: { id: owner },
      create: { id: owner, seenAt: new Date(), version: RENDERER_VERSION },
      update: { seenAt: new Date(), version: RENDERER_VERSION },
    });
  };
  await pulse();
  const timer = setInterval(() => {
    void pulse().catch(() => {
      /* readiness will become stale */
    });
  }, 10_000);
  console.log(
    JSON.stringify({
      event: "worker.started",
      version: RENDERER_VERSION,
      concurrency,
    }),
  );
  try {
    await Promise.all(Array.from({ length: concurrency }, () => loop()));
  } finally {
    clearInterval(timer);
    await db.workerHeartbeat.deleteMany({ where: { id: owner } });
    await db.$disconnect();
  }
}
void main().catch(() => {
  stop();
  console.error(JSON.stringify({ event: "worker.startup_failed" }));
  process.exitCode = 1;
});
