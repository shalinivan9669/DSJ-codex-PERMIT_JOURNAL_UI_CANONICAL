import { randomUUID } from "node:crypto";
import {
  draftSchema,
  patchSchema,
  finalizeSchema,
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
import {
  validatePinnedServiceRule,
  ruleApplicabilityIssues,
} from "./service-rule-applicability";
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
async function organizationMap(
  tx: Prisma.TransactionClient,
  c: Context,
  draft: Draft,
) {
  const ids = [...new Set([
    ...(draft.customerId ? [draft.customerId] : []),
    ...draft.items.flatMap((item) => item.employerId ? [item.employerId] : []),
  ])];
  const organizations = ids.length ? await tx.customerOrganization.findMany({
    where: { tenantId: c.tenantId, id: { in: ids } },
    orderBy: { id: "asc" },
  }) : [];
  return new Map(organizations.map((organization) => [organization.id, organization]));
}
function employerFields(
  item: Draft["items"][number],
  customer: OrganizationPrintFields | null,
  organizations: ReadonlyMap<string, OrganizationPrintFields>,
) {
  // Explicit imported/manual text stays intact. A separately linked employer
  // supplies missing fields; the ordering customer is not that employer.
  const employer = item.employerId ? organizations.get(item.employerId) : customer;
  return {
    workplaceRu: item.workplaceRu || employer?.nameRu || "",
    workplaceKz: item.workplaceKz || employer?.nameKz || "",
    employerBin: item.employerBin || employer?.bin || "",
    employerAddressRu: item.employerAddressRu || employer?.addressRu || "",
    employerAddressKz: item.employerAddressKz || employer?.addressKz || "",
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
      if (previous.status === "DRAFT" || previous.status === "CANCELLED")
        fail(
          409,
          "RETAKE_HISTORY_REQUIRED",
          "Пересдача требует сохранённую действующую историю попытки",
        );
      const previousIssuance = await tx.issuance.findFirst({
        where: { tenantId: c.tenantId, requestId: previous.id },
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
    if (
      existing &&
      hash(existing.data) !== hash(event) &&
      (await tx.issuedDocument.count({
        where: { tenantId: c.tenantId, groupEventId: event.id },
      }))
    )
      fail(
        409,
        "EVENT_IMMUTABLE",
        "Оформленное событие изменяется только отдельным исправлением",
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
export async function createRequest(c: Context, input: unknown) {
  const draft = parse(draftSchema, input);
  const tenant = await db.tenant.findUniqueOrThrow({ where: { id: c.tenantId } });
  // Creation only: reopening/saving a draft never advances its calendar date.
  // An explicit blank is an intentional exception, not a request for a default.
  if (draft.schemaVersion === 2 && draft.commonFields?.documentDate === undefined)
    draft.commonFields = { ...draft.commonFields, documentDate: today(tenant.timezone) };
  for (const item of draft.items)
    for (const assignment of item.assignments)
      if (assignment.outcome)
        assignment.outcome = {
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
  return transaction(async (tx) => {
    await checkReferences(tx, c, draft);
    const record = await tx.printRequest.create({
      data: {
        tenantId: c.tenantId,
        kind: draft.kind,
        title: draft.title,
        customerId: draft.customerId,
        demoMode: draft.demoMode,
        draft: json(draft),
        itemCount: draft.items.length,
        searchText: searchable(draft),
        createdBy: c.userId,
      },
    });
    await persistItems(tx, c, record.id, draft);
    await audit(tx, c, "DRAFT_CREATED", record.id);
    return { ...record, ...draft };
  });
}
export async function patchRequest(c: Context, id: string, input: unknown) {
  const { expectedRevision, draft } = parse(patchSchema, input);
  if (
    (await db.tenant.findUniqueOrThrow({ where: { id: c.tenantId } })).demoOnly
  )
    draft.demoMode = true;
  return transaction(async (tx) => {
    await tx.$executeRaw`SELECT id FROM "PrintRequest" WHERE id=${id} AND "tenantId"=${c.tenantId} FOR UPDATE`;
    const record = await scopedRequest(c, id, tx);
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
    for (const item of draft.items)
      for (const assignment of item.assignments) {
        if (!assignment.outcome) continue;
        const old = draftSchema
          .parse(record.draft)
          .items.find((i) => i.id === item.id)
          ?.assignments.find((a) => a.id === assignment.id);
        assignment.outcome =
          old?.outcome &&
          old.outcome.status === assignment.outcome.status &&
          old.outcome.source === assignment.outcome.source &&
          old.result === assignment.result
            ? old.outcome
            : {
                ...assignment.outcome,
                confirmedBy: c.userId,
                confirmedAt: new Date().toISOString(),
              };
      }
    await checkReferences(tx, c, draft);
    const updated = await tx.printRequest.updateMany({
      where: {
        id,
        tenantId: c.tenantId,
        revision: expectedRevision,
        status: "DRAFT",
      },
      data: {
        draft: json(draft),
        kind: draft.kind,
        title: draft.title,
        customerId: draft.customerId,
        demoMode: draft.demoMode,
        itemCount: draft.items.length,
        searchText: searchable(draft),
        revision: { increment: 1 },
      },
    });
    if (updated.count !== 1) fail(409, "REVISION_CONFLICT", "Обновите заявку");
    await persistItems(tx, c, id, draft);
    await audit(tx, c, "DRAFT_SAVED", id, { revision: expectedRevision + 1 });
    return { id, status: "DRAFT", revision: expectedRevision + 1, ...draft };
  });
}
export async function requestFilter(
  c: Context,
  q: {
    search?: string;
    status?: string;
    kind?: string;
    customerId?: string;
    history?: boolean;
  },
): Promise<Prisma.PrintRequestWhereInput> {
  return {
    tenantId: c.tenantId,
    status:
      q.status || (q.history ? { in: ["FINALIZED", "CANCELLED"] } : undefined),
    kind: q.kind,
    customerId: q.customerId,
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
        createdAt: true,
        updatedAt: true,
        demoMode: true,
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip: (q.page - 1) * q.pageSize,
      take: q.pageSize,
    }),
    db.printRequest.count({ where }),
  ]);
  return { items, total, page: q.page, pageSize: q.pageSize };
}
export async function requestDetail(c: Context, id: string) {
  const record = await scopedRequest(c, id);
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
    ...(record.draft as object),
    issuances: issuances.map((issuance) => ({
      ...issuance,
      correctsRequestId: issuance.correctsIssuanceId
        ? relatedRequests.get(issuance.correctsIssuanceId) || null
        : null,
    })),
    documents,
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
) {
  const record = await scopedRequest(c, id, tx);
  if (record.revision !== expectedRevision)
    fail(409, "REVISION_CONFLICT", "Сначала сохраните актуальную версию", {
      revision: record.revision,
    });
  const savedDraft = draftSchema.parse(record.draft);
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
  const customer = draft.customerId ? organizations.get(draft.customerId) || null : null;
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
  );
  issues.push(...resolved.issues);
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
      .map((t) => [t.templateId, t]),
  );
  for (const item of draft.items)
    for (const assignment of item.assignments) {
      const template = selected.get(assignment.templateId);
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
      .map((t) => [t.templateId, t]),
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
    const template = groupSelected.get(event.protocolTemplateId);
    if (!template?.approved)
      issues.push({
        code: "TEMPLATE_NOT_APPROVED",
        path: "events",
        message: `Подтвердите форму ${event.protocolTemplateId}`,
      });
    const members = draft.items.flatMap((item) =>
      item.assignments
        .filter((a) => a.protocolMode === "GROUP" && a.eventId === event.id)
        .map((assignment) => ({ item, assignment })),
    );
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
      const protocol = eventProtocolAssignment(event, member.assignment);
      issues.push(
        ...validateDraft(
          {
            ...draft,
            items: [
              {
                ...member.item,
                ...employerFields(member.item, customer, organizations),
                assignments: [member.assignment, protocol],
              },
            ],
          },
          row ? profileSchema.parse(row.profile) : null,
        ),
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
  const customer = v.draft.customerId ? organizations.get(v.draft.customerId) || null : null;
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
        (a) => a.protocolMode !== "GROUP" || a.outcome?.status === "PASSED",
      )
      .map((assignment, column) => {
        const template = v.selected.get(assignment.templateId)!;
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
        return { snapshot, row, column, rowId: item.id, template };
      }),
  );
  for (const { event, members } of documentPlan(v.draft).groups) {
    const template = v.groupSelected.get(event.protocolTemplateId)!;
    const rows = members.map(({ item, assignment }) => ({
      ...item,
      ...employerFields(item, customer, organizations),
      assignment: eventProtocolAssignment(event, assignment),
      number: numberFor(namespace(event.protocolTemplateId)),
      credentialNumber:
        assignment.outcome?.status === "PASSED"
          ? numberFor(namespace(assignment.templateId))
          : "",
      protocolNumber: numberFor(namespace(event.protocolTemplateId)),
    }));
    plans.push({
      row: 0,
      column: 0,
      rowId: members[0].item.id,
      template,
      snapshot: {
        mode: "issued-document",
        demoMode: v.draft.demoMode,
        templateId: template.templateId,
        templateVersion: template.version,
        templateStorageKey: template.storageKey,
        templateChecksum: template.checksum,
        issuer: v.eventProfiles.get(event.id)?.profile || v.parsedProfile,
        photos: {},
        items: rows,
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
      const batch = boundedLayoutCheck(
        entries.map(([, plan]) => plan.snapshot),
      ).then((result) => {
        const issues = result.metadata.issues as Array<{
          index: number;
          code: string;
        }>;
        if (!Array.isArray(issues)) throw new Error("PREFLIGHT_INVALID_OUTPUT");
        return new Set(issues.map((issue) => issue.index));
      });
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
        v.issues.push({
          code: "PRINT_LAYOUT_OVERFLOW",
          path: `items.${plan.row}.assignments.${plan.column}`,
          rowId: plan.rowId,
          message: `Строка ${plan.row + 1}: текст не помещается в выбранную форму при читаемом размере. Проверьте ФИО, должность, организацию и поля документа; исправьте данные или выберите подходящую форму.`,
        });
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
  const { expectedRevision } = parse(finalizeSchema, input);
  const v = await validation(db, c, id, expectedRevision);
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
  const data = parse(finalizeSchema, input);
  if (typeof key !== "string" || !/^[a-zA-Z0-9_-]{16,128}$/.test(key))
    fail(400, "KEY_REQUIRED", "Требуется ключ повторяемости команды");
  const payloadHash = hash({ requestId: id, ...data });
  const before = await scopedRequest(c, id);
  let layoutFingerprint: string | undefined;
  if (before.status === "DRAFT") {
    const checked = await validation(db, c, id, data.expectedRevision);
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
    const existing = await tx.issuance.findUnique({
      where: {
        requestId_sourceRevision: {
          requestId: id,
          sourceRevision: data.expectedRevision,
        },
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
    const v = await validation(tx, c, id, data.expectedRevision);
    if (v.issues.length || !v.profile || !v.parsedProfile)
      fail(
        422,
        "FINALIZE_VALIDATION",
        "Исправьте ошибки перед оформлением",
        v.issues,
      );
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
    const customer = v.draft.customerId ? organizations.get(v.draft.customerId) || null : null;
    const photos = await photoMap(tx, c, v.draft);
    const issued = await tx.issuance.create({
      data: {
        tenantId: c.tenantId,
        requestId: id,
        sourceRevision: data.expectedRevision,
        snapshot: json({
          draft: v.draft,
          serviceRules: [...v.eventRules.values()],
          issuer: v.parsedProfile,
          profileVersionId: v.profile.id,
          customer,
          employers: [...organizations.values()].filter((organization) => v.draft.items.some((item) => item.employerId === organization.id)),
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
      const template = v.selected.get(assignment.templateId)!;
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
      const template = v.groupSelected.get(event.protocolTemplateId)!;
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
          employerId: item.employerId || v.draft.customerId,
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
                  p.assignment.templateId ===
                    protocolTemplateFor(assignment.templateId),
              );
      const linkedCredential = planned.find(
        (p) =>
          p.item.id === item.id &&
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
          assignment: eventProtocolAssignment(event, assignment),
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
    await tx.printRequest.update({
      where: { id },
      data: {
        status: "FINALIZED",
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
    if (record.correctsIssuanceId)
      await tx.issuanceEvent.create({
        data: {
          tenantId: c.tenantId,
          issuanceId: record.correctsIssuanceId,
          kind: "REPLACED",
          reason: record.correctionReason!,
          actorId: c.userId,
          relatedIssuanceId: issued.id,
        },
      });
    await audit(tx, c, "ISSUANCE_REGISTERED", issued.id, {
      requestId: id,
      revision: data.expectedRevision,
      documents: documentIds.length,
    });
    const result = issuanceResult(issued, documentIds, jobIds);
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
  const { expectedRevision } = parse(finalizeSchema, input);
  return transaction(async (tx) => {
    const v = await validation(tx, c, id, expectedRevision);
    if (!v.profile || !v.parsedProfile)
      fail(422, "ISSUER_REQUIRED", "Сохраните профиль центра");
    const categoryIssues = v.issues.filter((issue) =>
      [
        "BIOT_ECS_REQUIRED",
        "BIOT_CATEGORY_TEMPLATE",
        "BIOT_CATEGORY_REQUIRED",
        "BIOT_UNIQUE_NUMBER_CONFLICT",
        "BIOT_CREDENTIAL_AMBIGUOUS",
      ].includes(issue.code),
    );
    if (categoryIssues.length)
      fail(
        422,
        "PREVIEW_VALIDATION",
        "Выберите доступную форму для этой категории",
        categoryIssues,
      );
    const photos = await photoMap(tx, c, v.draft);
    const organizations = await organizationMap(tx, c, v.draft);
    const customer = v.draft.customerId ? organizations.get(v.draft.customerId) || null : null;
    const organizationFingerprint = hash([...organizations.values()]);
    const jobs = [];
    for (const item of v.draft.items)
      for (const assignment of item.assignments) {
        const template = v.selected.get(assignment.templateId);
        if (!template) fail(422, "TEMPLATE_REQUIRED", "Шаблон отсутствует");
        const logicalKey = `preview:${id}:${expectedRevision}:${v.profile.id}:${template.id}:${item.id}:${assignment.id}:${organizationFingerprint}`;
        const previous = await tx.generationJob.findMany({
          where: {
            logicalKey: { startsWith: logicalKey + ":" },
            tenantId: c.tenantId,
          },
        });
        if (previous.length) {
          jobs.push(...previous);
          continue;
        }
        const renderInput = {
          mode: "draft-preview",
          demoMode: true,
          templateId: template.templateId,
          templateVersion: template.version,
          templateStorageKey: template.storageKey,
          templateChecksum: template.checksum,
          issuer: v.parsedProfile,
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
          photos,
        };
        const snapshot = await tx.renderInputSnapshot.create({
          data: {
            tenantId: c.tenantId,
            requestId: id,
            revision: expectedRevision,
            templateVersionId: template.id,
            profileVersionId: v.profile.id,
            input: json(renderInput),
            inputHash: hash(renderInput),
          },
        });
        for (const kind of ["DOCX", "PDF"])
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
      const template = v.groupSelected.get(event.protocolTemplateId);
      if (!template)
        fail(422, "TEMPLATE_REQUIRED", "Групповой шаблон отсутствует");
      const logicalKey = `preview:${id}:${expectedRevision}:${v.profile.id}:${template.id}:group:${event.id}:${organizationFingerprint}`;
      const existing = await tx.generationJob.findMany({
        where: {
          tenantId: c.tenantId,
          logicalKey: { startsWith: logicalKey + ":" },
        },
      });
      if (existing.length) {
        jobs.push(...existing);
        continue;
      }
      const renderInput = {
        mode: "draft-preview",
        demoMode: true,
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
        items: members.map(({ item, assignment }) => ({
          ...item,
          ...employerFields(item, customer, organizations),
          assignment: eventProtocolAssignment(event, assignment),
          number: "ПРЕДПРОСМОТР",
          credentialNumber: "",
          protocolNumber: "",
        })),
      };
      const snapshot = await tx.renderInputSnapshot.create({
        data: {
          tenantId: c.tenantId,
          requestId: id,
          revision: expectedRevision,
          templateVersionId: template.id,
          profileVersionId: v.eventProfiles.get(event.id)?.id || v.profile.id,
          input: json(renderInput),
          inputHash: hash(renderInput),
        },
      });
      for (const kind of ["DOCX", "PDF"])
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
    });
    return { jobs, revision: expectedRevision };
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
    if (original.status === "DRAFT" || original.status === "CANCELLED")
      fail(409, "RETAKE_HISTORY_REQUIRED", "Сначала оформите исходную попытку");
    const source = draftSchema.parse(original.draft);
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
    const assignment = structuredClone(old);
    assignment.id = randomUUID();
    assignment.retakeOf = {
      requestId: id,
      rowId: row.id,
      assignmentId: old.id,
      reason: data.reason,
    };
    assignment.outcome = { status: "UNKNOWN", source: "" };
    assignment.result = "";
    assignment.externalBasisNumber = "";
    assignment.biotKnowledgeResult = "";
    assignment.biotProctoringResult = "";
    assignment.biotUniqueNumber = "";
    assignment.biotNotes = "";
    assignment.fieldOrigins = {};
    for (const key of [
      "documentDate",
      "protocolDate",
      "trainingStart",
      "trainingEnd",
      "validUntil",
    ] as const)
      assignment[key] = "";
    if (assignment.templateId.startsWith("biot-"))
      assignment.biotCheckType = "REPEAT";
    const event = sourceEvent ? structuredClone(sourceEvent) : undefined;
    if (event) {
      event.id = randomUUID();
      event.revision = 0;
      event.title = `Пересдача: ${event.title}`.slice(0, 255);
      for (const key of [
        "documentDate",
        "protocolDate",
        "trainingStart",
        "trainingEnd",
        "validUntil",
        "externalBasisNumber",
      ] as const)
        delete event.commonFields[key];
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
      },
      profileVersionId: source.profileVersionId,
      events: event ? [event] : [],
      items: [{ ...row, id: randomUUID(), assignments: [assignment] }],
    });
    await checkReferences(tx, c, draft);
    const created = await tx.printRequest.create({
      data: {
        tenantId: c.tenantId,
        kind: draft.kind,
        title: draft.title,
        customerId: draft.customerId,
        demoMode: draft.demoMode,
        draft: json(draft),
        itemCount: 1,
        searchText: searchable(draft),
        createdBy: c.userId,
      },
    });
    await persistItems(tx, c, created.id, draft);
    await audit(tx, c, "RETAKE_DRAFT_CREATED", created.id, {
      sourceRequestId: id,
      sourceRowId: row.id,
      sourceAssignmentId: old.id,
      reason: data.reason,
    });
    return { ...created, ...draft };
  });
}

export async function correction(c: Context, id: string, input: unknown) {
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
    const record = await scopedRequest(c, id, tx);
    if (record.revision !== data.expectedRevision)
      fail(409, "REVISION_CONFLICT", "Редакция изменилась");
    const issued = await tx.issuance.findFirst({
      where: { tenantId: c.tenantId, requestId: id },
      orderBy: { createdAt: "desc" },
    });
    if (!issued)
      fail(409, "NOT_REGISTERED", "Сначала оформите исходную заявку");
    const draft = draftSchema.parse(record.draft);
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
    const next = await tx.printRequest.create({
      data: {
        tenantId: c.tenantId,
        kind: draft.kind,
        title: `Исправление: ${draft.title}`,
        customerId: draft.customerId,
        demoMode: draft.demoMode,
        draft: json({ ...draft, title: `Исправление: ${draft.title}` }),
        itemCount: draft.items.length,
        searchText: searchable(draft),
        createdBy: c.userId,
        correctsIssuanceId: issued.id,
        correctionReason: data.reason,
      },
    });
    await persistItems(tx, c, next.id, draft);
    await audit(tx, c, "CORRECTION_DRAFT_CREATED", next.id, {
      correctsIssuanceId: issued.id,
    });
    return { ...next, ...(next.draft as object) };
  });
}
export async function cancelRequest(c: Context, id: string, input: unknown) {
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
    const record = await scopedRequest(c, id, tx);
    if (record.revision !== data.expectedRevision)
      fail(409, "REVISION_CONFLICT", "Редакция изменилась");
    if (record.status === "CANCELLED") return { ok: true };
    const issued = await tx.issuance.findFirst({
      where: { tenantId: c.tenantId, requestId: id },
      orderBy: { createdAt: "desc" },
    });
    if (!issued)
      fail(409, "NOT_REGISTERED", "Отмена применяется к оформленному выпуску");
    await tx.issuanceEvent.create({
      data: {
        tenantId: c.tenantId,
        issuanceId: issued.id,
        kind: "CANCELLED",
        reason: data.reason,
        actorId: c.userId,
      },
    });
    await tx.printRequest.update({
      where: { id },
      data: { status: "CANCELLED" },
    });
    await audit(tx, c, "ISSUANCE_CANCELLED", issued.id);
    return { ok: true };
  });
}
export async function deleteDraft(c: Context, id: string) {
  return transaction(async (tx) => {
    await tx.$executeRaw`SELECT id FROM "PrintRequest" WHERE id=${id} AND "tenantId"=${c.tenantId} FOR UPDATE`;
    const record = await scopedRequest(c, id, tx);
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
    /* Retain server draft and preview references; deletion is an archive transition. */ await tx.printRequest.update(
      { where: { id }, data: { status: "CANCELLED" } },
    );
    await audit(tx, c, "DRAFT_ARCHIVED", id);
    return { ok: true };
  });
}

export async function resolvedRequest(c: Context, id: string) {
  const record = await scopedRequest(c, id);
  const v = await validation(db, c, id, record.revision);
  return {
    draft: { ...v.draft, items: v.draft.items.map((item) => ({
      ...item,
      ...employerFields(item, v.customer, v.organizations),
    })) },
    provenance: v.provenance,
    issues: v.issues,
  };
}
