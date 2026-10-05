/** Explicit append-only registration for the three special-program references.
 * Default is a read-only plan. Approval uses the existing authenticated API. */
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { db, json } from "../../apps/api/src/core";
import {
  ArtifactStore,
  PRODUCT_ROOT,
  templateManifest,
} from "../../packages/printing/src";

async function main() {
  const tenantId = process.argv
    .find((arg) => arg.startsWith("--tenant="))
    ?.slice(9);
  if (!tenantId) throw new Error("EXPLICIT_TENANT_REQUIRED");
  const apply = process.argv.includes("--apply");
  await db.tenant.findUniqueOrThrow({ where: { id: tenantId } });
  const templates = (await templateManifest()).specialTemplates || [];
  if (
    templates.length !== 3 ||
    templates.some((entry) => entry.program !== "SPECIAL")
  )
    throw new Error("SPECIAL_MANIFEST_REQUIRED");
  const before = await db.templateVersion.findMany({
    where: { tenantId },
    orderBy: { id: "asc" },
  });
  const store = new ArtifactStore();
  const result = [];
  for (const template of templates) {
    const bytes = await readFile(
      join(PRODUCT_ROOT, "assets/templates", String(template.file)),
    );
    const checksum = createHash("sha256").update(bytes).digest("hex");
    if (checksum !== template.sha256)
      throw new Error("TEMPLATE_CHECKSUM_MISMATCH");
    const templateId = String(template.id),
      version = String(template.version);
    let row = before.find(
      (entry) => entry.templateId === templateId && entry.version === version,
    );
    if (
      row &&
      (row.checksum !== checksum ||
        (row.contract as Record<string, unknown>).program !== "SPECIAL")
    )
      throw new Error("IMMUTABLE_TEMPLATE_CONFLICT");
    if (!row && apply) {
      const asset = await store.put(bytes, "docx");
      row = await db.templateVersion.create({
        data: {
          tenantId,
          templateId,
          version,
          checksum,
          storageKey: asset.storageKey,
          contract: json(template),
          approved: false,
        },
      });
    }
    result.push({
      id: row?.id,
      templateId,
      version,
      checksum,
      approved: row?.approved || false,
      present: !!row,
    });
  }
  const after = await db.templateVersion.findMany({
    where: { tenantId },
    orderBy: { id: "asc" },
  });
  for (const previous of before)
    if (
      JSON.stringify(after.find((entry) => entry.id === previous.id)) !==
      JSON.stringify(previous)
    )
      throw new Error("HISTORICAL_TEMPLATE_CHANGED");
  console.log(
    JSON.stringify({
      mode: apply ? "APPLIED" : "DRY_RUN",
      tenantId,
      templates: result,
      oldRowsUnchanged: true,
    }),
  );
}

void main()
  .finally(() => db.$disconnect())
  .catch((error) => {
    console.error(
      error instanceof Error ? error.message : "SPECIAL_REGISTRATION_FAILED",
    );
    process.exitCode = 1;
  });
