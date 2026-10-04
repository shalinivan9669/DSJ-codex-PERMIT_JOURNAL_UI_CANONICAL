import { syntheticPdf, objectStreamPdf } from "../fixtures/pdf";
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { bootstrap } from "../../apps/api/src/main";
import { db, json, type Context } from "../../apps/api/src/core";
import { passwordHash } from "../../apps/api/src/auth";
import {
  draftSchema,
  itemSchema,
  assignmentSchema,
} from "../../packages/contracts/src";
import { createRequest } from "../../apps/api/src/requests";
import * as value from "../../apps/api/src/operator-value";
import { assertTestDatabase } from "./test-database";
import { createApprovalFixture } from "./live-approval-fixture";
import { provision } from "../../scripts/setup";

test("HTTP employer evidence and matrix scope: stable recipient, tenant, permission, private file and revoke", async (t) => {
  assertTestDatabase();
  process.env.PORT = "0";
  process.env.DEMO_ORIGIN = "http://localhost:3100";
  const app = await bootstrap();
  t.after(async () => {
    await app.close();
    await db.$disconnect();
  });
  const base = await app.getUrl();
  const password = "Portal-Evidence-HTTP-Secret!";
  const seed = await provision({ email: `${randomUUID()}@example.test`, password, name: "Синтетический центр портала", sample: true });
  const tenant = await db.tenant.findUniqueOrThrow({ where: { id: seed.tenantId } });
  const foreignTenant = await db.tenant.create({
    data: { name: "Чужой центр" },
  });
  const hash = await passwordHash(password);
  const users = await Promise.all(
    ["ADMIN", "EMPLOYER", "EMPLOYER"].map((role) =>
      db.user.create({
        data: {
          tenantId: tenant.id,
          email: `${randomUUID()}@example.test`,
          displayName: role,
          passwordHash: hash,
          role,
        },
      }),
    ),
  );
  const c: Context = {
    tenantId: tenant.id,
    userId: users[0].id,
    role: "ADMIN",
    sessionId: "test",
    csrfHash: "test",
    correlationId: randomUUID(),
  };
  const customer = await db.customerOrganization.create({
    data: { tenantId: tenant.id, nameRu: "Компания A" },
  });
  const other = await db.customerOrganization.create({
    data: { tenantId: tenant.id, nameRu: "Компания B" },
  });
  const people = await Promise.all(
    [
      "Разрешённый человек",
      "Закрытый состав того же заказчика",
      "Другой работодатель",
    ].map((fullNameRu) =>
      db.recipient.create({
        data: { tenantId: tenant.id, data: { fullNameRu } },
      }),
    ),
  );
  await db.recipientEmployment.createMany({
    data: people.map((person, index) => ({
      tenantId: tenant.id,
      recipientId: person.id,
      employerId: index === 2 ? other.id : customer.id,
      createdBy: users[0].id,
    })),
  });
  const rule = await value.createServiceRule(c, {
    serviceKey: "PORTAL_BIOT",
    title: "Согласованная услуга",
    status: "APPROVED",
    checkedOn: "2026-09-24",
    source: "Синтетический источник",
    applicability: "Согласованный состав",
    definition: {
      programVersion: "1",
      category: "WORKER",
      compatibleTemplateIds: ["biot-worker-card", "biot-protocol"],
      requirements: [],
    },
  });
  await value.createServiceRule(c, {
    serviceKey: "PRIVATE_OTHER",
    title: "Внутренняя услуга другого клиента",
    status: "APPROVED",
    checkedOn: "2026-09-24",
    source: "Внутренняя заметка",
    applicability: "Другой клиент",
    definition: {
      programVersion: "1",
      category: "WORKER",
      compatibleTemplateIds: ["biot-worker-card"],
      requirements: [],
    },
  });
  const eventId = randomUUID();
  const draft = draftSchema.parse({
    kind: "COMPANY",
    customerId: customer.id,
    events: [
      {
        id: eventId,
        title: "Общий состав",
        protocolTemplateId: "biot-protocol",
        serviceRuleVersionId: rule.id,
        commonFields: { documentDate: "2026-09-24", protocolDate: "2026-09-24", trainingStart: "2026-09-20", trainingEnd: "2026-09-24", trainingSubject: "Синтетическая программа", hours: "24", productionHours: "16" },
      },
    ],
    items: people.map((person, index) =>
      itemSchema.parse({
        id: randomUUID(),
        recipientId: person.id,
        employerId: index === 2 ? other.id : customer.id,
        fullNameRu: `Участник ${index}`,
        positionRu: "Синтетический рабочий",
        assignments: [
          assignmentSchema.parse({
            id: randomUUID(),
            templateId: "biot-worker-card",
            biotCategory: "WORKER",
            eventId,
            protocolMode: "GROUP",
            outcome: { status: "PASSED", source: "Явно заданный синтетический результат" },
            result: "Сдал",
          }),
        ],
      }),
    ),
  });
  const approvals = await createApprovalFixture(c);
  t.after(() => approvals.close());
  const request = await createRequest(c, draft);
  await approvals.approve(request.id);
  await value.createServiceOrder(c, {
    title: "Согласованный заказ",
    customerId: customer.id,
    requestIds: [request.id],
  });
  const membership = await value.createEmployerMembership(c, {
    customerId: customer.id,
    userId: users[1].id,
    recipientIds: [people[0].id],
    permissions: ["READ", "PROPOSE", "DOWNLOAD"],
  });
  await value.createEmployerMembership(c, {
    customerId: customer.id,
    userId: users[2].id,
    permissions: ["READ"],
  });
  const body = {
    customerId: customer.id,
    recipientId: people[0].id,
    program: rule.serviceKey,
    issuer: "Реальный внешний источник теста",
    originalNumber: "ORIGINAL-123",
    documentDate: "2026-09-24",
    source: "Файл работодателя",
  };
  const secondEvidence = await value.createExternalEvidence(c, {
    ...body,
    recipientId: people[1].id,
    originalNumber: "PRIVATE-456",
  });
  const otherEvidence = await value.createExternalEvidence(c, {
    ...body,
    customerId: other.id,
    recipientId: people[2].id,
    originalNumber: "OTHER-789",
  });
  const foreignUser = await db.user.create({
    data: {
      tenantId: foreignTenant.id,
      email: `${randomUUID()}@example.test`,
      displayName: "Другой центр",
      passwordHash: hash,
      role: "ADMIN",
    },
  });
  const foreignCustomer = await db.customerOrganization.create({
    data: { tenantId: foreignTenant.id, nameRu: "Чужой заказчик" },
  });
  const foreignPerson = await db.recipient.create({
    data: { tenantId: foreignTenant.id, data: { fullNameRu: "Чужой человек" } },
  });
  const foreignContext = {
    ...c,
    tenantId: foreignTenant.id,
    userId: foreignUser.id,
  };
  const foreignEvidence = await value.createExternalEvidence(foreignContext, {
    ...body,
    customerId: foreignCustomer.id,
    recipientId: foreignPerson.id,
  });
  type Session = { cookie: string; csrfToken: string };
  const call = (
    path: string,
    method = "GET",
    data?: unknown,
    session?: Session,
  ) =>
    fetch(base + path, {
      method,
      headers: {
        origin: "http://localhost:3100",
        ...(session
          ? { cookie: session.cookie, "x-csrf-token": session.csrfToken }
          : {}),
        ...(data ? { "content-type": "application/json" } : {}),
      },
      body: data ? JSON.stringify(data) : undefined,
    });
  const login = async (email: string) => {
    const response = await call("/auth/login", "POST", { email, password });
    assert.equal(response.status, 201);
    return {
      cookie: response.headers
        .getSetCookie()
        .map((value) => value.split(";")[0])
        .join("; "),
      csrfToken: (await response.json()).csrfToken as string,
    };
  };
  try {
    const [admin, employer, reader] = await Promise.all(
      users.map((user) => login(user.email)),
    );
    let evidenceId = "",
      attachmentId = "";
    const bytes = syntheticPdf("Synthetic source fixture");
    await t.test(
      "explicit context returns only permitted roster and agreed services; no general center catalog access",
      async () => {
        const response = await call(
          `/portal/evidence?customerId=${customer.id}`,
          "GET",
          undefined,
          employer,
        );
        assert.equal(response.status, 200);
        const context = await response.json();
        assert.deepEqual(
          context.recipients.map((person: { id: string }) => person.id),
          [people[0].id],
        );
        assert.deepEqual(
          context.programs.map((program: { id: string }) => program.id),
          [rule.id],
        );
        assert.deepEqual(context.items, []);
        assert.equal(
          (await call("/portal/evidence", "GET", undefined, employer)).status,
          400,
        );
        assert.equal(
          (
            await call(
              `/portal/evidence?customerId=${other.id}`,
              "GET",
              undefined,
              employer,
            )
          ).status,
          404,
        );
        assert.equal(
          (
            await call(
              `/portal/matrix?customerId=${foreignCustomer.id}`,
              "GET",
              undefined,
              employer,
            )
          ).status,
          404,
        );
        assert.equal(
          (
            await call(
              `/portal/evidence?customerId=${customer.id}`,
              "GET",
              undefined,
              admin,
            )
          ).status,
          403,
        );
        assert.equal(
          (await call("/service-rules", "GET", undefined, employer)).status,
          403,
        );
        const matrix = await (
          await call(
            `/portal/matrix?customerId=${customer.id}`,
            "GET",
            undefined,
            employer,
          )
        ).json();
        assert.equal(matrix.rows.length, 1);
        assert.equal(matrix.rows[0].cells[0].state, "UNKNOWN");
        assert.equal(matrix.columns[0].id, rule.id);
      },
    );
    await t.test(
      "employer records unverified evidence and private source; tenant and recipient spoofing fail closed",
      async () => {
        const response = await call("/portal/evidence", "POST", body, employer);
        assert.equal(response.status, 201);
        const created = await response.json();
        evidenceId = created.id;
        assert.equal(created.status, "UNVERIFIED");
        assert.equal(created.originalNumber, body.originalNumber);
        assert.equal(
          (
            await call(
              "/portal/evidence",
              "POST",
              { ...body, recipientId: people[1].id },
              employer,
            )
          ).status,
          404,
        );
        assert.equal(
          (
            await call(
              "/portal/evidence",
              "POST",
              { ...body, customerId: other.id, recipientId: people[2].id },
              employer,
            )
          ).status,
          404,
        );
        assert.equal(
          (
            await call(
              "/portal/evidence",
              "POST",
              { ...body, status: "VERIFIED" },
              employer,
            )
          ).status,
          400,
        );
        assert.equal(
          (
            await call(
              "/portal/evidence",
              "POST",
              { ...body, tenantId: foreignTenant.id },
              employer,
            )
          ).status,
          400,
        );
        assert.equal(
          (await call("/portal/evidence", "POST", body, reader)).status,
          403,
        );
        assert.equal(
          (
            await call(
              `/evidence/${evidenceId}/verify`,
              "POST",
              { status: "VERIFIED", verificationNote: "Нельзя" },
              employer,
            )
          ).status,
          403,
        );
        const attachment = {
          source: "Исходный скан работодателя",
          fileName: "source.pdf",
          contentBase64: bytes.toString("base64"),
        };
        const upload = await call(
          `/portal/evidence/${evidenceId}/attachments`,
          "POST",
          attachment,
          employer,
        );
        assert.equal(upload.status, 201);
        attachmentId = (await upload.json()).id;
        const beforeRejected = await db.valueAttachment.count({
          where: { tenantId: tenant.id },
        });
        for (const unsafe of [
          syntheticPdf(
            "",
            "/Open#41ction << /S /Java#53cript /J#53 (void 0) >>",
          ),
          objectStreamPdf(true),
          syntheticPdf(
            "",
            "",
            "/Annots [<< /Subtype /Widget /AA << /E << /S /Launch /F (synthetic.txt) >> >> >>]",
          ),
        ]) {
          const rejected = await call(
            `/portal/evidence/${evidenceId}/attachments`,
            "POST",
            { ...attachment, contentBase64: unsafe.toString("base64") },
            employer,
          );
          assert.equal(rejected.status, 400);
          assert.equal((await rejected.json()).code, "ACTIVE_PDF_REJECTED");
        }
        const malformed = await call(
          `/portal/evidence/${evidenceId}/attachments`,
          "POST",
          {
            ...attachment,
            contentBase64: Buffer.from(
              "%PDF-1.4\ninvalid source\n%%EOF",
            ).toString("base64"),
          },
          employer,
        );
        assert.equal(malformed.status, 400);
        assert.equal((await malformed.json()).code, "PDF_INVALID");
        const invalidImage = await call(
          `/portal/evidence/${evidenceId}/attachments`,
          "POST",
          {
            ...attachment,
            fileName: "false.png",
            contentBase64: Buffer.from([
              137, 80, 78, 71, 13, 10, 26, 10,
            ]).toString("base64"),
          },
          employer,
        );
        assert.equal(invalidImage.status, 400);
        assert.equal((await invalidImage.json()).code, "IMAGE_INVALID");
        assert.equal(
          await db.valueAttachment.count({ where: { tenantId: tenant.id } }),
          beforeRejected,
        );
        assert.equal(
          (
            await call(
              `/portal/evidence/${secondEvidence.id}/attachments`,
              "POST",
              attachment,
              employer,
            )
          ).status,
          404,
        );
        assert.equal(
          (
            await call(
              `/portal/evidence/${otherEvidence.id}/attachments`,
              "POST",
              attachment,
              employer,
            )
          ).status,
          404,
        );
        assert.equal(
          (
            await call(
              `/portal/evidence/${foreignEvidence.id}/attachments`,
              "POST",
              attachment,
              employer,
            )
          ).status,
          404,
        );
        assert.equal(
          (
            await call(
              `/portal/evidence/${evidenceId}/attachments`,
              "POST",
              { ...attachment, dossierId: rule.id },
              employer,
            )
          ).status,
          400,
        );
        assert.equal(
          (
            await call(
              `/portal/evidence/${evidenceId}/attachments`,
              "POST",
              {
                ...attachment,
                contentBase64: Buffer.from(
                  "<svg onload='alert(1)'></svg>",
                ).toString("base64"),
              },
              employer,
            )
          ).status,
          400,
        );
        assert.equal(
          await db.numberReservation.count({ where: { tenantId: tenant.id } }),
          0,
        );
      },
    );
    await t.test(
      "reload preserves sources and matrix verification; downloads recheck visibility and scoped permissions",
      async () => {
        const context = await (
          await call(
            `/portal/evidence?customerId=${customer.id}`,
            "GET",
            undefined,
            employer,
          )
        ).json();
        assert.equal(context.items[0].attachments[0].id, attachmentId);
        assert.equal(context.items[0].attachments[0].storageKey, undefined);
        assert.equal(context.items[0].verifiedBy, undefined);
        const download = await call(
          `/portal/evidence-attachments/${attachmentId}`,
          "GET",
          undefined,
          employer,
        );
        assert.equal(download.status, 200);
        assert.match(
          download.headers.get("content-disposition") || "",
          /attachment/,
        );
        assert.match(download.headers.get("cache-control") || "", /no-store/);
        assert.deepEqual(Buffer.from(await download.arrayBuffer()), bytes);
        assert.equal(
          (
            await call(
              `/portal/evidence-attachments/${attachmentId}`,
              "GET",
              undefined,
              reader,
            )
          ).status,
          403,
        );
        const privateAttachment = await value.addValueAttachment(c, {
          evidenceId,
          category: "SOURCE",
          source: "Внутренний источник",
          fileName: "private.pdf",
          contentBase64: bytes.toString("base64"),
          customerVisible: false,
        });
        assert.equal(
          (
            await call(
              `/portal/evidence-attachments/${privateAttachment.id}`,
              "GET",
              undefined,
              employer,
            )
          ).status,
          404,
        );
        // Synthetic own failed group attempt competes with an unverified external
        // document of the same day; selected source, number and action must agree.
        const failedDraft = structuredClone(draft);
        failedDraft.items[0].assignments[0].outcome = {
          status: "FAILED",
          source: "Синтетический сохранённый результат",
        };
        const previousProfile = await db.issuerProfileVersion.findFirstOrThrow({ where: { tenantId: tenant.id }, orderBy: { version: "desc" } });
        const ownProfile = await db.issuerProfileVersion.create({
          data: {
            tenantId: tenant.id,
            version: previousProfile.version + 1,
            profile: previousProfile.profile,
            createdBy: users[0].id,
          },
        });
        const ownTemplate = await db.templateVersion.create({
          data: {
            tenantId: tenant.id,
            templateId: "biot-protocol",
            version: "synthetic",
            checksum: "test",
            storageKey: randomUUID(),
            contract: {},
          },
        });
        await db.$transaction(async (tx) => {
          const ownIssuance = await tx.issuance.create({
            data: {
              tenantId: tenant.id,
              requestId: request.id,
              sourceRevision: request.revision,
              snapshot: json({ draft: failedDraft }),
              inputHash: "synthetic",
              profileVersionId: ownProfile.id,
              createdBy: users[0].id,
            },
          });
          const document = await tx.issuedDocument.create({
            data: {
              tenantId: tenant.id,
              requestId: request.id,
              issuanceId: ownIssuance.id,
              ownerKind: "GROUP",
              groupEventId: eventId,
              groupEventRevision: 0,
              templateVersionId: ownTemplate.id,
              templateId: "biot-protocol",
              namespace: "BIOT:PROTOCOL",
              number: "SAVED-FAILED-GROUP",
              documentDate: body.documentDate,
            },
          });
          await tx.groupDocumentMember.create({
            data: {
              tenantId: tenant.id,
              documentId: document.id,
              requestId: request.id,
              rowId: draft.items[0].id,
              assignmentId: draft.items[0].assignments[0].id,
              recipientId: people[0].id,
              employerId: customer.id,
              position: 0,
              outcome: { status: "FAILED" },
            },
          });
        });
        const competing = await (
          await call(
            `/portal/matrix?customerId=${customer.id}`,
            "GET",
            undefined,
            employer,
          )
        ).json();
        assert.equal(competing.rows[0].cells[0].source, "EXTERNAL");
        assert.equal(
          competing.rows[0].cells[0].originalNumber,
          body.originalNumber,
        );
        assert.equal(competing.rows[0].cells[0].state, "UNVERIFIED");
        assert.match(competing.rows[0].cells[0].nextAction, /внешний документ/);
        await value.verifyExternalEvidence(c, evidenceId, {
          status: "SUPERSEDED",
          verificationNote:
            "Синтетическая проверка сохранённой неуспешной попытки",
        });
        const ownOnly = await (
          await call(
            `/portal/matrix?customerId=${customer.id}`,
            "GET",
            undefined,
            employer,
          )
        ).json();
        assert.equal(ownOnly.rows[0].cells[0].source, "OWN");
        assert.equal(
          ownOnly.rows[0].cells[0].originalNumber,
          "SAVED-FAILED-GROUP",
        );
        assert.match(
          ownOnly.rows[0].cells[0].nextAction,
          /исход попытки|пересдачу/,
        );
        await value.verifyExternalEvidence(c, evidenceId, {
          status: "VERIFIED",
          verificationNote: "PRIVATE STAFF NOTE NEVER SHARED",
        });
        const matrixResponse = await call(
          `/portal/matrix?customerId=${customer.id}`,
          "GET",
          undefined,
          employer,
        );
        const matrixText = await matrixResponse.text();
        assert.ok(!matrixText.includes("PRIVATE STAFF NOTE"));
        const matrix = JSON.parse(matrixText);
        assert.equal(matrix.rows.length, 1);
        assert.equal(matrix.rows[0].cells[0].source, "EXTERNAL");
        assert.equal(matrix.rows[0].cells[0].state, "VERIFIED_NO_EXPIRY");
        const staffEvidence = await (
          await call("/evidence", "GET", undefined, admin)
        ).json();
        assert.equal(
          staffEvidence.items.find(
            (item: { id: string }) => item.id === evidenceId,
          ).attachments.length,
          2,
        );
        const dossier = await value.createDossierRecord(c, {
          title: "Файл программы",
          category: "PROGRAM",
          version: "1",
          source: "Источник",
          applicability: "Тест",
          ownerId: users[0].id,
        });
        const dossierFile = await value.addValueAttachment(c, {
          dossierId: dossier.id,
          category: "MATERIAL",
          source: "Оригинал программы",
          fileName: "program.pdf",
          contentBase64: bytes.toString("base64"),
        });
        const staffDossier = await (
          await call("/dossier", "GET", undefined, admin)
        ).json();
        assert.equal(
          staffDossier.items.find(
            (item: { id: string }) => item.id === dossier.id,
          ).attachments[0].id,
          dossierFile.id,
        );
      },
    );
    await t.test(
      "expiry, revocation and unauthenticated direct access cannot recover former evidence",
      async () => {
        await db.employerMembership.update({
          where: { id: membership.id },
          data: { expiresAt: new Date("2020-01-01") },
        });
        assert.equal(
          (
            await call(
              `/portal/evidence-attachments/${attachmentId}`,
              "GET",
              undefined,
              employer,
            )
          ).status,
          404,
        );
        assert.equal(
          (
            await call(
              `/portal/matrix?customerId=${customer.id}`,
              "GET",
              undefined,
              employer,
            )
          ).status,
          404,
        );
        await value.revokeEmployerMembership(c, membership.id);
        assert.equal(
          (
            await call(
              `/portal/evidence-attachments/${attachmentId}`,
              "GET",
              undefined,
              employer,
            )
          ).status,
          401,
        );
        assert.equal(
          (await call(`/portal/evidence-attachments/${attachmentId}`)).status,
          401,
        );
      },
    );
  } finally {
    await app.close();
    await db.$disconnect();
  }
});
