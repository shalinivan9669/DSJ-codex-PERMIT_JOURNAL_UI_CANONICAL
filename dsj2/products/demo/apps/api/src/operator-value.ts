import { randomUUID } from "node:crypto";
import {
  draftSchema,
  assignmentSchema,
  resolveDraft,
  validateDraft,
  profileSchema,
  TEMPLATE_LABELS,
  today,
  canManageCenter,
  selectAssignmentScope,
  approvalScopeValue,
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
  validatePdfAttachment,
  validateRasterAttachment,
} from "./pdf-attachment";
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
import {
  createProposedContainer,
  submitProposal,
  workingRequest,
} from "./approvals";

type Tx = Prisma.TransactionClient;
function center(c: Context, write = false, admin = false) {
  if (
    !["ADMIN", "DIRECTOR", "OPERATOR", "VIEWER"].includes(c.role) ||
    (write && c.role === "VIEWER") ||
    (admin && !canManageCenter(c.role))
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
        role: { in: ["ADMIN", "DIRECTOR", "OPERATOR"] },
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
function orderEmployer(value: {
  customerId: string | null;
  employerId: string | null;
}) {
  return value.employerId ?? value.customerId;
}
function orderRows(draft: Draft, employerId: string | null) {
  return draft.items.filter(
    (row) => (row.employerId || draft.customerId || null) === employerId,
  );
}
async function inferredOrderEmployer(
  c: Context,
  ids: string[],
  customerId: string | null,
  tx: Tx,
) {
  const employers = new Set<string | null>();
  for (const id of new Set(ids)) {
    const request = await workingRequest(c, id, tx);
    const draft = draftSchema.parse(request.draft);
    for (const row of draft.items)
      employers.add(row.employerId || draft.customerId || null);
  }
  if (employers.size > 1 && !employers.has(customerId))
    fail(
      409,
      "EMPLOYER_SCOPE_REQUIRED",
      "В заявках несколько работодателей. Выберите работодателя участников этого заказа.",
    );
  const only = employers.size === 1 ? [...employers][0] : null;
  return only !== customerId ? only : null;
}
async function linkRequests(
  c: Context,
  orderId: string,
  ids: string[],
  customerId: string | null,
  employerId: string | null,
  tx: Tx,
) {
  for (const requestId of new Set(ids)) {
    const request = await workingRequest(c, requestId, tx);
    const draft = draftSchema.parse(request.draft);
    const scopedRows = orderRows(draft, employerId ?? customerId);
    if (draft.customerId !== customerId && !scopedRows.length)
      fail(
        409,
        "CUSTOMER_MISMATCH",
        "В заявке нет участников выбранного заказчика",
      );
    if (draft.items.length && !scopedRows.length)
      fail(
        409,
        "EMPLOYER_SCOPE_MISMATCH",
        "В заявке нет участников выбранного работодателя. Уточните работодателя заказа или состав связанных заявок.",
        { requestId },
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
    const employerId =
      data.employerId ??
      (await inferredOrderEmployer(c, requestIds, data.customerId, tx));
    await customer(c, employerId, tx);
    await operator(c, data.ownerId, tx);
    const value = await tx.serviceOrder.create({
      data: { ...data, employerId, tenantId: c.tenantId, createdBy: c.userId },
    });
    await linkRequests(
      c,
      value.id,
      requestIds,
      value.customerId,
      value.employerId,
      tx,
    );
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
  // Internal preparation uses the manager's current proposal. The separate
  // employer portal continues reading only the approved stored request.
  const requests = await Promise.all(
    links.map((link) => workingRequest(c, link.requestId)),
  );
  const storedEvents = await db.trainingEvent.findMany({
    where: {
      tenantId: c.tenantId,
      requestId: { in: requests.map((request) => request.id) },
    },
    select: { id: true, title: true, requestId: true },
    orderBy: { createdAt: "asc" },
  });
  const eventMap = new Map(storedEvents.map((event) => [event.id, event]));
  for (const request of requests)
    if (request.status === "DRAFT")
      for (const event of draftSchema.parse(request.draft).events || [])
        eventMap.set(event.id, {
          id: event.id,
          title: event.title,
          requestId: request.id,
        });
  const events = [...eventMap.values()];
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
  const [employerRecord, payerRecord] = await Promise.all(
    [orderEmployer(value), value.payerId].map((id) =>
      id
        ? db.customerOrganization.findFirst({
            where: { tenantId: c.tenantId, id },
          })
        : null,
    ),
  );
  const people = new Set<string>();
  const scopedEvents = new Set<string>();
  const personEvents = new Set<string>();
  let legacyAssignments = 0;
  let assignmentCount = 0;
  const resultActions = new Map<
    string,
    {
      id: string;
      label: string;
      requestId: string;
      category: string;
      source: string;
      ownerId: string | null;
      dueDate: string | null;
    }
  >();
  const dataActions: typeof resultActions = new Map();
  const profiles = requests.length
    ? await db.issuerProfileVersion.findMany({
        where: { tenantId: c.tenantId },
        orderBy: { version: "desc" },
        select: { id: true, profile: true },
      })
    : [];
  const dataCodes = new Set([
    "NAME_REQUIRED",
    "DOCUMENT_REQUIRED",
    "CUSTOMER_REQUIRED",
    "DATE_INVALID",
    "SUBJECT_REQUIRED",
    "DATE_ORDER",
    "BASIS_REQUIRED",
    "ISSUER_NOT_APPROVED",
  ]);
  const fieldNames: Record<string, string> = {
    documentDate: "Дата оформления",
    trainingStart: "Начало обучения",
    trainingEnd: "Окончание обучения",
    protocolDate: "Дата протокола",
    validUntil: "Срок документа",
    trainingSubject: "Программа обучения",
    fullNameRu: "ФИО",
    externalBasisNumber: "Внешнее основание",
  };
  for (const request of requests) {
    const saved = draftSchema.parse(request.draft);
    const profileRecord = saved.profileVersionId
      ? profiles.find((profile) => profile.id === saved.profileVersionId)
      : profiles[0];
    const parsedProfile = profileSchema.safeParse(profileRecord?.profile);
    const profile = parsedProfile.success ? parsedProfile.data : null;
    const draft = resolveDraft(saved, profile?.commonFields).draft;
    const scopedRows = orderRows(draft, orderEmployer(value));
    if (draft.items.length && !scopedRows.length)
      dataActions.set(`scope:${request.id}`, {
        id: `scope:${request.id}`,
        label:
          "Выберите работодателя участников заказа: в связанной заявке нет участников текущего работодателя.",
        requestId: request.id,
        category: "DATA",
        source: "PARTICIPANT_SCOPE",
        ownerId: value.ownerId,
        dueDate: value.dueDate,
      });
    if (request.status === "DRAFT") {
      // Use the same resolver/validator as issuance. Validate the customer's
      // projected rows so another employer's missing fields never surface here.
      for (const issue of validateDraft(
        { ...draft, items: scopedRows },
        profile,
      )) {
        if (!dataCodes.has(issue.code)) continue;
        const row = scopedRows.find((item) => item.id === issue.rowId);
        const field = fieldNames[issue.path.split(".").at(-1) || ""];
        const assignmentIndex = Number(
          issue.path.match(/\.assignments\.(\d+)\./)?.[1],
        );
        const assignment = row?.assignments[assignmentIndex];
        const event = draft.events?.find(
          (entry) => entry.id === assignment?.eventId,
        );
        const key = `${request.id}:${row?.id || "request"}:${event?.id || assignment?.id || "row"}:${issue.path.split(".").at(-1)}:${issue.code}`;
        dataActions.set(key, {
          id: `data:${key}`,
          label: `Уточнить данные${row ? `: ${row.fullNameRu || "Получатель без ФИО"}` : ""}${event ? ` (${event.title})` : ""}${field ? ` — ${field}` : ""}. ${issue.message}`,
          requestId: request.id,
          category: "DATA",
          source: "DATA_REVIEW",
          ownerId: value.ownerId,
          dueDate: value.dueDate,
        });
      }
    }
    for (const row of scopedRows) {
      // Identity is explicit. A coincident name never merges two people.
      const personKey = row.recipientId || `${request.id}:${row.id}`;
      people.add(personKey);
      for (const assignment of row.assignments) {
        assignmentCount++;
        const event = draft.events?.find(
          (entry) => entry.id === assignment.eventId,
        );
        const serviceKey = event
          ? `${personKey}:${event.id}`
          : `${request.id}:${row.id}:${assignment.id}`;
        if (event) {
          scopedEvents.add(event.id);
          personEvents.add(serviceKey);
        } else legacyAssignments++;
        const unknown = assignment.outcome
          ? assignment.outcome.status === "UNKNOWN"
          : !assignment.result.trim();
        const unsupported =
          assignment.outcome &&
          assignment.outcome.status !== "UNKNOWN" &&
          !assignment.outcome.source.trim();
        if (unknown || unsupported)
          resultActions.set(serviceKey, {
            id: `result:${serviceKey}`,
            label: `${unknown ? "Получить фактический результат" : "Подтвердить источник результата"}: ${row.fullNameRu} — ${event?.title || assignment.trainingSubject || assignment.templateId}`,
            requestId: request.id,
            category: "RESULTS",
            source: "RESULT_REVIEW",
            ownerId: value.ownerId,
            dueDate: value.dueDate,
          });
      }
    }
  }
  return {
    ...value,
    customer: customerRecord,
    employer: employerRecord,
    payer: payerRecord,
    events: events.filter((event) => scopedEvents.has(event.id)),
    summary: {
      people: people.size,
      events: scopedEvents.size,
      personEventServices: personEvents.size,
      legacyAssignments,
    },
    requests: requests.map((r) => ({
      requestId: r.id,
      id: r.id,
      title: draftSchema.parse(r.draft).title || r.title,
      status: r.status,
      revision: r.revision,
      itemCount: orderRows(draftSchema.parse(r.draft), orderEmployer(value))
        .length,
    })),
    milestones,
    proposals,
    financialDocuments,
    attachments,
    nextActions: [
      ...resultActions.values(),
      ...dataActions.values(),
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
      training:
        assignmentCount > 0 &&
        resultActions.size === 0 &&
        byCategory("RESULTS"),
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
    const nextEmployerId =
      data.employerId === undefined ? old.employerId : data.employerId;
    const scopeChanged =
      (nextEmployerId ?? old.customerId) !== orderEmployer(old);
    const partiesChanged =
      scopeChanged ||
      (data.payerId !== undefined && data.payerId !== old.payerId);
    if (
      old.status !== "OPEN" &&
      partiesChanged &&
      (data.status !== "OPEN" || !reason?.trim())
    )
      fail(
        409,
        "ORDER_REOPEN_REQUIRED",
        "Откройте заказ с причиной изменения перед сменой работодателя или плательщика",
      );
    await customer(c, data.employerId, tx);
    await customer(c, data.payerId, tx);
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
    if (requestIds || scopeChanged) {
      const existing = scopeChanged
        ? await tx.serviceOrderRequest.findMany({
            where: { tenantId: c.tenantId, orderId: id },
          })
        : [];
      // Existing obligations/evidence are retained. Newly applicable rule
      // requirements are added through the same idempotent materialization.
      await linkRequests(
        c,
        id,
        [
          ...new Set([
            ...existing.map((link) => link.requestId),
            ...(requestIds || []),
          ]),
        ],
        old.customerId,
        nextEmployerId,
        tx,
      );
    }
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
      ...(partiesChanged
        ? {
            previousEmployerId: orderEmployer(old),
            employerId: orderEmployer(value),
            previousPayerId: old.payerId,
            payerId: value.payerId,
          }
        : {}),
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
        (old.source === "CONTRACT" && !canManageCenter(c.role)))
    )
      fail(
        403,
        "WAIVER_DENIED",
        "Нормативное обязательство не снимается; договорное изменяет директор",
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
    const value = await tx.financialDocument
      .create({
        data: {
          ...data,
          tenantId: c.tenantId,
          orderId: id,
          createdBy: c.userId,
        },
      })
      .catch((error: unknown) => {
        if (
          typeof error === "object" &&
          error !== null &&
          "code" in error &&
          error.code === "P2002"
        )
          fail(
            409,
            "FINANCIAL_DOCUMENT_EXISTS",
            "Документ такого вида с этим номером уже сохранён. Проверьте номер и существующий документ.",
          );
        throw error;
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
  const customers = await db.customerOrganization.findMany({
    where: {
      tenantId: c.tenantId,
      id: {
        in: [
          ...new Set(
            values.flatMap((value) =>
              value.customerId ? [value.customerId] : [],
            ),
          ),
        ],
      },
    },
    select: { id: true, nameRu: true },
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
        customer:
          customers.find((customer) => customer.id === v.customerId) || null,
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
    const record = await createProposedContainer(tx, c, draft);
    await tx.renewalNeed.update({
      where: { id },
      data: { newRequestId: record.id, state: "ORDER_AGREED" },
    });
    await audit(tx, c, "RENEWAL_REQUEST_CREATED", id, {
      requestId: record.id,
      sourceRequestId: source.id,
    });
    return record;
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
  const verifiers = await db.user.findMany({
    where: {
      tenantId: c.tenantId,
      id: {
        in: [
          ...new Set(
            items.flatMap((item) => (item.verifiedBy ? [item.verifiedBy] : [])),
          ),
        ],
      },
    },
    select: { id: true, displayName: true },
  });
  return {
    items: items.map((item) => ({
      ...item,
      state: evidenceState(item, asOf),
      verifiedByName:
        verifiers.find((user) => user.id === item.verifiedBy)?.displayName ||
        null,
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
  const items = await db.serviceRuleVersion.findMany({
    where: { tenantId: c.tenantId },
    orderBy: [{ serviceKey: "asc" }, { version: "desc" }],
    take: 500,
  });
  const reviewers = await db.user.findMany({
    where: {
      tenantId: c.tenantId,
      id: {
        in: [
          ...new Set(
            items.flatMap((item) => (item.checkedBy ? [item.checkedBy] : [])),
          ),
        ],
      },
    },
    select: { id: true, displayName: true },
  });
  return {
    items: items.map((item) => ({
      ...item,
      checkedByName:
        reviewers.find((user) => user.id === item.checkedBy)?.displayName ||
        null,
    })),
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
  const owners = await db.user.findMany({
    where: {
      tenantId: c.tenantId,
      id: { in: [...new Set(items.map((item) => item.ownerId))] },
    },
    select: { id: true, displayName: true },
  });
  return {
    items: items.map((item) => ({
      ...item,
      ownerName:
        owners.find((user) => user.id === item.ownerId)?.displayName || null,
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
  if (pdf) await validatePdfAttachment(bytes);
  else await validateRasterAttachment(bytes);
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
/** External readers see approved scope and immutable issued history only. */
function mergedPortalScope(drafts: Draft[]) {
  const latest = drafts[drafts.length - 1];
  if (!latest) return undefined;
  const rows = new Map<string, Draft["items"][number]>();
  const events = new Map<string, NonNullable<Draft["events"]>[number]>();
  for (const draft of drafts) {
    for (const event of draft.events || []) events.set(event.id, event);
    for (const row of draft.items) {
      const assignments = new Map(
        rows.get(row.id)?.assignments.map((entry) => [entry.id, entry]) || [],
      );
      for (const assignment of row.assignments)
        assignments.set(assignment.id, assignment);
      rows.set(row.id, { ...row, assignments: [...assignments.values()] });
    }
  }
  return { ...latest, items: [...rows.values()], events: [...events.values()] };
}
function portalScopeHash(draft: Draft) {
  return hash(
    approvalScopeValue(
      draft,
      draft.items.flatMap((row) =>
        row.assignments.map((assignment) => ({
          rowId: row.id,
          assignmentId: assignment.id,
        })),
      ),
    ),
  );
}
async function recoverLegacyPortalProposalSource(
  c: Context,
  proposal: {
    id: string;
    requestId: string;
    requestRevision: number;
    createdAt: Date;
  },
  workingDraft: Draft,
  tx: Tx,
) {
  const candidates = await tx.requestProposal.findMany({
    where: {
      tenantId: c.tenantId,
      requestId: proposal.requestId,
      operation: "SAVE",
      status: { in: ["APPROVED", "SUPERSEDED"] },
      submittedAt: { lte: proposal.createdAt },
      revision: { lte: proposal.requestRevision },
    },
    orderBy: { revision: "asc" },
  });
  const [decisions, oldAudits, issuances] = await Promise.all([
    tx.proposalDecision.findMany({
      where: {
        tenantId: c.tenantId,
        proposalId: { in: candidates.map((candidate) => candidate.id) },
        decision: "APPROVE",
        createdAt: { lte: proposal.createdAt },
      },
    }),
    tx.auditEvent.findMany({
      where: {
        tenantId: c.tenantId,
        entityId: proposal.requestId,
        action: "CHANGE_APPROVED",
        createdAt: { lte: proposal.createdAt },
      },
      select: { metadata: true },
    }),
    tx.issuance.findMany({
      where: {
        tenantId: c.tenantId,
        requestId: proposal.requestId,
        createdAt: { lte: proposal.createdAt },
        sourceRevision: { lte: proposal.requestRevision },
      },
      orderBy: { createdAt: "asc" },
      select: { id: true, snapshot: true, scopeHash: true },
    }),
  ]);
  const approved: {
    id: string;
    draft: Draft;
    scopeHash: string | null;
  }[] = [];
  for (const candidate of candidates) {
    const decided = decisions.some(
      (decision) =>
        decision.proposalId === candidate.id &&
        decision.proposalHash === candidate.proposalHash,
    );
    const audited = oldAudits.some(
      (event) =>
        z
          .object({
            proposalId: z.literal(candidate.id),
            proposalHash: z.literal(candidate.proposalHash),
            operation: z.literal("SAVE"),
          })
          .safeParse(event.metadata).success,
    );
    if (!decided && !audited) continue;
    const parsed = draftSchema.safeParse(candidate.payload);
    if (!parsed.success) continue;
    try {
      const draft = candidate.scopeHash
        ? selectAssignmentScope(
            parsed.data,
            z
              .array(
                z
                  .object({ rowId: z.string(), assignmentId: z.string() })
                  .strict(),
              )
              .min(1)
              .parse(candidate.assignments),
          ).draft
        : parsed.data;
      if (candidate.scopeHash && portalScopeHash(draft) !== candidate.scopeHash)
        continue;
      approved.push({
        id: candidate.id,
        draft,
        scopeHash: candidate.scopeHash,
      });
    } catch {
      /* Malformed historical scope cannot recover an old command. */
    }
  }
  const issued: { id: string; draft: Draft }[] = [];
  for (const issuance of issuances) {
    const frozen = z
      .object({ draft: draftSchema })
      .safeParse(issuance.snapshot);
    if (!frozen.success) continue;
    const identities = frozen.data.draft.items.flatMap((row) =>
      row.assignments.map((assignment) => ({
        rowId: row.id,
        assignmentId: assignment.id,
      })),
    );
    let source = frozen.data.draft;
    if (issuance.scopeHash) {
      const raw = approved.find((candidate) => {
        if (candidate.scopeHash !== issuance.scopeHash) return false;
        try {
          return (
            hash(approvalScopeValue(candidate.draft, identities)) ===
            issuance.scopeHash
          );
        } catch {
          return false;
        }
      });
      if (raw) source = selectAssignmentScope(raw.draft, identities).draft;
      else if (portalScopeHash(source) !== issuance.scopeHash) continue;
    }
    issued.push({ id: issuance.id, draft: source });
  }
  const latest = approved[approved.length - 1];
  const publishedDraft = mergedPortalScope([
    ...issued.map((entry) => entry.draft),
    ...(latest ? [latest.draft] : []),
  ]);
  if (!publishedDraft) return undefined;
  const identities = publishedDraft.items.flatMap((row) =>
    row.assignments.map((assignment) => ({
      rowId: row.id,
      assignmentId: assignment.id,
    })),
  );
  try {
    if (
      hash(approvalScopeValue(workingDraft, identities)) !==
      portalScopeHash(publishedDraft)
    )
      return undefined;
  } catch {
    return undefined;
  }
  return {
    publishedDraft,
    repeatDraft: mergedPortalScope(issued.map((entry) => entry.draft)),
    approvalId: latest?.id,
    issuanceIds: issued.map((entry) => entry.id),
  };
}
export async function publishedPortalRequest(
  c: Context,
  request: {
    id: string;
    title: string;
    status: string;
    revision: number;
    approvedProposalId: string | null;
    draft: Prisma.JsonValue;
  },
  tx: Tx = db,
) {
  const [approved, issuances] = await Promise.all([
    request.approvedProposalId
      ? tx.requestProposal.findFirst({
          where: {
            tenantId: c.tenantId,
            requestId: request.id,
            id: request.approvedProposalId,
            status: "APPROVED",
            operation: "SAVE",
          },
        })
      : null,
    tx.issuance.findMany({
      where: { tenantId: c.tenantId, requestId: request.id },
      orderBy: { createdAt: "asc" },
      select: { snapshot: true, sourceRevision: true, scopeHash: true },
    }),
  ]);
  // Issuance snapshots are resolved for printing. Recover the corresponding
  // raw agreed values by their immutable scope hash when proving a later edit.
  const hashes = issuances.flatMap((issuance) =>
    issuance.scopeHash ? [issuance.scopeHash] : [],
  );
  const agreedSources = hashes.length
    ? await tx.requestProposal.findMany({
        where: {
          tenantId: c.tenantId,
          requestId: request.id,
          operation: "SAVE",
          scopeHash: { in: hashes },
        },
        select: { payload: true, scopeHash: true },
      })
    : [];
  const published: {
    draft: Draft;
    proofDraft: Draft;
    revision: number;
    issued?: boolean;
  }[] = [];
  for (const issuance of issuances) {
    const frozen = z
      .object({ draft: draftSchema })
      .safeParse(issuance.snapshot);
    if (frozen.success) {
      const identities = frozen.data.draft.items.flatMap((row) =>
        row.assignments.map((assignment) => ({
          rowId: row.id,
          assignmentId: assignment.id,
        })),
      );
      let proofDraft = frozen.data.draft;
      for (const source of agreedSources) {
        if (source.scopeHash !== issuance.scopeHash) continue;
        const parsed = draftSchema.safeParse(source.payload);
        if (!parsed.success) continue;
        try {
          if (
            hash(approvalScopeValue(parsed.data, identities)) ===
            issuance.scopeHash
          ) {
            proofDraft = selectAssignmentScope(parsed.data, identities).draft;
            break;
          }
        } catch {
          /* A mismatched historical source cannot prove the published scope. */
        }
      }
      published.push({
        draft: frozen.data.draft,
        proofDraft,
        revision: issuance.sourceRevision,
        issued: true,
      });
    }
  }
  if (approved) {
    const parsed = draftSchema.safeParse(approved.payload);
    if (parsed.success) {
      const identities = z
        .array(
          z.object({ rowId: z.string(), assignmentId: z.string() }).strict(),
        )
        .safeParse(approved.assignments);
      if (identities.success) {
        try {
          published.push({
            draft: selectAssignmentScope(parsed.data, identities.data).draft,
            proofDraft: selectAssignmentScope(parsed.data, identities.data)
              .draft,
            revision: approved.revision,
          });
        } catch {
          /* A malformed saved scope must not expose the full payload. */
        }
      } else if (!approved.scopeHash) {
        // Earlier approvals covered the complete saved request.
        published.push({
          draft: parsed.data,
          proofDraft: parsed.data,
          revision: approved.revision,
        });
      }
    }
  }
  if (!published.length && request.status === "FINALIZED") {
    const historic = draftSchema.safeParse(request.draft);
    if (historic.success)
      published.push({
        draft: historic.data,
        proofDraft: historic.data,
        revision: request.revision,
        issued: true,
      });
  }
  if (!published.length) return null;
  const rows = new Map<string, Draft["items"][number]>();
  const events = new Map<string, NonNullable<Draft["events"]>[number]>();
  for (const entry of published)
    for (const event of entry.draft.events || []) events.set(event.id, event);
  for (const entry of published)
    for (const row of entry.draft.items) {
      const assignments = new Map(
        rows
          .get(row.id)
          ?.assignments.map((assignment) => [assignment.id, assignment]) || [],
      );
      for (const assignment of row.assignments)
        assignments.set(assignment.id, assignment);
      rows.set(row.id, { ...row, assignments: [...assignments.values()] });
    }
  const latest = published[published.length - 1];
  const proofRows = new Map<string, Draft["items"][number]>();
  const proofEvents = new Map<string, NonNullable<Draft["events"]>[number]>();
  for (const entry of published) {
    for (const event of entry.proofDraft.events || [])
      proofEvents.set(event.id, event);
    for (const row of entry.proofDraft.items) {
      const assignments = new Map(
        proofRows
          .get(row.id)
          ?.assignments.map((assignment) => [assignment.id, assignment]) || [],
      );
      for (const assignment of row.assignments)
        assignments.set(assignment.id, assignment);
      proofRows.set(row.id, { ...row, assignments: [...assignments.values()] });
    }
  }
  return {
    ...request,
    title: latest.draft.title || "",
    revision: latest.revision,
    draft: {
      ...latest.draft,
      items: [...rows.values()],
      events: [...events.values()],
    },
    // Internal only: employerPortal projects an explicit response whitelist.
    scopeProofDraft: {
      ...latest.proofDraft,
      items: [...proofRows.values()],
      events: [...proofEvents.values()],
    },
    issuedSourceDraft: mergedPortalScope(
      published
        .filter((entry) => entry.issued)
        .map((entry) => entry.proofDraft),
    ),
  };
}
async function portalArtifactDraft(
  c: Context,
  artifact: { requestId: string; issuanceId: string | null },
) {
  if (!artifact.issuanceId) return null;
  const issuance = await db.issuance.findFirst({
    where: {
      tenantId: c.tenantId,
      requestId: artifact.requestId,
      id: artifact.issuanceId,
    },
    select: { snapshot: true },
  });
  const parsed = z.object({ draft: draftSchema }).safeParse(issuance?.snapshot);
  return parsed.success ? parsed.data.draft : null;
}
export async function employerPortal(c: Context) {
  const member = await memberships(c);
  const customerIds = member.map((m) => m.customerId);
  const orders = await db.serviceOrder.findMany({
    where: {
      tenantId: c.tenantId,
      OR: [
        { employerId: { in: customerIds } },
        { employerId: null, customerId: { in: customerIds } },
      ],
    },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
  const result = [];
  for (const value of orders) {
    const membership = member.find(
      (m) => m.customerId === orderEmployer(value),
    )!;
    const links = await db.serviceOrderRequest.findMany({
      where: { tenantId: c.tenantId, orderId: value.id },
    });
    const storedRequests = await db.printRequest.findMany({
      where: {
        tenantId: c.tenantId,
        id: { in: links.map((l) => l.requestId) },
      },
    });
    const requests = (
      await Promise.all(
        storedRequests.map((request) => publishedPortalRequest(c, request)),
      )
    ).filter((request) => request !== null);
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
            issuanceId: true,
            fileName: true,
            format: true,
            sha256: true,
          },
        })
      : [];
    const artifacts = [];
    for (const candidate of candidates) {
      const frozen = await portalArtifactDraft(c, candidate);
      if (
        frozen &&
        (await artifactVisibleToMembership(c, candidate, frozen, membership))
      ) {
        const {
          documentId: _documentId,
          issuanceId: _issuanceId,
          ...safe
        } = candidate;
        artifacts.push({
          ...safe,
          label: await portalArtifactLabel(c, candidate),
        });
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
      employerId: orderEmployer(value),
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
// Called only after the existing artifact authorization succeeds. Names come
// from this immutable issuance, never from the current recipient directory.
async function portalArtifactLabel(
  c: Context,
  artifact: { documentId: string | null; format: string },
): Promise<string | undefined> {
  if (!artifact.documentId) return undefined;
  const document = await db.issuedDocument.findFirst({
    where: { tenantId: c.tenantId, id: artifact.documentId },
    select: {
      rowId: true,
      ownerKind: true,
      templateId: true,
      number: true,
      issuanceId: true,
      requestId: true,
    },
  });
  if (!document) return undefined;
  const template =
    TEMPLATE_LABELS[document.templateId as keyof typeof TEMPLATE_LABELS] ||
    "Документ";
  const title =
    document.ownerKind === "GROUP"
      ? template.replace("индивидуальный протокол", "общий протокол события")
      : template;
  let name: string | undefined;
  if (document.ownerKind !== "GROUP" && document.rowId) {
    const issuance = await db.issuance.findFirst({
      where: {
        tenantId: c.tenantId,
        id: document.issuanceId,
        requestId: document.requestId,
      },
      select: { snapshot: true },
    });
    const frozen = z
      .object({ draft: draftSchema })
      .safeParse(issuance?.snapshot);
    if (frozen.success)
      name = frozen.data.draft.items.find(
        (row) => row.id === document.rowId,
      )?.fullNameRu;
  }
  return [title, name?.trim(), `№ ${document.number}`, artifact.format]
    .filter(Boolean)
    .join(" · ");
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
  const draft = await portalArtifactDraft(c, artifact);
  if (!draft) fail(404, "NOT_FOUND", "Файл не найден");
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
  ).find((m) => m.customerId === orderEmployer(value));
  if (!member) fail(404, "NOT_FOUND", "Заказ не найден");
  return transaction(async (tx) => {
    const currentOrder = await lockOrder(c, id, tx);
    if (orderEmployer(currentOrder) !== member.customerId)
      fail(
        409,
        "ORDER_SCOPE_CHANGED",
        "Работодатель участников заказа изменён. Откройте актуальный заказ.",
      );
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
    const published = await publishedPortalRequest(c, request, tx);
    if (!published) fail(404, "NOT_FOUND", "Согласованный состав не найден");
    if (published.revision !== data.requestRevision)
      fail(
        409,
        "REVISION_CONFLICT",
        "Согласованный состав изменился. Откройте актуальную версию",
      );
    const identities = published.draft.items.flatMap((row) =>
      row.assignments.map((assignment) => ({
        rowId: row.id,
        assignmentId: assignment.id,
      })),
    );
    let unchanged = false;
    try {
      unchanged =
        hash(
          approvalScopeValue(draftSchema.parse(request.draft), identities),
        ) === hash(approvalScopeValue(published.scopeProofDraft, identities));
    } catch {
      /* Removed or changed selected data must require a fresh agreed scope. */
    }
    if (!unchanged)
      fail(
        409,
        "REVISION_CONFLICT",
        "Предоставленный состав изменён в рабочей редакции; требуется повторное согласование",
      );
    const draft = published.draft;
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
        requestRevision: request.revision,
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
        // The caller pins the visible publication; acceptance retains the
        // current working CAS so intervening private edits still conflict.
        requestRevision: request.revision,
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
      publishedRevision: published.revision,
      publishedDraft: published.scopeProofDraft,
      publishedScopeHash: portalScopeHash(published.scopeProofDraft),
      ...(published.issuedSourceDraft
        ? {
            repeatDraft: published.issuedSourceDraft,
            repeatScopeHash: portalScopeHash(published.issuedSourceDraft),
          }
        : {}),
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
    const currentOrder = await lockOrder(c, id, tx);
    const proposal = await tx.portalProposal.findFirst({
      where: { tenantId: c.tenantId, orderId: id, id: proposalId },
    });
    if (!proposal) fail(404, "NOT_FOUND", "Предложение не найдено");
    if (proposal.status !== "PENDING")
      fail(409, "PROPOSAL_RESOLVED", "Предложение уже рассмотрено");
    await tx.$executeRaw`SELECT id FROM "PrintRequest" WHERE id=${proposal.requestId} AND "tenantId"=${c.tenantId} FOR UPDATE`;
    const request = await workingRequest(c, proposal.requestId, tx);
    if (
      data.status === "ACCEPTED" &&
      request.revision !== proposal.requestRevision
    )
      fail(
        409,
        "REVISION_CONFLICT",
        "Предложение относится к прежней редакции; требуется повторное согласование",
      );
    const submitted = await tx.auditEvent.findFirst({
      where: {
        tenantId: c.tenantId,
        action: "EMPLOYER_PROPOSAL_SUBMITTED",
        entityId: id,
        metadata: { path: ["proposalId"], equals: proposal.id },
      },
      orderBy: { createdAt: "asc" },
    });
    const savedSource = z
      .object({
        proposalId: z.literal(proposal.id),
        requestId: z.literal(proposal.requestId),
        revision: z.literal(proposal.requestRevision),
        publishedDraft: draftSchema,
        publishedScopeHash: z.string(),
        repeatDraft: draftSchema.optional(),
        repeatScopeHash: z.string().optional(),
      })
      .safeParse(submitted?.metadata);
    let proposalSource: Draft | undefined;
    let repeatSource: Draft | undefined;
    if (savedSource.success) {
      if (
        portalScopeHash(savedSource.data.publishedDraft) ===
        savedSource.data.publishedScopeHash
      )
        proposalSource = savedSource.data.publishedDraft;
      if (
        savedSource.data.repeatDraft &&
        portalScopeHash(savedSource.data.repeatDraft) ===
          savedSource.data.repeatScopeHash
      )
        repeatSource = savedSource.data.repeatDraft;
    }
    let recoveredSource:
      | Awaited<ReturnType<typeof recoverLegacyPortalProposalSource>>
      | undefined;
    // Older pending proposals stored only their revision. Recover from sources
    // that were already published when they were sent, never from today's
    // approval status or a later private working payload.
    const legacySubmission =
      !submitted ||
      z
        .object({ publishedDraft: z.never().optional() })
        .safeParse(submitted.metadata).success;
    if (data.status === "ACCEPTED" && !proposalSource && legacySubmission) {
      recoveredSource = await recoverLegacyPortalProposalSource(
        c,
        proposal,
        draftSchema.parse(request.draft),
        tx,
      );
      proposalSource = recoveredSource?.publishedDraft;
      repeatSource = recoveredSource?.repeatDraft;
    }
    if (data.status === "ACCEPTED" && !proposalSource)
      fail(
        409,
        "PROPOSAL_SOURCE_REQUIRED",
        "Исходный согласованный состав не подтверждён. Отклоните это предложение; затем представитель откроет актуальный состав и отправит новое. Повторная отправка без отклонения может вернуть то же ожидающее предложение.",
      );
    if (data.status === "ACCEPTED") {
      await tx.$executeRaw`SELECT id FROM "EmployerMembership" WHERE id=${proposal.membershipId} AND "tenantId"=${c.tenantId} FOR UPDATE`;
      const membership = await tx.employerMembership.findFirst({
        where: {
          tenantId: c.tenantId,
          id: proposal.membershipId,
          active: true,
          OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
        },
      });
      if (
        !membership ||
        membership.customerId !== orderEmployer(currentOrder) ||
        !(membership.permissions as string[]).includes(
          proposal.kind === "CONFIRM_LIST" ? "APPROVE_DATA" : "PROPOSE",
        )
      )
        fail(
          409,
          "PROPOSAL_SCOPE_CHANGED",
          "Предложение относится к прежнему работодателю участников; требуется повторное согласование.",
        );
      const draft = proposalSource!;
      const permitted = allowedRows(
        draft,
        membership.recipientIds as string[],
        membership.customerId,
      );
      const changes = proposalSchema.shape.changes.parse(proposal.changes);
      if (
        !permitted.length ||
        changes.some(
          (change) => !permitted.some((row) => row.id === change.rowId),
        )
      )
        fail(
          409,
          "PROPOSAL_SCOPE_CHANGED",
          "Состав предоставленного доступа изменён; требуется повторное согласование.",
        );
      if (
        proposal.kind === "CONFIRM_LIST" &&
        permitted.length !== draft.items.length
      )
        fail(
          403,
          "FULL_ROSTER_DENIED",
          "Подтверждение всего списка требует доступа ко всему составу",
        );
      if (recoveredSource)
        await audit(tx, c, "EMPLOYER_PROPOSAL_SOURCE_RECOVERED", id, {
          proposalId: proposal.id,
          requestId: request.id,
          revision: proposal.requestRevision,
          sourceExistedAt: proposal.createdAt.toISOString(),
          approvalId: recoveredSource.approvalId,
          issuanceIds: recoveredSource.issuanceIds,
          publishedScopeHash: portalScopeHash(draft),
          ...(repeatSource
            ? { repeatScopeHash: portalScopeHash(repeatSource) }
            : {}),
        });
    }
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
      await submitProposal(tx, c, request.id, validated, request.revision);
    }
    let newRequestId: string | undefined;
    let newOrderId: string | undefined;
    if (data.status === "ACCEPTED" && proposal.kind === "REPEAT_REQUEST") {
      if (!repeatSource)
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
      const source = repeatSource;
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
      const repeated = await createProposedContainer(tx, c, draft);
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
