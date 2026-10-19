import { randomUUID } from "node:crypto";
import { itemSchema, z } from "@demo/contracts";
import { audit, fail, hash, json, parse, transaction, type Context } from "../core";
import { assertLmsStaff } from "./scope";

const inputSchema = z.object({
  idempotencyKey: z.string().uuid(), fullNameRu: z.string().trim().min(1).max(300),
  positionRu: z.string().trim().max(200).default(""),
  iin: z.string().trim().regex(/^\d{12}$|^$/).default(""),
  phone: z.string().trim().max(40).default(""), email: z.union([z.email().max(255), z.literal("")]).default(""),
  customerId: z.string().uuid().optional(), confirmDistinctPerson: z.boolean().default(false),
}).strict();
export async function createOperatorRecipient(c: Context, input: unknown) {
  assertLmsStaff(c);
  const data = parse(inputSchema, input), payloadHash = hash({ userId: c.userId, data });
  return transaction(async (tx) => {
    const key = { tenantId: c.tenantId, command: "LMS_CREATE_RECIPIENT", idempotencyKey: data.idempotencyKey };
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${c.tenantId + ":lms-person:" + data.idempotencyKey},0))`;
    const prior = await tx.idempotencyOperation.findUnique({ where: { tenantId_command_idempotencyKey: key } });
    if (prior) {
      if (prior.payloadHash !== payloadHash) fail(409, "IDEMPOTENCY_MISMATCH", "Изменённые данные требуют нового сохранения");
      return prior.result;
    }
    const customer = data.customerId ? await tx.customerOrganization.findFirst({ where: { tenantId: c.tenantId, id: data.customerId, archived: false } }) : null;
    if (data.customerId && !customer) fail(404, "NOT_FOUND", "Организация недоступна");
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${c.tenantId + ":employer-recipient-import"},0))`;
    if (data.iin) {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${c.tenantId + ":recipient-iin:" + data.iin},0))`;
      if (await tx.recipient.findFirst({ where: { tenantId: c.tenantId, archived: false, data: { path: ["iin"], equals: data.iin } } }))
        fail(409, "PERSON_ALREADY_EXISTS", "Человек с этим ИИН уже существует. Выберите его из списка");
    }
    if (!data.confirmDistinctPerson && await tx.recipient.findFirst({ where: { tenantId: c.tenantId, archived: false, OR: [
      { data: { path: ["fullNameRu"], equals: data.fullNameRu } },
      ...(data.email ? [{ data: { path: ["email"], equals: data.email } }] : []),
      ...(data.phone ? [{ data: { path: ["phone"], equals: data.phone } }] : []),
    ] } })) fail(409, "PERSON_MATCH_REVIEW", "Есть человек с таким ФИО или контактом. Выберите запись либо подтвердите, что это другой человек");
    const person = itemSchema.parse({ id: randomUUID(), fullNameRu: data.fullNameRu, fullNameKz: "", positionRu: data.positionRu,
      positionKz: "", workplaceRu: customer?.nameRu || "", workplaceKz: customer?.nameKz || "", employerId: customer?.id,
      iin: data.iin, phone: data.phone, email: data.email, assignments: [], photoAssetId: null });
    const record = await tx.recipient.create({ data: { tenantId: c.tenantId, data: json(person) } });
    if (customer) await tx.recipientEmployment.create({ data: { tenantId: c.tenantId, recipientId: record.id, employerId: customer.id, positionRu: data.positionRu, createdBy: c.userId } });
    const result = { id: record.id, data: person };
    await tx.idempotencyOperation.create({ data: { ...key, payloadHash, result: json(result) } });
    await audit(tx, c, "RECIPIENT_CREATED", record.id, { source: "LMS_ASSIGNMENT" });
    return result;
  });
}
