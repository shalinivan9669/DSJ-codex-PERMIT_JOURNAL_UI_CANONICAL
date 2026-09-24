import { randomUUID } from "node:crypto";
import {
  draftSchema,
  assignmentSchema,
  today,
  z,
  type Draft,
} from "@demo/contracts";
import {
  serviceOrderSchema,
  orderPatchSchema,
  milestoneSchema,
  milestonePatchSchema,
  renewalSchema,
  renewalPatchSchema,
  contactSchema,
  evidenceSchema,
  evidenceVerificationSchema,
  ruleVersionSchema,
  dossierSchema,
  membershipSchema,
  proposalSchema,
  commercialSchema,
  calculateCommercial,
  paymentSchema,
  financialDocumentSchema,
  valueAttachmentSchema,
  evidenceState,
} from "../../../packages/contracts/src/operator-value";
import { Prisma } from "@demo/database";
import { ArtifactStore, buildZip } from "@demo/printing";
import {
  db,
  fail,
  parse,
  json,
  hash,
  audit,
  transaction,
  scopedRequest,
  type Context,
} from "./core";

type Tx = Prisma.TransactionClient;
function center(c: Context, write = false, admin = false) {
  if (
    !["ADMIN", "OPERATOR", "VIEWER"].includes(c.role) ||
    (write && c.role === "VIEWER") ||
    (admin && c.role !== "ADMIN")
  )
    fail(403, "ROLE_DENIED", "Недостаточно прав сотрудника центра");
}
async function customer(
  c: Context,
  id: string | null | undefined,
  tx: Tx = db,
) {
  if (
    id &&
    !(await tx.customerOrganization.findFirst({
      where: { tenantId: c.tenantId, id, archived: false },
    }))
  )
    fail(404, "CUSTOMER_NOT_FOUND", "Заказчик не найден");
}
async function operator(
  c: Context,
  id: string | null | undefined,
  tx: Tx = db,
) {
  if (
    id &&
    !(await tx.user.findFirst({
      where: {
        tenantId: c.tenantId,
        id,
        active: true,
        role: { in: ["ADMIN", "OPERATOR"] },
      },
    }))
  )
    fail(404, "OPERATOR_NOT_FOUND", "Ответственный сотрудник не найден");
}
async function order(c: Context, id: string, tx: Tx = db) {
  const value = await tx.serviceOrder.findFirst({
    where: { tenantId: c.tenantId, id },
  });
  if (!value) fail(404, "NOT_FOUND", "Заказ не найден");
  return value;
}
async function renewal(c: Context, id: string, tx: Tx = db) {
  const value = await tx.renewalNeed.findFirst({
    where: { tenantId: c.tenantId, id },
  });
  if (!value) fail(404, "NOT_FOUND", "Потребность не найдена");
  return value;
}
async function lockOrder(c: Context, id: string, tx: Tx) {
  await tx.$executeRaw`SELECT id FROM "ServiceOrder" WHERE id=${id} AND "tenantId"=${c.tenantId} FOR UPDATE`;
  return order(c, id, tx);
}
async function linkRequests(
  c: Context,
  orderId: string,
  ids: string[],
  customerId: string | null,
  tx: Tx,
) {
  for (const requestId of new Set(ids)) {
    const request = await scopedRequest(c, requestId, tx);
    const draft = draftSchema.parse(request.draft);
    const scopedRows = draft.items.filter(
      (row) => (row.employerId || request.customerId) === customerId,
    );
    if (request.customerId !== customerId && !scopedRows.length)
      fail(
        409,
        "CUSTOMER_MISMATCH",
        "В заявке нет участников выбранного заказчика",
      );
    await tx.serviceOrderRequest.upsert({
      where: {
        tenantId_orderId_requestId: {
          tenantId: c.tenantId,
          orderId,
          requestId,
        },
      },
      create: { tenantId: c.tenantId, orderId, requestId },
      update: {},
    });
    const currentOrder = await order(c, orderId, tx);
    for (const event of draft.events || []) {
      if (
        !event.serviceRuleVersionId ||
        !scopedRows.some((row) =>
          row.assignments.some((assignment) => assignment.eventId === event.id),
        )
      )
        continue;
      const rule = await tx.serviceRuleVersion.findFirst({
        where: {
          tenantId: c.tenantId,
          id: event.serviceRuleVersionId,
          status: "APPROVED",
        },
      });
      if (!rule)
        fail(
          409,
          "SERVICE_RULE_NOT_APPROVED",
          "Для обязательств заказа требуется утверждённая версия паспорта услуги",
        );
      const definition = ruleVersionSchema.shape.definition.parse(
        rule.definition,
      );
      for (const requirement of definition.requirements) {
        const sourceReference = `${rule.source}\nПаспорт ${rule.serviceKey} v${rule.version} (${rule.id}); заявка ${request.id}; событие ${event.id}; требование ${requirement.key}`;
        if (
          await tx.orderMilestone.findFirst({
            where: { tenantId: c.tenantId, orderId, sourceReference },
          })
        )
          continue;
        await tx.orderMilestone.create({
          data: {
            tenantId: c.tenantId,
            orderId,
            label: requirement.label,
            category: requirement.stage,
            source: requirement.source,
            sourceReference,
            ownerId: currentOrder.ownerId,
            dueDate: currentOrder.dueDate,
          },
        });
        await audit(tx, c, "ORDER_RULE_REQUIREMENT_MATERIALIZED", orderId, {
          requestId,
          eventId: event.id,
          ruleVersionId: rule.id,
          requirementKey: requirement.key,
        });
      }
    }
  }
}
export async function createServiceOrder(c: Context, input: unknown) {
  center(c, true);
  const { requestIds, ...data } = parse(serviceOrderSchema, input);
  return transaction(async (tx) => {
    await customer(c, data.customerId, tx);
    await customer(c, data.payerId, tx);
    await operator(c, data.ownerId, tx);
    const value = await tx.serviceOrder.create({
      data: { ...data, tenantId: c.tenantId, createdBy: c.userId },
    });
    await linkRequests(c, value.id, requestIds, value.customerId, tx);
    await audit(tx, c, "ORDER_CREATED", value.id, {
      requestCount: requestIds.length,
    });
    return value;
  });
}
async function orderDetail(c: Context, id: string) {
  const value = await order(c, id);
  const [
    links,
    milestones,
    payments,
    proposals,
    financialDocuments,
    attachments,
  ] = await Promise.all([
    db.serviceOrderRequest.findMany({
      where: { tenantId: c.tenantId, orderId: id },
    }),
    db.orderMilestone.findMany({
      where: { tenantId: c.tenantId, orderId: id },
      orderBy: { createdAt: "asc" },
    }),
    db.paymentEvent.findMany({
      where: { tenantId: c.tenantId, orderId: id },
      orderBy: { createdAt: "asc" },
    }),
    db.portalProposal.findMany({
      where: { tenantId: c.tenantId, orderId: id },
      orderBy: { createdAt: "desc" },
    }),
    db.financialDocument.findMany({
      where: { tenantId: c.tenantId, orderId: id },
    }),
    db.valueAttachment.findMany({
      where: { tenantId: c.tenantId, orderId: id },
      select: attachmentSelect,
    }),
  ]);
  const requests = await db.printRequest.findMany({
    where: {
      tenantId: c.tenantId,
      id: { in: links.map((link) => link.requestId) },
    },
  });
  const events = await db.trainingEvent.findMany({
    where: {
      tenantId: c.tenantId,
      requestId: { in: requests.map((request) => request.id) },
    },
    select: { id: true, title: true, requestId: true },
    orderBy: { createdAt: "asc" },
  });
  const blocking = milestones.filter(
    (m) => m.source !== "RECOMMENDATION" && m.status === "PENDING",
  );
  const byCategory = (category: string) =>
    !blocking.some((m) => m.category === category);
  const commercial = value.commercial as Partial<
    ReturnType<typeof calculateCommercial>
  >;
  const paidMinor = payments.reduce(
    (sum, p) => sum + (p.reconciliationRequired ? 0n : BigInt(p.amountMinor)),
    0n,
  );
  const total =
    commercial.totalMinor === undefined || commercial.totalMinor === null
      ? null
      : BigInt(commercial.totalMinor);
  const paymentState =
    payments.some((p) => p.reconciliationRequired) || total === null
      ? "RECONCILIATION_REQUIRED"
      : paidMinor >= total
        ? "PAID"
        : paidMinor > 0n
          ? "PARTIAL"
          : "UNPAID";
  const customerRecord = value.customerId
    ? await db.customerOrganization.findFirst({
        where: { tenantId: c.tenantId, id: value.customerId },
      })
    : null;
  return {
    ...value,
    customer: customerRecord,
    events,
    requests: requests.map((r) => ({
      requestId: r.id,
      id: r.id,
      title: r.title,
      status: r.status,
      revision: r.revision,
      itemCount: draftSchema
        .parse(r.draft)
        .items.filter(
          (row) => (row.employerId || r.customerId) === value.customerId,
        ).length,
    })),
    milestones,
    proposals,
    financialDocuments,
    attachments,
    nextActions: [
      ...blocking.map((m) => ({
        id: m.id,
        label: m.label,
        category: m.category,
        ownerId: m.ownerId ?? value.ownerId,
        dueDate: m.dueDate,
        source: m.source,
      })),
      ...requests
        .filter((r) => r.status === "DRAFT")
        .map((r) => ({
          id: r.id,
          label: `Подготовить заявку: ${r.title || r.id}`,
          category: "DOCUMENTS",
          ownerId: value.ownerId,
          dueDate: value.dueDate,
          source: "REQUEST",
        })),
      ...proposals
        .filter((p) => p.status === "PENDING")
        .map((p) => ({
          id: p.id,
          label: "Проверить предложение заказчика",
          category: "DATA",
          ownerId: value.ownerId,
          dueDate: null,
          source: "CUSTOMER",
        })),
    ],
    completion: {
      training: byCategory("RESULTS"),
      documents:
        requests.length > 0 &&
        requests.every((r) => r.status === "FINALIZED") &&
        byCategory("DOCUMENTS"),
      transfer:
        milestones.some(
          (m) => m.category === "TRANSFER" && m.status === "DONE",
        ) && byCategory("TRANSFER"),
      settlement: byCategory("SETTLEMENT"),
    },
    commercial: {
      ...commercial,
      paidMinor: paidMinor.toString(),
      paymentState,
      payments,
    },
  };
}
export async function serviceOrderDetail(c: Context, id: string) {
  center(c);
  return orderDetail(c, id);
}
export async function listServiceOrders(c: Context, search = "") {
  center(c);
  const values = await db.serviceOrder.findMany({
    where: {
      tenantId: c.tenantId,
      ...(search
        ? {
            title: {
              contains: search.slice(0, 255),
              mode: "insensitive" as const,
            },
          }
        : {}),
    },
    orderBy: { updatedAt: "desc" },
    take: 100,
  });
  return {
    items: await Promise.all(values.map((value) => orderDetail(c, value.id))),
  };
}
export async function patchServiceOrder(
  c: Context,
  id: string,
  input: unknown,
) {
  center(c, true);
  const { expectedRevision, requestIds, reason, ...data } = parse(
    orderPatchSchema,
    input,
  );
  return transaction(async (tx) => {
    const old = await lockOrder(c, id, tx);
    if (old.revision !== expectedRevision)
      fail(409, "REVISION_CONFLICT", "Заказ изменён другим сотрудником");
    if (
      old.status === "COMPLETED" &&
      requestIds?.length &&
      (data.status !== "OPEN" || !reason?.trim())
    )
      fail(
        409,
        "ORDER_REOPEN_REQUIRED",
        "Откройте заказ с причиной изменения перед добавлением заявок",
      );
    await operator(c, data.ownerId, tx);
    if (requestIds) await linkRequests(c, id, requestIds, old.customerId, tx);
    if (data.status === "CANCELLED" && !reason?.trim())
      fail(400, "REASON_REQUIRED", "Укажите причину отмены заказа");
    if (data.status === "COMPLETED") {
      const count = await tx.orderMilestone.count({
        where: {
          tenantId: c.tenantId,
          orderId: id,
          source: { not: "RECOMMENDATION" },
          status: "PENDING",
        },
      });
      const pending = await tx.portalProposal.count({
        where: { tenantId: c.tenantId, orderId: id, status: "PENDING" },
      });
      const links = await tx.serviceOrderRequest.findMany({
        where: { tenantId: c.tenantId, orderId: id },
      });
      const unfinished = await tx.printRequest.count({
        where: {
          tenantId: c.tenantId,
          id: { in: links.map((l) => l.requestId) },
          status: "DRAFT",
        },
      });
      const transferred = await tx.orderMilestone.count({
        where: {
          tenantId: c.tenantId,
          orderId: id,
          category: "TRANSFER",
          status: "DONE",
        },
      });
      if (count || pending || unfinished || !links.length || !transferred)
        fail(
          409,
          "ORDER_INCOMPLETE",
          "Завершите обязательства, рассмотрите предложения, оформите заявки и зафиксируйте передачу комплекта",
        );
    }
    const value = await tx.serviceOrder.update({
      where: { id },
      data: { ...data, revision: { increment: 1 } },
    });
    await audit(tx, c, "ORDER_UPDATED", id, {
      revision: value.revision,
      status: value.status,
      reason: reason || "",
    });
    return value;
  });
}
export async function createOrderMilestone(
  c: Context,
  id: string,
  input: unknown,
) {
  center(c, true);
  const data = parse(milestoneSchema, input);
  return transaction(async (tx) => {
    await lockOrder(c, id, tx);
    await operator(c, data.ownerId, tx);
    const result = await tx.orderMilestone.create({
      data: { ...data, tenantId: c.tenantId, orderId: id },
    });
    await audit(tx, c, "ORDER_REQUIREMENT_ADDED", id, {
      milestoneId: result.id,
      source: result.source,
    });
    return result;
  });
}
export async function patchOrderMilestone(
  c: Context,
  id: string,
  milestoneId: string,
  input: unknown,
) {
  center(c, true);
  const data = parse(milestonePatchSchema, input);
  return transaction(async (tx) => {
    await lockOrder(c, id, tx);
    const old = await tx.orderMilestone.findFirst({
      where: { id: milestoneId, tenantId: c.tenantId, orderId: id },
    });
    if (!old) fail(404, "NOT_FOUND", "Обязательство не найдено");
    if (
      data.status === "WAIVED" &&
      (old.source === "NORMATIVE" ||
        (old.source === "CONTRACT" && c.role !== "ADMIN"))
    )
      fail(
        403,
        "WAIVER_DENIED",
        "Нормативное обязательство не снимается; договорное изменяет администратор",
      );
    if (data.status === "WAIVED" && !data.reason.trim())
      fail(400, "REASON_REQUIRED", "Укажите основание изменения обязательства");
    if (data.status === "DONE" && !data.evidence.trim())
      fail(400, "EVIDENCE_REQUIRED", "Укажите проверяемый факт выполнения");
    const result = await tx.orderMilestone.update({
      where: { id: milestoneId },
      data: {
        ...data,
        completedBy: data.status === "PENDING" ? null : c.userId,
        completedAt: data.status === "PENDING" ? null : new Date(),
      },
    });
    await audit(tx, c, "ORDER_REQUIREMENT_UPDATED", id, {
      milestoneId,
      status: result.status,
    });
    return result;
  });
}

export async function saveCommercial(c: Context, id: string, input: unknown) {
  center(c, true);
  const data = parse(commercialSchema, input);
  let calculated: ReturnType<typeof calculateCommercial>;
  try {
    calculated = calculateCommercial(data);
  } catch (error) {
    fail(
      400,
      "COMMERCIAL_INVALID",
      error instanceof Error ? error.message : "Проверьте расчёт",
    );
  }
  return transaction(async (tx) => {
    const old = await lockOrder(c, id, tx);
    if (old.revision !== data.expectedRevision)
      fail(409, "REVISION_CONFLICT", "Заказ изменён другим сотрудником");
    await tx.serviceOrder.update({
      where: { id },
      data: { commercial: json(calculated), revision: { increment: 1 } },
    });
    await audit(tx, c, "ORDER_COMMERCIAL_SAVED", id, {
      lineCount: calculated.lines.length,
    });
    return { ...calculated, revision: old.revision + 1 };
  });
}
export async function recordPayment(c: Context, id: string, input: unknown) {
  center(c, true, true);
  const data = parse(paymentSchema, input);
  return transaction(async (tx) => {
    await lockOrder(c, id, tx);
    const value = await tx.paymentEvent.create({
      data: { ...data, tenantId: c.tenantId, orderId: id, createdBy: c.userId },
    });
    await audit(tx, c, "PAYMENT_RECORDED_MANUALLY", id, {
      paymentId: value.id,
      reconciliationRequired: value.reconciliationRequired,
    });
    return value;
  });
}
export async function recordFinancialDocument(
  c: Context,
  id: string,
  input: unknown,
) {
  center(c, true);
  const data = parse(financialDocumentSchema, input);
  return transaction(async (tx) => {
    await order(c, id, tx);
    const value = await tx.financialDocument.create({
      data: { ...data, tenantId: c.tenantId, orderId: id, createdBy: c.userId },
    });
    await audit(tx, c, "FINANCIAL_DOCUMENT_RECORDED", id, {
      documentId: value.id,
      type: value.type,
    });
    return value;
  });
}
export async function commercialExchange(c: Context, id: string) {
  center(c);
  const detail = await orderDetail(c, id);
  const payer = detail.payerId
    ? await db.customerOrganization.findFirst({
        where: { tenantId: c.tenantId, id: detail.payerId },
      })
    : detail.customer;
  await audit(db, c, "COMMERCIAL_TABLE_EXPORTED", id);
  return {
    orderId: id,
    customer: detail.customer,
    payer,
    ...detail.commercial,
    financialDocuments: detail.financialDocuments,
    limitation:
      "Согласованная таблица для передачи в учётную систему. Не является интеграцией с банком, ЭСФ или 1С.",
  };
}

export async function identifyRenewalNeed(c: Context, input: unknown) {
  center(c, true);
  const data = parse(renewalSchema, input);
  return transaction(async (tx) => {
    await tx.$executeRaw`SELECT id FROM "PrintRequest" WHERE id=${data.sourceRequestId} AND "tenantId"=${c.tenantId} FOR UPDATE`;
    const source = await scopedRequest(c, data.sourceRequestId, tx);
    if (source.status === "DRAFT")
      fail(
        409,
        "HISTORY_REQUIRED",
        "Потребность создаётся из оформленной истории",
      );
    const draft = draftSchema.parse(source.draft);
    const row = draft.items.find((i) => i.id === data.sourceRowId);
    if (!row?.assignments.some((a) => a.id === data.assignmentId))
      fail(404, "ASSIGNMENT_NOT_FOUND", "Историческое назначение не найдено");
    if ((row.employerId || source.customerId) !== data.customerId)
      fail(
        409,
        "CUSTOMER_MISMATCH",
        "Заказчик не совпадает с работодателем исторической строки",
      );
    if (
      data.recipientId &&
      !(await tx.recipient.findFirst({
        where: { tenantId: c.tenantId, id: data.recipientId },
      }))
    )
      fail(404, "RECIPIENT_NOT_FOUND", "Получатель не найден");
    const identity = (row as unknown as { recipientId?: string }).recipientId;
    if (data.recipientId && identity !== data.recipientId)
      fail(
        409,
        "IDENTITY_UNCONFIRMED",
        "Историческая строка не связана с выбранным получателем; сначала выполните сверку",
      );
    await operator(c, data.ownerId, tx);
    const sourceKey = hash({
      sourceRequestId: data.sourceRequestId,
      sourceRowId: data.sourceRowId,
      assignmentId: data.assignmentId,
      policyVersion: data.policyVersion,
      basisDate: data.basisDate,
      nextCheckDate: data.nextCheckDate,
      documentValidUntil: data.documentValidUntil,
    });
    const existing = await tx.renewalNeed.findUnique({
      where: { tenantId_sourceKey: { tenantId: c.tenantId, sourceKey } },
    });
    if (existing) return { value: existing, created: false };
    const value = await tx.renewalNeed.create({
      data: {
        ...data,
        tenantId: c.tenantId,
        sourceKey,
        state: data.confirmed ? "CONFIRMED" : "NEEDS_REVIEW",
      },
    });
    await audit(tx, c, "RENEWAL_IDENTIFIED", value.id, {
      sourceRequestId: data.sourceRequestId,
    });
    return { value, created: true };
  });
}
export async function createRenewalNeed(c: Context, input: unknown) {
  return (await identifyRenewalNeed(c, input)).value;
}
export async function listRenewals(c: Context) {
  center(c);
  const values = await db.renewalNeed.findMany({
    where: { tenantId: c.tenantId },
    orderBy: [{ contactAfter: "asc" }, { createdAt: "desc" }],
    take: 300,
  });
  const ids = [...new Set(values.map((v) => v.sourceRequestId))];
  const sources = await db.printRequest.findMany({
    where: { tenantId: c.tenantId, id: { in: ids } },
  });
  const contacts = await db.renewalContact.findMany({
    where: { tenantId: c.tenantId, renewalId: { in: values.map((v) => v.id) } },
    orderBy: { createdAt: "desc" },
  });
  return {
    items: values.map((v) => {
      const source = sources.find((s) => s.id === v.sourceRequestId);
      const row = source
        ? draftSchema
            .parse(source.draft)
            .items.find((i) => i.id === v.sourceRowId)
        : undefined;
      return {
        ...v,
        fullNameRu: row?.fullNameRu ?? "",
        contacts: contacts.filter((contact) => contact.renewalId === v.id),
        manualText: `Просим уточнить актуальность сотрудника ${row?.fullNameRu ?? ""} и потребность в повторном обращении. Сведения о следующей проверке: ${v.nextCheckDate || "срок не подтверждён"}. Основание: ${v.policySource}.`,
      };
    }),
  };
}
export async function updateRenewal(c: Context, id: string, input: unknown) {
  center(c, true);
  const data = parse(renewalPatchSchema, input);
  return transaction(async (tx) => {
    const old = await renewal(c, id, tx);
    if (old.newRequestId)
      fail(409, "RENEWAL_HAS_ORDER", "Новая заявка уже создана");
    if (["IRRELEVANT", "DEFERRED"].includes(data.state) && !data.reason.trim())
      fail(400, "REASON_REQUIRED", "Укажите причину закрытия или переноса");
    if (data.state === "DEFERRED" && !data.contactAfter)
      fail(400, "DATE_REQUIRED", "Укажите дату следующего контакта");
    await operator(c, data.ownerId, tx);
    const value = await tx.renewalNeed.update({
      where: { id },
      data: {
        ...data,
        confirmed: data.state === "CONFIRMED" ? true : old.confirmed,
      },
    });
    await audit(tx, c, "RENEWAL_UPDATED", id, { state: value.state });
    return value;
  });
}
export async function recordRenewalContact(
  c: Context,
  id: string,
  input: unknown,
) {
  center(c, true);
  const { nextContactDate, ...data } = parse(contactSchema, input);
  return transaction(async (tx) => {
    const old = await renewal(c, id, tx);
    if (old.newRequestId)
      fail(409, "RENEWAL_HAS_ORDER", "Новая заявка уже создана");
    if (data.outcome === "DEFERRED" && !nextContactDate)
      fail(400, "DATE_REQUIRED", "Укажите дату следующего контакта");
    const value = await tx.renewalContact.create({
      data: { ...data, tenantId: c.tenantId, renewalId: id, actorId: c.userId },
    });
    await tx.renewalNeed.update({
      where: { id },
      data: {
        state: data.outcome,
        reason: data.note,
        ...(nextContactDate ? { contactAfter: nextContactDate } : {}),
        ...(data.outcome === "CONFIRMED" ? { confirmed: true } : {}),
      },
    });
    await audit(tx, c, "RENEWAL_CONTACT_RECORDED", id, {
      contactId: value.id,
      outcome: value.outcome,
    });
    return value;
  });
}
/** Whitelist reusable facts. Never carry event dates, results, numbers, confirmations or signatures. */
export function repeatDraft(
  source: Draft,
  rowId: string,
  assignmentId: string,
): Draft {
  const row = source.items.find((i) => i.id === rowId);
  const assignment = row?.assignments.find((a) => a.id === assignmentId);
  if (!row || !assignment)
    fail(404, "ASSIGNMENT_NOT_FOUND", "Историческое назначение не найдено");
  const nextAssignment = assignmentSchema.parse({
    id: randomUUID(),
    templateId: assignment.templateId,
    biotCategory: assignment.biotCategory,
    trainingSubject: assignment.trainingSubject,
  });
  const clean = {
    ...row,
    id: randomUUID(),
    importId: undefined,
    sourceRow: undefined,
    assignments: [nextAssignment],
  };
  return draftSchema.parse({
    kind: source.kind,
    title: `Повторная заявка — ${row.fullNameRu}`.slice(0, 255),
    customerId: source.customerId,
    demoMode: source.demoMode,
    items: [clean],
  });
}
export async function repeatFromRenewal(
  c: Context,
  id: string,
  input: unknown,
) {
  center(c, true);
  parse(z.object({ confirmedCurrent: z.literal(true) }).strict(), input);
  return transaction(async (tx) => {
    await tx.$executeRaw`SELECT id FROM "RenewalNeed" WHERE id=${id} AND "tenantId"=${c.tenantId} FOR UPDATE`;
    const need = await renewal(c, id, tx);
    if (need.newRequestId) return { id: need.newRequestId, reused: true };
    if (!need.confirmed || need.state !== "CONFIRMED")
      fail(
        409,
        "CURRENTNESS_REQUIRED",
        "Подтвердите актуальность сотрудника и направления перед новой заявкой",
      );
    const source = await scopedRequest(c, need.sourceRequestId, tx);
    const draft = repeatDraft(
      draftSchema.parse(source.draft),
      need.sourceRowId,
      need.assignmentId,
    );
    const record = await tx.printRequest.create({
      data: {
        tenantId: c.tenantId,
        kind: draft.kind,
        title: draft.title,
        customerId: draft.customerId,
        demoMode: draft.demoMode,
        draft: json(draft),
        itemCount: draft.items.length,
        searchText: draft.items.map((i) => i.fullNameRu).join(" "),
        createdBy: c.userId,
      },
    });
    await tx.requestItem.createMany({
      data: draft.items.map((item, position) => ({
        tenantId: c.tenantId,
        requestId: record.id,
        rowId: item.id,
        position,
        payload: json(item),
      })),
    });
    await tx.renewalNeed.update({
      where: { id },
      data: { newRequestId: record.id, state: "ORDER_AGREED" },
    });
    await audit(tx, c, "RENEWAL_REQUEST_CREATED", id, {
      requestId: record.id,
      sourceRequestId: source.id,
    });
    return { id: record.id, ...draft, revision: record.revision };
  });
}

export async function createExternalEvidence(c: Context, input: unknown) {
  center(c, true);
  const data = parse(evidenceSchema, input);
  return transaction(async (tx) => {
    await customer(c, data.customerId, tx);
    if (
      !(await tx.recipient.findFirst({
        where: { tenantId: c.tenantId, id: data.recipientId, archived: false },
      }))
    )
      fail(404, "RECIPIENT_NOT_FOUND", "Получатель не найден");
    const value = await tx.externalEvidence.create({
      data: { ...data, tenantId: c.tenantId, createdBy: c.userId },
    });
    await audit(tx, c, "EXTERNAL_EVIDENCE_RECORDED", value.id);
    return value;
  });
}
export async function listExternalEvidence(c: Context, customerId?: string) {
  center(c);
  const asOf = today(
    (await db.tenant.findUniqueOrThrow({ where: { id: c.tenantId } })).timezone,
  );
  const items = await db.externalEvidence.findMany({
    where: { tenantId: c.tenantId, ...(customerId ? { customerId } : {}) },
    orderBy: { createdAt: "desc" },
    take: 500,
  });
  const attachments = await db.valueAttachment.findMany({
    where: {
      tenantId: c.tenantId,
      evidenceId: { in: items.map((item) => item.id) },
    },
    select: { ...attachmentSelect, evidenceId: true },
  });
  return {
    items: items.map((item) => ({
      ...item,
      state: evidenceState(item, asOf),
      attachments: attachments
        .filter((attachment) => attachment.evidenceId === item.id)
        .map(({ evidenceId: _evidenceId, ...attachment }) => attachment),
    })),
    limitation:
      "Сведения об источниках документов. Матрица не является решением о допуске к работам.",
  };
}
export async function verifyExternalEvidence(
  c: Context,
  id: string,
  input: unknown,
) {
  center(c, true);
  const data = parse(evidenceVerificationSchema, input);
  return transaction(async (tx) => {
    if (
      !(await tx.externalEvidence.findFirst({
        where: { id, tenantId: c.tenantId },
      }))
    )
      fail(404, "NOT_FOUND", "Внешний документ не найден");
    const value = await tx.externalEvidence.update({
      where: { id },
      data: { ...data, verifiedBy: c.userId, verifiedAt: new Date() },
    });
    await audit(tx, c, "EXTERNAL_EVIDENCE_MANUALLY_REVIEWED", id, {
      status: value.status,
    });
    return value;
  });
}
export async function createServiceRule(c: Context, input: unknown) {
  center(c, true, true);
  const data = parse(ruleVersionSchema, input);
  return transaction(async (tx) => {
    await tx.$executeRaw`SELECT id FROM "Tenant" WHERE id=${c.tenantId} FOR UPDATE`;
    const previous = await tx.serviceRuleVersion.findFirst({
      where: { tenantId: c.tenantId, serviceKey: data.serviceKey },
      orderBy: { version: "desc" },
    });
    const value = await tx.serviceRuleVersion.create({
      data: {
        ...data,
        definition: json(data.definition),
        tenantId: c.tenantId,
        version: (previous?.version ?? 0) + 1,
        checkedBy: data.checkedOn ? c.userId : null,
        createdBy: c.userId,
      },
    });
    await audit(tx, c, "SERVICE_RULE_VERSION_CREATED", value.id, {
      version: value.version,
      status: value.status,
    });
    return value;
  });
}
export async function listServiceRules(c: Context) {
  center(c);
  return {
    items: await db.serviceRuleVersion.findMany({
      where: { tenantId: c.tenantId },
      orderBy: [{ serviceKey: "asc" }, { version: "desc" }],
      take: 500,
    }),
  };
}
export async function createDossierRecord(c: Context, input: unknown) {
  center(c, true);
  const data = parse(dossierSchema, input);
  await operator(c, data.ownerId);
  if (data.category === "QUALIFICATION" && data.customerVisible)
    fail(
      400,
      "PERSONAL_DOSSIER_PRIVATE",
      "Персональное досье квалификации не публикуется для заказчиков",
    );
  return transaction(async (tx) => {
    const value = await tx.dossierRecord.create({
      data: { ...data, tenantId: c.tenantId },
    });
    await audit(tx, c, "DOSSIER_RECORD_CREATED", value.id);
    return value;
  });
}
export async function listDossier(c: Context) {
  center(c);
  const items = await db.dossierRecord.findMany({
    where: { tenantId: c.tenantId },
    orderBy: { createdAt: "desc" },
    take: 500,
  });
  const attachments = await db.valueAttachment.findMany({
    where: {
      tenantId: c.tenantId,
      dossierId: { in: items.map((item) => item.id) },
    },
    select: { ...attachmentSelect, dossierId: true },
  });
  return {
    items: items.map((item) => ({
      ...item,
      attachments: attachments
        .filter((attachment) => attachment.dossierId === item.id)
        .map(({ dossierId: _dossierId, ...attachment }) => attachment),
    })),
    limitation:
      "Каталог подтверждающих источников центра. Загрузка файла не подтверждает государственную аккредитацию.",
  };
}

const attachmentSelect = {
  id: true,
  eventId: true,
  fileName: true,
  category: true,
  source: true,
  mimeType: true,
  sha256: true,
  size: true,
  customerVisible: true,
  createdAt: true,
} as const;
export async function addValueAttachment(c: Context, input: unknown) {
  center(c, true);
  return persistValueAttachment(c, input);
}
// Shared private-storage implementation; callers must authorize the exact owner first.
export async function persistValueAttachment(c: Context, input: unknown) {
  const { contentBase64, ...data } = parse(valueAttachmentSchema, input);
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(contentBase64))
    fail(400, "FILE_INVALID", "Некорректный файл");
  const bytes = Buffer.from(contentBase64, "base64");
  if (!bytes.length || bytes.length > 1048576)
    fail(413, "FILE_TOO_LARGE", "Размер вложения — не более 1 МБ");
  const pdf =
    bytes.subarray(0, 5).toString() === "%PDF-" &&
    bytes.subarray(-1024).includes(Buffer.from("%%EOF"));
  const png = bytes
    .subarray(0, 8)
    .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  const jpeg =
    bytes[0] === 255 &&
    bytes[1] === 216 &&
    bytes[2] === 255 &&
    bytes[bytes.length - 2] === 255 &&
    bytes[bytes.length - 1] === 217;
  if (!pdf && !png && !jpeg)
    fail(
      400,
      "FILE_TYPE_REJECTED",
      "Допустимы PDF, PNG или JPEG по содержимому",
    );
  if (
    pdf &&
    /\/(JavaScript|JS|Launch|EmbeddedFile|RichMedia|XFA|OpenAction)\b/.test(
      bytes.toString("latin1"),
    )
  )
    fail(
      400,
      "ACTIVE_PDF_REJECTED",
      "PDF с активным содержимым не принимается",
    );
  if (data.orderId) await order(c, data.orderId);
  if (data.eventId) {
    const event = await db.trainingEvent.findFirst({
      where: { tenantId: c.tenantId, id: data.eventId },
    });
    if (
      !event ||
      !(await db.serviceOrderRequest.findFirst({
        where: {
          tenantId: c.tenantId,
          orderId: data.orderId!,
          requestId: event.requestId,
        },
      }))
    )
      fail(
        404,
        "ORDER_EVENT_NOT_FOUND",
        "Событие не относится к заявкам этого заказа",
      );
  }
  if (
    data.evidenceId &&
    !(await db.externalEvidence.findFirst({
      where: { tenantId: c.tenantId, id: data.evidenceId },
    }))
  )
    fail(404, "NOT_FOUND", "Внешний документ не найден");
  if (data.dossierId) {
    const owner = await db.dossierRecord.findFirst({
      where: { tenantId: c.tenantId, id: data.dossierId },
    });
    if (!owner) fail(404, "NOT_FOUND", "Досье не найдено");
    if (data.customerVisible && !owner.customerVisible)
      fail(
        403,
        "DOSSIER_PRIVATE",
        "Внутреннее досье нельзя публиковать вложением",
      );
  }
  if (
    data.financialDocumentId &&
    !(await db.financialDocument.findFirst({
      where: { tenantId: c.tenantId, id: data.financialDocumentId },
    }))
  )
    fail(404, "NOT_FOUND", "Финансовый документ не найден");
  const extension = pdf ? "pdf" : png ? "png" : "jpg";
  const stored = await new ArtifactStore().put(bytes, extension);
  return transaction(async (tx) => {
    const value = await tx.valueAttachment.create({
      data: {
        ...data,
        fileName:
          Array.from(data.fileName, (character) =>
            character.charCodeAt(0) < 32 ? "_" : character,
          )
            .join("")
            .replace(/[<>:"/\\|?*]/g, "_")
            .replace(/\.[^.]+$/, "") +
          "." +
          extension,
        tenantId: c.tenantId,
        ...stored,
        mimeType: pdf ? "application/pdf" : png ? "image/png" : "image/jpeg",
        createdBy: c.userId,
      },
    });
    await audit(tx, c, "VALUE_ATTACHMENT_STORED", value.id, {
      category: value.category,
      sha256: value.sha256,
    });
    return {
      id: value.id,
      fileName: value.fileName,
      sha256: value.sha256,
      size: value.size,
    };
  });
}
export async function readValueAttachment(c: Context, id: string) {
  center(c);
  const value = await db.valueAttachment.findFirst({
    where: { id, tenantId: c.tenantId },
  });
  if (!value) fail(404, "NOT_FOUND", "Вложение не найдено");
  const bytes = await new ArtifactStore().read(value.storageKey, value.sha256);
  if (bytes.length !== value.size)
    fail(503, "ARTIFACT_UNAVAILABLE", "Вложение повреждено");
  await audit(db, c, "VALUE_ATTACHMENT_DOWNLOADED", id);
  return { attachment: value, bytes };
}
export async function assembleOrderDossier(c: Context, id: string) {
  center(c);
  const detail = await orderDetail(c, id);
  const requestIds = detail.requests.map((r) => r.requestId);
  const [issuances, artifacts] = await Promise.all([
    db.issuance.findMany({
      where: { tenantId: c.tenantId, requestId: { in: requestIds } },
      select: {
        id: true,
        requestId: true,
        snapshot: true,
        inputHash: true,
        createdAt: true,
      },
    }),
    db.artifact.findMany({
      where: {
        tenantId: c.tenantId,
        requestId: { in: requestIds },
        issuanceId: { not: null },
      },
      select: {
        id: true,
        requestId: true,
        issuanceId: true,
        fileName: true,
        sha256: true,
        format: true,
      },
    }),
  ]);
  await audit(db, c, "ORDER_DOSSIER_ASSEMBLED", id);
  return {
    orderId: id,
    events: detail.events,
    issuances,
    artifacts,
    attachments: detail.attachments,
    missing: [
      ...detail.nextActions.filter((a) =>
        ["EVIDENCE", "RESULTS", "DOCUMENTS"].includes(a.category),
      ),
      ...(!detail.requests.length
        ? [
            {
              id: id + "-request",
              label: "К заказу ещё не привязана заявка",
              category: "DOCUMENTS",
              ownerId: detail.ownerId,
              dueDate: detail.dueDate,
              source: "REQUEST",
            },
          ]
        : []),
    ],
    limitation:
      "Опись содержит сохранённые основания. Подписанный скан учитывается отдельно; криптографическая проверка подписи не выполнялась.",
  };
}
export async function exportOrderDossier(c: Context, id: string) {
  center(c);
  const inventory = await assembleOrderDossier(c, id);
  const links = await db.serviceOrderRequest.findMany({
    where: { tenantId: c.tenantId, orderId: id },
  });
  const [artifacts, attachments] = await Promise.all([
    db.artifact.findMany({
      where: {
        tenantId: c.tenantId,
        requestId: { in: links.map((link) => link.requestId) },
        issuanceId: { not: null },
        format: { not: "ZIP" },
      },
    }),
    db.valueAttachment.findMany({
      where: { tenantId: c.tenantId, orderId: id },
    }),
  ]);
  const store = new ArtifactStore();
  const index = await store.put(
    Buffer.from(JSON.stringify(inventory, null, 2)),
    "json",
  );
  const records = [
    ...artifacts.map((artifact) => ({
      ...artifact,
      fileName: `documents/${artifact.id}.${artifact.format.toLowerCase()}`,
    })),
    ...attachments.map((attachment) => ({
      ...attachment,
      format:
        attachment.mimeType === "application/pdf"
          ? "PDF"
          : attachment.mimeType === "image/png"
            ? "PNG"
            : "JPG",
      fileName: `evidence/${attachment.id}-${attachment.fileName}`,
    })),
    {
      id: `inventory-${id}`,
      ...index,
      format: "JSON",
      fileName: "order-dossier.json",
    },
  ];
  const missing = inventory.missing.map((item) => ({
    id: item.id,
    reason: item.label,
    category: item.category,
  }));
  const result = await buildZip(
    records,
    `ORDER-DOSSIER-${id}`,
    records.length,
    missing,
    {
      includeInventory: true,
      coverText:
        "Дело заказа: исходные оформленные документы и отдельно загруженные основания. Подписанные сканы не подменяют оригиналы и не объявляются проверенной ЭЦП. Отсутствующие обязательные основания перечислены в order-dossier.json и manifest.json.",
    },
  );
  await audit(db, c, "ORDER_DOSSIER_EXPORTED", id, {
    ready: result.metadata.readyCount,
    expected: records.length,
    complete: result.metadata.complete,
  });
  return {
    buffer: result.buffer,
    mimeType: "application/zip",
    fileName: `OT-CENTER-dossier-${id}.zip`,
  };
}

export async function listEmployerMemberships(c: Context) {
  center(c, false, true);
  return {
    items: await db.employerMembership.findMany({
      where: { tenantId: c.tenantId },
      orderBy: { createdAt: "desc" },
      take: 500,
    }),
  };
}
export async function createEmployerMembership(c: Context, input: unknown) {
  center(c, true, true);
  const data = parse(membershipSchema, input);
  return transaction(async (tx) => {
    await customer(c, data.customerId, tx);
    if (
      !(await tx.user.findFirst({
        where: {
          tenantId: c.tenantId,
          id: data.userId,
          active: true,
          role: "EMPLOYER",
        },
      }))
    )
      fail(
        400,
        "EMPLOYER_USER_REQUIRED",
        "Выберите отдельного пользователя с ролью представителя работодателя",
      );
    if (
      data.recipientIds.length &&
      (await tx.recipient.count({
        where: {
          tenantId: c.tenantId,
          id: { in: [...new Set(data.recipientIds)] },
        },
      })) !== new Set(data.recipientIds).size
    )
      fail(404, "RECIPIENT_NOT_FOUND", "Один из получателей не найден");
    const value = await tx.employerMembership.create({
      data: {
        ...data,
        permissions: json([...new Set(data.permissions)]),
        recipientIds: json([...new Set(data.recipientIds)]),
        expiresAt: data.expiresAt ? new Date(data.expiresAt) : null,
        tenantId: c.tenantId,
        createdBy: c.userId,
      },
    });
    await audit(tx, c, "EMPLOYER_MEMBERSHIP_CREATED", value.id, {
      customerId: value.customerId,
    });
    return value;
  });
}
export async function revokeEmployerMembership(c: Context, id: string) {
  center(c, true, true);
  return transaction(async (tx) => {
    const value = await tx.employerMembership.findFirst({
      where: { tenantId: c.tenantId, id },
    });
    if (!value) fail(404, "NOT_FOUND", "Доступ не найден");
    await tx.employerMembership.update({
      where: { id },
      data: { active: false },
    });
    await tx.user.updateMany({
      where: { tenantId: c.tenantId, id: value.userId },
      data: { sessionVersion: { increment: 1 } },
    });
    await tx.session.deleteMany({
      where: { tenantId: c.tenantId, userId: value.userId },
    });
    await audit(tx, c, "EMPLOYER_MEMBERSHIP_REVOKED", id);
    return { revoked: true };
  });
}
async function memberships(c: Context, permission = "READ") {
  if (c.role !== "EMPLOYER")
    fail(
      403,
      "EMPLOYER_ONLY",
      "Используйте отдельный доступ представителя работодателя",
    );
  const values = await db.employerMembership.findMany({
    where: {
      tenantId: c.tenantId,
      userId: c.userId,
      active: true,
      OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
    },
  });
  return values.filter((v) => (v.permissions as string[]).includes(permission));
}
function allowedRows(draft: Draft, allowed: string[], customerId: string) {
  return draft.items.filter(
    (i) =>
      (i.employerId || draft.customerId) === customerId &&
      (!allowed.length ||
        allowed.includes(
          (i as unknown as { recipientId?: string }).recipientId || "",
        )),
  );
}
async function artifactVisibleToMembership(
  c: Context,
  artifact: { documentId: string | null },
  draft: Draft,
  member: { customerId: string; recipientIds: Prisma.JsonValue },
) {
  const allowed = allowedRows(
    draft,
    member.recipientIds as string[],
    member.customerId,
  );
  if (!allowed.length) return false;
  if (!artifact.documentId) return allowed.length === draft.items.length;
  const document = await db.issuedDocument.findFirst({
    where: { tenantId: c.tenantId, id: artifact.documentId },
  });
  if (!document) return false;
  if (document.ownerKind === "GROUP") {
    const members = await db.groupDocumentMember.findMany({
      where: { tenantId: c.tenantId, documentId: document.id },
    });
    const permitted = member.recipientIds as string[];
    return (
      members.length > 0 &&
      members.every(
        (row) =>
          row.employerId === member.customerId &&
          (!permitted.length ||
            (row.recipientId !== null && permitted.includes(row.recipientId))),
      )
    );
  }
  return allowed.some((row) => row.id === document.rowId);
}
export async function employerPortal(c: Context) {
  const member = await memberships(c);
  const customerIds = member.map((m) => m.customerId);
  const orders = await db.serviceOrder.findMany({
    where: { tenantId: c.tenantId, customerId: { in: customerIds } },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
  const result = [];
  for (const value of orders) {
    const membership = member.find((m) => m.customerId === value.customerId)!;
    const links = await db.serviceOrderRequest.findMany({
      where: { tenantId: c.tenantId, orderId: value.id },
    });
    const requests = await db.printRequest.findMany({
      where: {
        tenantId: c.tenantId,
        id: { in: links.map((l) => l.requestId) },
      },
    });
    const visible = requests
      .map((r) => {
        const draft = draftSchema.parse(r.draft);
        const rows = allowedRows(
          draft,
          membership.recipientIds as string[],
          membership.customerId,
        );
        return {
          id: r.id,
          title: r.title,
          status: r.status,
          revision: r.revision,
          fullRosterAllowed: rows.length === draft.items.length,
          rows: rows.map((i) => ({
            id: i.id,
            fullNameRu: i.fullNameRu,
            fullNameKz: i.fullNameKz,
            positionRu: i.positionRu,
            positionKz: i.positionKz,
            assignments: i.assignments.map((a) => ({
              templateId: a.templateId,
              trainingSubject: a.trainingSubject,
              documentDate: a.documentDate,
            })),
          })),
        };
      })
      .filter((r) => r.rows.length);
    const candidates = (membership.permissions as string[]).includes("DOWNLOAD")
      ? await db.artifact.findMany({
          where: {
            tenantId: c.tenantId,
            requestId: { in: visible.map((r) => r.id) },
            issuanceId: { not: null },
          },
          select: {
            id: true,
            requestId: true,
            documentId: true,
            fileName: true,
            format: true,
            sha256: true,
          },
        })
      : [];
    const artifacts = [];
    for (const candidate of candidates) {
      const request = requests.find((r) => r.id === candidate.requestId)!;
      if (
        await artifactVisibleToMembership(
          c,
          candidate,
          draftSchema.parse(request.draft),
          membership,
        )
      ) {
        const { documentId: _documentId, ...safe } = candidate;
        artifacts.push(safe);
      }
    }
    const proposals = await db.portalProposal.findMany({
      where: {
        tenantId: c.tenantId,
        orderId: value.id,
        membershipId: membership.id,
      },
      select: {
        id: true,
        kind: true,
        message: true,
        status: true,
        resolution: true,
        createdAt: true,
      },
    });
    result.push({
      id: value.id,
      title: value.title,
      status: value.status,
      dueDate: value.dueDate,
      customerId: value.customerId,
      requests: visible,
      artifacts,
      proposals,
      permissions: membership.permissions,
    });
  }
  return {
    orders: result,
    memberships: member.map((m) => ({
      id: m.id,
      customerId: m.customerId,
      permissions: m.permissions,
    })),
    limitation:
      "Подтверждение относится к показанному составу и редакции. Результаты комиссии и выпуск утверждает учебный центр.",
  };
}
export async function employerArtifactAccess(c: Context, id: string) {
  const artifact = await db.artifact.findFirst({
    where: { tenantId: c.tenantId, id, issuanceId: { not: null } },
  });
  if (!artifact) fail(404, "NOT_FOUND", "Файл не найден");
  const request = await db.printRequest.findFirst({
    where: { tenantId: c.tenantId, id: artifact.requestId },
  });
  if (!request) fail(404, "NOT_FOUND", "Файл не найден");
  const draft = draftSchema.parse(request.draft);
  const members = (await memberships(c, "DOWNLOAD")).filter(
    (member) =>
      allowedRows(draft, member.recipientIds as string[], member.customerId)
        .length,
  );
  if (!members.length) fail(404, "NOT_FOUND", "Файл не найден");
  let permitted = false;
  for (const member of members)
    if (await artifactVisibleToMembership(c, artifact, draft, member)) {
      permitted = true;
      break;
    }
  if (!permitted)
    fail(
      403,
      "FULL_ROSTER_DENIED",
      "Файл содержит состав вне предоставленного доступа",
    );
  return artifact;
}
export async function submitEmployerProposal(
  c: Context,
  id: string,
  input: unknown,
) {
  const data = parse(proposalSchema, input);
  const value = await order(c, id);
  const member = (
    await memberships(
      c,
      data.kind === "CONFIRM_LIST" ? "APPROVE_DATA" : "PROPOSE",
    )
  ).find((m) => m.customerId === value.customerId);
  if (!member) fail(404, "NOT_FOUND", "Заказ не найден");
  return transaction(async (tx) => {
    await tx.$executeRaw`SELECT id FROM "EmployerMembership" WHERE id=${member.id} AND "tenantId"=${c.tenantId} FOR UPDATE`;
    const currentMembership = await tx.employerMembership.findFirst({
      where: {
        id: member.id,
        tenantId: c.tenantId,
        userId: c.userId,
        active: true,
        OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
      },
    });
    if (!currentMembership)
      fail(403, "MEMBERSHIP_REVOKED", "Доступ представителя отозван или истёк");
    await tx.$executeRaw`SELECT id FROM "PrintRequest" WHERE id=${data.requestId} AND "tenantId"=${c.tenantId} FOR UPDATE`;
    const request = await scopedRequest(c, data.requestId, tx);
    if (
      !(await tx.serviceOrderRequest.findFirst({
        where: { tenantId: c.tenantId, orderId: id, requestId: request.id },
      }))
    )
      fail(404, "NOT_FOUND", "Заявка не найдена");
    if (request.revision !== data.requestRevision)
      fail(
        409,
        "REVISION_CONFLICT",
        "Редакция списка изменилась. Откройте актуальную версию",
      );
    const draft = draftSchema.parse(request.draft);
    const allowed = allowedRows(
      draft,
      member.recipientIds as string[],
      member.customerId,
    ).map((row) => row.id);
    if (data.changes.some((change) => !allowed.includes(change.rowId)))
      fail(403, "ROW_DENIED", "Нет доступа к одной из строк");
    if (data.kind === "CONFIRM_LIST" && allowed.length !== draft.items.length)
      fail(
        403,
        "FULL_ROSTER_DENIED",
        "Подтверждение всего списка требует доступа ко всему составу",
      );
    const old = await tx.portalProposal.findFirst({
      where: {
        tenantId: c.tenantId,
        membershipId: member.id,
        requestId: request.id,
        requestRevision: data.requestRevision,
        kind: data.kind,
        status: "PENDING",
      },
    });
    if (
      old &&
      hash(old.changes) === hash(data.changes) &&
      old.message === data.message
    )
      return old;
    const proposal = await tx.portalProposal.create({
      data: {
        ...data,
        changes: json(data.changes),
        tenantId: c.tenantId,
        orderId: id,
        membershipId: member.id,
      },
    });
    await audit(tx, c, "EMPLOYER_PROPOSAL_SUBMITTED", id, {
      proposalId: proposal.id,
      requestId: request.id,
      revision: request.revision,
    });
    return proposal;
  });
}
export async function resolveEmployerProposal(
  c: Context,
  id: string,
  proposalId: string,
  input: unknown,
) {
  center(c, true);
  const data = parse(
    z
      .object({
        status: z.enum(["ACCEPTED", "REJECTED"]),
        resolution: z.string().trim().min(1).max(2000),
      })
      .strict(),
    input,
  );
  return transaction(async (tx) => {
    await lockOrder(c, id, tx);
    const proposal = await tx.portalProposal.findFirst({
      where: { tenantId: c.tenantId, orderId: id, id: proposalId },
    });
    if (!proposal) fail(404, "NOT_FOUND", "Предложение не найдено");
    if (proposal.status !== "PENDING")
      fail(409, "PROPOSAL_RESOLVED", "Предложение уже рассмотрено");
    await tx.$executeRaw`SELECT id FROM "PrintRequest" WHERE id=${proposal.requestId} AND "tenantId"=${c.tenantId} FOR UPDATE`;
    const request = await scopedRequest(c, proposal.requestId, tx);
    if (
      data.status === "ACCEPTED" &&
      request.revision !== proposal.requestRevision
    )
      fail(
        409,
        "REVISION_CONFLICT",
        "Предложение относится к прежней редакции; требуется повторное согласование",
      );
    if (data.status === "ACCEPTED" && proposal.kind === "UPDATE_LIST") {
      if (request.status !== "DRAFT")
        fail(
          409,
          "REGISTERED_IMMUTABLE",
          "Оформленные сведения изменяются через исправление",
        );
      const changes = proposalSchema.shape.changes.parse(proposal.changes);
      const draft = draftSchema.parse(request.draft);
      for (const change of changes) {
        const row = draft.items.find((i) => i.id === change.rowId);
        if (!row) fail(409, "ROW_CHANGED", "Состав заявки изменился");
        for (const key of [
          "fullNameRu",
          "fullNameKz",
          "positionRu",
          "positionKz",
        ] as const)
          if (change[key] !== undefined) row[key] = change[key];
        if (change.employmentStatus && change.employmentStatus !== "CURRENT")
          draft.items = draft.items.filter((i) => i.id !== change.rowId);
      }
      const validated = draftSchema.parse(draft);
      await tx.printRequest.update({
        where: { id: request.id },
        data: {
          draft: json(validated),
          itemCount: validated.items.length,
          revision: { increment: 1 },
          searchText: [
            validated.title,
            ...validated.items.flatMap((i) => [
              i.fullNameRu,
              i.fullNameKz,
              i.positionRu,
            ]),
          ].join(" "),
        },
      });
      await tx.requestItem.deleteMany({
        where: { tenantId: c.tenantId, requestId: request.id },
      });
      if (validated.items.length)
        await tx.requestItem.createMany({
          data: validated.items.map((item, position) => ({
            tenantId: c.tenantId,
            requestId: request.id,
            rowId: item.id,
            position,
            payload: json(item),
          })),
        });
    }
    let newRequestId: string | undefined;
    let newOrderId: string | undefined;
    if (data.status === "ACCEPTED" && proposal.kind === "REPEAT_REQUEST") {
      if (request.status === "DRAFT")
        fail(
          409,
          "HISTORY_REQUIRED",
          "Повторное обращение создаётся из оформленной истории; текущий черновик можно уточнить",
        );
      const membership = await tx.employerMembership.findFirst({
        where: { tenantId: c.tenantId, id: proposal.membershipId },
      });
      if (!membership)
        fail(404, "NOT_FOUND", "Исходный доступ представителя не найден");
      const source = draftSchema.parse(request.draft);
      const changes = proposalSchema.shape.changes.parse(proposal.changes);
      const selected = allowedRows(
        source,
        membership.recipientIds as string[],
        membership.customerId,
      ).filter(
        (row) =>
          !changes.some(
            (change) =>
              change.rowId === row.id &&
              change.employmentStatus &&
              change.employmentStatus !== "CURRENT",
          ),
      );
      if (!selected.length || selected.some((row) => !row.assignments.length))
        fail(
          409,
          "REPEAT_SCOPE_REQUIRED",
          "Уточните состав и согласованные направления перед созданием повторной заявки",
        );
      const items = selected.map((row) => {
        const clean = repeatDraft(source, row.id, row.assignments[0].id)
          .items[0];
        clean.assignments = row.assignments.map((assignment) =>
          assignmentSchema.parse({
            id: randomUUID(),
            templateId: assignment.templateId,
            biotCategory: assignment.biotCategory,
            trainingSubject: assignment.trainingSubject,
          }),
        );
        const change = changes.find((entry) => entry.rowId === row.id);
        if (change)
          for (const field of [
            "fullNameRu",
            "fullNameKz",
            "positionRu",
            "positionKz",
          ] as const)
            if (change[field] !== undefined) clean[field] = change[field];
        return clean;
      });
      const draft = draftSchema.parse({
        kind: "COMPANY",
        title: `Повторное обращение — ${request.title}`.slice(0, 255),
        customerId: membership.customerId,
        demoMode: request.demoMode,
        items,
      });
      const repeated = await tx.printRequest.create({
        data: {
          tenantId: c.tenantId,
          kind: draft.kind,
          title: draft.title,
          customerId: draft.customerId,
          demoMode: draft.demoMode,
          draft: json(draft),
          itemCount: items.length,
          searchText: items.map((row) => row.fullNameRu).join(" "),
          createdBy: c.userId,
        },
      });
      await tx.requestItem.createMany({
        data: items.map((item, position) => ({
          tenantId: c.tenantId,
          requestId: repeated.id,
          rowId: item.id,
          position,
          payload: json(item),
        })),
      });
      const nextOrder = await tx.serviceOrder.create({
        data: {
          tenantId: c.tenantId,
          title: draft.title,
          customerId: membership.customerId,
          ownerId: c.userId,
          createdBy: c.userId,
        },
      });
      await tx.serviceOrderRequest.create({
        data: {
          tenantId: c.tenantId,
          orderId: nextOrder.id,
          requestId: repeated.id,
        },
      });
      await tx.idempotencyOperation.create({
        data: {
          tenantId: c.tenantId,
          command: "EMPLOYER_REPEAT",
          idempotencyKey: proposal.id,
          payloadHash: hash({
            proposalId,
            sourceRequestId: request.id,
            sourceRevision: request.revision,
          }),
          result: {
            requestId: repeated.id,
            orderId: nextOrder.id,
            sourceRequestId: request.id,
            proposalId,
          },
        },
      });
      newRequestId = repeated.id;
      newOrderId = nextOrder.id;
    }
    const result = await tx.portalProposal.update({
      where: { id: proposalId },
      data: { ...data, resolvedBy: c.userId },
    });
    await audit(tx, c, "EMPLOYER_PROPOSAL_RESOLVED", id, {
      proposalId,
      status: result.status,
      ...(newRequestId ? { newRequestId, newOrderId } : {}),
    });
    return { ...result, ...(newRequestId ? { newRequestId, newOrderId } : {}) };
  });
}

export async function operatorValueSummary(c: Context) {
  center(c);
  const [orders, renewals] = await Promise.all([
    listServiceOrders(c),
    listRenewals(c),
  ]);
  return {
    orders: orders.items,
    renewals: renewals.items,
    actions: orders.items
      .filter((o) => o.status === "OPEN")
      .flatMap((o) =>
        o.nextActions.map((a) => ({
          ...a,
          orderId: o.id,
          orderTitle: o.title,
        })),
      ),
    measurements: {
      baseline: null,
      operatorStudy: "NOT_RUN",
      commercialValidation: "NOT_MEASURED",
    },
  };
}
