import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { assertTestDatabase } from "./test-database";
import { db, json, hash, type Context } from "../../apps/api/src/core";
import { provision } from "../../scripts/setup";
import {
  createRequest,
  requestDetail,
  patchRequest,
} from "../../apps/api/src/requests";
import {
  applyImportReconciliation,
  previewImportReconciliation,
} from "../../apps/api/src/imports";
import {
  collectRegistryRows,
  registryExport,
  store,
  readArtifact,
  uploadPhoto,
} from "../../apps/api/src/files";
import {
  controlSheet,
  confirmControlSheet,
  exportControlSheet,
  clarificationRequest,
  listTransfers,
  recordTransfer,
} from "../../apps/api/src/delivery-approval";
import {
  saveExportProfile,
  listExportProfiles,
} from "../../apps/api/src/delivery";
import { draftSchema, itemSchema } from "../../packages/contracts/src";

const people = (name: string, importId: string) =>
  (
    JSON.parse(readFileSync(join(__dirname, "../fixtures", name), "utf8"))
      .people as Record<string, string>[]
  ).map((person, index) => {
    const { externalPersonKey, ...rest } = person;
    return itemSchema.parse({
      ...rest,
      externalId: externalPersonKey,
      id: externalPersonKey,
      importId,
      sourceRow: index + 2,
    });
  });
test("revised import uses one atomic revision, explicit exclusion, replay conflict, tenant guards; mixed BIOT registry uses saved actual protocol", async (t) => {
  assertTestDatabase();
  const who = await provision({
    email: `import-delivery-${randomUUID()}@example.test`,
    password: "Synthetic-import-delivery!",
    name: "Synthetic import centre",
    sample: true,
  });
  const c: Context = {
    ...who,
    role: "ADMIN",
    sessionId: "test",
    csrfHash: "test",
    correlationId: randomUUID(),
  };
  try {
    const importId = randomUUID();
    const old = people("ot-people.json", "old-source");
    const revised = people("ot-people-revised.json", importId);
    await db.importBatch.create({
      data: {
        id: importId,
        tenantId: c.tenantId,
        checksum: hash(importId),
        rows: json({
          rows: revised.map((row) => ({
            sourceRow: row.sourceRow,
            errors: [],
          })),
        }),
      },
    });
    const preserved = await db.recipient.create({
      data: { tenantId: c.tenantId, data: json(old[98]) },
    });
    old[98].recipientId = preserved.id;
    old[0].assignments = [
      {
        id: "assessment",
        templateId: "pb-card",
        documentDate: "2026-09-22",
        protocolDate: "",
        trainingStart: "",
        trainingEnd: "",
        validUntil: "",
        trainingSubject: "Фактическая программа",
        result: "Подтверждённый результат",
        reason: "",
        education: "",
        hours: "",
        externalBasisNumber: "",
        protocolMode: "INDIVIDUAL",
      },
    ];
    const request = await createRequest(c, {
      kind: "COMPANY",
      title: "Сверка списка",
      items: old,
    });
    const data = {
      expectedRevision: 0,
      importId,
      rows: revised,
      operationKey: randomUUID(),
    };
    await t.test(
      "preview keeps the original 100-person fixture counts and 102 fit without exclusion",
      async () => {
        const preview = await previewImportReconciliation(
          c,
          request.id,
          dataWithoutOperation(data),
        );
        assert.deepEqual(preview.counts, {
          added: 2,
          changed: 3,
          unchanged: 95,
          missing: 2,
          ambiguous: 0,
        });
        assert.equal(preview.retainedTotal, 102);
        assert.equal(preview.rowLimit, 250);
        const retainRequest = await createRequest(c, {
          kind: "COMPANY",
          title: "Сверка с сохранением отсутствующих",
          items: old,
        });
        await applyImportReconciliation(c, retainRequest.id, {
          ...data,
          operationKey: randomUUID(),
        });
        const retained = await requestDetail(c, retainRequest.id);
        assert.equal(retained.items.length, 102);
        assert.deepEqual(retained.items[0].assignments, old[0].assignments);
        assert.ok(retained.items.some((row) => row.id === "DEMO-P099"));
        assert.ok(retained.items.some((row) => row.id === "DEMO-P100"));
        assert.equal((await requestDetail(c, request.id)).revision, 0);
        assert.equal(
          await db.idempotencyOperation.count({
            where: { tenantId: c.tenantId, idempotencyKey: data.operationKey },
          }),
          0,
        );
      },
    );
    await t.test(
      "251 reconciled recipients fail atomically; one explicit exclusion allows exactly 250",
      async () => {
        const capacityImportId = randomUUID();
        const additional = Array.from({ length: 149 }, (_, index) =>
          itemSchema.parse({
            id: `capacity-${index + 1}`,
            externalId: `capacity-${index + 1}`,
            fullNameRu: `Дополнительный Слушатель ${index + 1}`,
          }),
        );
        const source = [...revised, ...additional].map((row, index) => ({
          ...row,
          importId: capacityImportId,
          sourceRow: index + 2,
        }));
        await db.importBatch.create({
          data: {
            id: capacityImportId,
            tenantId: c.tenantId,
            checksum: hash(capacityImportId),
            rows: json({
              rows: source.map((row) => ({
                sourceRow: row.sourceRow,
                errors: [],
              })),
            }),
          },
        });
        const capacityRequest = await createRequest(c, {
          kind: "COMPANY",
          title: "Сверка на границе 250",
          items: [...old, ...additional],
        });
        const operation = {
          expectedRevision: 0,
          importId: capacityImportId,
          rows: source,
          operationKey: randomUUID(),
        };
        const preview = await previewImportReconciliation(
          c,
          capacityRequest.id,
          dataWithoutOperation(operation),
        );
        assert.equal(preview.retainedTotal, 251);
        assert.equal(preview.counts.missing, 2);
        await assert.rejects(
          applyImportReconciliation(c, capacityRequest.id, operation),
          /превышает 250/,
        );
        const unchanged = await requestDetail(c, capacityRequest.id);
        assert.equal(unchanged.revision, 0);
        assert.equal(unchanged.items.length, 249);
        assert.deepEqual(unchanged.items[0].assignments, old[0].assignments);
        assert.equal(
          await db.idempotencyOperation.count({
            where: {
              tenantId: c.tenantId,
              idempotencyKey: operation.operationKey,
            },
          }),
          0,
        );
        await applyImportReconciliation(c, capacityRequest.id, {
          ...operation,
          excludeMissingIds: ["DEMO-P099"],
          exclusionReason: "Подтверждённый состав заявки на 250 человек",
        });
        const accepted = await requestDetail(c, capacityRequest.id);
        assert.equal(accepted.revision, 1);
        assert.equal(accepted.items.length, 250);
        assert.ok(!accepted.items.some((row) => row.id === "DEMO-P099"));
        assert.ok(accepted.items.some((row) => row.id === "DEMO-P100"));
        assert.deepEqual(accepted.items[0].assignments, old[0].assignments);
        assert.equal(
          await db.recipient.count({ where: { id: preserved.id } }),
          1,
        );
      },
    );
    await t.test(
      "explicit draft-only exclusion retains people, exact assignment and history; retry is same result",
      async () => {
        const apply = {
          ...data,
          excludeMissingIds: ["DEMO-P099", "DEMO-P100"],
          exclusionReason: "Уточнённый состав этого заказа",
        };
        const [first, replay] = await Promise.all([
          applyImportReconciliation(c, request.id, apply),
          applyImportReconciliation(c, request.id, apply),
        ]);
        assert.deepEqual(first, replay);
        const saved = await requestDetail(c, request.id);
        assert.equal(saved.revision, 1);
        assert.equal(saved.items.length, 100);
        assert.deepEqual(saved.items[0].assignments, old[0].assignments);
        assert.equal(
          await db.recipient.count({ where: { id: preserved.id } }),
          1,
        );
        assert.equal(
          saved.items.find((row) => row.externalId === "DEMO-P101")?.assignments
            .length,
          0,
        );
        assert.equal(saved.items[0].personnelNumber, "000001");
        await assert.rejects(
          applyImportReconciliation(c, request.id, {
            ...apply,
            exclusionReason: "Другой payload",
          }),
          /уже использован/,
        );
        await assert.rejects(
          applyImportReconciliation(c, request.id, {
            ...apply,
            operationKey: randomUUID(),
          }),
          /изменена/,
        );
      },
    );
    await t.test(
      "foreign import batch and saved export profile cannot cross tenant",
      async () => {
        const foreign = await db.tenant.create({
          data: { name: "Foreign synthetic centre" },
        });
        const foreignBatch = await db.importBatch.create({
          data: {
            tenantId: foreign.id,
            checksum: randomUUID(),
            rows: json({ rows: [] }),
          },
        });
        await assert.rejects(
          previewImportReconciliation(c, request.id, {
            expectedRevision: 1,
            importId: foreignBatch.id,
            rows: [],
          }),
          /Импорт не найден/,
        );
        const profile = await saveExportProfile(c, {
          name: "Штатный реестр",
          columns: [
            { field: "personnelNumber", title: "Табельный номер" },
            { field: "fullNameRu", title: "ФИО" },
          ],
        });
        assert.equal((await listExportProfiles(c)).items.length, 1);
        assert.equal(
          (await listExportProfiles({ ...c, tenantId: foreign.id })).items
            .length,
          0,
        );
        await assert.rejects(
          registryExport(
            { ...c, tenantId: foreign.id },
            { profileId: profile.id },
          ),
          /Профиль реестра не найден/,
        );
        const exported = await registryExport(
          c,
          { profileId: profile.id, format: "TSV" },
          request.id,
        );
        assert.match(
          exported.buffer.toString(),
          /^Табельный номер\tФИО\r\n000001\t/,
        );
        const customer = await db.customerOrganization.create({
          data: {
            tenantId: c.tenantId,
            nameRu: "Синтетический заказчик профиля",
          },
        });
        const customerProfile = await saveExportProfile(c, {
          name: "Профиль только указанного заказчика",
          customerId: customer.id,
          contact: "Синтетический контакт",
          columns: [{ field: "personnelNumber", title: "Табельный" }],
        });
        await assert.rejects(
          registryExport(c, { profileId: customerProfile.id }, request.id),
          /другому заказчику/,
        );
        const ownRequest = await createRequest(
          c,
          draftSchema.parse({
            kind: "PERSON",
            customerId: customer.id,
            items: [
              {
                id: "profile-scope",
                personnelNumber: "000009",
                fullNameRu: "Синтетический Получатель",
              },
            ],
          }),
        );
        assert.match(
          (
            await registryExport(
              c,
              { profileId: customerProfile.id, format: "TSV" },
              ownRequest.id,
            )
          ).buffer.toString(),
          /000009/,
        );
        const foreignCustomer = await db.customerOrganization.create({
          data: { tenantId: foreign.id, nameRu: "Чужой заказчик" },
        });
        await assert.rejects(
          saveExportProfile(c, {
            name: "Запрещённый профиль",
            customerId: foreignCustomer.id,
            columns: [{ field: "fullNameRu", title: "ФИО" }],
          }),
          /Заказчик не найден/,
        );
        assert.equal(
          await db.auditEvent.count({
            where: {
              tenantId: c.tenantId,
              entityId: customerProfile.id,
              action: "EXPORT_PROFILE_SAVED",
            },
          }),
          1,
        );
      },
    );
    await t.test(
      "mixed worker and ITR share one person yet export their own protocol from immutable snapshot",
      async () => {
        const draft = draftSchema.parse({
          kind: "PERSON",
          items: [
            {
              id: "same-person",
              fullNameRu: "Синтетический ИТР и Рабочий",
              assignments: [
                {
                  id: "worker",
                  templateId: "biot-worker-card",
                  documentDate: "2026-09-22",
                },
                {
                  id: "itr",
                  templateId: "biot-itr-certificate",
                  documentDate: "2026-09-22",
                },
                {
                  id: "worker-protocol",
                  templateId: "biot-protocol",
                  documentDate: "2026-09-22",
                },
                {
                  id: "itr-protocol",
                  templateId: "biot-itr-protocol",
                  documentDate: "2026-09-22",
                },
              ],
            },
          ],
        });
        const mixed = await createRequest(c, draft);
        const issuer = await db.issuerProfileVersion.findFirstOrThrow({
          where: { tenantId: c.tenantId },
        });
        const issuance = await db.issuance.create({
          data: {
            tenantId: c.tenantId,
            requestId: mixed.id,
            sourceRevision: 0,
            snapshot: json({ draft }),
            inputHash: hash(draft),
            profileVersionId: issuer.id,
            createdBy: c.userId,
          },
        });
        for (const assignment of draft.items[0].assignments) {
          const template = await db.templateVersion.findFirstOrThrow({
            where: { tenantId: c.tenantId, templateId: assignment.templateId },
          });
          await db.issuedDocument.create({
            data: {
              tenantId: c.tenantId,
              requestId: mixed.id,
              issuanceId: issuance.id,
              rowId: "same-person",
              assignmentId: assignment.id,
              templateVersionId: template.id,
              templateId: assignment.templateId,
              namespace: "BIOT:TEST",
              number: assignment.id.toUpperCase() + "-001",
              documentDate: "2026-09-22",
            },
          });
        }
        const rows = (await collectRegistryRows(c, {}, mixed.id)).rows;
        assert.equal(
          rows.find((row) => row.assignment?.id === "worker")?.protocolNumber,
          "WORKER-PROTOCOL-001",
        );
        assert.equal(
          rows.find((row) => row.assignment?.id === "itr")?.protocolNumber,
          "ITR-PROTOCOL-001",
        );
        const exported = await registryExport(
          c,
          {
            format: "XLSX",
            profile: {
              name: "Контроль",
              columns: [
                { field: "templateId", title: "Форма" },
                { field: "protocolNumber", title: "Протокол" },
              ],
            },
          },
          mixed.id,
        );
        const cells = JSON.parse(
          execFileSync(
            process.env.DEMO_PYTHON || "python",
            [
              "-I",
              "-c",
              "import sys,io,json;from openpyxl import load_workbook; w=load_workbook(io.BytesIO(sys.stdin.buffer.read()));print(json.dumps(list(w.active.values),ensure_ascii=False))",
            ],
            { input: exported.buffer, encoding: "utf8", windowsHide: true },
          ),
        );
        assert.deepEqual(
          cells.find((row: string[]) => row[0] === "biot-itr-certificate"),
          ["biot-itr-certificate", "ITR-PROTOCOL-001"],
        );
        assert.deepEqual(
          cells.find((row: string[]) => row[0] === "biot-worker-card"),
          ["biot-worker-card", "WORKER-PROTOCOL-001"],
        );
        const snapshot = await db.renderInputSnapshot.create({
          data: {
            tenantId: c.tenantId,
            requestId: mixed.id,
            revision: 0,
            issuanceId: issuance.id,
            profileVersionId: issuer.id,
            input: json({ draft }),
            inputHash: hash(draft),
          },
        });
        const job = await db.generationJob.create({
          data: {
            tenantId: c.tenantId,
            requestId: mixed.id,
            issuanceId: issuance.id,
            snapshotId: snapshot.id,
            kind: "XLSX",
            logicalKey: randomUUID(),
            status: "SUCCEEDED",
          },
        });
        const saved = await store.put(exported.buffer, "xlsx");
        const artifact = await db.artifact.create({
          data: {
            tenantId: c.tenantId,
            jobId: job.id,
            requestId: mixed.id,
            issuanceId: issuance.id,
            format: "XLSX",
            ...saved,
            mimeType: exported.mimeType,
            fileName: "synthetic-registry.xlsx",
            rendererVersion: "synthetic-test",
            inputHash: hash(draft),
          },
        });
        await db.generationJob.update({
          where: { id: job.id },
          data: { artifactId: artifact.id },
        });
        const bundle = await registryExport(
          c,
          {
            format: "ZIP",
            artifactIds: [artifact.id],
            profile: {
              name: "Выдача",
              columns: [{ field: "fullNameRu", title: "ФИО" }],
            },
          },
          mixed.id,
        );
        assert.equal(bundle.buffer.subarray(0, 2).toString(), "PK");
        assert.equal(
          (await listTransfers(c, mixed.id)).items.length,
          0,
          "downloading is not handover",
        );
        await recordTransfer(c, mixed.id, {
          artifactIds: [artifact.id],
          recipient: "Синтетический представитель",
          occurredOn: "2026-09-24",
          method: "PAPER",
        });
        assert.equal((await listTransfers(c, mixed.id)).items.length, 1);
        await assert.rejects(
          recordTransfer(c, mixed.id, {
            artifactIds: [artifact.id],
            recipient: "Синтетический представитель",
            occurredOn: "2026-09-24",
            method: "PAPER",
            kind: "REPRINT_DAMAGED",
          }),
          /причину/,
        );
        await recordTransfer(c, mixed.id, {
          artifactIds: [artifact.id],
          recipient: "Синтетический представитель",
          occurredOn: "2026-09-24",
          method: "PAPER",
          kind: "REPRINT_DAMAGED",
          reason: "Синтетический бумажный экземпляр испорчен при печати",
        });
        const history = (await listTransfers(c, mixed.id)).items;
        assert.deepEqual(history.map((event) => event.action).sort(), [
          "DAMAGED_COPY_REPRINT",
          "DOCUMENTS_TRANSFERRED",
        ]);
        assert.equal(
          await db.auditEvent.count({
            where: {
              tenantId: c.tenantId,
              action: "ARTIFACT_RECONSTRUCTION_REQUESTED",
              entityId: artifact.id,
            },
          }),
          0,
        );
        assert.equal(
          await db.issuance.count({ where: { requestId: mixed.id } }),
          1,
        );
        assert.deepEqual(
          (await readArtifact(c, artifact.id)).buffer,
          exported.buffer,
        );
      },
    );
    await t.test(
      "100 stable-key synthetic photographs persist as real PhotoAssets in one draft update",
      async () => {
        const source = readFileSync(
          join(__dirname, "../fixtures/source-photo.png"),
        );
        const updates = new Map<string, string>();
        for (let start = 0; start < old.length; start += 3) {
          await Promise.all(
            old.slice(start, start + 3).map(async (item) => {
              const photo = await uploadPhoto(
                c,
                {
                  buffer: source,
                  size: source.length,
                  originalname: item.externalId + ".png",
                } as Express.Multer.File,
                {},
              );
              updates.set(item.id, photo.assetId);
            }),
          );
        }
        const photoRequest = await createRequest(c, {
          kind: "COMPANY",
          items: old.map((item) => ({
            ...item,
            photoAssetId: updates.get(item.id),
          })),
        });
        assert.equal(
          await db.photoAsset.count({
            where: { tenantId: c.tenantId, id: { in: [...updates.values()] } },
          }),
          100,
        );
        const actual = await requestDetail(c, photoRequest.id);
        assert.equal(
          actual.items.filter((item) => item.photoAssetId).length,
          100,
        );
        assert.ok(!JSON.stringify(actual.items).includes("data:image"));
        assert.equal(
          await db.numberReservation.count({ where: { tenantId: c.tenantId } }),
          0,
        );
      },
    );
    await t.test(
      "control sheet confirmation follows meaningful hash, clarification is current, PDF has no issuance or numbering",
      async () => {
        const draft = draftSchema.parse({
          kind: "PERSON",
          title: "Внутренняя заметка",
          items: [
            {
              id: "control-person",
              sourceRow: 12,
              personnelNumber: "000012",
              fullNameRu: "",
              fullNameKz: "Ә Ғ Қ Ң Ө Ұ Ү Һ І",
            },
          ],
        });
        const request = await createRequest(c, draft);
        const sheet = await controlSheet(c, request.id);
        assert.match(sheet.title, /не выданный документ/);
        await confirmControlSheet(c, request.id, {
          expectedRevision: 0,
          meaningfulHash: sheet.meaningfulHash,
          confirmedBy: "Синтетический представитель",
          source: "Сверка по телефону",
        });
        assert.equal(
          (await controlSheet(c, request.id)).confirmations[0].current,
          true,
        );
        const message = await clarificationRequest(c, request.id);
        assert.match(message.text, /Строка 12 — таб. № 000012/);
        assert.ok(!message.text.includes("control-person"));
        assert.equal(message.sent, false);
        await patchRequest(c, request.id, {
          expectedRevision: 0,
          draft: { ...draft, title: "Новая внутренняя заметка" },
        });
        assert.equal(
          (await controlSheet(c, request.id)).meaningfulHash,
          sheet.meaningfulHash,
        );
        const changed = {
          ...draft,
          items: [{ ...draft.items[0], fullNameRu: "Проверенный Получатель" }],
        };
        await patchRequest(c, request.id, {
          expectedRevision: 1,
          draft: changed,
        });
        assert.equal(
          (await controlSheet(c, request.id)).confirmations[0].current,
          false,
        );
        await assert.rejects(
          confirmControlSheet(c, request.id, {
            expectedRevision: 2,
            meaningfulHash: sheet.meaningfulHash,
            confirmedBy: "Представитель",
            source: "Старое подтверждение",
          }),
          /изменились/,
        );
        assert.equal(
          (await clarificationRequest(c, request.id)).items.length,
          0,
        );
        const pdf = await exportControlSheet(c, request.id, { format: "PDF" });
        assert.equal(pdf.buffer.subarray(0, 4).toString(), "%PDF");
        assert.equal(
          await db.issuance.count({ where: { requestId: request.id } }),
          0,
        );
        assert.equal(
          await db.numberReservation.count({ where: { tenantId: c.tenantId } }),
          0,
        );
      },
    );
  } finally {
    await db.$disconnect();
  }
});
function dataWithoutOperation<T extends { operationKey: string }>(data: T) {
  const { operationKey: _operationKey, ...preview } = data;
  return preview;
}
