import { assertTestDatabase } from "./test-database";
import test from "node:test";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ArtifactStore, PRODUCT_ROOT } from "@demo/printing";
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
  validateRequest,
} from "../../apps/api/src/requests";
import { saveProfile, updateNumbering } from "../../apps/api/src/settings";
import { retryJob } from "../../apps/api/src/files";
import { createApprovalFixture } from "./live-approval-fixture";
import { submitApproval, decideProposal } from "../../apps/api/src/approvals";
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
        workplaceRu: "Синтетическое предприятие",
        workplaceKz: "Синтетикалық кәсіпорын",
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
            outcome: {
              status: "PASSED",
              source: "Явный синтетический факт интеграционной проверки",
            },
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
  const issuer = await db.issuerProfileVersion.findFirstOrThrow({
    where: { tenantId: ca.tenantId },
    orderBy: { version: "desc" },
  });
  await saveProfile(ca, {
    ...(issuer.profile as object),
    cityRu: "Кызылорда",
    cityKz: "Қызылорда",
    commission: Array.from({ length: 3 }, (_, i) => ({
      name: `Синтетический Член Комиссии ${i + 1}`,
      position: i === 0 ? "Председатель" : "Член комиссии",
    })),
  });
  const approvals = await createApprovalFixture(ca);
  t.after(() => approvals.close());
  async function createApprovedRequest(
    c: Context,
    input: unknown,
    direct = false,
  ) {
    const request = await createRequest(c, input);
    if (direct) {
      // The history stress loop exercises the same authenticated actor's server
      // commands and real DB role guard; HTTP/session coverage is above and in
      // the separate security suite, without repeating throttled HTTP 3000 times.
      const submitted = await submitApproval(c, request.id, {
        expectedRevision: request.revision,
      });
      await decideProposal(
        approvals.directorContext,
        submitted.approval.proposalId,
        {
          decision: "APPROVE",
          reason: "Синтетическая проверка истории и нумерации",
          expectedProposalHash: submitted.approval.proposalHash,
        },
      );
      return { ...request, revision: submitted.revision };
    }
    await approvals.approve(request.id);
    return request;
  }
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
      assert.equal(created.revision, 1);
      assert.equal(
        await db.issuance.count({ where: { requestId: created.id } }),
        0,
      );
      await assert.rejects(requestDetail(cb, created.id), /найдена/);
      const updated = await patchRequest(ca, created.id, {
        expectedRevision: created.revision,
        draft: row,
      });
      assert.equal(updated.revision, 2);
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
        Array.from({ length: 20 }, () => createApprovedRequest(ca, fixture())),
      );
      const results = await Promise.all(
        drafts.map((d) =>
          finalize(ca, d.id, { expectedRevision: d.revision }, randomUUID()),
        ),
      );
      assert.equal(results.length, 20);
      const docs = await db.issuedDocument.findMany({
        where: {
          tenantId: a.tenantId,
          requestId: { in: drafts.map((d) => d.id) },
        },
      });
      assert.equal(docs.length, 40);
      assert.equal(
        new Set(
          docs
            .filter((d) => d.templateId === "biot-worker-card")
            .map((d) => d.number),
        ).size,
        20,
      );
      assert.equal(
        new Set(
          docs
            .filter((d) => d.templateId === "biot-protocol")
            .map((d) => d.number),
        ).size,
        20,
      );
      issued = drafts[0];
    },
  );
  await t.test(
    "A14/A15 20 same-key repeats, lost reply and mismatched request",
    async () => {
      const d = await createApprovedRequest(ca, fixture());
      const key = randomUUID();
      const results = await Promise.all(
        Array.from({ length: 20 }, () =>
          finalize(ca, d.id, { expectedRevision: d.revision }, key),
        ),
      );
      assert.equal(new Set(results.map((x) => hash(x))).size, 1);
      assert.deepEqual(
        await finalize(ca, d.id, { expectedRevision: d.revision }, key),
        results[0],
      );
      await assert.rejects(
        finalize(ca, d.id, { expectedRevision: d.revision + 1 }, key),
        /ключ/,
      );
      const different = await createApprovedRequest(ca, fixture());
      await assert.rejects(
        finalize(
          ca,
          different.id,
          { expectedRevision: different.revision },
          key,
        ),
        /ключ/,
      );
      assert.equal(await db.issuance.count({ where: { requestId: d.id } }), 1);
    },
  );
  await t.test(
    "A16 different keys same revision have one issuance, no registered patch",
    async () => {
      const d = await createApprovedRequest(ca, fixture());
      const results = await Promise.all(
        Array.from({ length: 20 }, () =>
          finalize(ca, d.id, { expectedRevision: d.revision }, randomUUID()),
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
    "A09 company 12 recipients receive mandatory kits; PS has separate registration",
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
          biotCategory: i === 0 ? undefined : "WORKER",
          ...(i === 0
            ? { validUntil: "", validityMode: "UNLIMITED" as const }
            : {}),
        });
      const d = await createApprovedRequest(ca, draft);
      assert.deepEqual(
        (await validateRequest(ca, d.id, { expectedRevision: d.revision }))
          .issues,
        [],
      );
      await finalize(ca, d.id, { expectedRevision: d.revision }, randomUUID());
      const docs = await db.issuedDocument.findMany({
        where: { requestId: d.id },
      });
      assert.equal(docs.length, 27);
      assert.equal(
        docs.filter((document) => document.templateId === "biot-worker-card")
          .length,
        12,
      );
      assert.equal(
        docs.filter((document) => document.templateId === "biot-protocol")
          .length,
        12,
      );
      assert.ok(
        docs.find((x) => x.templateId === "ps-witness")?.registrationNumber,
      );
    },
  );
  await t.test(
    "protocol field mapping preserves reason/education and PS credential number independently of protocol registration",
    async () => {
      const draft = fixture();
      const base = {
        ...draft.items[0].assignments[0],
        biotCategory: undefined,
      };
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
        {
          ...base,
          id: "ps-protocol",
          templateId: "ps-protocol",
          validUntil: "",
          validityMode: "UNLIMITED",
        },
        {
          ...base,
          id: "ps-card",
          templateId: "ps-card",
          validUntil: "",
          validityMode: "UNLIMITED",
        },
      ];
      const request = await createApprovedRequest(ca, draft);
      await finalize(
        ca,
        request.id,
        { expectedRevision: request.revision },
        randomUUID(),
      );
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
        {
          ...base,
          id: "ps-only",
          templateId: "ps-protocol",
          validUntil: "",
          validityMode: "UNLIMITED",
        },
      ];
      const standalone = await createApprovedRequest(ca, draft);
      await finalize(
        ca,
        standalone.id,
        { expectedRevision: standalone.revision },
        randomUUID(),
      );
      const suppliedCard = await db.issuedDocument.findFirstOrThrow({
        where: { requestId: standalone.id, templateId: "ps-card" },
      });
      const suppliedProtocolInput = (
        await db.renderInputSnapshot.findFirstOrThrow({
          where: {
            requestId: standalone.id,
            templateVersionId: { not: null },
            input: { path: ["templateId"], equals: "ps-protocol" },
          },
        })
      ).input as any;
      assert.equal(
        suppliedProtocolInput.items[0].credentialNumber,
        suppliedCard.number,
      );
    },
  );
  await t.test(
    "pinned historical PBv15 geometry rejects overflow before immutable issuance or numbering; the same draft remains correctable",
    async () => {
      // Active PBv17 preserves the raw reference fill policy. This retained
      // geometry regression belongs to PBv15's immutable transformed form.
      // Register its exact original bytes only in a fresh synthetic tenant;
      // current assets and their registry records remain untouched.
      const center = await provision({
        email: `historical-pb-overflow-${randomUUID()}@example.test`,
        password: "Synthetic-historical-overflow-only!",
        name: "СИНТЕТИЧЕСКАЯ историческая геометрия PBv15",
        sample: true,
      });
      const ca = context(center.tenantId, center.userId);
      const approvals = await createApprovalFixture(ca);
      t.after(() => approvals.close());
      const active = await db.templateVersion.findFirstOrThrow({
        where: { tenantId: ca.tenantId, templateId: "pb-card" },
        orderBy: { createdAt: "desc" },
      });
      const bytes = await readFile(
        join(PRODUCT_ROOT, "assets/templates/pb-card.v15.docx"),
      );
      const stored = await new ArtifactStore().put(bytes, "docx");
      const checksum = createHash("sha256").update(bytes).digest("hex");
      await db.templateVersion.create({
        data: {
          tenantId: ca.tenantId,
          templateId: "pb-card",
          version: "15",
          checksum,
          storageKey: stored.storageKey,
          approved: true,
          contract: {
            ...(active.contract as Record<string, unknown>),
            version: 15,
            file: "pb-card.v15.docx",
            sha256: checksum,
          },
        },
      });
      const draft = fixture();
      draft.items[0].fullNameRu = "Ш".repeat(79);
      // The synthetic wide token stays below the 80-character lexical guard
      // and the 500-character contract. Its physical width cannot fit even
      // at the renderer's minimum readable font on the fixed-size PB card.
      draft.items[0].assignments[0].templateId = "pb-card";
      delete draft.items[0].assignments[0].biotCategory;
      const request = await createRequest(ca, draft);
      await approvals.approve(request.id);
      const before = await db.numberReservation.count({
        where: { tenantId: ca.tenantId },
      });
      await assert.rejects(
        finalize(
          ca,
          request.id,
          { expectedRevision: request.revision },
          randomUUID(),
        ),
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
      draft.items[0].fullNameKz = "Синтетикалық Тыңдаушы";
      draft.items[0].positionRu = "Инженер";
      draft.items[0].positionKz = "Маман";
      draft.items[0].workplaceRu = "Синтетическое предприятие";
      draft.items[0].workplaceKz = "Синтетикалық кәсіпорын";
      const corrected = await patchRequest(ca, request.id, {
        expectedRevision: request.revision,
        draft,
      });
      await approvals.approve(request.id);
      assert.deepEqual(
        (
          await validateRequest(ca, request.id, {
            expectedRevision: corrected.revision,
          })
        ).issues,
        [],
      );
      await finalize(
        ca,
        request.id,
        { expectedRevision: corrected.revision },
        randomUUID(),
      );
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
      const result = await preview(ca, d.id, { expectedRevision: d.revision });
      assert.equal(result.jobs.length, 4);
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
        expectedRevision: issued.revision,
        reason: "Исправление синтетической опечатки",
      });
      await approvals.approve(corrected.id);
      await finalize(
        ca,
        corrected.id,
        { expectedRevision: corrected.revision },
        randomUUID(),
      );
      assert.equal(
        await db.issuanceEvent.count({
          where: { issuanceId: old.id, kind: "REPLACED" },
        }),
        0,
      );
      assert.notEqual(
        (await requestDetail(ca, corrected.id)).lifecycle,
        "ISSUED",
        "Rendering and director approval do not establish a signed replacement",
      );
      await cancelRequest(ca, corrected.id, {
        expectedRevision: corrected.revision,
        reason: "Отмена тестового выпуска",
      });
      assert.equal(
        (await requestDetail(ca, corrected.id)).status,
        "FINALIZED",
        "Cancellation waits for a separate director decision",
      );
      await approvals.approve(corrected.id);
      assert.equal((await requestDetail(ca, corrected.id)).status, "CANCELLED");
      assert.equal(
        await db.issuedDocument.count({ where: { issuanceId: old.id } }),
        2,
      );
    },
  );
  await t.test(
    "A17/A39 history beyond 1000 issuances and 50 list rows, profile does not reset namespace",
    async () => {
      for (let batch = 0; batch < 50; batch++) {
        const drafts = await Promise.all(
          Array.from({ length: 20 }, () =>
            createApprovedRequest(ca, fixture(), true),
          ),
        );
        await Promise.all(
          drafts.map((d) =>
            finalize(ca, d.id, { expectedRevision: d.revision }, randomUUID()),
          ),
        );
      }
      const d = await createApprovedRequest(ca, fixture(), true);
      await finalize(ca, d.id, { expectedRevision: d.revision }, randomUUID());
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
