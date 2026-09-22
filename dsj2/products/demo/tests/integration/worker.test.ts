import { assertTestDatabase } from "./test-database";
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  PrismaClient,
  Prisma,
  type GenerationJob,
} from "../../packages/database/src";
import {
  ArtifactStore,
  PRODUCT_ROOT,
  runRender,
  templateManifest,
} from "../../packages/printing/src";
import {
  claimJob,
  heartbeat,
  executeJob,
  expireExhausted,
  settleFailure,
  LostLease,
} from "../../apps/render-worker/src/queue";
import { collectOrphanObjects } from "../../scripts/maintenance/gc";

const db = new PrismaClient();
let tenantId: string,
  requestId: string,
  profileId: string,
  userId: string,
  store: ArtifactStore;
before(async () => {
  assert.ok(
    process.env.DATABASE_URL,
    "A migrated disposable PostgreSQL DATABASE_URL is required.",
  );
  assertTestDatabase();
  await db.$connect();
  const root = await mkdtemp(join(tmpdir(), "demo-worker-test-"));
  store = new ArtifactStore(root);
  process.env.DEMO_ARTIFACT_ROOT = root;
  const tenant = await db.tenant.create({
    data: { name: "Synthetic worker tests " + randomUUID() },
  });
  tenantId = tenant.id;
  const user = await db.user.create({
    data: {
      tenantId,
      email: randomUUID() + "@example.invalid",
      displayName: "Test",
      passwordHash: "not-a-login",
      role: "ADMIN",
    },
  });
  userId = user.id;
  const profile = await db.issuerProfileVersion.create({
    data: {
      tenantId,
      version: 1,
      profile: { nameRu: "Тест" },
      createdBy: user.id,
    },
  });
  profileId = profile.id;
  const request = await db.printRequest.create({
    data: {
      tenantId,
      createdBy: userId,
      kind: "PERSON",
      draft: {},
      demoMode: true,
    },
  });
  requestId = request.id;
});
after(async () => {
  await db.$disconnect();
});
async function job(
  kind = "XLSX",
  input: Record<string, unknown> = {
    items: [{ fullNameRu: "=1+1", fullNameKz: "Әділбек" }],
  },
) {
  const snapshot = await db.renderInputSnapshot.create({
    data: {
      tenantId,
      requestId,
      revision: 0,
      profileVersionId: profileId,
      input: input as Prisma.InputJsonValue,
      inputHash: "test",
    },
  });
  return db.generationJob.create({
    data: {
      tenantId,
      requestId,
      snapshotId: snapshot.id,
      kind,
      logicalKey: randomUUID(),
    },
  });
}
async function claimOwn(
  owner: string,
  expectedId?: string,
): Promise<GenerationJob> {
  const claimed = await claimJob(db, owner, tenantId);
  assert.ok(claimed);
  if (expectedId) assert.equal(claimed.id, expectedId);
  return claimed;
}
test("20 concurrent durable claims are unique; heartbeat refuses stale fence", async () => {
  const created = await Promise.all(Array.from({ length: 20 }, () => job()));
  const claims = await Promise.all(
    Array.from({ length: 20 }, (_, i) => claimJob(db, "race-" + i, tenantId)),
  );
  assert.equal(new Set(claims.map((j) => j!.id)).size, 20);
  assert.ok(claims.every((j) => j?.status === "RUNNING"));
  assert.ok(await heartbeat(db, claims[0]!, "race-0"));
  assert.equal(
    await heartbeat(db, { ...claims[0]!, fencingToken: 0 }, "race-0"),
    false,
  );
  await db.generationJob.updateMany({
    where: { id: { in: created.map((j) => j.id) } },
    data: {
      status: "FAILED",
      errorCode: "TEST_COMPLETE",
      leaseOwner: null,
      leaseUntil: null,
    },
  });
});
test("expired owner cannot publish; new fence publishes original bytes once", async () => {
  const created = await job();
  const stale = await claimOwn("stale", created.id);
  await db.generationJob.update({
    where: { id: created.id },
    data: { leaseUntil: new Date(0) },
  });
  const current = await claimOwn("current", created.id);
  assert.equal(current.fencingToken, stale.fencingToken + 1);
  await assert.rejects(
    () => executeJob(db, store, stale, "stale", new AbortController().signal),
    LostLease,
  );
  const artifact = await executeJob(
    db,
    store,
    current,
    "current",
    new AbortController().signal,
  );
  assert.ok(artifact.size > 1000);
  const first = await store.read(artifact.storageKey, artifact.sha256);
  const second = await store.read(artifact.storageKey, artifact.sha256);
  assert.deepEqual(first, second);
  await assert.rejects(
    () =>
      executeJob(db, store, current, "current", new AbortController().signal),
    LostLease,
  );
  assert.equal(await db.artifact.count({ where: { jobId: created.id } }), 1);
});
test("crash after final attempt becomes FAILED; retries use same snapshot", async () => {
  const created = await job();
  await db.generationJob.update({
    where: { id: created.id },
    data: {
      status: "RUNNING",
      attempts: 3,
      maxAttempts: 3,
      leaseUntil: new Date(0),
    },
  });
  assert.ok(await expireExhausted(db));
  assert.equal(
    (await db.generationJob.findUniqueOrThrow({ where: { id: created.id } }))
      .status,
    "FAILED",
  );
  const another = await job();
  const owned = await claimOwn("retry", another.id);
  await settleFailure(db, owned, "retry", new Error("RENDER_TIMEOUT"));
  const state = await db.generationJob.findUniqueOrThrow({
    where: { id: another.id },
  });
  assert.equal(state.status, "RETRY");
  assert.equal(state.snapshotId, another.snapshotId);
  assert.equal(state.errorCode, "RENDER_TIMEOUT");
  await db.generationJob.update({
    where: { id: another.id },
    data: { status: "FAILED" },
  });
});
test("PDF waits for persisted DOCX and never consumes a retry while waiting", async () => {
  const created = await job("PDF");
  const source = await db.generationJob.create({
    data: {
      tenantId,
      requestId,
      snapshotId: created.snapshotId,
      kind: "DOCX",
      logicalKey: randomUUID(),
      runAfter: new Date(Date.now() + 300000),
    },
  });
  const owned = await claimOwn("pdf", created.id);
  try {
    await executeJob(db, store, owned, "pdf", new AbortController().signal);
    assert.fail("must defer");
  } catch (error) {
    await settleFailure(db, owned, "pdf", error);
  }
  const state = await db.generationJob.findUniqueOrThrow({
    where: { id: created.id },
  });
  assert.equal(state.status, "PENDING");
  assert.equal(state.attempts, 0);
  await db.generationJob.update({
    where: { id: created.id },
    data: { status: "FAILED" },
  });
  await db.generationJob.update({
    where: { id: source.id },
    data: { status: "FAILED" },
  });
});
test("storage rejects traversal and detects corrupted persisted bytes", async () => {
  assert.throws(() => store.path("../secret"));
  const asset = await store.put(Buffer.from("immutable bytes"), "txt");
  assert.equal(
    (await store.read(asset.storageKey, asset.sha256)).toString(),
    "immutable bytes",
  );
  await assert.rejects(
    () => store.read(asset.storageKey, "bad-hash"),
    /HASH_MISMATCH/,
  );
  const other = await store.put(Buffer.from("immutable bytes"), "txt");
  assert.notEqual(other.storageKey, asset.storageKey);
  assert.equal(other.sha256, asset.sha256);
});
test("bounded child execution terminates and returns no artifact on abort/timeout", async () => {
  const template = (await templateManifest()).templates.find(
    (entry) => entry.id === "biot-worker-card",
  )!;
  const bytes = await readFile(
    join(PRODUCT_ROOT, "assets/templates", String(template.file)),
  );
  await assert.rejects(
    () =>
      runRender(
        "pdf",
        {},
        { inputBytes: bytes, inputExtension: "docx", timeoutMs: 1 },
      ),
    /RENDER_TIMEOUT/,
  );
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    () => runRender("xlsx", { items: [] }, { signal: controller.signal }),
    /RENDER_ABORTED/,
  );
});
test("reconstruction records honest provenance without overwriting original bytes", async () => {
  const original = await job();
  const owner = await claimOwn("original", original.id);
  const first = await executeJob(
    db,
    store,
    owner,
    "original",
    new AbortController().signal,
  );
  const recovered = await job("XLSX", {
    items: [{ fullNameRu: "Тест" }],
    provenance: "RECONSTRUCTED",
    restoreOfArtifactId: first.id,
    originalSha256: first.sha256,
  });
  const current = await claimOwn("restore", recovered.id);
  const second = await executeJob(
    db,
    store,
    current,
    "restore",
    new AbortController().signal,
  );
  assert.equal(second.provenance, "RECONSTRUCTED");
  assert.notEqual(second.storageKey, first.storageKey);
  assert.ok(await store.read(first.storageKey, first.sha256));
  const audit = await db.auditEvent.findFirstOrThrow({
    where: { entityId: second.id, action: "artifact.created" },
  });
  assert.equal(
    (audit.metadata as Record<string, unknown>).restoreOfArtifactId,
    first.id,
  );
});
test("GC protects active leases, canonical artifacts, immutable templates and backup-pinned bytes", async () => {
  const orphan = await store.put(
    Buffer.from("crash after upload before database commit"),
    "txt",
  );
  const pinned = await store.put(
    Buffer.from("referenced by retained backup"),
    "txt",
  );
  const template = await store.put(
    Buffer.from("immutable template fixture"),
    "docx",
  );
  await db.templateVersion.create({
    data: {
      tenantId,
      templateId: "gc-fixture",
      version: "1",
      checksum: template.sha256,
      storageKey: template.storageKey,
      contract: {},
    },
  });
  const backup = await mkdtemp(join(tmpdir(), "demo-gc-backup-"));
  await mkdir(
    join(
      backup,
      "files",
      pinned.storageKey.slice(0, pinned.storageKey.lastIndexOf("/")),
    ),
    { recursive: true },
  );
  const dump = Buffer.from("synthetic backup fixture");
  await writeFile(join(backup, "database.dump"), dump);
  await writeFile(
    join(backup, "files", pinned.storageKey),
    await store.read(pinned.storageKey),
  );
  await writeFile(
    join(backup, "manifest.json"),
    JSON.stringify({
      version: 2,
      product: "DEMO",
      files: { [pinned.storageKey]: pinned.sha256 },
      databaseSha256: createHash("sha256").update(dump).digest("hex"),
    }),
  );
  const now = new Date(Date.now() + 8 * 24 * 60 * 60 * 1000);
  const dry = await collectOrphanObjects(db, store, {
    now,
    backupDirectory: backup,
  });
  assert.equal(dry.deleted, 0);
  assert.ok(dry.candidates.some((a) => a.storageKey === orphan.storageKey));
  assert.equal(
    dry.candidates.some(
      (a) =>
        a.storageKey === pinned.storageKey ||
        a.storageKey === template.storageKey,
    ),
    false,
  );
  await assert.rejects(
    () => collectOrphanObjects(db, store, { apply: true, now }),
    /REQUIRES_VERIFIED_BACKUP/,
  );
  const created = await job();
  await claimOwn("gc-running", created.id);
  await assert.rejects(
    () =>
      collectOrphanObjects(db, store, {
        apply: true,
        now,
        backupDirectory: backup,
      }),
    /GC_ACTIVE_LEASES/,
  );
  await db.generationJob.update({
    where: { id: created.id },
    data: { status: "FAILED", leaseOwner: null, leaseUntil: null },
  });
  const applied = await collectOrphanObjects(db, store, {
    apply: true,
    now,
    backupDirectory: backup,
  });
  assert.ok(applied.deleted > 0);
  assert.equal(await store.exists(orphan.storageKey), false);
  assert.ok(await store.exists(pinned.storageKey));
  assert.ok(await store.exists(template.storageKey));
  for (const artifact of await db.artifact.findMany({ where: { tenantId } }))
    assert.ok(await store.read(artifact.storageKey, artifact.sha256));
});
test("worker timestamps stay UTC even on a non-UTC PostgreSQL connection", async () => {
  const url = new URL(process.env.DATABASE_URL!);
  url.searchParams.set("connection_limit", "1");
  const zoned = new PrismaClient({
    datasources: { db: { url: url.toString() } },
  });
  try {
    await zoned.$executeRawUnsafe("SET TIME ZONE 'Asia/Almaty'");
    const created = await job();
    const claimed = await claimJob(zoned, "timezone", tenantId);
    assert.equal(claimed?.id, created.id);
    const difference = claimed!.leaseUntil!.getTime() - Date.now();
    assert.ok(
      difference > 20000 && difference <= 31000,
      `Lease offset ${difference}ms`,
    );
    assert.ok(await heartbeat(zoned, claimed!, "timezone"));
    const artifact = await executeJob(
      zoned,
      store,
      claimed!,
      "timezone",
      new AbortController().signal,
    );
    assert.ok(await store.read(artifact.storageKey, artifact.sha256));
  } finally {
    await zoned.$disconnect();
  }
});
