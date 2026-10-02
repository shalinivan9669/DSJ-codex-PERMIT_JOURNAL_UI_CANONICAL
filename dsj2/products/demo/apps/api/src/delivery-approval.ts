import {
  draftSchema,
  profileSchema,
  validateDraft,
  validDate,
  z,
  type Draft,
} from "@demo/contracts";
import { exportRegistry, MIME, runRender } from "@demo/printing";
import {
  audit,
  db,
  fail,
  hash,
  parse,
  scopedRequest,
  transaction,
  type Context,
} from "./core";
import { resolvedRequest } from "./requests";
import { workingRequest } from "./approvals";
import { flattenExportRow } from "./delivery";
import { readArtifact } from "./files";

export const CONTROL_NOTICE = "Данные для проверки — не выданный документ";
/** Only facts the customer checks participate. Internal titles, import provenance and notes do not. */
export function meaningfulControlData(draft: Draft) {
  return {
    customerId: draft.customerId,
    items: draft.items.map((item) => ({
      id: item.id,
      recipientId: item.recipientId,
      personnelNumber: item.personnelNumber,
      fullNameRu: item.fullNameRu,
      fullNameKz: item.fullNameKz,
      workplaceRu: item.workplaceRu,
      workplaceKz: item.workplaceKz,
      positionRu: item.positionRu,
      positionKz: item.positionKz,
      departmentRu: item.departmentRu,
      departmentKz: item.departmentKz,
      employerId: item.employerId,
      employerBin: item.employerBin,
      employerAddressRu: item.employerAddressRu,
      employerAddressKz: item.employerAddressKz,
      assignments: item.assignments.map((assignment) => ({
        id: assignment.id,
        templateId: assignment.templateId,
        eventId: assignment.eventId,
        documentDate: assignment.documentDate,
        trainingStart: assignment.trainingStart,
        trainingEnd: assignment.trainingEnd,
        protocolDate: assignment.protocolDate,
        validUntil: assignment.validUntil,
        trainingSubject: assignment.trainingSubject,
        hours: assignment.hours,
        productionHours: assignment.productionHours,
        externalBasisNumber: assignment.externalBasisNumber,
        protocolMode: assignment.protocolMode,
        biotCategory: assignment.biotCategory,
        reason: assignment.reason,
        education: assignment.education,
        biotIndustryRu: assignment.biotIndustryRu,
        biotIndustryKz: assignment.biotIndustryKz,
      })),
    })),
  };
}
export async function controlSheet(c: Context, id: string) {
  const record = await workingRequest(c, id);
  const issuance = await db.issuance.findFirst({
    where: { tenantId: c.tenantId, requestId: id },
    orderBy: { createdAt: "desc" },
  });
  const draft = issuance
    ? draftSchema.parse((issuance.snapshot as { draft: unknown }).draft)
    : (await resolvedRequest(c, id)).draft;
  const customer = issuance
    ? (
        issuance.snapshot as {
          customer?: { nameRu?: string; nameKz?: string; bin?: string };
        }
      ).customer || null
    : draft.customerId
      ? await db.customerOrganization.findFirst({
          where: { tenantId: c.tenantId, id: draft.customerId },
        })
      : null;
  // Employer fallback is part of the facts shown to the customer, so its change invalidates confirmation.
  const effective = {
    ...draft,
    items: draft.items.map((item) => ({
      ...item,
      workplaceRu: item.workplaceRu || customer?.nameRu || "",
      workplaceKz: item.workplaceKz || customer?.nameKz || "",
      employerBin: item.employerBin || customer?.bin || "",
    })),
  };
  const meaningfulHash = hash(meaningfulControlData(effective));
  const rows = effective.items.flatMap((item) =>
    (item.assignments.length ? item.assignments : [undefined]).map(
      (assignment) => ({
        ...flattenExportRow({ ...item, assignment }),
        notice: CONTROL_NOTICE,
      }),
    ),
  );
  const events = await db.auditEvent.findMany({
    where: {
      tenantId: c.tenantId,
      entityId: id,
      action: "CONTROL_DATA_CONFIRMED",
    },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
  return {
    revision: record.revision,
    meaningfulHash,
    title: CONTROL_NOTICE,
    rows,
    confirmations: events.map((event) => ({
      id: event.id,
      actorId: event.actorId,
      createdAt: event.createdAt,
      ...(event.metadata as Record<string, unknown>),
      current:
        (event.metadata as { meaningfulHash?: string }).meaningfulHash ===
        meaningfulHash,
    })),
  };
}
export async function confirmControlSheet(
  c: Context,
  id: string,
  input: unknown,
) {
  const data = parse(
    z
      .object({
        expectedRevision: z.number().int().nonnegative(),
        meaningfulHash: z.string().regex(/^[a-f0-9]{64}$/),
        confirmedBy: z.string().trim().min(2).max(250),
        source: z.string().trim().min(3).max(500),
      })
      .strict(),
    input,
  );
  return transaction(async (tx) => {
    await tx.$executeRaw`SELECT id FROM "PrintRequest" WHERE id=${id} AND "tenantId"=${c.tenantId} FOR UPDATE`;
    const record = await workingRequest(c, id, tx);
    if (record.revision !== data.expectedRevision)
      fail(
        409,
        "REVISION_CONFLICT",
        "Состав заявки изменился. Проверьте актуальный контрольный лист",
      );
    const sheet = await controlSheet(c, id);
    if (sheet.meaningfulHash !== data.meaningfulHash)
      fail(
        409,
        "CONFIRMATION_STALE",
        "Значимые данные изменились. Получите новое подтверждение",
      );
    await audit(tx, c, "CONTROL_DATA_CONFIRMED", id, {
      ...data,
      notice: "Сверка сведений; не ЭЦП и не результат экзамена",
    });
    return {
      confirmed: true,
      meaningfulHash: sheet.meaningfulHash,
      revision: record.revision,
    };
  });
}
export async function exportControlSheet(
  c: Context,
  id: string,
  input: unknown,
) {
  const data = parse(
    z.object({ format: z.enum(["XLSX", "PDF"]).default("XLSX") }).strict(),
    input,
  );
  const sheet = await controlSheet(c, id);
  const columns = [
    { field: "notice", title: CONTROL_NOTICE },
    { field: "sourceRow", title: "Строка источника" },
    { field: "personnelNumber", title: "Табельный номер" },
    { field: "fullNameRu", title: "ФИО RU" },
    { field: "fullNameKz", title: "ФИО KZ" },
    { field: "workplaceRu", title: "Работодатель" },
    { field: "positionRu", title: "Должность" },
    { field: "programLabel", title: "Документ / направление" },
    { field: "trainingSubject", title: "Программа" },
    { field: "trainingStart", title: "Начало" },
    { field: "trainingEnd", title: "Окончание" },
    { field: "documentDate", title: "Дата оформления" },
  ];
  const output =
    data.format === "PDF"
      ? await runRender(
          "control-sheet",
          {
            rows: sheet.rows,
            notice: CONTROL_NOTICE,
            revision: sheet.revision,
            meaningfulHash: sheet.meaningfulHash,
          },
          { timeoutMs: 210_000 },
        )
      : await exportRegistry(sheet.rows, columns);
  return {
    buffer: output.buffer,
    fileName: "Данные для проверки." + data.format.toLowerCase(),
    mimeType: MIME[data.format],
  };
}
export async function clarificationRequest(
  c: Context,
  id: string,
  customerId?: string,
) {
  const record = await workingRequest(c, id);
  const { draft, issues: resolvedIssues } = await resolvedRequest(c, id);
  if (customerId) {
    parse(z.string().uuid(), customerId);
    if (
      !(await db.customerOrganization.findFirst({
        where: { id: customerId, tenantId: c.tenantId },
      }))
    )
      fail(404, "NOT_FOUND", "Заказчик не найден");
  }
  const permittedItems = customerId
    ? draft.items.filter(
        (item) => (item.employerId || draft.customerId) === customerId,
      )
    : draft.items;
  const scopes = new Set(
    draft.items.map((item) => item.employerId || draft.customerId || ""),
  );
  const profile = await db.issuerProfileVersion.findFirst({
    where: { tenantId: c.tenantId },
    orderBy: { version: "desc" },
  });
  const issues = [
    ...resolvedIssues,
    ...validateDraft(
      draft,
      profile ? profileSchema.parse(profile.profile) : null,
    ),
  ];
  const customerFields = new Set([
    "fullNameRu",
    "fullNameKz",
    "workplaceRu",
    "workplaceKz",
    "positionRu",
    "positionKz",
    "employerBin",
    "employerAddressRu",
    "employerAddressKz",
    "photoAssetId",
    "trainingStart",
    "trainingEnd",
    "externalBasisNumber",
    "education",
  ]);
  const unique = new Map<
    string,
    { sourceRow?: number; personnelNumber?: string; message: string }
  >();
  let operatorIssueCount = 0;
  for (const issue of issues) {
    if (
      customerId &&
      issue.rowId &&
      !permittedItems.some((row) => row.id === issue.rowId)
    )
      continue;
    const item = permittedItems.find((row) => row.id === issue.rowId);
    const field = issue.path.split(".").at(-1)!;
    if (!item || !customerFields.has(field)) {
      operatorIssueCount++;
      continue;
    }
    const value = {
      sourceRow: item.sourceRow,
      personnelNumber: item.personnelNumber,
      message: issue.message,
    };
    unique.set(JSON.stringify(value), value);
  }
  const items = [...unique.values()];
  const text = items.length
    ? "Здравствуйте! Просим уточнить сведения для подготовки документов:\n" +
      items
        .map((item) =>
          [
            item.sourceRow ? `Строка ${item.sourceRow}` : "Получатель",
            item.personnelNumber ? `таб. № ${item.personnelNumber}` : "",
            item.message,
          ]
            .filter(Boolean)
            .join(" — "),
        )
        .join("\n") +
      "\nПришлите, пожалуйста, уточнённые значения. Спасибо!"
    : "Сейчас уточнений сведений у заказчика не требуется.";
  return {
    revision: record.revision,
    text,
    items,
    operatorIssueCount,
    customerId: customerId || null,
    readyToCopy: !!customerId || scopes.size <= 1,
    sent: false,
  };
}
export async function listTransfers(c: Context, id: string) {
  await scopedRequest(c, id);
  return {
    items: await db.auditEvent.findMany({
      where: {
        tenantId: c.tenantId,
        entityId: id,
        action: { in: ["DOCUMENTS_TRANSFERRED", "DAMAGED_COPY_REPRINT"] },
      },
      orderBy: { createdAt: "desc" },
    }),
  };
}
export async function recordTransfer(c: Context, id: string, input: unknown) {
  const data = parse(
    z
      .object({
        artifactIds: z.array(z.string().max(80)).min(1).max(1000),
        recipient: z.string().trim().min(2).max(500),
        occurredOn: z.string().refine(validDate, "Укажите календарную дату"),
        method: z.enum(["EMAIL", "PORTAL", "PAPER", "OTHER"]),
        kind: z.enum(["TRANSFER", "REPRINT_DAMAGED"]).default("TRANSFER"),
        reason: z.string().trim().max(1000).default(""),
      })
      .strict(),
    input,
  );
  await scopedRequest(c, id);
  if (data.kind === "REPRINT_DAMAGED" && data.reason.length < 3)
    fail(
      400,
      "REPRINT_REASON",
      "Укажите причину повторной печати испорченного экземпляра",
    );
  const artifactIds = [...new Set(data.artifactIds)];
  const files = await db.artifact.findMany({
    where: {
      tenantId: c.tenantId,
      requestId: id,
      issuanceId: { not: null },
      id: { in: artifactIds },
      provenance: { not: "PREVIEW" },
    },
  });
  if (files.length !== artifactIds.length)
    fail(
      404,
      "ARTIFACT_NOT_FOUND",
      "Один из выбранных оформленных файлов не найден",
    );
  for (const artifact of files) await readArtifact(c, artifact.id);
  await audit(
    db,
    c,
    data.kind === "TRANSFER" ? "DOCUMENTS_TRANSFERRED" : "DAMAGED_COPY_REPRINT",
    id,
    {
      ...data,
      files: files.map((file) => ({
        id: file.id,
        sha256: file.sha256,
        format: file.format,
        documentId: file.documentId,
      })),
    },
  );
  return { recorded: true, count: files.length, kind: data.kind };
}
