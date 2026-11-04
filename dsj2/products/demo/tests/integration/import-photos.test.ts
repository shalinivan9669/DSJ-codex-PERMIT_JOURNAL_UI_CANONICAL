import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { assertTestDatabase } from "./test-database";
import { provision } from "../../scripts/setup";
import { db, type Context } from "../../apps/api/src/core";
import {
  importPreview,
  applyImport,
  readPhoto,
} from "../../apps/api/src/files";
import { createRequest, requestDetail } from "../../apps/api/src/requests";
import { itemSchema } from "../../packages/contracts/src";

test("embedded XLSX photos persist atomically, retry without duplicates and stay tenant scoped", async () => {
  assertTestDatabase();
  const temporary = await mkdtemp(join(tmpdir(), "demo-import-photo-api-"));
  try {
    const filePath = join(temporary, "people.xlsx");
    execFileSync(
      process.env.DEMO_PYTHON || "python",
      [
        "-c",
        "import sys; from pathlib import Path; sys.path.insert(0, sys.argv[1]); from test_import_photos import workbook; workbook(Path(sys.argv[2]))",
        resolve("tests/render"),
        filePath,
      ],
      { windowsHide: true },
    );
    const provisioned = await provision({
      email: `photos-${randomUUID()}@example.test`,
      password: "Synthetic-Photos-Test-Only!",
      name: "Синтетическая проверка фото",
      sample: true,
    });
    const context: Context = {
      ...provisioned,
      role: "DIRECTOR",
      sessionId: "test",
      csrfHash: "test",
      correlationId: randomUUID(),
    };
    const buffer = await readFile(filePath);
    const file = {
      buffer,
      size: buffer.length,
      originalname: "people.xlsx",
    } as Express.Multer.File;
    const [first, repeated] = await Promise.all([
      importPreview(context, file),
      importPreview(context, file),
    ]);
    assert.equal(first.importId, repeated.importId);
    assert.deepEqual(
      first.rows.map((row) => row.photoAssetId),
      repeated.rows.map((row) => row.photoAssetId),
    );
    assert.equal(first.rows.length, 2);
    assert.ok(first.rows.every((row) => row.photoAssetId));
    assert.equal(
      await db.photoAsset.count({ where: { tenantId: context.tenantId } }),
      2,
    );
    assert.equal(
      await db.auditEvent.count({
        where: { tenantId: context.tenantId, action: "PHOTO_UPLOADED" },
      }),
      2,
    );
    const firstPhoto = await readPhoto(context, first.rows[0].photoAssetId!);
    const secondPhoto = await readPhoto(context, first.rows[1].photoAssetId!);
    assert.notDeepEqual(firstPhoto.buffer, secondPhoto.buffer);
    await assert.rejects(
      readPhoto(
        { ...context, tenantId: randomUUID() },
        first.rows[0].photoAssetId!,
      ),
    );
    const other = await provision({
      email: `other-photos-${randomUUID()}@example.test`,
      password: "Synthetic-Other-Test-Only!",
      name: "Другой синтетический центр",
      sample: true,
    });
    const otherContext: Context = { ...context, ...other };
    const otherPreview = await importPreview(otherContext, file);
    assert.notEqual(otherPreview.importId, first.importId);
    assert.notEqual(
      otherPreview.rows[0].photoAssetId,
      first.rows[0].photoAssetId,
    );
    await assert.rejects(readPhoto(otherContext, first.rows[0].photoAssetId!));
    const otherRequest = await createRequest(otherContext, { kind: "PERSON" });
    await assert.rejects(
      applyImport(otherContext, otherRequest.id, {
        expectedRevision: otherRequest.revision,
        importId: otherPreview.importId,
        rows: [
          itemSchema.parse({
            id: "cross-tenant",
            importId: otherPreview.importId,
            sourceRow: 2,
            fullNameRu: "Попытка чужого фото",
            photoAssetId: first.rows[0].photoAssetId,
          }),
        ],
      }),
    );
    assert.equal(
      (await requestDetail(otherContext, otherRequest.id)).items.length,
      0,
    );
    assert.equal(
      await db.printRequest.count({ where: { tenantId: context.tenantId } }),
      0,
    );
    const request = await createRequest(context, { kind: "PERSON" });
    const rows = first.rows.map((row) =>
      itemSchema.parse({
        id: `${first.importId}-${row.sourceRow}`,
        fullNameRu: row.values[0],
        personnelNumber: row.values[1],
        importId: first.importId,
        sourceRow: row.sourceRow,
        photoAssetId: row.photoAssetId,
      }),
    );
    const applied = await applyImport(context, request.id, {
      expectedRevision: request.revision,
      importId: first.importId,
      rows,
    });
    const retry = await applyImport(context, request.id, {
      expectedRevision: request.revision,
      importId: first.importId,
      rows,
    });
    assert.equal(applied.items.length, 2);
    assert.equal(retry.items.length, 2);
    assert.equal(retry.importResult.repeated, true);
    assert.deepEqual(
      (await requestDetail(context, request.id)).items.map(
        (row) => row.photoAssetId,
      ),
      first.rows.map((row) => row.photoAssetId),
    );
    // A new client connection still reads durable asset bytes and the same import batch.
    await db.$disconnect();
    assert.deepEqual(
      (await readPhoto(context, first.rows[0].photoAssetId!)).buffer,
      firstPhoto.buffer,
    );
    const reopened = await importPreview(context, file);
    assert.equal(reopened.importId, first.importId);
    assert.equal(
      await db.photoAsset.count({ where: { tenantId: context.tenantId } }),
      2,
    );
    execFileSync(
      process.env.DEMO_PYTHON || "python",
      [
        "-c",
        "import sys; from openpyxl import load_workbook; book=load_workbook(sys.argv[1]); book.active['B2']='=1+1'; book.save(sys.argv[1])",
        filePath,
      ],
      { windowsHide: true },
    );
    const withFormula = await readFile(filePath);
    const partial = await importPreview(context, {
      buffer: withFormula,
      size: withFormula.length,
      originalname: "formula-photo.xlsx",
    } as Express.Multer.File);
    assert.ok(partial.rows[0].errors.includes("FORMULA_NOT_ALLOWED"));
    assert.equal(partial.rows[0].photoAssetId, undefined);
    assert.ok(partial.rows[1].photoAssetId);
    const partialRequest = await createRequest(context, { kind: "PERSON" });
    const validRow = partial.rows[1];
    const savedValidRow = await applyImport(context, partialRequest.id, {
      expectedRevision: partialRequest.revision,
      importId: partial.importId,
      rows: [
        itemSchema.parse({
          id: "valid-photo-row",
          fullNameRu: validRow.values[0],
          importId: partial.importId,
          sourceRow: validRow.sourceRow,
          photoAssetId: validRow.photoAssetId,
        }),
      ],
    });
    assert.equal(savedValidRow.items.length, 1);
    assert.equal(savedValidRow.items[0].photoAssetId, validRow.photoAssetId);
  } finally {
    await db.$disconnect();
    await rm(temporary, { recursive: true, force: true });
  }
});
