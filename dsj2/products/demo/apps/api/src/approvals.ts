import {
  draftSchema,
  applyBusinessRules,
  isDirectorRole,
  z,
  type Draft,
  finalizeSchema,
  selectAssignmentScope,
  approvalScopeValue,
  type AssignmentIdentity,
} from "@demo/contracts";
import { Prisma } from "@demo/database";
import {
  personCustomerName,
  proposalDisplayTitle,
  withCustomerIdentity,
} from "./request-customer";
import { replaceableImportScaffoldId } from "./import-scaffold";
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
export function submittedProposalDraft(proposal: {
  payload: unknown;
  resolvedSnapshot?: unknown;
}): Draft {
  return parse(draftSchema, {
    ...parse(draftSchema, proposal.payload),
    frozenResolution: proposal.resolvedSnapshot || undefined,
  });
}
export function needsPreparation(proposal: {
  operation: string;
  status: string;
  scopeHash?: string | null;
  assignments?: unknown;
  resolvedSnapshot?: unknown;
}) {
  return (
    proposal.operation === "SAVE" &&
    proposal.status === "PENDING" &&
    (!proposal.scopeHash ||
      !Array.isArray(proposal.assignments) ||
      !proposal.resolvedSnapshot)
  );
}
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
  const latest = await tx.requestProposal.findFirst({
    where: { tenantId: c.tenantId, requestId: id },
    orderBy: { revision: "desc" },
  });
  const proposal =
    latest?.status === "DRAFT"
      ? await tx.requestProposal.findFirst({
          where: {
            tenantId: c.tenantId,
            requestId: id,
            status: { in: ["PENDING", "APPROVED", "REJECTED"] },
          },
          orderBy: { revision: "desc" },
        })
      : latest;
  // Compatibility with submitted revisions saved before explicit submission existed.
  const legacyWorking =
    proposal?.operation === "SAVE" &&
    ["PENDING", "REJECTED"].includes(proposal.status) &&
    proposal.revision > record.revision &&
    record.status === "DRAFT";
  const approved = record.approvedProposalId
    ? await tx.requestProposal.findFirst({
        where: {
          id: record.approvedProposalId,
          tenantId: c.tenantId,
          requestId: id,
          operation: "SAVE",
        },
      })
    : null;
  return {
    ...record,
    ...(legacyWorking
      ? { draft: proposal.payload, revision: proposal.revision }
      : {}),
    approvedDraft: approved?.payload || record.draft,
    approvedRevision:
      approved?.revision || (record.status !== "DRAFT" ? record.revision : 0),
    archived: !!record.archivedAt,
    approval: proposal
      ? {
          proposalId: proposal.id,
          status: proposal.status,
          baseRevision: proposal.baseRevision,
          proposalHash: proposal.proposalHash,
          submittedBy: proposal.submittedBy,
          submittedAt: proposal.submittedAt,
          assignments: proposal.assignments as AssignmentIdentity[] | null,
          scopeHash: proposal.scopeHash,
          needsPreparation: needsPreparation(proposal),
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
            parse(draftSchema, {
              ...input,
              frozenResolution: undefined,
              businessRuleVersion: "LIVE_V1",
            }),
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
  if (operation === "SAVE") {
    // Editing unrelated waiting assignments preserves the selected approval.
    const approvals = await tx.requestProposal.findMany({
      where: {
        tenantId: c.tenantId,
        requestId: id,
        status: { in: ["PENDING", "APPROVED"] },
        operation: "SAVE",
      },
    });
    for (const approved of approvals) {
      let unchanged = false;
      try {
        unchanged =
          !!approved.scopeHash &&
          hash(
            approvalScopeValue(
              draft,
              approved.assignments as AssignmentIdentity[],
            ),
          ) === approved.scopeHash;
      } catch {
        /* Removed or changed selected assignment invalidates review. */
      }
      if (!unchanged)
        await tx.requestProposal.update({
          where: { id: approved.id },
          data: { status: "SUPERSEDED" },
        });
    }
  } else
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
      status: operation === "SAVE" ? "DRAFT" : "PENDING",
    },
  });
  if (operation === "SAVE") {
    const { persistItems, searchable, protectIssuedAssignments } =
      await import("./requests");
    await protectIssuedAssignments(
      tx,
      c,
      id,
      draft,
      parse(draftSchema, working.draft),
    );
    await persistItems(tx, c, id, draft);
    await tx.printRequest.update({
      where: { id },
      data: {
        draft: json(draft),
        revision,
        workingRevision: revision,
        title: draft.title,
        kind: draft.kind,
        customerId: draft.customerId,
        demoMode: draft.demoMode,
        itemCount: draft.items.length,
        searchText: searchable(draft),
      },
    });
  } else
    await tx.printRequest.update({
      where: { id },
      data: { workingRevision: revision },
    });
  await audit(
    tx,
    c,
    operation === "SAVE" ? "DRAFT_SAVED" : "CHANGE_PROPOSED",
    id,
    {
      proposalId: proposal.id,
      operation,
      revision,
      proposalHash,
      changedFields: diff.map((item) => item.path),
    },
  );
  return {
    ...(await workingRequest(c, id, tx)),
    ...(operation === "SAVE" ? draft : {}),
    ...(operation === "SAVE" && draft.kind === "PERSON"
      ? { customerName: personCustomerName(draft) || null }
      : {}),
    revision,
    importScaffoldId:
      operation === "SAVE"
        ? await replaceableImportScaffoldId(
            tx,
            c,
            id,
            draft,
            working.approvedRevision,
          )
        : null,
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
    parse(draftSchema, {
      ...input,
      frozenResolution: undefined,
      businessRuleVersion: "LIVE_V1",
    }),
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
    requestStatus: record.status,
    approval: record.approval,
  };
}
export async function submitApproval(c: Context, id: string, input: unknown) {
  assertStaff(c, true);
  const data = parse(finalizeSchema, input);
  return transaction(async (tx) => {
    await tx.$executeRaw`SELECT id FROM "PrintRequest" WHERE id=${id} AND "tenantId"=${c.tenantId} FOR UPDATE`;
    const record = await workingRequest(c, id, tx);
    if (record.archivedAt)
      fail(
        409,
        "REQUEST_ARCHIVED",
        "Архивная заявка недоступна для согласования",
      );
    if (record.status !== "DRAFT")
      fail(409, "REGISTERED_IMMUTABLE", "Все назначения уже оформлены");
    if (record.revision !== data.expectedRevision)
      fail(409, "REVISION_CONFLICT", "Обновите рабочую версию");
    const { selectBatch, assertApprovalDataComplete } =
      await import("./requests");
    const selected = await selectBatch(
      tx,
      c,
      id,
      parse(draftSchema, record.draft),
      data.assignments,
    );
    const frozenResolution = await assertApprovalDataComplete(
      tx,
      c,
      id,
      data.expectedRevision,
      selected.assignments,
    );
    const scopeHash = hash(
      approvalScopeValue(
        parse(draftSchema, record.draft),
        selected.assignments,
      ),
    );
    const prior = await tx.requestProposal.findFirst({
      where: {
        tenantId: c.tenantId,
        requestId: id,
        operation: "SAVE",
        scopeHash,
        status: { in: ["PENDING", "APPROVED"] },
      },
      orderBy: { revision: "desc" },
    });
    if (prior?.resolvedSnapshot)
      return {
        requestId: id,
        revision: record.revision,
        approval: {
          proposalId: prior.id,
          status: prior.status,
          proposalHash: prior.proposalHash,
          assignments: selected.assignments,
        },
      };
    await tx.requestProposal.updateMany({
      where: {
        tenantId: c.tenantId,
        requestId: id,
        status: "PENDING",
        operation: "SAVE",
      },
      data: { status: "SUPERSEDED" },
    });
    const staging = await tx.requestProposal.findFirst({
      where: {
        tenantId: c.tenantId,
        requestId: id,
        revision: record.revision,
        status: "DRAFT",
      },
    });
    const revision = staging
      ? record.revision
      : Math.max(record.revision, record.workingRevision) + 1;
    const proposalHash = hash({
      requestId: id,
      revision,
      operation: "SAVE",
      scopeHash,
      assignments: selected.assignments,
      frozenResolutionHash: hash(frozenResolution),
    });
    const fields = {
      status: "PENDING",
      assignments: json(selected.assignments),
      scopeHash,
      proposalHash,
      payload: json(parse(draftSchema, record.draft)),
      resolvedSnapshot: json(frozenResolution),
      submittedBy: c.userId,
      submittedAt: new Date(),
    };
    const proposal = staging
      ? await tx.requestProposal.update({
          where: { id: staging.id },
          data: fields,
        })
      : await tx.requestProposal.create({
          data: {
            tenantId: c.tenantId,
            requestId: id,
            revision,
            baseRevision: record.revision,
            operation: "SAVE",
            before: record.draft as Prisma.InputJsonValue,
            diff: json([]),
            ...fields,
          },
        });
    if (revision !== record.revision)
      await tx.printRequest.update({
        where: { id },
        data: { revision, workingRevision: revision },
      });
    await audit(tx, c, "CHANGE_PROPOSED", id, {
      proposalId: proposal.id,
      revision,
      scopeHash,
      assignments: selected.assignments,
    });
    return {
      requestId: id,
      revision,
      approval: {
        proposalId: proposal.id,
        status: proposal.status,
        proposalHash,
        assignments: selected.assignments,
      },
    };
  });
}
export async function listApprovals(c: Context, query: unknown) {
  assertStaff(c);
  const q = parse(
    z.object({
      status: z
        .enum([
          "PENDING",
          "NEEDS_PREPARATION",
          "APPROVED",
          "REJECTED",
          "SUPERSEDED",
        ])
        .optional(),
      page: z.coerce.number().int().min(1).default(1),
    }),
    query,
  );
  const legacy: Prisma.RequestProposalWhereInput = {
    operation: "SAVE",
    status: "PENDING",
    OR: [{ scopeHash: null }, { resolvedSnapshot: { equals: Prisma.AnyNull } }],
  };
  const where: Prisma.RequestProposalWhereInput = {
    tenantId: c.tenantId,
    ...(q.status === "NEEDS_PREPARATION"
      ? legacy
      : q.status
        ? {
            status: q.status,
            ...(q.status === "PENDING" ? { NOT: legacy } : {}),
          }
        : { status: { not: "DRAFT" } }),
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
      needsPreparation: needsPreparation(record),
      createdAt: record.submittedAt,
      submittedAt: record.submittedAt,
      title: proposalDisplayTitle(
        record,
        requests.find((request) => request.id === record.requestId)?.title ||
          "Новая заявка",
      ),
      author: users.find((user) => user.id === record.submittedBy),
      submittedBy: record.submittedBy,
      requestedAction: record.operation,
      reason: record.reason,
      payloadHash: record.proposalHash,
      proposalHash: record.proposalHash,
      requestRevision: record.revision,
    })),
    total,
    needsPreparationCount: await db.requestProposal.count({
      where: { tenantId: c.tenantId, ...legacy },
    }),
  };
}
/** Explicitly continue an old autosaved proposal without rewriting its payload. */
export async function prepareLegacyProposal(
  c: Context,
  id: string,
  input: unknown,
) {
  assertStaff(c, true);
  const data = parse(
    z
      .object({
        expectedRevision: z.number().int().nonnegative(),
        expectedProposalHash: z.string().regex(/^[a-f0-9]{64}$/),
      })
      .strict(),
    input,
  );
  return transaction(async (tx) => {
    const proposal = await tx.requestProposal.findFirst({
      where: { tenantId: c.tenantId, id },
    });
    if (!proposal) fail(404, "NOT_FOUND", "Редакция не найдена");
    await tx.$executeRaw`SELECT id FROM "PrintRequest" WHERE id=${proposal.requestId} AND "tenantId"=${c.tenantId} FOR UPDATE`;
    const currentProposal = await tx.requestProposal.findFirstOrThrow({
      where: { id, tenantId: c.tenantId },
    });
    const working = await workingRequest(c, proposal.requestId, tx);
    if (
      !needsPreparation(currentProposal) ||
      currentProposal.proposalHash !== data.expectedProposalHash ||
      working.revision !== data.expectedRevision ||
      working.approval?.proposalId !== id
    )
      fail(409, "APPROVAL_STALE", "Редакция уже изменена. Обновите заявку");
    const saved = await submitProposal(
      tx,
      c,
      proposal.requestId,
      parse(draftSchema, working.draft),
      working.revision,
    );
    await audit(tx, c, "LEGACY_DRAFT_PREPARED", proposal.requestId, {
      sourceProposalId: id,
      sourceProposalHash: proposal.proposalHash,
      revision: saved.revision,
    });
    return { requestId: proposal.requestId, revision: saved.revision };
  });
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
  const scopeAssignments =
    proposal.operation === "SAVE" && proposal.assignments
      ? (proposal.assignments as AssignmentIdentity[])
      : null;
  const scopedDraft = scopeAssignments
    ? selectAssignmentScope(
        parse(draftSchema, proposal.payload),
        scopeAssignments,
      ).draft
    : null;
  const previousDraft = scopedDraft ? parse(draftSchema, before) : null;
  const previousKeys = new Set(
    previousDraft
      ? selectAssignmentScope(previousDraft).assignments.map((assignment) =>
          JSON.stringify([assignment.rowId, assignment.assignmentId]),
        )
      : [],
  );
  const scopedBefore = previousDraft
    ? selectAssignmentScope(
        previousDraft,
        scopeAssignments!.filter((assignment) =>
          previousKeys.has(
            JSON.stringify([assignment.rowId, assignment.assignmentId]),
          ),
        ),
      ).draft
    : null;
  const visibleDiff =
    scopedDraft && scopedBefore
      ? proposalDiff(scopedBefore, scopedDraft)
      : diff;
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
  let review = null;
  let reviewUnavailable = false;
  if (proposal.operation === "SAVE") {
    const { proposalDataReview } = await import("./requests");
    try {
      review = await proposalDataReview(
        c,
        proposal.requestId,
        scopeAssignments
          ? selectAssignmentScope(
              submittedProposalDraft(proposal),
              scopeAssignments,
            ).draft
          : submittedProposalDraft(proposal),
      );
    } catch {
      // A historical missing reference must not hide the immutable revision or
      // the director's explicit return action. Approval still fails closed.
      reviewUnavailable = true;
    }
  }
  return {
    ...safeProposal,
    payloadHash: proposal.proposalHash,
    expectedProposalHash: proposal.proposalHash,
    requestedAction: proposal.operation,
    review,
    reviewUnavailable,
    needsPreparation: needsPreparation(proposal),
    currentRevision: (await workingRequest(c, proposal.requestId)).revision,
    draft:
      proposal.operation === "SAVE" ? scopedDraft || proposal.payload : null,
    requestRevision: proposal.revision,
    createdAt: proposal.submittedAt,
    request: {
      id: request.id,
      title: proposalDisplayTitle(proposal, request.title),
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
      ? { diff: visibleDiff, before: scopedBefore || before, decision }
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
      (proposal.scopeHash
        ? hash(
            approvalScopeValue(
              parse(
                draftSchema,
                (await workingRequest(c, record.id, tx)).draft,
              ),
              proposal.assignments as AssignmentIdentity[],
            ),
          ) !== proposal.scopeHash
        : current?.id !== id || record.revision !== proposal.baseRevision) ||
      proposal.proposalHash !== data.expectedProposalHash
    )
      fail(
        409,
        "APPROVAL_STALE",
        "Редакция уже изменилась или решение принято. Проверьте актуальное сравнение",
      );
    if (data.decision === "APPROVE" && proposal.operation === "SAVE") {
      if (needsPreparation(proposal))
        fail(
          409,
          "LEGACY_PREPARATION_REQUIRED",
          "Подготовьте актуальный черновик и передайте готовый состав директору",
        );
      const { assertApprovalDataComplete } = await import("./requests");
      await assertApprovalDataComplete(
        tx,
        c,
        record.id,
        proposal.scopeHash ? record.revision : proposal.revision,
        proposal.assignments as AssignmentIdentity[] | undefined,
        submittedProposalDraft(proposal),
      );
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
      if (proposal.operation === "SAVE" && proposal.scopeHash) {
        if (record.status !== "DRAFT")
          fail(409, "REGISTERED_IMMUTABLE", "Все назначения уже оформлены");
        await tx.printRequest.update({
          where: { id: record.id },
          data: { approvedProposalId: id },
        });
      } else if (proposal.operation === "SAVE") {
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
  assignments?: AssignmentIdentity[],
) {
  const record = await workingRequest(c, id, tx);
  if (record.revision !== expectedRevision)
    fail(409, "REVISION_CONFLICT", "Сначала сохраните актуальную версию");
  const draft = parse(draftSchema, record.draft);
  const { selectBatch } = await import("./requests");
  const selected = await selectBatch(tx, c, id, draft, assignments);
  const scopeHash = hash(approvalScopeValue(draft, selected.assignments));
  const candidates = await tx.requestProposal.findMany({
    where: {
      tenantId: c.tenantId,
      requestId: id,
      operation: "SAVE",
      status: "APPROVED",
    },
    orderBy: { revision: "desc" },
  });
  const latest = candidates.find((proposal) =>
    proposal.scopeHash
      ? proposal.scopeHash === scopeHash
      : proposal.id === record.approvedProposalId &&
        proposal.revision === expectedRevision &&
        hash(proposal.payload) === hash(draft),
  );
  if (!latest)
    fail(
      409,
      "DIRECTOR_APPROVAL_REQUIRED",
      "Выбранный состав и его актуальные данные должны быть согласованы директором до оформления",
    );
  if (!latest.resolvedSnapshot)
    fail(
      409,
      "DIRECTOR_APPROVAL_REQUIRED",
      "У прежней редакции не зафиксированы итоговые значения. Нажмите «Передать директору» для нового согласования подготовленного состава",
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
