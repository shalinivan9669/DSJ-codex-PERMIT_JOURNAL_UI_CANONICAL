import { z, validDate } from "@demo/contracts";
import { buildZip } from "@demo/printing";
import { db, fail, parse, audit, type Context } from "./core";

function center(c: Context) {
  if (!["ADMIN", "OPERATOR", "VIEWER"].includes(c.role))
    fail(403, "ROLE_DENIED", "Требуется доступ сотрудника центра");
}
const date = z.string().refine(validDate, "Укажите календарную дату");
export async function centerDossierReminders(c: Context, input: unknown) {
  center(c);
  const data = parse(
    z.object({
      asOf: date,
      withinDays: z.coerce.number().int().min(0).max(365).default(30),
    }),
    input,
  );
  const limit = new Date(data.asOf + "T12:00:00Z");
  limit.setUTCDate(limit.getUTCDate() + data.withinDays);
  const until = limit.toISOString().slice(0, 10);
  const rows = await db.dossierRecord.findMany({
    where: { tenantId: c.tenantId, validUntil: { not: null, lte: until } },
    orderBy: { validUntil: "asc" },
    take: 1000,
  });
  return {
    items: rows.map((row) => ({
      ...row,
      state: row.validUntil! < data.asOf ? "DATE_PASSED_REVIEW" : "CONTACT_DUE",
      nextAction:
        "Проверить актуальность источника и запросить новую версию у ответственного",
    })),
    asOf: data.asOf,
    limitation:
      "Напоминание о сохранённой дате. Не является выводом о прекращении полномочий или государственной аккредитации.",
  };
}
export async function exportCenterDossier(c: Context, input: unknown) {
  center(c);
  const { recordIds } = parse(
    z
      .object({ recordIds: z.array(z.string().min(1).max(80)).min(1).max(100) })
      .strict(),
    input,
  );
  const ids = [...new Set(recordIds)];
  const rows = await db.dossierRecord.findMany({
    where: { tenantId: c.tenantId, id: { in: ids } },
  });
  if (rows.length !== ids.length)
    fail(404, "NOT_FOUND", "Запись досье не найдена");
  if (
    rows.some((row) => !row.customerVisible || row.category === "QUALIFICATION")
  )
    fail(
      403,
      "DOSSIER_PRIVATE",
      "Пакет заказчика допускает только явно разрешённые неперсональные записи",
    );
  const attachments = await db.valueAttachment.findMany({
    where: {
      tenantId: c.tenantId,
      dossierId: { in: ids },
      customerVisible: true,
    },
  });
  if (!attachments.length)
    fail(
      422,
      "DOSSIER_FILES_REQUIRED",
      "Прикрепите разрешённые файлы к выбранным записям",
    );
  const missing = rows
    .filter((row) => !attachments.some((file) => file.dossierId === row.id))
    .map((row) => ({
      id: row.id,
      reason: "Отсутствует разрешённый файл",
      category: row.category,
    }));
  const inventory = rows.map((row) => ({
    title: row.title,
    category: row.category,
    version: row.version,
    validUntil: row.validUntil,
    files: attachments
      .filter((a) => a.dossierId === row.id)
      .map((a) => a.fileName),
  }));
  const result = await buildZip(
    attachments.map((file) => ({
      ...file,
      format:
        file.mimeType === "application/pdf"
          ? "PDF"
          : file.mimeType === "image/png"
            ? "PNG"
            : "JPG",
      fileName: `${file.id.slice(0, 8)}-${file.fileName}`,
    })),
    "CENTER-DOSSIER",
    attachments.length,
    missing,
    {
      includeInventory: true,
      attachments: [
        {
          fileName: "Состав досье.json",
          base64: Buffer.from(JSON.stringify(inventory, null, 2)).toString(
            "base64",
          ),
        },
      ],
      coverText:
        "Документы, явно разрешённые центром для передачи заказчику. Пакет не удостоверяет государственную аккредитацию и не подтверждает актуальность без проверки исходного документа.",
    },
  );
  await audit(db, c, "CENTER_DOSSIER_EXPORTED", c.tenantId, {
    recordIds: ids,
    files: attachments.length,
    complete: result.metadata.complete,
  });
  return {
    buffer: result.buffer,
    mimeType: "application/zip",
    fileName: "Досье центра.zip",
  };
}
