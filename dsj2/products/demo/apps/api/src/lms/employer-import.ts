import { randomUUID } from "node:crypto";
import { extname } from "node:path";
import { Prisma } from "@demo/database";
import { z } from "@demo/contracts";
import { parseImport } from "@demo/printing";
import {
  audit,
  db,
  fail,
  hash,
  json,
  parse,
  transaction,
  type Context,
} from "../core";
import { employerMemberships, isLmsStaff } from "./scope";
import { assignmentOrigin } from "./assignment-operations";
import { operatorProgrammes } from "./operator-programme";
import { rateLimit } from "../auth";
import { assignmentContext } from "./enrollments";
import {
  EMPLOYER_IMPORT_LIMIT,
  employerImportRowSchema,
  mapImportRows,
  reconcileEmployerRows,
  type EmployerImportRow,
} from "./employer-import-rules";

type Tx = Prisma.TransactionClient;
export const importInputSchema = z
  .object({
    rows: z.array(employerImportRowSchema).min(1).max(EMPLOYER_IMPORT_LIMIT),
    mapping: z.record(z.string().max(500), z.string().max(500)).default({}),
    repeatTraining: z.boolean().default(false),
  })
  .strict();
const draftSchema = importInputSchema
  .extend({
    id: z.string().uuid(),
    customerId: z.string().max(100),
    courseVersionId: z.string().max(100),
    sourceOrderId: z.string().max(100).nullable().optional(),
    sourceRequestId: z.string().max(100).nullable().optional(),
    groupId: z.string().max(100).nullable().optional(),
    groupName: z.string().max(300).default(""),
    dueAt: z.string().datetime().nullable().optional(),
  })
  .strict();
export async function importMembership(
  c: Context,
  customerId: string,
  assign = false,
  tx: Tx = db,
) {
  if (isLmsStaff(c)) {
    if (
      !(await tx.customerOrganization.findFirst({
        where: { tenantId: c.tenantId, id: customerId, archived: false },
        select: { id: true },
      }))
    )
      fail(404, "NOT_FOUND", "Организация не найдена");
    return null;
  }
  if (tx !== db)
    await tx.$executeRaw`SELECT id FROM "EmployerMembership" WHERE "tenantId"=${c.tenantId} AND "userId"=${c.userId} AND "customerId"=${customerId} FOR UPDATE`;
  const memberships = await employerMemberships(c, assign, tx);
  const member = memberships.find((entry) => entry.customerId === customerId);
  if (!member)
    fail(403, "EMPLOYER_IMPORT_DENIED", "Доступ к списку организации закрыт");
  return member;
}
export async function importCourse(
  c: Context,
  courseVersionId: string,
  tx: Tx = db,
) {
  const version = await tx.courseVersion.findFirst({
    where: { id: courseVersionId, tenantId: c.tenantId, status: "PUBLISHED" },
    include: { teachingCourse: true },
  });
  if (
    !version ||
    version.teachingCourse.archived ||
    version.teachingCourse.assignmentPaused
  )
    fail(409, "COURSE_ASSIGNMENT_PAUSED", "Набор на программу приостановлен");
  return version;
}
async function validateImportGroup(
  c: Context,
  data: {
    groupId?: string | null;
    customerId: string;
    courseVersionId: string;
    sourceOrderId?: string | null;
    sourceRequestId?: string | null;
  },
  tx: Tx = db,
) {
  if (!data.groupId) return;
  const group = await tx.lmsGroup.findFirst({
    where: {
      tenantId: c.tenantId,
      id: data.groupId,
      courseVersionId: data.courseVersionId,
    },
  });
  if (
    !group ||
    group.customerId !== data.customerId ||
    group.sourceOrderId !== (data.sourceOrderId || null) ||
    group.sourceRequestId !== (data.sourceRequestId || null)
  )
    fail(
      409,
      "GROUP_CONTEXT_MISMATCH",
      "Группа относится к другой программе или заявке",
    );
}
export async function employerImportContext(c: Context, query: unknown) {
  const input = parse(
    z
      .object({
        customerId: z.string().max(100).optional(),
        orderId: z.string().max(100).optional(),
        requestId: z.string().max(100).optional(),
        versionId: z.string().max(100).optional(),
      })
      .strict(),
    query,
  );
  const memberships = isLmsStaff(c) ? null : await employerMemberships(c);
  let customerId =
    input.customerId ||
    (memberships?.length === 1 ? memberships[0].customerId : undefined);
  let courseVersionId = input.versionId;
  if (input.orderId) {
    const application = await db.lmsApplication.findFirst({
      where: {
        tenantId: c.tenantId,
        orderId: input.orderId,
        state: "ACCEPTED",
      },
    });
    if (!application?.customerId)
      fail(404, "NOT_FOUND", "Принятая заявка организации не найдена");
    await importMembership(c, application.customerId);
    customerId = application.customerId;
    courseVersionId = application.courseVersionId;
  }
  if (customerId) await importMembership(c, customerId);
  const customers = await db.customerOrganization.findMany({
    where: {
      tenantId: c.tenantId,
      archived: false,
      ...(memberships
        ? { id: { in: memberships.map((member) => member.customerId) } }
        : {}),
    },
    select: { id: true, nameRu: true, nameKz: true },
    take: 250,
    orderBy: [{ nameRu: "asc" }, { id: "asc" }],
  });
  const courses = await operatorProgrammes(c, courseVersionId);
  if (customerId && !customers.some((customer) => customer.id === customerId)) {
    const selected = await db.customerOrganization.findFirst({ where: { tenantId: c.tenantId, id: customerId, archived: false }, select: { id: true, nameRu: true, nameKz: true } });
    if (selected) customers.unshift(selected);
  }
  const groups = customerId
    ? await db.lmsGroup.findMany({
        where: {
          tenantId: c.tenantId,
          customerId,
          ...(courseVersionId ? { courseVersionId } : {}),
          sourceOrderId: input.orderId || null,
        },
        select: { id: true, name: true, courseVersionId: true },
        take: 250,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      })
    : [];
  const tenant = await db.tenant.findFirstOrThrow({
    where: { id: c.tenantId },
    select: { timezone: true },
  });
  return {
    customers,
    canManagePeople: isLmsStaff(c),
    canPrepare: isLmsStaff(c) || !!memberships?.some((member) =>
      (!customerId || member.customerId === customerId) && (member.permissions as string[]).includes("ASSIGN_TRAINING")),
    courses,
    groups,
    customerId,
    courseVersionId,
    sourceOrderId: input.orderId,
    sourceRequestId: input.requestId,
    canAssign:
      isLmsStaff(c) ||
      !!memberships?.some(
        (member) =>
          member.customerId === customerId &&
          (member.permissions as string[]).includes("ASSIGN_TRAINING"),
      ),
    timezone: tenant.timezone,
  };
}
export async function parseEmployerImportFile(
  c: Context,
  file: Express.Multer.File | undefined,
  sheet?: string,
) {
  rateLimit(`lms-import-file:${c.tenantId}:${c.userId}`, 10);
  if (!isLmsStaff(c) && !(await employerMemberships(c)).length)
    fail(403, "ROLE_DENIED", "Недостаточно прав");
  if (!file) fail(400, "FILE_REQUIRED", "Выберите файл");
  if (file.size > 5 * 1024 * 1024)
    fail(413, "IMPORT_TOO_LARGE", "Файл больше 5 МиБ");
  const format = extname(file.originalname).slice(1).toLowerCase();
  if (!["xlsx", "csv", "tsv"].includes(format))
    fail(400, "IMPORT_FORMAT", "Выберите XLSX, CSV или TSV без макросов");
  let parsed;
  try {
    parsed = await parseImport(
      file.buffer,
      format as "xlsx" | "csv" | "tsv",
      {},
      undefined,
      sheet,
    );
  } catch {
    fail(
      400,
      "IMPORT_INVALID",
      "Проверьте формат, формулы и внешние ссылки файла",
    );
  }
  const headers = parsed.headers as string[];
  const rawRows = parsed.rawRows as {
    rowNumber: number;
    values: string[];
    errors?: string[];
  }[];
  if (
    !headers?.length ||
    headers.length > 30 ||
    !rawRows?.length ||
    rawRows.length > EMPLOYER_IMPORT_LIMIT ||
    (parsed.sheets as string[]).length > 20
  )
    fail(
      422,
      "IMPORT_ROW_LIMIT",
      "Допустимо до 5000 строк, 30 колонок и 20 листов",
    );
  if (rawRows.some((row) => row.values.some((cell) => cell.length > 500)))
    fail(422, "IMPORT_CELL_LIMIT", "Сократите значение ячейки до 500 символов");
  const aliases: Record<string, string[]> = {
    fullNameRu: ["фио", "аты-жөні", "fullnameru", "name"],
    iin: ["иин", "жсн", "iin"],
    phone: ["телефон", "phone"],
    email: ["e-mail", "email", "почта"],
    positionRu: ["должность", "лауазым", "positionru"],
    course: ["курс", "программа", "course"],
    recipientId: ["recipientid", "id сотрудника"],
  };
  const mapping = Object.fromEntries(
    Object.entries(aliases).map(([field, names]) => [
      field,
      headers.find((header) => names.includes(header.trim().toLowerCase())) ||
        "",
    ]),
  );
  return {
    headers,
    rawRows,
    mapping,
    sheets: parsed.sheets,
    sheet: parsed.sheet,
    rows: mapImportRows(headers, rawRows, mapping),
  };
}
export async function importCandidates(
  c: Context,
  customerId: string,
  rows: EmployerImportRow[],
  tx: Tx = db,
) {
  const membership = await importMembership(c, customerId, false, tx);
  const allowedIds = membership?.recipientIds as string[] | undefined;
  const ids = rows.map((row) => row.recipientId).filter(Boolean);
  const names = rows
    .map((row) => row.fullNameRu.trim().toLowerCase())
    .filter(Boolean);
  const iins = rows.map((row) => row.iin).filter(Boolean);
  const emails = rows.map((row) => row.email.toLowerCase()).filter(Boolean);
  const phones = rows.map((row) => row.phone.toLowerCase()).filter(Boolean);
  const choices = [
    ids.length ? Prisma.sql`r.id IN (${Prisma.join(ids)})` : Prisma.sql`false`,
    ...[
      ["fullNameRu", names],
      ["iin", iins],
      ["email", emails],
      ["phone", phones],
    ].map(([field, values]) =>
      (values as string[]).length
        ? Prisma.sql`lower(r.data->>${field as string}) IN (${Prisma.join(values as string[])})`
        : Prisma.sql`false`,
    ),
  ];
  const result = await tx.$queryRaw<
    { id: string; data: Record<string, unknown> }[]
  >(
    Prisma.sql`SELECT r.id,r.data FROM "Recipient" r WHERE r."tenantId"=${c.tenantId} AND NOT r.archived AND (${isLmsStaff(c)} OR EXISTS(SELECT 1 FROM "RecipientEmployment" e WHERE e."tenantId"=r."tenantId" AND e."recipientId"=r.id AND e."employerId"=${customerId})) AND (${Prisma.join(choices, " OR ")}) ${allowedIds?.length ? Prisma.sql`AND r.id IN (${Prisma.join(allowedIds)})` : Prisma.empty} ORDER BY r.id LIMIT 10001`,
  );
  if (result.length > 10000)
    fail(422, "IMPORT_MATCH_LIMIT", "Уточните состав списка для сопоставления");
  return result;
}
export async function evaluateImport(
  c: Context,
  draft: {
    customerId: string;
    courseVersionId: string;
    input: unknown;
  },
  tx: Tx = db,
) {
  const input = importInputSchema.parse(draft.input);
  const course = await importCourse(c, draft.courseVersionId, tx);
  const content = course.content as { titleRu?: string; titleKz?: string };
  const candidates = await importCandidates(
    c,
    draft.customerId,
    input.rows,
    tx,
  );
  const evaluated = reconcileEmployerRows(input.rows, candidates, [
    course.id,
    course.teachingCourse.id,
    content.titleRu || "",
    content.titleKz || "",
  ]);
  const member = await importMembership(c, draft.customerId, false, tx);
  if ((member?.recipientIds as string[] | undefined)?.length)
    for (const row of evaluated)
      if (row.outcome === "NEW") row.errors.push("NEW_RECIPIENT_DENIED");
  // A matching identifier outside the authorized directory must not reveal or attach that record.
  const newRows = evaluated.filter(
    (row) => row.outcome === "NEW" && !row.errors.length,
  );
  if (newRows.length) {
    const iins = newRows.map((entry) => entry.row.iin).filter(Boolean);
    const contacts = newRows
      .map((entry) => entry.row.email.toLowerCase())
      .filter(Boolean);
    const phones = newRows
      .map((entry) => entry.row.phone.toLowerCase())
      .filter(Boolean);
    const collisions = await tx.$queryRaw<
      { iin: string | null; email: string | null; phone: string | null }[]
    >(
      Prisma.sql`SELECT data->>'iin' AS iin,lower(data->>'email') AS email,lower(data->>'phone') AS phone FROM "Recipient" WHERE "tenantId"=${c.tenantId} AND NOT archived AND (${iins.length ? Prisma.sql`data->>'iin' IN (${Prisma.join(iins)})` : Prisma.sql`false`} OR ${contacts.length ? Prisma.sql`lower(data->>'email') IN (${Prisma.join(contacts)})` : Prisma.sql`false`} OR ${phones.length ? Prisma.sql`lower(data->>'phone') IN (${Prisma.join(phones)})` : Prisma.sql`false`}) LIMIT 10001`,
    );
    for (const entry of newRows)
      if (
        collisions.some(
          (value) =>
            (entry.row.iin && entry.row.iin === value.iin) ||
            (!(isLmsStaff(c) && entry.row.resolution === "NEW") && entry.row.email &&
              entry.row.email.toLowerCase() === value.email) ||
            (!(isLmsStaff(c) && entry.row.resolution === "NEW") && entry.row.phone && entry.row.phone.toLowerCase() === value.phone),
        )
      )
        entry.errors.push("CENTER_IDENTITY_REVIEW");
  }
  return evaluated;
}
export async function ownedEmployerImport(c: Context, id: string, tx: Tx = db) {
  const draft = await tx.lmsEmployerImport.findFirst({
    where: {
      tenantId: c.tenantId,
      id,
      ...(!isLmsStaff(c) ? { actorId: c.userId } : {}),
    },
  });
  if (!draft) fail(404, "NOT_FOUND", "Список не найден");
  const member = await importMembership(c, draft.customerId, false, tx);
  const permitted = member?.recipientIds as string[] | undefined;
  if (permitted?.length) {
    const input = importInputSchema.parse(draft.input);
    const prepared = await tx.lmsEmployerImportRow.findMany({
      where: { tenantId: c.tenantId, importId: draft.id },
      select: { sourceRow: true, recipientId: true },
    });
    const resolved = new Map(
      prepared.map((row) => [row.sourceRow, row.recipientId]),
    );
    if (
      input.rows.some((row) => {
        const recipientId = resolved.get(row.sourceRow) || row.recipientId;
        return !recipientId || !permitted.includes(recipientId);
      })
    )
      fail(404, "NOT_FOUND", "Список недоступен в текущей области полномочий");
  }
  return draft;
}
export async function createEmployerImport(c: Context, raw: unknown) {
  rateLimit(`lms-import-create:${c.tenantId}:${c.userId}`, 30);
  const data = parse(draftSchema, raw);
  if (new Set(data.rows.map((row) => row.sourceRow)).size !== data.rows.length)
    fail(400, "IMPORT_DUPLICATE", "Номер строки повторяется");
  await importMembership(c, data.customerId, true);
  await importCourse(c, data.courseVersionId);
  await assignmentOrigin(c, data);
  await validateImportGroup(c, data);
  const input = importInputSchema.parse({
      rows: data.rows,
      mapping: data.mapping,
      repeatTraining: data.repeatTraining,
    }),
    inputHash = hash(data);
  await transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${c.tenantId + ":employer-import:" + data.id},0))`;
    const old = await tx.lmsEmployerImport.findFirst({
      where: { id: data.id, tenantId: c.tenantId },
    });
    if (old) {
      if (old.actorId !== c.userId) fail(404, "NOT_FOUND", "Список не найден");
      if (old.inputHash !== inputHash)
        fail(
          409,
          "IDEMPOTENCY_CONFLICT",
          "Список уже сохранён с другими данными",
        );
      return;
    }
    if (
      (await tx.lmsEmployerImport.count({
        where: {
          tenantId: c.tenantId,
          actorId: c.userId,
          state: {
            in: [
              "DRAFT",
              "SUBMITTED",
              "QUEUED",
              "PROCESSING",
              "ASSIGNING",
              "PAUSED",
              "FAILED",
            ],
          },
        },
      })) >= 100
    )
      fail(
        429,
        "IMPORT_DRAFT_LIMIT",
        "Завершите или отмените предыдущие списки",
      );
    await tx.lmsEmployerImport.create({
      data: {
        id: data.id,
        tenantId: c.tenantId,
        actorId: c.userId,
        customerId: data.customerId,
        courseVersionId: data.courseVersionId,
        sourceOrderId: data.sourceOrderId,
        sourceRequestId: data.sourceRequestId,
        groupId: data.groupId,
        groupName: data.groupName,
        dueAt: data.dueAt ? new Date(data.dueAt) : null,
        input: json(input),
        inputHash,
      },
    });
    await audit(tx, c, "LMS_EMPLOYER_IMPORT_CREATED", data.id, {
      rows: data.rows.length,
      courseVersionId: data.courseVersionId,
      customerId: data.customerId,
    });
  });
  return employerImportDetail(c, data.id, {});
}
export async function employerImportDetail(
  c: Context,
  id: string,
  raw: unknown,
) {
  const query = parse(
    z
      .object({
        page: z.coerce.number().int().positive().default(1),
        pageSize: z.coerce.number().int().min(1).max(100).default(50),
      })
      .strict(),
    raw,
  );
  const draft = await ownedEmployerImport(c, id),
    input = importInputSchema.parse(draft.input);
  const start = (query.page - 1) * query.pageSize;
  const evaluated = ["DRAFT", "SUBMITTED"].includes(draft.state)
    ? await evaluateImport(c, draft)
    : [];
  const outcomes = await db.lmsEmployerImportRow.findMany({
    where: {
      tenantId: c.tenantId,
      importId: id,
      sourceRow: {
        in: input.rows
          .slice(start, start + query.pageSize)
          .map((row) => row.sourceRow),
      },
    },
  });
  const counts = await db.lmsEmployerImportRow.groupBy({
    by: ["outcome"],
    where: { tenantId: c.tenantId, importId: id },
    _count: true,
  });
  const assignmentRows = draft.operationId
    ? await db.lmsAssignmentRow.findMany({
        where: {
          tenantId: c.tenantId,
          operationId: draft.operationId,
          recipientId: {
            in: outcomes.flatMap((row) =>
              row.recipientId ? [row.recipientId] : [],
            ),
          },
        },
        select: { recipientId: true, outcome: true, errorCode: true },
      })
    : [];
  const assignment = draft.operationId
    ? await db.lmsAssignmentOperation.findFirst({
        where: { tenantId: c.tenantId, id: draft.operationId },
        select: { id: true, cursor: true, state: true, groupId: true },
      })
    : null;
  const member = await importMembership(c, draft.customerId);
  const assignmentCounts = draft.operationId
    ? await db.lmsAssignmentRow.groupBy({
        by: ["outcome"],
        where: { tenantId: c.tenantId, operationId: draft.operationId },
        _count: true,
      })
    : [];
  const [organization, programme] = await Promise.all([
    db.customerOrganization.findFirst({ where: { tenantId: c.tenantId, id: draft.customerId }, select: { nameRu: true, nameKz: true } }),
    db.courseVersion.findFirst({ where: { tenantId: c.tenantId, id: draft.courseVersionId }, select: { content: true } }),
  ]);
  const programmeTitle = programme?.content as { titleRu?: string; titleKz?: string } | undefined;
  return {
    ...draft,
    organizationNameRu: organization?.nameRu || "",
    organizationNameKz: organization?.nameKz || organization?.nameRu || "",
    programmeTitleRu: programmeTitle?.titleRu || "",
    programmeTitleKz: programmeTitle?.titleKz || programmeTitle?.titleRu || "",
    input: undefined,
    leaseToken: undefined,
    leaseUntil: undefined,
    inputHash: undefined,
    rows: input.rows.slice(start, start + query.pageSize).map((row) => ({
      ...row,
      preview: evaluated.find((entry) => entry.row.sourceRow === row.sourceRow),
      result: (() => {
        const result = outcomes.find(
          (entry) => entry.sourceRow === row.sourceRow,
        );
        const assignment = assignmentRows.find(
          (entry) => entry.recipientId === result?.recipientId,
        );
        return result
          ? {
              ...result,
              assignmentOutcome: assignment?.outcome,
              assignmentError: assignment?.errorCode,
            }
          : undefined;
      })(),
    })),
    repeatTraining: input.repeatTraining,
    mapping: input.mapping,
    total: input.rows.length,
    page: query.page,
    pageSize: query.pageSize,
    errors: evaluated.filter((row) => row.errors.length).length,
    counts,
    assignment: assignment
      ? {
          ...assignment,
          created:
            assignmentCounts.find((row) => row.outcome === "CREATED")?._count ||
            0,
          reused: assignmentCounts
            .filter((row) => ["REUSED", "CONFLICT"].includes(row.outcome))
            .reduce((sum, row) => sum + row._count, 0),
          errorCount:
            assignmentCounts.find((row) => row.outcome === "ERROR")?._count ||
            0,
        }
      : null,
    failedRows: counts.find((row) => row.outcome === "ERROR")?._count || 0,
    canEdit:
      (isLmsStaff(c) || !!(member?.permissions as string[] | undefined)?.includes("ASSIGN_TRAINING")) &&
      (draft.state === "DRAFT" || (draft.state === "SUBMITTED" && isLmsStaff(c))),
    canAssign:
      isLmsStaff(c) ||
      !!(member?.permissions as string[] | undefined)?.includes(
        "ASSIGN_TRAINING",
      ),
  };
}
export async function updateEmployerImport(
  c: Context,
  id: string,
  raw: unknown,
) {
  const data = parse(
    z
      .object({
        revision: z.number().int().nonnegative(),
        rows: z.array(employerImportRowSchema).min(1).max(100),
        repeatTraining: z.boolean().optional(),
      })
      .strict(),
    raw,
  );
  await transaction(async (tx) => {
    await tx.$executeRaw`SELECT id FROM "LmsEmployerImport" WHERE id=${id} AND "tenantId"=${c.tenantId} FOR UPDATE`;
    const draft = await ownedEmployerImport(c, id, tx);
    await importMembership(c, draft.customerId, true, tx);
    if (
      draft.state !== "DRAFT" &&
      !(draft.state === "SUBMITTED" && isLmsStaff(c))
    )
      fail(
        409,
        "IMPORT_ALREADY_CONFIRMED",
        "Список уже передан. Выполненные строки сохранены",
      );
    if (draft.revision !== data.revision)
      fail(
        409,
        "REVISION_CONFLICT",
        "Список изменён. Ваш ввод сохранён; перечитайте текущую версию",
      );
    const input = importInputSchema.parse(draft.input),
      changes = new Map(data.rows.map((row) => [row.sourceRow, row]));
    if (
      data.rows.some(
        (row) => !input.rows.some((old) => old.sourceRow === row.sourceRow),
      )
    )
      fail(400, "IMPORT_SOURCE", "Строка не найдена");
    const updated = {
      ...input,
      rows: input.rows.map((row) => changes.get(row.sourceRow) || row),
      repeatTraining: data.repeatTraining ?? input.repeatTraining,
    };
    await tx.lmsEmployerImport.update({
      where: { id },
      data: { input: json(updated), revision: { increment: 1 } },
    });
    await audit(tx, c, "LMS_EMPLOYER_IMPORT_EDITED", id, {
      rows: data.rows.map((row) => row.sourceRow),
      revision: draft.revision + 1,
    });
  });
  return { ok: true, revision: data.revision + 1 };
}
export async function confirmEmployerImport(
  c: Context,
  id: string,
  raw: unknown,
) {
  const data = parse(
    z.object({ revision: z.number().int().nonnegative() }).strict(),
    raw,
  );
  await transaction(async (tx) => {
    await tx.$executeRaw`SELECT id FROM "LmsEmployerImport" WHERE id=${id} AND "tenantId"=${c.tenantId} FOR UPDATE`;
    const draft = await ownedEmployerImport(c, id, tx);
    await importMembership(c, draft.customerId, true, tx);
    if (!["DRAFT", "SUBMITTED"].includes(draft.state)) return;
    if (draft.revision !== data.revision)
      fail(
        409,
        "REVISION_CONFLICT",
        "Список изменился. Проверьте текущую версию",
      );
    const member = await importMembership(c, draft.customerId, false, tx),
      canAssign =
        isLmsStaff(c) ||
        (member?.permissions as string[] | undefined)?.includes(
          "ASSIGN_TRAINING",
        );
    if (!canAssign) fail(403, "EMPLOYER_IMPORT_DENIED", "Нет права изменять или передавать состав. Обратитесь в центр");
    const evaluated = await evaluateImport(c, draft, tx);
    if (evaluated.some((row) => row.errors.length))
      fail(
        422,
        "IMPORT_EXCEPTIONS",
        "Исправьте или исключите отмеченные строки",
        { count: evaluated.filter((row) => row.errors.length).length },
      );
    if (!evaluated.some((row) => row.outcome !== "SKIPPED"))
      fail(422, "IMPORT_EMPTY", "Добавьте хотя бы одного сотрудника");
    await assignmentOrigin(c, draft, tx);
    await validateImportGroup(c, draft, tx);
    await tx.lmsEmployerImport.update({
      where: { id },
      data: {
        state: "QUEUED",
        confirmedBy: c.userId,
        operationId: randomUUID(),
        revision: { increment: 1 },
        errorCode: null,
      },
    });
    await audit(tx, c, "LMS_EMPLOYER_IMPORT_CONFIRMED", id, {
      rows: evaluated.length,
    });
  });
  return employerImportDetail(c, id, {});
}
export async function importAction(c: Context, id: string, raw: unknown) {
  const { action } = parse(
    z.object({ action: z.enum(["CANCEL", "RESUME", "REPAIR"]) }).strict(),
    raw,
  );
  const repairId = await transaction(async (tx) => {
    await tx.$executeRaw`SELECT id FROM "LmsEmployerImport" WHERE id=${id} AND "tenantId"=${c.tenantId} FOR UPDATE`;
    const draft = await ownedEmployerImport(c, id, tx);
    await importMembership(c, draft.customerId, true, tx);
    if (action === "REPAIR") {
      if (!["COMPLETED", "CANCELLED"].includes(draft.state))
        fail(409, "IMPORT_NOT_FINISHED", "Дождитесь завершения обработки");
      const key = `${draft.id}:${draft.revision}`;
      const prior = await tx.idempotencyOperation.findUnique({
        where: {
          tenantId_command_idempotencyKey: {
            tenantId: c.tenantId,
            command: "LMS_IMPORT_REPAIR",
            idempotencyKey: key,
          },
        },
      });
      if (prior) return (prior.result as { id: string }).id;
      const outcomes = await tx.lmsEmployerImportRow.findMany({
        where: { tenantId: c.tenantId, importId: id },
      });
      const failed = draft.operationId
        ? await tx.lmsAssignmentRow.findMany({
            where: {
              tenantId: c.tenantId,
              operationId: draft.operationId,
              outcome: "ERROR",
            },
            select: { recipientId: true },
          })
        : [];
      const failedIds = new Set(failed.map((row) => row.recipientId)),
        resultByRow = new Map(outcomes.map((row) => [row.sourceRow, row]));
      const original = importInputSchema.parse(draft.input),
        rows = original.rows
          .filter((row) => {
            const outcome = resultByRow.get(row.sourceRow);
            return (
              outcome?.outcome === "ERROR" ||
              (!!outcome?.recipientId && failedIds.has(outcome.recipientId))
            );
          })
          .map((row) => {
            const recipientId = resultByRow.get(row.sourceRow)?.recipientId;
            return {
              ...row,
              recipientId: recipientId || row.recipientId,
              resolution: recipientId ? ("REUSE" as const) : row.resolution,
            };
          });
      if (!rows.length)
        fail(409, "IMPORT_NO_ERRORS", "Нет строк для исправления");
      const newId = randomUUID(),
        input = { ...original, rows };
      const operation = draft.operationId
        ? await tx.lmsAssignmentOperation.findFirst({
            where: { tenantId: c.tenantId, id: draft.operationId },
            select: { groupId: true },
          })
        : null;
      await tx.lmsEmployerImport.create({
        data: {
          id: newId,
          tenantId: c.tenantId,
          actorId: c.userId,
          customerId: draft.customerId,
          courseVersionId: draft.courseVersionId,
          sourceOrderId: draft.sourceOrderId,
          sourceRequestId: draft.sourceRequestId,
          groupId: operation?.groupId || draft.groupId,
          groupName: draft.groupName,
          dueAt: draft.dueAt,
          input: json(input),
          inputHash: hash({ repairOf: id, input }),
        },
      });
      await tx.idempotencyOperation.create({
        data: {
          tenantId: c.tenantId,
          command: "LMS_IMPORT_REPAIR",
          idempotencyKey: key,
          payloadHash: hash({ repairOf: id }),
          result: json({ id: newId }),
        },
      });
      await audit(tx, c, "LMS_EMPLOYER_IMPORT_REPAIR_DRAFT", newId, {
        repairOf: id,
        rows: rows.length,
      });
      return newId;
    }
    if (
      action === "CANCEL" &&
      !["COMPLETED", "CANCELLED"].includes(draft.state)
    ) {
      await tx.lmsEmployerImport.update({
        where: { id },
        data: {
          state: "CANCELLED",
          leaseToken: null,
          leaseUntil: null,
          revision: { increment: 1 },
        },
      });
    } else if (
      action === "RESUME" &&
      ["PAUSED", "FAILED"].includes(draft.state)
    ) {
      await importMembership(c, draft.customerId, true, tx);
      await importCourse(c, draft.courseVersionId, tx);
      if (draft.operationId && isLmsStaff(c)) {
        await tx.$executeRaw`SELECT id FROM "LmsAssignmentOperation" WHERE id=${draft.operationId} AND "tenantId"=${c.tenantId} FOR UPDATE`;
        const operation = await tx.lmsAssignmentOperation.findFirst({
          where: { tenantId: c.tenantId, id: draft.operationId },
        });
        if (operation && operation.actorId !== c.userId) {
          await tx.lmsAssignmentOperation.update({
            where: { id: operation.id },
            data: { actorId: c.userId },
          });
          await audit(tx, c, "LMS_EMPLOYER_IMPORT_AUTHORITY_TRANSFERRED", id, {
            previousActorId: operation.actorId,
            operationId: operation.id,
            cursor: operation.cursor,
          });
        }
      }
      await tx.lmsEmployerImport.update({
        where: { id },
        data: {
          state: "QUEUED",
          confirmedBy: c.userId,
          errorCode: null,
          leaseToken: null,
          leaseUntil: null,
          revision: { increment: 1 },
        },
      });
    }
    await audit(tx, c, `LMS_EMPLOYER_IMPORT_${action}`, id, {
      cursor: draft.cursor,
    });
  });
  return employerImportDetail(c, repairId || id, {});
}
export async function listEmployerImports(c: Context) {
  if (!isLmsStaff(c) && c.role !== "EMPLOYER")
    fail(403, "ROLE_DENIED", "Недостаточно прав");
  const scope = isLmsStaff(c)
    ? Prisma.sql`true`
    : Prisma.sql`d."actorId"=${c.userId} AND EXISTS(SELECT 1 FROM "EmployerMembership" m WHERE m."tenantId"=d."tenantId" AND m."customerId"=d."customerId" AND m."userId"=${c.userId} AND m.active AND (m."expiresAt" IS NULL OR m."expiresAt">CURRENT_TIMESTAMP) AND m.permissions @> '["READ"]'::jsonb AND (m."recipientIds"='[]'::jsonb OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(d.input->'rows') source LEFT JOIN "LmsEmployerImportRow" prepared ON prepared."tenantId"=d."tenantId" AND prepared."importId"=d.id AND prepared."sourceRow"=(source->>'sourceRow')::integer WHERE NOT (m."recipientIds" @> jsonb_build_array(COALESCE(prepared."recipientId",source->>'recipientId'))))))`;
  return db.$queryRaw<
    {
      id: string;
      state: string;
      customerId: string;
      cursor: number;
      createdAt: Date;
      errorCode: string | null;
    }[]
  >(
    Prisma.sql`SELECT d.id,d.state,d."customerId",d.cursor,d."createdAt",d."errorCode" FROM "LmsEmployerImport" d WHERE d."tenantId"=${c.tenantId} AND (${scope}) ORDER BY d."updatedAt" DESC,d.id DESC LIMIT 30`,
  );
}

/** Materialize only authorized IDs for the exact search; later assignment rechecks each row. */
export async function assignmentSelection(c: Context, raw: unknown) {
  const query = parse(
    z
      .object({
        requestId: z.string().max(100).optional(),
        orderId: z.string().max(100).optional(),
        groupId: z.string().max(100).optional(),
        customerId: z.string().max(100).optional(),
        search: z.string().max(300).default(""),
      })
      .strict(),
    raw,
  );
  const context = await assignmentContext(c, query);
  const clauses = [Prisma.sql`r."tenantId"=${c.tenantId} AND NOT r.archived`];
  if (context.customerId && !context.contextRecipientIds) clauses.push(Prisma.sql`EXISTS (SELECT 1 FROM "RecipientEmployment" e WHERE e."tenantId"=r."tenantId" AND e."recipientId"=r.id AND e."employerId"=${context.customerId})`);
  if (context.contextRecipientIds)
    clauses.push(
      context.contextRecipientIds.length
        ? Prisma.sql`r.id IN (${Prisma.join(context.contextRecipientIds)})`
        : Prisma.sql`false`,
    );
  if (c.role === "EMPLOYER")
    clauses.push(
      Prisma.sql`EXISTS(SELECT 1 FROM "RecipientEmployment" e JOIN "EmployerMembership" m ON m."tenantId"=e."tenantId" AND m."customerId"=e."employerId" WHERE e."tenantId"=r."tenantId" AND e."recipientId"=r.id AND m."userId"=${c.userId} AND m.active AND (m."expiresAt" IS NULL OR m."expiresAt">CURRENT_TIMESTAMP) AND m.permissions @> '["ASSIGN_TRAINING"]'::jsonb AND (m."recipientIds"='[]'::jsonb OR m."recipientIds" @> jsonb_build_array(r.id)))`,
    );
  if (query.search.trim()) {
    const pattern = `%${query.search.trim().replace(/[\\%_]/g, "\\$&")}%`;
    clauses.push(
      Prisma.sql`(r.data->>'fullNameRu' ILIKE ${pattern} OR r.data->>'fullNameKz' ILIKE ${pattern})`,
    );
  }
  const rows = await db.$queryRaw<{ id: string }[]>(
    Prisma.sql`SELECT r.id FROM "Recipient" r WHERE ${Prisma.join(clauses, " AND ")} ORDER BY r."createdAt" DESC,r.id DESC LIMIT 10001`,
  );
  if (rows.length > 10000)
    fail(
      422,
      "IMPORT_ROW_LIMIT",
      "Уточните фильтр: допустимо до 10000 сотрудников в назначении",
    );
  return {
    recipientIds: rows.map((row) => row.id),
    total: rows.length,
    filter: query,
  };
}
