import { randomBytes } from "node:crypto";
import { runRender } from "@demo/printing";
import { today, z } from "@demo/contracts";
import { Prisma, type PublicDocumentVerification } from "@demo/database";
import {
  issuedDocumentValidity,
  publicDocumentStatus,
} from "./document-validity";
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
const qrCache = new Map<string, string>();
export async function verificationQrDataUrl(url: string) {
  const cached = qrCache.get(url);
  if (cached) return cached;
  const qr = await runRender("qr", { url });
  const data = `data:image/png;base64,${qr.buffer.toString("base64")}`;
  if (qrCache.size >= 250) qrCache.delete(qrCache.keys().next().value!);
  qrCache.set(url, data);
  return data;
}
function center(c: Context, write = false) {
  if (
    !["SUPER_ADMIN", "ADMIN", "DIRECTOR", "OPERATOR", "VIEWER"].includes(
      c.role,
    ) ||
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
    select: { id: true, issuanceId: true },
  });
  if (!target) fail(404, "NOT_FOUND", "Выданный документ не найден");
  const workflow = await db.issuanceWorkflow.findFirst({
    where: { tenantId: c.tenantId, issuanceId: target.issuanceId },
  });
  if (workflow && workflow.status !== "ISSUED")
    fail(
      409,
      "ISSUANCE_NOT_COMPLETE",
      "Публичная проверка доступна после полного выпуска и обязательных подписей",
    );
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
    await tx.lmsDocumentLink.updateMany({
      where: { tenantId: c.tenantId, id },
      data: { verificationRevokedAt: new Date() },
    });
    await audit(tx, c, "DOCUMENT_PUBLIC_LINK_REVOKED", id);
    return { revoked: true };
  });
}
/** QR publication can be withdrawn or time-limited without changing a single
 * byte of the issued original. Learner/employer read scope never grants this. */
export async function setLmsVerificationPublication(
  c: Context,
  id: string,
  input: unknown,
) {
  center(c, true);
  const data = parse(
    z.discriminatedUnion("action", [
      z.object({ action: z.literal("REVOKE") }).strict(),
      z
        .object({
          action: z.literal("SET_EXPIRY"),
          expiresAt: z.iso.datetime().nullable(),
        })
        .strict(),
    ]),
    input,
  );
  if (
    data.action === "SET_EXPIRY" &&
    data.expiresAt &&
    new Date(data.expiresAt) <= new Date()
  )
    fail(400, "EXPIRY_PASSED", "Срок публикации должен быть в будущем");
  return transaction(async (tx) => {
    const link = await tx.lmsDocumentLink.findFirst({
      where: { id, tenantId: c.tenantId },
    });
    if (!link?.verificationTokenHash)
      fail(404, "NOT_FOUND", "Публикация не найдена");
    const expiresAt =
      data.action === "SET_EXPIRY" && data.expiresAt
        ? new Date(data.expiresAt)
        : null;
    await tx.lmsDocumentLink.update({
      where: { id },
      data:
        data.action === "REVOKE"
          ? { verificationRevokedAt: new Date() }
          : { verificationExpiresAt: expiresAt },
    });
    await tx.publicDocumentVerification.updateMany({
      where: { id, tenantId: c.tenantId },
      data: data.action === "REVOKE" ? { active: false } : { expiresAt },
    });
    await audit(
      tx,
      c,
      data.action === "REVOKE"
        ? "DOCUMENT_PUBLIC_LINK_REVOKED"
        : "DOCUMENT_PUBLIC_LINK_EXPIRY_CHANGED",
      id,
      {
        ...(data.action === "SET_EXPIRY" ? { expiresAt } : {}),
      },
    );
    return { updated: true };
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
  return recordForLink(link);
}
const printableSearch = (value: string) =>
  Array.from(value).every(
    (character) =>
      character.charCodeAt(0) >= 32 && character.charCodeAt(0) !== 127,
  );
const searchSchema = z
  .object({
    number: z
      .string()
      .trim()
      .min(1)
      .max(80)
      .refine(printableSearch, "Недопустимые символы"),
    issuerName: z
      .string()
      .trim()
      .min(2)
      .max(300)
      .refine(printableSearch, "Недопустимые символы"),
  })
  .strict();

/** Exact number + issuer disambiguates centres without publishing a new record
 * or exposing a private registry. Multiple live links to one document are one
 * candidate; distinct matching documents remain unavailable. */
export async function searchPublicVerification(input: unknown) {
  const data = parse(searchSchema, input);
  const matches = await db.$queryRaw<
    Array<{ id: string; documentId: string; tenantId: string }>
  >(Prisma.sql`
    SELECT DISTINCT ON (d.id) p.id,d.id AS "documentId",d."tenantId"
    FROM "IssuedDocument" d
    JOIN "Issuance" i ON i."tenantId"=d."tenantId" AND i.id=d."issuanceId"
    JOIN "IssuerProfileVersion" profile ON profile."tenantId"=i."tenantId" AND profile.id=i."profileVersionId"
    JOIN "PublicDocumentVerification" p ON p."tenantId"=d."tenantId" AND p."documentId"=d.id
    LEFT JOIN "LmsDocumentLink" dl ON dl."tenantId"=p."tenantId" AND dl."verificationTokenHash"=p."tokenHash"
    WHERE d.number=${data.number}
      AND (profile.profile->>'nameRu'=${data.issuerName} OR profile.profile->>'nameKz'=${data.issuerName})
      AND p.active AND (p."expiresAt" IS NULL OR p."expiresAt">CURRENT_TIMESTAMP)
      AND dl."verificationRevokedAt" IS NULL AND (dl."verificationExpiresAt" IS NULL OR dl."verificationExpiresAt">CURRENT_TIMESTAMP)
    ORDER BY d.id,p."createdAt" DESC,p.id DESC LIMIT 2`);
  if (matches.length !== 1)
    fail(
      404,
      "RECORD_UNAVAILABLE",
      "Запись недоступна. Проверьте номер и точное название эмитента или используйте QR документа.",
    );
  const link = await db.publicDocumentVerification.findFirst({
    where: {
      id: matches[0].id,
      tenantId: matches[0].tenantId,
      active: true,
      OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
    },
  });
  if (!link)
    fail(
      404,
      "RECORD_UNAVAILABLE",
      "Запись недоступна. Проверьте номер и точное название эмитента или используйте QR документа.",
    );
  const record = await recordForLink(link);
  return record.learningDocument
    ? {
        ...record,
        learningDocument: {
          ...record.learningDocument,
          originalReference: null,
        },
      }
    : record;
}

async function recordForLink(link: PublicDocumentVerification) {
  const document = await db.issuedDocument.findFirstOrThrow({
    where: { tenantId: link.tenantId, id: link.documentId },
  });
  const issuance = await db.issuance.findFirstOrThrow({
    where: { tenantId: link.tenantId, id: document.issuanceId },
  });
  const workflow = await db.issuanceWorkflow.findFirst({
    where: { tenantId: link.tenantId, issuanceId: issuance.id },
  });
  const [profile, events, replacement, tenant, request, renewal] =
    await Promise.all([
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
      db.tenant.findUniqueOrThrow({
        where: { id: link.tenantId },
        select: { timezone: true },
      }),
      db.printRequest.findFirst({
        where: { tenantId: link.tenantId, id: document.requestId },
        select: { status: true },
      }),
      db.renewalNeed.findFirst({
        where: {
          tenantId: link.tenantId,
          sourceRequestId: document.requestId,
          assignmentId: document.assignmentId || "missing-issued-assignment",
          confirmed: true,
        },
        orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
        select: { documentValidUntil: true },
      }),
    ]);
  if (
    workflow &&
    workflow.status !== "ISSUED" &&
    !events.some((event) => ["CANCELLED", "REPLACED"].includes(event.kind))
  )
    fail(404, "RECORD_UNAVAILABLE", "Сведения по этой ссылке не опубликованы");
  const issuer = profile.profile as { nameRu?: string; nameKz?: string };
  const lmsType =
    document.templateId === "lms-protocol"
      ? "PROTOCOL"
      : document.templateId === "lms-certificate"
        ? "CERTIFICATE"
        : document.templateId === "lms-credential"
          ? "CREDENTIAL"
          : "NONE";
  const recipientResults =
    document.templateId.startsWith("lms-") && document.rowId
      ? await db.verifiedExamResult.findMany({
          where: { tenantId: link.tenantId, recipientId: document.rowId },
          select: { id: true },
        })
      : [];
  const lmsLink = await db.lmsDocumentLink.findFirst({
    where: {
      tenantId: link.tenantId,
      resultId: {
        in: recipientResults
          .filter(
            (result) => document.assignmentId === `${result.id}-${lmsType}`,
          )
          .map((result) => result.id),
      },
      issuanceId: issuance.id,
      documentType: lmsType,
    },
  });
  const lmsResult = lmsLink
    ? await db.verifiedExamResult.findFirst({
        where: { tenantId: link.tenantId, id: lmsLink.resultId },
      })
    : null;
  const resultInvalidation = lmsResult
    ? await db.lmsResultEvent.findFirst({
        where: {
          tenantId: link.tenantId,
          resultId: lmsResult.id,
          kind: { in: ["VOIDED", "SUPERSEDED"] },
        },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        select: { kind: true },
      })
    : null;
  const lmsSnapshot = lmsResult?.snapshot as
    | {
        profile?: { issuer?: string };
        source?: { verification?: string };
        course?: { titleRu: string; titleKz: string; hours: number };
      }
    | undefined;
  // LMS corrections receive a new immutable result/assignment identity. Follow
  // that explicit lineage as well as the ordinary printing document lineage.
  let learningReplacement = null;
  if (lmsResult && !replacement) {
    const successor = await db.verifiedExamResult.findFirst({
      where: { tenantId: link.tenantId, supersedesResultId: lmsResult.id },
      orderBy: { revision: "desc" },
    });
    const successorLink = successor
      ? await db.lmsDocumentLink.findFirst({
          where: {
            tenantId: link.tenantId,
            resultId: successor.id,
            documentType: lmsType,
            issuanceId: { not: null },
          },
        })
      : null;
    if (
      successorLink?.issuanceId &&
      (await db.issuanceWorkflow.findFirst({
        where: {
          tenantId: link.tenantId,
          issuanceId: successorLink.issuanceId,
          status: "ISSUED",
        },
      }))
    )
      learningReplacement = await db.issuedDocument.findFirst({
        where: {
          tenantId: link.tenantId,
          issuanceId: successorLink.issuanceId,
          assignmentId: `${successor!.id}-${lmsType}`,
        },
      });
  }
  const replacementDocument = replacement || learningReplacement;
  const validUntil = issuedDocumentValidity(
    issuance.snapshot,
    document,
    renewal?.documentValidUntil || null,
  );
  if (
    lmsLink?.verificationTokenHash === link.tokenHash &&
    (lmsLink.verificationRevokedAt ||
      (lmsLink.verificationExpiresAt &&
        lmsLink.verificationExpiresAt <= new Date()))
  )
    fail(404, "RECORD_UNAVAILABLE", "Сведения по этой ссылке не опубликованы");
  return {
    ...(lmsLink && lmsResult
      ? {
          learningDocument: {
            legalForm: lmsLink.legalForm,
            assessmentKind: lmsResult.assessmentKind,
            sourceIssuer: lmsSnapshot?.profile?.issuer || "",
            resultRevision: lmsResult.revision,
            originalReference:
              lmsLink.verificationTokenHash === link.tokenHash
                ? null
                : lmsLink.originalReference,
            course: lmsSnapshot?.course
              ? {
                  titleRu: lmsSnapshot.course.titleRu,
                  titleKz: lmsSnapshot.course.titleKz,
                  hours: lmsSnapshot.course.hours,
                }
              : null,
            sourceVerification:
              lmsSnapshot?.source?.verification || "CENTER_RECORDED",
          },
        }
      : {}),
    issuer: {
      nameRu: issuer.nameRu || "Учебный центр",
      nameKz: issuer.nameKz || "",
    },
    document: {
      type: document.templateId,
      number: document.number,
      date: document.documentDate,
      validUntil,
    },
    status: publicDocumentStatus({
      replaced:
        !!replacementDocument ||
        resultInvalidation?.kind === "SUPERSEDED" ||
        events.some((event) => event.kind === "REPLACED"),
      revoked:
        resultInvalidation?.kind === "VOIDED" ||
        request?.status === "CANCELLED" ||
        events.some((event) => event.kind === "CANCELLED"),
      validUntil,
      today: today(tenant.timezone),
    }),
    replacement: replacementDocument
      ? {
          type: replacementDocument.templateId,
          number: replacementDocument.number,
          date: replacementDocument.documentDate,
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
