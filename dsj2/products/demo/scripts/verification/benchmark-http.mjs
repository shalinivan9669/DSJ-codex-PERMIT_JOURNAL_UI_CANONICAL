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
assert.ok(
  base && origin && email && password,
  "Explicit test URL, origin and credentials are required",
);
const output = path.resolve(
  process.argv[2] || "docs/evidence/commercial-acceptance/load",
);
const sizes = (process.env.DEMO_BENCHMARK_SIZES || "1,10,50,100")
  .split(",")
  .map(Number);
const repeats = Number(process.env.DEMO_BENCHMARK_REPEATS || "3");
assert.ok(sizes.every((n) => Number.isInteger(n) && n > 0 && n <= 100));
assert.ok(Number.isInteger(repeats) && repeats > 0 && repeats <= 10);
await fs.mkdir(output, { recursive: true });
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function session(credentials = { email, password }) {
  const response = await fetch(base + "/auth/login", {
    method: "POST",
    headers: { origin, "content-type": "application/json" },
    body: JSON.stringify(credentials),
    signal: AbortSignal.timeout(180000),
  });
  const login = await response.json();
  assert.equal(response.status, 201, JSON.stringify(login));
  const cookie = response.headers
    .getSetCookie()
    .map((v) => v.split(";")[0])
    .join("; ");
  const call = async (route, method = "GET", body, idempotencyKey) => {
    const response = await fetch(base + route, {
      method,
      headers: {
        origin,
        cookie,
        "content-type": "application/json",
        "x-csrf-token": login.csrfToken,
        ...(idempotencyKey ? { "idempotency-key": idempotencyKey } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(180000),
    });
    const data = await response.json();
    assert.ok(
      response.ok,
      `${route}: ${response.status} ${JSON.stringify(data)}`,
    );
    return data;
  };
  const context = await call("/context");
  assert.equal(
    context.tenant.demoOnly,
    true,
    "Benchmark refuses a production tenant",
  );
  return {
    call,
    cookie,
    tenantId: context.tenant.id,
    userId: context.user.id,
    role: context.user.role,
  };
}
const administrator = await session();
assert.equal(
  administrator.role,
  "ADMIN",
  "Benchmark bootstrap requires a synthetic-centre administrator",
);
async function createOperator(label) {
  const credentials = {
    email: `benchmark-${label}-${randomUUID()}@example.invalid`,
    password: `Synthetic-${randomUUID()}-${randomUUID()}`,
  };
  const user = await administrator.call("/users", "POST", {
    ...credentials,
    displayName: `Синтетический оператор ${label}`,
    role: "OPERATOR",
  });
  const actor = await session(credentials);
  assert.equal(actor.userId, user.id);
  assert.equal(actor.role, "OPERATOR");
  assert.equal(actor.tenantId, administrator.tenantId);
  return actor;
}
const operator = await createOperator("A");
const secondOperator =
  process.env.DEMO_BENCHMARK_CONCURRENT !== "0"
    ? await createOperator("B")
    : null;
if (secondOperator) assert.notEqual(operator.userId, secondOperator.userId);
const customer = await operator.call("/customers", "POST", {
  nameRu: "Синтетический заказчик нагрузочной проверки",
  nameKz: "Жүктеме тексеруінің синтетикалық тапсырыс берушісі",
  bin: "000000000000",
  addressRu: "Тестовый адрес",
  addressKz: "Сынақ мекенжайы",
});
const results = [];
let resultWrites = Promise.resolve();
async function persistResults() {
  const snapshot = JSON.stringify(results, null, 2);
  resultWrites = resultWrites.then(() =>
    fs.writeFile(path.join(output, "results.json"), snapshot),
  );
  await resultWrites;
}
const environment = {
  observedAt: new Date().toISOString(),
  clientHost: {
    node: process.version,
    platform: process.platform,
    cpu: os.cpus()[0]?.model,
    logicalCpus: os.cpus().length,
    memoryBytes: os.totalmem(),
  },
  target: {
    origin: base,
    runtimeDescription:
      process.env.DEMO_BENCHMARK_RUNTIME_DESCRIPTION ||
      "See separate server/container resource telemetry; clientHost is not a server capacity measurement",
  },
  operators: [operator, secondOperator]
    .filter(Boolean)
    .map(({ userId, role, tenantId }) => ({ userId, role, tenantId })),
  repeats,
  sizes,
  pollMs: 1000,
  workload:
    "HTTP create/finalize, real independent worker, all persisted artifacts downloaded and hashed; one BIOT protocol per distinct recipient",
  thresholds: {
    kind: "engineering assumptions, not contractual SLA",
    finalizeMs: 60000,
    issuanceTimeoutMs: 1800000,
    unexpectedFailures: 0,
  },
  queuePrecision:
    "Observed states relative to request start with 1000ms polling uncertainty; not exact worker service instrumentation. No p95 asserted from fewer than 20 complete samples.",
};
await fs.writeFile(
  path.join(output, "environment.json"),
  JSON.stringify(environment, null, 2),
);

async function run(count, repetition, actor = operator, label = "serial") {
  const token = randomUUID();
  const directory = path.join(output, `${label}-${count}-${repetition}`);
  await fs.mkdir(directory, { recursive: true });
  let requestId;
  const observed = new Map();
  let begin = Date.now();
  try {
    const input = {
      kind: count === 1 ? "PERSON" : "COMPANY",
      customerId: count === 1 ? null : customer.id,
      title: `НАГРУЗОЧНЫЙ ТЕСТ ${count} ${token}`,
      demoMode: true,
      items: Array.from({ length: count }, (_, i) => ({
        id: randomUUID(),
        fullNameRu: `Тестов Получатель ${String(i + 1).padStart(3, "0")} ${token.slice(0, 8)}`,
        fullNameKz: `Сынақ Әғқңөұүһі ${String(i + 1).padStart(3, "0")} ${token.slice(0, 8)}`,
        positionRu: "Инженер",
        positionKz: "Инженер",
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
      })),
    };
    await fs.writeFile(
      path.join(directory, "input.json"),
      JSON.stringify(input, null, 2),
    );
    begin = Date.now();
    const request = await actor.call("/print-requests", "POST", input);
    requestId = request.id;
    const finalizeStart = Date.now();
    const issuance = await actor.call(
      `/print-requests/${request.id}/finalize`,
      "POST",
      { expectedRevision: request.revision },
      token,
    );
    const finalizeEnd = Date.now();
    let jobs = [];
    for (;;) {
      jobs = (await actor.call(`/jobs?requestId=${request.id}`)).items;
      assert.equal(
        jobs.length,
        count * 2 + 2,
        "Finalization must create its entire durable job plan transactionally",
      );
      const now = Date.now();
      for (const job of jobs) {
        const old = observed.get(job.id) || {
          id: job.id,
          kind: job.kind,
          createdAt: job.createdAt,
          firstSeenMs: now - begin,
        };
        if (job.status === "PENDING" || job.status === "RETRY")
          old.lastWaitingMs = now - begin;
        if (job.status === "RUNNING" && old.firstRunningMs === undefined)
          old.firstRunningMs = now - begin;
        if (job.status === "SUCCEEDED" && old.firstSucceededMs === undefined)
          old.firstSucceededMs = now - begin;
        old.status = job.status;
        old.attempts = job.attempts;
        old.errorCode = job.errorCode;
        old.maximumAttemptsObserved = Math.max(
          old.maximumAttemptsObserved || 0,
          job.attempts,
        );
        if (job.errorCode)
          old.observedErrorCodes = [
            ...new Set([...(old.observedErrorCodes || []), job.errorCode]),
          ];
        observed.set(job.id, old);
      }
      assert.ok(
        !jobs.some((j) => j.status === "FAILED"),
        `Terminal worker failure in ${request.id}`,
      );
      if (
        jobs.length === count * 2 + 2 &&
        jobs.every((j) => j.status === "SUCCEEDED")
      )
        break;
      assert.ok(
        now - begin < 1800000,
        "30-minute engineering timeout exceeded",
      );
      await delay(1000);
    }
    const ready = Date.now();
    const detail = await actor.call(`/print-requests/${request.id}`);
    assert.equal(detail.documents.length, count);
    assert.equal(new Set(detail.documents.map((d) => d.number)).size, count);
    assert.deepEqual(
      detail.items.map((item) => item.fullNameRu),
      input.items.map((item) => item.fullNameRu),
    );
    const artifacts = [];
    for (const job of jobs) {
      assert.ok(job.artifact);
      const response = await fetch(base + `/artifacts/${job.artifact.id}`, {
        headers: { cookie: actor.cookie },
        signal: AbortSignal.timeout(180000),
      });
      assert.equal(response.status, 200);
      const bytes = Buffer.from(await response.arrayBuffer());
      assert.equal(digest(bytes), job.artifact.sha256);
      assert.equal(bytes.length, job.artifact.size);
      const file = `${job.id}.${job.kind.toLowerCase()}`;
      await fs.writeFile(path.join(directory, file), bytes);
      artifacts.push({
        id: job.artifact.id,
        format: job.kind,
        file,
        bytes: bytes.length,
        sha256: digest(bytes),
      });
    }
    const done = Date.now();
    const formatReadyMs = Object.fromEntries(
      ["DOCX", "PDF", "XLSX", "ZIP"].map((format) => [
        format,
        Math.max(
          ...[...observed.values()]
            .filter((job) => job.kind === format)
            .map((job) => job.firstSucceededMs),
        ),
      ]),
    );
    const result = {
      label,
      count,
      repetition,
      requestId: request.id,
      issuance,
      tenantId: actor.tenantId,
      operatorUserId: actor.userId,
      createMs: finalizeStart - begin,
      finalizeMs: finalizeEnd - finalizeStart,
      readyMs: ready - begin,
      formatReadyMs,
      allDownloadsMs: done - ready,
      totalMs: done - begin,
      success: true,
      retriedJobs: jobs.filter((job) => job.attempts > 1).length,
      withinEngineeringAssumptions:
        finalizeEnd - finalizeStart <= environment.thresholds.finalizeMs &&
        ready - begin <= environment.thresholds.issuanceTimeoutMs &&
        jobs.every((job) => job.attempts === 1),
      artifactBytes: artifacts.reduce((n, a) => n + a.bytes, 0),
      jobs: [...observed.values()],
      artifacts,
      documents: detail.documents,
    };
    await fs.writeFile(
      path.join(directory, "result.json"),
      JSON.stringify(result, null, 2),
    );
    results.push({
      label,
      count,
      repetition,
      requestId: request.id,
      operatorUserId: actor.userId,
      totalMs: result.totalMs,
      finalizeMs: result.finalizeMs,
      readyMs: result.readyMs,
      formatReadyMs,
      artifactBytes: result.artifactBytes,
      artifacts: artifacts.length,
      success: true,
      retriedJobs: result.retriedJobs,
      withinEngineeringAssumptions: result.withinEngineeringAssumptions,
    });
    await persistResults();
    console.log(JSON.stringify(results.at(-1)));
    if (!result.withinEngineeringAssumptions) process.exitCode = 1;
  } catch (error) {
    const failure = {
      label,
      count,
      repetition,
      requestId,
      operatorUserId: actor.userId,
      totalMs: Date.now() - begin,
      success: false,
      error: error instanceof Error ? error.message : String(error),
      jobs: [...observed.values()],
    };
    await fs.writeFile(
      path.join(directory, "failure.json"),
      JSON.stringify(failure, null, 2),
    );
    results.push(failure);
    await persistResults();
    throw error;
  }
}
for (let repetition = 1; repetition <= repeats; repetition++)
  for (const count of sizes) await run(count, repetition);
if (secondOperator) {
  const concurrent = await Promise.allSettled([
    run(10, 1, operator, "concurrent-a"),
    run(10, 1, secondOperator, "concurrent-b"),
  ]);
  assert.ok(
    concurrent.every((result) => result.status === "fulfilled"),
    "At least one concurrent operator failed; see per-run failure.json",
  );
}
