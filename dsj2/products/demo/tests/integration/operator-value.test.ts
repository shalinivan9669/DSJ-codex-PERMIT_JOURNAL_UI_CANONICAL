import { syntheticPdf, objectStreamPdf } from "../fixtures/pdf";
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PRODUCT_ROOT } from "@demo/printing";
import { db, json, type Context } from "../../apps/api/src/core";
import {
  createRequest,
  patchRequest,
  finalize,
} from "../../apps/api/src/requests";
import { provision } from "../../scripts/setup";
import { createApprovalFixture } from "./live-approval-fixture";
import { workingRequest } from "../../apps/api/src/approvals";
import {
  draftSchema,
  itemSchema,
  assignmentSchema,
  courseResultText,
  DEFAULT_POSITIVE_OUTCOME_SOURCE,
  today,
} from "../../packages/contracts/src";
import * as value from "../../apps/api/src/operator-value";
import { assertTestDatabase } from "./test-database";

function c(tenantId: string, userId: string, role = "ADMIN"): Context {
  return {
    tenantId,
    userId,
    role,
    sessionId: "test",
    csrfHash: "test",
    correlationId: randomUUID(),
  };
}
function code(expected: string) {
  return (error: unknown) =>
    typeof error === "object" &&
    error !== null &&
    "getResponse" in error &&
    (error as { getResponse(): { code: string } }).getResponse().code ===
      expected;
}

test("persistent service workflow: obligations, renewal, exact finance, proposals, tenant/customer isolation and revocation", async (t) => {
  assertTestDatabase();
  const suffix = randomUUID();
  const seed = await provision({
    email: `seed-${suffix}@example.test`,
    password: "Synthetic-Operator-Value-Password!",
    name: "Синтетический центр A",
    sample: true,
  });
  const tenantA = await db.tenant.findUniqueOrThrow({
    where: { id: seed.tenantId },
  });
  const tenantB = await db.tenant.create({
    data: { name: "Синтетический центр B", demoOnly: true },
  });
  const admin = await db.user.create({
    data: {
      tenantId: tenantA.id,
      email: `admin-${suffix}@example.test`,
      displayName: "Администратор",
      passwordHash: "unused-test-password",
      role: "ADMIN",
    },
  });
  const second = await db.user.create({
    data: {
      tenantId: tenantB.id,
      email: `b-${suffix}@example.test`,
      displayName: "Администратор B",
      passwordHash: "unused-test-password",
      role: "ADMIN",
    },
  });
  const employer = await db.user.create({
    data: {
      tenantId: tenantA.id,
      email: `employer-${suffix}@example.test`,
      displayName: "Представитель",
      passwordHash: "unused-test-password",
      role: "EMPLOYER",
    },
  });
  const ca = c(tenantA.id, admin.id),
    cb = c(tenantB.id, second.id),
    ce = c(tenantA.id, employer.id, "EMPLOYER");
  const customer = await db.customerOrganization.create({
    data: { tenantId: tenantA.id, nameRu: "Заказчик А" },
  });
  const otherCustomer = await db.customerOrganization.create({
    data: { tenantId: tenantA.id, nameRu: "Другой заказчик" },
  });
  const foreignCustomer = await db.customerOrganization.create({
    data: { tenantId: tenantB.id, nameRu: "Заказчик Б" },
  });
  const recipient = await db.recipient.create({
    data: {
      tenantId: tenantA.id,
      data: { fullNameRu: "Синтетический Қайрат" },
    },
  });
  const sourceDraft = draftSchema.parse({
    kind: "COMPANY",
    customerId: customer.id,
    demoMode: true,
    title: "Исходная заявка",
    items: [
      itemSchema.parse({
        id: "source-row",
        recipientId: recipient.id,
        employerId: customer.id,
        fullNameRu: "Синтетический Қайрат",
        fullNameKz: "Синтетикалық Қайрат",
        positionRu: "Синтетический рабочий",
        positionKz: "Синтетикалық жұмысшы",
        workplaceRu: "Заказчик А",
        assignments: [
          assignmentSchema.parse({
            id: "source-assignment",
            templateId: "biot-worker-card",
            biotCategory: "WORKER",
            documentDate: "2026-09-22",
            protocolDate: "2026-09-22",
            trainingStart: "2026-09-20",
            trainingEnd: "2026-09-22",
            trainingSubject: "Синтетическая программа",
            hours: "24",
            productionHours: "16",
            result: "Исторический подтверждённый результат",
            outcome: {
              status: "PASSED",
              source: "Явно заданный синтетический результат",
            },
            validUntil: "2027-09-22",
          }),
        ],
      }),
    ],
  });
  const approvals = await createApprovalFixture(ca);
  t.after(() => approvals.close());
  const request = await createRequest(ca, sourceDraft);
  await approvals.approve(request.id);
  const serviceOrder = await value.createServiceOrder(ca, {
    title: "Рабочий заказ",
    customerId: customer.id,
    payerId: otherCustomer.id,
    requestIds: [request.id],
    ownerId: admin.id,
  });

  await t.test(
    "order shares existing request; obligations need evidence, normative cannot be waived, raw cross-tenant FK rejects",
    async () => {
      const milestone = await value.createOrderMilestone(ca, serviceOrder.id, {
        label: "Передать комплект",
        category: "TRANSFER",
        source: "NORMATIVE",
        sourceReference: "Синтетическое подтверждённое основание",
      });
      await assert.rejects(
        value.patchOrderMilestone(ca, serviceOrder.id, milestone.id, {
          status: "WAIVED",
          reason: "Тест",
        }),
        code("WAIVER_DENIED"),
      );
      await assert.rejects(
        value.patchOrderMilestone(ca, serviceOrder.id, milestone.id, {
          status: "DONE",
        }),
        code("EVIDENCE_REQUIRED"),
      );
      await assert.rejects(
        value.patchServiceOrder(ca, serviceOrder.id, {
          expectedRevision: 0,
          status: "COMPLETED",
        }),
        code("ORDER_INCOMPLETE"),
      );
      await value.patchOrderMilestone(ca, serviceOrder.id, milestone.id, {
        status: "DONE",
        evidence: "Передача подтверждена получателем, запись №TEST-1",
      });
      const detail = await value.serviceOrderDetail(ca, serviceOrder.id);
      assert.equal(detail.completion.transfer, true);
      assert.equal(detail.completion.documents, false);
      await assert.rejects(
        value.serviceOrderDetail(cb, serviceOrder.id),
        code("NOT_FOUND"),
      );
      await assert.rejects(
        value.createServiceOrder(ca, {
          title: "Подмена",
          customerId: foreignCustomer.id,
        }),
        code("CUSTOMER_NOT_FOUND"),
      );
      await assert.rejects(
        db.serviceOrderRequest.create({
          data: {
            tenantId: tenantB.id,
            orderId: serviceOrder.id,
            requestId: request.id,
          },
        }),
      );
      await assert.rejects(value.listServiceOrders(ce), code("ROLE_DENIED"));
      await assert.rejects(
        value.createServiceOrder(
          { ...ca, role: "VIEWER" },
          { title: "Не разрешено" },
        ),
        code("ROLE_DENIED"),
      );
    },
  );

  await t.test(
    "commercial records use KZT integers and payments never change request history",
    async () => {
      const calculated = await value.saveCommercial(ca, serviceOrder.id, {
        expectedRevision: 0,
        taxBasis: "Согласованная тестовая конфигурация",
        taxRateBasisPoints: 0,
        lines: [
          {
            label: "Одна услуга",
            unit: "PERSON_SERVICE",
            quantity: 3,
            unitPriceMinor: "12345",
          },
        ],
      });
      assert.equal(calculated.totalMinor, "37035");
      await value.recordPayment(ca, serviceOrder.id, {
        amountMinor: "12345",
        occurredOn: "2026-09-24",
        source: "Ручная сверка с тестовой выпиской",
      });
      assert.equal(
        (await value.serviceOrderDetail(ca, serviceOrder.id)).commercial
          .paymentState,
        "PARTIAL",
      );
      const receipt = await value.recordFinancialDocument(ca, serviceOrder.id, {
        type: "INVOICE",
        number: `TEST-${suffix}`,
        documentDate: "2026-09-24",
        source: "Исходный счёт бухгалтерии",
      });
      assert.equal(receipt.orderId, serviceOrder.id);
      await assert.rejects(
        value.recordFinancialDocument(ca, serviceOrder.id, {
          type: "INVOICE",
          number: `TEST-${suffix}`,
          documentDate: "2026-09-24",
          source: "Повтор исходного счёта",
        }),
        code("FINANCIAL_DOCUMENT_EXISTS"),
      );
      assert.equal(
        await db.financialDocument.count({
          where: { tenantId: ca.tenantId, orderId: serviceOrder.id },
        }),
        1,
      );
      assert.equal(
        (await db.printRequest.findUniqueOrThrow({ where: { id: request.id } }))
          .status,
        "DRAFT",
      );
      assert.equal(
        await db.numberReservation.count({ where: { tenantId: ca.tenantId } }),
        0,
      );
      const exported = await value.commercialExchange(ca, serviceOrder.id);
      assert.equal(exported.payer?.id, otherCustomer.id);
      await assert.rejects(
        value.recordPayment({ ...ca, role: "OPERATOR" }, serviceOrder.id, {
          amountMinor: "1",
          occurredOn: "2026-09-24",
          source: "Тест",
        }),
        code("ROLE_DENIED"),
      );
    },
  );

  let membershipId = "";
  await t.test(
    "employer sees only own customers; proposals are revision-pinned and accepted corrections persist",
    async () => {
      const membership = await value.createEmployerMembership(ca, {
        customerId: customer.id,
        userId: employer.id,
        permissions: ["READ", "PROPOSE", "APPROVE_DATA", "DOWNLOAD"],
      });
      membershipId = membership.id;
      await value.createServiceOrder(ca, {
        title: "Чужой заказ",
        customerId: otherCustomer.id,
      });
      let portal = await value.employerPortal(ce);
      assert.equal(portal.orders.length, 1);
      assert.equal(portal.orders[0].id, serviceOrder.id);
      assert.ok(!("commercial" in portal.orders[0]));
      assert.ok(!("contact" in portal.orders[0]));
      const stale = await value.submitEmployerProposal(ce, serviceOrder.id, {
        requestId: request.id,
        requestRevision: request.revision,
        kind: "CONFIRM_LIST",
        message: "Проверено",
      });
      await patchRequest(ca, request.id, {
        expectedRevision: request.revision,
        draft: { ...sourceDraft, title: "Изменённый состав" },
      });
      await assert.rejects(
        value.resolveEmployerProposal(ca, serviceOrder.id, stale.id, {
          status: "ACCEPTED",
          resolution: "Согласовано",
        }),
        code("REVISION_CONFLICT"),
      );
      await value.resolveEmployerProposal(ca, serviceOrder.id, stale.id, {
        status: "REJECTED",
        resolution: "Редакция изменилась",
      });
      await approvals.approve(request.id);
      portal = await value.employerPortal(ce);
      const publishedRevision = portal.orders[0].requests[0].revision;
      assert.equal(publishedRevision, request.revision);
      const proposal = await value.submitEmployerProposal(ce, serviceOrder.id, {
        requestId: request.id,
        requestRevision: publishedRevision,
        kind: "UPDATE_LIST",
        changes: [{ rowId: "source-row", fullNameRu: "Уточнённый Қайрат" }],
      });
      const duplicated = await value.submitEmployerProposal(
        ce,
        serviceOrder.id,
        {
          requestId: request.id,
          requestRevision: publishedRevision,
          kind: "UPDATE_LIST",
          changes: [{ rowId: "source-row", fullNameRu: "Уточнённый Қайрат" }],
        },
      );
      assert.equal(duplicated.id, proposal.id);
      assert.equal(proposal.requestRevision, request.revision + 1);
      await value.resolveEmployerProposal(ca, serviceOrder.id, proposal.id, {
        status: "ACCEPTED",
        resolution: "Сверено с исходником",
      });
      await approvals.approve(request.id);
      const latest = await db.printRequest.findUniqueOrThrow({
        where: { id: request.id },
      });
      assert.equal(latest.revision, request.revision + 2);
      assert.equal(
        draftSchema.parse(latest.draft).items[0].fullNameRu,
        "Уточнённый Қайрат",
      );
      portal = await value.employerPortal(ce);
      assert.equal(
        portal.orders[0].requests[0].rows[0].fullNameRu,
        "Уточнённый Қайрат",
      );
      await assert.rejects(
        value.submitEmployerProposal(ce, serviceOrder.id, {
          requestId: request.id,
          requestRevision: request.revision + 2,
          kind: "UPDATE_LIST",
          changes: [{ rowId: "unauthorized", fullNameRu: "Подмена" }],
        }),
        code("ROW_DENIED"),
      );
      await assert.rejects(
        value.submitEmployerProposal(ce, serviceOrder.id, {
          requestId: request.id,
          requestRevision: request.revision + 2,
          kind: "UPDATE_LIST",
          changes: [{ rowId: "source-row", result: "Успешно" }],
        }),
        code("VALIDATION"),
      );
    },
  );

  await t.test(
    "external evidence records real issuer and retains unverified state until manual verification",
    async () => {
      const evidence = await value.createExternalEvidence(ca, {
        customerId: customer.id,
        recipientId: recipient.id,
        program: "Синтетическая программа",
        issuer: "Другой центр",
        originalNumber: "EXTERNAL-123",
        documentDate: "2026-01-01",
        source: "Предоставлен заказчиком",
      });
      assert.equal(evidence.status, "UNVERIFIED");
      await value.verifyExternalEvidence(ca, evidence.id, {
        status: "VERIFIED",
        verificationNote:
          "Сотрудник вручную сверил эмитента, номер и дату исходного файла",
      });
      assert.equal(
        (await value.listExternalEvidence(ca)).items[0].state,
        "VERIFIED_NO_EXPIRY",
      );
      await assert.rejects(
        value.verifyExternalEvidence(cb, evidence.id, {
          status: "VERIFIED",
          verificationNote: "Подмена",
        }),
        code("NOT_FOUND"),
      );
      await assert.rejects(
        value.addValueAttachment(ca, {
          evidenceId: evidence.id,
          category: "SOURCE",
          source: "От заказчика",
          fileName: "malicious.pdf",
          contentBase64: Buffer.from("<svg onload='alert(1)'></svg>").toString(
            "base64",
          ),
        }),
        code("FILE_TYPE_REJECTED"),
      );
      const pdf = syntheticPdf();
      await assert.rejects(
        value.addValueAttachment(ca, {
          evidenceId: evidence.id,
          category: "SOURCE",
          source: "Синтетическая проверка",
          fileName: "compressed.pdf",
          contentBase64: objectStreamPdf(true).toString("base64"),
        }),
        code("ACTIVE_PDF_REJECTED"),
      );
      const attachment = await value.addValueAttachment(ca, {
        evidenceId: evidence.id,
        category: "SOURCE",
        source: "Синтетический документ",
        fileName: "../test.pdf",
        contentBase64: pdf.toString("base64"),
      });
      assert.deepEqual(
        (await value.readValueAttachment(ca, attachment.id)).bytes,
        pdf,
      );
      for (const extension of ["png", "jpeg"]) {
        const image = readFileSync(
          join(PRODUCT_ROOT, `tests/fixtures/source.${extension}`),
        );
        const stored = await value.addValueAttachment(ca, {
          evidenceId: evidence.id,
          category: "SOURCE",
          source: "Синтетический скан",
          fileName: `source.${extension}`,
          contentBase64: image.toString("base64"),
        });
        assert.deepEqual(
          (await value.readValueAttachment(ca, stored.id)).bytes,
          image,
        );
      }
      await assert.rejects(
        value.addValueAttachment(ca, {
          evidenceId: evidence.id,
          category: "SOURCE",
          source: "Синтетическая проверка",
          fileName: "false.png",
          contentBase64: Buffer.from([
            137, 80, 78, 71, 13, 10, 26, 10,
          ]).toString("base64"),
        }),
        code("IMAGE_INVALID"),
      );
      await assert.rejects(
        value.readValueAttachment(cb, attachment.id),
        code("NOT_FOUND"),
      );
      assert.equal(
        await db.numberReservation.count({ where: { tenantId: ca.tenantId } }),
        0,
      );
    },
  );

  await t.test(
    "immutable versioned rules and private qualification dossier",
    async () => {
      const payload = {
        serviceKey: "TEST",
        title: "Проверенная услуга",
        status: "APPROVED",
        source: "Синтетический согласованный документ",
        applicability: "Только тест",
        checkedOn: "2026-09-24",
        definition: {
          programVersion: "1",
          category: "WORKER",
          compatibleTemplateIds: ["biot-worker-card"],
          requirements: [],
        },
      };
      const first = await value.createServiceRule(ca, payload),
        second = await value.createServiceRule(ca, {
          ...payload,
          title: "Новая версия",
        });
      assert.equal(first.version, 1);
      assert.equal(second.version, 2);
      await assert.rejects(
        db.serviceRuleVersion.update({
          where: { id: first.id },
          data: { title: "Переписанная история" },
        }),
      );
      await assert.rejects(
        value.createDossierRecord(ca, {
          title: "Квалификация преподавателя",
          category: "QUALIFICATION",
          version: "1",
          source: "Тест",
          applicability: "Тест",
          ownerId: admin.id,
          customerVisible: true,
        }),
        code("PERSONAL_DOSSIER_PRIVATE"),
      );
    },
  );

  await t.test(
    "confirmed renewal creates one linked draft across concurrent retries and resets results",
    async () => {
      await finalize(
        ca,
        request.id,
        { expectedRevision: request.revision + 2 },
        randomUUID(),
      );
      const payload = {
        customerId: customer.id,
        recipientId: recipient.id,
        sourceRequestId: request.id,
        sourceRowId: "source-row",
        assignmentId: "source-assignment",
        policySource: "Согласованный источник сроков",
        policyVersion: "test-1",
        basisDate: "2026-09-22",
        nextCheckDate: "2027-09-22",
      };
      const need = await value.createRenewalNeed(ca, payload);
      assert.equal((await value.createRenewalNeed(ca, payload)).id, need.id);
      await assert.rejects(
        value.repeatFromRenewal(ca, need.id, { confirmedCurrent: true }),
        code("CURRENTNESS_REQUIRED"),
      );
      await value.recordRenewalContact(ca, need.id, {
        occurredOn: "2026-09-24",
        channel: "PHONE",
        outcome: "CONFIRMED",
        note: "Заказчик подтвердил актуальность сотрудника и направления",
      });
      const results = await Promise.all(
        Array.from({ length: 4 }, () =>
          value.repeatFromRenewal(ca, need.id, { confirmedCurrent: true }),
        ),
      );
      assert.equal(new Set(results.map((r) => r.id)).size, 1);
      const repeated = await workingRequest(ca, results[0].id);
      const repeatedDraft = draftSchema.parse(repeated.draft);
      assert.equal(repeated.status, "DRAFT");
      assert.equal(
        repeatedDraft.items[0].assignments[0].result,
        courseResultText(
          repeatedDraft.items[0].assignments[0].templateId,
          "PASSED",
        ),
      );
      assert.equal(
        repeatedDraft.items[0].assignments[0].outcome?.source,
        DEFAULT_POSITIVE_OUTCOME_SOURCE,
      );
      assert.equal(repeatedDraft.schemaVersion, 2);
      assert.equal(
        repeatedDraft.commonFields?.documentDate,
        today(tenantA.timezone),
      );
      assert.equal(repeatedDraft.items[0].assignments[0].documentDate, "");
      assert.equal(
        draftSchema.parse(
          (
            await db.printRequest.findUniqueOrThrow({
              where: { id: request.id },
            })
          ).draft,
        ).items[0].assignments[0].result,
        "Исторический подтверждённый результат",
      );
      assert.equal(
        (await db.renewalNeed.findUniqueOrThrow({ where: { id: need.id } }))
          .state,
        "ORDER_AGREED",
      );
      assert.equal(
        await db.renewalContact.count({
          where: { tenantId: ca.tenantId, renewalId: need.id },
        }),
        1,
      );
    },
  );

  await t.test(
    "employer repeat request becomes an operator-reviewed linked order with clean new draft",
    async () => {
      const proposal = await value.submitEmployerProposal(ce, serviceOrder.id, {
        requestId: request.id,
        requestRevision: request.revision + 2,
        kind: "REPEAT_REQUEST",
        message:
          "Подтверждаем актуальность указанного сотрудника и направления",
      });
      const resolved = await value.resolveEmployerProposal(
        ca,
        serviceOrder.id,
        proposal.id,
        {
          status: "ACCEPTED",
          resolution:
            "Актуальность состава и направления подтверждена заказчиком и проверена центром",
        },
      );
      assert.ok(resolved.newRequestId);
      assert.ok(resolved.newOrderId);
      const fresh = await db.printRequest.findUniqueOrThrow({
        where: { id: resolved.newRequestId },
      });
      assert.equal(fresh.status, "DRAFT");
      const freshDraft = draftSchema.parse(
        (await workingRequest(ca, fresh.id)).draft,
      );
      assert.equal(freshDraft.items[0].recipientId, recipient.id);
      assert.equal(
        freshDraft.items[0].assignments[0].result,
        courseResultText(
          freshDraft.items[0].assignments[0].templateId,
          "PASSED",
        ),
      );
      assert.equal(
        freshDraft.items[0].assignments[0].outcome?.source,
        DEFAULT_POSITIVE_OUTCOME_SOURCE,
      );
      assert.equal(freshDraft.schemaVersion, 2);
      assert.equal(
        freshDraft.commonFields?.documentDate,
        today(tenantA.timezone),
      );
      assert.equal(freshDraft.items[0].assignments[0].protocolDate, "");
      assert.ok(
        await db.serviceOrderRequest.findFirst({
          where: {
            tenantId: tenantA.id,
            orderId: resolved.newOrderId,
            requestId: resolved.newRequestId,
          },
        }),
      );
      const link = await db.idempotencyOperation.findUniqueOrThrow({
        where: {
          tenantId_command_idempotencyKey: {
            tenantId: tenantA.id,
            command: "EMPLOYER_REPEAT",
            idempotencyKey: proposal.id,
          },
        },
      });
      assert.equal(
        (link.result as { sourceRequestId: string }).sourceRequestId,
        request.id,
      );
      await assert.rejects(
        value.resolveEmployerProposal(ca, serviceOrder.id, proposal.id, {
          status: "ACCEPTED",
          resolution: "Повтор запроса",
        }),
        code("PROPOSAL_RESOLVED"),
      );
    },
  );

  await t.test(
    "mixed-employer roster is filtered and full list confirmation denied; membership revoke immediately removes access",
    async () => {
      const mixed = await createRequest(
        ca,
        draftSchema.parse({
          ...sourceDraft,
          items: [
            sourceDraft.items[0],
            {
              ...sourceDraft.items[0],
              id: "other-row",
              recipientId: undefined,
              employerId: otherCustomer.id,
              fullNameRu: "Чужой сотрудник",
            },
          ],
        }),
      );
      const mixedOrder = await value.createServiceOrder(ca, {
        title: "Смешанная группа",
        customerId: customer.id,
        requestIds: [mixed.id],
      });
      await approvals.approve(mixed.id);
      const portal = await value.employerPortal(ce);
      const visible = portal.orders.find((o) => o.id === mixedOrder.id)!;
      assert.equal(visible.requests[0].rows.length, 1);
      assert.equal(visible.requests[0].fullRosterAllowed, false);
      assert.ok(!JSON.stringify(portal).includes("Чужой сотрудник"));
      await assert.rejects(
        value.submitEmployerProposal(ce, mixedOrder.id, {
          requestId: mixed.id,
          requestRevision: mixed.revision,
          kind: "CONFIRM_LIST",
        }),
        code("FULL_ROSTER_DENIED"),
      );
      await value.revokeEmployerMembership(ca, membershipId);
      assert.equal((await value.employerPortal(ce)).orders.length, 0);
      await assert.rejects(
        value.submitEmployerProposal(ce, mixedOrder.id, {
          requestId: mixed.id,
          requestRevision: mixed.revision,
          kind: "CLARIFICATION",
          message: "Старый доступ",
        }),
        code("NOT_FOUND"),
      );
      assert.equal(
        (await db.user.findUniqueOrThrow({ where: { id: employer.id } }))
          .sessionVersion,
        2,
      );
    },
  );
  assert.ok(
    (await db.auditEvent.count({ where: { tenantId: ca.tenantId } })) >= 20,
  );
  // Do not delete issued/immutable fixtures; disposable database lifecycle owns cleanup.
  assert.ok(json({ tenantId: ca.tenantId }));
  await db.$disconnect();
});
