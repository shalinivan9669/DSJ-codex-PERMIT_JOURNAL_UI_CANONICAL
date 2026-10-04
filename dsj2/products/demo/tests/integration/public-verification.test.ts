import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { db, type Context } from "../../apps/api/src/core";
import { rateLimit } from "../../apps/api/src/auth";
import * as publicRecord from "../../apps/api/src/public-verification";
import { assertTestDatabase } from "./test-database";

function context(tenantId: string, userId: string, role = "ADMIN"): Context {
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
test("public record has hashed random tokens, minimal data, real status, bounded corrections and immediate link revocation", async (t) => {
  assertTestDatabase();
  const previousOrigin = process.env.DEMO_ORIGIN;
  process.env.DEMO_ORIGIN = "http://localhost:3119";
  t.after(() => {
    if (previousOrigin === undefined) delete process.env.DEMO_ORIGIN;
    else process.env.DEMO_ORIGIN = previousOrigin;
  });
  const tenant = await db.tenant.create({
    data: { name: "Синтетический центр проверки", demoOnly: true },
  });
  const user = await db.user.create({
    data: {
      tenantId: tenant.id,
      email: `verify-${randomUUID()}@example.test`,
      displayName: "Тестовый оператор",
      passwordHash: "unused",
      role: "ADMIN",
    },
  });
  const c = context(tenant.id, user.id);
  const profile = await db.issuerProfileVersion.create({
    data: {
      tenantId: tenant.id,
      version: 1,
      profile: {
        nameRu: "Тестовый эмитент",
        nameKz: "Сынақ орталығы",
        commission: [{ name: "Секретные персональные сведения" }],
      },
      createdBy: user.id,
    },
  });
  const template = await db.templateVersion.create({
    data: {
      tenantId: tenant.id,
      templateId: "biot-worker-card",
      version: "test",
      checksum: "synthetic",
      storageKey: `synthetic-${randomUUID()}`,
      contract: {},
      approved: true,
    },
  });
  const request = await db.printRequest.create({
    data: {
      tenantId: tenant.id,
      kind: "PERSON",
      draft: { fullNameRu: "Секретное ФИО", employer: "Чужая компания" },
      createdBy: user.id,
    },
  });
  const issuance = await db.issuance.create({
    data: {
      tenantId: tenant.id,
      requestId: request.id,
      sourceRevision: 0,
      snapshot: {
        fullNameRu: "Секретное ФИО",
        photoAssetId: "PRIVATE",
        personnelNumber: "PRIVATE",
        employer: "Чужая компания",
      },
      inputHash: "fixture-hash",
      profileVersionId: profile.id,
      createdBy: user.id,
    },
  });
  const document = await db.issuedDocument.create({
    data: {
      tenantId: tenant.id,
      issuanceId: issuance.id,
      requestId: request.id,
      rowId: "row",
      assignmentId: "a",
      templateVersionId: template.id,
      templateId: "biot-worker-card",
      namespace: "BIOT:CARD",
      number: "TEST-0001",
      documentDate: "2026-09-24",
    },
  });
  const published = await publicRecord.createVerificationLink(c, {
    documentId: document.id,
    publicationConfirmed: true,
  });

  await t.test(
    "publication requires confirmation; token is random/hash-only and public DTO contains no personal fields",
    async () => {
      assert.match(published.token, /^[a-f0-9]{64}$/);
      const stored = await db.publicDocumentVerification.findUniqueOrThrow({
        where: { id: published.id },
      });
      assert.notEqual(stored.tokenHash, published.token);
      assert.ok(!JSON.stringify(stored).includes(published.token));
      const result = await publicRecord.publicVerificationRecord(
        published.token,
      );
      assert.equal(result.document.number, "TEST-0001");
      assert.equal(result.status, "ACTIVE_RECORD");
      assert.deepEqual(Object.keys(result).sort(), [
        "document",
        "issuer",
        "limitation",
        "replacement",
        "status",
      ]);
      assert.ok(!JSON.stringify(result).includes("Секрет"));
      assert.ok(!JSON.stringify(result).includes("Чужая компания"));
      assert.ok(!JSON.stringify(result).includes("PRIVATE"));
      assert.ok(!JSON.stringify(result).includes(document.id));
      await assert.rejects(
        publicRecord.createVerificationLink(c, {
          documentId: document.id,
          publicationConfirmed: false,
        }),
        code("VALIDATION"),
      );
      await assert.rejects(
        publicRecord.createVerificationLink(
          { ...c, role: "EMPLOYER" },
          { documentId: document.id, publicationConfirmed: true },
        ),
        code("ROLE_DENIED"),
      );
      await assert.rejects(
        publicRecord.createVerificationLink(
          { ...c, tenantId: randomUUID() },
          { documentId: document.id, publicationConfirmed: true },
        ),
        code("NOT_FOUND"),
      );
      await assert.rejects(
        publicRecord.publicVerificationRecord(document.id),
        code("RECORD_UNAVAILABLE"),
      );
      await assert.rejects(
        publicRecord.publicVerificationRecord("a".repeat(64)),
        code("RECORD_UNAVAILABLE"),
      );
      assert.ok(
        !JSON.stringify(await publicRecord.listVerificationLinks(c)).includes(
          stored.tokenHash,
        ),
      );
    },
  );

  await t.test(
    "public correction only stores a request; protected document remains unchanged and spam limiter trips",
    async () => {
      const before = await db.issuedDocument.findUniqueOrThrow({
        where: { id: document.id },
      });
      const result = await publicRecord.submitPublicCorrection(
        published.token,
        {
          message: "Просим проверить опечатку в сохранённых сведениях",
          replyContact: "synthetic@example.test",
        },
      );
      assert.equal(result.accepted, true);
      const requests = await publicRecord.listDocumentCorrections(c);
      assert.equal(requests.items.length, 1);
      assert.equal(requests.items[0].documentId, document.id);
      await publicRecord.resolveDocumentCorrection(c, requests.items[0].id, {
        status: "REVIEWED",
        resolution:
          "Передано уполномоченному оператору для проверки и отдельного исправления",
      });
      assert.deepEqual(
        await db.issuedDocument.findUniqueOrThrow({
          where: { id: document.id },
        }),
        before,
      );
      await assert.rejects(
        publicRecord.submitPublicCorrection(published.token, {
          message: "x".repeat(2001),
        }),
        code("VALIDATION"),
      );
      await assert.rejects(
        publicRecord.submitPublicCorrection(published.token, {
          message: "Проверка исходных данных",
          documentId: "different",
        }),
        code("VALIDATION"),
      );
      const limiterKey = `correction-unit-${randomUUID()}`;
      for (let i = 0; i < 10; i++) rateLimit(limiterKey, 10, 3600000);
      assert.throws(
        () => rateLimit(limiterKey, 10, 3600000),
        code("RATE_LIMIT"),
      );
      const auditRows = await db.auditEvent.findMany({
        where: { tenantId: tenant.id },
      });
      assert.ok(!JSON.stringify(auditRows).includes(published.token));
      assert.ok(!JSON.stringify(auditRows).includes("synthetic@example.test"));
    },
  );

  await t.test(
    "cancellation changes public record status but payment or link status does not edit issued records",
    async () => {
      await db.issuanceEvent.create({
        data: {
          tenantId: tenant.id,
          issuanceId: issuance.id,
          kind: "CANCELLED",
          reason: "Синтетический тест отмены",
          actorId: user.id,
        },
      });
      assert.equal(
        (await publicRecord.publicVerificationRecord(published.token)).status,
        "REVOKED",
      );
      const expiring = await publicRecord.createVerificationLink(c, {
        documentId: document.id,
        publicationConfirmed: true,
      });
      await db.publicDocumentVerification.update({
        where: { id: expiring.id },
        data: { expiresAt: new Date(0) },
      });
      await assert.rejects(
        publicRecord.publicVerificationRecord(expiring.token),
        code("RECORD_UNAVAILABLE"),
      );
      await publicRecord.revokeVerificationLink(c, published.id);
      await assert.rejects(
        publicRecord.publicVerificationRecord(published.token),
        code("RECORD_UNAVAILABLE"),
      );
      await assert.rejects(
        publicRecord.submitPublicCorrection(published.token, {
          message: "Недоступная публикация",
        }),
        code("RECORD_UNAVAILABLE"),
      );
      assert.equal(
        (
          await db.issuedDocument.findUniqueOrThrow({
            where: { id: document.id },
          })
        ).number,
        "TEST-0001",
      );
    },
  );
  await db.$disconnect();
});
