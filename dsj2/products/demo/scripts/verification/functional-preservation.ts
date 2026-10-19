import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { PrismaClient } from "../../packages/database/src";
import { ArtifactStore } from "../../packages/printing/src";
import { chromium } from "@playwright/test";

const runtime = resolve(".runtime/functional-completion-20261019/run-01");
const evidence = resolve("docs/evidence/functional-completion-20261019/run-01");
const digest = (value: Buffer | string) =>
  createHash("sha256").update(value).digest("hex");
async function snapshot(db: PrismaClient) {
  return db.$transaction(async (tx) => {
    await tx.$executeRawUnsafe("SET TRANSACTION READ ONLY");
    const counts = {
      users: await tx.user.count(),
      requests: await tx.printRequest.count(),
      issuances: await tx.issuance.count(),
    };
    const documents = await tx.issuedDocument.findMany({
      orderBy: { id: "asc" },
    });
    const issuances = await tx.issuance.findMany({ orderBy: { id: "asc" } });
    const requests = await tx.printRequest.findMany({ orderBy: { id: "asc" } });
    const artifacts = await tx.artifact.findMany({
      where: { issuanceId: { not: null }, format: { in: ["PDF", "DOCX"] } },
      orderBy: { createdAt: "desc" },
    });
    return {
      counts,
      documentsHash: digest(JSON.stringify(documents)),
      issuancesHash: digest(JSON.stringify(issuances)),
      requestsHash: digest(JSON.stringify(requests)),
      documentCount: documents.length,
      artifacts,
    };
  });
}
async function main() {
  const mode = process.argv[2];
  assert.ok(["restore", "user"].includes(mode));
  const configuration = JSON.parse(
    await readFile(
      join(runtime, "user-offline-before/config.private.json"),
      "utf8",
    ),
  );
  const originalUrl = new URL(configuration.DATABASE_URL);
  assert.equal(originalUrl.hostname, "127.0.0.1");
  assert.equal(originalUrl.port, "55432");
  assert.equal(originalUrl.pathname, "/demo_test_browser_commercial_20260922");
  const targetUrl = new URL(process.env.DATABASE_URL!);
  assert.equal(targetUrl.hostname, "127.0.0.1");
  assert.equal(targetUrl.port, mode === "restore" ? "55489" : "55432");
  assert.equal(
    targetUrl.pathname,
    mode === "restore"
      ? "/demo_test_functional_20261019_run01_restore"
      : originalUrl.pathname,
  );
  const source = new PrismaClient({
      datasourceUrl: configuration.DATABASE_URL,
    }),
    target = new PrismaClient();
  await mkdir(evidence, { recursive: true });
  try {
    const original = await snapshot(source),
      restored = await snapshot(target);
    const baseline = JSON.parse(
      await readFile(join(evidence, "USER_COUNTS_BEFORE.json"), "utf8"),
    );
    assert.deepEqual(original.counts, {
      users: baseline.users,
      requests: baseline.requests,
      issuances: baseline.issuances,
    });
    assert.deepEqual(restored, original);
    const store = new ArtifactStore(process.env.DEMO_ARTIFACT_ROOT!);
    const oldManifest = JSON.parse(
      await readFile(
        join(runtime, "user-offline-before/manifest.private.json"),
        "utf8",
      ),
    );
    const storageRows = oldManifest.filter((row: { path: string }) =>
      /^storage[\\/]/.test(row.path),
    );
    for (const row of storageRows) {
      const bytes = await readFile(
        join(store.root, row.path.replace(/^storage[\\/]/, "")),
      );
      assert.equal(bytes.length, row.bytes);
      assert.equal(digest(bytes), row.sha256);
    }
    const savedFiles = [];
    for (const format of ["PDF", "DOCX"]) {
      const artifact = restored.artifacts.find((a) => a.format === format);
      assert.ok(artifact);
      const bytes = await store.read(artifact.storageKey, artifact.sha256);
      assert.equal(bytes.length, artifact.size);
      savedFiles.push({
        id: artifact.id,
        format,
        bytes: bytes.length,
        sha256: artifact.sha256,
      });
    }
    const api = await fetch(process.env.DEMO_API_ORIGIN + "/health");
    assert.equal(api.status, 200);
    let httpDownload: unknown = null;
    // Authentication setup is restricted to the disposable restore DB. It does not
    // change an account password, role or any historical business object.
    if (mode === "restore") {
      const user = await target.user.findFirstOrThrow({
        where: {
          active: true,
          role: { in: ["DIRECTOR", "SUPER_ADMIN", "ADMIN"] },
        },
      });
      const secret = randomBytes(32).toString("hex"),
        csrf = randomBytes(32).toString("hex"),
        sessionId = digest(secret);
      await target.session.create({
        data: {
          id: sessionId,
          tenantId: user.tenantId,
          userId: user.id,
          csrfHash: digest(csrf),
          sessionVersion: user.sessionVersion,
          expiresAt: new Date(Date.now() + 600000),
        },
      });
      try {
        const artifact = restored.artifacts.find(
          (a) => a.format === "PDF" && a.tenantId === user.tenantId,
        );
        assert.ok(artifact);
        const response = await fetch(
          process.env.DEMO_API_ORIGIN + `/artifacts/${artifact.id}`,
          { headers: { Cookie: `demo_session=${secret}; demo_csrf=${csrf}` } },
        );
        assert.equal(response.status, 200);
        const bytes = Buffer.from(await response.arrayBuffer());
        assert.equal(digest(bytes), artifact.sha256);
        await writeFile(
          join(runtime, "restored-historical.private.pdf"),
          bytes,
        );
        httpDownload = {
          status: response.status,
          artifactId: artifact.id,
          bytes: bytes.length,
          sha256: artifact.sha256,
          authentication:
            "Temporary restore-only session; no claim of actual user password login",
        };
      } finally {
        await target.session.deleteMany({ where: { id: sessionId } });
      }
    }
    const browser = await chromium.launch({
      channel: "chrome",
      headless: true,
    });
    try {
      const page = await browser.newPage({
        viewport: { width: 1440, height: 900 },
      });
      const errors: string[] = [];
      page.on("pageerror", (e) => errors.push(e.message));
      const response = await page.goto(process.env.DEMO_ORIGIN + "/login");
      assert.equal(response?.status(), 200);
      await page.getByRole("button", { name: "Войти", exact: true }).waitFor();
      assert.deepEqual(errors, []);
      await page.screenshot({
        path: join(evidence, `${mode}-login.png`),
        fullPage: true,
      });
    } finally {
      await browser.close();
    }
    const migrations = await target.$queryRaw<
      Array<{ migration_name: string; finished_at: Date }>
    >`SELECT migration_name, finished_at FROM "_prisma_migrations" ORDER BY migration_name`;
    assert.equal(migrations.length, 38);
    assert.ok(migrations.every((x) => x.finished_at));
    await writeFile(
      join(
        evidence,
        mode === "restore"
          ? "BACKUP_RESTORE_RESULT.json"
          : "USER_INSTALLATION_RESULT.json",
      ),
      JSON.stringify(
        {
          status: "PASS",
          capturedAt: new Date().toISOString(),
          target: targetUrl.pathname.slice(1),
          api: process.env.DEMO_API_ORIGIN,
          web: process.env.DEMO_ORIGIN,
          counts: restored.counts,
          documentCount: restored.documentCount,
          immutableDocumentDataMatches: true,
          requestsHash: restored.requestsHash,
          issuancesHash: restored.issuancesHash,
          documentsHash: restored.documentsHash,
          storageFilesVerified: storageRows.length,
          storageBytes: storageRows.reduce(
            (n: number, row: { bytes: number }) => n + row.bytes,
            0,
          ),
          savedFiles,
          httpDownload,
          migrationsApplied: migrations.length,
          realUserBusinessMutation: false,
        },
        null,
        2,
      ),
    );
    console.log(
      JSON.stringify({
        mode,
        status: "PASS",
        counts: restored.counts,
        storageFiles: storageRows.length,
      }),
    );
  } finally {
    await source.$disconnect();
    await target.$disconnect();
  }
}
void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
