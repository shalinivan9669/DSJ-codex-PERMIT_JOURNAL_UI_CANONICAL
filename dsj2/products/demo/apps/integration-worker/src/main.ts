import "reflect-metadata";
import { db } from "../../api/src/core";
import { preparationTick } from "../../api/src/regulatory-results/preparation";
import { expireLmsAttempts } from "../../api/src/lms/exams";
import { advanceLmsDocuments } from "../../api/src/lms/document-bridge";

/** The shipping worker prepares local facts only. No provider is selected or contacted. */
export async function integrationTick() {
  await expireLmsAttempts();
  let prepared = 0;
  while (prepared < 100 && (await preparationTick())) prepared++;
  const documents = await advanceLmsDocuments();
  return { prepared, documents, connection: "NOT_CONNECTED" };
}
async function main() {
  let stopping = false;
  process.once("SIGTERM", () => {
    stopping = true;
  });
  process.once("SIGINT", () => {
    stopping = true;
  });
  while (!stopping) {
    try {
      await integrationTick();
    } catch {
      console.error(
        JSON.stringify({ level: "error", code: "LMS_WORKER_TICK_FAILED" }),
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  await db.$disconnect();
}
if (require.main === module)
  void main().catch(() => {
    process.exitCode = 1;
  });
