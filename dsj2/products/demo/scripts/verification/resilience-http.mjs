import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

// Explicitly bounded to the disposable commercial acceptance project.
assert.equal(process.env.DEMO_RESILIENCE_SYNTHETIC, "1");
const project = "demo-commercial-release";
const names = ["db", "api", "worker", "web", "ingress"].map(
  (s) => `${project}-${s}-1`,
);
const base = "http://localhost:8080/api";
const origin = "http://localhost:8080";
const output = path.resolve("docs/evidence/commercial-acceptance/resilience");
await fs.mkdir(output, { recursive: true });
const env = Object.fromEntries(
  (await fs.readFile(".runtime/commercial-container.env", "utf8"))
    .split(/\r?\n/)
    .filter((s) => /^[^#=]+=/.test(s))
    .map((s) => {
      const i = s.indexOf("=");
      return [s.slice(0, i), s.slice(i + 1).replace(/^"|"$/g, "")];
    }),
);
assert.ok(env.DEMO_ADMIN_EMAIL && env.DEMO_ADMIN_PASSWORD);
const redact = (value) =>
  String(value)
    .replaceAll(env.DEMO_ADMIN_PASSWORD, "[REDACTED]")
    .replaceAll(env.DEMO_DB_PASSWORD, "[REDACTED]")
    .replace(/postgres(?:ql)?:\/\/[^\s"']+/g, "[REDACTED_DATABASE_URL]")
    .replace(
      /(cookie|authorization|password|csrfToken|sessionToken)\s*[=:]\s*[^,\n]+/gi,
      "$1=[REDACTED]",
    );
const digest = (b) => createHash("sha256").update(b).digest("hex");
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const exec = promisify(execFile);
const log = [];
const result = {
  status: "RUNNING",
  startedAt: new Date().toISOString(),
  project,
  origin,
  containers: names,
  syntheticOnly: true,
  limitations: [
    "A five-container restart is not a host reboot or power-loss test.",
    "No production tenant, Docker Desktop engine, localhost3200/3100/4100 or Windows PostgreSQL55432 was changed.",
  ],
};
async function persist() {
  await fs.writeFile(
    path.join(output, "result.json"),
    JSON.stringify({ ...result, events: log }, null, 2),
  );
}
async function event(type, detail = {}) {
  log.push({ at: new Date().toISOString(), type, ...detail });
  await persist();
  console.log(JSON.stringify({ type, ...detail }));
}
async function docker(...args) {
  const r = await exec(
    "wsl.exe",
    [
      "-d",
      "Ubuntu-24.04",
      "-u",
      "root",
      "--exec",
      "/home/admin/demo-commercial-runtime/docker/docker",
      "--config",
      "/home/admin/demo-commercial-runtime",
      "-H",
      "unix:///home/admin/demo-commercial-runtime/docker.sock",
      ...args,
    ],
    { timeout: 180000, maxBuffer: 2 * 1024 * 1024 },
  );
  return r.stdout.trim();
}
async function inspect() {
  const rows = JSON.parse(await docker("inspect", ...names));
  assert.equal(rows.length, 5);
  return rows.map((r) => {
    assert.equal(r.Config.Labels["com.docker.compose.project"], project);
    assert.ok(names.includes(r.Name.slice(1)));
    return {
      name: r.Name.slice(1),
      id: r.Id,
      image: r.Image,
      running: r.State.Running,
      startedAt: r.State.StartedAt,
      restartCount: r.RestartCount,
    };
  });
}
async function session() {
  const r = await fetch(base + "/auth/login", {
    method: "POST",
    headers: { origin, "content-type": "application/json" },
    body: JSON.stringify({
      email: env.DEMO_ADMIN_EMAIL,
      password: env.DEMO_ADMIN_PASSWORD,
    }),
    signal: AbortSignal.timeout(15000),
  });
  const data = await r.json();
  assert.equal(r.status, 201, redact(JSON.stringify(data)));
  const cookie = r.headers
    .getSetCookie()
    .map((s) => s.split(";")[0])
    .join("; ");
  const headers = {
    origin,
    cookie,
    "content-type": "application/json",
    "x-csrf-token": data.csrfToken,
  };
  return {
    async raw(route, method = "GET", body, key) {
      return fetch(base + route, {
        method,
        headers: { ...headers, ...(key ? { "idempotency-key": key } : {}) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(20000),
      });
    },
    async call(route, method = "GET", body, key) {
      const r = await this.raw(route, method, body, key);
      const data = await r.json();
      assert.ok(r.ok, `${route}: ${r.status} ${redact(JSON.stringify(data))}`);
      return data;
    },
  };
}
async function waitReady(actor, timeoutMs = 180000) {
  const begin = Date.now();
  while (Date.now() - begin < timeoutMs) {
    try {
      const r = await actor.raw("/ready");
      if (r.ok) return await r.json();
    } catch {
      /* expected reconnect interval */
    }
    await sleep(1000);
  }
  throw new Error("READINESS_RECOVERY_TIMEOUT");
}
async function download(actor, artifact) {
  const r = await actor.raw(`/artifacts/${artifact.id}`);
  assert.equal(r.status, 200);
  const bytes = Buffer.from(await r.arrayBuffer());
  const hash = digest(bytes);
  assert.equal(hash, artifact.sha256);
  return {
    id: artifact.id,
    sha256: hash,
    bytes: bytes.length,
    format: artifact.format || artifact.kind,
  };
}
let dbStopped = false;
try {
  result.beforeContainers = await inspect();
  assert.ok(result.beforeContainers.every((r) => r.running));
  const actor = await session();
  const context = await actor.call("/context");
  assert.equal(context.tenant.demoOnly, true, "Refuses a production tenant");
  result.tenantId = context.tenant.id;
  const ready = await waitReady(actor);
  await event("preflight_ready", { status: ready.status });
  const prior = await actor.call(
    "/print-requests/46f15190-eb04-4dc9-a7dd-81fc619390a8",
  );
  const canonical = prior.artifacts.filter((a) => a.provenance === "ORIGINAL");
  assert.equal(canonical.length, 4);
  result.priorCanonicalBefore = await Promise.all(
    canonical.map((a) => download(actor, a)),
  );
  const token = randomUUID();
  const customer = await actor.call("/customers", "POST", {
    nameRu: "ТЕСТ устойчивости контейнера",
    nameKz: "Контейнер тұрақтылығы сынағы",
    bin: "000000000000",
  });
  const request = await actor.call("/print-requests", "POST", {
    kind: "COMPANY",
    customerId: customer.id,
    title: `ТЕСТ DB stop/restart ${token}`,
    demoMode: true,
    items: Array.from({ length: 4 }, (_, n) => ({
      id: randomUUID(),
      fullNameRu: `Синтетический Получатель ${n + 1}`,
      fullNameKz: `Сынақ Әли ${n + 1}`,
      positionRu: "Инженер",
      positionKz: "Инженер",
      workplaceRu: "Тестовая организация",
      workplaceKz: "Сынақ ұйымы",
      assignments: [
        {
          id: randomUUID(),
          templateId: "biot-protocol",
          documentDate: "2026-09-22",
          protocolDate: "2026-09-22",
          trainingSubject: "ТЕСТ устойчивости",
          result: "ТЕСТ: сдал",
        },
      ],
    })),
  });
  result.requestId = request.id;
  await actor.call(
    `/print-requests/${request.id}/finalize`,
    "POST",
    { expectedRevision: request.revision },
    token,
  );
  const finalized = await actor.call(`/print-requests/${request.id}`);
  const documentIdentity = (value) =>
    value.documents
      .map((d) => ({ id: d.id, number: d.number }))
      .sort((a, b) => a.id.localeCompare(b.id));
  result.documentNumbers = documentIdentity(finalized);
  assert.equal(result.documentNumbers.length, 4);
  const begin = Date.now();
  let pending;
  for (;;) {
    pending = (await actor.call(`/jobs?requestId=${request.id}`)).items;
    assert.equal(pending.length, 10);
    if (
      pending.some((j) => j.status === "RUNNING") &&
      pending.some((j) => j.status === "SUCCEEDED")
    )
      break;
    assert.ok(
      Date.now() - begin < 90000,
      "Could not observe actual mixed RUNNING/SUCCEEDED state",
    );
    await sleep(250);
  }
  result.jobsBeforeStop = pending.map(
    ({ id, kind, status, attempts, artifact }) => ({
      id,
      kind,
      status,
      attempts,
      artifactId: artifact?.id,
      artifactSha256: artifact?.sha256,
    }),
  );
  result.completedBeforeStop = await Promise.all(
    pending
      .filter((j) => j.status === "SUCCEEDED")
      .map((j) => download(actor, j.artifact)),
  );
  await event("observed_jobs_before_actual_db_stop", {
    jobs: result.jobsBeforeStop,
  });
  dbStopped = true;
  await docker("stop", "--time", "0", names[0]);
  result.dbStoppedAt = new Date().toISOString();
  assert.equal(
    (await inspect()).find((c) => c.name === names[0]).running,
    false,
  );
  await event("database_stopped", {
    container: names[0],
    stopTimeoutSeconds: 0,
  });
  result.unavailableResponses = [];
  for (const [route, method, body] of [
    ["/ready", "GET"],
    [`/jobs?requestId=${request.id}`, "GET"],
    [
      `/print-requests/${request.id}/finalize`,
      "POST",
      { expectedRevision: request.revision },
    ],
  ]) {
    try {
      const r = await actor.raw(route, method, body, token);
      const detail = {
        route,
        method,
        status: r.status,
        body: redact(await r.text()),
      };
      result.unavailableResponses.push(detail);
      assert.ok(
        r.status >= 500,
        `Database unavailable response must not claim readiness/success: ${JSON.stringify(detail)}`,
      );
    } catch (error) {
      if (error.name !== "TimeoutError") throw error;
      result.unavailableResponses.push({
        route,
        method,
        status: "TRANSPORT_TIMEOUT",
        body: "Client observed 20s timeout while database stopped; no success response.",
      });
    }
    await persist();
  }
  await sleep(12000);
  await docker("start", names[0]);
  dbStopped = false;
  result.dbStartedAt = new Date().toISOString();
  await event("database_started", { container: names[0] });
  await waitReady(actor);
  const recoveryStart = Date.now();
  for (;;) {
    const jobs = (await actor.call(`/jobs?requestId=${request.id}`)).items;
    const state = jobs.map(({ id, kind, status, attempts, errorCode }) => ({
      id,
      kind,
      status,
      attempts,
      errorCode,
    }));
    if (
      JSON.stringify(state) !==
      JSON.stringify(result.recoveryStates?.at(-1)?.jobs)
    ) {
      (result.recoveryStates ||= []).push({
        at: new Date().toISOString(),
        jobs: state,
      });
      await persist();
    }
    assert.ok(
      !jobs.some((j) => j.status === "FAILED"),
      "Automatic recovery produced a terminal failed job",
    );
    if (jobs.every((j) => j.status === "SUCCEEDED")) {
      result.jobsAfterRecovery = state;
      break;
    }
    assert.ok(
      Date.now() - recoveryStart < 180000,
      "Automatic job recovery exceeded3minutes",
    );
    await sleep(1000);
  }
  const after = await actor.call(`/print-requests/${request.id}`);
  assert.equal(after.issuances.length, 1);
  assert.deepEqual(documentIdentity(after), result.documentNumbers);
  result.recoveredArtifacts = await Promise.all(
    after.artifacts.map((a) => download(actor, a)),
  );
  assert.equal(result.recoveredArtifacts.length, 10);
  for (const item of result.completedBeforeStop)
    assert.ok(
      result.recoveredArtifacts.some(
        (a) => a.id === item.id && a.sha256 === item.sha256,
      ),
    );
  result.priorCanonicalAfterDbRecovery = await Promise.all(
    canonical.map((a) => download(actor, a)),
  );
  assert.deepEqual(
    result.priorCanonicalAfterDbRecovery,
    result.priorCanonicalBefore,
  );
  await event("jobs_recovered_automatically", {
    count: 10,
    issuanceCount: after.issuances.length,
    unchangedNumbers: true,
    manualRetryUsed: false,
  });
  await docker("restart", "--time", "10", ...names);
  await event("five_project_containers_restarted", { containers: names });
  await waitReady(actor);
  const fresh = await session();
  const restored = await fresh.call(`/print-requests/${request.id}`);
  assert.equal(restored.issuances.length, 1);
  assert.deepEqual(documentIdentity(restored), result.documentNumbers);
  result.priorCanonicalAfterRestart = await Promise.all(
    canonical.map((a) => download(fresh, a)),
  );
  assert.deepEqual(
    result.priorCanonicalAfterRestart,
    result.priorCanonicalBefore,
  );
  result.recoveredArtifactsAfterRestart = await Promise.all(
    restored.artifacts.map((a) => download(fresh, a)),
  );
  assert.deepEqual(
    result.recoveredArtifactsAfterRestart,
    result.recoveredArtifacts,
  );
  result.afterContainers = await inspect();
  assert.ok(result.afterContainers.every((r) => r.running));
  for (const c of result.afterContainers)
    assert.notEqual(
      c.startedAt,
      result.beforeContainers.find((b) => b.name === c.name).startedAt,
    );
  result.status = "PASS";
  result.completedAt = new Date().toISOString();
  await event("drill_pass", {
    verifiedArtifactsAfterFreshAuthentication: 14,
    unchangedNumbers: true,
    issuanceCount: 1,
  });
} catch (error) {
  result.status = "FAIL";
  result.error = redact(error.stack || error);
  await persist();
  // Keep the failure exit code without printing an unredacted nested cause.
  process.exitCode = 1;
} finally {
  if (dbStopped) {
    await docker("start", names[0]);
    await event("finally_database_restored");
  }
  await persist();
}
