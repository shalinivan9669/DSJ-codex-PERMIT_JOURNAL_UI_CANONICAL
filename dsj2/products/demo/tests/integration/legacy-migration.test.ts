import { assertTestDatabase } from "./test-database";
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { PrismaClient } from "../../packages/database/src";
import {
  migrateLegacy,
  seal,
  type ImportConfig,
} from "../../scripts/migration/import-legacy";

test("legacy import is dry-run, repeatable, tenant-scoped, preserves numbers and never invents files", async () => {
  if (!process.env.DATABASE_URL)
    throw new Error("DATABASE_URL must identify an isolated test database");
  assertTestDatabase();
  const db = new PrismaClient();
  const tenantId = randomUUID();
  const actorId = randomUUID();
  const profileVersionId = randomUUID();
  try {
    await db.tenant.create({
      data: { id: tenantId, name: "Synthetic migration " + tenantId },
    });
    await db.user.create({
      data: {
        id: actorId,
        tenantId,
        email: actorId + "@migration.invalid",
        displayName: "Migration test",
        passwordHash: "not-a-real-password",
        role: "ADMIN",
      },
    });
    await db.issuerProfileVersion.create({
      data: {
        id: profileVersionId,
        tenantId,
        version: 1,
        profile: { provenance: "SYNTHETIC_TEST" },
        createdBy: actorId,
      },
    });
    const raw = (n: number) => ({
      id: `source-${n}`,
      companyId: "legacy-company",
      title: "Контрольная заявка " + n,
      certificateType: "BIOT",
      biotDocumentKind: "WORKER_CARD",
      includeCard: true,
      includeProtocol: false,
      includeWitness: false,
      issueDate: "2025-05-06T00:00:00.000Z",
      trainingSubject: "Безопасность",
      createdAt: "2025-05-01T12:00:00.000Z",
      requestCompanyRu: "Заказчик " + n,
      requestCompanyKz: "Тапсырыс беруші " + n,
      items: [
        {
          id: `person-${n}`,
          fullName: "Одинаковое ФИО",
          fullNameKz: "Бөлек қазақша аты " + n,
          positionRu: "Оператор",
          positionKz: "Оператор KZ",
          certificateNumber: `ИСТ-${100 + n}`,
          photoDataUrl: "data:image/png;base64,LEGACY_UNVALIDATED_PHOTO",
        },
      ],
    });
    const envelope = seal({
      version: 1,
      sourceSystem: "DSJ",
      sourceCompanyId: "legacy-company",
      requests: [raw(1), raw(2)],
      audit: [],
      counts: { requests: 2, items: 2, audit: 0 },
      originalFiles: "NOT_EXPORTED_LEGACY_DID_NOT_PERSIST_ORIGINALS",
      coverage: "Synthetic only",
    });
    const config: ImportConfig = {
      tenantId,
      actorId,
      profileVersionId,
      sourceCompanyId: "legacy-company",
      sourceLabel: "fixture",
      requestKinds: { "source-1": "COMPANY", "source-2": "COMPANY" },
      numbers: { "BIOT:CARD|ИСТ-101": 101, "BIOT:CARD|ИСТ-102": 102 },
    };
    const dry = await migrateLegacy(db, envelope, config);
    assert.equal(dry.create, 2);
    assert.equal(
      dry.requests.reduce((count, request) => count + request.sourceRows, 0),
      envelope.counts.items,
    );
    assert.deepEqual(
      dry.requests.map((request) => request.status),
      ["PROPOSED", "PROPOSED"],
    );
    assert.deepEqual(dry.conflicts, []);
    assert.equal(await db.printRequest.count({ where: { tenantId } }), 0);
    const imported = await migrateLegacy(db, envelope, config, true);
    assert.equal(imported.applied, 2);
    assert.deepEqual(
      imported.requests.map((request) => request.status),
      ["APPLIED", "APPLIED"],
    );
    assert.equal(imported.originalArtifactsImported, 0);
    assert.equal(imported.missingOriginalDocuments, 2);
    assert.equal(
      await db.customerOrganization.count({ where: { tenantId } }),
      2,
    );
    assert.equal(await db.requestItem.count({ where: { tenantId } }), 2);
    assert.equal(await db.artifact.count({ where: { tenantId } }), 0);
    assert.equal(await db.generationJob.count({ where: { tenantId } }), 0);
    assert.deepEqual(
      (
        await db.numberReservation.findMany({
          where: { tenantId },
          orderBy: { sequence: "asc" },
        })
      ).map((r) => r.formattedNumber),
      ["ИСТ-101", "ИСТ-102"],
    );
    assert.equal(
      (
        await db.numberSequence.findUniqueOrThrow({
          where: { tenantId_namespace: { tenantId, namespace: "BIOT:CARD" } },
        })
      ).value,
      102,
    );
    const issued = await db.issuance.findFirstOrThrow({ where: { tenantId } });
    assert.equal(
      (issued.snapshot as any).provenance,
      "LEGACY_RECORD_WITHOUT_ORIGINAL",
    );
    assert.equal(
      (issued.snapshot as any).legacy.items[0].photoDataUrl,
      "data:image/png;base64,LEGACY_UNVALIDATED_PHOTO",
    );
    const repeat = await migrateLegacy(db, envelope, config, true);
    assert.equal(repeat.unchanged, 2);
    assert.deepEqual(
      repeat.requests.map((request) => request.status),
      ["UNCHANGED", "UNCHANGED"],
    );
    assert.equal(repeat.applied, 0);
    assert.equal(await db.printRequest.count({ where: { tenantId } }), 2);
    const { checksum: _oldChecksum, ...unchangedPayload } = envelope;
    const changed = seal({
      ...unchangedPayload,
      requests: [{ ...raw(1), title: "Changed" }, raw(2)],
    });
    const changedResult = await migrateLegacy(db, changed, config);
    assert.equal(
      changedResult.conflicts[0].code,
      "SOURCE_CHANGED_AFTER_IMPORT",
    );
    await assert.rejects(
      migrateLegacy(db, envelope, { ...config, tenantId: randomUUID() }),
      /TENANT_PROFILE_REQUIRED/,
    );
    const conflictEnvelope = seal({
      version: 1,
      sourceSystem: "DSJ",
      sourceCompanyId: "legacy-company",
      requests: [
        {
          ...raw(3),
          items: [{ ...raw(3).items[0], certificateNumber: "ИСТ-101" }],
        },
      ],
      audit: [],
      counts: { requests: 1, items: 1, audit: 0 },
      originalFiles: envelope.originalFiles,
      coverage: "Synthetic only",
    });
    const conflict = await migrateLegacy(
      db,
      conflictEnvelope,
      { ...config, requestKinds: { "source-3": "PERSON" } },
      true,
    );
    assert.equal(conflict.applied, 0);
    assert.equal(conflict.conflicts[0].code, "NUMBER_ALREADY_RESERVED");
  } finally {
    await db.$disconnect();
  }
});
