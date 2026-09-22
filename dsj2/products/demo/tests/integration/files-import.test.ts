import { assertTestDatabase } from "./test-database";
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import { db, hash, type Context } from "../../apps/api/src/core";
import { provision } from "../../scripts/setup";
import {
  createRequest,
  patchRequest,
  finalize,
  listRequests,
  requestDetail,
} from "../../apps/api/src/requests";
import {
  uploadPhoto,
  importPreview,
  applyImport,
  store,
  readArtifact,
  restoreArtifact,
  registryExport,
} from "../../apps/api/src/files";
import { openArtifact } from "../../apps/api/src/storage";
import { saveProfile } from "../../apps/api/src/settings";
import {
  draftSchema,
  itemSchema,
  assignmentSchema,
} from "../../packages/contracts/src";
import { claimJob, executeJob } from "../../apps/render-worker/src/queue";

test("real image/import/export/original/reconstruction integration", async (t) => {
  assert.match(process.env.DATABASE_URL || "", /demo_test|demo_integration/);
  assertTestDatabase();
  const who = await provision({
    email: `files-${randomUUID()}@example.test`,
    password: "Files-Test-Only-Password!",
    name: "Проверка файлов",
    sample: true,
  });
  const c: Context = {
    ...who,
    userId: who.userId,
    role: "ADMIN",
    sessionId: "test",
    csrfHash: "test",
    correlationId: randomUUID(),
  };
  const originalPhoto = await readFile(
    join(__dirname, "../fixtures/source-photo.png"),
  );
  let photoId = "";
  let requestId = "";
  let revision = 0;
  try {
    await t.test(
      "PNG decoding, rotated crop, corrupt bytes, upload budget, private scope",
      async () => {
        const result = await uploadPhoto(
          c,
          {
            buffer: originalPhoto,
            size: originalPhoto.length,
            originalname: "portrait.png",
          } as Express.Multer.File,
          {
            rotation: "90",
            crop: JSON.stringify({ x: 0, y: 0, width: 100, height: 100 }),
          },
        );
        photoId = result.assetId;
        assert.equal(result.width, 100);
        assert.equal(result.height, 100);
        assert.ok(result.warnings.length);
        await assert.rejects(
          uploadPhoto(
            c,
            { buffer: Buffer.from("fake"), size: 4 } as Express.Multer.File,
            {},
          ),
        );
        await assert.rejects(
          uploadPhoto(
            c,
            {
              buffer: originalPhoto,
              size: 5 * 1024 * 1024 + 1,
            } as Express.Multer.File,
            {},
          ),
        );
        const stored = await db.photoAsset.findUniqueOrThrow({
          where: { id: photoId },
        });
        assert.notEqual(stored.storageKey, stored.originalStorageKey);
        assert.equal(
          (await store.read(stored.storageKey, stored.sha256)).length,
          stored.size,
        );
      },
    );
    await t.test(
      "same upload same batch; 100 rows applied, leading zeros/RUKZ/partials survive;101 visible",
      async () => {
        const csv = Buffer.from(
          "\uFEFFfullNameRu,fullNameKz,positionRu\r\n" +
            Array.from(
              { length: 100 },
              (_, i) =>
                `${String(i).padStart(5, "0")},Ә Ғ Қ Ң Ө Ұ Ү Һ І ${i},${i === 0 ? "" : "Инженер"}`,
            ).join("\r\n"),
        );
        const file = {
          buffer: csv,
          size: csv.length,
          originalname: "people.csv",
        } as Express.Multer.File;
        const [a, b] = await Promise.all([
          importPreview(c, file),
          importPreview(c, file),
        ]);
        assert.equal(a.importId, b.importId);
        assert.equal(a.total, 100);
        assert.equal(a.rows[0].values[0], "00000");
        const ru = Buffer.from(
          "ФИО\tАты-жөні\tДолжность\nИванов Иван\tӘділ Ғалым\tИнженер",
        );
        const localized = await importPreview(c, {
          buffer: ru,
          size: ru.length,
          originalname: "ru-kz.tsv",
        } as Express.Multer.File);
        assert.deepEqual(localized.columns, ["ФИО", "Аты-жөні", "Должность"]);
        assert.deepEqual(localized.rows[0].values, [
          "Иванов Иван",
          "Әділ Ғалым",
          "Инженер",
        ]);
        assert.deepEqual(localized.rows[0].errors, []);
        const draft = await createRequest(c, { kind: "COMPANY" });
        requestId = draft.id;
        const rows = a.rows.map((row) =>
          itemSchema.parse({
            id: `${a.importId}-${row.sourceRow}`,
            fullNameRu: row.values[0],
            fullNameKz: row.values[1],
            positionRu: row.values[2],
            photoAssetId: photoId,
            sourceRow: row.sourceRow,
            importId: a.importId,
          }),
        );
        const result = await applyImport(c, draft.id, {
          expectedRevision: 0,
          importId: a.importId,
          rows,
        });
        revision = result.revision;
        assert.equal(result.items.length, 100);
        assert.equal(result.items[0].positionRu, "");
        const repeat = await applyImport(c, draft.id, {
          expectedRevision: 0,
          importId: b.importId,
          rows,
        });
        assert.equal(repeat.items.length, 100);
        assert.equal(repeat.status, "DRAFT");
        assert.equal(repeat.importResult.repeated, true);
        const over = Buffer.concat([csv, Buffer.from("\r\n00100,Қосымша,")]);
        const larger = await importPreview(c, {
          buffer: over,
          size: over.length,
          originalname: "101.csv",
        } as Express.Multer.File);
        assert.equal(larger.total, 101);
        assert.equal(larger.canApply, false);
        const tooMany = [...rows, { ...rows[0], id: "101", sourceRow: 102 }];
        await assert.rejects(
          applyImport(c, draft.id, {
            expectedRevision: revision,
            importId: a.importId,
            rows: tooMany,
          }),
        );
        assert.equal((await requestDetail(c, draft.id)).items.length, 100);
      },
    );
    await t.test(
      "API saves photo references, protocol link independent of selection order; actual saved DOCX hash stable",
      async () => {
        const issuer = await db.issuerProfileVersion.findFirstOrThrow({
          where: { tenantId: c.tenantId },
          orderBy: { version: "desc" },
        });
        await saveProfile(c, {
          ...(issuer.profile as object),
          cityRu: "Кызылорда",
          cityKz: "Қызылорда",
          commission: Array.from({ length: 3 }, (_, i) => ({
            name: `Синтетический Член Комиссии ${i + 1}`,
            position: i === 0 ? "Председатель" : "Член комиссии",
          })),
        });
        const assignment = assignmentSchema.parse({
          id: "card",
          templateId: "biot-worker-card",
          documentDate: "2026-09-22",
          protocolDate: "2026-09-21",
          trainingSubject: "Синтетическая проверка",
          result: "Подтверждённое тестовое значение",
          biotCategory: "WORKER",
          hours: "10",
          productionHours: "16",
          validUntil: "2027-09-22",
          biotCheckType: "PERIODIC",
        });
        const draft = draftSchema.parse({
          kind: "PERSON",
          title: "=1+1",
          items: [
            {
              id: "p",
              fullNameRu: "=1+1",
              fullNameKz: "Ғалым Әділбек",
              positionRu: "Синтетический инженер",
              workplaceRu: "Синтетическое предприятие",
              photoAssetId: photoId,
              assignments: [
                assignment,
                { ...assignment, id: "protocol", templateId: "biot-protocol" },
              ],
            },
          ],
        });
        const saved = await createRequest(c, draft);
        requestId = saved.id;
        await patchRequest(c, saved.id, { expectedRevision: 0, draft });
        revision = 1;
        const key = randomUUID();
        await finalize(c, saved.id, { expectedRevision: 1 }, key);
        const card = await db.issuedDocument.findFirstOrThrow({
          where: { requestId: saved.id, templateId: "biot-worker-card" },
        });
        const protocol = await db.issuedDocument.findFirstOrThrow({
          where: { requestId: saved.id, templateId: "biot-protocol" },
        });
        const jobs = await db.generationJob.findMany({
          where: { requestId: saved.id, kind: "DOCX" },
        });
        const cardJob = jobs.find((j) => j.documentId === card.id)!;
        const snapshot = await db.renderInputSnapshot.findUniqueOrThrow({
          where: { id: cardJob.snapshotId },
        });
        assert.equal(
          (snapshot.input as any).items[0].protocolNumber,
          protocol.number,
        );
        // Isolate this tenant's queue so no other test or development worker is involved.
        const claimed = await claimJob(db, "files-test", c.tenantId);
        assert.equal(claimed?.id, cardJob.id);
        const artifact = await executeJob(
          db,
          store,
          claimed!,
          "files-test",
          new AbortController().signal,
        );
        const first = await readArtifact(c, artifact.id);
        const second = await openArtifact(c, artifact.id);
        const parts: Buffer[] = [];
        for await (const chunk of second.stream) parts.push(Buffer.from(chunk));
        assert.deepEqual(Buffer.concat(parts), first.buffer);
        assert.equal(
          hash(first.buffer.toString("base64")),
          hash((await readArtifact(c, artifact.id)).buffer.toString("base64")),
        );
        const profileBefore = await db.issuerProfileVersion.findFirstOrThrow({
          where: { tenantId: c.tenantId },
          orderBy: { version: "desc" },
        });
        await saveProfile(c, {
          ...(profileBefore.profile as object),
          nameRu: "Изменённые после выпуска реквизиты синтетического центра",
        });
        const templateBefore = await db.templateVersion.findUniqueOrThrow({
          where: { id: snapshot.templateVersionId! },
        });
        const changedTemplate = await store.put(
          Buffer.concat([
            await store.read(
              templateBefore.storageKey,
              templateBefore.checksum,
            ),
            Buffer.from("\nSynthetic later resource version\n"),
          ]),
          "docx",
        );
        await db.templateVersion.create({
          data: {
            tenantId: c.tenantId,
            templateId: templateBefore.templateId,
            version: `${templateBefore.version}-synthetic-later`,
            storageKey: changedTemplate.storageKey,
            checksum: changedTemplate.sha256,
            contract: templateBefore.contract as any,
            approved: false,
          },
        });
        assert.notEqual(changedTemplate.sha256, templateBefore.checksum);
        assert.deepEqual(
          (await readArtifact(c, artifact.id)).buffer,
          first.buffer,
        );
        assert.equal(
          (
            await db.renderInputSnapshot.findUniqueOrThrow({
              where: { id: snapshot.id },
            })
          ).inputHash,
          snapshot.inputHash,
        );
        const before = await db.numberReservation.count({
          where: { tenantId: c.tenantId },
        });
        // Remove exactly this disposable test artifact, after resolving through ArtifactStore's path guard.
        await unlink(store.path(artifact.storageKey));
        await assert.rejects(readArtifact(c, artifact.id), /отсутствует/);
        assert.equal(
          (await requestDetail(c, saved.id)).artifacts.find(
            (a) => a.id === artifact.id,
          )?.availability,
          "MISSING",
        );
        const restored = await restoreArtifact(c, artifact.id, {
          reason: "Имитирована утрата файла в тестовом хранилище",
        });
        const replay = await restoreArtifact(c, artifact.id, {
          reason: "Имитирована утрата файла в тестовом хранилище",
        });
        assert.deepEqual(
          restored.jobs.map((j) => j.id),
          replay.jobs.map((j) => j.id),
        );
        assert.equal(
          await db.numberReservation.count({ where: { tenantId: c.tenantId } }),
          before,
        );
        const record = await db.generationJob.update({
          where: { id: restored.jobs[0].id },
          data: {
            status: "RUNNING",
            fencingToken: 1,
            leaseOwner: "restore-test",
            leaseUntil: new Date(Date.now() + 30000),
            attempts: 1,
          },
        });
        const reconstructed = await executeJob(
          db,
          store,
          record,
          "restore-test",
          new AbortController().signal,
        );
        assert.equal(reconstructed.provenance, "RECONSTRUCTED");
        assert.notEqual(reconstructed.id, artifact.id);
        assert.equal(
          await db.artifact.count({ where: { id: artifact.id } }),
          1,
        );
        assert.equal(
          await db.issuance.count({ where: { requestId: saved.id } }),
          1,
        );
        const response = await finalize(
          c,
          saved.id,
          { expectedRevision: 1 },
          randomUUID(),
        );
        assert.deepEqual(
          response,
          await finalize(c, saved.id, { expectedRevision: 1 }, key),
        );
      },
    );
    await t.test(
      "full XLSX retains literal formula text and all documents independent of pagination",
      async () => {
        const output = await registryExport(c, { format: "XLSX" }, requestId);
        assert.equal(output.buffer.subarray(0, 2).toString(), "PK");
        const parsed = await importPreview(c, {
          buffer: output.buffer,
          size: output.buffer.length,
          originalname: "registry.xlsx",
        } as Express.Multer.File);
        assert.equal(parsed.total, 2);
        assert.ok(parsed.columns.includes("registrationNumber"));
        assert.ok(parsed.rows.some((r) => r.values.includes("=1+1")));
        const history = await listRequests(c, { pageSize: 1 });
        assert.equal(history.items.length, 1);
        assert.ok(history.total >= 2);
      },
    );
    await t.test(
      "old saved file remains searchable and byte-identical beyond 55 newer requests",
      async () => {
        const artifact = await db.artifact.findFirstOrThrow({
          where: {
            requestId,
            tenantId: c.tenantId,
            provenance: "RECONSTRUCTED",
          },
        });
        const before = (await readArtifact(c, artifact.id)).buffer;
        for (let n = 0; n < 55; n++)
          await createRequest(c, {
            kind: "PERSON",
            title: `Новая синтетическая заявка ${n}`,
          });
        const page = await listRequests(c, { page: 3, pageSize: 20 });
        assert.equal(page.total, 57);
        assert.ok(page.items.some((row) => row.id === requestId));
        const search = await listRequests(c, { search: requestId });
        assert.equal(search.total, 1);
        assert.deepEqual((await readArtifact(c, artifact.id)).buffer, before);
        assert.equal(await db.issuance.count({ where: { requestId } }), 1);
        const output = await registryExport(c, { format: "XLSX" });
        const parsed = await importPreview(c, {
          buffer: output.buffer,
          size: output.buffer.length,
          originalname: "all-history.xlsx",
        } as Express.Multer.File);
        // Full history includes the earlier 100-row partial draft as well as
        // the two finalized documents; empty new drafts have no export rows.
        assert.equal(parsed.total, 102);
        assert.ok(parsed.columns.includes("status"));
        assert.equal(
          parsed.rows.filter((row) => row.values.includes("FINALIZED")).length,
          2,
        );
        const filteredHistory = await listRequests(c, { history: "true" });
        assert.equal(filteredHistory.total, 1);
        assert.equal(filteredHistory.items[0].id, requestId);
        assert.equal((await listRequests(c, { history: "false" })).total, 57);
        const historyExport = await registryExport(c, {
          format: "XLSX",
          history: true,
        });
        const parsedHistory = await importPreview(c, {
          buffer: historyExport.buffer,
          size: historyExport.buffer.length,
          originalname: "history.xlsx",
        } as Express.Multer.File);
        assert.equal(parsedHistory.total, 2);
      },
    );
  } finally {
    await db.$disconnect();
  }
});
