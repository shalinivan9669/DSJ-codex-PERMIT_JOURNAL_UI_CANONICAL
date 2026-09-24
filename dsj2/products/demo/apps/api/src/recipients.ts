import { randomUUID } from "node:crypto";
import { draftSchema, itemSchema, z } from "@demo/contracts";
import { Prisma } from "@demo/database";
import {
  audit,
  db,
  fail,
  json,
  parse,
  transaction,
  type Context,
} from "./core";
import { checkReferences } from "./requests";

export async function listRecipients(c: Context, query: unknown) {
  const { page, pageSize, search } = parse(
    z.object({
      page: z.coerce.number().int().min(1).default(1),
      pageSize: z.coerce.number().int().min(1).max(100).default(30),
      search: z.string().max(255).default(""),
    }),
    query,
  );
  const pattern = "%" + search.replace(/[\\%_]/g, "\\$&") + "%";
  const where = Prisma.sql`"tenantId"=${c.tenantId} AND NOT archived AND ((${search}='') OR (concat_ws(' ',data->>'fullNameRu',data->>'fullNameKz',data->>'externalId',data->>'personnelNumber') ILIKE ${pattern}))`;
  const [items, total] = await db.$transaction([
    db.$queryRaw<
      Array<{
        id: string;
        tenantId: string;
        data: Prisma.JsonValue;
        createdAt: Date;
      }>
    >(
      Prisma.sql`SELECT id,"tenantId",data,"createdAt" FROM "Recipient" WHERE ${where} ORDER BY data->>'fullNameRu',id LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`,
    ),
    db.$queryRaw<Array<{ count: bigint }>>(
      Prisma.sql`SELECT count(*) FROM "Recipient" WHERE ${where}`,
    ),
  ]);
  return { items, total: Number(total[0].count), page, pageSize };
}
export async function recipientDetail(c: Context, id: string) {
  const record = await db.recipient.findFirst({
    where: { tenantId: c.tenantId, id },
  });
  if (!record) fail(404, "NOT_FOUND", "Получатель не найден");
  const employment = await db.recipientEmployment.findMany({
    where: { tenantId: c.tenantId, recipientId: id },
    orderBy: { createdAt: "desc" },
  });
  const requests = await db.requestItem.findMany({
    where: {
      tenantId: c.tenantId,
      payload: { path: ["recipientId"], equals: id },
    },
    select: { requestId: true, rowId: true },
  });
  return { ...record, employment, requests };
}
export async function saveRecipient(c: Context, input: unknown, id?: string) {
  const data = parse(itemSchema, input);
  await checkReferences(
    db,
    c,
    draftSchema.parse({
      kind: "PERSON",
      items: [{ ...data, id: data.id || randomUUID() }],
    }),
  );
  return transaction(async (tx) => {
    const previous = id
      ? await tx.recipient.findFirst({ where: { tenantId: c.tenantId, id } })
      : null;
    if (id && !previous) fail(404, "NOT_FOUND", "Получатель не найден");
    const record = id
      ? await tx.recipient.update({ where: { id }, data: { data: json(data) } })
      : await tx.recipient.create({
          data: { tenantId: c.tenantId, data: json(data) },
        });
    if (data.employerId) {
      const latest = await tx.recipientEmployment.findFirst({
        where: { tenantId: c.tenantId, recipientId: record.id },
        orderBy: { createdAt: "desc" },
      });
      if (
        !latest ||
        latest.employerId !== data.employerId ||
        latest.personnelNumber !== (data.personnelNumber || "") ||
        latest.positionRu !== data.positionRu ||
        latest.period !== (data.employmentPeriod || "")
      )
        await tx.recipientEmployment.create({
          data: {
            tenantId: c.tenantId,
            recipientId: record.id,
            employerId: data.employerId,
            personnelNumber: data.personnelNumber,
            positionRu: data.positionRu,
            period: data.employmentPeriod,
            createdBy: c.userId,
          },
        });
    }
    await audit(
      tx,
      c,
      id ? "RECIPIENT_UPDATED" : "RECIPIENT_CREATED",
      record.id,
    );
    return record;
  });
}
