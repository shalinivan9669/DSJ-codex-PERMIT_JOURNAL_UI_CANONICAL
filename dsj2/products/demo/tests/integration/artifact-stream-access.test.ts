import test from "node:test";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { bootstrap } from "../../apps/api/src/main";
import { db, type Context } from "../../apps/api/src/core";
import { draftSchema } from "../../packages/contracts/src";
import { provision } from "../../scripts/setup";
import { createRequest, finalize } from "../../apps/api/src/requests";
import { readArtifact, store } from "../../apps/api/src/files";
import { openArtifact } from "../../apps/api/src/storage";
import { signingState } from "../../apps/api/src/signing";
import { claimJob, executeJob, heartbeat, settleFailure, DeferredJob } from "../../apps/render-worker/src/queue";
import { createApprovalFixture } from "./live-approval-fixture";
import { assertTestDatabase } from "./test-database";

const sha256 = (value: Buffer) => createHash("sha256").update(value).digest("hex");
const code = (expected: string) => (error: unknown) => {
  assert.equal((error as { getResponse(): { code: string } }).getResponse().code, expected);
  return true;
};

test("actual HTTP streaming preserves unsigned bundle guards, individual bytes/headers and tenant isolation", async () => {
  assertTestDatabase();
  const oldPort = process.env.PORT, oldOrigin = process.env.DEMO_ORIGIN;
  process.env.PORT = "0";
  process.env.DEMO_ORIGIN = "http://localhost:3119";
  const suffix = randomUUID(), password = `Synthetic-stream-${suffix}!`;
  const a = await provision({ email: `stream-a-${suffix}@example.test`, password, name: "Синтетическая проверка потоковой выдачи A", sample: true });
  const b = await provision({ email: `stream-b-${suffix}@example.test`, password, name: "Синтетическая проверка потоковой выдачи B", sample: true });
  const c: Context = { tenantId: a.tenantId, userId: a.userId, role: "ADMIN", sessionId: "synthetic-fixture", csrfHash: "synthetic-fixture", correlationId: randomUUID() };
  const approvals = await createApprovalFixture(c);
  let app: Awaited<ReturnType<typeof bootstrap>> | undefined;
  try {
    const request = await createRequest(c, draftSchema.parse({
      kind: "PERSON", demoMode: true, schemaVersion: 2,
      title: "СИНТЕТИЧЕСКАЯ проверка потоковой авторизации",
      items: [{
        id: randomUUID(), employeeCategory: "WORKER",
        fullNameRu: "Тестовый Получатель", fullNameKz: "Сынақ Алушы",
        positionRu: "Слесарь", workplaceRu: "Тест Альфа", workplaceKz: "Тест Альфа",
        assignments: [{
          id: randomUUID(), templateId: "pb-card", protocolMode: "INDIVIDUAL",
          documentDate: "2026-10-03", protocolDate: "2026-10-02", trainingStart: "2026-10-01", trainingEnd: "2026-10-02",
          trainingSubject: "Синтетическая программа ПБ", hours: "40", result: "Сдал",
          outcome: { status: "PASSED", source: "СИНТЕТИЧЕСКАЯ известная ведомость; не реальное обучение" },
        }],
      }],
    }));
    await approvals.approve(request.id);
    const issued = await finalize(c, request.id, { expectedRevision: request.revision }, randomUUID());
    const owner = `stream-test-${suffix}`;
    for (let attempts = 0; ; attempts++) {
      assert.ok(attempts < 40, "Scoped ordinary worker must complete its actual six jobs");
      const remaining = await db.generationJob.count({ where: { tenantId: a.tenantId, requestId: request.id, status: { not: "SUCCEEDED" } } });
      if (!remaining) break;
      const job = await claimJob(db, owner, a.tenantId);
      if (!job) { await new Promise((done) => setTimeout(done, 250)); continue; }
      assert.equal(job.requestId, request.id);
      const beat = setInterval(() => { void heartbeat(db, job, owner); }, 5000);
      try { await executeJob(db, store, job, owner, AbortSignal.timeout(210000)); }
      catch (error) { await settleFailure(db, job, owner, error); if (!(error instanceof DeferredJob)) throw error; }
      finally { clearInterval(beat); }
    }
    const lifecycle = await signingState(approvals.directorContext, request.id);
    assert.equal(lifecycle.status, "AWAITING_SIGNATURE");
    assert.ok(lifecycle.documents.every((document) => document.requiredSigners.length > 0 && document.requiredSigners.every((signer) => !signer.signed)));
    app = await bootstrap();
    const base = await app.getUrl();
    const login = async (email: string) => {
      const response = await fetch(`${base}/auth/login`, { method: "POST", headers: { origin: process.env.DEMO_ORIGIN!, "content-type": "application/json" }, body: JSON.stringify({ email, password }) });
      assert.equal(response.status, 201);
      await response.json();
      return { cookie: response.headers.getSetCookie().map((value) => value.split(";")[0]).join("; ") };
    };
    const authorized = await login(a.email), foreign = await login(b.email);
    const artifacts = await db.artifact.findMany({ where: { tenantId: a.tenantId, requestId: request.id, issuanceId: issued.issuanceId } });
    assert.equal(artifacts.length, 6);
    const readbacks: unknown[] = [];
    for (const artifact of artifacts) {
      const denied = await fetch(`${base}/artifacts/${artifact.id}`, { headers: foreign });
      assert.equal(denied.status, 404);
      assert.equal((await denied.json() as { code: string }).code, "NOT_FOUND");
      if (["ZIP", "XLSX"].includes(artifact.format)) {
        await assert.rejects(readArtifact(c, artifact.id), code("ISSUANCE_NOT_COMPLETE"));
        await assert.rejects(openArtifact(c, artifact.id), code("ISSUANCE_NOT_COMPLETE"));
        const response = await fetch(`${base}/artifacts/${artifact.id}`, { headers: authorized });
        assert.equal(response.status, 409);
        assert.equal((await response.json() as { code: string }).code, "ISSUANCE_NOT_COMPLETE");
        assert.equal(response.headers.get("x-content-sha256"), null);
        assert.equal(response.headers.get("content-disposition"), null);
        readbacks.push({ artifactId: artifact.id, format: artifact.format, issuanceId: artifact.issuanceId, httpStatus: 409, code: "ISSUANCE_NOT_COMPLETE", bufferedAndStreamingPolicyMatch: true, foreignTenantStatus: 404 });
      } else {
        const expected = (await readArtifact(c, artifact.id)).buffer;
        const response = await fetch(`${base}/artifacts/${artifact.id}`, { headers: authorized });
        assert.equal(response.status, 200);
        const bytes = Buffer.from(await response.arrayBuffer());
        assert.deepEqual(bytes, expected);
        assert.equal(sha256(bytes), artifact.sha256);
        assert.equal(Number(response.headers.get("content-length")), artifact.size);
        assert.equal(response.headers.get("x-content-sha256"), artifact.sha256);
        assert.equal(response.headers.get("content-type"), artifact.mimeType);
        assert.match(response.headers.get("content-disposition") || "", /^attachment; filename=/);
        if (artifact.format === "PDF") {
          const inline = await fetch(`${base}/artifacts/${artifact.id}?inline=1`, { headers: authorized });
          assert.equal(inline.status, 200);
          assert.match(inline.headers.get("content-disposition") || "", /^inline; filename=/);
          assert.equal(sha256(Buffer.from(await inline.arrayBuffer())), artifact.sha256);
        }
        readbacks.push({ artifactId: artifact.id, format: artifact.format, httpStatus: 200, bytes: bytes.length, sha256: artifact.sha256, exactSavedBytesAndStreamHeaders: true, foreignTenantStatus: 404 });
      }
    }
    const workflow = await db.issuanceWorkflow.findFirstOrThrow({ where: { tenantId: a.tenantId, requestId: request.id } });
    assert.equal(workflow.status, "AWAITING_SIGNATURE");
    assert.equal(workflow.completedAt, null);
    assert.equal(await db.documentSignature.count({ where: { tenantId: a.tenantId, issuanceId: issued.issuanceId } }), 0);
    const folder = resolve("docs/evidence/operator-flow-full-fix-20261003/domain");
    await mkdir(folder, { recursive: true });
    await writeFile(resolve(folder, "artifact-stream-http-regression.json"), JSON.stringify({ status: "PASS", requestId: request.id, issuanceId: issued.issuanceId, tenantId: a.tenantId, realDirectorApproved: true, actualJobs: 6, actualArtifacts: 6, workflowStatus: workflow.status, signatures: 0, completedAt: null, authPolicyUnchanged: true, signingPolicyUnchanged: true, legalSigningApproval: false, readbacks }, null, 2));
  } finally {
    await app?.close();
    await approvals.close();
    if (oldPort === undefined) delete process.env.PORT; else process.env.PORT = oldPort;
    if (oldOrigin === undefined) delete process.env.DEMO_ORIGIN; else process.env.DEMO_ORIGIN = oldOrigin;
    await db.$disconnect();
  }
});
