import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { PrismaClient } from "@demo/database";
import { ArtifactStore } from "@demo/printing";
import { draftSchema } from "@demo/contracts";
import { db, hash, type Context } from "../../apps/api/src/core";
import { createRequest, finalize } from "../../apps/api/src/requests";

type Row = Record<string, unknown>;
type TableProof = {
  table: string;
  columns: string[];
  key: string;
  keys: string[];
  count: number;
  sha256: string;
};
type Proof = {
  tenantId: string;
  requestId: string;
  sourceDatabase: string;
  oldSchemaCommit: string;
  tables: TableProof[];
  files: { storageKey: string; sha256: string; size: number }[];
  counters: { namespace: string; value: number }[];
  oldMigrationCount: number;
};
const mode = process.argv[2],
  proofPath = resolve(process.argv[3]);
const targetUrl = new URL(process.env.DATABASE_URL || "");
assert.match(targetUrl.pathname, /^\/demo_test_upgrade_[a-z0-9_]+$/);
assert.ok(["127.0.0.1", "localhost"].includes(targetUrl.hostname));
const targetStore = new ArtifactStore();
const quote = (name: string) => {
  assert.match(name, /^[A-Za-z_][A-Za-z0-9_]*$/);
  return `"${name}"`;
};
async function rowsForProof(table: TableProof) {
  return (
    await db.$queryRawUnsafe<{ row: Row }[]>(
      `SELECT to_jsonb(r) AS row FROM (SELECT ${table.columns.map(quote).join(",")} FROM ${quote(table.table)} WHERE ${quote(table.key)} IN (SELECT jsonb_array_elements_text($1::jsonb)) ORDER BY ${quote(table.key)}) r`,
      JSON.stringify(table.keys),
    )
  ).map((value) => value.row);
}

async function seed() {
  const sourceUrl = new URL(process.env.UPGRADE_SOURCE_URL || "");
  assert.match(sourceUrl.pathname, /^\/demo_test_backup_[a-z0-9_]+$/);
  assert.equal(sourceUrl.hostname, targetUrl.hostname);
  const source = new PrismaClient({ datasourceUrl: sourceUrl.toString() });
  const fixture = JSON.parse(
    await readFile(process.env.UPGRADE_SOURCE_FIXTURE!, "utf8"),
  );
  const sourceStore = new ArtifactStore(process.env.UPGRADE_SOURCE_STORAGE!);
  try {
    const oldMigrationCount = Number(
      (
        await db.$queryRawUnsafe<{ count: bigint }[]>(
          'SELECT count(*) FROM "_prisma_migrations" WHERE finished_at IS NOT NULL',
        )
      )[0].count,
    );
    assert.equal(oldMigrationCount, 5);
    assert.equal(
      (
        await db.$queryRawUnsafe<{ exists: boolean }[]>(
          `SELECT to_regclass('public."TrainingEvent"') IS NOT NULL AS exists`,
        )
      )[0].exists,
      false,
    );
    assert.equal(
      (
        await db.$queryRawUnsafe<{ count: bigint }[]>(
          'SELECT count(*) FROM "Tenant"',
        )
      )[0].count,
      0n,
    );
    const request = await source.printRequest.findUniqueOrThrow({
      where: { id: fixture.requestId },
    });
    assert.equal(request.tenantId, fixture.tenantId);
    const issued = await source.issuedDocument.findMany({
      where: { requestId: request.id, tenantId: request.tenantId },
    });
    assert.ok(issued.length > 0);
    assert.ok(issued.every((document) => document.ownerKind === "INDIVIDUAL"));
    const issuances = await source.issuance.findMany({
      where: { requestId: request.id, tenantId: request.tenantId },
    });
    const documentIds = JSON.stringify(issued.map((value) => value.id));
    const issuanceIds = JSON.stringify(issuances.map((value) => value.id));
    const selectors: [string, string, unknown][] = [
      ["Tenant", "id=$1", fixture.tenantId],
      [
        "User",
        "\"tenantId\"=$1 AND role IN ('ADMIN','OPERATOR','VIEWER')",
        fixture.tenantId,
      ],
      ...[
        "IssuerProfileVersion",
        "CustomerOrganization",
        "Recipient",
        "TemplateVersion",
      ].map(
        (table) =>
          [table, '"tenantId"=$1', fixture.tenantId] as [
            string,
            string,
            unknown,
          ],
      ),
      ["PrintRequest", "id=$1", request.id],
      ["RequestItem", '"requestId"=$1', request.id],
      ["Issuance", '"requestId"=$1', request.id],
      [
        "IssuanceEvent",
        '"issuanceId" IN (SELECT jsonb_array_elements_text($1::jsonb))',
        issuanceIds,
      ],
      ["IssuedDocument", '"requestId"=$1', request.id],
      ["NumberSequence", '"tenantId"=$1', fixture.tenantId],
      [
        "NumberReservation",
        '"documentId" IN (SELECT jsonb_array_elements_text($1::jsonb))',
        documentIds,
      ],
      ...["RenderInputSnapshot", "GenerationJob", "Artifact"].map(
        (table) =>
          [table, '"requestId"=$1', request.id] as [string, string, unknown],
      ),
      ["PhotoAsset", '"tenantId"=$1', fixture.tenantId],
      ["IdempotencyOperation", "result->>'requestId'=$1", request.id],
      ["AuditEvent", '"entityId"=$1', request.id],
    ];
    const records: { table: string; rows: Row[] }[] = [];
    for (const [table, where, parameter] of selectors)
      records.push({
        table,
        rows: (
          await source.$queryRawUnsafe<{ row: Row }[]>(
            `SELECT to_jsonb(t) AS row FROM ${quote(table)} t WHERE ${where}`,
            parameter,
          )
        ).map((value) => value.row),
      });
    const files = new Map<string, { sha256: string; size: number }>();
    for (const record of records)
      for (const row of record.rows)
        for (const field of ["storageKey", "originalStorageKey"]) {
          const key = row[field];
          if (typeof key !== "string" || files.has(key)) continue;
          const expected =
            field === "storageKey" ? row.sha256 || row.checksum : undefined;
          const bytes = await sourceStore.read(
            key,
            typeof expected === "string" ? expected : undefined,
          );
          const path = targetStore.path(key);
          await mkdir(dirname(path), { recursive: true });
          await writeFile(path, bytes, { flag: "wx" });
          files.set(key, {
            sha256: createHash("sha256").update(bytes).digest("hex"),
            size: bytes.length,
          });
        }
    await db.$transaction(
      async (tx) => {
        for (const record of records)
          for (const row of record.rows)
            await tx.$executeRawUnsafe(
              `INSERT INTO ${quote(record.table)} SELECT * FROM jsonb_populate_record(NULL::${quote(record.table)}, $1::jsonb)`,
              JSON.stringify(row),
            );
      },
      { timeout: 60000 },
    );
    const tables: TableProof[] = [];
    for (const record of records) {
      const columns = (
        await db.$queryRawUnsafe<{ column_name: string }[]>(
          "SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name=$1 ORDER BY ordinal_position",
          record.table,
        )
      ).map((value) => value.column_name);
      const key = record.table === "NumberSequence" ? "namespace" : "id";
      const table = {
        table: record.table,
        columns,
        key,
        keys: record.rows.map((row) => String(row[key])),
        count: record.rows.length,
        sha256: "",
      };
      table.sha256 = hash(await rowsForProof(table));
      tables.push(table);
    }
    const counters = await db.numberSequence.findMany({
      where: { tenantId: fixture.tenantId },
      select: { namespace: true, value: true },
    });
    const proof: Proof = {
      tenantId: fixture.tenantId,
      requestId: request.id,
      sourceDatabase: sourceUrl.pathname.slice(1),
      oldSchemaCommit: "59a961a",
      oldMigrationCount,
      tables,
      files: [...files].map(([storageKey, value]) => ({
        storageKey,
        ...value,
      })),
      counters,
    };
    await writeFile(proofPath, JSON.stringify(proof, null, 2));
    process.stdout.write(
      JSON.stringify(
        {
          phase: "SEEDED_V5",
          tables: tables.length,
          rows: tables.reduce((sum, table) => sum + table.count, 0),
          files: files.size,
          issuedDocuments: issued.length,
          counters,
        },
        null,
        2,
      ) + "\n",
    );
  } finally {
    await source.$disconnect();
  }
}

async function verify() {
  const expected: Proof = JSON.parse(await readFile(proofPath, "utf8"));
  const migrations = await db.$queryRawUnsafe<{ migration_name: string }[]>(
    'SELECT migration_name FROM "_prisma_migrations" WHERE finished_at IS NOT NULL ORDER BY migration_name',
  );
  const requiredMigrations = (
    await readdir(
      resolve(__dirname, "../../packages/database/prisma/migrations"),
      { withFileTypes: true },
    )
  )
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  assert.deepEqual(
    migrations.map((row) => row.migration_name).sort(),
    requiredMigrations,
  );
  for (const table of expected.tables)
    assert.equal(
      hash(await rowsForProof(table)),
      table.sha256,
      `Changed old data: ${table.table}`,
    );
  for (const file of expected.files)
    assert.equal(
      (await targetStore.read(file.storageKey, file.sha256)).length,
      file.size,
    );
  const oldDocuments = await db.issuedDocument.findMany({
    where: { tenantId: expected.tenantId, requestId: expected.requestId },
  });
  assert.ok(
    oldDocuments.every(
      (document) =>
        document.ownerKind === "INDIVIDUAL" && document.groupEventId === null,
    ),
  );
  const source = await db.printRequest.findUniqueOrThrow({
    where: { id: expected.requestId },
  });
  const draft = draftSchema.parse(source.draft);
  assert.ok(
    !draft.events?.length,
    "Continuation fixture must be a legacy individual request",
  );
  draft.title = "Синтетическое продолжение после обновления";
  for (const item of draft.items) {
    item.id = randomUUID();
    for (const assignment of item.assignments) assignment.id = randomUUID();
  }
  const c: Context = {
    tenantId: expected.tenantId,
    userId: source.createdBy,
    role: "ADMIN",
    sessionId: "test",
    csrfHash: "test",
    correlationId: randomUUID(),
  };
  const created = await createRequest(c, draft);
  const final = await finalize(
    c,
    created.id,
    { expectedRevision: 0 },
    randomUUID(),
  );
  const reservations = await db.numberReservation.findMany({
    where: {
      tenantId: expected.tenantId,
      documentId: { in: final.documentIds },
    },
    orderBy: [{ namespace: "asc" }, { sequence: "asc" }],
  });
  assert.ok(reservations.length > 0);
  const used = new Map<string, number>();
  for (const reservation of reservations) {
    const prior =
      expected.counters.find(
        (counter) => counter.namespace === reservation.namespace,
      )?.value || 0;
    const count = (used.get(reservation.namespace) || 0) + 1;
    used.set(reservation.namespace, count);
    assert.equal(reservation.sequence, prior + count);
  }
  for (const table of expected.tables.filter(
    (table) => table.table !== "NumberSequence",
  ))
    assert.equal(
      hash(await rowsForProof(table)),
      table.sha256,
      `Continuation changed old data: ${table.table}`,
    );
  for (const file of expected.files)
    assert.equal(
      (await targetStore.read(file.storageKey, file.sha256)).length,
      file.size,
    );
  const report = {
    status: "PASS",
    scenario: "AT141 populated schema upgrade and number continuation",
    oldSchemaCommit: expected.oldSchemaCommit,
    migrationCountBefore: 5,
    migrationCountAfter: migrations.length,
    database: targetUrl.pathname.slice(1),
    sourceDatabase: expected.sourceDatabase,
    oldRowsPreserved: expected.tables.reduce(
      (sum, table) => sum + table.count,
      0,
    ),
    tableProofs: expected.tables,
    originalFilesPreserved: expected.files.length,
    originalBytesPreserved: expected.files.reduce(
      (sum, file) => sum + file.size,
      0,
    ),
    files: expected.files,
    oldRequestId: expected.requestId,
    oldDocumentNumbers: oldDocuments.map((document) => ({
      id: document.id,
      number: document.number,
      namespace: document.namespace,
    })),
    countersBefore: expected.counters,
    continuationRequestId: created.id,
    continuationNumbers: reservations.map((reservation) => ({
      namespace: reservation.namespace,
      sequence: reservation.sequence,
      number: reservation.formattedNumber,
    })),
    limitations:
      "Fixture projects selected existing synthetic individual issuance metadata and real saved artifacts into the original v5 schema. It is a populated additive-migration test, not a claim that these artifacts were rendered by the historic v5 binary. Continuation exercises actual API finalize/number reservation; new queued document rendering is not claimed. Original source database is read only; production was not touched.",
  };
  const output = resolve(process.argv[4]);
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, JSON.stringify(report, null, 2));
  process.stdout.write(
    JSON.stringify(
      {
        status: report.status,
        oldRowsPreserved: report.oldRowsPreserved,
        originalFilesPreserved: report.originalFilesPreserved,
        continuationNumbers: report.continuationNumbers,
        output,
      },
      null,
      2,
    ) + "\n",
  );
}

async function main() {
  try {
    if (mode === "seed") await seed();
    else if (mode === "verify") await verify();
    else throw new Error("Expected seed or verify");
  } finally {
    await db.$disconnect();
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
