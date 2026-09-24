import { readFile, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";
import { db, type Context } from "../../apps/api/src/core";
import { draftSchema, itemSchema } from "../../packages/contracts/src";
import { createRequest, finalize } from "../../apps/api/src/requests";
import { saveRecipient } from "../../apps/api/src/recipients";
import * as value from "../../apps/api/src/operator-value";
import {
  createVerificationLink,
  submitPublicCorrection,
} from "../../apps/api/src/public-verification";
import { saveExportProfile } from "../../apps/api/src/delivery";
import { ArtifactStore } from "../../packages/printing/src";
import { claimJob, executeJob } from "../../apps/render-worker/src/queue";
import { assertTestDatabase } from "../../tests/integration/test-database";

async function main() {
  assertTestDatabase();
  const file = process.argv[2],
    fixture = JSON.parse(await readFile(file, "utf8"));
  const user = await db.user.findFirstOrThrow({
    where: { tenantId: fixture.tenantId, role: "ADMIN" },
  });
  const c: Context = {
    tenantId: fixture.tenantId,
    userId: user.id,
    role: "ADMIN",
    sessionId: "fixture",
    csrfHash: "fixture",
    correlationId: randomUUID(),
  };
  const customer = await db.customerOrganization.create({
    data: {
      tenantId: c.tenantId,
      nameRu: "Синтетический заказчик восстановления",
    },
  });
  const person = await saveRecipient(
    c,
    itemSchema.parse({
      id: randomUUID(),
      fullNameRu: "Синтетический Получатель",
      employerId: customer.id,
      personnelNumber: "00001",
      positionRu: "Инженер",
    }),
  );
  const rule = await value.createServiceRule(c, {
    serviceKey: "PB-DEMO",
    title: "Синтетический паспорт",
    status: "APPROVED",
    source: "Тестовая политика; не нормативное основание",
    applicability: "Только проверка сохранности",
    checkedOn: "2026-09-24",
    definition: {
      programVersion: "1",
      category: "",
      compatibleTemplateIds: ["pb-card", "pb-protocol"],
      requirements: [
        {
          key: "handover",
          label: "Тестовая передача",
          source: "CONTRACT",
          stage: "TRANSFER",
        },
      ],
    },
  });
  const eventId = randomUUID();
  const request = await createRequest(
    c,
    draftSchema.parse({
      kind: "COMPANY",
      schemaVersion: 2,
      customerId: customer.id,
      demoMode: true,
      events: [
        {
          id: eventId,
          title: "Тестовая группа",
          protocolTemplateId: "pb-protocol",
          serviceRuleVersionId: rule.id,
          commonFields: {
            documentDate: "2026-09-24",
            protocolDate: "2026-09-24",
            trainingStart: "2026-09-23",
            trainingEnd: "2026-09-24",
            trainingSubject: "Синтетическая программа",
            validUntil: "2027-09-24",
          },
        },
      ],
      items: [
        {
          id: "person",
          recipientId: person.id,
          employerId: customer.id,
          fullNameRu: "Синтетический Получатель",
          positionRu: "Инженер",
          assignments: [
            {
              id: "pb",
              templateId: "pb-card",
              protocolMode: "GROUP",
              eventId,
              result: "Тестовый положительный исход",
              outcome: { status: "PASSED", source: "Синтетическая ведомость" },
            },
          ],
        },
      ],
    }),
  );
  await finalize(c, request.id, { expectedRevision: 0 }, randomUUID());
  const owner = randomUUID(),
    store = new ArtifactStore();
  for (let i = 0; i < 20; i++) {
    const job = await claimJob(db, owner, c.tenantId);
    if (!job) break;
    await executeJob(db, store, job, owner, new AbortController().signal);
  }
  const order = await value.createServiceOrder(c, {
    title: "Заказ восстановления",
    customerId: customer.id,
    payerId: customer.id,
    requestIds: [request.id],
  });
  await value.saveCommercial(c, order.id, {
    expectedRevision: 0,
    taxRateBasisPoints: 0,
    taxBasis: "Синтетический расчёт",
    lines: [
      {
        label: "Тестовая услуга",
        unit: "PERSON_SERVICE",
        quantity: 1,
        unitPriceMinor: "1234567",
      },
    ],
  });
  await value.recordPayment(c, order.id, {
    amountMinor: "10000",
    occurredOn: "2026-09-24",
    source: "Синтетическое подтверждение",
  });
  const financial = await value.recordFinancialDocument(c, order.id, {
    type: "INVOICE",
    number: "TEST-001",
    documentDate: "2026-09-24",
    source: "Синтетическая запись",
  });
  const evidence = await value.createExternalEvidence(c, {
    customerId: customer.id,
    recipientId: person.id,
    program: "PB-DEMO",
    issuer: "Синтетический внешний центр",
    originalNumber: "EXTERNAL-TEST",
    documentDate: "2026-09-24",
    source: "Только тестовый источник",
  });
  const dossier = await value.createDossierRecord(c, {
    title: "Синтетическая программа",
    category: "PROGRAM",
    version: "1",
    source: "Тест",
    applicability: "Только проверка восстановления",
    ownerId: c.userId,
    customerVisible: true,
  });
  const pdf = await db.artifact.findFirstOrThrow({
    where: { tenantId: c.tenantId, format: "PDF" },
  });
  const contentBase64 = (await store.read(pdf.storageKey, pdf.sha256)).toString(
    "base64",
  );
  for (const owning of [
    { orderId: order.id, eventId },
    { evidenceId: evidence.id },
    { dossierId: dossier.id },
    { financialDocumentId: financial.id },
  ])
    await value.addValueAttachment(c, {
      ...owning,
      category: "SOURCE",
      source: "Синтетический исходный PDF",
      fileName: "Источник.pdf",
      contentBase64,
    });
  const need = await value.createRenewalNeed(c, {
    sourceRequestId: request.id,
    sourceRowId: "person",
    assignmentId: "pb",
    customerId: customer.id,
    recipientId: person.id,
    policySource: "Синтетическая политика",
    policyVersion: "1",
    basisDate: "2026-09-24",
    documentValidUntil: "2027-09-24",
  });
  await value.recordRenewalContact(c, need.id, {
    occurredOn: "2026-09-24",
    channel: "MANUAL",
    outcome: "CONTACTED",
    note: "Синтетическая запись контакта",
  });
  await saveExportProfile(c, {
    name: "Синтетический реестр",
    customerId: customer.id,
    columns: [{ field: "personnelNumber", title: "Табельный номер" }],
  });
  const document = await db.issuedDocument.findFirstOrThrow({
    where: { requestId: request.id, ownerKind: "GROUP" },
  });
  const link = await createVerificationLink(c, {
    documentId: document.id,
    publicationConfirmed: true,
  });
  await submitPublicCorrection(link.token, {
    message: "Синтетическое обращение для проверки восстановления",
  });
  const artifacts = await db.artifact.findMany({
    where: { tenantId: c.tenantId },
  });
  assert.equal(
    await db.generationJob.count({
      where: { tenantId: c.tenantId, status: { not: "SUCCEEDED" } },
    }),
    0,
  );
  for (const artifact of artifacts)
    await store.read(artifact.storageKey, artifact.sha256);
  Object.assign(fixture, {
    groupRequestId: request.id,
    orderId: order.id,
    dossierId: dossier.id,
    evidenceId: evidence.id,
    ruleId: rule.id,
    recipientId: person.id,
    renewalId: need.id,
    artifacts: artifacts.map((a) => ({
      id: a.id,
      kind: a.format,
      sha256: a.sha256,
      size: a.size,
    })),
    attachments: await db.valueAttachment.findMany({
      where: { tenantId: c.tenantId },
      select: { id: true, sha256: true, size: true },
    }),
  });
  await writeFile(file, JSON.stringify(fixture, null, 2));
  console.log(
    JSON.stringify({
      status: "PASS",
      artifacts: artifacts.length,
      newAttachments: fixture.attachments.length,
      groupRequestId: request.id,
    }),
  );
}
main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
