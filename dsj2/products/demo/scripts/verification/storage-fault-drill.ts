import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import { createWriteStream } from "node:fs";
import {
  chmod,
  mkdir,
  open,
  readFile,
  statfs,
  unlink,
  writeFile,
} from "node:fs/promises";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { db } from "../../apps/api/src/core";
import { bootstrap } from "../../apps/api/src/main";
import { provision } from "../setup";

// This drill deliberately fills ONLY a tiny, explicitly mounted disposable tmpfs.
// It must never run against a host filesystem, a normal artifact volume, or production.
const root = resolve(process.env.DEMO_ARTIFACT_ROOT || "");
const output = resolve(process.argv[2] || "/evidence/storage-faults");
const base = "http://127.0.0.1:4100";
const hash = (bytes: Buffer) =>
  createHash("sha256").update(bytes).digest("hex");
const observations: unknown[] = [];
let worker: ChildProcess | undefined;
let paused = false;
let app: Awaited<ReturnType<typeof bootstrap>> | undefined;
const filler = join(root, "acceptance-only-filler.bin");
const objects = join(root, "objects");
let permissionFault = false;
let validatedMount = false;

function signalWorker(signal: NodeJS.Signals) {
  assert.ok(
    worker?.pid && worker.exitCode === null,
    "Owned worker must be alive",
  );
  process.kill(-worker.pid, signal);
  paused = signal === "SIGSTOP";
}
async function until<T>(
  read: () => Promise<T>,
  valid: (value: T) => boolean,
  description: string,
  timeout = 90000,
) {
  const started = Date.now();
  for (;;) {
    const value = await read();
    if (valid(value)) return value;
    assert.ok(Date.now() - started < timeout, description);
    await delay(100);
  }
}
async function main() {
  assert.equal(process.env.DEMO_STORAGE_FAULT_DRILL, "SYNTHETIC_TMPFS_ONLY");
  assert.equal(process.platform, "linux");
  assert.ok(
    process.getuid && process.getuid() !== 0,
    "A non-root process is mandatory for the permission fault",
  );
  assert.equal(root, "/fault-storage");
  assert.match(
    process.env.DATABASE_URL || "",
    /\/demo_test_storage_[a-z0-9_]+(?:\?|$)/,
  );
  const mount = (await readFile("/proc/self/mountinfo", "utf8"))
    .split("\n")
    .find((line) => line.split(" ")[4] === root);
  assert.ok(
    mount?.includes(" - tmpfs "),
    "Dedicated /fault-storage tmpfs mount required",
  );
  const fsBefore = await statfs(root);
  const capacity = fsBefore.blocks * fsBefore.bsize;
  assert.ok(
    capacity > 0 && capacity <= 64 * 1024 * 1024,
    "Refuse to fill a filesystem larger than 64 MiB",
  );
  validatedMount = true;
  await mkdir(output, { recursive: true });
  process.env.DEMO_ORIGIN = base;
  process.env.PORT = "4100";
  process.env.HOST = "127.0.0.1";
  const credentials = {
    email: `storage-${randomUUID()}@example.invalid`,
    password: randomUUID() + randomUUID(),
  };
  const identity = await provision({
    ...credentials,
    name: "Синтетический центр проверки отказа хранилища",
    sample: true,
  });
  app = await bootstrap();
  worker = spawn(
    process.execPath,
    ["node_modules/tsx/dist/cli.mjs", "apps/render-worker/src/main.ts"],
    {
      detached: true,
      env: { ...process.env, DEMO_RENDER_CONCURRENCY: "1" },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  const log = createWriteStream(join(output, "worker.log"));
  worker.stdout!.pipe(log, { end: false });
  worker.stderr!.pipe(log, { end: false });
  worker.on("exit", () => log.end());
  const loginResponse = await fetch(base + "/auth/login", {
    method: "POST",
    headers: { origin: base, "content-type": "application/json" },
    body: JSON.stringify(credentials),
  });
  assert.equal(loginResponse.status, 201);
  const login = (await loginResponse.json()) as { csrfToken: string };
  const cookie = loginResponse.headers
    .getSetCookie()
    .map((value) => value.split(";")[0])
    .join("; ");
  async function request(
    route: string,
    method = "GET",
    body?: unknown,
    key?: string,
  ) {
    const response = await fetch(base + route, {
      method,
      headers: {
        origin: base,
        cookie,
        "content-type": "application/json",
        "x-csrf-token": login.csrfToken,
        ...(key ? { "idempotency-key": key } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(120000),
    });
    return {
      status: response.status,
      body: (await response.json()) as Record<string, unknown>,
    };
  }
  await until(
    () => request("/ready"),
    (r) => r.status === 200,
    "Real worker must register readiness",
  );
  observations.push({
    environment: {
      mount,
      capacity,
      uid: process.getuid!(),
      database: new URL(process.env.DATABASE_URL!).pathname,
      tenantId: identity.tenantId,
      apiPid: process.pid,
      workerPid: worker.pid,
    },
    initialReady: await request("/ready"),
  });
  for (const fault of ["ENOSPC", "EACCES"] as const) {
    signalWorker("SIGSTOP");
    const created = await request("/print-requests", "POST", {
      kind: "PERSON",
      title: `Синтетическая проверка ${fault}`,
      demoMode: true,
      items: [
        {
          id: randomUUID(),
          fullNameRu: `Синтетический Получатель ${fault}`,
          fullNameKz: `Синтетикалық Алушы ${fault}`,
          positionRu: "Инженер",
          positionKz: "Маман",
          workplaceRu: "Синтетическая организация",
          workplaceKz: "Синтетикалық ұйым",
          assignments: [
            {
              id: randomUUID(),
              templateId: "biot-protocol",
              documentDate: "2026-09-22",
              protocolDate: "2026-09-21",
              trainingStart: "2026-09-19",
              trainingEnd: "2026-09-20",
              trainingSubject: "Синтетическая программа",
              hours: "16",
              result: "Сдал",
              reason: "Периодическая проверка",
            },
          ],
        },
      ],
    });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    const requestId = String(created.body.id);
    const finalized = await request(
      `/print-requests/${requestId}/finalize`,
      "POST",
      { expectedRevision: created.body.revision },
      randomUUID(),
    );
    assert.equal(finalized.status, 201, JSON.stringify(finalized.body));
    const numbersBefore = await db.issuedDocument.findMany({
      where: { tenantId: identity.tenantId, requestId },
      orderBy: { id: "asc" },
    });
    const sequencesBefore = await db.numberSequence.findMany({
      where: { tenantId: identity.tenantId },
      orderBy: { namespace: "asc" },
    });
    let observedOsCode = "";
    let fillerBytes = 0;
    if (fault === "ENOSPC") {
      const file = await open(filler, "wx", 0o600);
      try {
        for (;;) {
          const wrote = await file.write(Buffer.alloc(65536, 0x44));
          fillerBytes += wrote.bytesWritten;
          assert.ok(fillerBytes <= capacity, "Bounded tmpfs fill only");
        }
      } catch (error) {
        observedOsCode = (error as NodeJS.ErrnoException).code || "";
        assert.equal(observedOsCode, "ENOSPC");
      } finally {
        await file.close();
      }
      assert.equal((await statfs(root)).bavail, 0);
    } else {
      await chmod(objects, 0o000);
      permissionFault = true;
      try {
        await open(join(objects, "forbidden-probe"), "wx");
      } catch (error) {
        observedOsCode = (error as NodeJS.ErrnoException).code || "";
      }
      assert.equal(observedOsCode, "EACCES");
    }
    const duringReady = await request("/ready");
    assert.equal(duringReady.status, 503, JSON.stringify(duringReady));
    assert.equal(duringReady.body.code, "STORAGE_NOT_READY");
    signalWorker("SIGCONT");
    const failedJobs = await until(
      () =>
        db.generationJob.findMany({
          where: { tenantId: identity.tenantId, requestId },
        }),
      (jobs) =>
        jobs.some((job) => job.status === "RETRY" && job.errorCode !== null),
      "Worker must encounter the real storage fault",
      45000,
    );
    signalWorker("SIGSTOP");
    assert.equal(
      await db.artifact.count({
        where: { tenantId: identity.tenantId, requestId },
      }),
      0,
      "No completed artifact may be published under a write fault",
    );
    if (fault === "ENOSPC") await unlink(filler);
    else {
      await chmod(objects, 0o700);
      permissionFault = false;
    }
    signalWorker("SIGCONT");
    const recoveredJobs = await until(
      () =>
        db.generationJob.findMany({
          where: { tenantId: identity.tenantId, requestId },
        }),
      (jobs) =>
        jobs.length === 4 && jobs.every((job) => job.status === "SUCCEEDED"),
      "Worker must recover without allocating another number",
      180000,
    );
    const afterReady = await request("/ready");
    assert.equal(afterReady.status, 200);
    const artifacts = await db.artifact.findMany({
      where: { tenantId: identity.tenantId, requestId },
      orderBy: { format: "asc" },
    });
    assert.equal(artifacts.length, 4);
    assert.deepEqual(
      artifacts.map((item) => item.format),
      ["DOCX", "PDF", "XLSX", "ZIP"],
    );
    const downloads = [];
    for (const artifact of artifacts) {
      const reads = [];
      for (let repeat = 0; repeat < 2; repeat++) {
        const response = await fetch(base + `/artifacts/${artifact.id}`, {
          headers: { cookie },
        });
        assert.equal(response.status, 200);
        const bytes = Buffer.from(await response.arrayBuffer());
        assert.equal(hash(bytes), artifact.sha256);
        assert.equal(bytes.length, artifact.size);
        reads.push({ sha256: hash(bytes), bytes: bytes.length });
      }
      downloads.push({ id: artifact.id, format: artifact.format, reads });
    }
    assert.deepEqual(
      await db.issuedDocument.findMany({
        where: { tenantId: identity.tenantId, requestId },
        orderBy: { id: "asc" },
      }),
      numbersBefore,
    );
    assert.deepEqual(
      await db.numberSequence.findMany({
        where: { tenantId: identity.tenantId },
        orderBy: { namespace: "asc" },
      }),
      sequencesBefore,
    );
    observations.push({
      fault,
      observedOsCode,
      fillerBytes,
      duringReady,
      failedJobs,
      afterReady,
      recoveredJobs,
      downloads,
      documentNumbers: numbersBefore.map((document) => document.number),
      status: "PASS",
    });
    await writeFile(
      join(output, "result.json"),
      JSON.stringify({ status: "IN_PROGRESS", observations }, null, 2),
    );
  }
  await writeFile(
    join(output, "result.json"),
    JSON.stringify({ status: "PASS", observations }, null, 2),
  );
  console.log(
    JSON.stringify({ status: "PASS", faults: ["ENOSPC", "EACCES"], output }),
  );
}
void main()
  .catch(async (error) => {
    process.exitCode = 1;
    console.error(error);
    await mkdir(output, { recursive: true });
    await writeFile(
      join(output, "failure.json"),
      JSON.stringify(
        { status: "FAIL", error: String(error), observations },
        null,
        2,
      ),
    );
  })
  .finally(async () => {
    if (validatedMount) {
      if (permissionFault) await chmod(objects, 0o700);
      await unlink(filler).catch(() => undefined);
    }
    if (worker?.pid && worker.exitCode === null) {
      if (paused) signalWorker("SIGCONT");
      signalWorker("SIGTERM");
      const started = Date.now();
      while (
        worker.exitCode === null &&
        worker.signalCode === null &&
        Date.now() - started < 15000
      )
        await delay(100);
      if (worker.exitCode === null && worker.signalCode === null)
        process.kill(-worker.pid, "SIGKILL");
    }
    await app?.close();
    await db.$disconnect();
  });
