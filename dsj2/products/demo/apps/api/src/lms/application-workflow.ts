import { z } from "@demo/contracts";
import { Prisma } from "@demo/database";
import { audit, db, fail, parse, transaction, type Context } from "../core";
import { assertLmsStaff, isLmsStaff, employerMemberships } from "./scope";
import { enrollmentScopeSql } from "./learning-permissions";
import { scopedApplication } from "./applications";
import { enrollmentStatusSql } from "./enrollment-state";

export const applicationStages = [
  "CONTACT",
  "OFFER",
  "CONTRACT",
  "INVOICE",
  "SETTLEMENT",
] as const;
const names: Record<string, string> = {
  CONTACT: "Контакт установлен",
  OFFER: "КП отправлено",
  CONTRACT: "Договор",
  INVOICE: "Счёт",
  SETTLEMENT: "Расчёты",
};
export function paymentSummary(
  commercial: unknown,
  payments: { amountMinor: string; reconciliationRequired: boolean }[],
) {
  const total = (commercial as { totalMinor?: string | null })?.totalMinor;
  const paid = payments
    .filter((p) => !p.reconciliationRequired)
    .reduce((n, p) => n + BigInt(p.amountMinor), 0n);
  return {
    totalMinor: total ?? null,
    paidMinor: paid.toString(),
    state:
      total === undefined ||
      total === null ||
      payments.some((p) => p.reconciliationRequired)
        ? "UNKNOWN"
        : paid >= BigInt(total)
          ? "PAID"
          : paid > 0n
            ? "PARTIAL"
            : "UNPAID",
  };
}
export async function applicationOrderSummary(
  c: Context,
  id: string,
  tx: Prisma.TransactionClient = db,
) {
  const application = await scopedApplication(c, id, tx);
  if (!application.orderId) return { order: null };
  const staff = isLmsStaff(c);
  if (
    !staff &&
    application.kind === "B2B" &&
    !(
      c.role === "EMPLOYER" &&
      (await employerMemberships(c, false, tx)).some(
        (m) => m.customerId === application.customerId,
      )
    )
  )
    return { order: null };
  const order = await tx.serviceOrder.findFirstOrThrow({
    where: { tenantId: c.tenantId, id: application.orderId },
  });
  const [milestones, payments, documents, totals] = await Promise.all([
    tx.orderMilestone.findMany({
      where: {
        tenantId: c.tenantId,
        orderId: order.id,
        sourceReference: { startsWith: "LMS_STAGE:" },
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    }),
    tx.paymentEvent.findMany({
      where: { tenantId: c.tenantId, orderId: order.id },
      select: { amountMinor: true, reconciliationRequired: true },
    }),
    tx.financialDocument.findMany({
      where: { tenantId: c.tenantId, orderId: order.id },
      select: {
        id: true,
        type: true,
        number: true,
        documentDate: true,
        source: true,
      },
      take: 100,
      orderBy: { createdAt: "desc" },
    }),
    tx.$queryRaw<
      Array<{ assigned: bigint; completed: bigint; ready: bigint }>
    >(Prisma.sql`
      SELECT count(*) AS assigned, count(*) FILTER (WHERE (${enrollmentStatusSql()})='COMPLETED') AS completed,
        count(*) FILTER (WHERE latest.eligible AND latest.verdict='PASSED' AND latest."examAt" IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM "LmsResultEvent" re WHERE re."tenantId"=e."tenantId" AND re."resultId"=latest.id AND re.kind IN ('VOIDED','SUPERSEDED'))
          AND jsonb_array_length(COALESCE(latest.snapshot->'profile'->'documentTypes','[]'::jsonb))>0
          AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements_text(COALESCE(latest.snapshot->'profile'->'documentTypes','[]'::jsonb)) required(type)
            WHERE NOT EXISTS (SELECT 1 FROM "LmsDocumentLink" dl
              JOIN "IssuanceWorkflow" iw ON iw."tenantId"=dl."tenantId" AND iw."issuanceId"=dl."issuanceId" AND iw.status='ISSUED'
              JOIN "PrintRequest" pr ON pr."tenantId"=dl."tenantId" AND pr.id=dl."requestId" AND pr.status<>'CANCELLED'
              WHERE dl."tenantId"=e."tenantId" AND dl."resultId"=latest.id AND dl."documentType"=required.type
              AND dl.status NOT IN ('VOIDED','SUPERSEDED')
              AND NOT EXISTS (SELECT 1 FROM "IssuanceEvent" ie WHERE ie."tenantId"=dl."tenantId" AND ie."issuanceId"=dl."issuanceId" AND ie.kind IN ('CANCELLED','REPLACED'))
              AND EXISTS (SELECT 1 FROM "IssuedDocument" doc JOIN "Artifact" a ON a."tenantId"=doc."tenantId" AND a."documentId"=doc.id AND a.format='PDF'
                WHERE doc."tenantId"=dl."tenantId" AND doc."issuanceId"=dl."issuanceId" AND doc."assignmentId"=latest.id||'-'||dl."documentType")
            ))) AS ready
      FROM "Enrollment" e LEFT JOIN LATERAL (SELECT r.* FROM "VerifiedExamResult" r WHERE r."tenantId"=e."tenantId" AND r."enrollmentId"=e.id ORDER BY revision DESC LIMIT 1) latest ON true
      WHERE e."tenantId"=${c.tenantId} AND e."sourceOrderId"=${order.id} AND e.status<>'CANCELLED' AND (${enrollmentScopeSql(c)})`),
  ]);
  const count = totals[0];
  return {
    order: { id: order.id, revision: order.revision, status: order.status },
    expected: application.quantity,
    assigned: Number(count.assigned),
    completed: Number(count.completed),
    documentsReady: Number(count.ready),
    payment: staff ? paymentSummary(order.commercial, payments) : undefined,
    stages: staff
      ? applicationStages.map((stage) => ({
          stage,
          record:
            milestones.find(
              (m) => m.sourceReference === `LMS_STAGE:${stage}`,
            ) || null,
        }))
      : [],
    financialDocuments: staff ? documents : [],
  };
}
const stageInput = z
  .object({
    stage: z.enum(applicationStages),
    revision: z.number().int().nonnegative(),
    status: z.enum(["DONE", "WAIVED"]),
    evidence: z.string().trim().max(2000).default(""),
    reason: z.string().trim().max(2000).default(""),
    occurredAt: z.string().datetime().optional(),
    financialDocumentId: z.string().uuid().optional(),
  })
  .strict();
export async function recordApplicationStage(
  c: Context,
  id: string,
  input: unknown,
) {
  assertLmsStaff(c);
  const data = parse(stageInput, input);
  if (data.stage === "SETTLEMENT" && data.status !== "WAIVED")
    fail(
      400,
      "PAYMENT_FACT_REQUIRED",
      "Оплата определяется зарегистрированными платежами заказа",
    );
  if (data.status === "DONE" && (!data.evidence || !data.occurredAt))
    fail(400, "EVIDENCE_REQUIRED", "Укажите подтверждённое событие и время");
  if (data.status === "WAIVED" && !data.reason)
    fail(400, "REASON_REQUIRED", "Укажите причину неприменимости этапа");
  if (
    data.occurredAt &&
    new Date(data.occurredAt).getTime() > Date.now() + 60000
  )
    fail(
      400,
      "EVENT_TIME_INVALID",
      "Подтверждённое событие не может быть в будущем",
    );
  return transaction(async (tx) => {
    const application = await scopedApplication(c, id, tx);
    if (!application.orderId)
      fail(409, "APPLICATION_NOT_ACCEPTED", "Сначала примите заявку");
    await tx.$executeRaw`SELECT id FROM "ServiceOrder" WHERE "tenantId"=${c.tenantId} AND id=${application.orderId} FOR UPDATE`;
    const order = await tx.serviceOrder.findFirstOrThrow({
      where: { tenantId: c.tenantId, id: application.orderId },
    });
    if (order.revision !== data.revision)
      fail(
        409,
        "REVISION_CONFLICT",
        "Заказ изменён. Обновите состояние; комментарий сохранён",
      );
    if (order.status === "CLOSED") fail(409, "ORDER_CLOSED", "Заказ закрыт");
    if (
      data.financialDocumentId &&
      !(await tx.financialDocument.findFirst({
        where: {
          tenantId: c.tenantId,
          orderId: order.id,
          id: data.financialDocumentId,
          ...(data.stage === "CONTRACT" || data.stage === "INVOICE"
            ? { type: data.stage }
            : {}),
        },
      }))
    )
      fail(404, "NOT_FOUND", "Документ заказа не найден");
    if (
      data.status === "DONE" &&
      ["CONTRACT", "INVOICE"].includes(data.stage) &&
      !data.financialDocumentId
    )
      fail(
        400,
        "FINANCIAL_DOCUMENT_REQUIRED",
        "Выберите зарегистрированный документ заказа",
      );
    const sourceReference = `LMS_STAGE:${data.stage}`;
    const prior = await tx.orderMilestone.findFirst({
      where: { tenantId: c.tenantId, orderId: order.id, sourceReference },
    });
    const value = {
      status: data.status,
      evidence:
        data.status === "DONE"
          ? JSON.stringify({
              origin: "MANUALLY_CONFIRMED",
              reference: data.evidence,
              occurredAt: data.occurredAt,
              financialDocumentId: data.financialDocumentId || null,
            })
          : "",
      reason: data.reason,
      completedBy: c.userId,
      completedAt: new Date(),
    };
    const record = prior
      ? await tx.orderMilestone.update({ where: { id: prior.id }, data: value })
      : await tx.orderMilestone.create({
          data: {
            tenantId: c.tenantId,
            orderId: order.id,
            label: names[data.stage],
            category: "EVIDENCE",
            source: "RECOMMENDATION",
            sourceReference,
            ...value,
          },
        });
    await tx.serviceOrder.update({
      where: { id: order.id },
      data: { revision: { increment: 1 } },
    });
    await audit(tx, c, "LMS_ORDER_STAGE_RECORDED", order.id, {
      stage: data.stage,
      status: data.status,
      milestoneId: record.id,
      previousStatus: prior?.status || null,
      origin: "MANUALLY_CONFIRMED",
    });
    return { ok: true, revision: order.revision + 1 };
  });
}
export async function closeApplicationOrder(
  c: Context,
  id: string,
  input: unknown,
) {
  assertLmsStaff(c);
  const data = parse(
    z
      .object({
        revision: z.number().int().nonnegative(),
        reason: z.string().trim().min(1).max(2000),
      })
      .strict(),
    input,
  );
  return transaction(async (tx) => {
    const application = await scopedApplication(c, id, tx);
    if (!application.orderId)
      fail(409, "APPLICATION_NOT_ACCEPTED", "Сначала примите заявку");
    await tx.$executeRaw`SELECT id FROM "ServiceOrder" WHERE "tenantId"=${c.tenantId} AND id=${application.orderId} FOR UPDATE`;
    const summary = await applicationOrderSummary(c, id, tx);
    if (
      !summary.order ||
      summary.assigned! < summary.expected! ||
      summary.completed! < summary.expected! ||
      summary.documentsReady! < summary.expected!
    )
      fail(
        409,
        "ORDER_NOT_COMPLETE",
        "Не все участники завершили обучение и получили допустимые документы",
      );
    if (
      summary.payment?.state !== "PAID" &&
      !summary.stages?.some(
        (s) => s.stage === "SETTLEMENT" && s.record?.status === "WAIVED",
      )
    )
      fail(
        409,
        "SETTLEMENT_REQUIRED",
        "Завершите расчёты или укажите причину неприменимости",
      );
    const changed = await tx.serviceOrder.updateMany({
      where: {
        tenantId: c.tenantId,
        id: summary.order!.id,
        revision: data.revision,
        status: "OPEN",
      },
      data: { status: "CLOSED", revision: { increment: 1 } },
    });
    if (!changed.count)
      fail(409, "REVISION_CONFLICT", "Заказ уже изменён. Обновите состояние");
    await audit(tx, c, "LMS_ORDER_CLOSED", summary.order!.id, {
      reason: data.reason,
      expected: summary.expected,
    });
    return { ok: true };
  });
}
