import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { PrismaClient } from "@demo/database";

async function main() {
  const mode = process.argv[2];
  const source = new URL(process.env.DATABASE_URL || "");
  assert.equal(source.pathname, "/demo_test_upgrade_rollback_source");
  assert.equal(source.hostname, "127.0.0.1");
  const upgraded = new PrismaClient({ datasourceUrl: source.toString() });
  const restoredUrl = new URL(source);
  restoredUrl.pathname = "/demo_test_restore_rollback_base";
  const restored = new PrismaClient({ datasourceUrl: restoredUrl.toString() });
  try {
    const upgrade = JSON.parse(await readFile(process.argv[3], "utf8"));
    const requestId = upgrade.continuationRequestId;
    const jobs = await upgraded.$queryRawUnsafe<Record<string, unknown>[]>(
      'SELECT id,status,attempts,"leaseOwner","leaseUntil","requestId" FROM "GenerationJob" WHERE "requestId"=$1 ORDER BY id',
      requestId,
    );
    assert.ok(jobs.length > 0);
    assert.ok(
      jobs.every(
        (job) =>
          job.status === "PENDING" &&
          job.attempts === 0 &&
          job.leaseOwner === null,
      ),
    );
    const sha256 = createHash("sha256")
      .update(JSON.stringify(jobs))
      .digest("hex");
    if (mode === "before") {
      await writeFile(
        process.argv[4],
        JSON.stringify({ requestId, jobs, sha256 }, null, 2),
      );
      return;
    }
    assert.equal(mode, "after");
    const before = JSON.parse(await readFile(process.argv[4], "utf8"));
    assert.equal(
      sha256,
      before.sha256,
      "Old application touched post-upgrade jobs",
    );
    assert.equal(
      (
        await restored.$queryRawUnsafe<{ count: bigint }[]>(
          'SELECT count(*) FROM "PrintRequest" WHERE id=$1',
          requestId,
        )
      )[0].count,
      0n,
    );
    assert.equal(
      (
        await restored.$queryRawUnsafe<{ count: bigint }[]>(
          'SELECT count(*) FROM "GenerationJob" WHERE "requestId"=$1',
          requestId,
        )
      )[0].count,
      0n,
    );
    assert.equal(
      (
        await restored.$queryRawUnsafe<{ count: bigint }[]>(
          'SELECT count(*) FROM "_prisma_migrations"',
        )
      )[0].count,
      5n,
    );
    assert.equal(
      (
        await restored.$queryRawUnsafe<{ found: string | null }[]>(
          `SELECT to_regclass('public."TrainingEvent"')::text AS found`,
        )
      )[0].found,
      null,
    );
    const worker = await restored.$queryRawUnsafe<
      { version: string; seenAt: Date }[]
    >(
      'SELECT version,"seenAt" FROM "WorkerHeartbeat" ORDER BY "seenAt" DESC LIMIT 1',
    );
    assert.equal(worker.length, 1, "Actual legacy worker heartbeat required");
    assert.ok(Date.now() - worker[0].seenAt.getTime() < 30000);
    const result = {
      status: "PASS",
      oldSourceCommit: "59a961a07b4f8103db9fbdbe0fe4dc09406816f1",
      rollbackDatabase: restoredUrl.pathname.slice(1),
      preservedUpgradedDatabase: source.pathname.slice(1),
      rollbackSchemaMigrations: 5,
      preservedSourceSchemaMigrations: 12,
      postUpgradeRequestId: requestId,
      excludedJobIds: jobs.map((job) => job.id),
      sourceJobSha256Before: before.sha256,
      sourceJobSha256After: sha256,
      actualOldWorker: worker[0],
      boundary:
        "Point-in-time rollback: post-upgrade writes are preserved in their original database and a separate post-upgrade backup, excluded from the restored old application. They require explicit reconciliation before further number issuance or merging; no claim of lossless reverse migration.",
    };
    await writeFile(process.argv[5], JSON.stringify(result, null, 2));
    console.log(JSON.stringify(result));
  } finally {
    await upgraded.$disconnect();
    await restored.$disconnect();
  }
}
void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
