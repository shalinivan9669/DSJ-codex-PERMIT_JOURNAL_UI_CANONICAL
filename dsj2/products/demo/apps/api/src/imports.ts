import {
  draftSchema,
  itemSchema,
  LIMITS,
  z,
  type RequestItemInput,
} from "@demo/contracts";
import { type Prisma } from "@demo/database";
import {
  audit,
  db,
  fail,
  hash,
  json,
  parse,
  transaction,
  type Context,
} from "./core";
import { checkReferences } from "./requests";
import { assertStaff, submitProposal, workingRequest } from "./approvals";

export const reconciliationFields = [
  "employeeCategory",
  "fullNameRu",
  "fullNameKz",
  "fullNameEn",
  "positionRu",
  "positionKz",
  "positionEn",
  "workplaceRu",
  "workplaceKz",
  "workplaceEn",
  "departmentRu",
  "departmentKz",
  "departmentEn",
  "employerBin",
  "employerAddressRu",
  "employerAddressKz",
  "employerAddressEn",
  "personnelNumber",
  "externalId",
] as const;
const previewSchema = z
  .object({
    expectedRevision: z.number().int().nonnegative(),
    importId: z.string().min(1).max(100),
    rows: z.array(itemSchema).max(LIMITS.rows),
    fieldMask: z
      .array(z.enum(reconciliationFields))
      .max(reconciliationFields.length)
      .default([...reconciliationFields]),
    blankMode: z.enum(["RETAIN", "CLEAR"]).default("RETAIN"),
    inheritEmployerSourceRows: z
      .array(z.number().int().positive())
      .max(LIMITS.rows)
      .default([]),
  })
  .strict();
const applySchema = previewSchema.extend({
  operationKey: z.string().min(8).max(200),
  selectedSourceRows: z
    .array(z.number().int().positive())
    .max(LIMITS.rows)
    .optional(),
  excludeMissingIds: z
    .array(z.string().min(1).max(80))
    .max(LIMITS.rows)
    .default([]),
  exclusionReason: z.string().trim().max(1000).default(""),
});
type StableItem = RequestItemInput & {
  recipientId?: string | null;
  externalId?: string;
  personnelNumber?: string;
  employerId?: string | null;
  employmentPeriod?: string;
  sourceOrder?: number;
};
type MatchKey = "recipientId" | "externalId" | "personnelNumber";
const employerFields = [
  "employerId",
  "workplaceRu",
  "workplaceKz",
  "workplaceEn",
  "employerBin",
  "employerAddressRu",
  "employerAddressKz",
  "employerAddressEn",
] as const;
function inheritedEmployer(item: StableItem): StableItem {
  return {
    ...item,
    ...Object.fromEntries(employerFields.map((field) => [field, ""])),
  };
}
export type ImportDifference = {
  sourceRow?: number;
  targetId?: string;
  recipientId?: string | null;
  category: "added" | "changed" | "unchanged" | "missing" | "ambiguous";
  matchedKey?: MatchKey;
  candidates: string[];
  changes: {
    field: string;
    oldValue: string;
    newValue: string;
    sourceRow?: number;
  }[];
  item?: StableItem;
};
function identity(
  item: StableItem,
  kind: MatchKey,
  customerId?: string | null,
): string {
  if (kind !== "personnelNumber") return item[kind]?.trim() || "";
  const employer = item.employerId || item.employerBin || customerId;
  return item.personnelNumber?.trim() && employer
    ? JSON.stringify([
        employer,
        item.employmentPeriod || "",
        item.personnelNumber.trim(),
      ])
    : "";
}
/** Names produce review candidates only. A repeated strong key never wins by row order. */
export function compareImportedRows(
  existing: StableItem[],
  incoming: StableItem[],
  options: {
    fieldMask?: readonly string[];
    blankMode?: "RETAIN" | "CLEAR";
    customerId?: string | null;
    inheritEmployerSourceRows?: readonly number[];
  } = {},
) {
  const rows: ImportDifference[] = [];
  const keys: MatchKey[] = ["recipientId", "externalId", "personnelNumber"];
  const claimed = new Set<string>();
  const present = new Set<string>();
  for (const item of incoming) {
    const inheritEmployer =
      !!item.sourceRow &&
      !!options.inheritEmployerSourceRows?.includes(item.sourceRow);
    let candidates: StableItem[] = [];
    let matchedKey: MatchKey | undefined;
    let duplicateSourceKey = false;
    for (const kind of keys) {
      const value = identity(item, kind, options.customerId);
      if (!value) continue;
      const matching = existing.filter(
        (target) => identity(target, kind, options.customerId) === value,
      );
      const duplicate =
        incoming.filter(
          (source) => identity(source, kind, options.customerId) === value,
        ).length > 1;
      if (matching.length || duplicate) {
        candidates = [
          ...new Map(
            [...candidates, ...matching].map((target) => [target.id, target]),
          ).values(),
        ];
        matchedKey ||= kind;
        duplicateSourceKey ||= duplicate;
      }
    }
    const stableProvided = keys.some((key) =>
      identity(item, key, options.customerId),
    );
    if (!matchedKey && !stableProvided && item.fullNameRu.trim()) {
      candidates = existing.filter(
        (target) =>
          target.fullNameRu.trim().toLocaleLowerCase("ru") ===
          item.fullNameRu.trim().toLocaleLowerCase("ru"),
      );
    }
    candidates.forEach((target) => present.add(target.id));
    if (
      duplicateSourceKey ||
      candidates.length > 1 ||
      (candidates.length === 1 &&
        (!matchedKey || claimed.has(candidates[0].id)))
    ) {
      rows.push({
        sourceRow: item.sourceRow,
        category: "ambiguous",
        matchedKey,
        candidates: candidates.map((target) => target.id),
        changes: [],
        item,
      });
      continue;
    }
    const target = candidates[0];
    if (!target) {
      rows.push({
        sourceRow: item.sourceRow,
        category: "added",
        candidates: [],
        changes: [],
        item: inheritEmployer ? inheritedEmployer(item) : item,
      });
      continue;
    }
    claimed.add(target.id);
    const changes: ImportDifference["changes"] = [];
    const fields = new Set<string>(options.fieldMask || reconciliationFields);
    if (inheritEmployer) employerFields.forEach((field) => fields.add(field));
    for (const field of fields) {
      const oldValue = String(
        (target as unknown as Record<string, unknown>)[field] || "",
      );
      const explicitlyInherited =
        inheritEmployer &&
        employerFields.includes(field as (typeof employerFields)[number]);
      const newValue = explicitlyInherited
        ? ""
        : String((item as unknown as Record<string, unknown>)[field] || "");
      if (
        newValue === "" &&
        options.blankMode !== "CLEAR" &&
        !explicitlyInherited
      )
        continue;
      if (newValue !== oldValue)
        changes.push({ field, oldValue, newValue, sourceRow: item.sourceRow });
    }
    rows.push({
      sourceRow: item.sourceRow,
      targetId: target.id,
      recipientId: target.recipientId,
      category: changes.length ? "changed" : "unchanged",
      matchedKey,
      candidates: [target.id],
      changes,
      item,
    });
  }
  for (const item of existing.filter((target) => !present.has(target.id))) {
    rows.push({
      targetId: item.id,
      recipientId: item.recipientId,
      category: "missing",
      candidates: [],
      changes: [],
    });
  }
  const counts = {
    added: 0,
    changed: 0,
    unchanged: 0,
    missing: 0,
    ambiguous: 0,
  };
  rows.forEach((row) => counts[row.category]++);
  return {
    rows,
    counts,
    retainedTotal: existing.length + counts.added,
    rowLimit: LIMITS.rows,
  };
}
async function checkedSource(
  c: Context,
  data: z.infer<typeof previewSchema>,
  tx: Prisma.TransactionClient = db,
) {
  const batch = await tx.importBatch.findFirst({
    where: { id: data.importId, tenantId: c.tenantId },
  });
  if (!batch) fail(404, "IMPORT_NOT_FOUND", "Импорт не найден");
  const source = batch.rows as {
    rows: { sourceRow: number; errors?: string[] }[];
    errors?: unknown[];
  };
  const sourceRows = new Map(source.rows.map((row) => [row.sourceRow, row]));
  if (
    data.rows.some(
      (row) =>
        row.importId !== batch.id ||
        !row.sourceRow ||
        !sourceRows.has(row.sourceRow),
    )
  )
    fail(400, "IMPORT_SOURCE", "Неверная ссылка на исходную строку");
  if (new Set(data.rows.map((row) => row.sourceRow)).size !== data.rows.length)
    fail(400, "IMPORT_DUPLICATE", "Исходная строка выбрана дважды");
  if (
    data.inheritEmployerSourceRows.some(
      (sourceRow) => !data.rows.some((row) => row.sourceRow === sourceRow),
    )
  )
    fail(
      400,
      "IMPORT_SOURCE",
      "Для компании выбрана неизвестная исходная строка",
    );
  if (data.rows.some((row) => sourceRows.get(row.sourceRow!)?.errors?.length))
    fail(422, "IMPORT_ROW_ERROR", "Исправьте ошибки выбранных исходных строк");
}
export async function previewImportReconciliation(
  c: Context,
  id: string,
  input: unknown,
) {
  const data = parse(previewSchema, input);
  const record = await workingRequest(c, id);
  if (record.status !== "DRAFT")
    fail(
      409,
      "REGISTERED_IMMUTABLE",
      "Для оформленных данных создайте исправление или новую заявку",
    );
  if (record.revision !== data.expectedRevision)
    fail(409, "REVISION_CONFLICT", "Заявка изменена другим оператором");
  await checkedSource(c, data);
  const draft = draftSchema.parse(record.draft);
  if (
    data.inheritEmployerSourceRows.length &&
    (draft.kind !== "COMPANY" || !draft.customerId)
  )
    fail(422, "IMPORT_EMPLOYER", "Сначала выберите компанию заявки");
  return {
    revision: record.revision,
    importId: data.importId,
    ...compareImportedRows(draft.items, data.rows, {
      ...data,
      customerId: draft.customerId,
    }),
  };
}
export async function applyImportReconciliation(
  c: Context,
  id: string,
  input: unknown,
) {
  const data = parse(applySchema, input);
  const payloadHash = hash({ id, ...data });
  return transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${c.tenantId + ":reconcile:" + data.operationKey},0))`;
    const command = "IMPORT_RECONCILE";
    const old = await tx.idempotencyOperation.findUnique({
      where: {
        tenantId_command_idempotencyKey: {
          tenantId: c.tenantId,
          command,
          idempotencyKey: data.operationKey,
        },
      },
    });
    if (old) {
      if (old.payloadHash !== payloadHash)
        fail(
          409,
          "IDEMPOTENCY_CONFLICT",
          "Ключ операции уже использован для другого состава",
        );
      return old.result;
    }
    await tx.$executeRaw`SELECT id FROM "PrintRequest" WHERE id=${id} AND "tenantId"=${c.tenantId} FOR UPDATE`;
    assertStaff(c, true);
    const record = await workingRequest(c, id, tx);
    if (record.status !== "DRAFT")
      fail(
        409,
        "REGISTERED_IMMUTABLE",
        "Для оформленных данных создайте исправление или новую заявку",
      );
    if (record.revision !== data.expectedRevision)
      fail(409, "REVISION_CONFLICT", "Заявка изменена другим оператором");
    await checkedSource(c, data, tx);
    const draft = draftSchema.parse(record.draft);
    if (
      data.inheritEmployerSourceRows.length &&
      (draft.kind !== "COMPANY" || !draft.customerId)
    )
      fail(422, "IMPORT_EMPLOYER", "Сначала выберите компанию заявки");
    const diff = compareImportedRows(draft.items, data.rows, {
      ...data,
      customerId: draft.customerId,
    });
    const selected = new Set(
      data.selectedSourceRows ||
        diff.rows
          .filter((row) => row.category !== "ambiguous" && row.sourceRow)
          .map((row) => row.sourceRow!),
    );
    if (
      [...selected].some(
        (sourceRow) => !data.rows.some((row) => row.sourceRow === sourceRow),
      )
    )
      fail(400, "IMPORT_SOURCE", "Выбрана неизвестная исходная строка");
    if (
      diff.rows.some(
        (row) => row.category === "ambiguous" && selected.has(row.sourceRow!),
      )
    )
      fail(
        422,
        "IMPORT_AMBIGUOUS",
        "Уточните неоднозначные совпадения перед применением",
      );
    const exclusions = new Set(data.excludeMissingIds);
    if (exclusions.size && data.exclusionReason.length < 3)
      fail(
        400,
        "EXCLUSION_REASON",
        "Укажите причину исключения из текущей заявки",
      );
    if (
      [...exclusions].some(
        (targetId) =>
          !diff.rows.some(
            (row) => row.category === "missing" && row.targetId === targetId,
          ),
      )
    )
      fail(
        400,
        "IMPORT_EXCLUSION",
        "Исключить можно только отсутствующие строки текущего черновика",
      );
    const items = draft.items.filter((item) => !exclusions.has(item.id));
    let added = 0,
      changed = 0;
    for (const row of diff.rows) {
      if (!selected.has(row.sourceRow!) || !row.item) continue;
      if (row.category === "added") {
        // Employee list reconciliation cannot assert assessment results or issue assignments.
        items.push(
          itemSchema.parse({
            ...row.item,
            id: `import-${hash([data.importId, row.sourceRow]).slice(0, 40)}`,
            assignments: [],
          }),
        );
        added++;
      } else if (row.targetId && row.category === "changed") {
        const target = items.find((item) => item.id === row.targetId)!;
        const values = Object.fromEntries(
          row.changes.map((change) => [change.field, change.newValue]),
        );
        Object.assign(target, values, {
          importId: data.importId,
          sourceRow: row.sourceRow,
        });
        changed++;
      }
    }
    if (items.length > LIMITS.rows)
      fail(
        422,
        "ROW_LIMIT",
        `Обновлённый список превышает технический объём ${LIMITS.rows} человек. Изменения не применены; состав и история сохранены. Обратитесь к администратору центра`,
        {
          total: items.length,
          limit: LIMITS.rows,
          missing: diff.counts.missing,
        },
      );
    const updated = draftSchema.parse({ ...draft, items });
    await checkReferences(tx, c, updated);
    const proposed = await submitProposal(
      tx,
      c,
      id,
      updated,
      data.expectedRevision,
    );
    const importResult = {
      ...diff.counts,
      appliedAdded: added,
      appliedChanged: changed,
      excluded: exclusions.size,
      retainedMissing: diff.counts.missing - exclusions.size,
    };
    const result = {
      ...proposed,
      importResult,
    };
    await tx.idempotencyOperation.create({
      data: {
        tenantId: c.tenantId,
        command,
        idempotencyKey: data.operationKey,
        payloadHash,
        result: json(result),
      },
    });
    await audit(tx, c, "IMPORT_RECONCILED", id, {
      importId: data.importId,
      ...importResult,
      revision: record.revision + 1,
      fields: data.fieldMask,
      inheritedEmployerSourceRows: data.inheritEmployerSourceRows,
      exclusionReason: data.exclusionReason,
      excludedRowIds: [...exclusions],
    });
    return result;
  });
}
