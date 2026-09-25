import { syntheticPdf } from "../fixtures/pdf";
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { db, json, type Context } from "../../apps/api/src/core";
import {
  draftSchema,
  itemSchema,
  assignmentSchema,
} from "../../packages/contracts/src";
import * as value from "../../apps/api/src/operator-value";
import {
  evidenceMatrix,
  scanRenewals,
} from "../../apps/api/src/renewal-matrix";
import { createRequest } from "../../apps/api/src/requests";
import { assertTestDatabase } from "./test-database";

function code(expected: string) {
  return (error: unknown) =>
    typeof error === "object" &&
    error !== null &&
    "getResponse" in error &&
    (error as { getResponse(): { code: string } }).getResponse().code ===
      expected;
}

test("pinned policy requirements, mixed-employer scope, explicit history scan and source-based matrix", async (t) => {
  assertTestDatabase();
  const tenant = await db.tenant.create({
    data: { name: "Синтетический центр матрицы" },
  });
  const foreign = await db.tenant.create({
    data: { name: "Другой центр матрицы" },
  });
  const user = await db.user.create({
    data: {
      tenantId: tenant.id,
      email: `matrix-${randomUUID()}@example.test`,
      passwordHash: "unused",
      displayName: "Администратор",
      role: "ADMIN",
    },
  });
  const c: Context = {
    tenantId: tenant.id,
    userId: user.id,
    role: "ADMIN",
    sessionId: "test",
    csrfHash: "test",
    correlationId: randomUUID(),
  };
  const ca = await db.customerOrganization.create({
    data: { tenantId: tenant.id, nameRu: "Работодатель A" },
  });
  const cb = await db.customerOrganization.create({
    data: { tenantId: tenant.id, nameRu: "Работодатель B" },
  });
  const outsider = await db.customerOrganization.create({
    data: { tenantId: tenant.id, nameRu: "Посторонний работодатель" },
  });
  const people = await Promise.all(
    ["Человек A", "Человек B", "Нет сведений", "Внешний источник"].map(
      (fullNameRu) =>
        db.recipient.create({
          data: { tenantId: tenant.id, data: { fullNameRu } },
        }),
    ),
  );
  await db.recipientEmployment.createMany({
    data: people.map((person, index) => ({
      tenantId: tenant.id,
      recipientId: person.id,
      employerId: index === 1 ? cb.id : ca.id,
      createdBy: user.id,
    })),
  });
  const rule = await value.createServiceRule(c, {
    serviceKey: "BIOT_TEST",
    title: "Согласованная тестовая программа",
    status: "APPROVED",
    source: "Синтетический проверенный источник",
    applicability: "Тестовые рабочие",
    checkedOn: "2026-09-24",
    effectiveFrom: "2026-01-01",
    effectiveTo: "2026-12-31",
    definition: {
      programVersion: "1",
      category: "WORKER",
      compatibleTemplateIds: ["biot-worker-card", "biot-protocol"],
      requirements: [
        {
          key: "source",
          label: "Подтвердить исходные сведения",
          source: "NORMATIVE",
          stage: "DATA",
        },
        {
          key: "handover",
          label: "Передать согласованный комплект",
          source: "CONTRACT",
          stage: "TRANSFER",
        },
        {
          key: "review",
          label: "Рекомендованная сверка",
          source: "RECOMMENDATION",
          stage: "EVIDENCE",
        },
      ],
    },
  });
  const eventId = randomUUID();
  const draft = draftSchema.parse({
    kind: "COMPANY",
    customerId: ca.id,
    title: "Общее событие двух работодателей",
    demoMode: true,
    events: [
      {
        id: eventId,
        title: "Общая проверка",
        protocolTemplateId: "biot-protocol",
        serviceRuleVersionId: rule.id,
        commonFields: {
          protocolDate: "2026-09-24",
          trainingSubject: rule.title,
        },
      },
    ],
    items: people.slice(0, 2).map((person, index) =>
      itemSchema.parse({
        id: randomUUID(),
        recipientId: person.id,
        employerId: index === 0 ? ca.id : cb.id,
        fullNameRu: `Участник ${index}`,
        assignments: [
          assignmentSchema.parse({
            id: randomUUID(),
            templateId: "biot-worker-card",
            biotCategory: "WORKER",
            eventId,
            protocolMode: "GROUP",
            trainingSubject: rule.title,
            protocolDate: "2026-09-24",
            documentDate: "2026-09-24",
            validUntil: "2099-09-24",
            outcome: {
              status: "PASSED",
              source: "Синтетический фактический результат",
            },
          }),
        ],
      }),
    ),
  });
  const request = await createRequest(c, draft);
  const orderA = await value.createServiceOrder(c, {
    title: "Заказ A",
    customerId: ca.id,
    requestIds: [request.id],
    ownerId: user.id,
    dueDate: "2026-10-01",
  });
  const orderB = await value.createServiceOrder(c, {
    title: "Заказ B",
    customerId: cb.id,
    requestIds: [request.id],
  });

  await t.test(
    "link materializes each pinned requirement once and mixed employer receives only its rows",
    async () => {
      await value.patchServiceOrder(c, orderA.id, {
        expectedRevision: 0,
        requestIds: [request.id],
      });
      for (const order of [orderA, orderB]) {
        const detail = await value.serviceOrderDetail(c, order.id);
        assert.equal(detail.requests.length, 1);
        assert.equal(detail.requests[0].itemCount, 1);
        assert.equal(detail.milestones.length, 3);
        assert.deepEqual(
          new Set(detail.milestones.map((item) => item.source)),
          new Set(["NORMATIVE", "CONTRACT", "RECOMMENDATION"]),
        );
        assert.ok(
          detail.milestones.every((item) =>
            item.sourceReference.includes(rule.id),
          ),
        );
        const mandatory = detail.milestones.find(
          (item) => item.source === "NORMATIVE",
        )!;
        await assert.rejects(
          value.patchOrderMilestone(c, order.id, mandatory.id, {
            status: "WAIVED",
            reason: "Пропустить",
          }),
          code("WAIVER_DENIED"),
        );
      }
      const ordersBefore = await db.serviceOrder.count({
        where: { tenantId: c.tenantId },
      });
      await assert.rejects(
        value.createServiceOrder(c, {
          title: "Состав без выбранного работодателя",
          customerId: outsider.id,
          requestIds: [request.id],
        }),
        code("EMPLOYER_SCOPE_REQUIRED"),
      );
      await assert.rejects(
        value.createServiceOrder(c, {
          title: "Чужой состав",
          customerId: outsider.id,
          employerId: outsider.id,
          requestIds: [request.id],
        }),
        code("CUSTOMER_MISMATCH"),
      );
      assert.equal(
        await db.serviceOrder.count({ where: { tenantId: c.tenantId } }),
        ordersBefore,
      );
      const employer = await db.user.create({
        data: {
          tenantId: tenant.id,
          email: `matrix-employer-${randomUUID()}@example.test`,
          passwordHash: "unused",
          displayName: "Работодатель B",
          role: "EMPLOYER",
        },
      });
      const employerContext = { ...c, userId: employer.id, role: "EMPLOYER" };
      await value.createEmployerMembership(c, {
        customerId: cb.id,
        userId: employer.id,
        permissions: ["READ", "PROPOSE", "APPROVE_DATA", "DOWNLOAD"],
      });
      const portal = await value.employerPortal(employerContext);
      assert.equal(portal.orders.length, 1);
      assert.equal(portal.orders[0].id, orderB.id);
      assert.deepEqual(
        portal.orders[0].requests[0].rows.map((row) => row.id),
        [draft.items[1].id],
      );
      assert.equal(portal.orders[0].requests[0].fullRosterAllowed, false);
      await value.submitEmployerProposal(employerContext, orderB.id, {
        requestId: request.id,
        requestRevision: 0,
        kind: "UPDATE_LIST",
        changes: [
          { rowId: draft.items[1].id, positionRu: "Согласованная должность" },
        ],
      });
      await assert.rejects(
        value.submitEmployerProposal(employerContext, orderB.id, {
          requestId: request.id,
          requestRevision: 0,
          kind: "UPDATE_LIST",
          changes: [{ rowId: draft.items[0].id, fullNameRu: "Не разрешено" }],
        }),
        code("ROW_DENIED"),
      );
      await assert.rejects(
        value.submitEmployerProposal(employerContext, orderB.id, {
          requestId: request.id,
          requestRevision: 0,
          kind: "CONFIRM_LIST",
        }),
        code("FULL_ROSTER_DENIED"),
      );
    },
  );

  await t.test(
    "order attachments retain an exact event binding and reject an unrelated event even inside the same tenant",
    async () => {
      const bytes = syntheticPdf("Synthetic event signed scan");
      const attached = await value.addValueAttachment(c, {
        orderId: orderA.id,
        eventId,
        category: "SIGNED_SCAN",
        source: "Синтетический подписанный внешний экземпляр",
        fileName: "event-scan.pdf",
        contentBase64: bytes.toString("base64"),
      });
      const dossier = await value.assembleOrderDossier(c, orderA.id);
      assert.equal(
        dossier.attachments.find((item) => item.id === attached.id)!.eventId,
        eventId,
      );
      assert.equal(
        dossier.events.find((event) => event.id === eventId)!.requestId,
        request.id,
      );
      assert.deepEqual(
        (await value.readValueAttachment(c, attached.id)).bytes,
        bytes,
      );
      const otherEventId = randomUUID();
      const unrelated = draftSchema.parse({
        ...draft,
        events: [{ ...draft.events![0], id: otherEventId }],
        items: draft.items.map((row) => ({
          ...row,
          assignments: row.assignments.map((assignment) => ({
            ...assignment,
            eventId: otherEventId,
          })),
        })),
      });
      await createRequest(c, unrelated);
      await assert.rejects(
        value.addValueAttachment(c, {
          orderId: orderA.id,
          eventId: otherEventId,
          category: "MATERIAL",
          source: "Не то событие",
          fileName: "wrong.pdf",
          contentBase64: bytes.toString("base64"),
        }),
        code("ORDER_EVENT_NOT_FOUND"),
      );
      await assert.rejects(
        db.valueAttachment.create({
          data: {
            tenantId: tenant.id,
            orderId: orderA.id,
            eventId: otherEventId,
            category: "MATERIAL",
            source: "DB bypass rejected",
            fileName: "wrong.pdf",
            mimeType: "application/pdf",
            storageKey: randomUUID(),
            sha256: "test",
            size: 1,
            createdBy: user.id,
          },
        }),
      );
      assert.equal(
        (await value.serviceOrderDetail(c, orderA.id)).milestones.find(
          (item) => item.source === "NORMATIVE",
        )!.status,
        "PENDING",
      );
    },
  );

  // Synthetic immutable history, not a claim that rendering/physical printing ran.
  const profile = await db.issuerProfileVersion.create({
    data: { tenantId: tenant.id, version: 1, profile: {}, createdBy: user.id },
  });
  const template = await db.templateVersion.create({
    data: {
      tenantId: tenant.id,
      templateId: "biot-worker-card",
      version: "test",
      checksum: "test",
      storageKey: randomUUID(),
      contract: {},
    },
  });
  const issuance = await db.issuance.create({
    data: {
      tenantId: tenant.id,
      requestId: request.id,
      sourceRevision: 0,
      snapshot: json({ draft }),
      inputHash: "test",
      profileVersionId: profile.id,
      createdBy: user.id,
    },
  });
  await db.printRequest.update({
    where: { id: request.id },
    data: { status: "FINALIZED" },
  });
  for (const row of draft.items)
    await db.issuedDocument.create({
      data: {
        tenantId: tenant.id,
        requestId: request.id,
        issuanceId: issuance.id,
        rowId: row.id,
        assignmentId: row.assignments[0].id,
        templateVersionId: template.id,
        templateId: template.templateId,
        namespace: "BIOT:CARD",
        number: `SAVED-${row.id}`,
        documentDate: "2026-09-24",
      },
    });

  await t.test(
    "database refuses a GROUP owner with null event revision before any deferred membership checks",
    async () => {
      await assert.rejects(
        db.issuedDocument.create({
          data: {
            tenantId: tenant.id,
            requestId: request.id,
            issuanceId: issuance.id,
            ownerKind: "GROUP",
            groupEventId: eventId,
            groupEventRevision: null,
            templateVersionId: template.id,
            templateId: "biot-protocol",
            namespace: "BIOT:PROTOCOL",
            number: "INVALID-NULL-REVISION",
            documentDate: "2026-09-24",
          },
        }),
        (error) => String(error).includes("document_owner"),
      );
    },
  );

  await t.test(
    "administrator scan derives only actual dates, deduplicates and preserves closed review state",
    async () => {
      const missingEvent = randomUUID();
      const missingDraft = draftSchema.parse({
        ...draft,
        events: [{ ...draft.events![0], id: missingEvent }],
        items: [
          {
            ...draft.items[1],
            id: randomUUID(),
            assignments: [
              {
                ...draft.items[1].assignments[0],
                id: randomUUID(),
                eventId: missingEvent,
                protocolDate: "",
                trainingEnd: "",
                validUntil: "",
              },
            ],
          },
        ],
      });
      const missingRequest = await createRequest(c, missingDraft);
      const missingIssuance = await db.issuance.create({
        data: {
          tenantId: tenant.id,
          requestId: missingRequest.id,
          sourceRevision: 0,
          snapshot: json({ draft: missingDraft }),
          inputHash: "test-missing-dates",
          profileVersionId: profile.id,
          createdBy: user.id,
        },
      });
      await db.printRequest.update({
        where: { id: missingRequest.id },
        data: { status: "FINALIZED" },
      });
      await db.issuedDocument.create({
        data: {
          tenantId: tenant.id,
          requestId: missingRequest.id,
          issuanceId: missingIssuance.id,
          rowId: missingDraft.items[0].id,
          assignmentId: missingDraft.items[0].assignments[0].id,
          templateVersionId: template.id,
          templateId: template.templateId,
          namespace: "BIOT:CARD",
          number: "SAVED-UNKNOWN-VALIDITY",
          documentDate: "2026-09-24",
        },
      });
      const input = {
        ruleVersionId: rule.id,
        contactLeadDays: 30,
        confirmedPolicy: true,
      };
      const scans = await Promise.all([
        scanRenewals(c, input),
        scanRenewals(c, input),
        scanRenewals(c, input),
      ]);
      assert.equal(
        scans.reduce((sum, scan) => sum + scan.created, 0),
        2,
      );
      assert.equal(
        scans.reduce((sum, scan) => sum + scan.existing, 0),
        4,
      );
      const result = scans[0];
      assert.equal(result.exclusions.MISSING_ACTUAL_DATES, 1);
      assert.ok(
        result.items.every(
          (item) => item.sourceRequestId !== missingRequest.id,
        ),
      );
      assert.equal(result.nextCursor, null);
      assert.equal(result.items[0].contactAfter, "2099-08-25");
      assert.ok(
        result.items.every(
          (item) =>
            item.basisDate === "2026-09-24" &&
            item.documentValidUntil === "2099-09-24" &&
            item.nextCheckDate === null &&
            item.state === "NEEDS_REVIEW",
        ),
      );
      assert.deepEqual(
        new Set(result.items.map((item) => item.customerId)),
        new Set([ca.id, cb.id]),
      );
      await value.updateRenewal(c, result.items[0].id, {
        state: "IRRELEVANT",
        reason: "Актуальность проверена вручную, сотрудник выбыл",
      });
      const repeat = await scanRenewals(c, { ...input, contactLeadDays: 60 });
      assert.equal(repeat.created, 0);
      assert.equal(repeat.existing, 2);
      assert.equal(
        repeat.items.find((item) => item.id === result.items[0].id)!.state,
        "IRRELEVANT",
      );
      assert.equal(repeat.items[0].contactAfter, "2099-08-25");
      await assert.rejects(
        scanRenewals({ ...c, role: "OPERATOR" }, input),
        code("ROLE_DENIED"),
      );
      await assert.rejects(
        scanRenewals({ ...c, tenantId: foreign.id }, input),
        code("SERVICE_RULE_NOT_FOUND"),
      );
      await assert.rejects(
        scanRenewals(c, { ...input, confirmedPolicy: false }),
        code("VALIDATION"),
      );
      assert.equal(
        await db.numberReservation.count({ where: { tenantId: tenant.id } }),
        0,
      );
    },
  );

  await t.test(
    "matrix preserves unknown, external verification and superseded states without inferring validity or leaking another employer",
    async () => {
      const external = await value.createExternalEvidence(c, {
        customerId: ca.id,
        recipientId: people[3].id,
        program: rule.serviceKey,
        issuer: "Внешний учебный центр",
        originalNumber: "EXTERNAL-ORIGINAL",
        documentDate: "2026-09-23",
        source: "Сведения заказчика",
      });
      const first = await evidenceMatrix(c, {
        customerId: ca.id,
        ruleVersionIds: [rule.id],
      });
      assert.equal(first.rows.length, 3);
      assert.ok(!first.rows.some((row) => row.recipientId === people[1].id));
      assert.equal(
        first.rows.find((row) => row.recipientId === people[0].id)!.cells[0]
          .source,
        "OWN",
      );
      assert.equal(
        first.rows.find((row) => row.recipientId === people[2].id)!.cells[0]
          .state,
        "UNKNOWN",
      );
      assert.equal(
        first.rows.find((row) => row.recipientId === people[3].id)!.cells[0]
          .state,
        "UNVERIFIED",
      );
      await value.verifyExternalEvidence(c, external.id, {
        status: "VERIFIED",
        verificationNote: "Источник сверен вручную",
      });
      const verified = await evidenceMatrix(
        { ...c, role: "VIEWER" },
        { customerId: ca.id, ruleVersionIds: [rule.id] },
      );
      const cell = verified.rows.find(
        (row) => row.recipientId === people[3].id,
      )!.cells[0];
      assert.equal(cell.state, "VERIFIED_NO_EXPIRY");
      assert.equal(cell.validUntil, null);
      assert.equal(cell.originalNumber, "EXTERNAL-ORIGINAL");
      assert.equal(cell.source, "EXTERNAL");
      await db.issuanceEvent.create({
        data: {
          tenantId: tenant.id,
          issuanceId: issuance.id,
          kind: "CANCELLED",
          reason: "Синтетическая отмена",
          actorId: user.id,
        },
      });
      const cancelled = await evidenceMatrix(c, {
        customerId: ca.id,
        ruleVersionIds: [rule.id],
      });
      assert.equal(
        cancelled.rows.find((row) => row.recipientId === people[0].id)!.cells[0]
          .state,
        "SUPERSEDED",
      );
      const rescanned = await scanRenewals(c, {
        ruleVersionId: rule.id,
        contactLeadDays: 30,
        confirmedPolicy: true,
      });
      assert.equal(rescanned.created, 0);
      assert.equal(rescanned.exclusions.SUPERSEDED_HISTORY, 1);
      await assert.rejects(
        evidenceMatrix(
          { ...c, tenantId: foreign.id },
          { customerId: ca.id, ruleVersionIds: [rule.id] },
        ),
        code("CUSTOMER_NOT_FOUND"),
      );
      await assert.rejects(
        evidenceMatrix(
          { ...c, role: "EMPLOYER" },
          { customerId: ca.id, ruleVersionIds: [rule.id] },
        ),
        code("ROLE_DENIED"),
      );
    },
  );
  await db.$disconnect();
});
