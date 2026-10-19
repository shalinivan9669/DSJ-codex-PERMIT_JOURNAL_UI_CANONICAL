import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { chromium } from "@playwright/test";
import { PrismaClient } from "../../packages/database/src";
import { ArtifactStore, RENDERER_VERSION } from "../../packages/printing/src";

async function main() {
  const runtime = path.resolve(".runtime/mvp-all-roles-20261019/run-01");
  const output = path.resolve("docs/evidence/mvp-all-roles-20261019/run-01/local-installation");
  await mkdir(output, { recursive: true });
  const configuration = JSON.parse(await readFile(path.join(runtime, "user-installation-env.private.json"), "utf8"));
  const target = new URL(configuration.DATABASE_URL);
  assert.equal(target.hostname, "127.0.0.1"); assert.equal(target.port, "55432"); assert.equal(target.pathname, "/demo_test_browser_commercial_20260922");
  assert.equal(path.resolve(configuration.DEMO_ARTIFACT_ROOT), path.resolve(".runtime/commercial-browser/artifacts"));
  const db = new PrismaClient({ datasourceUrl: configuration.DATABASE_URL });
  const store = new ArtifactStore(configuration.DEMO_ARTIFACT_ROOT);
  try {
    const rows = await db.$transaction(async tx => {
      await tx.$executeRawUnsafe("SET TRANSACTION READ ONLY");
      return {
        counts: { users: await tx.user.count(), requests: await tx.printRequest.count(), issuances: await tx.issuance.count() },
        beats: await tx.workerHeartbeat.findMany({ where: { version: { in: [RENDERER_VERSION, "integration-local-v1"] } }, orderBy: { seenAt: "desc" }, distinct: ["version"] }),
        templates: await tx.templateVersion.findMany({ where: { templateId: { in: ["lms-protocol", "lms-certificate", "lms-credential"] }, version: "3" }, select: { id: true, templateId: true, version: true, approved: true, storageKey: true, checksum: true } }),
        samples: await Promise.all(["PDF", "DOCX"].map(format => tx.artifact.findFirst({ where: { format }, orderBy: { createdAt: "desc" }, select: { id: true, format: true, storageKey: true, sha256: true, size: true } }))),
        migrations: await tx.$queryRaw<{ migration_name: string; finished_at: Date | null }[]>`SELECT migration_name, finished_at FROM "_prisma_migrations" WHERE migration_name LIKE '20261019000%' ORDER BY migration_name`,
      };
    });
    assert.deepEqual(rows.counts, { users: 4, requests: 152, issuances: 17 });
    for (const version of [RENDERER_VERSION, "integration-local-v1"]) {
      const beat = rows.beats.find(x => x.version === version);
      assert.ok(beat && !beat.stoppedAt && !beat.lastError && Date.now() - beat.seenAt.getTime() < 90_000, `Worker heartbeat: ${version}`);
    }
    assert.equal(rows.templates.length, 3);
    for (const template of rows.templates) { assert.equal(template.approved, false); await store.read(template.storageKey, template.checksum); }
    const files = [];
    for (const row of rows.samples) {
      assert.ok(row, "Existing saved artifact required");
      const bytes = await store.read(row.storageKey, row.sha256); assert.equal(bytes.length, row.size);
      assert.equal(bytes.subarray(0, row.format === "PDF" ? 4 : 2).toString(), row.format === "PDF" ? "%PDF" : "PK");
      files.push({ id: row.id, format: row.format, sha256: row.sha256, bytes: bytes.length, storageVerified: true });
    }
    assert.equal(rows.migrations.length, 3); assert.ok(rows.migrations.every(x => x.finished_at));
    const health = await fetch("http://127.0.0.1:4200/health"); assert.equal(health.status, 200); const api = await health.json(); assert.equal(api.status, "ok");
    const browser = await chromium.launch({ channel: "chrome", headless: true });
    try {
      const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
      const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
      const response = await page.goto("http://localhost:3200/login"); assert.equal(response?.status(), 200);
      await page.getByLabel("Электронная почта", { exact: true }).waitFor(); await page.getByRole("button", { name: "Войти", exact: true }).waitFor();
      await page.screenshot({ path: path.join(output, "user-installation-login.png"), fullPage: true }); assert.deepEqual(errors, []);
    } finally { await browser.close(); }
    await writeFile(path.join(output, "SMOKE.json"), JSON.stringify({ status: "PASS", capturedAt: new Date().toISOString(), databaseReadOnly: true, database: target.pathname.slice(1), web: "http://localhost:3200", api: "http://127.0.0.1:4200", countsBefore: { users: 4, requests: 152, issuances: 17 }, countsAfter: rows.counts, workers: rows.beats.map(x => ({ version: x.version, seenAt: x.seenAt, stoppedAt: x.stoppedAt, lastError: x.lastError })), templates: rows.templates.map(({ storageKey: _storageKey, ...row }) => row), migrations: rows.migrations, savedFiles: files, actualUserLoginOrBusinessMutation: false }, null, 2));
    console.log(JSON.stringify({ status: "PASS", counts: rows.counts, templateVersions: 3, verifiedSavedFiles: files.length }));
  } finally { await db.$disconnect(); }
}
void main();
