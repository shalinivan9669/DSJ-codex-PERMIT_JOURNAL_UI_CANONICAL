import { randomUUID } from "node:crypto";
import { itemSchema, z } from "@demo/contracts";
import { audit, fail, hash, json, parse, transaction, type Context } from "../core";
import { assertLmsStaff } from "./scope";
import { applicationInput, availableVersion } from "./applications";

const inputSchema = applicationInput.extend({
  createOrganization: z.boolean().default(false),
  recipientId: z.string().uuid().optional(),
  createRecipient: z.boolean().default(false),
  iin: z.string().trim().regex(/^\d{12}$|^$/).default(""),
}).strict();

/** Intake by the centre never impersonates the applicant or creates a login. */
export async function createOperatorApplication(c: Context, input: unknown) {
  assertLmsStaff(c);
  const data = parse(inputSchema, input);
  const key = hash(`operator:${c.userId}:${data.idempotencyKey}`);
  const inputHash = hash(data);
  return transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${c.tenantId + ":application:" + key},0))`;
    const prior = await tx.lmsApplication.findFirst({ where: { tenantId: c.tenantId, idempotencyKey: key } });
    if (prior) {
      if (prior.inputHash !== inputHash)
        fail(409, "APPLICATION_PAYLOAD_CONFLICT", "Состав заявки изменился. Сохраните её как новую заявку");
      return { id: prior.id, state: prior.state, saved: true };
    }
    await availableVersion(c.tenantId, data.courseVersionId, tx, true, false);
    let customerId: string | null = null;
    let recipientId: string | null = null;
    const contact = {
      organization: data.organization, bin: data.bin, contactName: data.contactName,
      phone: data.phone, email: data.email, position: data.position,
    };
    if (data.kind === "B2B") {
      if (data.customerId && data.createOrganization)
        fail(400, "APPLICATION_ORGANIZATION_CONFLICT", "Выберите существующую или новую организацию");
      if (data.customerId) {
        const organization = await tx.customerOrganization.findFirst({ where: { tenantId: c.tenantId, id: data.customerId, archived: false } });
        if (!organization) fail(404, "NOT_FOUND", "Организация недоступна");
        customerId = organization.id;
        contact.organization = organization.nameRu;
        contact.bin = organization.bin;
      } else if (data.createOrganization && contact.organization && /^\d{12}$/.test(contact.bin)) {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${c.tenantId + ":application-organization:" + contact.bin},0))`;
        if (await tx.customerOrganization.findFirst({ where: { tenantId: c.tenantId, bin: contact.bin, archived: false } }))
          fail(409, "APPLICATION_ORGANIZATION_EXISTS", "Организация с этим БИН уже существует. Выберите её из поиска");
        const organization = await tx.customerOrganization.create({ data: { tenantId: c.tenantId, nameRu: contact.organization, bin: contact.bin } });
        customerId = organization.id;
        await audit(tx, c, "CUSTOMER_CREATED", customerId);
      } else fail(400, "APPLICATION_ORGANIZATION_REQUIRED", "Выберите организацию или укажите её название и БИН из 12 цифр");
      if (!contact.contactName || (!contact.email && !contact.phone))
        fail(400, "APPLICATION_CONTACT_REQUIRED", "Укажите контактное лицо и телефон или почту");
    } else {
      if (data.customerId || data.createOrganization || data.quantity !== 1)
        fail(400, "APPLICATION_PERSONAL_INVALID", "Личная заявка оформляется на одного человека без организации");
      contact.organization = "";
      contact.bin = "";
      if (data.recipientId && !data.createRecipient) {
        const recipient = await tx.recipient.findFirst({ where: { tenantId: c.tenantId, id: data.recipientId, archived: false } });
        if (!recipient) fail(404, "NOT_FOUND", "Человек недоступен");
        const person = itemSchema.parse({ id: recipient.id, ...(recipient.data as Record<string, unknown>) });
        recipientId = recipient.id;
        contact.contactName = person.fullNameRu;
        contact.phone = person.phone || "";
        contact.email = person.email || "";
        contact.position = person.positionRu || "";
      } else if (data.createRecipient && !data.recipientId && data.contactName) {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${c.tenantId + ":employer-recipient-import"},0))`;
        if (data.iin) {
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${c.tenantId + ":recipient-iin:" + data.iin},0))`;
          if (await tx.recipient.findFirst({ where: { tenantId: c.tenantId, archived: false, data: { path: ["iin"], equals: data.iin } } }))
            fail(409, "APPLICATION_PERSON_EXISTS", "Человек с этим ИИН уже есть в реестре. Найдите и выберите его");
        }
        const recipient = await tx.recipient.create({ data: { tenantId: c.tenantId, data: json(itemSchema.parse({
          id: randomUUID(), fullNameRu: data.contactName, fullNameKz: "", positionRu: data.position,
          positionKz: "", workplaceRu: "", workplaceKz: "", phone: data.phone, email: data.email,
          iin: data.iin, assignments: [],
        })) } });
        recipientId = recipient.id;
        await audit(tx, c, "RECIPIENT_CREATED", recipient.id);
      } else fail(400, "APPLICATION_PERSON_REQUIRED", "Выберите человека или подтвердите создание новой карточки");
    }
    const row = await tx.lmsApplication.create({ data: {
      tenantId: c.tenantId, kind: data.kind, courseVersionId: data.courseVersionId,
      actorId: null, assignedTo: c.userId, recipientId, customerId, contact: json(contact),
      quantity: data.quantity, comment: data.comment, idempotencyKey: key, inputHash,
    } });
    await audit(tx, c, "LMS_APPLICATION_CREATED_BY_OPERATOR", row.id, { kind: row.kind, courseVersionId: row.courseVersionId });
    return { id: row.id, state: row.state, saved: true };
  });
}
