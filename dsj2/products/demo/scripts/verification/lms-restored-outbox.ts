import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { db, hash } from "../../apps/api/src/core";
import { createCourse, publishVersion } from "../../apps/api/src/lms/courses";
import { assignEnrollments } from "../../apps/api/src/lms/enrollments";
import {
  startAttempt,
  saveAnswers,
  submitAttempt,
} from "../../apps/api/src/lms/exams";
import { preparationTick } from "../../apps/api/src/regulatory-results/preparation";
import {
  lmsTenant,
  lmsLearner,
  lmsCourse,
} from "../../tests/integration/lms-fixture";
import { assertTestDatabase } from "../../tests/integration/test-database";

const root = process.cwd();
const [mode, statePath, outputPath] = process.argv.slice(2);
async function phase() {
  assertTestDatabase();
  const url = new URL(process.env.DATABASE_URL!);
  assert.equal(url.hostname, "127.0.0.1");
  assert.equal(url.port, "55449");
  if (mode === "seed") {
    const center = await lmsTenant("restored valid pending outbox");
    const learner = await lmsLearner(center.tenant.id, "restore");
    const course = await createCourse(
      center.context,
      lmsCourse({ sanitary: true, required: false }),
    );
    await publishVersion(center.context, course.version.id, { revision: 0 });
    const enrollment = (
      await assignEnrollments(center.context, {
        courseVersionId: course.version.id,
        recipientIds: [learner.recipient.id],
      })
    ).items[0];
    const attempt = await startAttempt(learner.context, enrollment.id);
    await saveAnswers(learner.context, attempt.id, {
      sequence: 1,
      answers: Object.fromEntries(
        attempt.questions.map((question) => [question.id, ["a"]]),
      ),
    });
    const finished = await submitAttempt(learner.context, attempt.id);
    const result = await db.verifiedExamResult.findUniqueOrThrow({
      where: { id: finished.result!.id },
    });
    assert.equal(result.eligible, true);
    const outbox = await db.regulatoryOutbox.findFirstOrThrow({
      where: { resultId: result.id },
    });
    assert.equal(outbox.status, "PENDING");
    const material = await db.lmsMaterial.findFirstOrThrow();
    const privateHash = hash(
      await readFile(
        path.join(process.env.DEMO_ARTIFACT_ROOT!, material.storageKey),
      ),
    );
    await writeFile(
      statePath,
      JSON.stringify(
        {
          tenantId: center.tenant.id,
          resultId: result.id,
          resultHash: result.snapshotHash,
          outboxId: outbox.id,
          materialId: material.id,
          storageKey: material.storageKey,
          privateHash,
        },
        null,
        2,
      ),
    );
    return;
  }
  if (mode === "resume") {
    const seed = JSON.parse(await readFile(statePath, "utf8"));
    const result = await db.verifiedExamResult.findUniqueOrThrow({
      where: { id: seed.resultId },
    });
    assert.equal(result.snapshotHash, seed.resultHash);
    assert.equal(hash(result.snapshot), seed.resultHash);
    assert.equal(
      hash(
        await readFile(
          path.join(process.env.DEMO_ARTIFACT_ROOT!, seed.storageKey),
        ),
      ),
      seed.privateHash,
    );
    const before = await db.regulatoryOutbox.findUniqueOrThrow({
      where: { id: seed.outboxId },
    });
    assert.ok(["PENDING", "DONE"].includes(before.status));
    let processed = 0;
    for (let step = 0; step < 10; step++) {
      const pair = await Promise.all([preparationTick(), preparationTick()]);
      processed += pair.filter(Boolean).length;
      if (!pair.some(Boolean)) break;
    }
    assert.equal(
      (
        await db.regulatoryOutbox.findUniqueOrThrow({
          where: { id: seed.outboxId },
        })
      ).status,
      "DONE",
    );
    const counts = {
      results: await db.verifiedExamResult.count({
        where: { id: seed.resultId },
      }),
      batchItems: await db.regulatoryBatchItem.count({
        where: { resultId: seed.resultId },
      }),
      journalEntries: await db.sanitaryJournalEntry.count({
        where: { resultId: seed.resultId },
      }),
      deliveries: await db.integrationDelivery.count({
        where: { resultId: seed.resultId },
      }),
    };
    assert.deepEqual(counts, {
      results: 1,
      batchItems: 1,
      journalEntries: 1,
      deliveries: 1,
    });
    await writeFile(
      outputPath,
      JSON.stringify(
        {
          status: "PASS",
          initialOutboxStatus: before.status,
          processed,
          counts,
          restoredResultHash: result.snapshotHash,
          privateHash: seed.privateHash,
          processId: process.pid,
        },
        null,
        2,
      ),
    );
    return;
  }
  const prior = JSON.parse(
    await readFile(
      "docs/evidence/lms-one-run-20261015/agent-a/STORAGE_ACCEPTANCE.json",
      "utf8",
    ),
  );
  const old = prior.checks.find(
    (item: any) => item.id === "FRESH_INSTALL_BACKUP_RESTORE",
  );
  assert.match(old.sourceDatabase, /^demo_test_lms_backup_a_[a-z0-9]+$/);
  const originalRuntime = path.dirname(old.backupOutput.backup);
  const runtime = path.join(
    root,
    ".runtime/lms-one-run",
    `restored-outbox-${Date.now().toString(36)}`,
  );
  await mkdir(runtime, { recursive: true });
  const seedPath = path.join(runtime, "seed.json");
  const restoreDb = `demo_test_lms_outbox_restore_${Date.now().toString(36)}`;
  const restoreStore = path.join(runtime, "private-files");
  const backup = path.join(runtime, "backup");
  const baseEnv = {
    ...process.env,
    DEMO_MAINTENANCE: "1",
    DEMO_LMS_TEST_RUNTIME: "1",
    DEMO_PG_DUMP: path.join(originalRuntime, "pg_dump_wsl16.exe"),
    DEMO_PG_RESTORE: path.join(originalRuntime, "pg_restore_wsl16.exe"),
  };
  const commands: { command: string; exitCode: number }[] = [];
  const run = (executable: string, args: string[], env: NodeJS.ProcessEnv) => {
    const output = execFileSync(executable, args, {
      cwd: root,
      env,
      encoding: "utf8",
      windowsHide: true,
      timeout: 120_000,
      maxBuffer: 8 * 1024 * 1024,
    });
    commands.push({
      command: path.basename(executable) + " " + args.join(" "),
      exitCode: 0,
    });
    return output;
  };
  const sourceEnv = {
    ...baseEnv,
    DATABASE_URL: `postgresql://postgres@127.0.0.1:55449/${old.sourceDatabase}`,
    DEMO_ARTIFACT_ROOT: path.join(originalRuntime, "source-files"),
  };
  const restoredEnv = {
    ...baseEnv,
    DATABASE_URL: `postgresql://postgres@127.0.0.1:55449/${restoreDb}`,
    DEMO_ARTIFACT_ROOT: restoreStore,
  };
  const script = path.join(root, "scripts/verification/lms-restored-outbox.ts");
  const tsx = [
    "node_modules/tsx/dist/cli.mjs",
    "--tsconfig",
    "tsconfig.base.json",
    script,
  ];
  run(process.execPath, [...tsx, "seed", seedPath], sourceEnv);
  const backupOutput = run(
    process.execPath,
    ["deployment/backup.mjs", "backup", backup],
    sourceEnv,
  );
  run(
    process.env.DEMO_PSQL!,
    [
      "-X",
      "-v",
      "ON_ERROR_STOP=1",
      "-d",
      "postgresql://postgres@127.0.0.1:55449/postgres",
      "-c",
      `CREATE DATABASE "${restoreDb}"`,
    ],
    baseEnv,
  );
  const restoreOutput = run(
    process.execPath,
    ["deployment/backup.mjs", "restore", backup],
    restoredEnv,
  );
  const verifyOutput = run(
    process.execPath,
    ["deployment/backup.mjs", "verify", backup],
    restoredEnv,
  );
  const first = path.join(runtime, "first-worker.json"),
    second = path.join(runtime, "restarted-worker.json");
  run(process.execPath, [...tsx, "resume", seedPath, first], restoredEnv);
  run(process.execPath, [...tsx, "resume", seedPath, second], restoredEnv);
  const firstWorker = JSON.parse(await readFile(first, "utf8"));
  const restartedWorker = JSON.parse(await readFile(second, "utf8"));
  assert.equal(firstWorker.initialOutboxStatus, "PENDING");
  assert.equal(restartedWorker.initialOutboxStatus, "DONE");
  assert.equal(restartedWorker.processed, 0);
  assert.notEqual(firstWorker.processId, restartedWorker.processId);
  const report = {
    status: "PASS",
    syntheticOnly: true,
    measuredAt: new Date().toISOString(),
    sourceDatabase: old.sourceDatabase,
    restoredDatabase: restoreDb,
    backup,
    firstWorker,
    restartedWorker,
    backupOutput: JSON.parse(backupOutput),
    restoreOutput: JSON.parse(restoreOutput),
    verifyOutput: JSON.parse(verifyOutput),
    commands,
  };
  await writeFile(
    "docs/evidence/lms-one-run-20261015/agent-a/RESTORED_OUTBOX_ACCEPTANCE.json",
    JSON.stringify(report, null, 2),
  );
  console.log(
    JSON.stringify({
      status: report.status,
      restoredDatabase: restoreDb,
      firstWorker,
      restartedWorker,
    }),
  );
}
phase()
  .finally(() => db.$disconnect())
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
