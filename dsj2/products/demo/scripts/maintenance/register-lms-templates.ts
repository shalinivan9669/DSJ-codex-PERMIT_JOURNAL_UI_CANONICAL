/** Append missing current LMS forms; approval remains an authenticated director action. */
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { lmsTemplateIds } from "../../packages/contracts/src";
import { PrismaClient, type Prisma } from "../../packages/database/src";
import {
  ArtifactStore,
  PRODUCT_ROOT,
  templateManifest,
} from "../../packages/printing/src";

type Options = { tenantId: string; apply?: boolean };
const digest = (value: Buffer | string) =>
  createHash("sha256").update(value).digest("hex");
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right, "en"))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
      .join(",")}}`;
  return JSON.stringify(value);
}

/** No changes to existing versions, numbering, issuer profiles or approval state. */
export async function registerLmsTemplates(
  db: PrismaClient,
  store: ArtifactStore,
  options: Options,
) {
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      options.tenantId,
    )
  )
    throw new Error("EXPLICIT_TENANT_UUID_REQUIRED");
  const manifest = await templateManifest();
  const templates = [
    ...manifest.templates,
    ...(manifest.groupTemplates || []),
    ...(manifest.specialTemplates || []),
  ].filter((entry) => String(entry.id).startsWith("lms-"));
  if (
    templates.length !== lmsTemplateIds.length ||
    lmsTemplateIds.some(
      (id) => templates.filter((entry) => entry.id === id).length !== 1,
    )
  )
    throw new Error("LMS_TEMPLATE_MANIFEST_INCOMPLETE");

  // Validate every asset before the first storage or database write.
  const validated = await Promise.all(
    templates.map(async (template) => {
      if (
        typeof template.file !== "string" ||
        !/^[a-z0-9][a-z0-9.-]*\.docx$/.test(template.file) ||
        !(
          (typeof template.version === "string" && template.version.trim()) ||
          (typeof template.version === "number" &&
            Number.isSafeInteger(template.version) &&
            template.version > 0)
        ) ||
        typeof template.sha256 !== "string" ||
        !/^[0-9a-f]{64}$/.test(template.sha256)
      )
        throw new Error("LMS_TEMPLATE_MANIFEST_INVALID");
      const bytes = await readFile(
        join(PRODUCT_ROOT, "assets/templates", template.file),
      );
      const checksum = digest(bytes);
      if (checksum !== template.sha256)
        throw new Error("LMS_TEMPLATE_CHECKSUM_MISMATCH");
      return {
        template,
        bytes,
        checksum,
        contractHash: digest(canonical(template)),
      };
    }),
  );

  return db.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${options.tenantId + ":register-lms-templates"}, 0))`;
      await tx.tenant.findUniqueOrThrow({ where: { id: options.tenantId } });
      const before = await tx.templateVersion.findMany({
        where: { tenantId: options.tenantId },
        orderBy: { id: "asc" },
      });
      const planned = validated.map((item) => ({
        ...item,
        existing: before.find(
          (row) =>
            row.templateId === item.template.id &&
            row.version === String(item.template.version),
        ),
      }));
      // An existing current version must match exactly; never repair it in place.
      for (const item of planned) {
        if (!item.existing) continue;
        if (
          item.existing.checksum !== item.checksum ||
          digest(canonical(item.existing.contract)) !== item.contractHash
        )
          throw new Error("IMMUTABLE_TEMPLATE_CONFLICT");
        const stored = await readFile(store.path(item.existing.storageKey));
        if (digest(stored) !== item.checksum)
          throw new Error("LMS_STORED_TEMPLATE_CHECKSUM_MISMATCH");
      }

      const result = [];
      let created = 0;
      for (const item of planned) {
        let row = item.existing;
        if (!row && options.apply) {
          const asset = await store.put(item.bytes, "docx");
          row = await tx.templateVersion.create({
            data: {
              tenantId: options.tenantId,
              templateId: String(item.template.id),
              version: String(item.template.version),
              checksum: item.checksum,
              storageKey: asset.storageKey,
              contract: item.template as Prisma.InputJsonValue,
              approved: false,
            },
          });
          created++;
        }
        result.push({
          id: row?.id,
          templateId: String(item.template.id),
          version: String(item.template.version),
          checksum: item.checksum,
          contractHash: item.contractHash,
          approved: row?.approved ?? false,
          present: !!row,
          created: !item.existing && !!row,
        });
      }
      const after = await tx.templateVersion.findMany({
        where: { tenantId: options.tenantId },
        orderBy: { id: "asc" },
      });
      for (const previous of before)
        if (
          JSON.stringify(after.find((row) => row.id === previous.id)) !==
          JSON.stringify(previous)
        )
          throw new Error("HISTORICAL_TEMPLATE_CHANGED");
      return {
        mode: options.apply ? ("APPLIED" as const) : ("DRY_RUN" as const),
        tenantId: options.tenantId,
        created,
        pending: result.filter((item) => !item.present).length,
        templates: result,
        oldRowsUnchanged: true,
      };
    },
    { timeout: 30000, maxWait: 30000 },
  );
}

if (require.main === module) {
  const db = new PrismaClient();
  void (async () => {
    const args = process.argv.slice(2);
    let tenantId: string | undefined;
    let apply = false;
    let dryRun = false;
    for (let index = 0; index < args.length; index++) {
      const arg = args[index];
      if (arg === "--apply" && !apply) apply = true;
      else if (arg === "--dry-run" && !dryRun) dryRun = true;
      else if (arg === "--tenant" && !tenantId) tenantId = args[++index];
      else if (arg.startsWith("--tenant=") && !tenantId)
        tenantId = arg.slice("--tenant=".length);
      else throw new Error("LMS_TEMPLATE_REGISTRATION_ARGUMENTS_INVALID");
    }
    if (!tenantId) throw new Error("EXPLICIT_TENANT_UUID_REQUIRED");
    if (apply && dryRun)
      throw new Error("LMS_TEMPLATE_REGISTRATION_MODE_CONFLICT");
    return registerLmsTemplates(db, new ArtifactStore(), { tenantId, apply });
  })()
    .then((result) => console.log(JSON.stringify(result, null, 2)))
    .catch((error) => {
      console.error(
        error instanceof Error
          ? error.message
          : "LMS_TEMPLATE_REGISTRATION_FAILED",
      );
      process.exitCode = 1;
    })
    .finally(() => db.$disconnect());
}
