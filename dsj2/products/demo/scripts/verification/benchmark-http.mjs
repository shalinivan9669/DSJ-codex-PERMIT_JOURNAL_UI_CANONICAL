import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";

// Deliberately opt-in: only a demoOnly tenant may receive these synthetic records.
assert.equal(process.env.DEMO_BENCHMARK_SYNTHETIC, "1");
const base = process.env.DEMO_BENCHMARK_URL;
const origin = process.env.DEMO_ORIGIN;
const email = process.env.DEMO_ADMIN_EMAIL;
const password = process.env.DEMO_ADMIN_PASSWORD;
assert.ok(base && origin && email && password, "Explicit test URL, origin and credentials are required");
const output = path.resolve(process.argv[2] || "docs/evidence/commercial-acceptance/load");
const sizes = (process.env.DEMO_BENCHMARK_SIZES || "1,10,50,100").split(",").map(Number);
const repeats = Number(process.env.DEMO_BENCHMARK_REPEATS || "3");
assert.ok(sizes.every((n) => Number.isInteger(n) && n > 0 && n <= 100));
assert.ok(Number.isInteger(repeats) && repeats > 0 && repeats <= 10);
await fs.mkdir(output, { recursive: true });
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function session() {
  const response = await fetch(base + "/auth/login", { method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify({ email, password }) });
  const login = await response.json();
  assert.equal(response.status, 201, JSON.stringify(login));
  const cookie = response.headers.getSetCookie().map((v) => v.split(";")[0]).join("; ");
  const call = async (route, method = "GET", body, idempotencyKey) => {
    const response = await fetch(base + route, { method, headers: { origin, cookie, "content-type": "application/json", "x-csrf-token": login.csrfToken, ...(idempotencyKey ? { "idempotency-key": idempotencyKey } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(180000) });
    const data = await response.json();
    assert.ok(response.ok, `${route}: ${response.status} ${JSON.stringify(data)}`);
    return data;
  };
  const context = await call("/context");
  assert.equal(context.tenant.demoOnly, true, "Benchmark refuses a production tenant");
  return { call, cookie, tenantId: context.tenant.id };
}
const operator = await session();
const customer = await operator.call("/customers", "POST", { nameRu: "Синтетический заказчик нагрузочной проверки", nameKz: "Жүктеме тексеруінің синтетикалық тапсырыс берушісі", bin: "000000000000", addressRu: "Тестовый адрес", addressKz: "Сынақ мекенжайы" });
const results = [];
await fs.writeFile(path.join(output, "environment.json"), JSON.stringify({ observedAt: new Date().toISOString(), node: process.version, platform: process.platform, cpu: os.cpus()[0]?.model, logicalCpus: os.cpus().length, memoryBytes: os.totalmem(), repeats, sizes, pollMs: 1000, workload: "HTTP create/finalize, real independent worker, all persisted artifacts downloaded and hashed; one BIOT protocol per distinct recipient", thresholds: { kind: "engineering assumptions, not contractual SLA", finalizeMs: 60000, readyPer100Ms: 1800000, unexpectedFailures: 0 }, queuePrecision: "Polling intervals, not exact service instrumentation. No p95 asserted from fewer than 20 complete samples." }, null, 2));

async function run(count, repetition, actor = operator, label = "serial") {
  const token = randomUUID();
  const directory = path.join(output, `${label}-${count}-${repetition}`);
  await fs.mkdir(directory, { recursive: true });
  const input = { kind: count === 1 ? "PERSON" : "COMPANY", customerId: count === 1 ? null : customer.id, title: `НАГРУЗОЧНЫЙ ТЕСТ ${count} ${token}`, demoMode: true, items: Array.from({ length: count }, (_, i) => ({ id: randomUUID(), fullNameRu: `Тестов Получатель ${String(i + 1).padStart(3, "0")} ${token.slice(0,8)}`, fullNameKz: `Сынақ Әғқңөұүһі ${String(i + 1).padStart(3, "0")} ${token.slice(0,8)}`, positionRu: "Инженер", positionKz: "Инженер", workplaceRu: "Синтетическая организация", workplaceKz: "Синтетикалық ұйым", assignments: [{ id: randomUUID(), templateId: "biot-protocol", documentDate: "2026-09-22", protocolDate: "2026-09-21", trainingStart: "2026-09-19", trainingEnd: "2026-09-20", trainingSubject: "Синтетическая программа", hours: "16", result: "Сдал", reason: "Периодическая проверка" }] })) };
  await fs.writeFile(path.join(directory, "input.json"), JSON.stringify(input, null, 2));
  const begin = Date.now();
  const request = await actor.call("/print-requests", "POST", input);
  const finalizeStart = Date.now();
  const issuance = await actor.call(`/print-requests/${request.id}/finalize`, "POST", { expectedRevision: request.revision }, token);
  const finalizeEnd = Date.now();
  const observed = new Map();
  let jobs = [];
  for (;;) {
    jobs = (await actor.call(`/jobs?requestId=${request.id}`)).items;
    const now = Date.now();
    for (const job of jobs) {
      const old = observed.get(job.id) || { id: job.id, kind: job.kind, createdAt: job.createdAt, firstSeenMs: now - begin };
      if (job.status === "PENDING" || job.status === "RETRY") old.lastWaitingMs = now - begin;
      if (job.status === "RUNNING" && old.firstRunningMs === undefined) old.firstRunningMs = now - begin;
      if (job.status === "SUCCEEDED" && old.firstSucceededMs === undefined) old.firstSucceededMs = now - begin;
      old.status = job.status; old.attempts = job.attempts; old.errorCode = job.errorCode;
      observed.set(job.id, old);
    }
    assert.ok(!jobs.some((j) => j.status === "FAILED"), `Terminal worker failure in ${request.id}`);
    if (jobs.length === count * 2 + 2 && jobs.every((j) => j.status === "SUCCEEDED")) break;
    assert.ok(now - begin < 1800000, "30-minute engineering timeout exceeded");
    await delay(1000);
  }
  const ready = Date.now();
  const detail = await actor.call(`/print-requests/${request.id}`);
  assert.equal(detail.documents.length, count);
  assert.equal(new Set(detail.documents.map((d) => d.number)).size, count);
  assert.deepEqual(detail.items.map((item) => item.fullNameRu), input.items.map((item) => item.fullNameRu));
  const artifacts = [];
  for (const job of jobs) {
    assert.ok(job.artifact);
    const response = await fetch(base + `/artifacts/${job.artifact.id}`, { headers: { cookie: actor.cookie } });
    assert.equal(response.status, 200);
    const bytes = Buffer.from(await response.arrayBuffer());
    assert.equal(digest(bytes), job.artifact.sha256);
    assert.equal(bytes.length, job.artifact.size);
    const file = `${job.id}.${job.kind.toLowerCase()}`;
    await fs.writeFile(path.join(directory, file), bytes);
    artifacts.push({ id: job.artifact.id, format: job.kind, file, bytes: bytes.length, sha256: digest(bytes) });
  }
  const done = Date.now();
  const result = { label, count, repetition, requestId: request.id, issuance, tenantId: actor.tenantId, createMs: finalizeStart - begin, finalizeMs: finalizeEnd - finalizeStart, readyMs: ready - begin, allDownloadsMs: done - ready, totalMs: done - begin, success: true, artifactBytes: artifacts.reduce((n, a) => n + a.bytes, 0), jobs: [...observed.values()], artifacts, documents: detail.documents };
  await fs.writeFile(path.join(directory, "result.json"), JSON.stringify(result, null, 2));
  results.push({ label, count, repetition, requestId: request.id, totalMs: result.totalMs, finalizeMs: result.finalizeMs, readyMs: result.readyMs, artifactBytes: result.artifactBytes, artifacts: artifacts.length });
  await fs.writeFile(path.join(output, "results.json"), JSON.stringify(results, null, 2));
  console.log(JSON.stringify(results.at(-1)));
}
for (let repetition = 1; repetition <= repeats; repetition++) for (const count of sizes) await run(count, repetition);
if (process.env.DEMO_BENCHMARK_CONCURRENT !== "0") {
  const secondOperator = await session();
  await Promise.all([run(10,1,operator,"concurrent-a"),run(10,1,secondOperator,"concurrent-b")]);
}
