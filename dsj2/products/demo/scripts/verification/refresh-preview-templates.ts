import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { PrismaClient, Prisma } from "../../packages/database/src";
import {
  ArtifactStore,
  PRODUCT_ROOT,
  templateManifest,
} from "../../packages/printing/src";

// Bounded migration for this explicitly authorized synthetic preview only.
const targetDatabase = "demo_test_browser_commercial_20260922";
const targetTenant = "866ec214-9b4e-4c31-bea5-ba25a90056f1";
const output = join(
  PRODUCT_ROOT,
  "docs/evidence/commercial-acceptance/browser",
);
const evidenceTag = process.argv[3] || "update";
if (!/^[a-z0-9-]+$/.test(evidenceTag)) throw new Error("INVALID_EVIDENCE_TAG");
const db = new PrismaClient();
const hash = (value: string | Buffer) =>
  createHash("sha256").update(value).digest("hex");
async function snapshot() {
  const tables: Record<string, { count: number; sha256: string }> = {};
  for (const name of [
    "printRequest",
    "requestItem",
    "issuerProfileVersion",
    "issuedDocument",
    "issuance",
    "numberSequence",
    "artifact",
  ] as const) {
    const records = await (
      db[name] as unknown as { findMany(): Promise<unknown[]> }
    ).findMany();
    records.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
    tables[name] = {
      count: records.length,
      sha256: hash(JSON.stringify(records)),
    };
  }
  const store = new ArtifactStore();
  const artifacts = await db.artifact.findMany();
  for (const file of artifacts) await store.read(file.storageKey, file.sha256);
  return {
    observedAt: new Date().toISOString(),
    tables,
    artifactBytesVerified: artifacts.length,
  };
}
async function main() {
  const url = new URL(process.env.DATABASE_URL!);
  if (
    url.hostname !== "127.0.0.1" ||
    url.port !== "55432" ||
    url.pathname !== "/" + targetDatabase
  )
    throw new Error("PREVIEW_DATABASE_TARGET_MISMATCH");
  const tenant = await db.tenant.findUniqueOrThrow({
    where: { id: targetTenant },
  });
  if (!tenant.demoOnly) throw new Error("PREVIEW_MUST_BE_SYNTHETIC");
  const busy = await db.generationJob.count({
    where: { status: { in: ["PENDING", "RUNNING"] } },
  });
  if (busy !== 0) throw new Error(`PREVIEW_BUSY:${busy}`);
  const phase = process.argv[2] || "inspect";
  const before = await snapshot();
  if (phase === "inspect") {
    await writeFile(
      join(output, `user-preview-${evidenceTag}-before.json`),
      JSON.stringify(before, null, 2),
    );
    console.log(JSON.stringify({ phase, activeJobs: busy, ...before }));
    return;
  }
  if (phase !== "apply") throw new Error("EXPECTED_INSPECT_OR_APPLY");
  const store = new ArtifactStore();
  const manifest = await templateManifest();
  const created: { id: string; version: string; sha256: string }[] = [];
  for (const template of manifest.templates) {
    const bytes = await readFile(
      join(PRODUCT_ROOT, "assets/templates", String(template.file)),
    );
    if (hash(bytes) !== template.sha256)
      throw new Error(`TEMPLATE_HASH:${template.id}`);
    const where = {
      tenantId_templateId_version: {
        tenantId: targetTenant,
        templateId: String(template.id),
        version: String(template.version),
      },
    };
    const existing = await db.templateVersion.findUnique({ where });
    if (existing && existing.checksum !== template.sha256)
      throw new Error(`IMMUTABLE_VERSION_MISMATCH:${template.id}`);
    if (!existing) {
      const asset = await store.put(bytes, "docx");
      await db.templateVersion.create({
        data: {
          ...where.tenantId_templateId_version,
          checksum: template.sha256 as string,
          storageKey: asset.storageKey,
          contract: template as Prisma.InputJsonValue,
          approved: true,
        },
      });
      created.push({
        id: String(template.id),
        version: String(template.version),
        sha256: template.sha256 as string,
      });
    }
  }
  const after = await snapshot();
  const unchanged =
    JSON.stringify(before.tables) === JSON.stringify(after.tables);
  const initial = JSON.parse(
    await readFile(
      join(output, `user-preview-${evidenceTag}-before.json`),
      "utf8",
    ),
  );
  const unchangedSincePreStop =
    JSON.stringify(initial.tables) === JSON.stringify(after.tables);
  const result = {
    status: unchanged && unchangedSincePreStop ? "PASS" : "FAIL",
    before,
    after,
    unchanged,
    unchangedSincePreStop,
    created,
    finalTemplates: manifest.templates.map((t) => ({
      id: t.id,
      version: t.version,
      sha256: t.sha256,
    })),
  };
  await writeFile(
    join(output, `user-preview-${evidenceTag}-result.json`),
    JSON.stringify(result, null, 2),
  );
  console.log(JSON.stringify(result));
  if (!unchanged || !unchangedSincePreStop)
    throw new Error("PREVIEW_DATA_CHANGED_DURING_UPDATE");
}
main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
