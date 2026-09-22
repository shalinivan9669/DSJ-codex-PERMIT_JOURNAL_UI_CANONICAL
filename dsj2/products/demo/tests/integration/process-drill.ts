import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawn, execFileSync, type ChildProcess } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { db, hash, json } from "../../apps/api/src/core";
import { provision } from "../../scripts/setup";
import { ArtifactStore, PRODUCT_ROOT } from "../../packages/printing/src";
import { assertTestDatabase } from "./test-database";

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const output = join(
  PRODUCT_ROOT,
  "docs/evidence/commercial-acceptance/security",
);
const events: Array<Record<string, unknown>> = [];
const workers: ChildProcess[] = [];
function record(event: string, details: Record<string, unknown> = {}) {
  const value = { at: new Date().toISOString(), event, ...details };
  events.push(value);
  console.log(JSON.stringify(value));
}
function startWorker(label: string) {
  const child = spawn(
    process.execPath,
    [
      join(PRODUCT_ROOT, "node_modules/tsx/dist/cli.mjs"),
      "--tsconfig",
      "tsconfig.base.json",
      "apps/render-worker/src/main.ts",
    ],
    {
      cwd: PRODUCT_ROOT,
      windowsHide: true,
      env: { ...process.env, DEMO_RENDER_CONCURRENCY: "1" },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  workers.push(child);
  child.stdout?.on("data", (bytes: Buffer) =>
    record("worker.stdout", { label, message: bytes.toString("utf8").trim() }),
  );
  child.stderr?.on("data", (bytes: Buffer) =>
    record("worker.stderr", { label, message: bytes.toString("utf8").trim() }),
  );
  record("worker.spawn", { label, pid: child.pid });
  return child;
}
async function killWorker(child: ChildProcess) {
  if (child.exitCode !== null) return;
  if (process.platform === "win32")
    execFileSync("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], {
      windowsHide: true,
      stdio: "ignore",
    });
  else child.kill("SIGKILL");
  await new Promise<void>((resolve) => {
    if (child.exitCode !== null) resolve();
    else child.once("exit", () => resolve());
  });
  record("worker.killed", { pid: child.pid });
}
async function state(id: string) {
  return db.generationJob.findUniqueOrThrow({ where: { id } });
}
async function waitFor<T>(
  probe: () => Promise<T | null>,
  timeout = 180_000,
): Promise<T> {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const value = await probe();
    if (value !== null) return value;
    await delay(50);
  }
  throw new Error("DRILL_DEADLINE_EXCEEDED");
}

async function main() {
  assertTestDatabase();
  assert.match(
    new URL(process.env.DATABASE_URL!).pathname,
    /demo_test_worker_process_/,
  );
  assert.equal(
    await db.generationJob.count(),
    0,
    "This process drill requires a fresh dedicated database",
  );
  await mkdir(output, { recursive: true });
  const who = await provision({
    email: `worker-process-${randomUUID()}@example.test`,
    password: "Synthetic-Process-Password!",
    name: "Synthetic worker process drill",
    sample: true,
  });
  const template = await db.templateVersion.findFirstOrThrow({
    where: { tenantId: who.tenantId, templateId: "biot-protocol" },
    orderBy: { createdAt: "desc" },
  });
  const profile = await db.issuerProfileVersion.findFirstOrThrow({
    where: { tenantId: who.tenantId },
  });
  const request = await db.printRequest.create({
    data: {
      tenantId: who.tenantId,
      createdBy: who.userId,
      kind: "PERSON",
      draft: {},
      demoMode: true,
    },
  });
  const input = {
    mode: "draft-preview",
    demoMode: true,
    templateId: template.templateId,
    templateVersion: template.version,
    templateStorageKey: template.storageKey,
    templateChecksum: template.checksum,
    issuer: profile.profile,
    items: Array.from({ length: 100 }, (_, index) => ({
      id: `row-${index}`,
      fullNameRu: `Синтетический Получатель ${index + 1}`,
      fullNameKz: `Ә Ғ Қ Ң Ө Ұ Ү Һ І ${index + 1}`,
      positionRu: "Инженер",
      positionKz: "Маман",
      workplaceRu: "Синтетическая организация",
      workplaceKz: "Синтетикалық ұйым",
      number: `TEST-${index + 1}`,
      assignment: {
        templateId: template.templateId,
        documentDate: "2026-09-22",
        protocolDate: "2026-09-22",
        trainingSubject: "Синтетическая программа",
        result: "Синтетический результат",
        hours: "8",
      },
    })),
  };
  const snapshot = await db.renderInputSnapshot.create({
    data: {
      tenantId: who.tenantId,
      requestId: request.id,
      revision: 0,
      profileVersionId: profile.id,
      templateVersionId: template.id,
      input: json(input),
      inputHash: hash(input),
    },
  });
  const job = await db.generationJob.create({
    data: {
      tenantId: who.tenantId,
      requestId: request.id,
      snapshotId: snapshot.id,
      kind: "DOCX",
      logicalKey: randomUUID(),
    },
  });
  const first = startWorker("before-crash");
  const claimed = await waitFor(async () => {
    const value = await state(job.id);
    return value.status === "RUNNING" ? value : null;
  });
  record("claimed-before-kill", {
    jobId: job.id,
    status: claimed.status,
    attempts: claimed.attempts,
    fencingToken: claimed.fencingToken,
    leaseUntil: claimed.leaseUntil,
  });
  await killWorker(first);
  const killed = await state(job.id);
  assert.equal(
    killed.status,
    "RUNNING",
    "Worker must be killed before it publishes, not merely while queue is active",
  );
  assert.equal(await db.artifact.count({ where: { jobId: job.id } }), 0);
  record("crash-confirmed-before-publication", {
    jobId: job.id,
    status: killed.status,
    artifactCount: 0,
  });
  await delay(Math.max(0, killed.leaseUntil!.getTime() - Date.now()) + 300);
  const second = startWorker("recovery-a");
  const third = startWorker("recovery-b");
  const recovered = await waitFor(async () => {
    const value = await state(job.id);
    if (value.status === "FAILED")
      throw new Error(value.errorCode || "DRILL_RENDER_FAILED");
    return value.status === "SUCCEEDED" ? value : null;
  });
  assert.equal(recovered.attempts, 2);
  assert.equal(recovered.fencingToken, 2);
  assert.equal(recovered.snapshotId, snapshot.id);
  assert.equal(await db.artifact.count({ where: { jobId: job.id } }), 1);
  const artifact = await db.artifact.findUniqueOrThrow({
    where: { id: recovered.artifactId! },
  });
  const store = new ArtifactStore();
  assert.ok(await store.read(artifact.storageKey, artifact.sha256));
  record("recovered-once-with-two-workers", {
    jobId: job.id,
    attempts: recovered.attempts,
    fencingToken: recovered.fencingToken,
    artifactId: artifact.id,
    sha256: artifact.sha256,
    bytes: artifact.size,
  });
  const pdf = await db.generationJob.create({
    data: {
      tenantId: who.tenantId,
      requestId: request.id,
      snapshotId: snapshot.id,
      kind: "PDF",
      logicalKey: randomUUID(),
    },
  });
  let converterPid: number | undefined;
  if (process.platform === "win32") {
    converterPid = await waitFor(async () => {
      const processes = JSON.parse(
        execFileSync(
          "powershell.exe",
          [
            "-NoProfile",
            "-Command",
            "Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name,CommandLine | ConvertTo-Json -Compress",
          ],
          { windowsHide: true, encoding: "utf8" },
        ),
      ) as Array<{
        ProcessId: number;
        ParentProcessId: number;
        Name: string;
        CommandLine: string | null;
      }>;
      const descendants = new Set([second.pid!, third.pid!]);
      for (let pass = 0; pass < 10; pass++)
        for (const process of processes)
          if (descendants.has(process.ParentProcessId))
            descendants.add(process.ProcessId);
      return (
        processes.find(
          (process) =>
            descendants.has(process.ProcessId) &&
            process.Name.toLowerCase() === "soffice.bin" &&
            process.CommandLine?.includes("--convert-to"),
        )?.ProcessId || null
      );
    });
    execFileSync("taskkill.exe", ["/PID", String(converterPid), "/F"], {
      windowsHide: true,
      stdio: "ignore",
    });
    record("actual-converter-killed", { converterPid, jobId: pdf.id });
    const failure = await waitFor(async () => {
      const value = await state(pdf.id);
      return value.errorCode ? value : null;
    });
    record("converter-failure-recorded", {
      jobId: pdf.id,
      status: failure.status,
      errorCode: failure.errorCode,
      attempts: failure.attempts,
    });
    assert.equal(await db.artifact.count({ where: { jobId: pdf.id } }), 0);
  }
  const converted = await waitFor(async () => {
    const value = await state(pdf.id);
    if (value.status === "FAILED")
      throw new Error(value.errorCode || "DRILL_PDF_FAILED");
    return value.status === "SUCCEEDED" ? value : null;
  });
  assert.equal(await db.artifact.count({ where: { jobId: pdf.id } }), 1);
  const pdfArtifact = await db.artifact.findUniqueOrThrow({
    where: { id: converted.artifactId! },
  });
  assert.ok(await store.read(pdfArtifact.storageKey, pdfArtifact.sha256));
  assert.deepEqual(
    (await db.artifact.findUniqueOrThrow({ where: { id: artifact.id } }))
      .sha256,
    artifact.sha256,
  );
  assert.equal(
    await db.numberReservation.count({ where: { tenantId: who.tenantId } }),
    0,
  );
  record("pdf-recovery-complete", {
    jobId: pdf.id,
    attempts: converted.attempts,
    converterPid,
    sha256: pdfArtifact.sha256,
    originalDocxSha256: artifact.sha256,
    noNumbersReserved: true,
  });
}
void main()
  .then(() => record("PASS"))
  .catch((error) => {
    record("FAIL", { error: String(error) });
    process.exitCode = 1;
  })
  .finally(async () => {
    for (const worker of workers)
      await killWorker(worker).catch(() => undefined);
    await writeFile(
      join(output, "process-drill.json"),
      JSON.stringify(events, null, 2),
    );
    await db.$disconnect();
  });
