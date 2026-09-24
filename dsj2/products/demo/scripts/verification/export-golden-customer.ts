import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { db, type Context } from "../../apps/api/src/core";
import { registryExport } from "../../apps/api/src/files";
import { customerExportProfileSchema } from "../../apps/api/src/delivery";
import { PRODUCT_ROOT, selectBundleJobs } from "../../packages/printing/src";
import { assertTestDatabase } from "../../tests/integration/test-database";

async function main() {
  assertTestDatabase();
  const scenario = process.argv[2];
  assert.ok(scenario === "G1" || scenario === "G2");
  const directory = join(PRODUCT_ROOT, "docs/evidence/operator-value/golden");
  const source = JSON.parse(
    await readFile(join(directory, scenario + ".json"), "utf8"),
  );
  const user = await db.user.findFirstOrThrow({
    where: { tenantId: source.tenantId },
  });
  const c: Context = {
    tenantId: source.tenantId,
    userId: user.id,
    role: "ADMIN",
    sessionId: "verification",
    csrfHash: "verification",
    correlationId: randomUUID(),
  };
  const before = await db.numberReservation.count({
    where: { tenantId: c.tenantId },
  });
  const documents = await db.issuedDocument.findMany({
    where: { tenantId: c.tenantId, requestId: source.requestId },
  });
  const jobs = selectBundleJobs(
    await db.generationJob.findMany({
      where: {
        tenantId: c.tenantId,
        requestId: source.requestId,
        documentId: { in: documents.map((d) => d.id) },
        kind: { in: ["DOCX", "PDF"] },
      },
    }),
  );
  assert.equal(jobs.length, documents.length * 2);
  assert.ok(jobs.every((j) => j.status === "SUCCEEDED" && j.artifactId));
  const profile = customerExportProfileSchema.parse({
    name: `${scenario} — демонстрационный комплект`,
    sort: "SOURCE_ORDER",
    dateFormat: "DD.MM.YYYY",
    language: "ru",
    columns: [
      { field: "personnelNumber", title: "Табельный номер" },
      { field: "fullNameRu", title: "ФИО" },
      { field: "fullNameKz", title: "Аты-жөні" },
      { field: "departmentRu", title: "Подразделение" },
      { field: "programLabel", title: "Направление" },
      { field: "documentNumber", title: "Номер документа" },
      { field: "protocolNumber", title: "Номер протокола" },
      { field: "documentDate", title: "Дата документа", type: "DATE_ONLY" },
      { field: "result", title: "Результат из синтетической ведомости" },
    ],
    files: {
      grouping: "BY_PROGRAM",
      nameFields: [
        "personnelNumber",
        "fullNameRu",
        "templateLabel",
        "documentNumber",
      ],
      includeRegistry: true,
      includeInventory: true,
      includeCoverText: true,
    },
  });
  const bundle = await registryExport(
    c,
    { format: "ZIP", profile, artifactIds: jobs.map((j) => j.artifactId!) },
    source.requestId,
  );
  const target = join(directory, scenario, "customer");
  await mkdir(target, { recursive: true });
  await writeFile(join(target, bundle.fileName), bundle.buffer);
  const registry = await registryExport(
    c,
    { format: "XLSX", profile },
    source.requestId,
  );
  await writeFile(join(target, registry.fileName), registry.buffer);
  assert.equal(
    await db.numberReservation.count({ where: { tenantId: c.tenantId } }),
    before,
  );
  await writeFile(
    join(target, "selection.json"),
    JSON.stringify(
      {
        synthetic: true,
        requestId: source.requestId,
        savedFiles: jobs.length,
        reservationsBefore: before,
        reservationsAfter: before,
        selectedArtifactIds: jobs.map((j) => j.artifactId),
        files: [bundle.fileName, registry.fileName],
        rule: "Latest saved DOCX/PDF per issued document; corrected reconstructed group artifacts are explicit in manifest. Original bytes retained.",
      },
      null,
      2,
    ),
  );
  console.log(
    JSON.stringify({
      scenario,
      savedFiles: jobs.length,
      bundle: join(target, bundle.fileName),
      unchangedReservations: before,
    }),
  );
}
main().finally(() => db.$disconnect());
