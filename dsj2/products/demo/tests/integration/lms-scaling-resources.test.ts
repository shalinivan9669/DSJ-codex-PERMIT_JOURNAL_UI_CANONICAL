import test from "node:test";
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { request } from "node:http";
import {
  mkdir,
  open,
  readdir,
  rename,
  unlink,
  writeFile,
  type FileHandle,
} from "node:fs/promises";
import { resolve } from "node:path";
import { once } from "node:events";
import { db } from "../../apps/api/src/core";
import { bootstrap } from "../../apps/api/src/main";
import { createCourse, publishVersion } from "../../apps/api/src/lms/courses";
import { assignEnrollments } from "../../apps/api/src/lms/enrollments";
import { saveLessonProgress } from "../../apps/api/src/lms/learning";
import {
  startAttempt,
  saveAnswers,
  submitAttempt,
} from "../../apps/api/src/lms/exams";
import {
  lmsStore,
  lmsUploadDirectory,
  openPrivateStream,
} from "../../apps/api/src/lms/materials";
import {
  integrationHealth,
  INTEGRATION_WORKER_VERSION,
  INTEGRATION_STALE_MS,
} from "../../apps/api/src/integration-health";
import { lmsCourse, lmsTenant, lmsLearner, lmsSession } from "./lms-fixture";
import { assertTestDatabase } from "./test-database";

const delay = (ms: number) => new Promise((done) => setTimeout(done, ms));
async function until(check: () => Promise<boolean>, timeout = 15_000) {
  const end = Date.now() + timeout;
  while (!(await check())) {
    if (Date.now() > end) throw new Error("RESOURCE_SMOKE_TIMEOUT");
    await delay(100);
  }
}

test(
  "S1.5/S1.6/S2: bounded private IO, aborted admission cleanup and isolated integration lifecycle",
  { timeout: 120_000 },
  async (t) => {
    assertTestDatabase();
    assert.ok(
      process.env.DEMO_ARTIFACT_ROOT,
      "A task-owned storage root is required",
    );
    const evidence: Record<string, unknown> = {
      owner: "lms-tz-scaling-20261015",
      apiPid: process.pid,
      externalProvider: "NOT_CONNECTED",
    };
    try {
      await t.test(
        "several Range requests share one full integrity read; same-size modification and replacement invalidate it",
        async () => {
          const bytes = Buffer.from(
            "%PDF-1.4\nSynthetic private Range contents.\n".repeat(200),
          );
          const stored = await lmsStore.put(bytes, "pdf");
          const path = lmsStore.path(stored.storageKey);
          const probe = await open(path, "r");
          const prototype = Object.getPrototypeOf(probe) as {
            createReadStream: FileHandle["createReadStream"];
          };
          const original = prototype.createReadStream;
          let fullReads = 0;
          prototype.createReadStream = function (this: FileHandle, options) {
            if (
              options?.autoClose === false &&
              options.start === 0 &&
              options.end === undefined
            )
              fullReads++;
            return original.call(this, options);
          };
          await probe.close();
          const read = async (range: string, force = false) => {
            const result = await openPrivateStream(stored, range, force);
            assert.equal(result.invalid, false);
            if (result.invalid) throw new Error("RANGE_INVALID");
            const parts: Buffer[] = [];
            for await (const part of result.stream)
              parts.push(Buffer.from(part));
            return Buffer.concat(parts);
          };
          try {
            for (let i = 0; i < 4; i++)
              assert.deepEqual(
                await read(`bytes=${i * 10}-${i * 10 + 9}`),
                bytes.subarray(i * 10, i * 10 + 10),
              );
            assert.equal(fullReads, 1);
            await read("bytes=0-4", true);
            assert.equal(fullReads, 2);
            const corrupt = Buffer.from(bytes);
            corrupt[100] ^= 1;
            await writeFile(path, corrupt);
            await assert.rejects(
              read("bytes=0-4"),
              /Материал временно недоступен/,
            );
            assert.equal(fullReads, 3);
            const replacement = path + ".replacement";
            await writeFile(replacement, bytes);
            await unlink(path);
            await rename(replacement, path);
            assert.deepEqual(await read("bytes=0-4"), bytes.subarray(0, 5));
            assert.equal(fullReads, 4);
            evidence.range = {
              requests: 4,
              initialFullReads: 1,
              forcedCheck: true,
              sameSizeTamperRejected: true,
              replacementRechecked: true,
            };
          } finally {
            prototype.createReadStream = original;
          }
        },
      );

      await t.test(
        "two reserved multipart writers reject a third; abort cleans files and releases the budget",
        async () => {
          const center = await lmsTenant("scaling upload");
          const course = await createCourse(center.context, lmsCourse());
          process.env.PORT = "0";
          process.env.HOST = "127.0.0.1";
          process.env.DEMO_ORIGIN = "http://127.0.0.1:3315";
          const app = await bootstrap();
          const clients: ReturnType<typeof request>[] = [];
          try {
            await mkdir(lmsUploadDirectory, { recursive: true });
            const base = await app.getUrl();
            const headers = await lmsSession(base, center.user.email);
            const url = `${base}/lms/courses/${course.course.id}/materials`;
            for (let i = 0; i < 2; i++) {
              const client = request(url, {
                method: "POST",
                headers: {
                  ...headers,
                  "content-type": "multipart/form-data; boundary=smoke",
                },
              });
              client.on("error", () => {});
              client.write(
                '--smoke\r\nContent-Disposition: form-data; name="file"; filename="synthetic.pdf"\r\nContent-Type: application/pdf\r\n\r\n%PDF-1.4\n',
              );
              clients.push(client);
            }
            await until(
              async () => (await readdir(lmsUploadDirectory)).length === 2,
            );
            const upload = async () => {
              const body = new FormData();
              body.set(
                "file",
                new Blob(["%PDF-1.4\nSynthetic\n%%EOF"], {
                  type: "application/pdf",
                }),
                "synthetic.pdf",
              );
              return fetch(url, { method: "POST", headers, body });
            };
            const refused = await upload();
            assert.equal(refused.status, 503);
            assert.equal((await refused.json()).code, "UPLOAD_BUSY");
            for (const client of clients) client.destroy();
            await until(
              async () => (await readdir(lmsUploadDirectory)).length === 0,
            );
            const resumed = await upload();
            assert.equal(resumed.status, 201, await resumed.text());
            await until(
              async () => (await readdir(lmsUploadDirectory)).length === 0,
            );
            evidence.upload = {
              concurrency: 2,
              thirdStatus: 503,
              abortedFilesRemaining: 0,
              resumedStatus: 201,
            };
          } finally {
            for (const client of clients) client.destroy();
            await app.close();
          }
        },
      );

      await t.test(
        "own worker start/PENDING/stop/degraded/resume creates one local sanitary result without provider calls",
        async () => {
          const center = await lmsTenant("scaling lifecycle");
          const learner = await lmsLearner(center.tenant.id, "lifecycle");
          const definition = lmsCourse({ sanitary: true });
          const course = await createCourse(center.context, definition);
          await publishVersion(center.context, course.version.id, {
            revision: 0,
          });
          const enrollment = (
            await assignEnrollments(center.context, {
              courseVersionId: course.version.id,
              recipientIds: [learner.recipient.id],
            })
          ).items[0];
          await saveLessonProgress(learner.context, enrollment.id, "lesson-1", {
            sequence: 1,
            acknowledge: true,
          });
          const attempt = await startAttempt(learner.context, enrollment.id);
          await saveAnswers(learner.context, attempt.id, {
            sequence: 1,
            answers: Object.fromEntries(
              attempt.questions.map((q: { id: string }) => [q.id, ["a"]]),
            ),
          });
          await submitAttempt(learner.context, attempt.id);
          const result = await db.verifiedExamResult.findFirstOrThrow({
            where: { attemptId: attempt.id },
          });
          const outbox = await db.regulatoryOutbox.findFirstOrThrow({
            where: { resultId: result.id },
          });
          await db.regulatoryOutbox.update({
            where: { id: outbox.id },
            data: { availableAt: new Date(Date.now() + 120_000) },
          });
          const app = await bootstrap();
          const base = await app.getUrl();
          let child: ChildProcess | undefined;
          const pids: number[] = [];
          const start = () => {
            const workerDatabase = new URL(process.env.DATABASE_URL!);
            workerDatabase.searchParams.set("connection_limit", "2");
            workerDatabase.searchParams.set(
              "application_name",
              "demo-integration",
            );
            child = spawn(
              process.execPath,
              ["--import", "tsx", "apps/integration-worker/src/main.ts"],
              {
                cwd: resolve("."),
                env: {
                  ...process.env,
                  DATABASE_URL: workerDatabase.href,
                  TSX_TSCONFIG_PATH: resolve("tsconfig.base.json"),
                  DEMO_LMS_TEST_RUNTIME: "1",
                },
                windowsHide: true,
                stdio: "ignore",
              },
            );
            if (!child.pid) throw new Error("WORKER_NOT_STARTED");
            pids.push(child.pid);
            child.once("error", () => {});
          };
          const stop = async () => {
            if (!child || child.exitCode !== null || child.signalCode !== null)
              return;
            const exited = once(child, "exit");
            child.kill("SIGTERM");
            await exited;
          };
          try {
            const headers = await lmsSession(base, center.user.email);
            start();
            await until(
              async () =>
                (await integrationHealth(center.tenant.id)).status === "ok",
            );
            assert.equal(
              (
                await db.regulatoryOutbox.findUniqueOrThrow({
                  where: { id: outbox.id },
                })
              ).status,
              "PENDING",
            );
            await stop();
            // Windows SIGTERM ends only this captured process; stale age provides the
            // same health proof when the OS cannot deliver a graceful signal handler.
            await until(
              async () =>
                (await integrationHealth(center.tenant.id)).status ===
                "degraded",
              INTEGRATION_STALE_MS + 5000,
            );
            const degraded = await integrationHealth(center.tenant.id);
            assert.ok(
              ["STOPPED", "HEARTBEAT_STALE"].includes(degraded.reason!),
            );
            assert.equal(degraded.pendingCount, 1);
            const healthResponse = await fetch(`${base}/ready`, { headers });
            assert.equal(healthResponse.status, 503);
            const healthPayload = await healthResponse.json();
            assert.equal(healthPayload.details.integration.status, "degraded");
            assert.equal(
              healthPayload.details.integration.reason,
              degraded.reason,
            );
            await db.regulatoryOutbox.update({
              where: { id: outbox.id },
              data: { availableAt: new Date() },
            });
            start();
            await until(
              async () =>
                (
                  await db.regulatoryOutbox.findUniqueOrThrow({
                    where: { id: outbox.id },
                  })
                ).status === "DONE",
              20_000,
            );
            await delay(1200);
            assert.equal(
              await db.sanitaryJournalEntry.count({
                where: { resultId: result.id },
              }),
              1,
            );
            assert.equal(
              await db.regulatoryBatchItem.count({
                where: { resultId: result.id },
              }),
              1,
            );
            const delivery = await db.integrationDelivery.findMany({
              where: { resultId: result.id },
            });
            assert.equal(delivery.length, 1);
            assert.equal(
              await db.deliveryAttempt.count({
                where: { deliveryId: delivery[0].id },
              }),
              0,
            );
            assert.equal(
              (await integrationHealth(center.tenant.id)).connection,
              "NOT_CONNECTED",
            );
            evidence.lifecycle = {
              pids,
              pendingBeforeStop: 1,
              degradedReason: degraded.reason,
              resumedOutbox: "DONE",
              localJournalEntries: 1,
              batchItems: 1,
              deliveries: 1,
              providerAttempts: 0,
              administratorReadinessStatus: healthResponse.status,
              version: INTEGRATION_WORKER_VERSION,
            };
          } finally {
            await stop();
            await app.close();
          }
        },
      );
    } finally {
      await mkdir("docs/evidence/lms-tz-scaling-20261015", { recursive: true });
      await writeFile(
        "docs/evidence/lms-tz-scaling-20261015/RESOURCE_LIFECYCLE.json",
        JSON.stringify(evidence, null, 2) + "\n",
      );
      await db.$disconnect();
    }
  },
);
