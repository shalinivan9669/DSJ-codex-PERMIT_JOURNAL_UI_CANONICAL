import {
  draftSchema,
  applyBusinessRules,
  isDirectorRole,
  z,
  type Draft,
} from "@demo/contracts";
import type { Prisma } from "@demo/database";
import { personCustomerName, withCustomerIdentity } from "./request-customer";
import {
  audit,
  db,
  fail,
  hash,
  json,
  parse,
  scopedRequest,
  transaction,
  type Context,
} from "./core";

export type Change = { path: string; before: unknown; after: unknown };
export function proposalDiff(
  before: unknown,
  after: unknown,
  path = "",
): Change[] {
  if (hash(before ?? null) === hash(after ?? null)) return [];
  if (
    before &&
    after &&
    typeof before === "object" &&
    typeof after === "object" &&
    !Array.isArray(before) &&
    !Array.isArray(after)
  ) {
    const a = before as Record<string, unknown>,
      b = after as Record<string, unknown>;
    return [...new Set([...Object.keys(a), ...Object.keys(b)])]
      .sort()
      .flatMap((key) =>
        proposalDiff(a[key], b[key], path ? `${path}.${key}` : key),
      );
  }
  if (Array.isArray(before) && Array.isArray(after)) {
    return Array.from(
      { length: Math.max(before.length, after.length) },
      (_, index) =>
        proposalDiff(before[index], after[index], `${path}[${index}]`),
    ).flat();
  }
  return [{ path: path || "$", before: before ?? null, after: after ?? null }];
}
export function assertStaff(c: Context, write = false) {
  if (
    !["ADMIN", "DIRECTOR", "OPERATOR", "VIEWER"].includes(c.role) ||
    (write && c.role === "VIEWER")
  )
    fail(403, "ROLE_DENIED", "Недостаточно прав сотрудника центра");
}
export function assertDirector(c: Context) {
  if (!isDirectorRole(c.role))
    fail(
      403,
      "DIRECTOR_REQUIRED",
      "Решение по заявке принимает только директор",
    );
}
export async function workingRequest(
  c: Context,
  id: string,
  tx: Prisma.TransactionClient = db,
) {
  const record = await scopedRequest(c, id, tx);
  const proposal = await tx.requestProposal.findFirst({
    where: { tenantId: c.tenantId, requestId: id },
    orderBy: { revision: "desc" },
  });
  const working =
    proposal?.operation === "SAVE" &&
    ["PENDING", "REJECTED"].includes(proposal.status) &&
    record.status === "DRAFT";
  return {
    ...record,
    ...(working ? { draft: proposal.payload } : {}),
    ...(proposal && ["PENDING", "REJECTED"].includes(proposal.status)
      ? { revision: proposal.revision }
      : {}),
    approvedDraft: record.draft,
    approvedRevision: record.revision,
    archived: !!record.archivedAt,
    approval: proposal
      ? {
          proposalId: proposal.id,
          status: proposal.status,
          baseRevision: proposal.baseRevision,
          proposalHash: proposal.proposalHash,
          submittedBy: proposal.submittedBy,
          submittedAt: proposal.submittedAt,
        }
      : null,
  };
}
export async function submitProposal(
  tx: Prisma.TransactionClient,
  c: Context,
  id: string,
  input: Draft,
  expectedRevision: number,
  operation: "SAVE" | "CANCEL" | "ARCHIVE" = "SAVE",
  reason = "",
) {
  assertStaff(c, true);
  await tx.$executeRaw`SELECT id FROM "PrintRequest" WHERE id=${id} AND "tenantId"=${c.tenantId} FOR UPDATE`;
  const record = await scopedRequest(c, id, tx);
  if (record.archivedAt && operation !== "CANCEL")
    fail(409, "REQUEST_ARCHIVED", "Архивная заявка недоступна для изменения");
  const working = await workingRequest(c, id, tx);
  if (working.revision !== expectedRevision)
    fail(
      409,
      "REVISION_CONFLICT",
      "Рабочая версия изменилась. Обновите заявку",
      { revision: working.revision },
    );
  if (operation === "SAVE" && record.status !== "DRAFT")
    fail(
      409,
      "REGISTERED_IMMUTABLE",
      "Для оформленной заявки создайте связанное исправление",
    );
  if (operation === "CANCEL" && record.status !== "FINALIZED")
    fail(409, "NOT_REGISTERED", "Отменять можно оформленный выпуск");
  if (operation === "ARCHIVE" && record.status !== "DRAFT")
    fail(
      409,
      "REGISTERED_IMMUTABLE",
      "Оформленные заявки архивируются после полного выпуска",
    );
  const draft =
    operation === "SAVE"
      ? withCustomerIdentity(
          applyBusinessRules(
            parse(draftSchema, { ...input, businessRuleVersion: "LIVE_V1" }),
          ),
        )
      : parse(draftSchema, record.draft);
  if (operation === "SAVE") {
    if (!draft.profileVersionId) {
      const profile = await tx.issuerProfileVersion.findFirst({
        where: { tenantId: c.tenantId },
        orderBy: { version: "desc" },
        select: { id: true },
      });
      if (profile) draft.profileVersionId = profile.id;
    }
    const { checkReferences, freezeProposalReferences } =
      await import("./requests");
    await checkReferences(tx, c, draft);
    await freezeProposalReferences(tx, c, draft);
  }
  const revision =
    Math.max(record.workingRevision, working.revision, record.revision) + 1;
  const before = record.draft;
  const payload = operation === "SAVE" ? draft : { operation, reason };
  const diff =
    operation === "SAVE"
      ? proposalDiff(before, payload)
      : [
          {
            path: "status",
            before: record.status,
            after: operation === "CANCEL" ? "CANCELLED" : "ARCHIVED",
          },
        ];
  const proposalHash = hash({
    requestId: id,
    baseRevision: record.revision,
    revision,
    operation,
    payload,
  });
  await tx.requestProposal.updateMany({
    where: { tenantId: c.tenantId, requestId: id, status: "PENDING" },
    data: { status: "SUPERSEDED" },
  });
  const proposal = await tx.requestProposal.create({
    data: {
      tenantId: c.tenantId,
      requestId: id,
      revision,
      baseRevision: record.revision,
      operation,
      payload: json(payload),
      before: json(before),
      diff: json(diff),
      proposalHash,
      submittedBy: c.userId,
      reason,
    },
  });
  await tx.printRequest.update({
    where: { id },
    data: { workingRevision: revision },
  });
  await audit(tx, c, "CHANGE_PROPOSED", id, {
    proposalId: proposal.id,
    operation,
    revision,
    proposalHash,
    changedFields: diff.map((item) => item.path),
  });
  return {
    ...(await workingRequest(c, id, tx)),
    ...(operation === "SAVE" ? draft : {}),
    ...(operation === "SAVE" && draft.kind === "PERSON"
      ? { customerName: personCustomerName(draft) || null }
      : {}),
    revision,
    approval: {
      proposalId: proposal.id,
      status: proposal.status,
      baseRevision: proposal.baseRevision,
      proposalHash: proposal.proposalHash,
      submittedBy: proposal.submittedBy,
      submittedAt: proposal.submittedAt,
    },
  };
}
export async function createProposedContainer(
  tx: Prisma.TransactionClient,
  c: Context,
  input: Draft,
  extra: { correctsIssuanceId?: string; correctionReason?: string } = {},
) {
  assertStaff(c, true);
  const draft = applyBusinessRules(
    parse(draftSchema, { ...input, businessRuleVersion: "LIVE_V1" }),
  );
  const record = await tx.printRequest.create({
    data: {
      tenantId: c.tenantId,
      kind: draft.kind,
      demoMode: draft.demoMode,
      createdBy: c.userId,
      draft: json(
        draftSchema.parse({
          kind: draft.kind,
          demoMode: draft.demoMode,
          items: [],
          schemaVersion: draft.schemaVersion,
        }),
      ),
      ...extra,
    },
  });
  await audit(tx, c, "DRAFT_CONTAINER_CREATED", record.id);
  return submitProposal(tx, c, record.id, draft, 0);
}
export async function requestApproval(c: Context, id: string) {
  assertStaff(c);
  const record = await workingRequest(c, id);
  return {
    requestId: id,
    revision: record.revision,
    approvedRevision: record.approvedRevision,
    approval: record.approval,
  };
}
export async function submitApproval(c: Context, id: string, input: unknown) {
  assertStaff(c, true);
  const { expectedRevision } = parse(
    z.object({ expectedRevision: z.number().int().nonnegative() }).strict(),
    input,
  );
  const record = await workingRequest(c, id);
  if (record.archivedAt)
    fail(
      409,
      "REQUEST_ARCHIVED",
      "Архивная заявка недоступна для согласования",
    );
  if (record.revision !== expectedRevision)
    fail(409, "REVISION_CONFLICT", "Обновите рабочую версию");
  if (record.approval?.status !== "PENDING")
    fail(409, "PROPOSAL_REQUIRED", "Сохраните изменения для согласования");
  return requestApproval(c, id);
}
export async function listApprovals(c: Context, query: unknown) {
  assertStaff(c);
  const q = parse(
    z.object({
      status: z
        .enum(["PENDING", "APPROVED", "REJECTED", "SUPERSEDED"])
        .optional(),
      page: z.coerce.number().int().min(1).default(1),
    }),
    query,
  );
  const where = {
    tenantId: c.tenantId,
    ...(q.status ? { status: q.status } : {}),
  };
  const [records, total] = await Promise.all([
    db.requestProposal.findMany({
      where,
      orderBy: { submittedAt: "desc" },
      take: 50,
      skip: (q.page - 1) * 50,
    }),
    db.requestProposal.count({ where }),
  ]);
  const requestIds = records.map((record) => record.requestId),
    userIds = records.map((record) => record.submittedBy);
  const [requests, users] = await Promise.all([
    db.printRequest.findMany({
      where: { tenantId: c.tenantId, id: { in: requestIds } },
      select: { id: true, title: true },
    }),
    db.user.findMany({
      where: { tenantId: c.tenantId, id: { in: userIds } },
      select: { id: true, displayName: true },
    }),
  ]);
  return {
    items: records.map((record) => ({
      id: record.id,
      requestId: record.requestId,
      status: record.status,
      createdAt: record.submittedAt,
      submittedAt: record.submittedAt,
      title:
        (record.payload as { title?: string }).title ||
        requests.find((request) => request.id === record.requestId)?.title ||
        "Новая заявка",
      author: users.find((user) => user.id === record.submittedBy),
      submittedBy: record.submittedBy,
      requestedAction: record.operation,
      reason: record.reason,
      payloadHash: record.proposalHash,
      proposalHash: record.proposalHash,
      requestRevision: record.revision,
    })),
    total,
  };
}
export async function approvalDetail(c: Context, id: string) {
  assertStaff(c);
  const proposal = await db.requestProposal.findFirst({
    where: { id, tenantId: c.tenantId },
  });
  if (!proposal) fail(404, "NOT_FOUND", "Предложенная редакция не найдена");
  const [request, author, decision] = await Promise.all([
    scopedRequest(c, proposal.requestId),
    db.user.findFirst({
      where: { tenantId: c.tenantId, id: proposal.submittedBy },
      select: { id: true, displayName: true },
    }),
    db.proposalDecision.findFirst({
      where: { tenantId: c.tenantId, proposalId: id },
    }),
  ]);
  const { before, diff, ...safeProposal } = proposal;
  const references = new Set<string>();
  const findReferences = (value: unknown) => {
    if (!value || typeof value !== "object") return;
    if (Array.isArray(value)) {
      value.forEach(findReferences);
      return;
    }
    for (const [key, child] of Object.entries(value)) {
      if (
        ["customerId", "employerId", "profileVersionId"].includes(key) &&
        typeof child === "string"
      )
        references.add(child);
      else findReferences(child);
    }
  };
  if (isDirectorRole(c.role)) {
    findReferences(before);
    findReferences(proposal.payload);
  }
  const [customers, profiles] = await Promise.all([
    db.customerOrganization.findMany({
      where: { tenantId: c.tenantId, id: { in: [...references] } },
      select: { id: true, nameRu: true },
    }),
    db.issuerProfileVersion.findMany({
      where: { tenantId: c.tenantId, id: { in: [...references] } },
      select: { id: true, version: true, profile: true },
    }),
  ]);
  return {
    ...safeProposal,
    payloadHash: proposal.proposalHash,
    expectedProposalHash: proposal.proposalHash,
    requestedAction: proposal.operation,
    draft: proposal.operation === "SAVE" ? proposal.payload : null,
    requestRevision: proposal.revision,
    createdAt: proposal.submittedAt,
    request: {
      id: request.id,
      title:
        (proposal.operation === "SAVE" &&
          (proposal.payload as { title?: string }).title) ||
        request.title,
    },
    referenceLabels: Object.fromEntries([
      ...customers.map((customer) => [customer.id, customer.nameRu]),
      ...profiles.map((profile) => {
        const value = profile.profile as {
          nameRu?: string;
          commissionTitle?: string;
        };
        return [
          profile.id,
          `${value.commissionTitle || value.nameRu || "Профиль центра"} · версия ${profile.version}`,
        ];
      }),
    ]),
    author,
    ...(isDirectorRole(c.role)
      ? { diff, before, decision }
      : {
          diff: [],
          decision: decision
            ? {
                decision: decision.decision,
                comment: decision.comment,
                createdAt: decision.createdAt,
              }
            : null,
        }),
  };
}
export async function decideProposal(c: Context, id: string, input: unknown) {
  assertDirector(c);
  const data = parse(
    z
      .object({
        decision: z.enum(["APPROVE", "REJECT"]),
        reason: z.string().trim().min(1).max(2000),
        expectedProposalHash: z.string().regex(/^[a-f0-9]{64}$/),
      })
      .strict(),
    input,
  );
  return transaction(async (tx) => {
    const proposal = await tx.requestProposal.findFirst({
      where: { id, tenantId: c.tenantId },
    });
    if (!proposal) fail(404, "NOT_FOUND", "Предложенная редакция не найдена");
    await tx.$executeRaw`SELECT id FROM "PrintRequest" WHERE id=${proposal.requestId} AND "tenantId"=${c.tenantId} FOR UPDATE`;
    const record = await scopedRequest(c, proposal.requestId, tx);
    const current = await tx.requestProposal.findFirst({
      where: { tenantId: c.tenantId, requestId: record.id },
      orderBy: { revision: "desc" },
    });
    if (
      proposal.status !== "PENDING" ||
      current?.id !== id ||
      record.revision !== proposal.baseRevision ||
      proposal.proposalHash !== data.expectedProposalHash
    )
      fail(
        409,
        "APPROVAL_STALE",
        "Редакция уже изменилась или решение принято. Проверьте актуальное сравнение",
      );
    if (data.decision === "APPROVE" && proposal.operation === "SAVE") {
      const { assertApprovalDataComplete } = await import("./requests");
      await assertApprovalDataComplete(tx, c, record.id, proposal.revision);
    }
    await tx.proposalDecision.create({
      data: {
        tenantId: c.tenantId,
        proposalId: id,
        decision: data.decision,
        comment: data.reason,
        proposalHash: proposal.proposalHash,
        decidedBy: c.userId,
      },
    });
    await tx.requestProposal.update({
      where: { id },
      data: { status: data.decision === "APPROVE" ? "APPROVED" : "REJECTED" },
    });
    if (data.decision === "APPROVE") {
      if (proposal.operation === "SAVE") {
        if (record.status !== "DRAFT")
          fail(
            409,
            "REGISTERED_IMMUTABLE",
            "Нельзя изменить оформленную редакцию",
          );
        const draft = parse(draftSchema, proposal.payload);
        const { checkReferences, persistItems, searchable } =
          await import("./requests");
        await checkReferences(tx, c, draft);
        await tx.printRequest.update({
          where: { id: record.id },
          data: {
            draft: json(draft),
            title: draft.title,
            customerId: draft.customerId,
            kind: draft.kind,
            demoMode: draft.demoMode,
            itemCount: draft.items.length,
            searchText: searchable(draft),
            revision: proposal.revision,
            approvedProposalId: id,
          },
        });
        await persistItems(tx, c, record.id, draft);
      } else if (proposal.operation === "CANCEL") {
        const issuance = await tx.issuance.findFirst({
          where: { tenantId: c.tenantId, requestId: record.id },
          orderBy: { createdAt: "desc" },
        });
        if (!issuance) fail(409, "NOT_REGISTERED", "Выпуск не найден");
        await tx.issuanceEvent.create({
          data: {
            tenantId: c.tenantId,
            issuanceId: issuance.id,
            kind: "CANCELLED",
            reason: proposal.reason,
            actorId: c.userId,
          },
        });
        await tx.printRequest.update({
          where: { id: record.id },
          data: { status: "CANCELLED", approvedProposalId: id },
        });
      } else {
        await tx.printRequest.update({
          where: { id: record.id },
          data: { archivedAt: new Date(), approvedProposalId: id },
        });
      }
    }
    await audit(
      tx,
      c,
      data.decision === "APPROVE" ? "CHANGE_APPROVED" : "CHANGE_REJECTED",
      record.id,
      {
        proposalId: id,
        proposalHash: proposal.proposalHash,
        operation: proposal.operation,
        comment: data.reason,
      },
    );
    return {
      requestId: record.id,
      proposalId: id,
      status: data.decision === "APPROVE" ? "APPROVED" : "REJECTED",
      revision: proposal.revision,
    };
  });
}
export async function requireApproved(
  c: Context,
  id: string,
  expectedRevision: number,
  tx: Prisma.TransactionClient = db,
) {
  const record = await scopedRequest(c, id, tx);
  const latest = await tx.requestProposal.findFirst({
    where: { tenantId: c.tenantId, requestId: id },
    orderBy: { revision: "desc" },
  });
  if (
    !latest ||
    latest.operation !== "SAVE" ||
    latest.status !== "APPROVED" ||
    latest.id !== record.approvedProposalId ||
    latest.revision !== expectedRevision ||
    record.revision !== expectedRevision
  )
    fail(
      409,
      "DIRECTOR_APPROVAL_REQUIRED",
      "Текущая редакция должна быть согласована директором до оформления",
    );
  const draft = parse(draftSchema, latest.payload);
  const ids = [
    ...new Set([
      ...(draft.customerId ? [draft.customerId] : []),
      ...draft.items.flatMap((item) =>
        item.employerId ? [item.employerId] : [],
      ),
    ]),
  ].sort();
  if (
    ids.length &&
    (!draft.organizationSnapshots ||
      hash(draft.organizationSnapshots.map((value) => value.id).sort()) !==
        hash(ids))
  )
    fail(
      409,
      "DIRECTOR_APPROVAL_REQUIRED",
      "Сохраните редакцию с зафиксированными реквизитами организаций и согласуйте её с директором",
    );
  return latest;
}
export async function requestActivity(c: Context, id: string) {
  assertStaff(c);
  await scopedRequest(c, id);
  const issued = await db.issuance.findMany({
    where: { tenantId: c.tenantId, requestId: id },
    select: { id: true },
  });
  const important = [
    "CHANGE_PROPOSED",
    "CHANGE_APPROVED",
    "CHANGE_REJECTED",
    "ISSUANCE_REGISTERED",
    "SIGNATURE_VERIFIED",
    "ISSUANCE_COMPLETED",
    "ISSUANCE_CANCELLED",
    "CORRECTION_DRAFT_CREATED",
    "DRAFT_ARCHIVED",
  ];
  const events = await db.auditEvent.findMany({
    where: {
      tenantId: c.tenantId,
      entityId: { in: [id, ...issued.map((entry) => entry.id)] },
      ...(!isDirectorRole(c.role) ? { action: { in: important } } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: 200,
  });
  const users = await db.user.findMany({
    where: {
      tenantId: c.tenantId,
      id: { in: events.map((entry) => entry.actorId) },
    },
    select: { id: true, displayName: true },
  });
  return {
    items: events.map((entry) => ({
      id: entry.id,
      action: entry.action,
      createdAt: entry.createdAt,
      actorName:
        users.find((user) => user.id === entry.actorId)?.displayName ||
        "Система",
      summary: entry.action,
      ...(isDirectorRole(c.role) && important.includes(entry.action)
        ? { details: entry.metadata }
        : {}),
    })),
  };
}
