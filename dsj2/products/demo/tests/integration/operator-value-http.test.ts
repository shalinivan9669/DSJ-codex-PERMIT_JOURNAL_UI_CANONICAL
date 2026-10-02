import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { bootstrap } from "../../apps/api/src/main";
import { db, json, type Context } from "../../apps/api/src/core";
import { passwordHash } from "../../apps/api/src/auth";
import { draftSchema, itemSchema } from "../../packages/contracts/src";
import { createRequest } from "../../apps/api/src/requests";
import { decideProposal } from "../../apps/api/src/approvals";
import { saveProfile } from "../../apps/api/src/settings";
import { provision } from "../../scripts/setup";
import {
  createEmployerMembership,
  createServiceOrder,
} from "../../apps/api/src/operator-value";
import { createVerificationLink } from "../../apps/api/src/public-verification";
import { store } from "../../apps/api/src/files";
import { assertTestDatabase } from "./test-database";

test("HTTP service boundary: employer auth and scoped files, public privacy/Origin/rate limit, membership revocation", async (t) => {
  assertTestDatabase();
  process.env.PORT = "0";
  process.env.DEMO_ORIGIN = "http://localhost:3100";
  const app = await bootstrap();
  t.after(async () => {
    await app.close();
    await db.$disconnect();
  });
  const base = await app.getUrl();
  const suffix = randomUUID(),
    password = "Http-Operator-Value-Test!";
  const center = await provision({
    email: `hdirector-${suffix}@example.test`,
    password,
    name: "Синтетический HTTP центр",
    sample: true,
  });
  const tenant = await db.tenant.findUniqueOrThrow({
    where: { id: center.tenantId },
  });
  const director = await db.user.findUniqueOrThrow({
    where: { id: center.userId },
  });
  const manager = await db.user.create({
    data: {
      tenantId: tenant.id,
      email: `hmanager-${suffix}@example.test`,
      displayName: "Менеджер",
      passwordHash: await passwordHash(password),
      role: "OPERATOR",
    },
  });
  const employer = await db.user.create({
    data: {
      tenantId: tenant.id,
      email: `hemployer-${suffix}@example.test`,
      displayName: "Работодатель",
      passwordHash: await passwordHash(password),
      role: "EMPLOYER",
    },
  });
  const customer = await db.customerOrganization.create({
    data: { tenantId: tenant.id, nameRu: "Своя компания" },
  });
  const other = await db.customerOrganization.create({
    data: { tenantId: tenant.id, nameRu: "Чужая компания" },
  });
  const c: Context = {
    tenantId: tenant.id,
    userId: director.id,
    role: "DIRECTOR",
    sessionId: "test",
    csrfHash: "test",
    correlationId: suffix,
  };
  const managerContext = { ...c, userId: manager.id, role: "OPERATOR" };
  const sampleProfile = await db.issuerProfileVersion.findFirstOrThrow({
    where: { tenantId: tenant.id },
    orderBy: { version: "desc" },
  });
  const profile = await saveProfile(c, {
    ...(sampleProfile.profile as object),
    nameRu: "HTTP тестовый эмитент",
    commission: Array.from({ length: 3 }, (_, index) => ({
      name: `Закрытое ФИО ${index}`,
      position: index ? "Член комиссии" : "Председатель",
    })),
  });
  const template = await db.templateVersion.findFirstOrThrow({
    where: {
      tenantId: tenant.id,
      templateId: "biot-worker-card",
      approved: true,
    },
    orderBy: { createdAt: "desc" },
  });
  const assignment = (id: string) => ({
    id,
    templateId: "biot-worker-card",
    biotCategory: "WORKER",
    biotCheckType: "PERIODIC",
    documentDate: "2026-09-24",
    protocolDate: "2026-09-24",
    trainingStart: "2026-09-20",
    trainingEnd: "2026-09-23",
    trainingSubject: "Синтетическая программа БиОТ",
    hours: "10",
    productionHours: "16",
    result: "Сдал",
    outcome: { status: "PASSED", source: "Синтетическая проверка знаний" },
  });
  const currentPerson = await db.recipient.create({
    data: {
      tenantId: tenant.id,
      data: { fullNameRu: "Текущее имя в справочнике" },
    },
  });
  const request = await createRequest(
    managerContext,
    draftSchema.parse({
      kind: "COMPANY",
      customerId: customer.id,
      items: [
        itemSchema.parse({
          id: "own",
          recipientId: currentPerson.id,
          employerId: customer.id,
          fullNameRu: "Свой сотрудник",
          positionRu: "Монтажник",
          employeeCategory: "WORKER",
          assignments: [assignment("own-doc")],
        }),
        itemSchema.parse({
          id: "foreign",
          employerId: other.id,
          fullNameRu: "Тайна другого заказчика",
          positionRu: "Монтажник",
          employeeCategory: "WORKER",
          assignments: [assignment("foreign-doc")],
        }),
      ],
    }),
  );
  assert.equal(
    await db.requestItem.count({ where: { requestId: request.id } }),
    0,
  );
  await assert.rejects(
    decideProposal(managerContext, request.approval.proposalId, {
      decision: "APPROVE",
      reason: "Менеджер не принимает решение директора",
      expectedProposalHash: request.approval.proposalHash,
    }),
    (error: unknown) => {
      assert.equal(
        (error as { getResponse(): { code: string } }).getResponse().code,
        "DIRECTOR_REQUIRED",
      );
      return true;
    },
  );
  await decideProposal(c, request.approval.proposalId, {
    decision: "APPROVE",
    reason: "Синтетическая проверка заявки",
    expectedProposalHash: request.approval.proposalHash,
  });
  assert.equal(
    await db.requestItem.count({ where: { requestId: request.id } }),
    2,
  );
  const order = await createServiceOrder(c, {
    title: "Смешанный заказ",
    customerId: customer.id,
    requestIds: [request.id],
  });
  const membership = await createEmployerMembership(c, {
    customerId: customer.id,
    userId: employer.id,
    permissions: ["READ", "PROPOSE", "DOWNLOAD", "APPROVE_DATA"],
  });
  const issuance = await db.issuance.create({
    data: {
      tenantId: tenant.id,
      requestId: request.id,
      sourceRevision: request.revision,
      snapshot: json({
        private: "Закрытое ФИО",
        draft: {
          ...draftSchema.parse(request.draft),
          items: draftSchema
            .parse(request.draft)
            .items.map((row) =>
              row.id === "own"
                ? { ...row, fullNameRu: "Имя на дату выдачи" }
                : row,
            ),
        },
      }),
      inputHash: "test",
      profileVersionId: profile.id,
      createdBy: director.id,
    },
  });
  const doc = await db.issuedDocument.create({
    data: {
      tenantId: tenant.id,
      issuanceId: issuance.id,
      requestId: request.id,
      rowId: "own",
      assignmentId: "own-doc",
      templateVersionId: template.id,
      templateId: "biot-worker-card",
      namespace: "BIOT:CARD",
      number: "HTTP-1",
      documentDate: "2026-09-24",
    },
  });
  const snapshot = await db.renderInputSnapshot.create({
    data: {
      tenantId: tenant.id,
      requestId: request.id,
      revision: request.revision,
      issuanceId: issuance.id,
      profileVersionId: profile.id,
      input: {},
      inputHash: "test",
    },
  });
  async function artifact(
    documentId: string | null,
    fileName: string,
    content: string,
  ) {
    const bytes = Buffer.from(`%PDF-1.4\n${content}\n%%EOF`);
    const saved = await store.put(bytes, "pdf");
    const job = await db.generationJob.create({
      data: {
        tenantId: tenant.id,
        requestId: request.id,
        issuanceId: issuance.id,
        documentId,
        snapshotId: snapshot.id,
        kind: "PDF",
        status: "SUCCEEDED",
        logicalKey: randomUUID(),
      },
    });
    return db.artifact.create({
      data: {
        tenantId: tenant.id,
        requestId: request.id,
        issuanceId: issuance.id,
        documentId,
        jobId: job.id,
        ...saved,
        fileName,
        format: "PDF",
        mimeType: "application/pdf",
        rendererVersion: "synthetic-http-fixture",
        inputHash: "test",
      },
    });
  }
  const individual = await artifact(doc.id, "own.pdf", "OWN_ONLY");
  const foreignDoc = await db.issuedDocument.create({
    data: {
      tenantId: tenant.id,
      issuanceId: issuance.id,
      requestId: request.id,
      rowId: "foreign",
      assignmentId: "foreign-doc",
      templateVersionId: template.id,
      templateId: "biot-worker-card",
      namespace: "BIOT:CARD",
      number: "SECRET-FOREIGN-NUMBER",
      documentDate: "2026-09-24",
    },
  });
  const foreignArtifact = await artifact(
    foreignDoc.id,
    "private-foreign.pdf",
    "FOREIGN_ONLY",
  );
  const event = await db.trainingEvent.create({
    data: {
      id: randomUUID(),
      tenantId: tenant.id,
      requestId: request.id,
      title: "SECRET-GROUP-TITLE",
      protocolTemplateId: "biot-protocol",
      data: {},
    },
  });
  const groupDoc = await db.$transaction(async (tx) => {
    const group = await tx.issuedDocument.create({
      data: {
        tenantId: tenant.id,
        issuanceId: issuance.id,
        requestId: request.id,
        ownerKind: "GROUP",
        groupEventId: event.id,
        groupEventRevision: 0,
        templateVersionId: template.id,
        templateId: "biot-protocol",
        namespace: "BIOT:PROTOCOL",
        number: "SECRET-GROUP-NUMBER",
        documentDate: "2026-09-24",
      },
    });
    await tx.groupDocumentMember.createMany({
      data: ["own", "foreign"].map((rowId, position) => ({
        tenantId: tenant.id,
        documentId: group.id,
        requestId: request.id,
        rowId,
        assignmentId: `${rowId}-doc`,
        recipientId: rowId === "own" ? currentPerson.id : null,
        employerId: rowId === "own" ? customer.id : other.id,
        position,
        outcome: { status: "PASSED", source: "Synthetic group" },
      })),
    });
    return group;
  });
  const groupArtifact = await artifact(
    groupDoc.id,
    "private-mixed-group.pdf",
    "FOREIGN_GROUP_DATA",
  );
  const bundle = await artifact(
    null,
    "private-whole-roster.pdf",
    "OTHER_CUSTOMER_PRIVATE",
  );
  const published = await createVerificationLink(c, {
    documentId: doc.id,
    publicationConfirmed: true,
  });
  const call = (
    path: string,
    method = "GET",
    body?: unknown,
    auth?: { cookie: string; csrfToken: string },
    extra: Record<string, string> = {},
  ) =>
    fetch(base + path, {
      method,
      headers: {
        origin: "http://localhost:3100",
        ...(auth
          ? { cookie: auth.cookie, "x-csrf-token": auth.csrfToken }
          : {}),
        ...(body ? { "content-type": "application/json" } : {}),
        ...extra,
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  async function login(email: string) {
    const response = await call("/auth/login", "POST", { email, password });
    assert.equal(response.status, 201);
    const data = await response.json();
    return {
      cookie: response.headers
        .getSetCookie()
        .map((v) => v.split(";")[0])
        .join("; "),
      csrfToken: data.csrfToken as string,
    };
  }
  try {
    const directorSession = await login(director.email),
      employerSession = await login(employer.email);
    await t.test(
      "employer context has no center configuration; all direct center surfaces denied",
      async () => {
        const contextResponse = await call(
          "/context",
          "GET",
          undefined,
          employerSession,
        );
        assert.equal(contextResponse.status, 200);
        const contextData = await contextResponse.json();
        assert.equal(contextData.profile, null);
        assert.deepEqual(contextData.templates, []);
        assert.deepEqual(contextData.numbering, []);
        for (const path of [
          "/orders",
          "/renewals",
          "/evidence",
          "/service-rules",
          "/dossier",
          "/customers",
          "/recipients",
          "/history",
          "/settings/profile",
          "/verification-links",
          `/artifacts/${individual.id}`,
        ]) {
          const response = await call(path, "GET", undefined, employerSession);
          assert.ok(
            [403, 404].includes(response.status),
            `${path} must deny employer, got ${response.status}`,
          );
        }
        assert.equal((await call("/orders")).status, 401);
        assert.equal(
          (
            await call(
              "/orders",
              "POST",
              { title: "CSRF bypass" },
              directorSession,
              { "x-csrf-token": "wrong" },
            )
          ).status,
          403,
        );
      },
    );
    await t.test(
      "authorized immutable document label and bytes are stable; foreign individual/group labels stay private",
      async () => {
        const response = await call(
          "/portal",
          "GET",
          undefined,
          employerSession,
        );
        assert.equal(response.status, 200);
        const portal = await response.json();
        const text = JSON.stringify(portal);
        assert.ok(!text.includes("Тайна другого заказчика"));
        assert.ok(!text.includes(bundle.fileName));
        assert.ok(text.includes(individual.id));
        const visibleFile = portal.orders[0].artifacts.find(
          (file: { id: string }) => file.id === individual.id,
        );
        assert.match(visibleFile.label, /БиОТ/);
        assert.match(visibleFile.label, /Имя на дату выдачи/);
        assert.match(visibleFile.label, /№ HTTP-1 · PDF$/);
        assert.ok(
          !visibleFile.label.includes("Свой сотрудник") &&
            !visibleFile.label.includes("Текущее имя"),
        );
        assert.equal(visibleFile.fileName, "own.pdf");
        assert.equal(visibleFile.sha256, individual.sha256);
        for (const secret of [
          foreignArtifact.id,
          groupArtifact.id,
          "SECRET-FOREIGN-NUMBER",
          "SECRET-GROUP-NUMBER",
          "SECRET-GROUP-TITLE",
          "Закрытое ФИО",
        ])
          assert.ok(!text.includes(secret));
        for (const deniedFile of [foreignArtifact, groupArtifact])
          assert.equal(
            (
              await call(
                `/portal/artifacts/${deniedFile.id}`,
                "GET",
                undefined,
                employerSession,
              )
            ).status,
            403,
          );
        await db.recipient.update({
          where: { id: currentPerson.id },
          data: { data: { fullNameRu: "Ещё одно текущее имя" } },
        });
        const again = await (
          await call("/portal", "GET", undefined, employerSession)
        ).json();
        assert.equal(
          again.orders[0].artifacts.find(
            (file: { id: string }) => file.id === individual.id,
          ).label,
          visibleFile.label,
        );
        const download = await call(
          `/portal/artifacts/${individual.id}`,
          "GET",
          undefined,
          employerSession,
        );
        assert.equal(download.status, 200);
        const downloadedBytes = Buffer.from(await download.arrayBuffer());
        assert.match(downloadedBytes.toString(), /OWN_ONLY/);
        assert.equal(
          createHash("sha256").update(downloadedBytes).digest("hex"),
          individual.sha256,
        );
        assert.match(
          download.headers.get("content-disposition") || "",
          /own\.pdf/,
        );
        const unchanged = await db.artifact.findUniqueOrThrow({
          where: { id: individual.id },
        });
        assert.equal(unchanged.fileName, individual.fileName);
        assert.equal(unchanged.storageKey, individual.storageKey);
        assert.equal(unchanged.sha256, individual.sha256);
        assert.equal(
          download.headers.get("cache-control"),
          "private, no-store",
        );
        assert.equal(
          (
            await call(
              `/portal/artifacts/${bundle.id}`,
              "GET",
              undefined,
              employerSession,
            )
          ).status,
          403,
        );
        assert.equal(
          (
            await call(
              `/portal/orders/${order.id}/proposals`,
              "POST",
              {
                requestId: request.id,
                requestRevision: request.revision,
                kind: "CONFIRM_LIST",
              },
              employerSession,
            )
          ).status,
          403,
        );
      },
    );
    await t.test(
      "anonymous verification is minimal/no-store/no-referrer and corrections require Origin with independent rate bound",
      async () => {
        const response = await call(`/verification/${published.token}`);
        assert.equal(response.status, 200);
        assert.equal(response.headers.get("referrer-policy"), "no-referrer");
        assert.equal(response.headers.get("cache-control"), "no-store");
        assert.match(response.headers.get("x-robots-tag") || "", /noindex/);
        const body = await response.json();
        assert.equal(body.document.number, "HTTP-1");
        assert.ok(!JSON.stringify(body).includes("ФИО"));
        assert.ok(!JSON.stringify(body).includes(tenant.id));
        const path = `/verification/${published.token}/corrections`;
        assert.equal(
          (
            await call(
              path,
              "POST",
              { message: "Проверка отклонённого источника" },
              undefined,
              { origin: "https://evil.example" },
            )
          ).status,
          403,
        );
        for (let i = 0; i < 10; i++)
          assert.equal(
            (
              await call(path, "POST", {
                message: "Синтетическое обращение о проверке записи",
              })
            ).status,
            201,
          );
        assert.equal(
          (
            await call(path, "POST", {
              message: "Синтетическое обращение сверх лимита",
            })
          ).status,
          429,
        );
        assert.equal(
          (
            await call(`/verification/${published.token}`, "PATCH", {
              status: "CANCELLED",
            })
          ).status,
          404,
        );
        assert.equal((await call(`/verification/${doc.id}`)).status, 401);
      },
    );
    await t.test(
      "revocation kills existing employer session and stale direct download",
      async () => {
        assert.equal(
          (
            await call(
              `/employer-memberships/${membership.id}/revoke`,
              "POST",
              {},
              directorSession,
            )
          ).status,
          201,
        );
        assert.equal(
          (await call("/portal", "GET", undefined, employerSession)).status,
          401,
        );
        assert.equal(
          (
            await call(
              `/portal/artifacts/${individual.id}`,
              "GET",
              undefined,
              employerSession,
            )
          ).status,
          401,
        );
        assert.equal(
          (
            await call(
              `/verification-links/${published.id}/revoke`,
              "POST",
              {},
              directorSession,
            )
          ).status,
          201,
        );
        assert.equal(
          (await call(`/verification/${published.token}`)).status,
          404,
        );
      },
    );
  } finally {
    await app.close();
    await db.$disconnect();
  }
});
