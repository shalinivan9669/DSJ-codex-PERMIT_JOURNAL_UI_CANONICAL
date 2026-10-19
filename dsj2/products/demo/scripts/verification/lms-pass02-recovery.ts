import assert from "node:assert/strict";
import { randomBytes, randomUUID, createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { access, mkdir, readFile, writeFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { TOTP, Secret } from "../../apps/api/node_modules/otpauth";
import { db, type Context } from "../../apps/api/src/core";
import { bootstrap } from "../../apps/api/src/main";
import { store } from "../../apps/api/src/files";
import { lmsSession, LMS_PASSWORD } from "../../tests/integration/lms-fixture";
import { createReport, reportFile } from "../../apps/api/src/lms/reports";
import {
  reportTick,
  claimReport,
  executeReport,
} from "../../apps/api/src/lms/report-worker";
import {
  createEmployerImport,
  confirmEmployerImport,
} from "../../apps/api/src/lms/employer-import";
import { runEmployerImportTick } from "../../apps/api/src/lms/employer-import-worker";
import {
  notificationTick,
  deliverLearningNotification,
} from "../../apps/api/src/lms/notification-worker";
import { enqueueEnrollmentNotification } from "../../apps/api/src/lms/notification-events";
import {
  listLearningNotifications,
  readLearningNotification,
} from "../../apps/api/src/lms/notifications";

const root = resolve(".runtime/lms-pass02-operations-20261018");
const fixturePath = resolve(root, "chain-fixture.json");
const statePath = resolve(root, "recovery-fixture.private.json");
const sourceKeys = resolve(root, "chain-mfa-keys.private.json");
const evidence = resolve(
  "docs/evidence/lms-full-tz-pass-02-operations-20261018",
);
type Fixture = {
  tenantId: string;
  director: { userId: string; email: string };
  learner: { userId: string; email: string };
  courseVersionId: string;
  enrollmentId: string;
  documentRequestId: string;
  documentId: string;
  applicationId: string;
};
function guard(restored = false) {
  const u = new URL(process.env.DATABASE_URL!);
  assert.equal(u.hostname, "127.0.0.1");
  assert.equal(u.port, "55479");
  assert.equal(
    u.pathname,
    restored ? "/demo_test_lms_pass02_restored" : "/demo_test_lms_pass02_chain",
  );
  assert.equal(process.env.DEMO_LMS_TEST_RUNTIME, "1");
  assert.ok(
    resolve(process.env.DEMO_ARTIFACT_ROOT!).startsWith(root + "\\") ||
      resolve(process.env.DEMO_ARTIFACT_ROOT!).startsWith(root + "/"),
  );
}
const context = (f: Fixture, learner = false): Context => ({
  tenantId: f.tenantId,
  userId: learner ? f.learner.userId : f.director.userId,
  role: learner ? "LEARNER" : "DIRECTOR",
  sessionId: "recovery-domain-harness",
  csrfHash: "",
  correlationId: randomUUID(),
});
const delay = (n: number) => new Promise((r) => setTimeout(r, n));
async function jsonResponse(response: Response, status = 201) {
  assert.equal(response.status, status, await response.clone().text());
  return response.json();
}
async function post(
  base: string,
  path: string,
  body: unknown,
  headers: Record<string, string> = {},
) {
  return fetch(base + path, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: process.env.DEMO_ORIGIN!,
      ...headers,
    },
    body: JSON.stringify(body),
  });
}
async function worker(mode: string) {
  guard();
  if (mode === "batch") await runEmployerImportTick();
  else if (mode === "report") {
    await db.$executeRawUnsafe("SET TIME ZONE 'Asia/Qyzylorda'");
    const claimed = await claimReport("pass02-crash-report");
    assert.ok(claimed);
    const remaining = claimed.leaseUntil!.getTime() - Date.now();
    assert.ok(
      remaining > 50_000 && remaining <= 60_000,
      `UTC lease drift: ${remaining}`,
    );
    assert.equal(await claimReport("pass02-competing-worker"), null);
    await executeReport(claimed);
  } else if (mode === "notification")
    await deliverLearningNotification("pass02-crash-notification");
  else throw new Error("WORKER_MODE");
}
/** A disposable-DB trigger blocks the real worker at an actual durable write. No product gate is replaced. */
async function crashAtWrite(mode: "batch" | "report" | "notification") {
  const table = {
    batch: "Recipient",
    report: "LmsReportJob",
    notification: "LmsLearningNotification",
  }[mode];
  const condition =
    mode === "report"
      ? "IF NEW.status <> 'READY' THEN RETURN NEW; END IF;"
      : "";
  const operation = mode === "report" ? "UPDATE" : "INSERT";
  const lock = 89134012;
  await db.$executeRawUnsafe(
    `CREATE FUNCTION pass02_fault_barrier() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN ${condition} PERFORM pg_advisory_xact_lock(${lock}); RETURN NEW; END $$`,
  );
  await db.$executeRawUnsafe(
    `CREATE TRIGGER pass02_fault_barrier BEFORE ${operation} ON "${table}" FOR EACH ROW EXECUTE FUNCTION pass02_fault_barrier()`,
  );
  let pid = 0,
    observed = false;
  try {
    await db.$transaction(
      async (tx) => {
        await tx.$executeRawUnsafe(`SELECT pg_advisory_xact_lock(${lock})`);
        const childDatabase = new URL(process.env.DATABASE_URL!);
        childDatabase.searchParams.set("connection_limit", "1");
        const child = spawn(
          process.execPath,
          [
            "--import",
            "tsx",
            resolve("scripts/verification/lms-pass02-recovery.ts"),
            "worker",
            mode,
          ],
          {
            env: { ...process.env, DATABASE_URL: childDatabase.toString() },
            windowsHide: true,
            stdio: ["ignore", "pipe", "pipe"],
          },
        );
        pid = child.pid!;
        const exit = once(child, "exit");
        let stderr = "";
        child.stderr.on("data", (b) => {
          stderr += b.toString();
        });
        child.stdout.resume();
        try {
          for (let n = 0; n < 450; n++) {
            const locks = await tx.$queryRaw<
              { total: bigint }[]
            >`SELECT count(*) AS total FROM pg_stat_activity WHERE datname=current_database() AND wait_event='advisory' AND pid<>pg_backend_pid()`;
            if (Number(locks[0].total) > 0) {
              observed = true;
              break;
            }
            if (child.exitCode !== null)
              throw new Error(
                `Worker exited before fault barrier: ${stderr.slice(0, 1000)}`,
              );
            await delay(100);
          }
          assert.equal(
            observed,
            true,
            `Worker ${mode} did not reach real write`,
          );
        } finally {
          if (child.exitCode === null) child.kill("SIGKILL");
          await exit;
        }
      },
      { timeout: 55_000, maxWait: 10_000 },
    );
  } finally {
    await db.$executeRawUnsafe(
      `DROP TRIGGER pass02_fault_barrier ON "${table}"`,
    );
    await db.$executeRawUnsafe("DROP FUNCTION pass02_fault_barrier()");
  }
  return {
    mode,
    pid,
    realWriteBarrierObserved: observed,
    processKilled: true,
    table,
  };
}
async function inboxSnapshot(c: Context) {
  const list = await listLearningNotifications(c, { pageSize: 100 });
  const rows = await db.lmsLearningNotification.findMany({
    where: { tenantId: c.tenantId, userId: c.userId },
    orderBy: { id: "asc" },
    select: { id: true, readAt: true, deliveryKey: true },
  });
  return { total: list.total, unread: list.unread, rows };
}
async function seed() {
  guard();
  const migrationCount = (
    await readdir(resolve("packages/database/prisma/migrations"), {
      withFileTypes: true,
    })
  ).filter((entry) => entry.isDirectory()).length;
  assert.ok(migrationCount >= 30);
  await assert.rejects(
    access(statePath),
    "Recovery seed is append-only; do not overwrite it",
  );
  const f: Fixture = JSON.parse(await readFile(fixturePath, "utf8")),
    c = context(f),
    learner = context(f, true);
  assert.equal(
    await db.$queryRaw<
      { count: bigint }[]
    >`SELECT count(*) AS count FROM "_prisma_migrations" WHERE finished_at IS NOT NULL`.then(
      (r) => Number(r[0].count),
    ),
    migrationCount,
  );
  await mkdir(root, { recursive: true });
  await writeFile(
    sourceKeys,
    JSON.stringify({ v1: randomBytes(32).toString("hex") }),
    { mode: 0o600, flag: "wx" },
  );
  process.env.DEMO_MFA_KEYS = await readFile(sourceKeys, "utf8");
  process.env.DEMO_MFA_KEY_VERSION = "v1";
  process.env.PORT = "0";
  const app = await bootstrap();
  let mfa: { secret: string; recoveryCodes: string[] };
  try {
    const base = await app.getUrl(),
      headers = await lmsSession(base, f.director.email);
    const reauth = await jsonResponse(
      await post(
        base,
        "/auth/mfa/reauth",
        { password: LMS_PASSWORD, purpose: "SETUP" },
        headers,
      ),
    );
    const setup = await jsonResponse(
      await post(
        base,
        "/auth/mfa/setup",
        { reauthToken: reauth.reauthToken },
        headers,
      ),
    );
    const otp = new TOTP({
      secret: Secret.fromBase32(setup.secret),
      digits: 6,
      period: 30,
      algorithm: "SHA1",
    }).generate();
    const confirmed = await jsonResponse(
      await post(
        base,
        "/auth/mfa/confirm",
        { reauthToken: reauth.reauthToken, code: otp },
        headers,
      ),
    );
    assert.equal(confirmed.enabled, true);
    assert.equal(confirmed.recoveryCodes.length, 10);
    mfa = { secret: setup.secret, recoveryCodes: confirmed.recoveryCodes };
  } finally {
    await app.close();
  }
  // N05 projects facts from the real AC32 chain; preserve read and unread states separately.
  for (let n = 0; n < 3; n++) await notificationTick();
  const notifications = await listLearningNotifications(learner, {
    pageSize: 100,
  });
  const items = notifications.items as { id: string; kind: string }[];
  assert.ok(
    items.some((n) => n.kind === "DOCUMENT_READY"),
    "The issued document must appear in the real inbox",
  );
  assert.ok(items.some((n) => n.kind === "RESULT"));
  await readLearningNotification(learner, items[0].id);
  const beforeInbox = await inboxSnapshot(learner);
  assert.ok(beforeInbox.unread > 0 && beforeInbox.total > beforeInbox.unread);
  const organization = await db.customerOrganization.create({
    data: { tenantId: c.tenantId, nameRu: "SYNTHETIC recovery import" },
  });
  const batchId = randomUUID();
  await createEmployerImport(c, {
    id: batchId,
    customerId: organization.id,
    courseVersionId: f.courseVersionId,
    rows: Array.from({ length: 120 }, (_, n) => ({
      sourceRow: n + 1,
      fullNameRu: `Recovery synthetic employee ${String(n).padStart(4, "0")}`,
      email: `recovery-${n}@example.test`,
      positionRu: "Synthetic",
      resolution: "NEW",
    })),
  });
  await confirmEmployerImport(c, batchId, { revision: 0 });
  assert.equal(await runEmployerImportTick(), true);
  const partial = await db.lmsEmployerImport.findUniqueOrThrow({
    where: { id: batchId },
  });
  assert.equal(partial.cursor, 50);
  const faults = [await crashAtWrite("batch")];
  assert.equal(
    (await db.lmsEmployerImport.findUniqueOrThrow({ where: { id: batchId } }))
      .cursor,
    50,
  );
  assert.equal(
    await db.lmsEmployerImportRow.count({ where: { importId: batchId } }),
    50,
  );
  const report = await createReport(c, {
    kind: "DOCUMENTS",
    format: "CSV",
    language: "kz",
    filters: { courseVersionId: f.courseVersionId },
    requestKey: randomUUID(),
  });
  faults.push(await crashAtWrite("report"));
  const unfinished = await db.lmsReportJob.findUniqueOrThrow({
    where: { id: report.id },
  });
  assert.equal(unfinished.status, "RUNNING");
  assert.equal(unfinished.storageKey, null);
  await assert.rejects(reportFile(c, report.id));
  // A new, explicit synthetic fact goes through the product outbox, not direct inbox insertion.
  await enqueueEnrollmentNotification(
    db,
    { tenantId: c.tenantId, id: f.enrollmentId },
    "RESULT",
    {
      key: "AC30:notification-recovery",
      sourceType: "RESULT",
      sourceId: f.enrollmentId,
    },
  );
  faults.push(await crashAtWrite("notification"));
  const event = await db.lmsNotificationEvent.findFirstOrThrow({
    where: { leaseOwner: "pass02-crash-notification", state: "RUNNING" },
  });
  assert.equal(
    await db.lmsLearningNotification.count({
      where: {
        tenantId: c.tenantId,
        userId: event.userId,
        deliveryKey: event.deliveryKey,
      },
    }),
    0,
  );
  const artifacts = await db.artifact.findMany({
    where: { tenantId: c.tenantId },
    select: {
      id: true,
      requestId: true,
      format: true,
      storageKey: true,
      sha256: true,
      size: true,
    },
  });
  for (const a of artifacts)
    assert.equal((await store.read(a.storageKey, a.sha256)).length, a.size);
  await writeFile(
    statePath,
    JSON.stringify(
      {
        f,
        mfa: mfa!,
        beforeInbox,
        batchId,
        reportId: report.id,
        eventId: event.id,
        eventUserId: event.userId,
        eventKey: event.deliveryKey,
        artifacts,
        faults,
        sourceKeysSha256: createHash("sha256")
          .update(process.env.DEMO_MFA_KEYS)
          .digest("hex"),
        sourcePid: process.pid,
      },
      null,
      2,
    ),
    { mode: 0o600, flag: "wx" },
  );
  await writeFile(
    resolve(evidence, "RECOVERY_FAULTS_AC30.json"),
    JSON.stringify(
      {
        status: "PASS",
        faults,
        partialBatchRows: 50,
        totalBatchRows: 120,
        uncommittedInboxRolledBack: true,
        partialReportUnavailable: true,
        inbox: { total: beforeInbox.total, unread: beforeInbox.unread },
        continuation: "PENDING_RESTORE",
      },
      null,
      2,
    ),
  );
  console.log(
    JSON.stringify({
      status: "SEEDED",
      faults: faults.length,
      inbox: beforeInbox.total,
    }),
  );
}
async function resume() {
  guard(true);
  const state = JSON.parse(await readFile(statePath, "utf8")),
    f = state.f as Fixture,
    c = context(f),
    learner = context(f, true);
  assert.notEqual(process.pid, state.sourcePid);
  const keysFile = resolve(root, "recovery-profile/mfa-keys.json");
  process.env.DEMO_MFA_KEYS = await readFile(keysFile, "utf8");
  process.env.DEMO_MFA_KEY_VERSION = "v1";
  assert.equal(
    createHash("sha256").update(process.env.DEMO_MFA_KEYS).digest("hex"),
    state.sourceKeysSha256,
  );
  assert.deepEqual(
    JSON.parse(JSON.stringify(await inboxSnapshot(learner))),
    state.beforeInbox,
    "Read/unread and notification identities survive restore exactly",
  );
  for (const a of state.artifacts)
    assert.equal((await store.read(a.storageKey, a.sha256)).length, a.size);
  const artifactsBefore = await db.artifact.count();
  const report = await db.lmsReportJob.findUniqueOrThrow({
    where: { id: state.reportId },
  });
  const batch = await db.lmsEmployerImport.findUniqueOrThrow({
    where: { id: state.batchId },
  });
  const event = await db.lmsNotificationEvent.findUniqueOrThrow({
    where: { id: state.eventId },
  });
  // Wait actual lease expiry; the clock and durable lease timestamps are never rewritten.
  const until = Math.max(
    ...[report.leaseUntil, batch.leaseUntil, event.leaseUntil].map(
      (d) => d?.getTime() || 0,
    ),
  );
  while (Date.now() <= until) {
    console.log(JSON.stringify({ waitingForLeaseMs: until - Date.now() }));
    await delay(Math.min(10_000, until - Date.now() + 50));
  }
  for (let n = 0; n < 15; n++) {
    if (!(await runEmployerImportTick())) break;
  }
  const finalBatch = await db.lmsEmployerImport.findUniqueOrThrow({
    where: { id: state.batchId },
  });
  assert.equal(finalBatch.state, "COMPLETED");
  assert.equal(
    await db.lmsEmployerImportRow.count({ where: { importId: state.batchId } }),
    120,
  );
  assert.equal(
    await db.lmsAssignmentRow.count({
      where: { operationId: finalBatch.operationId! },
    }),
    120,
  );
  const assigned = await db.enrollment.findMany({
    where: {
      customerId: finalBatch.customerId,
      courseVersionId: f.courseVersionId,
    },
    select: { recipientId: true },
  });
  assert.equal(assigned.length, 120);
  assert.equal(new Set(assigned.map((r) => r.recipientId)).size, 120);
  await reportTick("pass02-restored-worker");
  const ready = await db.lmsReportJob.findUniqueOrThrow({
    where: { id: state.reportId },
  });
  assert.equal(ready.status, "READY");
  assert.ok(ready.fencingToken > report.fencingToken);
  assert.equal(
    (await store.read(ready.storageKey!, ready.sha256!)).length,
    ready.size,
  );
  for (let n = 0; n < 3; n++) await notificationTick();
  assert.equal(
    await db.lmsLearningNotification.count({
      where: {
        tenantId: c.tenantId,
        userId: state.eventUserId,
        deliveryKey: state.eventKey,
      },
    }),
    1,
  );
  assert.equal(
    (
      await db.lmsNotificationEvent.findUniqueOrThrow({
        where: { id: state.eventId },
      })
    ).state,
    "DELIVERED",
  );
  assert.equal(
    await db.artifact.count(),
    artifactsBefore,
    "No original renderer files duplicated by restart",
  );
  assert.equal(await runEmployerImportTick(), false);
  assert.equal((await reportTick()).processed, 0);
  const duplicates = await db.$queryRaw<
    { count: bigint }[]
  >`SELECT count(*) AS count FROM (SELECT "tenantId","userId","deliveryKey" FROM "LmsLearningNotification" WHERE "deliveryKey" IS NOT NULL GROUP BY 1,2,3 HAVING count(*)>1) d`;
  assert.equal(Number(duplicates[0].count), 0);
  process.env.PORT = "0";
  const app = await bootstrap();
  const downloads: object[] = [];
  try {
    const base = await app.getUrl();
    const first = await jsonResponse(
      await post(base, "/auth/login", {
        email: f.director.email,
        password: LMS_PASSWORD,
      }),
    );
    assert.equal(first.mfaRequired, true);
    const factor = await db.mfaFactor.findUniqueOrThrow({
      where: { userId: f.director.userId },
    });
    while (Math.floor(Date.now() / 30_000) <= factor.lastTotpStep)
      await delay(1000);
    const otp = new TOTP({
      secret: Secret.fromBase32(state.mfa.secret),
      digits: 6,
      period: 30,
      algorithm: "SHA1",
    }).generate();
    const verified = await post(base, "/auth/mfa/challenge", {
      challengeToken: first.challengeToken,
      code: otp,
    });
    await jsonResponse(verified);
    assert.ok(
      verified.headers
        .getSetCookie()
        .some((v) => v.startsWith("demo_session=")),
    );
    const second = await jsonResponse(
      await post(base, "/auth/login", {
        email: f.director.email,
        password: LMS_PASSWORD,
      }),
    );
    await jsonResponse(
      await post(base, "/auth/mfa/challenge", {
        challengeToken: second.challengeToken,
        code: state.mfa.recoveryCodes[0],
      }),
    );
    assert.equal(
      await db.mfaRecoveryCode.count({
        where: { userId: f.director.userId, usedAt: null },
      }),
      9,
    );
    const replay = await jsonResponse(
      await post(base, "/auth/login", {
        email: f.director.email,
        password: LMS_PASSWORD,
      }),
    );
    assert.equal(
      (
        await post(base, "/auth/mfa/challenge", {
          challengeToken: replay.challengeToken,
          code: state.mfa.recoveryCodes[0],
        })
      ).status,
      401,
    );
    const own = await lmsSession(base, f.learner.email);
    for (const a of state.artifacts.filter(
      (a: { requestId: string; format: string }) =>
        a.requestId === f.documentRequestId &&
        ["PDF", "DOCX"].includes(a.format),
    )) {
      const response = await fetch(`${base}/learn/artifacts/${a.id}`, {
        headers: own,
      });
      assert.equal(response.status, 200);
      assert.equal(
        createHash("sha256")
          .update(Buffer.from(await response.arrayBuffer()))
          .digest("hex"),
        a.sha256,
      );
      downloads.push({
        id: a.id,
        format: a.format,
        sha256: a.sha256,
        status: 200,
      });
    }
    assert.equal(downloads.length, 2);
  } finally {
    await app.close();
  }
  const file = resolve(evidence, "RECOVERY_AC30_31.json");
  await writeFile(
    file,
    JSON.stringify(
      {
        status: "PASS",
        database: "demo_test_lms_pass02_restored",
        sourceDatabase: "demo_test_lms_pass02_chain",
        sourcePid: state.sourcePid,
        resumedPid: process.pid,
        realProcessFaults: state.faults,
        restoredFileCount: state.artifacts.length,
        originalArtifactRowsUnchanged: true,
        batch: {
          rows: 120,
          assignments: assigned.length,
          distinctRecipients: 120,
          status: finalBatch.state,
        },
        report: {
          id: ready.id,
          status: ready.status,
          attempts: ready.attempts,
          previousFence: report.fencingToken,
          fence: ready.fencingToken,
          sha256: ready.sha256,
        },
        notification: { exactlyOne: true, duplicateKeys: 0 },
        readUnreadIdentitiesPreserved: true,
        totpLogin: "PASS",
        recoveryLogin: "PASS",
        recoveryReplayRejected: true,
        privateKeyDependencyRestored: true,
        downloads,
        external: "NOT_CONNECTED",
        limits: [
          "Synthetic local recovery drill; not production RPO/RTO",
          "No original DB/storage/key material overwritten",
          "Disposable database trigger barriers were removed before backup",
          "No real signatures, providers or payments",
        ],
      },
      null,
      2,
    ),
  );
  console.log(JSON.stringify({ status: "PASS", evidence: file }));
}
const mode = process.argv[2];
(mode === "seed"
  ? seed()
  : mode === "resume"
    ? resume()
    : mode === "worker"
      ? worker(process.argv[3])
      : Promise.reject(new Error("seed|resume|worker required"))
)
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
