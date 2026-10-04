import { today, z } from "@demo/contracts";
import { ArtifactStore } from "@demo/printing";
import { Prisma } from "@demo/database";
import {
  evidenceSchema,
  evidenceState,
} from "../../../packages/contracts/src/operator-value";
import { audit, db, fail, parse, transaction, type Context } from "./core";
import {
  persistValueAttachment,
  publishedPortalRequest,
} from "./operator-value";
import { buildCustomerEvidenceMatrix } from "./renewal-matrix";

type Tx = Prisma.TransactionClient;
const attachmentInput = z
  .object({
    source: z.string().trim().min(1).max(2000),
    fileName: z.string().min(1).max(200),
    contentBase64: z.string().min(1).max(1400000),
  })
  .strict();
const safeAttachment = {
  id: true,
  fileName: true,
  category: true,
  mimeType: true,
  size: true,
  sha256: true,
  customerVisible: true,
  createdAt: true,
} as const;

async function access(
  c: Context,
  customerId: string,
  permission: string,
  tx: Tx = db,
  lock = false,
) {
  if (c.role !== "EMPLOYER")
    fail(403, "EMPLOYER_ONLY", "Используйте доступ представителя работодателя");
  parse(z.string().min(1).max(80), customerId);
  if (lock)
    await tx.$executeRaw`SELECT id FROM "EmployerMembership" WHERE "tenantId"=${c.tenantId} AND "userId"=${c.userId} AND "customerId"=${customerId} FOR UPDATE`;
  const membership = await tx.employerMembership.findFirst({
    where: {
      tenantId: c.tenantId,
      userId: c.userId,
      customerId,
      active: true,
      OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
    },
  });
  if (!membership)
    fail(404, "CUSTOMER_NOT_FOUND", "Доступ к заказчику не найден");
  if (!(membership.permissions as string[]).includes(permission))
    fail(403, "PERMISSION_DENIED", "Недостаточно прав представителя");
  const orders = await tx.serviceOrder.findMany({
    where: {
      tenantId: c.tenantId,
      OR: [{ employerId: customerId }, { employerId: null, customerId }],
    },
    select: { id: true },
  });
  const links = await tx.serviceOrderRequest.findMany({
    where: {
      tenantId: c.tenantId,
      orderId: { in: orders.map((order) => order.id) },
    },
  });
  const [requests, employments, evidence] = await Promise.all([
    tx.printRequest.findMany({
      where: {
        tenantId: c.tenantId,
        id: { in: links.map((link) => link.requestId) },
      },
    }),
    tx.recipientEmployment.findMany({
      where: { tenantId: c.tenantId, employerId: customerId },
      select: { recipientId: true },
    }),
    tx.externalEvidence.findMany({
      where: { tenantId: c.tenantId, customerId },
      select: { recipientId: true },
    }),
  ]);
  const restrict = membership.recipientIds as string[];
  const permitted = (id: string) => !restrict.length || restrict.includes(id);
  const ids = new Set(
    [...employments, ...evidence]
      .map((value) => value.recipientId)
      .filter(permitted),
  );
  const ruleIds = new Set<string>();
  for (const request of requests) {
    const published = await publishedPortalRequest(c, request, tx);
    if (!published) continue;
    const draft = published.draft;
    for (const row of draft.items) {
      if (
        (row.employerId || draft.customerId) !== customerId ||
        !row.recipientId ||
        !permitted(row.recipientId)
      )
        continue;
      ids.add(row.recipientId);
      for (const assignment of row.assignments) {
        const ruleId = draft.events?.find(
          (event) => event.id === assignment.eventId,
        )?.serviceRuleVersionId;
        if (ruleId) ruleIds.add(ruleId);
      }
    }
  }
  const recipients = await tx.recipient.findMany({
    where: { tenantId: c.tenantId, id: { in: [...ids] } },
    select: { id: true, data: true },
  });
  const programs = await tx.serviceRuleVersion.findMany({
    where: {
      tenantId: c.tenantId,
      id: { in: [...ruleIds] },
      status: "APPROVED",
    },
    select: { id: true, serviceKey: true, title: true, version: true },
  });
  return {
    membership,
    recipientIds: recipients.map((person) => person.id),
    recipients: recipients.map((person) => ({
      id: person.id,
      fullNameRu: String(
        (person.data as Record<string, unknown>).fullNameRu || "",
      ),
    })),
    programs,
  };
}
async function evidenceAccess(
  c: Context,
  id: string,
  permission: string,
  tx: Tx = db,
  lock = false,
) {
  const value = await tx.externalEvidence.findFirst({
    where: { tenantId: c.tenantId, id },
  });
  if (!value) fail(404, "EVIDENCE_NOT_FOUND", "Документ не найден");
  const scoped = await access(c, value.customerId, permission, tx, lock);
  if (!scoped.recipientIds.includes(value.recipientId))
    fail(404, "EVIDENCE_NOT_FOUND", "Документ не найден");
  return value;
}
const safeEvidence = (
  item: {
    id: string;
    customerId: string;
    recipientId: string;
    program: string;
    issuer: string;
    originalNumber: string;
    documentDate: string;
    validUntil: string | null;
    source: string;
    status: string;
    verifiedAt: Date | null;
  },
  asOf: string,
) => ({
  id: item.id,
  customerId: item.customerId,
  recipientId: item.recipientId,
  program: item.program,
  issuer: item.issuer,
  originalNumber: item.originalNumber,
  documentDate: item.documentDate,
  validUntil: item.validUntil,
  source: item.source,
  status: item.status,
  verifiedAt: item.verifiedAt,
  state: evidenceState(item, asOf),
});

export async function portalEvidence(c: Context, customerId: string) {
  const scoped = await access(c, customerId, "READ");
  const [items, tenant] = await Promise.all([
    db.externalEvidence.findMany({
      where: {
        tenantId: c.tenantId,
        customerId,
        recipientId: { in: scoped.recipientIds },
      },
      orderBy: { createdAt: "desc" },
    }),
    db.tenant.findUniqueOrThrow({ where: { id: c.tenantId } }),
  ]);
  const attachments = (scoped.membership.permissions as string[]).includes(
    "DOWNLOAD",
  )
    ? await db.valueAttachment.findMany({
        where: {
          tenantId: c.tenantId,
          evidenceId: { in: items.map((item) => item.id) },
          customerVisible: true,
        },
        select: { ...safeAttachment, evidenceId: true },
      })
    : [];
  return {
    customerId,
    recipients: scoped.recipients,
    programs: scoped.programs,
    permissions: scoped.membership.permissions,
    items: items.map((item) => ({
      ...safeEvidence(item, today(tenant.timezone)),
      attachments: attachments
        .filter((attachment) => attachment.evidenceId === item.id)
        .map(({ evidenceId: _evidenceId, ...attachment }) => attachment),
    })),
  };
}
export async function portalMatrix(c: Context, customerId: string) {
  const scoped = await access(c, customerId, "READ");
  const matrix = await buildCustomerEvidenceMatrix(
    c,
    {
      customerId,
      ruleVersionIds: scoped.programs.map((program) => program.id),
    },
    scoped.recipientIds,
  );
  // Public evidence provenance contains no internal staff verification notes or storage paths.
  return {
    ...matrix,
    rows: matrix.rows.map((row) => ({
      ...row,
      cells: row.cells.map((cell) => ({
        ...cell,
        sourceReference:
          cell.source === "OWN"
            ? "Реестр учебного центра"
            : cell.sourceReference,
        evidence: cell.evidence.map((item) => ({
          ...item,
          sourceReference:
            item.source === "OWN"
              ? "Реестр учебного центра"
              : item.sourceReference,
        })),
      })),
    })),
  };
}
export async function addPortalEvidence(c: Context, input: unknown) {
  const data = parse(evidenceSchema, input);
  return transaction(async (tx) => {
    const scoped = await access(c, data.customerId, "PROPOSE", tx, true);
    if (!scoped.recipientIds.includes(data.recipientId))
      fail(
        404,
        "RECIPIENT_NOT_FOUND",
        "Получатель не доступен в составе заказчика",
      );
    const item = await tx.externalEvidence.create({
      data: {
        ...data,
        tenantId: c.tenantId,
        createdBy: c.userId,
        status: "UNVERIFIED",
      },
    });
    await audit(tx, c, "EMPLOYER_EXTERNAL_EVIDENCE_SUBMITTED", item.id, {
      customerId: data.customerId,
      recipientId: data.recipientId,
    });
    const tenant = await tx.tenant.findUniqueOrThrow({
      where: { id: c.tenantId },
    });
    return safeEvidence(item, today(tenant.timezone));
  });
}
export async function attachPortalEvidence(
  c: Context,
  id: string,
  input: unknown,
) {
  const data = parse(attachmentInput, input);
  return transaction(async (tx) => {
    await evidenceAccess(c, id, "PROPOSE", tx, true);
    return persistValueAttachment(c, {
      ...data,
      evidenceId: id,
      category: "SOURCE",
      customerVisible: true,
    });
  });
}
export async function downloadPortalEvidence(c: Context, id: string) {
  const attachment = await db.valueAttachment.findFirst({
    where: {
      tenantId: c.tenantId,
      id,
      customerVisible: true,
      evidenceId: { not: null },
    },
  });
  if (!attachment?.evidenceId) fail(404, "NOT_FOUND", "Вложение не найдено");
  await evidenceAccess(c, attachment.evidenceId, "DOWNLOAD");
  const bytes = await new ArtifactStore().read(
    attachment.storageKey,
    attachment.sha256,
  );
  if (bytes.length !== attachment.size)
    fail(503, "ARTIFACT_UNAVAILABLE", "Вложение повреждено");
  await audit(db, c, "EMPLOYER_EVIDENCE_ATTACHMENT_DOWNLOADED", attachment.id);
  return { attachment, bytes };
}
