import { randomBytes } from "node:crypto";
import { runRender } from "@demo/printing";
import { z } from "@demo/contracts";
import {
  db,
  parse,
  fail,
  hash,
  audit,
  transaction,
  type Context,
} from "./core";

export const PUBLIC_RECORD_LIMITATION =
  "Проверяется запись в реестре этого центра. Страница не подтверждает неизменность любой копии документа и не заменяет проверку подписи.";
function center(c: Context, write = false) {
  if (
    !["ADMIN", "OPERATOR", "VIEWER"].includes(c.role) ||
    (write && c.role === "VIEWER")
  )
    fail(403, "ROLE_DENIED", "Недостаточно прав сотрудника центра");
}
const publicationSchema = z
  .object({
    documentId: z.string().min(1).max(80),
    publicationConfirmed: z.literal(true),
    expiresAt: z.iso.datetime().nullable().default(null),
  })
  .strict();
export async function createVerificationLink(c: Context, input: unknown) {
  center(c, true);
  const data = parse(publicationSchema, input);
  if (data.expiresAt && new Date(data.expiresAt).getTime() <= Date.now())
    fail(400, "EXPIRY_PASSED", "Срок публикации должен быть в будущем");
  const target = await db.issuedDocument.findFirst({
    where: { tenantId: c.tenantId, id: data.documentId },
    select: { id: true },
  });
  if (!target) fail(404, "NOT_FOUND", "Выданный документ не найден");
  const token = randomBytes(32).toString("hex");
  const path = `/verify/${token}`;
  const origin = process.env.DEMO_ORIGIN;
  if (!origin)
    fail(503, "PUBLIC_ORIGIN_REQUIRED", "Адрес приложения не настроен");
  const qr = await runRender("qr", { url: new URL(path, origin).toString() });
  return transaction(async (tx) => {
    const document = await tx.issuedDocument.findFirst({
      where: { tenantId: c.tenantId, id: data.documentId },
    });
    if (!document) fail(404, "NOT_FOUND", "Выданный документ не найден");
    const link = await tx.publicDocumentVerification.create({
      data: {
        tenantId: c.tenantId,
        documentId: document.id,
        tokenHash: hash(token),
        expiresAt: data.expiresAt ? new Date(data.expiresAt) : null,
        createdBy: c.userId,
      },
    });
    await audit(tx, c, "DOCUMENT_MINIMAL_RECORD_PUBLISHED", link.id, {
      documentId: document.id,
    });
    return {
      id: link.id,
      token,
      path,
      qrDataUrl: `data:image/png;base64,${qr.buffer.toString("base64")}`,
      expiresAt: link.expiresAt,
      limitation: PUBLIC_RECORD_LIMITATION,
    };
  });
}
export async function listVerificationLinks(c: Context) {
  center(c);
  return {
    items: await db.publicDocumentVerification.findMany({
      where: { tenantId: c.tenantId },
      select: {
        id: true,
        documentId: true,
        active: true,
        expiresAt: true,
        createdAt: true,
      },
      orderBy: { createdAt: "desc" },
      take: 500,
    }),
  };
}
export async function revokeVerificationLink(c: Context, id: string) {
  center(c, true);
  return transaction(async (tx) => {
    const link = await tx.publicDocumentVerification.findFirst({
      where: { tenantId: c.tenantId, id },
    });
    if (!link) fail(404, "NOT_FOUND", "Публикация не найдена");
    await tx.publicDocumentVerification.update({
      where: { id },
      data: { active: false },
    });
    await audit(tx, c, "DOCUMENT_PUBLIC_LINK_REVOKED", id);
    return { revoked: true };
  });
}
async function published(token: string) {
  if (!/^[a-f0-9]{64}$/.test(token))
    fail(404, "RECORD_UNAVAILABLE", "Сведения по этой ссылке не опубликованы");
  const link = await db.publicDocumentVerification.findFirst({
    where: {
      tokenHash: hash(token),
      active: true,
      OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
    },
  });
  if (!link)
    fail(404, "RECORD_UNAVAILABLE", "Сведения по этой ссылке не опубликованы");
  return link;
}
export async function publicVerificationRecord(token: string) {
  const link = await published(token);
  const document = await db.issuedDocument.findFirstOrThrow({
    where: { tenantId: link.tenantId, id: link.documentId },
  });
  const issuance = await db.issuance.findFirstOrThrow({
    where: { tenantId: link.tenantId, id: document.issuanceId },
  });
  const [profile, events, replacement] = await Promise.all([
    db.issuerProfileVersion.findFirstOrThrow({
      where: { tenantId: link.tenantId, id: issuance.profileVersionId },
    }),
    db.issuanceEvent.findMany({
      where: { tenantId: link.tenantId, issuanceId: issuance.id },
      orderBy: { createdAt: "desc" },
    }),
    db.issuedDocument.findFirst({
      where: { tenantId: link.tenantId, replacesDocumentId: document.id },
      orderBy: { createdAt: "desc" },
    }),
  ]);
  const issuer = profile.profile as { nameRu?: string; nameKz?: string };
  return {
    issuer: {
      nameRu: issuer.nameRu || "Учебный центр",
      nameKz: issuer.nameKz || "",
    },
    document: {
      type: document.templateId,
      number: document.number,
      date: document.documentDate,
    },
    status:
      replacement || events.some((event) => event.kind === "REPLACED")
        ? "REPLACED"
        : events.some((event) => event.kind === "CANCELLED")
          ? "REVOKED"
          : "ACTIVE_RECORD",
    replacement: replacement
      ? {
          type: replacement.templateId,
          number: replacement.number,
          date: replacement.documentDate,
        }
      : null,
    limitation: PUBLIC_RECORD_LIMITATION,
  };
}
export async function submitPublicCorrection(token: string, input: unknown) {
  const data = parse(
    z
      .object({
        message: z.string().trim().min(10).max(2000),
        replyContact: z.string().trim().max(255).default(""),
      })
      .strict(),
    input,
  );
  const link = await published(token);
  await transaction(async (tx) => {
    const record = await tx.documentCorrectionRequest.create({
      data: { ...data, tenantId: link.tenantId, verificationId: link.id },
    });
    await audit(
      tx,
      {
        tenantId: link.tenantId,
        userId: "PUBLIC_VISITOR",
        role: "PUBLIC",
        sessionId: "",
        csrfHash: "",
        correlationId: record.id,
      },
      "PUBLIC_CORRECTION_REQUESTED",
      record.id,
    );
  });
  return {
    accepted: true,
    message: "Обращение передано центру. Выданный документ не изменён.",
  };
}
export async function listDocumentCorrections(c: Context) {
  center(c);
  const records = await db.documentCorrectionRequest.findMany({
    where: { tenantId: c.tenantId },
    orderBy: { createdAt: "desc" },
    take: 500,
  });
  const links = await db.publicDocumentVerification.findMany({
    where: {
      tenantId: c.tenantId,
      id: { in: records.map((record) => record.verificationId) },
    },
    select: { id: true, documentId: true },
  });
  return {
    items: records.map((record) => ({
      ...record,
      documentId: links.find((link) => link.id === record.verificationId)
        ?.documentId,
    })),
  };
}
export async function resolveDocumentCorrection(
  c: Context,
  id: string,
  input: unknown,
) {
  center(c, true);
  const data = parse(
    z
      .object({
        status: z.enum(["REVIEWED", "CLOSED"]),
        resolution: z.string().trim().min(1).max(2000),
      })
      .strict(),
    input,
  );
  return transaction(async (tx) => {
    const old = await tx.documentCorrectionRequest.findFirst({
      where: { tenantId: c.tenantId, id },
    });
    if (!old) fail(404, "NOT_FOUND", "Обращение не найдено");
    const record = await tx.documentCorrectionRequest.update({
      where: { id },
      data: { ...data, resolvedBy: c.userId },
    });
    await audit(tx, c, "PUBLIC_CORRECTION_REVIEWED", id, {
      status: record.status,
    });
    return record;
  });
}
