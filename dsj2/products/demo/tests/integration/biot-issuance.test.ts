import { assertTestDatabase } from "./test-database";
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { db, hash, type Context } from "../../apps/api/src/core";
import { provision } from "../../scripts/setup";
import {
  draftSchema,
  itemSchema,
  assignmentSchema,
  type Draft,
} from "../../packages/contracts/src";
import {
  createRequest,
  patchRequest,
  finalize,
  requestDetail,
  preview,
  namespace,
} from "../../apps/api/src/requests";
import { saveProfile } from "../../apps/api/src/settings";
function context(tenantId: string, userId: string): Context {
  return {
    tenantId,
    userId,
    role: "ADMIN",
    sessionId: "test",
    csrfHash: "test",
    correlationId: randomUUID(),
  };
}
function fixture(n = 1): Draft {
  return draftSchema.parse({
    kind: "PERSON",
    title: "Синтетическая заявка",
    demoMode: true,
    items: Array.from({ length: n }, (_, i) =>
      itemSchema.parse({
        id: randomUUID(),
        fullNameRu: `Синтетический Получатель ${i}`,
        fullNameKz: `Ә Ғ Қ Ң Ө Ұ Ү Һ І ${i}`,
        positionRu: "Инженер",
        positionKz: "Маман",
        assignments: [
          assignmentSchema.parse({
            id: randomUUID(),
            templateId: "biot-worker-card",
            documentDate: "2026-09-22",
            trainingStart: "2026-09-20",
            trainingEnd: "2026-09-21",
            protocolDate: "2026-09-21",
            trainingSubject: "Синтетическая программа",
            result: "Тестовое значение",
            biotCategory: "WORKER",
            hours: "10",
            productionHours: "16",
            validUntil: "2027-09-22",
            biotCheckType: "PERIODIC",
          }),
        ],
      }),
    ),
  });
}
test("BIOT category and linked credential issuance in isolated PostgreSQL", async (t) => {
  assertTestDatabase();
  const suffix = randomUUID();
  const a = await provision({
    email: `biot-a-${suffix}@example.test`,
    password: "Synthetic-BIOT-Password!",
    name: "Синтетический центр БиОТ А",
    sample: true,
  });
  const b = await provision({
    email: `biot-b-${suffix}@example.test`,
    password: "Synthetic-BIOT-Password!",
    name: "Синтетический центр БиОТ Б",
    sample: true,
  });
  const ca = context(a.tenantId, a.userId),
    cb = context(b.tenantId, b.userId);
  await t.test(
    "explicit BIOT category rejects insufficient practical hours before allocation and persists corrected snapshot fields",
    async () => {
      const draft = fixture();
      Object.assign(draft.items[0].assignments[0], {
        biotCategory: "WORKER",
        hours: "10",
        productionHours: "15",
        validUntil: "2027-09-22",
      });
      const request = await createRequest(ca, draft);
      const before = await db.numberReservation.count({
        where: { tenantId: ca.tenantId },
      });
      await assert.rejects(
        finalize(ca, request.id, { expectedRevision: 0 }, randomUUID()),
        (error: any) =>
          error.getStatus() === 422 &&
          error
            .getResponse()
            .details.some(
              (issue: any) => issue.code === "BIOT_PRODUCTION_HOURS_MIN",
            ),
      );
      assert.equal(
        await db.issuance.count({ where: { requestId: request.id } }),
        0,
      );
      assert.equal(
        await db.numberReservation.count({ where: { tenantId: ca.tenantId } }),
        before,
      );
      draft.items[0].assignments[0].productionHours = "16";
      await patchRequest(ca, request.id, { expectedRevision: 0, draft });
      await finalize(ca, request.id, { expectedRevision: 1 }, randomUUID());
      const snapshots = await db.renderInputSnapshot.findMany({
        where: { requestId: request.id, templateVersionId: { not: null } },
      });
      assert.ok(snapshots.length);
      for (const snapshot of snapshots) {
        const assignment = (snapshot.input as any).items[0].assignment;
        assert.equal(assignment.biotCategory, "WORKER");
        assert.equal(assignment.hours, "10");
        assert.equal(assignment.productionHours, "16");
        assert.equal(assignment.validUntil, "2027-09-22");
      }
    },
  );
  await t.test(
    "BIOT worker and special protocols link their own credentials; customer fallback is frozen without rewriting the draft",
    async () => {
      const profile = await db.issuerProfileVersion.findFirstOrThrow({
        where: { tenantId: ca.tenantId },
        orderBy: { version: "desc" },
      });
      await saveProfile(ca, {
        ...(profile.profile as object),
        headName: "Синтетический Руководитель",
        bin: "000000000002",
        cityRu: "Синтетический город",
        commission: Array.from({ length: 3 }, (_, i) => ({
          name: `Синтетический Член ${i}`,
          position: "Синтетическая должность",
        })),
      });
      const customer = await db.customerOrganization.create({
        data: {
          tenantId: ca.tenantId,
          nameRu: "Предприятие для нормативного протокола",
          nameKz: "Нормативтік хаттама кәсіпорны",
          bin: "000000000001",
          addressRu: "Синтетический адрес предприятия",
          addressKz: "Кәсіпорынның сынақ мекенжайы",
        },
      });
      const draft = fixture(2);
      draft.kind = "COMPANY";
      draft.customerId = customer.id;
      for (const [index, item] of draft.items.entries()) {
        item.workplaceRu = "";
        item.workplaceKz = "";
        const special = index === 1;
        const base = {
          ...item.assignments[0],
          biotCategory: special ? "OHS_SPECIALIST_SPECIAL" : "WORKER",
          hours: special ? "40" : "10",
          productionHours: special ? undefined : "16",
          validUntil: special ? "2029-09-22" : "2027-09-22",
          biotCheckType: "PERIODIC",
          biotIndustryRu: "Синтетическая отрасль",
          biotIndustryKz: "Сынақ саласы",
          biotKnowledgeResult: "80%",
          biotProctoringResult: "Фактический синтетический результат",
        };
        item.assignments = [
          assignmentSchema.parse({
            ...base,
            id: `credential-${index}`,
            templateId: special ? "biot-itr-certificate" : "biot-worker-card",
          }),
          assignmentSchema.parse({
            ...base,
            id: `protocol-${index}`,
            templateId: special ? "biot-itr-protocol" : "biot-protocol",
          }),
        ];
      }
      await assert.rejects(
        createRequest(cb, draft),
        (error: any) => error.getStatus() === 404,
      );
      const request = await createRequest(ca, draft);
      await assert.rejects(
        preview(cb, request.id, { expectedRevision: 0 }),
        (error: any) => error.getStatus() === 404,
      );
      await preview(ca, request.id, { expectedRevision: 0 });
      assert.equal(
        await db.issuance.count({ where: { requestId: request.id } }),
        0,
      );
      await finalize(ca, request.id, { expectedRevision: 0 }, randomUUID());
      assert.equal(namespace("biot-itr-certificate"), "BIOT:CERTIFICATE");
      const documents = await db.issuedDocument.findMany({
        where: { requestId: request.id },
      });
      const snapshots = await db.renderInputSnapshot.findMany({
        where: {
          requestId: request.id,
          issuanceId: { not: null },
          templateVersionId: { not: null },
        },
      });
      assert.equal(snapshots.length, 4);
      for (const snapshot of snapshots) {
        assert.equal(snapshot.inputHash, hash(snapshot.input));
        const input = snapshot.input as any;
        const row = input.items[0];
        assert.equal(row.workplaceRu, customer.nameRu);
        assert.equal(row.employerBin, customer.bin);
        assert.equal(row.employerAddressRu, customer.addressRu);
        assert.equal(row.employerAddressKz, customer.addressKz);
        const special = input.templateId.startsWith("biot-itr-");
        const credential = documents.find(
          (document) =>
            document.templateId ===
            (special ? "biot-itr-certificate" : "biot-worker-card"),
        )!;
        const protocol = documents.find(
          (document) =>
            document.templateId ===
            (special ? "biot-itr-protocol" : "biot-protocol"),
        )!;
        assert.equal(row.protocolNumber, protocol.number);
        if (input.templateId.endsWith("-protocol")) {
          assert.equal(row.credentialNumber, credential.number);
          assert.notEqual(row.credentialNumber, protocol.number);
        }
      }
      const saved = await requestDetail(ca, request.id);
      assert.equal(saved.items[0].workplaceRu, "");
      assert.equal(saved.items[1].employerBin, undefined);
      await db.customerOrganization.update({
        where: { id: customer.id },
        data: { bin: "000000000003", addressRu: "Адрес после выдачи" },
      });
      assert.deepEqual(
        await db.renderInputSnapshot.findMany({
          where: { id: { in: snapshots.map((snapshot) => snapshot.id) } },
          orderBy: { id: "asc" },
        }),
        [...snapshots].sort((left, right) => left.id.localeCompare(right.id)),
      );
    },
  );
}).finally(() => db.$disconnect());
