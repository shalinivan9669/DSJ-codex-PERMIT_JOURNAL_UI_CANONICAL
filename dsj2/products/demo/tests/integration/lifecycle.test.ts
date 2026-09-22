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
  listRequests,
  preview,
  correction,
  cancelRequest,
  namespace,
} from "../../apps/api/src/requests";
import { saveProfile, updateNumbering } from "../../apps/api/src/settings";
import { retryJob } from "../../apps/api/src/files";
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
            hours: "8",
          }),
        ],
      }),
    ),
  });
}
test("real PostgreSQL lifecycle, tenant isolation, concurrency and >1000 issuance invariants", async (t) => {
  assert.match(
    process.env.DATABASE_URL || "",
    /demo_test|demo_integration/,
    "Use a named disposable database",
  );
  assertTestDatabase();
  const suffix = randomUUID();
  const a = await provision({
    email: `a-${suffix}@example.test`,
    password: "Integration-Only-Password!",
    name: "Центр А",
    sample: true,
  });
  const b = await provision({
    email: `b-${suffix}@example.test`,
    password: "Integration-Only-Password!",
    name: "Центр Б",
    sample: true,
  });
  const ca = context(a.tenantId, a.userId),
    cb = context(b.tenantId, b.userId);
  let issued: { id: string; revision: number };
  await t.test(
    "A06 two tenants and two customers, partial save, RU/KZ, stale revision",
    async () => {
      const customers = await Promise.all([
        db.customerOrganization.create({
          data: {
            tenantId: a.tenantId,
            nameRu: "Заказчик А",
            nameKz: "А тапсырыс беруші",
          },
        }),
        db.customerOrganization.create({
          data: {
            tenantId: b.tenantId,
            nameRu: "Заказчик Б",
            nameKz: "Б тапсырыс беруші",
          },
        }),
      ]);
      await assert.rejects(
        createRequest(ca, {
          ...fixture(),
          kind: "COMPANY",
          customerId: customers[1].id,
        }),
        /Заказчик/,
      );
      const row = fixture();
      row.items[0].assignments = [];
      const created = await createRequest(ca, row);
      assert.equal(created.revision, 0);
      assert.equal(
        await db.issuance.count({ where: { requestId: created.id } }),
        0,
      );
      await assert.rejects(requestDetail(cb, created.id), /найдена/);
      const updated = await patchRequest(ca, created.id, {
        expectedRevision: 0,
        draft: row,
      });
      assert.equal(updated.revision, 1);
      assert.equal(
        (await requestDetail(ca, created.id)).items[0].fullNameKz,
        row.items[0].fullNameKz,
      );
      await assert.rejects(
        patchRequest(ca, created.id, { expectedRevision: 0, draft: row }),
        /оператором/,
      );
      await assert.rejects(
        db.printRequest.update({
          where: { id: created.id },
          data: { customerId: customers[1].id },
        }),
      );
    },
  );
  await t.test(
    "A13 20 parallel finalizations allocate 20 unique numbers",
    async () => {
      const drafts = await Promise.all(
        Array.from({ length: 20 }, () => createRequest(ca, fixture())),
      );
      const results = await Promise.all(
        drafts.map((d) =>
          finalize(ca, d.id, { expectedRevision: 0 }, randomUUID()),
        ),
      );
      assert.equal(results.length, 20);
      const docs = await db.issuedDocument.findMany({
        where: {
          tenantId: a.tenantId,
          requestId: { in: drafts.map((d) => d.id) },
        },
      });
      assert.equal(new Set(docs.map((d) => d.number)).size, 20);
      issued = drafts[0];
    },
  );
  await t.test(
    "A14/A15 20 same-key repeats, lost reply and mismatched request",
    async () => {
      const d = await createRequest(ca, fixture());
      const key = randomUUID();
      const results = await Promise.all(
        Array.from({ length: 20 }, () =>
          finalize(ca, d.id, { expectedRevision: 0 }, key),
        ),
      );
      assert.equal(new Set(results.map((x) => hash(x))).size, 1);
      assert.deepEqual(
        await finalize(ca, d.id, { expectedRevision: 0 }, key),
        results[0],
      );
      await assert.rejects(
        finalize(ca, d.id, { expectedRevision: 1 }, key),
        /ключ/,
      );
      const different = await createRequest(ca, fixture());
      await assert.rejects(
        finalize(ca, different.id, { expectedRevision: 0 }, key),
        /ключ/,
      );
      assert.equal(await db.issuance.count({ where: { requestId: d.id } }), 1);
    },
  );
  await t.test(
    "A16 different keys same revision have one issuance, no registered patch",
    async () => {
      const d = await createRequest(ca, fixture());
      const results = await Promise.all(
        Array.from({ length: 20 }, () =>
          finalize(ca, d.id, { expectedRevision: 0 }, randomUUID()),
        ),
      );
      assert.equal(new Set(results.map((x) => hash(x))).size, 1);
      assert.equal(await db.issuance.count({ where: { requestId: d.id } }), 1);
      await assert.rejects(
        patchRequest(ca, d.id, { expectedRevision: 0, draft: fixture() }),
        /Оформленная/,
      );
    },
  );
  await t.test(
    "A09 company 12 recipients and 18 assignments; PS separate registration",
    async () => {
      const customer = await db.customerOrganization.create({
        data: {
          tenantId: a.tenantId,
          nameRu: "Синтетический заказчик",
          nameKz: "Синтетикалық тапсырыс беруші",
        },
      });
      const draft = fixture(12);
      draft.kind = "COMPANY";
      draft.customerId = customer.id;
      for (let i = 0; i < 6; i++)
        draft.items[i].assignments.push({
          ...draft.items[i].assignments[0],
          id: randomUUID(),
          templateId: i === 0 ? "ps-witness" : "biot-protocol",
        });
      const d = await createRequest(ca, draft);
      await finalize(ca, d.id, { expectedRevision: 0 }, randomUUID());
      const docs = await db.issuedDocument.findMany({
        where: { requestId: d.id },
      });
      assert.equal(docs.length, 18);
      assert.ok(
        docs.find((x) => x.templateId === "ps-witness")?.registrationNumber,
      );
    },
  );
  await t.test(
    "protocol field mapping preserves reason/education and PS credential number independently of protocol registration",
    async () => {
      const draft = fixture();
      const base = draft.items[0].assignments[0];
      draft.items[0].assignments = [
        {
          ...base,
          id: "ptm",
          templateId: "ptm-protocol",
          reason: "Повторная проверка знаний",
        },
        {
          ...base,
          id: "pb",
          templateId: "pb-protocol",
          education: "Высшее техническое образование",
        },
        { ...base, id: "ps-protocol", templateId: "ps-protocol" },
        { ...base, id: "ps-card", templateId: "ps-card" },
      ];
      const request = await createRequest(ca, draft);
      await finalize(ca, request.id, { expectedRevision: 0 }, randomUUID());
      const documents = await db.issuedDocument.findMany({
        where: { requestId: request.id },
      });
      const snapshots = await db.renderInputSnapshot.findMany({
        where: { requestId: request.id },
      });
      const inputs = snapshots.map((snapshot) => snapshot.input as any);
      assert.equal(
        inputs.find((input) => input.templateId === "ptm-protocol").items[0]
          .assignment.reason,
        "Повторная проверка знаний",
      );
      assert.equal(
        inputs.find((input) => input.templateId === "pb-protocol").items[0]
          .assignment.education,
        "Высшее техническое образование",
      );
      const ps = inputs.find((input) => input.templateId === "ps-protocol")
        .items[0];
      assert.equal(
        ps.credentialNumber,
        documents.find((d) => d.templateId === "ps-card")!.number,
      );
      assert.equal(
        ps.protocolNumber,
        documents.find((d) => d.templateId === "ps-protocol")!.number,
      );
      assert.notEqual(ps.protocolNumber, ps.credentialNumber);
      draft.items[0].assignments = [
        { ...base, id: "ps-only", templateId: "ps-protocol" },
      ];
      const standalone = await createRequest(ca, draft);
      await finalize(ca, standalone.id, { expectedRevision: 0 }, randomUUID());
      const standaloneInput = (
        await db.renderInputSnapshot.findFirstOrThrow({
          where: { requestId: standalone.id, templateVersionId: { not: null } },
        })
      ).input as any;
      assert.equal(standaloneInput.items[0].credentialNumber, "");
    },
  );
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
  await t.test(
    "unprintable fields fail before immutable issuance or number allocation; the same draft remains correctable",
    async () => {
      const draft = fixture();
      draft.items[0].fullNameRu = "Оченьдлинное ".repeat(35).trim();
      const request = await createRequest(ca, draft);
      const before = await db.numberReservation.count({
        where: { tenantId: ca.tenantId },
      });
      await assert.rejects(
        finalize(ca, request.id, { expectedRevision: 0 }, randomUUID()),
        (error: any) => {
          assert.equal(error.getStatus(), 422);
          assert.ok(
            error
              .getResponse()
              .details.some(
                (issue: any) =>
                  issue.code === "PRINT_LAYOUT_OVERFLOW" &&
                  issue.rowId === draft.items[0].id,
              ),
          );
          return true;
        },
      );
      assert.equal(
        await db.issuance.count({ where: { requestId: request.id } }),
        0,
      );
      assert.equal(
        await db.numberReservation.count({ where: { tenantId: ca.tenantId } }),
        before,
      );
      assert.equal((await requestDetail(ca, request.id)).status, "DRAFT");
      draft.items[0].fullNameRu = "Исправленный Синтетический Получатель";
      await patchRequest(ca, request.id, { expectedRevision: 0, draft });
      await finalize(ca, request.id, { expectedRevision: 1 }, randomUUID());
      assert.equal(
        await db.issuance.count({ where: { requestId: request.id } }),
        1,
      );
    },
  );
  await t.test(
    "A18 preview/retry allocate no numbers and photo cross-tenant forbidden",
    async () => {
      const before = await db.numberReservation.count({
        where: { tenantId: a.tenantId },
      });
      const d = await createRequest(ca, fixture());
      const result = await preview(ca, d.id, { expectedRevision: 0 });
      assert.equal(result.jobs.length, 2);
      assert.equal(
        await db.numberReservation.count({ where: { tenantId: a.tenantId } }),
        before,
      );
      await db.generationJob.update({
        where: { id: result.jobs[0].id },
        data: { status: "FAILED" },
      });
      await retryJob(ca, result.jobs[0].id);
      assert.equal(
        await db.numberReservation.count({ where: { tenantId: a.tenantId } }),
        before,
      );
      await assert.rejects(retryJob(cb, result.jobs[0].id), /найдено/);
      await assert.rejects(
        createRequest(ca, {
          ...fixture(),
          items: [{ ...fixture().items[0], photoAssetId: randomUUID() }],
        }),
        /Фотография/,
      );
    },
  );
  await t.test(
    "A33/A35 immutable snapshot audit/profile, corrections and cancellation retain numbers",
    async () => {
      const old = await db.issuance.findFirstOrThrow({
        where: { requestId: issued.id },
      });
      const profile = await db.issuerProfileVersion.findFirstOrThrow({
        where: { tenantId: a.tenantId },
        orderBy: { version: "desc" },
      });
      await saveProfile(ca, {
        ...(profile.profile as object),
        nameRu: "Изменённый центр",
      });
      assert.deepEqual(
        (await db.issuance.findUniqueOrThrow({ where: { id: old.id } }))
          .snapshot,
        old.snapshot,
      );
      await assert.rejects(
        db.issuance.update({
          where: { id: old.id },
          data: { inputHash: "changed" },
        }),
      );
      const audit = await db.auditEvent.findFirstOrThrow({
        where: { tenantId: a.tenantId },
      });
      await assert.rejects(db.auditEvent.delete({ where: { id: audit.id } }));
      const corrected = await correction(ca, issued.id, {
        expectedRevision: 0,
        reason: "Исправление синтетической опечатки",
      });
      await finalize(ca, corrected.id, { expectedRevision: 0 }, randomUUID());
      assert.equal(
        await db.issuanceEvent.count({
          where: { issuanceId: old.id, kind: "REPLACED" },
        }),
        1,
      );
      await cancelRequest(ca, corrected.id, {
        expectedRevision: 0,
        reason: "Отмена тестового выпуска",
      });
      assert.equal(
        await db.issuedDocument.count({ where: { issuanceId: old.id } }),
        1,
      );
    },
  );
  await t.test(
    "A17/A39 history beyond 1000 issuances and 50 list rows, profile does not reset namespace",
    async () => {
      for (let batch = 0; batch < 50; batch++) {
        const drafts = await Promise.all(
          Array.from({ length: 20 }, () => createRequest(ca, fixture())),
        );
        await Promise.all(
          drafts.map((d) =>
            finalize(ca, d.id, { expectedRevision: 0 }, randomUUID()),
          ),
        );
      }
      const d = await createRequest(ca, fixture());
      await finalize(ca, d.id, { expectedRevision: 0 }, randomUUID());
      const counter = await db.numberSequence.findUniqueOrThrow({
        where: {
          tenantId_namespace: { tenantId: a.tenantId, namespace: "BIOT:CARD" },
        },
      });
      assert.ok(counter.value > 1000);
      const list = await listRequests(ca, { page: 52, pageSize: 20 });
      assert.ok(list.total > 1000);
      assert.ok(list.items.length > 0);
      const oldest = await listRequests(ca, { search: issued.id });
      assert.equal(oldest.total, 1);
      const reservations = await db.numberReservation.findMany({
        where: { tenantId: a.tenantId, namespace: "BIOT:CARD" },
      });
      assert.equal(
        new Set(reservations.map((r) => r.formattedNumber)).size,
        reservations.length,
      );
      await assert.rejects(
        updateNumbering(ca, {
          namespace: "BIOT:CARD",
          prefix: "X",
          startAt: 1,
        }),
        /первого/,
      );
    },
  );
}).finally(() => db.$disconnect());
