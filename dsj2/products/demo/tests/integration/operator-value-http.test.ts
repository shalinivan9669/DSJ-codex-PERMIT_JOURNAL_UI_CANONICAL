import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { bootstrap } from "../../apps/api/src/main";
import { db, type Context } from "../../apps/api/src/core";
import { passwordHash } from "../../apps/api/src/auth";
import { draftSchema, itemSchema } from "../../packages/contracts/src";
import { createRequest } from "../../apps/api/src/requests";
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
  const base = await app.getUrl();
  const suffix = randomUUID(),
    password = "Http-Operator-Value-Test!";
  const tenant = await db.tenant.create({
    data: { name: "Синтетический HTTP центр", demoOnly: true },
  });
  const admin = await db.user.create({
    data: {
      tenantId: tenant.id,
      email: `hadmin-${suffix}@example.test`,
      displayName: "Администратор",
      passwordHash: await passwordHash(password),
      role: "ADMIN",
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
    userId: admin.id,
    role: "ADMIN",
    sessionId: "test",
    csrfHash: "test",
    correlationId: suffix,
  };
  const request = await createRequest(
    c,
    draftSchema.parse({
      kind: "COMPANY",
      customerId: customer.id,
      items: [
        itemSchema.parse({
          id: "own",
          employerId: customer.id,
          fullNameRu: "Свой сотрудник",
        }),
        itemSchema.parse({
          id: "foreign",
          employerId: other.id,
          fullNameRu: "Тайна другого заказчика",
        }),
      ],
    }),
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
  const profile = await db.issuerProfileVersion.create({
    data: {
      tenantId: tenant.id,
      version: 1,
      profile: {
        nameRu: "HTTP тестовый эмитент",
        commission: [{ name: "Закрытое ФИО" }],
      },
      createdBy: admin.id,
    },
  });
  const template = await db.templateVersion.create({
    data: {
      tenantId: tenant.id,
      templateId: "biot-worker-card",
      version: "test",
      checksum: "test",
      storageKey: `test-${suffix}`,
      contract: {},
      approved: true,
    },
  });
  const issuance = await db.issuance.create({
    data: {
      tenantId: tenant.id,
      requestId: request.id,
      sourceRevision: 0,
      snapshot: { private: "Закрытое ФИО" },
      inputHash: "test",
      profileVersionId: profile.id,
      createdBy: admin.id,
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
      revision: 0,
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
    const adminSession = await login(admin.email),
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
              adminSession,
              { "x-csrf-token": "wrong" },
            )
          ).status,
          403,
        );
      },
    );
    await t.test(
      "authorized individual document in mixed roster downloads; full roster remains private",
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
        const download = await call(
          `/portal/artifacts/${individual.id}`,
          "GET",
          undefined,
          employerSession,
        );
        assert.equal(download.status, 200);
        assert.match(await download.text(), /OWN_ONLY/);
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
                requestRevision: 0,
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
              adminSession,
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
              adminSession,
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
