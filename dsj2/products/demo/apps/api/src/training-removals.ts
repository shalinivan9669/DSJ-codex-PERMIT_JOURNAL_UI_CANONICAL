import { draftSchema, z, type Draft, type Assignment } from "@demo/contracts";
import { assertStaff, workingRequest, submitProposal } from "./approvals";
import {
  db,
  transaction,
  parse,
  fail,
  audit,
  hash,
  type Context,
} from "./core";
import type { Prisma } from "@demo/database";

type RemovedRow = {
  recipientId: string;
  employeeCategory?: string;
  assignments: Assignment[];
  /** Original IDs preserve removed form positions without rewriting live facts. */
  assignmentOrder?: string[];
};
type Removal = {
  operationId: string;
  eventIds: string[];
  recipientIds: string[];
  removed: RemovedRow[];
  events: NonNullable<Draft["events"]>;
  eventOrder?: string[];
  afterEvents: NonNullable<Draft["events"]>;
  afterMembership: Array<{ recipientId: string; assignments: Assignment[] }>;
  beforeDefaults?: Draft["trainingDefaults"];
  afterDefaults?: Draft["trainingDefaults"];
  removeDefault: boolean;
  contextHash: string;
  requestHash: string;
  revision: number;
  defaultDirections: string[];
};
function membership(draft: Draft, eventIds: string[]) {
  return draft.items
    .map((item) => ({
      recipientId: item.id,
      assignments: item.assignments
        .filter((assignment) => eventIds.includes(assignment.eventId || ""))
        .sort((a, b) => a.id.localeCompare(b.id)),
    }))
    .filter((item) => item.assignments.length)
    .sort((a, b) => a.recipientId.localeCompare(b.recipientId));
}
const scopeSchema = z
  .object({
    expectedRevision: z.number().int().nonnegative(),
    operationId: z.string().uuid(),
    eventId: z.string().min(1).max(80).optional(),
    eventIds: z.array(z.string().min(1).max(80)).min(1).max(30).optional(),
    direction: z.enum(["BIOT", "PTM", "PB", "PS"]).optional(),
    recipientIds: z.array(z.string().min(1).max(80)).min(1).max(250),
    removeDefault: z.boolean().default(false),
  })
  .strict()
  .refine(
    (value) => !!value.direction || !!value.eventId || !!value.eventIds?.length,
    "Выберите обучение",
  );
const metadata = (event: { metadata: unknown }) => event.metadata as Removal;
function insertRestored<T extends { id: string }>(current: T[], restored: T[], order: string[] = []) {
  for (const entry of structuredClone(restored)) {
    const originalIndex = order.indexOf(entry.id);
    const following = originalIndex < 0 ? undefined : order.slice(originalIndex + 1).find((id) => current.some((value) => value.id === id));
    const preceding = originalIndex < 0 ? undefined : order.slice(0, originalIndex).reverse().find((id) => current.some((value) => value.id === id));
    const index = following
      ? current.findIndex((value) => value.id === following)
      : preceding
        ? current.findIndex((value) => value.id === preceding) + 1
        : current.length;
    // Existing and later added objects keep their facts and relative order.
    // Older journals lacking positions retain their previous append behavior.
    current.splice(index, 0, entry);
  }
}
async function findOperation(
  c: Context,
  requestId: string,
  operationId: string,
  tx: Prisma.TransactionClient = db,
) {
  return tx.auditEvent.findFirst({
    where: {
      tenantId: c.tenantId,
      entityId: requestId,
      action: "TRAINING_REMOVED",
      metadata: { path: ["operationId"], equals: operationId },
    },
  });
}
async function restored(
  c: Context,
  requestId: string,
  operationId: string,
  tx: Prisma.TransactionClient = db,
) {
  return tx.auditEvent.findFirst({
    where: {
      tenantId: c.tenantId,
      entityId: requestId,
      action: "TRAINING_RESTORED",
      metadata: { path: ["operationId"], equals: operationId },
    },
  });
}
function response(
  record: Awaited<ReturnType<typeof workingRequest>>,
  operationId: string,
  repeated = false,
) {
  return {
    id: record.id,
    status: record.status,
    revision: record.revision,
    ...draftSchema.parse(record.draft),
    removalResult: { operationId, repeated },
  };
}

/** The immutable audit entry is the durable, server-owned undo journal. */
export async function listTrainingRemovals(c: Context, id: string) {
  assertStaff(c);
  await workingRequest(c, id);
  const records = await db.auditEvent.findMany({
    where: {
      tenantId: c.tenantId,
      entityId: id,
      action: { in: ["TRAINING_REMOVED", "TRAINING_RESTORED"] },
    },
    orderBy: { createdAt: "desc" },
  });
  const completed = new Set(
    records
      .filter((row) => row.action === "TRAINING_RESTORED")
      .map((row) => (row.metadata as { operationId: string }).operationId),
  );
  return {
    items: records
      .filter((row) => row.action === "TRAINING_REMOVED")
      .map((row) => {
        const value = metadata(row);
        return {
          operationId: value.operationId,
          eventIds: value.eventIds,
          recipientIds: value.recipientIds,
          assignments: value.removed.reduce(
            (sum, item) => sum + item.assignments.length,
            0,
          ),
          titles: value.events.map((event) => event.title),
          createdAt: row.createdAt,
          restored: completed.has(value.operationId),
        };
      }),
  };
}
export async function removeTraining(c: Context, id: string, input: unknown) {
  assertStaff(c, true);
  const data = parse(scopeSchema, input);
  const recipientIds = [...new Set(data.recipientIds)].sort();
  const requestHash = hash({
    direction: data.direction,
    eventIds: data.eventIds
      ? [...new Set(data.eventIds)].sort()
      : [data.eventId],
    recipientIds,
    removeDefault: data.removeDefault,
  });
  return transaction(async (tx) => {
    await tx.$executeRaw`SELECT id FROM "PrintRequest" WHERE id=${id} AND "tenantId"=${c.tenantId} FOR UPDATE`;
    const record = await workingRequest(c, id, tx);
    const prior = await findOperation(c, id, data.operationId, tx);
    if (prior) {
      if (metadata(prior).requestHash !== requestHash)
        fail(
          409,
          "OPERATION_REUSED",
          "Код операции уже относится к другому снятию",
        );
      return response(record, data.operationId, true);
    }
    if (record.status !== "DRAFT")
      fail(
        409,
        "REGISTERED_IMMUTABLE",
        "Оформленная заявка изменяется отдельным исправлением",
      );
    if (record.revision !== data.expectedRevision)
      fail(409, "REVISION_CONFLICT", "Заявка изменена другим оператором", {
        revision: record.revision,
      });
    const draft = draftSchema.parse(record.draft);
    const eventIds = [
      ...new Set(
        data.eventIds ||
          (data.eventId
            ? [data.eventId]
            : (draft.events || [])
                .filter(
                  (event) =>
                    event.protocolTemplateId.split("-")[0].toUpperCase() ===
                    data.direction,
                )
                .map((event) => event.id)),
      ),
    ].sort();
    if (
      recipientIds.some(
        (recipientId) => !draft.items.some((item) => item.id === recipientId),
      ) ||
      eventIds.some(
        (eventId) => !draft.events?.some((event) => event.id === eventId),
      )
    )
      fail(
        409,
        "TRAINING_SCOPE_CHANGED",
        "Состав выбранных людей или обучений изменился",
      );
    const before = structuredClone(draft);
    const removed: RemovedRow[] = [];
    for (const item of draft.items.filter((item) =>
      recipientIds.includes(item.id),
    )) {
      const assignments = item.assignments.filter((entry) =>
        eventIds.includes(entry.eventId || ""),
      );
      if (!assignments.length) continue;
      removed.push({
        recipientId: item.id,
        employeeCategory: item.employeeCategory,
        assignments,
        assignmentOrder: item.assignments.map((assignment) => assignment.id),
      });
      item.assignments = item.assignments.filter(
        (entry) => !eventIds.includes(entry.eventId || ""),
      );
    }
    if (!removed.length)
      fail(
        409,
        "TRAINING_SCOPE_EMPTY",
        "У выбранных людей это обучение уже снято",
      );
    // An event with other members or independent facts remains intact. Removing
    // a common default never silently removes unrelated group memberships.
    if (data.removeDefault) {
      draft.trainingDefaults = (draft.trainingDefaults || [])
        .map((entry) => ({
          ...entry,
          eventIds: entry.eventIds.filter(
            (eventId) => !eventIds.includes(eventId),
          ),
        }))
        .filter((entry) => entry.eventIds.length);
    }
    draft.events = (draft.events || []).filter(
      (event) =>
        !eventIds.includes(event.id) ||
        draft.trainingDefaults?.some((entry) =>
          entry.eventIds.includes(event.id),
        ) ||
        draft.items.some((item) =>
          item.assignments.some((entry) => entry.eventId === event.id),
        ),
    );
    const result = await submitProposal(
      tx,
      c,
      id,
      draft,
      data.expectedRevision,
    );
    const after = draftSchema.parse(result.draft);
    const journal: Removal = {
      operationId: data.operationId,
      eventIds,
      recipientIds,
      removed,
      events: (before.events || []).filter((event) =>
        eventIds.includes(event.id),
      ),
      eventOrder: (before.events || []).map((event) => event.id),
      afterEvents: (after.events || []).filter((event) =>
        eventIds.includes(event.id),
      ),
      afterMembership: membership(after, eventIds),
      beforeDefaults: before.trainingDefaults,
      afterDefaults: after.trainingDefaults,
      removeDefault: data.removeDefault,
      contextHash: hash({
        commonFields: before.commonFields,
        presetFields: before.presetFields,
        profileVersionId: before.profileVersionId,
      }),
      requestHash,
      revision: result.revision,
      defaultDirections: [
        ...new Set(
          (before.events || [])
            .filter((event) => eventIds.includes(event.id))
            .map((event) =>
              event.protocolTemplateId.split("-")[0].toUpperCase(),
            ),
        ),
      ],
    };
    await audit(
      tx,
      c,
      "TRAINING_REMOVED",
      id,
      journal as unknown as Record<string, unknown>,
    );
    return {
      ...result,
      removalResult: {
        operationId: data.operationId,
        repeated: false,
        removed: removed.length,
      },
    };
  });
}
export async function restoreTraining(
  c: Context,
  id: string,
  operationId: string,
  input: unknown,
) {
  assertStaff(c, true);
  const data = parse(
    z.object({ expectedRevision: z.number().int().nonnegative() }).strict(),
    input,
  );
  return transaction(async (tx) => {
    await tx.$executeRaw`SELECT id FROM "PrintRequest" WHERE id=${id} AND "tenantId"=${c.tenantId} FOR UPDATE`;
    const record = await workingRequest(c, id, tx);
    const journal = await findOperation(c, id, operationId, tx);
    if (!journal)
      fail(
        404,
        "TRAINING_OPERATION_NOT_FOUND",
        "Операция снятия не найдена в этой заявке",
      );
    if (await restored(c, id, operationId, tx))
      return response(record, operationId, true);
    if (record.status !== "DRAFT")
      fail(
        409,
        "REGISTERED_IMMUTABLE",
        "Оформленная заявка изменяется отдельным исправлением",
      );
    if (record.revision !== data.expectedRevision)
      fail(409, "REVISION_CONFLICT", "Заявка изменена другим оператором", {
        revision: record.revision,
      });
    const operation = metadata(journal);
    const draft = draftSchema.parse(record.draft);
    const conflicts: Array<{
      recipientId?: string;
      eventId?: string;
      field: string;
    }> = [];
    if (
      operation.contextHash !==
      hash({
        commonFields: draft.commonFields,
        presetFields: draft.presetFields,
        profileVersionId: draft.profileVersionId,
      })
    )
      conflicts.push({ field: "commonFields" });
    for (const eventId of operation.eventIds) {
      const current = draft.events?.find((event) => event.id === eventId);
      const expected = operation.afterEvents.find(
        (event) => event.id === eventId,
      );
      if (hash(current || null) !== hash(expected || null))
        conflicts.push({ eventId, field: "events" });
    }
    const currentMembership = membership(draft, operation.eventIds);
    if (hash(currentMembership) !== hash(operation.afterMembership))
      conflicts.push({ field: "eventMembership" });
    for (const snapshot of operation.removed) {
      const current = draft.items.find(
        (item) => item.id === snapshot.recipientId,
      );
      if (
        !current ||
        current.employeeCategory !== snapshot.employeeCategory ||
        current.assignments.some(
          (entry) =>
            operation.eventIds.includes(entry.eventId || "") ||
            snapshot.assignments.some((old) => old.id === entry.id),
        )
      )
        conflicts.push({
          recipientId: snapshot.recipientId,
          field: !current ? "recipient" : "assignments",
        });
    }
    if (
      operation.removeDefault &&
      hash(
        (draft.trainingDefaults || []).filter((entry) =>
          operation.defaultDirections.includes(entry.direction),
        ),
      ) !==
        hash(
          (operation.afterDefaults || []).filter((entry) =>
            operation.defaultDirections.includes(entry.direction),
          ),
        )
    )
      conflicts.push({ field: "trainingDefaults" });
    if (conflicts.length)
      fail(
        409,
        "TRAINING_RESTORE_CONFLICT",
        "Затронутые сведения изменились после снятия. Восстановление не применено; текущие данные и исходная операция сохранены.",
        { operationId, conflicts },
      );
    for (const snapshot of operation.removed) {
      const assignments = draft.items.find((item) => item.id === snapshot.recipientId)!.assignments;
      insertRestored(assignments, snapshot.assignments, snapshot.assignmentOrder);
    }
    insertRestored((draft.events ||= []), operation.events.filter((snapshot) => !draft.events!.some((event) => event.id === snapshot.id)), operation.eventOrder);
    if (operation.removeDefault)
      draft.trainingDefaults = [
        ...(draft.trainingDefaults || []).filter(
          (entry) => !operation.defaultDirections.includes(entry.direction),
        ),
        ...(operation.beforeDefaults || []).filter((entry) =>
          operation.defaultDirections.includes(entry.direction),
        ),
      ];
    // Bypass only ordinary PATCH metadata stamping: snapshots came from the
    // authenticated immutable server journal, never from a client payload.
    const result = await submitProposal(
      tx,
      c,
      id,
      draft,
      data.expectedRevision,
    );
    await audit(tx, c, "TRAINING_RESTORED", id, {
      operationId,
      removedRevision: operation.revision,
      restoredRevision: result.revision,
    });
    return { ...result, removalResult: { operationId, repeated: false } };
  });
}
