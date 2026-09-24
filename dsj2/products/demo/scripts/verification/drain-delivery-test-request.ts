import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { db } from "../../apps/api/src/core";
import { ArtifactStore } from "../../packages/printing/src";
import {
  claimJob,
  executeJob,
  heartbeat,
  settleFailure,
  DeferredJob,
} from "../../apps/render-worker/src/queue";
import { assertTestDatabase } from "../../tests/integration/test-database";
async function main() {
  assertTestDatabase();
  const [tenantId, requestId] = process.argv.slice(2);
  assert.match(tenantId || "", /^[a-f0-9-]{36}$/);
  assert.match(requestId || "", /^[a-f0-9-]{36}$/);
  const tenant = await db.tenant.findUniqueOrThrow({ where: { id: tenantId } });
  assert.equal(tenant.demoOnly, true);
  assert.equal(tenant.name, "Синтетический центр финальной проверки услуг");
  const requests = await db.printRequest.findMany({
    where: { tenantId },
    select: { id: true },
  });
  assert.deepEqual(
    requests.map((request) => request.id),
    [requestId],
    "Dedicated one-request synthetic tenant required",
  );
  assert.ok(
    await db.generationJob.count({ where: { tenantId, requestId } }),
    "Wait for actual finalized jobs before draining",
  );
  const owner = "delivery-ui-" + randomUUID(),
    store = new ArtifactStore(),
    deadline = Date.now() + 300000;
  let handled = 0;
  while (Date.now() < deadline) {
    const pending = await db.generationJob.findMany({
      where: { tenantId, requestId, status: { not: "SUCCEEDED" } },
    });
    if (!pending.length) {
      console.log(
        JSON.stringify({
          status: "PASS",
          tenantId,
          requestId,
          handled,
          scope:
            "existing worker claim/fencing/render/publication, own synthetic tenant only",
        }),
      );
      return;
    }
    assert.ok(
      pending.every((job) => job.status !== "FAILED"),
      "Render job failed",
    );
    const job = await claimJob(db, owner, tenantId);
    if (!job) {
      await new Promise((resolve) => setTimeout(resolve, 500));
      continue;
    }
    assert.equal(job.requestId, requestId);
    const beat = setInterval(() => {
      void heartbeat(db, job, owner);
    }, 5000);
    try {
      await executeJob(db, store, job, owner, new AbortController().signal);
      handled++;
    } catch (error) {
      await settleFailure(db, job, owner, error);
      if (!(error instanceof DeferredJob)) throw error;
    } finally {
      clearInterval(beat);
    }
  }
  throw new Error("TEST_RENDER_TIMEOUT");
}
void main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
