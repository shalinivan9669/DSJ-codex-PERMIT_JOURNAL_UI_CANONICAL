import { randomUUID } from "node:crypto";
import {
  draftSchema,
  patchSchema,
  finalizeSchema,
  previewSchema,
  validateDraft,
  profileSchema,
  type Draft,
  protocolTemplateFor,
  credentialTemplateFor,
  resolveDraft,
  documentPlan,
  eventProtocolAssignment,
  today,
  z,
  stableValidationIssue,
  isBlankText,
  selectAssignmentScope,
  approvalScopeValue,
  assignmentIdentityKey,
  isTechnicalBlankRecipient,
  hasEnglishDraftValues,
  type AssignmentIdentity,
  type PreviewTarget,
} from "@demo/contracts";
import { Prisma } from "@demo/database";
import { ArtifactStore, runRender } from "@demo/printing";
import {
  db,
  fail,
  parse,
  hash,
  json,
  audit,
  transaction,
  scopedRequest,
  type Context,
} from "./core";
import { artifactAvailability } from "./storage";
import { duplicateIssuanceWarnings } from "./duplicate-issuance";
import { groupHeaderWorkplace } from "./group-workplace";
import {
  assignmentTemplateKey,
  registeredTemplateKey,
} from "./template-selection";
import { replaceableImportScaffoldId } from "./import-scaffold";
import {
  companyEmployerId,
  personCustomerName,
  requestDisplayTitle,
  withCustomerIdentity,
} from "./request-customer";
import {
  assertStaff,
  createProposedContainer,
  requireApproved,
  submitProposal,
  workingRequest,
  submittedProposalDraft,
  needsPreparation,
} from "./approvals";
import { prepareSigningPolicy, signingState } from "./signing";
import {
  validatePinnedServiceRule,
  ruleApplicabilityIssues,
} from "./service-rule-applicability";
import { resetRetakeAttempt, resetRetakeEvent } from "./retake-attempt";
import { approvalPreviewSamples } from "./approval-preview";
import { previewScope, previewIssueApplies } from "./preview-scope";
import { recoverPreviewArtifacts } from "./preview-artifacts";
import { checkLayoutBatches } from "./layout-preflight";
import { recipientRestoreBaseline } from "./recipient-restore";
export function namespace(templateId: string) {
  const family = templateId.split("-")[0].toUpperCase();
  const kind = templateId.endsWith("protocol")
    ? "PROTOCOL"
    : templateId.endsWith("witness")
      ? "WITNESS"
      : templateId.endsWith("certificate")
        ? "CERTIFICATE"
        : "CARD";
  return `${family}:${kind}`;
}
type OrganizationPrintFields = {
  id: string;
  nameRu: string;
  nameKz: string | null;
  bin: string | null;
  addressRu: string | null;
  addressKz: string | null;
};
export async function organizationMap(
  tx: Prisma.TransactionClient,
  c: Context,
  draft: Draft,
) {
  if (draft.organizationSnapshots !== undefined)
    return new Map(
      draft.organizationSnapshots.map((organization) => [
        organization.id,
        organization,
      ]),
    );
  const ids = [
    ...new Set([
      ...(draft.customerId ? [draft.customerId] : []),
      ...draft.items.flatMap((item) =>
        item.employerId ? [item.employerId] : [],
      ),
    ]),
  ];
  const organizations = ids.length
    ? await tx.customerOrganization.findMany({
        where: { tenantId: c.tenantId, id: { in: ids } },
        orderBy: { id: "asc" },
      })
    : [];
  return new Map(
    organizations.map((organization) => [organization.id, organization]),
  );
}
/** Server-owned business reference values. Never refresh an approved or issued payload during rendering. */
export async function freezeProposalReferences(
  tx: Prisma.TransactionClient,
  c: Context,
  draft: Draft,
) {
  const ids = [
    ...new Set([
      ...(draft.customerId ? [draft.customerId] : []),
      ...draft.items.flatMap((item) =>
        item.employerId ? [item.employerId] : [],
      ),
    ]),
  ].sort();
  const organizations = ids.length
    ? await tx.customerOrganization.findMany({
        where: { tenantId: c.tenantId, id: { in: ids } },
        select: {
          id: true,
          nameRu: true,
          nameKz: true,
          bin: true,
          addressRu: true,
          addressKz: true,
        },
        orderBy: { id: "asc" },
      })
    : [];
  draft.organizationSnapshots = organizations;
}
export function employerFields(
  item: Draft["items"][number],
  customer: OrganizationPrintFields | null,
  organizations: ReadonlyMap<string, OrganizationPrintFields>,
) {
  // Explicit imported/manual text stays intact. A separately linked employer
  // supplies missing fields. The request's company is the default employer.
  const candidate = item.employerId
    ? organizations.get(item.employerId)
    : customer;
  const localRu = isBlankText(item.workplaceRu) ? "" : item.workplaceRu;
  const localKz = isBlankText(item.workplaceKz) ? "" : item.workplaceKz;
  const localEmployer = !!(localRu || localKz);
  const normalized = (value: string | null | undefined) =>
    (value || "").trim().replace(/\s+/g, " ").toLocaleLowerCase("ru");
  const names = new Set(
    [normalized(candidate?.nameRu), normalized(candidate?.nameKz)].filter(
      Boolean,
    ),
  );
  const bin = normalized(item.employerBin);
  const matchingBin = !bin || bin === normalized(candidate?.bin);
  const matchingNames =
    !!item.employerId ||
    (localEmployer
      ? [localRu, localKz]
          .filter(Boolean)
          .every((name) => names.has(normalized(name)))
      : !!bin ||
        [
          item.employerAddressRu,
          item.employerAddressKz,
          item.employerAddressEn,
        ].every((address) => !normalized(address)));
  // An unrelated manual employer must never receive the customer's BIN/address.
  const employer = matchingBin && matchingNames ? candidate : undefined;
  return {
    workplaceRu: localEmployer
      ? localRu || localKz
      : employer?.nameRu || employer?.nameKz || "",
    workplaceKz: localEmployer
      ? localKz || localRu
      : employer?.nameKz || employer?.nameRu || "",
    employerBin: isBlankText(item.employerBin)
      ? employer?.bin || ""
      : item.employerBin || "",
    employerAddressRu: item.employerAddressRu || employer?.addressRu || "",
    employerAddressKz:
      item.employerAddressKz ||
      employer?.addressKz ||
      employer?.addressRu ||
      "",
  };
}
export function searchable(draft: Draft) {
  return [
    draft.title,
    ...draft.items.flatMap((i) => [
      i.fullNameRu,
      i.fullNameKz,
      i.positionRu,
      i.positionKz,
      i.personnelNumber || "",
      i.externalId || "",
    ]),
  ].join(" ");
}
export async function checkReferences(
  tx: Prisma.TransactionClient,
  c: Context,
  draft: Draft,
) {
  if (
    draft.customerId &&
    !(await tx.customerOrganization.findFirst({
      where: { id: draft.customerId, tenantId: c.tenantId, archived: false },
    }))
  )
    fail(404, "CUSTOMER_NOT_FOUND", "Заказчик не найден");
  for (const [field, table] of [
    ["recipientId", "recipient"],
    ["employerId", "customerOrganization"],
  ] as const) {
    const ids = [
      ...new Set(draft.items.flatMap((i) => (i[field] ? [i[field]!] : []))),
    ];
    const count =
      table === "recipient"
        ? await tx.recipient.count({
            where: { tenantId: c.tenantId, id: { in: ids } },
          })
        : await tx.customerOrganization.count({
            where: { tenantId: c.tenantId, id: { in: ids } },
          });
    if (count !== ids.length)
      fail(
        404,
        "REFERENCE_NOT_FOUND",
        "Человек или работодатель не найден в центре",
      );
  }
  const profileIds = [
    ...new Set(
      [
        draft.profileVersionId,
        ...(draft.events || []).map((e) => e.profileVersionId),
      ].filter((x): x is string => !!x),
    ),
  ];
  if (
    (await tx.issuerProfileVersion.count({
      where: { tenantId: c.tenantId, id: { in: profileIds } },
    })) !== profileIds.length
  )
    fail(404, "PROFILE_NOT_FOUND", "Версия центра не найдена");
  const ruleIds = [
    ...new Set(
      (draft.events || []).flatMap((event) =>
        event.serviceRuleVersionId ? [event.serviceRuleVersionId] : [],
      ),
    ),
  ];
  if (
    (await tx.serviceRuleVersion.count({
      where: { tenantId: c.tenantId, id: { in: ruleIds } },
    })) !== ruleIds.length
  )
    fail(
      404,
      "SERVICE_RULE_NOT_FOUND",
      "Версия паспорта услуги не найдена в этом центре",
    );
  const photoIds = [
    ...new Set(
      draft.items.flatMap((i) => (i.photoAssetId ? [i.photoAssetId] : [])),
    ),
  ];
  if (
    photoIds.length !==
    (await tx.photoAsset.count({
      where: { id: { in: photoIds }, tenantId: c.tenantId },
    }))
  )
    fail(404, "PHOTO_NOT_FOUND", "Фотография не найдена");
  for (const item of draft.items)
    for (const assignment of item.assignments) {
      const ref = assignment.retakeOf;
      if (!ref) continue;
      const previous = await scopedRequest(c, ref.requestId, tx);
      const previousOwnership = await tx.issuanceAssignment.findFirst({
        where: {
          tenantId: c.tenantId,
          requestId: ref.requestId,
          rowId: ref.rowId,
          assignmentId: ref.assignmentId,
        },
      });
      if (
        (previous.status === "DRAFT" && !previousOwnership) ||
        previous.status === "CANCELLED"
      )
        fail(
          409,
          "RETAKE_HISTORY_REQUIRED",
          "Пересдача требует сохранённую действующую историю попытки",
        );
      const previousIssuance = await tx.issuance.findFirst({
        where: {
          tenantId: c.tenantId,
          requestId: previous.id,
          ...(previousOwnership ? { id: previousOwnership.issuanceId } : {}),
        },
        orderBy: { createdAt: "desc" },
      });
      if (
        !previousIssuance ||
        (await tx.issuanceEvent.count({
          where: {
            tenantId: c.tenantId,
            issuanceId: previousIssuance.id,
            kind: { in: ["CANCELLED", "REPLACED"] },
          },
        }))
      )
        fail(
          409,
          "RETAKE_SOURCE_INACTIVE",
          "Предыдущая попытка отменена или заменена; откройте её актуальную версию",
        );
      const previousDraft = draftSchema.parse(
        (previousIssuance.snapshot as { draft: unknown }).draft,
      );
      const previousItem = previousDraft.items.find(
        (row) => row.id === ref.rowId,
      );
      const attempt = previousItem?.assignments.find(
        (a) => a.id === ref.assignmentId,
      );
      if (
        !attempt ||
        !["FAILED", "ABSENT"].includes(attempt.outcome?.status || "") ||
        attempt.templateId !== assignment.templateId ||
        (previousItem?.recipientId
          ? previousItem.recipientId !== item.recipientId
          : !!item.recipientId ||
            previousItem?.fullNameRu !== item.fullNameRu) ||
        (assignment.eventId && assignment.eventId === attempt.eventId)
      )
        fail(
          409,
          "RETAKE_REFERENCE_INVALID",
          "Выберите отдельную попытку того же получателя после неуспешной проверки или неявки",
        );
    }
}
export async function persistItems(
  tx: Prisma.TransactionClient,
  c: Context,
  id: string,
  draft: Draft,
) {
  for (const event of draft.events || []) {
    const existing = await tx.trainingEvent.findUnique({
      where: { id: event.id },
    });
    if (
      existing &&
      (existing.tenantId !== c.tenantId || existing.requestId !== id)
    )
      fail(
        409,
        "EVENT_OWNERSHIP",
        "Событие принадлежит другой заявке; выберите самостоятельное событие",
      );
    await tx.trainingEvent.upsert({
      where: { id: event.id },
      create: {
        id: event.id,
        tenantId: c.tenantId,
        requestId: id,
        title: event.title,
        revision: event.revision,
        protocolTemplateId: event.protocolTemplateId,
        data: json(event),
      },
      update: {
        title: event.title,
        revision: event.revision,
        protocolTemplateId: event.protocolTemplateId,
        data: json(event),
      },
    });
  }
  await tx.requestItem.deleteMany({
    where: { requestId: id, tenantId: c.tenantId },
  });
  if (draft.items.length)
    await tx.requestItem.createMany({
      data: draft.items.map((item, position) => ({
        tenantId: c.tenantId,
        requestId: id,
        rowId: item.id,
        position,
        payload: json(item),
      })),
    });
}
export async function selectBatch(
  tx: Prisma.TransactionClient,
  c: Context,
  id: string,
  draft: Draft,
  assignments?: AssignmentIdentity[],
) {
  const issued = await tx.issuanceAssignment.findMany({
    where: { tenantId: c.tenantId, requestId: id },
    select: { rowId: true, assignmentId: true },
  });
  try {
    const scope = selectAssignmentScope(draft, assignments, issued);
    if (!scope.assignments.length && assignments)
      fail(
        422,
        "EMPTY_ISSUANCE_SELECTION",
        "Выберите ещё не оформленные назначения готовых людей",
      );
    return scope;
  } catch (error) {
    if (error instanceof Error && error.message === "ASSIGNMENT_ALREADY_ISSUED")
      fail(
        409,
        "ASSIGNMENT_ALREADY_ISSUED",
        "Это обучение уже оформлено; откройте сохранённые документы или создайте исправление",
      );
    if (
      error instanceof Error &&
      error.message === "ASSIGNMENT_SELECTION_INVALID"
    )
      fail(
        422,
        "ASSIGNMENT_SELECTION_INVALID",
        "Выбранные человек и курс отсутствуют в актуальной заявке",
      );
    throw error;
  }
}
export async function protectIssuedAssignments(
  tx: Prisma.TransactionClient,
  c: Context,
  id: string,
  draft: Draft,
  before: Draft,
) {
  const issued = await tx.issuanceAssignment.findMany({
    where: { tenantId: c.tenantId, requestId: id },
    select: { rowId: true, assignmentId: true },
  });
  for (const identity of issued) {
    const previous = before.items
      .find((item) => item.id === identity.rowId)
      ?.assignments.find(
        (assignment) => assignment.id === identity.assignmentId,
      );
    const next = draft.items
      .find((item) => item.id === identity.rowId)
      ?.assignments.find(
        (assignment) => assignment.id === identity.assignmentId,
      );
    if (!previous || !next || hash(previous) !== hash(next))
      fail(
        409,
        "ISSUED_ASSIGNMENT_IMMUTABLE",
        "Оформленное обучение изменяется только явным исправлением; продолжайте работу с оставшимися курсами",
        identity,
      );
  }
}
export async function createRequest(
  c: Context,
  input: unknown,
  idempotencyKey?: unknown,
) {
  assertStaff(c, true);
  const draft = parse(draftSchema, input);
  const tenant = await db.tenant.findUniqueOrThrow({
    where: { id: c.tenantId },
  });
  // Creation only: reopening/saving a draft never advances its calendar date.
  // An explicit blank is an intentional exception, not a request for a default.
  if (
    draft.schemaVersion === 2 &&
    draft.commonFields?.documentDate === undefined
  )
    draft.commonFields = {
      ...draft.commonFields,
      documentDate: today(tenant.timezone),
    };
  for (const item of draft.items)
    for (const assignment of item.assignments)
      if (assignment.outcome)
        assignment.outcome =
          assignment.outcome.status === "UNKNOWN"
            ? { status: "UNKNOWN", source: assignment.outcome.source }
            : {
                ...assignment.outcome,
                confirmedBy: c.userId,
                confirmedAt: new Date().toISOString(),
              };
  if (tenant.demoOnly) draft.demoMode = true;
  if (draft.schemaVersion === 2 && !draft.profileVersionId) {
    const profile = await db.issuerProfileVersion.findFirst({
      where: { tenantId: c.tenantId },
      orderBy: { version: "desc" },
    });
    if (profile) draft.profileVersionId = profile.id;
  }
  const key =
    typeof idempotencyKey === "string" &&
    /^[a-zA-Z0-9_-]{16,128}$/.test(idempotencyKey)
      ? idempotencyKey
      : undefined;
  if (idempotencyKey !== undefined && !key)
    fail(400, "KEY_INVALID", "Неверный ключ повторяемости команды");
  const payloadHash = hash({ userId: c.userId, input });
  return transaction(async (tx) => {
    if (key) {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${c.tenantId + ":create:" + key},0))`;
      const prior = await tx.idempotencyOperation.findUnique({
        where: {
          tenantId_command_idempotencyKey: {
            tenantId: c.tenantId,
            command: "CREATE_REQUEST",
            idempotencyKey: key,
          },
        },
      });
      if (prior) {
        if (prior.payloadHash !== payloadHash)
          fail(
            409,
            "IDEMPOTENCY_MISMATCH",
            "Этот ключ уже использован с другими данными",
          );
        return prior.result as unknown as Awaited<
          ReturnType<typeof createProposedContainer>
        >;
      }
    }
    const result = await createProposedContainer(tx, c, draft);
    if (key)
      await tx.idempotencyOperation.create({
        data: {
          tenantId: c.tenantId,
          command: "CREATE_REQUEST",
          idempotencyKey: key,
          payloadHash,
          result: json(result),
        },
      });
    return result;
  });
}
export async function patchRequest(c: Context, id: string, input: unknown) {
  assertStaff(c, true);
  const { expectedRevision, draft, restoreRecipientId } = parse(
    patchSchema,
    input,
  );
  if (
    (await db.tenant.findUniqueOrThrow({ where: { id: c.tenantId } })).demoOnly
  )
    draft.demoMode = true;
  return transaction(async (tx) => {
    await tx.$executeRaw`SELECT id FROM "PrintRequest" WHERE id=${id} AND "tenantId"=${c.tenantId} FOR UPDATE`;
    const record = await workingRequest(c, id, tx);
    if (record.status !== "DRAFT")
      fail(
        409,
        "REGISTERED_IMMUTABLE",
        "Оформленная заявка доступна только для исправления отдельной операцией",
      );
    if (record.revision !== expectedRevision)
      fail(409, "REVISION_CONFLICT", "Заявка изменена другим оператором", {
        revision: record.revision,
      });
    const current = draftSchema.parse(record.draft);
    const baseline = restoreRecipientId
      ? recipientRestoreBaseline({
          tenantId: c.tenantId,
          requestId: id,
          revision: expectedRevision,
          rowId: restoreRecipientId,
          current,
          incoming: draft,
          proposal: current.items.some((row) => row.id === restoreRecipientId)
            ? null
            : await tx.requestProposal.findFirst({
                where: {
                  tenantId: c.tenantId,
                  requestId: id,
                  revision: expectedRevision,
                  operation: "SAVE",
                  status: "DRAFT",
                },
              }),
        })
      : current;
    protectOutcomeMetadata(c, draft, baseline);
    return submitProposal(tx, c, id, draft, expectedRevision);
  });
}
/** Confirmation metadata comes exclusively from authenticated server actions. */
export function protectOutcomeMetadata(
  c: Context,
  draft: Draft,
  before: Draft,
) {
  for (const item of draft.items)
    for (const assignment of item.assignments) {
      if (!assignment.outcome) continue;
      if (assignment.outcome.status === "UNKNOWN") {
        assignment.outcome = {
          status: "UNKNOWN",
          source: assignment.outcome.source,
        };
        continue;
      }
      const old = before.items
        .find((row) => row.id === item.id)
        ?.assignments.find((entry) => entry.id === assignment.id);
      assignment.outcome =
        old?.outcome &&
        old.outcome.status === assignment.outcome.status &&
        old.outcome.source === assignment.outcome.source &&
        old.result === assignment.result &&
        old.biotKnowledgeResult === assignment.biotKnowledgeResult &&
        old.biotProctoringResult === assignment.biotProctoringResult
          ? old.outcome
          : {
              status: assignment.outcome.status,
              source: assignment.outcome.source,
              confirmedBy: c.userId,
              confirmedAt: new Date().toISOString(),
            };
    }
}
export async function requestFilter(
  c: Context,
  q: {
    search?: string;
    status?: string;
    kind?: string;
    customerId?: string;
    history?: boolean;
    archive?: boolean;
  },
): Promise<Prisma.PrintRequestWhereInput> {
  return {
    tenantId: c.tenantId,
    status: q.status,
    ...(q.history
      ? {
          AND: [
            {
              OR: [
                { status: { in: ["FINALIZED", "CANCELLED"] } },
                {
                  id: {
                    in: (
                      await db.issuance.findMany({
                        where: { tenantId: c.tenantId },
                        select: { requestId: true },
                        distinct: ["requestId"],
                      })
                    ).map((issuance) => issuance.requestId),
                  },
                },
              ],
            },
          ],
        }
      : {}),
    kind: q.kind,
    customerId: q.customerId,
    ...(q.archive !== undefined
      ? { archivedAt: q.archive ? { not: null } : null }
      : {}),
    ...(q.search
      ? {
          OR: [
            {
              searchText: { contains: q.search, mode: "insensitive" as const },
            },
            { id: { contains: q.search } },
            {
              id: {
                in: (
                  await db.$queryRaw<
                    Array<{ requestId: string }>
                  >`SELECT p."requestId" FROM "RequestProposal" p WHERE p."tenantId"=${c.tenantId} AND p.operation='SAVE' AND p.status IN ('PENDING','REJECTED') AND p.payload::text ILIKE ${"%" + q.search + "%"} AND NOT EXISTS(SELECT 1 FROM "RequestProposal" newer WHERE newer."tenantId"=p."tenantId" AND newer."requestId"=p."requestId" AND newer.revision>p.revision)`
                ).map((proposal) => proposal.requestId),
              },
            },
            {
              id: {
                in: (
                  await db.requestItem.findMany({
                    where: {
                      tenantId: c.tenantId,
                      OR: [
                        {
                          payload: {
                            path: ["personnelNumber"],
                            equals: q.search,
                          },
                        },
                        { payload: { path: ["externalId"], equals: q.search } },
                      ],
                    },
                    select: { requestId: true },
                    distinct: ["requestId"],
                  })
                ).map((item) => item.requestId),
              },
            },
            {
              customerId: {
                in: (
                  await db.customerOrganization.findMany({
                    where: {
                      tenantId: c.tenantId,
                      OR: [
                        { nameRu: { contains: q.search, mode: "insensitive" } },
                        { nameKz: { contains: q.search, mode: "insensitive" } },
                      ],
                    },
                    select: { id: true },
                  })
                ).map((c) => c.id),
              },
            },
          ],
        }
      : {}),
  };
}
export async function listRequests(c: Context, query: Record<string, unknown>) {
  const q = parse(
    z.object({
      page: z.coerce.number().int().min(1).default(1),
      pageSize: z.coerce.number().int().min(1).max(100).default(20),
      search: z.string().max(255).default(""),
      status: z.enum(["DRAFT", "FINALIZED", "CANCELLED"]).optional(),
      kind: z.enum(["PERSON", "COMPANY"]).optional(),
      customerId: z.string().optional(),
      archive: z
        .enum(["true", "false"])
        .transform((value) => value === "true")
        .optional(),
      history: z
        .enum(["true", "false"])
        .transform((value) => value === "true")
        .optional(),
    }),
    query,
  );
  const where = await requestFilter(c, q);
  const [items, total] = await db.$transaction([
    db.printRequest.findMany({
      where,
      select: {
        id: true,
        title: true,
        kind: true,
        status: true,
        revision: true,
        itemCount: true,
        customerId: true,
        draft: true,
        createdAt: true,
        updatedAt: true,
        demoMode: true,
        archivedAt: true,
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip: (q.page - 1) * q.pageSize,
      take: q.pageSize,
    }),
    db.printRequest.count({ where }),
  ]);
  const proposals = await db.requestProposal.findMany({
    where: {
      tenantId: c.tenantId,
      requestId: { in: items.map((item) => item.id) },
    },
    orderBy: { revision: "desc" },
  });
  const workflows = await db.issuanceWorkflow.findMany({
    where: {
      tenantId: c.tenantId,
      requestId: { in: items.map((item) => item.id) },
    },
    orderBy: { createdAt: "desc" },
  });
  const customerIds = [
    ...new Set(
      [
        ...items.map((item) => item.customerId),
        ...proposals
          .filter((proposal) => proposal.operation === "SAVE")
          .map(
            (proposal) =>
              (proposal.payload as { customerId?: string }).customerId,
          ),
      ].filter((id): id is string => !!id),
    ),
  ];
  const customers = await db.customerOrganization.findMany({
    where: { tenantId: c.tenantId, id: { in: customerIds } },
    select: { id: true, nameRu: true, nameKz: true },
  });
  return {
    items: items.map(({ draft: approvedPayload, ...item }) => {
      const proposal = proposals.find((entry) => entry.requestId === item.id);
      const working =
        proposal?.operation === "SAVE" &&
        ["PENDING", "REJECTED"].includes(proposal.status) &&
        item.status === "DRAFT"
          ? draftSchema.parse(proposal.payload)
          : null;
      const displayDraft = withCustomerIdentity(
        working || draftSchema.parse(approvedPayload),
      );
      const customer =
        displayDraft.kind === "COMPANY"
          ? customers.find((entry) => entry.id === displayDraft.customerId) ||
            null
          : null;
      const customerName =
        displayDraft.kind === "PERSON"
          ? personCustomerName(displayDraft) || null
          : displayDraft.organizationSnapshots?.find(
              (entry) => entry.id === displayDraft.customerId,
            )?.nameRu ||
            customer?.nameRu ||
            null;
      const displayTitle = requestDisplayTitle(
        displayDraft.title,
        customerName,
      );
      return {
        ...item,
        title: displayTitle,
        ...(working
          ? {
              kind: working.kind,
              itemCount: working.items.length,
              customerId: working.customerId,
              revision: proposal!.revision,
            }
          : {}),
        archived: !!item.archivedAt,
        customer,
        customerName,
        lifecycle:
          workflows.find((entry) => entry.requestId === item.id)?.status ||
          (item.status === "FINALIZED" ? "LEGACY_ISSUED" : null),
        approval: proposal
          ? {
              proposalId: proposal.id,
              status: proposal.status,
              needsPreparation: needsPreparation(proposal),
              proposalHash: proposal.proposalHash,
              baseRevision: proposal.baseRevision,
              submittedBy: proposal.submittedBy,
              submittedAt: proposal.submittedAt,
            }
          : null,
      };
    }),
    total,
    page: q.page,
    pageSize: q.pageSize,
  };
}
export async function requestDetail(c: Context, id: string) {
  const record = await workingRequest(c, id);
  const displayDraft = withCustomerIdentity(draftSchema.parse(record.draft));
  const [issuances, documents, jobs, artifacts] = await Promise.all([
    db.issuance.findMany({
      where: { requestId: id, tenantId: c.tenantId },
      orderBy: { createdAt: "desc" },
    }),
    db.issuedDocument.findMany({
      where: { requestId: id, tenantId: c.tenantId },
    }),
    db.generationJob.findMany({
      where: { requestId: id, tenantId: c.tenantId },
      orderBy: { createdAt: "asc" },
    }),
    db.artifact.findMany({
      where: { requestId: id, tenantId: c.tenantId },
      select: {
        id: true,
        jobId: true,
        documentId: true,
        issuanceId: true,
        format: true,
        sha256: true,
        size: true,
        mimeType: true,
        fileName: true,
        createdAt: true,
        provenance: true,
        storageKey: true,
      },
    }),
  ]);
  const events = await db.issuanceEvent.findMany({
    where: {
      tenantId: c.tenantId,
      issuanceId: { in: issuances.map((i) => i.id) },
    },
  });
  const relatedIssuanceIds = [
    ...new Set([
      ...issuances.flatMap((issuance) =>
        issuance.correctsIssuanceId ? [issuance.correctsIssuanceId] : [],
      ),
      ...events.flatMap((event) =>
        event.relatedIssuanceId ? [event.relatedIssuanceId] : [],
      ),
    ]),
  ];
  const relatedIssuances = await db.issuance.findMany({
    where: { tenantId: c.tenantId, id: { in: relatedIssuanceIds } },
    select: { id: true, requestId: true },
  });
  const relatedRequests = new Map(
    relatedIssuances.map((issuance) => [issuance.id, issuance.requestId]),
  );
  const snapshots = await db.renderInputSnapshot.findMany({
    where: { tenantId: c.tenantId, id: { in: jobs.map((j) => j.snapshotId) } },
    select: { id: true, revision: true },
  });
  const publicArtifacts = await Promise.all(
    artifacts.map(async (artifact) => {
      const { storageKey, ...value } = artifact;
      return {
        ...value,
        availability: await artifactAvailability(storageKey, artifact.size),
      };
    }),
  );
  return {
    ...record,
    ...displayDraft,
    importScaffoldId: await replaceableImportScaffoldId(
      db,
      c,
      id,
      displayDraft,
      record.approvedRevision,
    ),
    ...(displayDraft.kind === "PERSON"
      ? { customerName: personCustomerName(displayDraft) || null }
      : {}),
    lifecycle: (await signingState(c, id)).status,
    issuances: issuances.map((issuance) => ({
      ...issuance,
      correctsRequestId: issuance.correctsIssuanceId
        ? relatedRequests.get(issuance.correctsIssuanceId) || null
        : null,
    })),
    documents,
    issuedAssignments: await db.issuanceAssignment.findMany({
      where: { tenantId: c.tenantId, requestId: id },
      select: {
        rowId: true,
        assignmentId: true,
        issuanceId: true,
        createdAt: true,
      },
    }),
    jobs: jobs.map((j) => ({
      ...j,
      sourceRevision: snapshots.find((s) => s.id === j.snapshotId)?.revision,
    })),
    artifacts: publicArtifacts,
    issuanceEvents: events.map((event) => ({
      ...event,
      relatedRequestId: event.relatedIssuanceId
        ? relatedRequests.get(event.relatedIssuanceId) || null
        : null,
    })),
  };
}
async function validation(
  tx: Prisma.TransactionClient,
  c: Context,
  id: string,
  expectedRevision: number,
  assignments?: AssignmentIdentity[],
  fullWorkingDraft = false,
  proposalDraft?: Draft,
  previewTarget?: PreviewTarget,
) {
  const record = await workingRequest(c, id, tx);
  if (record.revision !== expectedRevision)
    fail(409, "REVISION_CONFLICT", "Сначала сохраните актуальную версию", {
      revision: record.revision,
    });
  const workingDraft = proposalDraft || draftSchema.parse(record.draft);
  const selectedScope =
    proposalDraft && assignments
      ? selectAssignmentScope(proposalDraft, assignments)
      : fullWorkingDraft || proposalDraft
        ? {
            draft: workingDraft,
            assignments: workingDraft.items.flatMap((item) =>
              item.assignments.map((assignment) => ({
                rowId: item.id,
                assignmentId: assignment.id,
              })),
            ),
          }
        : await selectBatch(tx, c, id, workingDraft, assignments);
  const sourceDraft = selectedScope.draft;
  const savedDraft = previewTarget
    ? previewScope(sourceDraft, previewTarget)
    : sourceDraft;
  let resolved = resolveDraft(savedDraft);
  let draft = resolved.draft;
  await checkReferences(tx, c, draft);
  const profile = await tx.issuerProfileVersion.findFirst({
    where: {
      tenantId: c.tenantId,
      ...(draft.profileVersionId ? { id: draft.profileVersionId } : {}),
    },
    orderBy: { version: "desc" },
  });
  const parsedProfile = profile ? profileSchema.parse(profile.profile) : null;
  resolved = resolveDraft(savedDraft, parsedProfile?.commonFields);
  draft = resolved.draft;
  const organizations = await organizationMap(tx, c, draft);
  const employerId = companyEmployerId(draft);
  const customer = employerId ? organizations.get(employerId) || null : null;
  // Validate exactly the fallback values that will be frozen into render inputs,
  // without rewriting the operator's saved draft or a previous issuance snapshot.
  const issues = validateDraft(
    {
      ...draft,
      items: draft.items.map((item) => ({
        ...item,
        ...employerFields(item, customer, organizations),
      })),
    },
    parsedProfile,
    previewTarget
      ? {
          assignmentIds: [
            previewTarget.kind === "ASSIGNMENT"
              ? previewTarget.assignmentId
              : previewTarget.eventId,
          ],
        }
      : {},
  );
  issues.push(...resolved.issues);
  if (hasEnglishDraftValues(draft))
    issues.push({
      code: "NEW_ISSUE_LANGUAGE_UNSUPPORTED",
      path: "languagePolicy",
      field: "languagePolicy",
      message:
        "Сохраните актуальную редакцию на русском и казахском языках и передайте её директору повторно",
    });
  if (draft.businessRuleVersion === "LIVE_V1")
    for (const [row, item] of draft.items.entries())
      for (const [column, assignment] of item.assignments.entries()) {
        if (!assignment.outcome || assignment.outcome.status === "UNKNOWN")
          issues.push(
            stableValidationIssue(draft, {
              code: "OUTCOME_UNCONFIRMED",
              path: `items.${row}.assignments.${column}.outcome`,
              rowId: item.id,
              assignmentId: assignment.id,
              eventId: assignment.eventId,
              field: "outcome",
              message:
                "Это обучение ожидает фактической сдачи. Подтвердите результат и источник или исключите его из текущей партии.",
            }),
          );
        else if (
          !assignment.outcome.source.trim() &&
          !issues.some(
            (issue) =>
              issue.code === "OUTCOME_SOURCE_REQUIRED" &&
              issue.assignmentId === assignment.id &&
              issue.rowId === item.id,
          )
        )
          issues.push(
            stableValidationIssue(draft, {
              code: "OUTCOME_SOURCE_REQUIRED",
              path: `items.${row}.assignments.${column}.outcome.source`,
              rowId: item.id,
              assignmentId: assignment.id,
              eventId: assignment.eventId,
              field: "outcome.source",
              message:
                "Укажите источник фактического результата выбранного обучения.",
            }),
          );
      }
  if (documentPlan(draft).documentCount === 0 && draft.items.length)
    issues.push({
      code: "NO_ISSUABLE_DOCUMENTS",
      path: "items",
      message: "Нет документов с подтверждённым положительным результатом",
    });
  const templates = await tx.templateVersion.findMany({
    where: { tenantId: c.tenantId },
  });
  const selected = new Map(
    templates
      .filter(
        (t) => (t.contract as Record<string, unknown>).ownerKind !== "GROUP",
      )
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
      .map((t) => [registeredTemplateKey(t), t]),
  );
  for (const item of draft.items)
    for (const assignment of item.assignments) {
      if (
        previewTarget &&
        (previewTarget.kind === "GROUP_PROTOCOL" ||
          assignment.id !== previewTarget.assignmentId)
      )
        continue;
      const template = selected.get(assignmentTemplateKey(assignment));
      if (!template || !template.approved)
        issues.push({
          code: "TEMPLATE_NOT_APPROVED",
          path: "items",
          rowId: item.id,
          message: `Подтвердите форму ${assignment.templateId} в настройках`,
        });
    }
  const groupSelected = new Map(
    templates
      .filter(
        (t) => (t.contract as Record<string, unknown>).ownerKind === "GROUP",
      )
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
      .map((t) => [registeredTemplateKey(t), t]),
  );
  const eventProfiles = new Map<
    string,
    { id: string; profile: ReturnType<typeof profileSchema.parse> }
  >();
  const eventRules = new Map<
    string,
    NonNullable<Awaited<ReturnType<typeof validatePinnedServiceRule>>["rule"]>
  >();
  for (const event of draft.events || []) {
    const row = event.profileVersionId
      ? await tx.issuerProfileVersion.findFirst({
          where: { tenantId: c.tenantId, id: event.profileVersionId },
        })
      : profile;
    if (row)
      eventProfiles.set(event.id, {
        id: row.id,
        profile: profileSchema.parse(row.profile),
      });
    if (
      row &&
      row.id !== profile?.id &&
      draft.items.some((item) =>
        item.assignments.some((assignment) => assignment.eventId === event.id),
      )
    )
      issues.push(
        ...validateDraft(
          { ...draft, items: [] },
          profileSchema.parse(row.profile),
        )
          .filter(
            (issue) =>
              issue.path === "profile" || issue.path.startsWith("profile."),
          )
          .map((issue) => ({
            ...issue,
            path: `events.${event.id}.${issue.path}`,
          })),
      );
    const members =
      previewTarget?.kind === "ASSIGNMENT"
        ? []
        : documentPlan(draft).groups.find(
            (group) => group.event.id === event.id,
          )?.members || [];
    if (!members.length) continue;
    const template = groupSelected.get(
      assignmentTemplateKey(members[0].assignment, event.protocolTemplateId),
    );
    if (!template?.approved)
      issues.push({
        code: "TEMPLATE_NOT_APPROVED",
        path: "events",
        message: `Подтвердите форму ${event.protocolTemplateId}`,
      });
    if (event.serviceRuleVersionId) {
      const binding = await validatePinnedServiceRule(
        c,
        event.serviceRuleVersionId,
        {
          templateIds: [event.protocolTemplateId],
          category: members[0]?.assignment.biotCategory,
          basisDate:
            members[0]?.assignment.protocolDate ||
            members[0]?.assignment.trainingEnd ||
            "",
        },
        tx,
      );
      if (binding.rule) eventRules.set(event.id, binding.rule);
      else issues.push(...binding.issues);
    }
    for (const member of members) {
      const protocol = eventProtocolAssignment(
        event,
        member.assignment,
        draft.businessRuleVersion === "LIVE_V1",
      );
      const memberDraft: Draft = {
        ...draft,
        items: [
          {
            ...member.item,
            ...employerFields(member.item, customer, organizations),
            assignments: [member.assignment, protocol],
          },
        ],
      };
      issues.push(
        ...validateDraft(
          memberDraft,
          row ? profileSchema.parse(row.profile) : null,
          {
            skipBusinessRules: true,
            ...(previewTarget ? { assignmentIds: [protocol.id] } : {}),
          },
        ).map((issue) => {
          const addressed = stableValidationIssue(memberDraft, issue);
          const rowIndex = draft.items.findIndex(
            (item) => item.id === addressed.recipientId,
          );
          const assignmentIndex = draft.items[rowIndex]?.assignments.findIndex(
            (assignment) => assignment.id === addressed.assignmentId,
          );
          return {
            ...addressed,
            eventId: event.id,
            path:
              addressed.assignmentId &&
              assignmentIndex !== undefined &&
              assignmentIndex >= 0
                ? `items.${rowIndex}.assignments.${assignmentIndex}${addressed.field ? `.${addressed.field}` : ""}`
                : addressed.assignmentId === protocol.id
                  ? `events.${event.id}.commonFields.${addressed.field}`
                  : addressed.path.replace(/^items\.0\./, `items.${rowIndex}.`),
          };
        }),
      );
      const pinnedRule = eventRules.get(event.id);
      if (pinnedRule) {
        issues.push(
          ...ruleApplicabilityIssues(pinnedRule, {
            templateIds: [
              member.assignment.templateId,
              event.protocolTemplateId,
            ],
            category: member.assignment.biotCategory,
            basisDate: protocol.protocolDate || protocol.trainingEnd,
          }).map((issue) => ({
            ...issue,
            path: `events.${event.id}.serviceRuleVersionId`,
            rowId: member.item.id,
          })),
        );
      }
    }
  }
  if (fullWorkingDraft) {
    const technicalRows = new Set(
      workingDraft.items
        .filter(isTechnicalBlankRecipient)
        .map((item) => item.id),
    );
    const retainedIssues = issues.filter(
      (issue) => !technicalRows.has(issue.rowId || issue.recipientId || ""),
    );
    issues.splice(0, issues.length, ...retainedIssues);
  }
  if (previewTarget) {
    const retainedIssues = issues
      .filter((issue) => previewIssueApplies(draft, previewTarget, issue))
      .map((issue) =>
        stableValidationIssue(sourceDraft, stableValidationIssue(draft, issue)),
      );
    issues.splice(0, issues.length, ...retainedIssues);
  }
  return {
    record,
    draft,
    profile,
    parsedProfile,
    selected,
    groupSelected,
    issues,
    eventProfiles,
    eventRules,
    provenance: resolved.provenance,
    organizations,
    customer,
    assignments: selectedScope.assignments,
  };
}

// Cache only successful geometry checks keyed by every visual input and immutable
// resource identity. Concurrent identical finalizations share one bounded renderer.
const layoutChecks = new Map<string, Promise<boolean>>();
let activeLayoutChecks = 0;
const waitingLayoutChecks: Array<() => void> = [];
async function boundedLayoutCheck(snapshots: unknown[]) {
  if (activeLayoutChecks >= 4) {
    if (waitingLayoutChecks.length >= 32)
      throw new Error("PRINT_PREFLIGHT_BUSY");
    await new Promise<void>((resolve) => waitingLayoutChecks.push(resolve));
  }
  activeLayoutChecks++;
  try {
    return await runRender("preflight", { snapshots }, { timeoutMs: 180_000 });
  } finally {
    activeLayoutChecks--;
    waitingLayoutChecks.shift()?.();
  }
}
/** Approval checks print data without rendering or promoting the proposed payload. */
export async function assertApprovalDataComplete(
  tx: Prisma.TransactionClient,
  c: Context,
  id: string,
  expectedRevision: number,
  assignments?: AssignmentIdentity[],
  proposalDraft?: Draft,
) {
  const checked = await validation(
    tx,
    c,
    id,
    expectedRevision,
    assignments,
    false,
    proposalDraft,
  );
  if (checked.issues.length)
    fail(
      422,
      "APPROVAL_DATA_INCOMPLETE",
      "Сначала заполните обязательные данные заявки и повторите проверку",
      checked.issues,
    );
  return {
    version: 1 as const,
    resolvedAt: new Date().toISOString(),
    draft: {
      ...checked.draft,
      profileVersionId: checked.profile?.id,
      organizationSnapshots: [...checked.organizations.values()].map(
        (organization) => ({
          id: organization.id,
          nameRu: organization.nameRu,
          nameKz: organization.nameKz,
          bin: organization.bin,
          addressRu: organization.addressRu,
          addressKz: organization.addressKz,
        }),
      ),
      items: checked.draft.items.map((item) => ({
        ...item,
        ...employerFields(item, checked.customer, checked.organizations),
      })),
    },
    provenance: checked.provenance,
  };
}

/** Read-only view of the submitted payload through the same print-data resolver. */
export async function proposalDataReview(c: Context, id: string, draft: Draft) {
  const record = await workingRequest(c, id);
  const reviewed = await validation(
    db,
    c,
    id,
    record.revision,
    undefined,
    false,
    draft,
  );
  return {
    draft: {
      ...reviewed.draft,
      items: reviewed.draft.items.map((item) => ({
        ...item,
        ...employerFields(item, reviewed.customer, reviewed.organizations),
      })),
    },
    provenance: reviewed.provenance,
    issues: reviewed.issues,
  };
}

async function prepareLayout(
  tx: Prisma.TransactionClient,
  c: Context,
  v: Awaited<ReturnType<typeof validation>>,
) {
  const [organizations, photos, sequences] = await Promise.all([
    organizationMap(tx, c, v.draft),
    photoMap(tx, c, v.draft),
    tx.numberSequence.findMany({ where: { tenantId: c.tenantId } }),
  ]);
  const employerId = companyEmployerId(v.draft);
  const customer = employerId ? organizations.get(employerId) || null : null;
  // PostgreSQL integer counters have at most ten digits. Twelve is the largest
  // supported padding; this check remains valid while concurrent counters advance.
  const numberFor = (ns: string) => {
    const sequence = sequences.find((s) => s.namespace === ns);
    return (
      (sequence?.prefix ?? ns.replace(":", "-") + "-") +
      "8".repeat(12) +
      (sequence?.suffix || "")
    );
  };
  const plans = v.draft.items.flatMap((item, row) =>
    item.assignments
      .filter(
        (a) =>
          a.templateId.endsWith("-protocol") ||
          (a.protocolMode !== "GROUP" && !a.outcome) ||
          a.outcome?.status === "PASSED",
      )
      .map((assignment) => {
        const column = item.assignments.findIndex(
          (entry) => entry.id === assignment.id,
        );
        const template = v.selected.get(assignmentTemplateKey(assignment))!;
        const linkedProtocol =
          assignment.protocolMode === "GROUP" ||
          item.assignments.some(
            (a) => a.templateId === protocolTemplateFor(assignment.templateId),
          );
        const linkedCredential = item.assignments.some(
          (a) => a.templateId === credentialTemplateFor(assignment.templateId),
        );
        const snapshot = {
          mode: "issued-document",
          demoMode: v.draft.demoMode,
          businessRuleVersion: v.draft.businessRuleVersion,
          englishAppendix: v.draft.englishAppendix || false,
          templateId: template.templateId,
          templateVersion: template.version,
          templateStorageKey: template.storageKey,
          templateChecksum: template.checksum,
          issuer:
            (assignment.eventId &&
              v.eventProfiles.get(assignment.eventId)?.profile) ||
            v.parsedProfile,
          photos: item.photoAssetId
            ? { [item.photoAssetId]: photos[item.photoAssetId] }
            : {},
          items: [
            {
              ...item,
              id: undefined,
              assignments: undefined,
              sourceRow: undefined,
              importId: undefined,
              assignment: { ...assignment, id: undefined },
              number: numberFor(namespace(assignment.templateId)),
              registrationNumber:
                assignment.templateId === "ps-witness"
                  ? numberFor("PS:REGISTRATION")
                  : "",
              protocolNumber:
                assignment.protocolMode === "EXTERNAL_REFERENCE" ||
                !linkedProtocol
                  ? assignment.externalBasisNumber
                  : numberFor(
                      assignment.templateId.split("-")[0].toUpperCase() +
                        ":PROTOCOL",
                    ),
              credentialNumber: linkedCredential
                ? numberFor(
                    namespace(credentialTemplateFor(assignment.templateId)),
                  )
                : "",
              ...employerFields(item, customer, organizations),
            },
          ],
        };
        return {
          snapshot,
          row,
          column,
          rowId: item.id,
          template,
          assignmentId: assignment.id as string | undefined,
          eventId: assignment.eventId,
        };
      }),
  );
  for (const { event, members } of documentPlan(v.draft).groups) {
    const template = v.groupSelected.get(
      assignmentTemplateKey(members[0].assignment, event.protocolTemplateId),
    )!;
    const rows = members.map(({ item, assignment }) => ({
      ...item,
      ...employerFields(item, customer, organizations),
      assignment: eventProtocolAssignment(
        event,
        assignment,
        v.draft.businessRuleVersion === "LIVE_V1",
      ),
      number: numberFor(namespace(event.protocolTemplateId)),
      credentialNumber:
        assignment.outcome?.status === "PASSED"
          ? numberFor(namespace(assignment.templateId))
          : "",
      protocolNumber: numberFor(namespace(event.protocolTemplateId)),
    }));
    plans.push({
      row: v.draft.items.findIndex((item) => item.id === members[0].item.id),
      column: 0,
      rowId: members[0].item.id,
      assignmentId: undefined,
      eventId: event.id,
      template,
      snapshot: {
        mode: "issued-document",
        demoMode: v.draft.demoMode,
        businessRuleVersion: v.draft.businessRuleVersion,
        englishAppendix: v.draft.englishAppendix || false,
        templateId: template.templateId,
        templateVersion: template.version,
        templateStorageKey: template.storageKey,
        templateChecksum: template.checksum,
        issuer: v.eventProfiles.get(event.id)?.profile || v.parsedProfile,
        photos: {},
        items: rows,
        groupHeaderWorkplace: groupHeaderWorkplace(template.templateId, rows),
        ...{
          groupEvent: {
            ...event,
            contractVersion: 1,
            serviceRule: v.eventRules.get(event.id),
          },
        },
      } as unknown as (typeof plans)[number]["snapshot"],
    });
  }
  return { plans, fingerprint: hash(plans.map((p) => p.snapshot)) };
}
async function checkLayout(
  c: Context,
  v: Awaited<ReturnType<typeof validation>>,
) {
  const prepared = await prepareLayout(db, c, v);
  const artifactStore = new ArtifactStore();
  try {
    await Promise.all(
      [
        ...new Map(
          prepared.plans.map((p) => [p.template.id, p.template]),
        ).values(),
      ].map((template) =>
        artifactStore.read(template.storageKey, template.checksum),
      ),
    );
    await Promise.all(
      [
        ...new Set(
          prepared.plans.flatMap((p) => Object.values(p.snapshot.photos)),
        ),
      ].map((key) =>
        artifactStore.read(key, key.match(/\/([a-f0-9]{64})-/)?.[1]),
      ),
    );
    const pending = new Map<string, (typeof prepared.plans)[number]>();
    const keys = prepared.plans.map((plan) => {
      const key = hash({ tenantId: c.tenantId, snapshot: plan.snapshot });
      if (!layoutChecks.has(key)) pending.set(key, plan);
      return key;
    });
    if (pending.size) {
      const entries = [...pending.entries()];
      const batch = checkLayoutBatches(
        entries.map(([, plan]) => plan.snapshot),
        boundedLayoutCheck,
      );
      for (const [index, [key]] of entries.entries()) {
        const check = batch.then((failures) => !failures.has(index));
        layoutChecks.set(key, check);
        void check.then(
          (valid) => {
            if (!valid) layoutChecks.delete(key);
          },
          () => {
            layoutChecks.delete(key);
          },
        );
      }
    }
    const results = await Promise.all(
      keys.map((key) => layoutChecks.get(key)!),
    );
    while (layoutChecks.size > 2048)
      layoutChecks.delete(layoutChecks.keys().next().value!);
    for (const [index, valid] of results.entries())
      if (!valid) {
        const plan = prepared.plans[index];
        v.issues.push(
          stableValidationIssue(v.draft, {
            code: "PRINT_LAYOUT_OVERFLOW",
            path: plan.assignmentId
              ? `items.${plan.row}.assignments.${plan.column}`
              : `events.${plan.eventId}`,
            rowId: plan.rowId,
            assignmentId: plan.assignmentId,
            eventId: plan.eventId,
            field: plan.assignmentId ? "assignments" : "events",
            message: `Строка ${plan.row + 1}: текст не помещается в выбранную форму при читаемом размере. Проверьте ФИО, должность, организацию и поля документа; исправьте данные или выберите подходящую форму.`,
          }),
        );
      }
    return prepared.fingerprint;
  } catch (error) {
    if (error instanceof Error && error.message === "PRINT_PREFLIGHT_BUSY")
      fail(
        429,
        "PRINT_PREFLIGHT_BUSY",
        "Проверка макетов занята. Повторите оформление через несколько секунд; номера не выделены",
      );
    fail(
      503,
      "PRINT_PREFLIGHT_UNAVAILABLE",
      "Проверка макета недоступна. Проверьте шаблоны, фотографии и службу печати; номера не выделены",
    );
  }
}
export async function validateRequest(c: Context, id: string, input: unknown) {
  const { expectedRevision, assignments } = parse(finalizeSchema, input);
  const v = await validation(db, c, id, expectedRevision, assignments);
  if (!v.issues.length) await checkLayout(c, v);
  return {
    valid: v.issues.length === 0,
    issues: v.issues,
    revision: expectedRevision,
    recipientCount: v.draft.items.length,
    documentCount: documentPlan(v.draft).documentCount,
    protocolCount:
      documentPlan(v.draft).groups.length +
      v.draft.items.reduce(
        (n, i) =>
          n +
          i.assignments.filter((a) => a.templateId.endsWith("-protocol"))
            .length,
        0,
      ),
    warnings: await duplicateIssuanceWarnings(c, v.draft, db, id),
    assignments: v.assignments,
  };
}
async function reserve(
  tx: Prisma.TransactionClient,
  c: Context,
  ns: string,
  documentId: string,
) {
  const counter = await tx.numberSequence.upsert({
    where: { tenantId_namespace: { tenantId: c.tenantId, namespace: ns } },
    create: {
      tenantId: c.tenantId,
      namespace: ns,
      value: 1,
      prefix: ns.replace(":", "-") + "-",
    },
    update: { value: { increment: 1 } },
  });
  const number =
    counter.prefix +
    String(counter.value).padStart(counter.padding, "0") +
    counter.suffix;
  await tx.numberReservation.create({
    data: {
      tenantId: c.tenantId,
      namespace: ns,
      sequence: counter.value,
      formattedNumber: number,
      documentId,
    },
  });
  return number;
}
async function photoMap(
  tx: Prisma.TransactionClient,
  c: Context,
  draft: Draft,
) {
  const photos = await tx.photoAsset.findMany({
    where: {
      tenantId: c.tenantId,
      id: {
        in: draft.items.flatMap((i) =>
          i.photoAssetId ? [i.photoAssetId] : [],
        ),
      },
    },
  });
  return Object.fromEntries(photos.map((p) => [p.id, p.storageKey]));
}
function issuanceResult(
  i: { id: string; requestId: string; sourceRevision: number },
  documentIds: string[],
  jobIds: string[],
) {
  return {
    issuanceId: i.id,
    requestId: i.requestId,
    revision: i.sourceRevision,
    documentIds: [...documentIds].sort(),
    jobIds: [...jobIds].sort(),
  };
}
export async function finalize(
  c: Context,
  id: string,
  input: unknown,
  key: unknown,
) {
  assertStaff(c, true);
  const data = parse(finalizeSchema, input);
  if (typeof key !== "string" || !/^[a-zA-Z0-9_-]{16,128}$/.test(key))
    fail(400, "KEY_REQUIRED", "Требуется ключ повторяемости команды");
  const payloadHash = hash({ requestId: id, ...data });
  const before = await workingRequest(c, id);
  const replay = await db.idempotencyOperation.findUnique({
    where: {
      tenantId_command_idempotencyKey: {
        tenantId: c.tenantId,
        command: "FINALIZE",
        idempotencyKey: key,
      },
    },
  });
  if (replay) {
    if (replay.payloadHash !== payloadHash)
      fail(
        409,
        "IDEMPOTENCY_MISMATCH",
        "Этот ключ уже использован с другими данными",
      );
    return replay.result;
  }
  // Explicit selections also identify a prior batch for safe different-key
  // replay. The omitted selection on an open request means remaining work.
  const defaultIssued =
    !data.assignments && before.status === "DRAFT"
      ? await db.issuanceAssignment.findMany({
          where: { tenantId: c.tenantId, requestId: id },
          select: { rowId: true, assignmentId: true },
        })
      : [];
  let replayScope: AssignmentIdentity[];
  try {
    replayScope = selectAssignmentScope(
      draftSchema.parse(before.draft),
      data.assignments,
      defaultIssued,
    ).assignments;
  } catch {
    fail(
      422,
      "ASSIGNMENT_SELECTION_INVALID",
      "Выбранные человек и курс отсутствуют в актуальной заявке",
    );
  }
  const requestedScopeHash = hash(
    approvalScopeValue(draftSchema.parse(before.draft), replayScope),
  );
  const matchingIssuance = await db.issuance.findFirst({
    where: {
      tenantId: c.tenantId,
      requestId: id,
      sourceRevision: data.expectedRevision,
      OR: [{ scopeHash: requestedScopeHash }, { scopeHash: null }],
    },
  });
  const checkedApproval =
    before.status === "DRAFT" && !matchingIssuance
      ? await requireApproved(
          c,
          id,
          data.expectedRevision,
          db,
          data.assignments,
        )
      : null;
  let layoutFingerprint: string | undefined;
  if (before.status === "DRAFT" && !matchingIssuance) {
    const checked = await validation(
      db,
      c,
      id,
      data.expectedRevision,
      (checkedApproval?.assignments as AssignmentIdentity[] | null) ||
        data.assignments,
      false,
      checkedApproval ? submittedProposalDraft(checkedApproval) : undefined,
    );
    if (!checked.issues.length)
      layoutFingerprint = await checkLayout(c, checked);
    if (checked.issues.length)
      fail(
        422,
        "FINALIZE_VALIDATION",
        "Исправьте ошибки перед оформлением",
        checked.issues,
      );
  }
  return transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${c.tenantId + ":finalize:" + key},0))`;
    const prior = await tx.idempotencyOperation.findUnique({
      where: {
        tenantId_command_idempotencyKey: {
          tenantId: c.tenantId,
          command: "FINALIZE",
          idempotencyKey: key,
        },
      },
    });
    if (prior) {
      if (prior.payloadHash !== payloadHash)
        fail(
          409,
          "IDEMPOTENCY_MISMATCH",
          "Этот ключ уже использован с другими данными",
        );
      return prior.result;
    }
    await tx.$executeRaw`SELECT id FROM "PrintRequest" WHERE id=${id} AND "tenantId"=${c.tenantId} FOR UPDATE`;
    const record = await scopedRequest(c, id, tx);
    const existing = await tx.issuance.findFirst({
      where: {
        tenantId: c.tenantId,
        requestId: id,
        sourceRevision: data.expectedRevision,
        OR: [{ scopeHash: requestedScopeHash }, { scopeHash: null }],
      },
    });
    if (existing) {
      const savedResult = await tx.idempotencyOperation.findFirst({
        where: {
          tenantId: c.tenantId,
          command: "FINALIZE",
          result: { path: ["issuanceId"], equals: existing.id },
        },
        orderBy: { createdAt: "asc" },
      });
      if (savedResult) {
        await tx.idempotencyOperation.create({
          data: {
            tenantId: c.tenantId,
            command: "FINALIZE",
            idempotencyKey: key,
            payloadHash,
            result: json(savedResult.result),
          },
        });
        return savedResult.result;
      }
      const documents = await tx.issuedDocument.findMany({
        where: { issuanceId: existing.id, tenantId: c.tenantId },
      });
      const jobs = await tx.generationJob.findMany({
        where: { issuanceId: existing.id, tenantId: c.tenantId },
      });
      const result = issuanceResult(
        existing,
        documents.map((d) => d.id),
        jobs.map((j) => j.id),
      );
      await tx.idempotencyOperation.create({
        data: {
          tenantId: c.tenantId,
          command: "FINALIZE",
          idempotencyKey: key,
          payloadHash,
          result: json(result),
        },
      });
      return result;
    }
    if (record.status !== "DRAFT")
      fail(409, "REGISTERED_IMMUTABLE", "Заявка уже оформлена");
    const approvedProposal = await requireApproved(
      c,
      id,
      data.expectedRevision,
      tx,
      data.assignments,
    );
    const v = await validation(
      tx,
      c,
      id,
      data.expectedRevision,
      (approvedProposal.assignments as AssignmentIdentity[] | null) ||
        data.assignments,
      false,
      submittedProposalDraft(approvedProposal),
    );
    if (v.issues.length || !v.profile || !v.parsedProfile)
      fail(
        422,
        "FINALIZE_VALIDATION",
        "Исправьте ошибки перед оформлением",
        v.issues,
      );
    const signingPolicy = await prepareSigningPolicy(
      tx,
      c,
      v.parsedProfile,
      [...v.eventProfiles].map(([eventId, value]) => ({
        id: eventId,
        profile: value.profile,
      })),
      v.draft.items.flatMap((item) => item.assignments),
    );
    // Director approval is sufficient to freeze a numbered print set. Keep
    // every required signer in the immutable policy, including unbound slots;
    // signingState still refuses ISSUED until real signatures are verified.
    const ns = [
      ...new Set([
        ...(v.draft.events || []).map((e) => namespace(e.protocolTemplateId)),
        ...v.draft.items.flatMap((i) =>
          i.assignments.flatMap((a) =>
            a.templateId === "ps-witness"
              ? [namespace(a.templateId), "PS:REGISTRATION"]
              : [namespace(a.templateId)],
          ),
        ),
      ]),
    ].sort();
    for (const name of ns)
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${c.tenantId + ":" + name},0))`;
    for (const organizationId of [...v.organizations.keys()].sort())
      await tx.$executeRaw`SELECT id FROM "CustomerOrganization" WHERE id=${organizationId} AND "tenantId"=${c.tenantId} FOR SHARE`;
    if (
      !layoutFingerprint ||
      (await prepareLayout(tx, c, v)).fingerprint !== layoutFingerprint
    )
      fail(
        409,
        "PRINT_INPUT_CHANGED",
        "Реквизиты, шаблон или настройки изменились во время проверки. Повторите оформление актуальной редакции",
      );
    const organizations = await organizationMap(tx, c, v.draft);
    const employerId = companyEmployerId(v.draft);
    const customer = employerId ? organizations.get(employerId) || null : null;
    const photos = await photoMap(tx, c, v.draft);
    const issued = await tx.issuance.create({
      data: {
        tenantId: c.tenantId,
        requestId: id,
        sourceRevision: data.expectedRevision,
        scopeHash: requestedScopeHash,
        snapshot: json({
          draft: v.draft,
          serviceRules: [...v.eventRules.values()],
          issuer: v.parsedProfile,
          profileVersionId: v.profile.id,
          customer,
          employers: [...organizations.values()].filter((organization) =>
            v.draft.items.some((item) => item.employerId === organization.id),
          ),
          templates: [
            ...v.selected.values(),
            ...v.groupSelected.values(),
          ].filter((t) =>
            v.draft.items.some((i) =>
              i.assignments.some((a) => a.templateId === t.templateId),
            ),
          ),
          photos,
        }),
        inputHash: hash({ draft: v.draft, issuer: v.parsedProfile, customer }),
        profileVersionId: v.profile.id,
        createdBy: c.userId,
        correctsIssuanceId: record.correctsIssuanceId,
        correctionReason: record.correctionReason,
      },
    });
    await tx.issuanceAssignment.createMany({
      data: v.assignments.map((identity) => ({
        ...identity,
        tenantId: c.tenantId,
        requestId: id,
        issuanceId: issued.id,
      })),
    });
    const documentIds: string[] = [];
    const jobIds: string[] = [];
    const allItems: unknown[] = [];
    const planned: Array<{
      item: Draft["items"][number];
      assignment: Draft["items"][number]["assignments"][number];
      template: NonNullable<ReturnType<typeof v.selected.get>>;
      documentId: string;
      number: string;
      registrationNumber: string | undefined;
    }> = [];
    for (const { item, assignment } of documentPlan(v.draft).individuals) {
      const documentId = randomUUID();
      const template = v.selected.get(assignmentTemplateKey(assignment))!;
      const number = await reserve(
        tx,
        c,
        namespace(assignment.templateId),
        documentId,
      );
      const registrationNumber =
        assignment.templateId === "ps-witness"
          ? await reserve(tx, c, "PS:REGISTRATION", documentId)
          : undefined;
      const old = record.correctsIssuanceId
        ? await tx.issuedDocument.findFirst({
            where: {
              tenantId: c.tenantId,
              issuanceId: record.correctsIssuanceId,
              rowId: item.id,
              assignmentId: assignment.id,
            },
          })
        : null;
      await tx.issuedDocument.create({
        data: {
          id: documentId,
          tenantId: c.tenantId,
          issuanceId: issued.id,
          requestId: id,
          rowId: item.id,
          assignmentId: assignment.id,
          templateVersionId: template.id,
          templateId: template.templateId,
          namespace: namespace(assignment.templateId),
          number,
          registrationNumber,
          documentDate: assignment.documentDate,
          replacesDocumentId: old?.id,
        },
      });
      documentIds.push(documentId);
      planned.push({
        item,
        assignment,
        template,
        documentId,
        number,
        registrationNumber,
      });
    }
    const groupPlans = [];
    for (const group of documentPlan(v.draft).groups) {
      const { event, members } = group;
      const documentId = randomUUID();
      const template = v.groupSelected.get(
        assignmentTemplateKey(members[0].assignment, event.protocolTemplateId),
      )!;
      const number = await reserve(
        tx,
        c,
        namespace(event.protocolTemplateId),
        documentId,
      );
      const documentDate =
        members[0].assignment.protocolDate ||
        members[0].assignment.documentDate;
      await tx.issuedDocument.create({
        data: {
          id: documentId,
          tenantId: c.tenantId,
          issuanceId: issued.id,
          requestId: id,
          ownerKind: "GROUP",
          groupEventId: event.id,
          groupEventRevision: event.revision,
          templateVersionId: template.id,
          templateId: template.templateId,
          namespace: namespace(template.templateId),
          number,
          documentDate,
        },
      });
      await tx.groupDocumentMember.createMany({
        data: members.map(({ item, assignment }, position) => ({
          tenantId: c.tenantId,
          documentId,
          requestId: id,
          rowId: item.id,
          assignmentId: assignment.id,
          recipientId: item.recipientId,
          employerId: item.employerId || companyEmployerId(v.draft),
          position,
          outcome: json(assignment.outcome!),
        })),
      });
      documentIds.push(documentId);
      groupPlans.push({ ...group, documentId, template, number });
    }
    // Allocate the complete document plan first: a card may precede its linked
    // individual protocol in the operator's selection order.
    for (const plannedItem of planned) {
      const {
        item,
        assignment,
        template,
        documentId,
        number,
        registrationNumber,
      } = plannedItem;
      const linkedProtocol =
        assignment.protocolMode === "GROUP"
          ? groupPlans.find((g) => g.event.id === assignment.eventId)
          : assignment.protocolMode === "EXTERNAL_REFERENCE"
            ? undefined
            : planned.find(
                (p) =>
                  p.item.id === item.id &&
                  (v.draft.businessRuleVersion !== "LIVE_V1" ||
                    p.assignment.eventId === assignment.eventId) &&
                  p.assignment.templateId ===
                    protocolTemplateFor(assignment.templateId),
              );
      const linkedCredential = planned.find(
        (p) =>
          p.item.id === item.id &&
          (v.draft.businessRuleVersion !== "LIVE_V1" ||
            p.assignment.eventId === assignment.eventId) &&
          p.assignment.templateId ===
            credentialTemplateFor(assignment.templateId),
      );
      const renderedItem = {
        ...item,
        assignments: undefined,
        assignment,
        number,
        registrationNumber,
        protocolNumber:
          linkedProtocol?.number || assignment.externalBasisNumber,
        linkedProtocolDocumentId: linkedProtocol?.documentId,
        credentialNumber: linkedCredential?.number || "",
        linkedCredentialDocumentId: linkedCredential?.documentId,
        documentId,
        ...employerFields(item, customer, organizations),
      };
      allItems.push(renderedItem);
      const renderInput = {
        mode: "issued-document",
        demoMode: v.draft.demoMode,
        businessRuleVersion: v.draft.businessRuleVersion,
        englishAppendix: v.draft.englishAppendix || false,
        templateId: template.templateId,
        templateVersion: template.version,
        templateStorageKey: template.storageKey,
        templateChecksum: template.checksum,
        issuer:
          (assignment.eventId &&
            v.eventProfiles.get(assignment.eventId)?.profile) ||
          v.parsedProfile,
        items: [renderedItem],
        photos,
      };
      const snapshot = await tx.renderInputSnapshot.create({
        data: {
          tenantId: c.tenantId,
          requestId: id,
          revision: data.expectedRevision,
          issuanceId: issued.id,
          templateVersionId: template.id,
          profileVersionId: v.profile.id,
          input: json(renderInput),
          inputHash: hash(renderInput),
        },
      });
      for (const kind of ["DOCX", "PDF"]) {
        const job = await tx.generationJob.create({
          data: {
            tenantId: c.tenantId,
            requestId: id,
            issuanceId: issued.id,
            documentId,
            snapshotId: snapshot.id,
            kind,
            logicalKey: `${documentId}:${kind}`,
          },
        });
        jobIds.push(job.id);
      }
    }
    for (const group of groupPlans) {
      const { event, members, documentId, template, number } = group;
      const items = members.map(({ item, assignment }) => {
        const credential = planned.find(
          (p) => p.item.id === item.id && p.assignment.id === assignment.id,
        );
        return {
          ...item,
          ...employerFields(item, customer, organizations),
          assignments: undefined,
          assignment: eventProtocolAssignment(
            event,
            assignment,
            v.draft.businessRuleVersion === "LIVE_V1",
          ),
          number,
          documentId,
          protocolNumber: number,
          credentialNumber: credential?.number || "",
          linkedCredentialDocumentId: credential?.documentId,
        };
      });
      const renderInput = {
        mode: "issued-document",
        schemaVersion: 2,
        businessRuleVersion: v.draft.businessRuleVersion,
        englishAppendix: v.draft.englishAppendix || false,
        groupEvent: {
          ...event,
          contractVersion: 1,
          serviceRule: v.eventRules.get(event.id),
        },
        demoMode: v.draft.demoMode,
        templateId: template.templateId,
        templateVersion: template.version,
        templateStorageKey: template.storageKey,
        templateChecksum: template.checksum,
        issuer: v.eventProfiles.get(event.id)?.profile || v.parsedProfile,
        items,
        photos: {},
        groupHeaderWorkplace: groupHeaderWorkplace(template.templateId, items),
      };
      const snapshot = await tx.renderInputSnapshot.create({
        data: {
          tenantId: c.tenantId,
          requestId: id,
          revision: data.expectedRevision,
          issuanceId: issued.id,
          templateVersionId: template.id,
          profileVersionId: v.eventProfiles.get(event.id)?.id || v.profile.id,
          input: json(renderInput),
          inputHash: hash(renderInput),
        },
      });
      for (const kind of ["DOCX", "PDF"]) {
        const job = await tx.generationJob.create({
          data: {
            tenantId: c.tenantId,
            requestId: id,
            issuanceId: issued.id,
            documentId,
            snapshotId: snapshot.id,
            kind,
            logicalKey: `${documentId}:${kind}`,
          },
        });
        jobIds.push(job.id);
      }
      allItems.push({
        documentId,
        number,
        groupEventId: event.id,
        assignment: {
          templateId: template.templateId,
          documentDate:
            members[0].assignment.protocolDate ||
            members[0].assignment.documentDate,
          trainingSubject: members[0].assignment.trainingSubject,
        },
        memberCount: members.length,
      });
    }
    const aggregate = {
      mode: "issued-document",
      demoMode: v.draft.demoMode,
      businessRuleVersion: v.draft.businessRuleVersion,
      englishAppendix: v.draft.englishAppendix || false,
      issuer: v.parsedProfile,
      items: allItems,
      photos,
      issuanceId: issued.id,
      documentIds,
    };
    const aggregateSnapshot = await tx.renderInputSnapshot.create({
      data: {
        tenantId: c.tenantId,
        requestId: id,
        revision: data.expectedRevision,
        issuanceId: issued.id,
        profileVersionId: v.profile.id,
        input: json(aggregate),
        inputHash: hash(aggregate),
      },
    });
    for (const kind of ["XLSX", "ZIP"]) {
      const job = await tx.generationJob.create({
        data: {
          tenantId: c.tenantId,
          requestId: id,
          issuanceId: issued.id,
          snapshotId: aggregateSnapshot.id,
          kind,
          logicalKey: `${issued.id}:${kind}`,
        },
      });
      jobIds.push(job.id);
    }
    const allIssued = await tx.issuanceAssignment.findMany({
      where: { tenantId: c.tenantId, requestId: id },
      select: { rowId: true, assignmentId: true },
    });
    const issuedKeys = new Set(allIssued.map(assignmentIdentityKey));
    const remaining = draftSchema
      .parse(record.draft)
      .items.filter((item) => !isTechnicalBlankRecipient(item))
      .flatMap((item) =>
        item.assignments.filter(
          (assignment) =>
            !issuedKeys.has(
              assignmentIdentityKey({
                rowId: item.id,
                assignmentId: assignment.id,
              }),
            ),
        ),
      );
    const requestStatus = remaining.length ? "DRAFT" : "FINALIZED";
    await tx.printRequest.update({
      where: { id },
      data: {
        status: requestStatus,
        searchText:
          record.searchText +
          " " +
          allItems
            .map((x) => {
              const row = x as { number: string; registrationNumber?: string };
              return row.number + " " + (row.registrationNumber || "");
            })
            .join(" ") +
          " " +
          (customer?.nameRu || "") +
          " " +
          (customer?.nameKz || ""),
      },
    });
    await tx.issuanceWorkflow.create({
      data: {
        tenantId: c.tenantId,
        requestId: id,
        issuanceId: issued.id,
        proposalId: approvedProposal.id,
        requiredSigners: json(signingPolicy),
      },
    });
    await audit(tx, c, "ISSUANCE_REGISTERED", issued.id, {
      requestId: id,
      revision: data.expectedRevision,
      documents: documentIds.length,
    });
    const result = {
      ...issuanceResult(issued, documentIds, jobIds),
      lifecycle: "RENDERING",
      archived: false,
      assignments: v.assignments,
      requestStatus,
      remainingAssignmentCount: remaining.length,
    };
    await tx.idempotencyOperation.create({
      data: {
        tenantId: c.tenantId,
        command: "FINALIZE",
        idempotencyKey: key,
        payloadHash,
        result: json(result),
      },
    });
    return result;
  });
}
export async function preview(c: Context, id: string, input: unknown) {
  const data = parse(previewSchema, input);
  return transaction(async (tx) => {
    // Serialize enqueueing with edits and archive decisions on this request.
    await tx.$executeRaw`SELECT id FROM "PrintRequest" WHERE id=${id} AND "tenantId"=${c.tenantId} FOR UPDATE`;
    const record = await scopedRequest(c, id, tx);
    if (record.archivedAt)
      fail(
        409,
        "REQUEST_ARCHIVED",
        "Архивная заявка доступна только для просмотра сохранённых документов",
      );
    const proposal = data.proposalId
      ? await tx.requestProposal.findFirst({
          where: {
            id: data.proposalId,
            requestId: id,
            tenantId: c.tenantId,
            operation: "SAVE",
            status: { not: "DRAFT" },
          },
        })
      : null;
    if (
      data.proposalId &&
      (!proposal ||
        proposal.proposalHash !== data.expectedProposalHash ||
        (data.target && proposal.revision !== data.expectedRevision))
    )
      fail(409, "APPROVAL_STALE", "Сначала обновите переданную редакцию");
    if (
      proposal &&
      data.target?.kind === "ASSIGNMENT" &&
      proposal.assignments &&
      !(proposal.assignments as AssignmentIdentity[]).some(
        (identity) =>
          assignmentIdentityKey(identity) ===
          assignmentIdentityKey(data.target as AssignmentIdentity),
      )
    )
      fail(
        404,
        "PREVIEW_TARGET_NOT_FOUND",
        "Документ не входит в переданную редакцию",
      );
    const expectedRevision = proposal?.revision ?? data.expectedRevision;
    const v = await validation(
      tx,
      c,
      id,
      proposal ? (await workingRequest(c, id, tx)).revision : expectedRevision,
      proposal?.assignments
        ? (proposal.assignments as AssignmentIdentity[])
        : undefined,
      !proposal,
      proposal ? submittedProposalDraft(proposal) : undefined,
      data.target,
    );
    const previewKey = proposal
      ? `approval-preview:${proposal.id}:${proposal.proposalHash}`
      : `preview:${id}:${expectedRevision}`;
    if (!v.profile || !v.parsedProfile)
      fail(422, "ISSUER_REQUIRED", "Сохраните профиль центра");
    const previewIssues = data.target
      ? v.issues
      : v.issues.filter((issue) =>
          [
            "BIOT_ECS_REQUIRED",
            "BIOT_CATEGORY_TEMPLATE",
            "BIOT_CATEGORY_REQUIRED",
            "BIOT_UNIQUE_NUMBER_CONFLICT",
            "BIOT_CREDENTIAL_AMBIGUOUS",
            "DATE_INVALID",
            "DATE_ORDER",
            "TRAINING_BEFORE_DOCUMENT",
            "NEW_ISSUE_LANGUAGE_UNSUPPORTED",
          ].includes(issue.code),
        );
    if (previewIssues.length)
      fail(
        422,
        "PREVIEW_VALIDATION",
        "Исправьте ошибки полей перед просмотром документов",
        previewIssues,
      );
    const photos = await photoMap(tx, c, v.draft);
    const organizations = await organizationMap(tx, c, v.draft);
    const employerId = companyEmployerId(v.draft);
    const customer = employerId ? organizations.get(employerId) || null : null;
    const jobs = [];
    const samples =
      proposal && !data.target ? approvalPreviewSamples(v.draft) : null;
    const sampleKeys = samples
      ? new Set(samples.map(assignmentIdentityKey))
      : null;
    for (const item of v.draft.items)
      for (const assignment of item.assignments) {
        if (
          data.target &&
          (data.target.kind !== "ASSIGNMENT" ||
            data.target.rowId !== item.id ||
            data.target.assignmentId !== assignment.id)
        )
          continue;
        if (
          sampleKeys &&
          !sampleKeys.has(
            assignmentIdentityKey({
              rowId: item.id,
              assignmentId: assignment.id,
            }),
          )
        )
          continue;
        const template = v.selected.get(assignmentTemplateKey(assignment));
        if (!template) fail(422, "TEMPLATE_REQUIRED", "Шаблон отсутствует");
        const issuer = (assignment.eventId &&
          v.eventProfiles.get(assignment.eventId)) || {
          id: v.profile.id,
          profile: v.parsedProfile,
        };
        const renderInput = {
          mode: "draft-preview",
          demoMode: true,
          businessRuleVersion: v.draft.businessRuleVersion,
          englishAppendix: v.draft.englishAppendix || false,
          templateId: template.templateId,
          templateVersion: template.version,
          templateStorageKey: template.storageKey,
          templateChecksum: template.checksum,
          issuer: issuer.profile,
          items: [
            {
              ...item,
              assignments: undefined,
              assignment,
              number: "ПРЕДПРОСМОТР",
              credentialNumber: item.assignments.some(
                (candidate) =>
                  candidate.templateId ===
                  credentialTemplateFor(assignment.templateId),
              )
                ? "ПРЕДПРОСМОТР"
                : "",
              ...employerFields(item, customer, organizations),
            },
          ],
          photos:
            item.photoAssetId && photos[item.photoAssetId]
              ? { [item.photoAssetId]: photos[item.photoAssetId] }
              : {},
        };
        const logicalKey = `${previewKey}:${issuer.id}:${template.id}:${item.id}:${assignment.id}:${hash(renderInput)}`;
        let previous = await tx.generationJob.findMany({
          where: {
            logicalKey: { startsWith: logicalKey + ":" },
            tenantId: c.tenantId,
            requestId: id,
          },
        });
        if (data.target)
          previous = await recoverPreviewArtifacts(tx, c, previous);
        jobs.push(...previous);
        const missingKinds = ["DOCX", "PDF"].filter(
          (kind) => !previous.some((job) => job.kind === kind),
        );
        if (!missingKinds.length) continue;
        const snapshot = previous.length
          ? { id: previous[0].snapshotId }
          : await tx.renderInputSnapshot.create({
              data: {
                tenantId: c.tenantId,
                requestId: id,
                revision: expectedRevision,
                templateVersionId: template.id,
                profileVersionId: issuer.id,
                input: json(renderInput),
                inputHash: hash(renderInput),
              },
            });
        for (const kind of missingKinds)
          jobs.push(
            await tx.generationJob.create({
              data: {
                tenantId: c.tenantId,
                requestId: id,
                snapshotId: snapshot.id,
                kind,
                logicalKey: `${logicalKey}:${kind}`,
              },
            }),
          );
      }
    for (const { event, members } of documentPlan(v.draft).groups) {
      if (
        data.target &&
        (data.target.kind !== "GROUP_PROTOCOL" ||
          data.target.eventId !== event.id)
      )
        continue;
      const template = v.groupSelected.get(
        assignmentTemplateKey(members[0].assignment, event.protocolTemplateId),
      );
      if (!template)
        fail(422, "TEMPLATE_REQUIRED", "Групповой шаблон отсутствует");
      const items = members.map(({ item, assignment }) => ({
        ...item,
        assignments: undefined,
        ...employerFields(item, customer, organizations),
        assignment: eventProtocolAssignment(
          event,
          assignment,
          v.draft.businessRuleVersion === "LIVE_V1",
        ),
        number: "ПРЕДПРОСМОТР",
        credentialNumber: "",
        protocolNumber: "",
      }));
      const renderInput = {
        mode: "draft-preview",
        demoMode: true,
        businessRuleVersion: v.draft.businessRuleVersion,
        englishAppendix: v.draft.englishAppendix || false,
        groupEvent: {
          ...event,
          contractVersion: 1,
          serviceRule: v.eventRules.get(event.id),
        },
        templateId: template.templateId,
        templateVersion: template.version,
        templateStorageKey: template.storageKey,
        templateChecksum: template.checksum,
        issuer: v.eventProfiles.get(event.id)?.profile || v.parsedProfile,
        photos: {},
        items,
        groupHeaderWorkplace: groupHeaderWorkplace(template.templateId, items),
      };
      const logicalKey = `${previewKey}:${v.eventProfiles.get(event.id)?.id || v.profile.id}:${template.id}:group:${event.id}:${hash(renderInput)}`;
      let existing = await tx.generationJob.findMany({
        where: {
          tenantId: c.tenantId,
          requestId: id,
          logicalKey: { startsWith: logicalKey + ":" },
        },
      });
      if (data.target)
        existing = await recoverPreviewArtifacts(tx, c, existing);
      jobs.push(...existing);
      const missingKinds = ["DOCX", "PDF"].filter(
        (kind) => !existing.some((job) => job.kind === kind),
      );
      if (!missingKinds.length) continue;
      const snapshot = existing.length
        ? { id: existing[0].snapshotId }
        : await tx.renderInputSnapshot.create({
            data: {
              tenantId: c.tenantId,
              requestId: id,
              revision: expectedRevision,
              templateVersionId: template.id,
              profileVersionId:
                v.eventProfiles.get(event.id)?.id || v.profile.id,
              input: json(renderInput),
              inputHash: hash(renderInput),
            },
          });
      for (const kind of missingKinds)
        jobs.push(
          await tx.generationJob.create({
            data: {
              tenantId: c.tenantId,
              requestId: id,
              snapshotId: snapshot.id,
              kind,
              logicalKey: `${logicalKey}:${kind}`,
            },
          }),
        );
    }
    await audit(tx, c, "PREVIEW_QUEUED", id, {
      revision: expectedRevision,
      jobs: jobs.length,
      ...(data.target ? { target: data.target } : {}),
      ...(proposal
        ? { proposalId: proposal.id, proposalHash: proposal.proposalHash }
        : {}),
    });
    return {
      jobs,
      revision: expectedRevision,
      ...(data.target ? { target: data.target } : {}),
      ...(proposal
        ? {
            proposalId: proposal.id,
            proposalHash: proposal.proposalHash,
            samples,
          }
        : {}),
    };
  });
}
export async function retake(c: Context, id: string, input: unknown) {
  const data = parse(
    z
      .object({
        expectedRevision: z.number().int().nonnegative(),
        rowId: z.string().min(1).max(80),
        assignmentId: z.string().min(1).max(80),
        reason: z.string().trim().min(3).max(1000),
      })
      .strict(),
    input,
  );
  return transaction(async (tx) => {
    const original = await scopedRequest(c, id, tx);
    if (original.revision !== data.expectedRevision)
      fail(409, "REVISION_CONFLICT", "Редакция изменилась");
    const ownership = await tx.issuanceAssignment.findFirst({
      where: {
        tenantId: c.tenantId,
        requestId: id,
        rowId: data.rowId,
        assignmentId: data.assignmentId,
      },
    });
    if (
      (original.status === "DRAFT" && !ownership) ||
      original.status === "CANCELLED"
    )
      fail(409, "RETAKE_HISTORY_REQUIRED", "Сначала оформите исходную попытку");
    const issuance = await tx.issuance.findFirst({
      where: {
        tenantId: c.tenantId,
        requestId: id,
        ...(ownership ? { id: ownership.issuanceId } : {}),
      },
      orderBy: { createdAt: "desc" },
    });
    if (!issuance)
      fail(409, "RETAKE_HISTORY_REQUIRED", "Сначала оформите исходную попытку");
    const source = draftSchema.parse(
      (issuance.snapshot as { draft: unknown }).draft,
    );
    const row = source.items.find((i) => i.id === data.rowId);
    const old = row?.assignments.find((a) => a.id === data.assignmentId);
    if (
      !row ||
      !old ||
      !["FAILED", "ABSENT"].includes(old.outcome?.status || "")
    )
      fail(
        409,
        "RETAKE_OUTCOME_REQUIRED",
        "Пересдача доступна после неуспешной проверки или неявки",
      );
    const sourceEvent = source.events?.find((e) => e.id === old.eventId);
    const assignment = resetRetakeAttempt(old);
    assignment.id = randomUUID();
    assignment.retakeOf = {
      requestId: id,
      rowId: row.id,
      assignmentId: old.id,
      reason: data.reason,
    };
    const event = sourceEvent ? resetRetakeEvent(sourceEvent) : undefined;
    if (event) {
      event.id = randomUUID();
      event.revision = 0;
      event.title = `Пересдача: ${event.title}`.slice(0, 255);
      assignment.eventId = event.id;
      if (assignment.biotCheckType)
        event.commonFields.biotCheckType = assignment.biotCheckType;
    }
    const draft = draftSchema.parse({
      kind: source.kind,
      title: `Пересдача: ${source.title || row.fullNameRu}`.slice(0, 255),
      customerId: source.customerId,
      demoMode: source.demoMode,
      schemaVersion: 2,
      commonFields: {
        documentDate: "",
        protocolDate: "",
        trainingStart: "",
        trainingEnd: "",
        validUntil: "",
        externalBasisNumber: "",
        // A retake starts a new attempt. Explicit clearing prevents centre
        // defaults from silently restoring dates or a basis from any attempt.
        fieldOrigins: {
          documentDate: "CLEARED",
          protocolDate: "CLEARED",
          trainingStart: "CLEARED",
          trainingEnd: "CLEARED",
          validUntil: "CLEARED",
          externalBasisNumber: "CLEARED",
        },
      },
      profileVersionId: source.profileVersionId,
      events: event ? [event] : [],
      items: [{ ...row, id: randomUUID(), assignments: [assignment] }],
    });
    await checkReferences(tx, c, draft);
    const created = await createProposedContainer(tx, c, draft);
    await audit(tx, c, "RETAKE_DRAFT_CREATED", created.id, {
      sourceRequestId: id,
      sourceRowId: row.id,
      sourceAssignmentId: old.id,
      reason: data.reason,
    });
    return created;
  });
}

export async function correction(c: Context, id: string, input: unknown) {
  assertStaff(c, true);
  const data = parse(
    z
      .object({
        reason: z.string().trim().min(3).max(1000),
        expectedRevision: z.number().int(),
        issuanceId: z.string().min(1).max(80).optional(),
      })
      .strict(),
    input,
  );
  return transaction(async (tx) => {
    const record = await scopedRequest(c, id, tx);
    if (record.revision !== data.expectedRevision)
      fail(409, "REVISION_CONFLICT", "Редакция изменилась");
    const issued = await tx.issuance.findFirst({
      where: {
        tenantId: c.tenantId,
        requestId: id,
        ...(data.issuanceId ? { id: data.issuanceId } : {}),
      },
      orderBy: { createdAt: "desc" },
    });
    if (!issued)
      fail(409, "NOT_REGISTERED", "Сначала оформите исходную заявку");
    // Correct exactly one frozen batch, including its actual roster and grounds.
    const draft = draftSchema.parse(
      (issued.snapshot as { draft: unknown }).draft,
    );
    const eventIds = new Map(
      (draft.events || []).map((e) => [e.id, randomUUID()]),
    );
    draft.events = draft.events?.map((e) => ({
      ...e,
      id: eventIds.get(e.id)!,
      revision: 0,
    }));
    for (const item of draft.items)
      for (const assignment of item.assignments)
        if (assignment.eventId)
          assignment.eventId =
            eventIds.get(assignment.eventId) || assignment.eventId;
    const next = await createProposedContainer(
      tx,
      c,
      { ...draft, title: `Исправление: ${draft.title}` },
      { correctsIssuanceId: issued.id, correctionReason: data.reason },
    );
    await audit(tx, c, "CORRECTION_DRAFT_CREATED", next.id, {
      correctsIssuanceId: issued.id,
    });
    return next;
  });
}
export async function cancelRequest(c: Context, id: string, input: unknown) {
  assertStaff(c, true);
  const data = parse(
    z
      .object({
        reason: z.string().trim().min(3).max(1000),
        expectedRevision: z.number().int(),
      })
      .strict(),
    input,
  );
  return transaction(async (tx) => {
    await tx.$executeRaw`SELECT id FROM "PrintRequest" WHERE id=${id} AND "tenantId"=${c.tenantId} FOR UPDATE`;
    const record = await workingRequest(c, id, tx);
    if (record.revision !== data.expectedRevision)
      fail(409, "REVISION_CONFLICT", "Редакция изменилась");
    if (record.status === "CANCELLED") return { ok: true };
    const issued = await tx.issuance.findFirst({
      where: { tenantId: c.tenantId, requestId: id },
      orderBy: { createdAt: "desc" },
    });
    if (!issued)
      fail(409, "NOT_REGISTERED", "Отмена применяется к оформленному выпуску");
    return submitProposal(
      tx,
      c,
      id,
      draftSchema.parse(record.draft),
      data.expectedRevision,
      "CANCEL",
      data.reason,
    );
  });
}
export async function deleteDraft(c: Context, id: string) {
  assertStaff(c, true);
  return transaction(async (tx) => {
    await tx.$executeRaw`SELECT id FROM "PrintRequest" WHERE id=${id} AND "tenantId"=${c.tenantId} FOR UPDATE`;
    const record = await workingRequest(c, id, tx);
    if (
      record.status !== "DRAFT" ||
      (await tx.issuance.count({
        where: { requestId: id, tenantId: c.tenantId },
      }))
    )
      fail(
        409,
        "REGISTERED_IMMUTABLE",
        "Зарегистрированную заявку удалить нельзя",
      );
    return submitProposal(
      tx,
      c,
      id,
      draftSchema.parse(record.draft),
      record.revision,
      "ARCHIVE",
      "Архивирование черновика",
    );
  });
}

export async function resolvedRequest(c: Context, id: string) {
  const record = await workingRequest(c, id);
  const v = await validation(db, c, id, record.revision, undefined, true);
  return {
    draft: {
      ...v.draft,
      items: v.draft.items.map((item) => ({
        ...item,
        ...employerFields(item, v.customer, v.organizations),
      })),
    },
    provenance: v.provenance,
    issues: v.issues,
  };
}
