import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Put,
  Query,
  Req,
  Res,
  UploadedFile,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import type { Response } from "express";
import { today, z } from "@demo/contracts";
import {
  calendarDefinitionSchema,
  dataAccessPolicySchema,
} from "@demo/contracts/src/regulatory-results";
import { exportRegistry, runRender, ArtifactStore } from "@demo/printing";
import {
  audit,
  db,
  fail,
  hash,
  json,
  parse,
  requireCapability,
  transaction,
  type Context,
  type DemoRequest,
} from "../core";

const store = new ArtifactStore();
const paging = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(30),
  state: z.enum(["PREPARED", "NEEDS_REVIEW"]).optional(),
});
export async function sanitaryBatch(c: Context, id: string) {
  const batch = await db.regulatoryBatch.findFirst({
    where: { id, tenantId: c.tenantId },
  });
  if (!batch) fail(404, "NOT_FOUND", "Список не найден");
  const rows = await db.regulatoryBatchItem.findMany({
    where: { batchId: id, tenantId: c.tenantId },
  });
  const [deliveries, journal, connection] = await Promise.all([
    db.integrationDelivery.findMany({
      where: {
        tenantId: c.tenantId,
        batchItemId: { in: rows.map((r) => r.id) },
      },
    }),
    db.sanitaryJournalEntry.findMany({
      where: {
        tenantId: c.tenantId,
        id: { in: rows.map((r) => r.journalEntryId) },
      },
    }),
    db.integrationConnection.findUnique({
      where: {
        tenantId_destination: {
          tenantId: c.tenantId,
          destination: batch.destination,
        },
      },
    }),
  ]);
  const states = rows.map(
    (row) =>
      deliveries.find((delivery) => delivery.batchItemId === row.id)?.state ||
      "NOT_PREPARED",
  );
  const accepted = states.filter((state) => state === "ACCEPTED").length;
  const deliveryState =
    states.length && accepted === states.length
      ? "ACCEPTED"
      : accepted
        ? "PARTIAL"
        : states.includes("UNKNOWN")
          ? "UNKNOWN"
          : states.every((state) => state === states[0])
            ? states[0] || "NOT_PREPARED"
            : "IN_PROGRESS";
  const deliveryCounts = {
    total: states.length,
    accepted,
    rejected: states.filter((state) => state === "REJECTED").length,
    unknown: states.filter((state) => state === "UNKNOWN").length,
    pending: states.filter(
      (state) => !["ACCEPTED", "REJECTED", "SUPERSEDED"].includes(state),
    ).length,
  };
  return {
    ...batch,
    deliveryState,
    deliveryCounts,
    overdue: !!batch.dueAt && batch.preparedAt > batch.dueAt,
    connectionState: connection?.state || "NOT_CONNECTED",
    items: rows.map((row) => ({
      ...row,
      signatureState: journal.find((j) => j.id === row.journalEntryId)
        ?.signatureState,
      delivery: deliveries.find((d) => d.batchItemId === row.id) || null,
    })),
  };
}
export async function listSanitary(c: Context, query: unknown) {
  const { page, pageSize, state } = parse(paging, query);
  const where = { tenantId: c.tenantId, ...(state ? { state } : {}) };
  const records = await db.regulatoryBatch.findMany({
    where,
    orderBy: { preparedAt: "desc" },
    skip: (page - 1) * pageSize,
    take: pageSize,
  });
  return {
    items: await Promise.all(records.map((r) => sanitaryBatch(c, r.id))),
    total: await db.regulatoryBatch.count({ where }),
    page,
    pageSize,
  };
}
export async function createCalendar(c: Context, input: unknown) {
  const data = parse(
    z
      .object({
        name: z.string().trim().min(1).max(200),
        timezone: z.string().max(100).default("Asia/Qyzylorda"),
        coverageFrom: z.string().date(),
        coverageUntil: z.string().date(),
        definition: calendarDefinitionSchema,
      })
      .strict(),
    input,
  );
  try {
    new Intl.DateTimeFormat("en", { timeZone: data.timezone }).format();
  } catch {
    fail(422, "TIMEZONE", "Проверьте часовой пояс");
  }
  if (data.coverageFrom > data.coverageUntil)
    fail(422, "CALENDAR_COVERAGE", "Проверьте период календаря");
  return transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${c.tenantId + ":calendar:" + data.name},0))`;
    const prior = await tx.calendarVersion.findFirst({
      where: { tenantId: c.tenantId, name: data.name },
      orderBy: { version: "desc" },
    });
    const record = await tx.calendarVersion.create({
      data: {
        ...data,
        definition: json(data.definition),
        tenantId: c.tenantId,
        version: (prior?.version || 0) + 1,
        approvedBy: c.userId,
      },
    });
    await audit(tx, c, "SANITARY_CALENDAR_VERSION", record.id, {
      version: record.version,
    });
    return record;
  });
}
export async function sanitaryExport(c: Context, id: string, input: unknown) {
  const { format, language } = parse(
    z.object({
      format: z.enum(["CSV", "XLSX", "PDF"]),
      language: z.enum(["ru", "kz"]).default("ru"),
    }),
    input,
  );
  const batch = await sanitaryBatch(c, id);
  const kz = language === "kz";
  const items = batch.items.map((row, index) => {
    const snap = row.snapshot as Record<string, unknown>;
    const learner = snap.learner as Record<string, unknown>;
    const employer = snap.employer as Record<string, unknown> | null;
    const course = snap.course as Record<string, unknown>;
    return {
      ordinal: String(index + 1),
      name: String(
        learner[kz ? "fullNameKz" : "fullNameRu"] || learner.fullNameRu || "",
      ),
      employer: String(
        employer?.[kz ? "nameKz" : "nameRu"] || employer?.nameRu || "",
      ),
      address: String(
        employer?.[kz ? "addressKz" : "addressRu"] || employer?.addressRu || "",
      ),
      position: String(
        learner[kz ? "positionKz" : "positionRu"] || learner.positionRu || "",
      ),
      course: String(
        course[kz ? "titleKz" : "titleRu"] || course.titleRu || "",
      ),
      examDate: String(
        snap.examDate ||
          (snap.examAt
            ? today(
                String((batch.snapshot as Record<string, unknown>).timezone),
                new Date(String(snap.examAt)),
              )
            : ""),
      ),
      result: kz ? "Тапсырды" : "Сдал",
      signature:
        row.signatureState === "AWAITING_SIGNATURE"
          ? kz
            ? "Қол қою күтілуде"
            : "Ожидает подписи"
          : row.signatureState === "SIGNED"
            ? kz
              ? "Қол қойылды"
              : "Подписано"
            : kz
              ? "Талап етілмейді"
              : "Не требуется",
    };
  });
  const columns = [
    { field: "ordinal", title: "№" },
    { field: "name", title: kz ? "Аты-жөні" : "ФИО" },
    { field: "employer", title: kz ? "Жұмыс беруші" : "Работодатель" },
    { field: "address", title: kz ? "Мекенжай" : "Адрес" },
    { field: "position", title: kz ? "Лауазымы" : "Должность" },
    { field: "course", title: kz ? "Бағдарлама" : "Программа" },
    { field: "examDate", title: kz ? "Емтихан күні" : "Дата экзамена" },
    { field: "result", title: kz ? "Нәтиже" : "Результат" },
    { field: "signature", title: kz ? "Қолтаңба" : "Подпись" },
  ];
  let buffer: Buffer;
  if (format === "CSV") {
    const safe = (s: string) =>
      '"' +
      (/^[\s]*[=+\-@\t\r]/.test(s) ? "'" + s : s).replaceAll('"', '""') +
      '"';
    buffer = Buffer.from(
      "\ufeff" +
        [
          columns.map((x) => safe(x.title)).join(";"),
          ...items.map((row) =>
            columns
              .map((x) => safe(String(row[x.field as keyof typeof row])))
              .join(";"),
          ),
        ].join("\r\n"),
      "utf8",
    );
  } else if (format === "XLSX")
    buffer = (await exportRegistry(items, columns)).buffer;
  else
    buffer = (
      await runRender("regulatory-list", {
        items,
        columns,
        title: kz
          ? "Оқу орталығының ішкі тізімі"
          : "Внутренний список учебного центра",
        note: kz
          ? "Сыртқы жүйенің қабылдауы расталмаған. Медициналық рұқсат емес."
          : "Принятие внешней системой не подтверждено. Не является медицинским допуском.",
      })
    ).buffer;
  await audit(db, c, "SANITARY_INTERNAL_EXPORT", id, {
    format,
    rows: items.length,
    sha256: hash(buffer.toString("base64")),
  });
  return {
    buffer,
    fileName: `internal-training-list-${id}.${format.toLowerCase()}`,
    mimeType:
      format === "CSV"
        ? "text/csv; charset=utf-8"
        : format === "PDF"
          ? "application/pdf"
          : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  };
}
export async function addManualEvidence(
  c: Context,
  id: string,
  body: unknown,
  file?: Express.Multer.File,
) {
  const data = parse(
    z
      .object({
        source: z.string().trim().min(2).max(500),
        reference: z.string().trim().max(1000).default(""),
      })
      .strict(),
    body,
  );
  if (!data.reference && !file)
    fail(
      422,
      "EVIDENCE_REQUIRED",
      "Укажите номер, ссылку или приложите подтверждение",
    );
  const delivery = await db.integrationDelivery.findFirst({
    where: { id, tenantId: c.tenantId },
  });
  if (!delivery) fail(404, "NOT_FOUND", "Запись не найдена");
  let stored: { storageKey: string; sha256: string } | undefined;
  if (file) {
    const bytes = file.buffer;
    const pdf = bytes.subarray(0, 5).toString() === "%PDF-";
    const png = bytes
      .subarray(0, 8)
      .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    const jpg = bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
    if (bytes.length > 5 * 1024 * 1024 || !(pdf || png || jpg))
      fail(422, "EVIDENCE_FILE", "Выберите PDF, PNG или JPG до 5 МБ");
    const saved = await store.put(bytes, pdf ? "pdf" : png ? "png" : "jpg");
    stored = { storageKey: saved.storageKey, sha256: saved.sha256 };
  }
  return transaction(async (tx) => {
    const record = await tx.regulatoryManualEvidence.create({
      data: {
        tenantId: c.tenantId,
        deliveryId: id,
        actorId: c.userId,
        ...data,
        ...stored,
      },
    });
    await audit(tx, c, "SANITARY_OPERATOR_EVIDENCE", record.id, {
      deliveryId: id,
      resultRevision: delivery.resultRevision,
      category: "OPERATOR_ATTESTED",
    });
    return {
      id: record.id,
      category: record.category,
      createdAt: record.createdAt,
    };
  });
}
function sendExport(
  res: Response,
  file: { buffer: Buffer; fileName: string; mimeType: string },
) {
  res.setHeader("Content-Type", file.mimeType);
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="${file.fileName}"`,
  );
  res.setHeader("Cache-Control", "private, no-store");
  res.send(file.buffer);
}
@Controller()
export class RegulatoryResultsController {
  @Get("lms/sanitary") list(@Req() req: DemoRequest, @Query() query: unknown) {
    return listSanitary(requireCapability(req, "regulatory:manage"), query);
  }
  @Get("lms/sanitary/calendars") calendars(@Req() req: DemoRequest) {
    return db.calendarVersion.findMany({
      where: { tenantId: requireCapability(req, "regulatory:manage").tenantId },
      orderBy: { approvedAt: "desc" },
      take: 100,
    });
  }
  @Post("lms/sanitary/calendars") calendar(
    @Req() req: DemoRequest,
    @Body() body: unknown,
  ) {
    return createCalendar(requireCapability(req, "center:manage"), body);
  }
  @Get("lms/sanitary/settings") async settings(@Req() req: DemoRequest) {
    const c = requireCapability(req, "center:manage");
    return {
      connection: "NOT_CONNECTED",
      connections: await db.integrationConnection.findMany({
        where: { tenantId: c.tenantId },
      }),
      dataAccessPolicy: dataAccessPolicySchema.parse({}),
      calendarVersions: await db.calendarVersion.findMany({
        where: { tenantId: c.tenantId },
        take: 100,
      }),
    };
  }
  @Put("lms/sanitary/settings") async saveSettings(
    @Req() req: DemoRequest,
    @Body() body: unknown,
  ) {
    const c = requireCapability(req, "center:manage");
    const data = parse(
      z
        .object({
          destination: z.string().min(1).max(100),
          dataAccessPolicy: dataAccessPolicySchema,
        })
        .strict(),
      body,
    );
    return transaction(async (tx) => {
      const result = await tx.integrationConnection.upsert({
        where: {
          tenantId_destination: {
            tenantId: c.tenantId,
            destination: data.destination,
          },
        },
        create: {
          tenantId: c.tenantId,
          destination: data.destination,
          dataAccessPolicy: json(data.dataAccessPolicy),
        },
        update: { dataAccessPolicy: json(data.dataAccessPolicy) },
      });
      await audit(tx, c, "SANITARY_ACCESS_POLICY", result.id);
      return result;
    });
  }
  @Get("lms/sanitary/subjects") async subjects(@Req() req: DemoRequest) {
    const c = requireCapability(req, "center:manage");
    const [linked, recipients, tenant] = await Promise.all([
      db.learnerProfile.count({ where: { tenantId: c.tenantId } }),
      db.recipient.count({ where: { tenantId: c.tenantId } }),
      db.tenant.findUniqueOrThrow({ where: { id: c.tenantId } }),
    ]);
    return {
      operatorName: tenant.name,
      confirmedUniqueLearnerSubjects: linked,
      recipientRecords: recipients,
      unlinkedRecipientRecords: Math.max(0, recipients - linked),
      operatorConsolidation: "REQUIRES_OWNER_CONFIRMATION",
    };
  }
  @Get("lms/sanitary/:id") async detail(
    @Req() req: DemoRequest,
    @Param("id") id: string,
  ) {
    const c = requireCapability(req, "regulatory:manage");
    const batch = await sanitaryBatch(c, id);
    const deliveryIds = batch.items.flatMap((row) =>
      row.delivery ? [row.delivery.id] : [],
    );
    return {
      ...batch,
      evidence: await db.regulatoryManualEvidence.findMany({
        where: { tenantId: c.tenantId, deliveryId: { in: deliveryIds } },
        select: {
          id: true,
          deliveryId: true,
          source: true,
          reference: true,
          category: true,
          actorId: true,
          createdAt: true,
          sha256: true,
        },
      }),
      history: await db.deliveryAttempt.findMany({
        where: { tenantId: c.tenantId, deliveryId: { in: deliveryIds } },
        orderBy: { createdAt: "desc" },
        take: 100,
      }),
    };
  }
  @Get("lms/sanitary/:id/export") async export(
    @Req() req: DemoRequest,
    @Param("id") id: string,
    @Query() query: unknown,
    @Res() res: Response,
  ) {
    return sendExport(
      res,
      await sanitaryExport(
        requireCapability(req, "regulatory:manage"),
        id,
        query,
      ),
    );
  }
  @Get("lms/sanitary/evidence/:id/file") async evidenceFile(
    @Req() req: DemoRequest,
    @Param("id") id: string,
    @Res() res: Response,
  ) {
    const c = requireCapability(req, "regulatory:manage");
    const evidence = await db.regulatoryManualEvidence.findFirst({
      where: { id, tenantId: c.tenantId },
    });
    if (!evidence?.storageKey || !evidence.sha256)
      fail(404, "NOT_FOUND", "Вложение не найдено");
    let bytes: Buffer;
    try {
      bytes = await store.read(evidence.storageKey, evidence.sha256);
    } catch {
      fail(503, "EVIDENCE_UNAVAILABLE", "Вложение отсутствует или повреждено");
    }
    const extension = evidence.storageKey.split(".").at(-1);
    res.setHeader("Cache-Control", "private, no-store");
    res.setHeader(
      "Content-Type",
      extension === "pdf"
        ? "application/pdf"
        : extension === "png"
          ? "image/png"
          : "image/jpeg",
    );
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="evidence-${evidence.id}.${extension}"`,
    );
    res.send(bytes);
    await audit(db, c, "SANITARY_EVIDENCE_DOWNLOADED", evidence.id);
  }
  @Post("lms/sanitary/deliveries/:id/evidence")
  @UseInterceptors(
    FileInterceptor("file", {
      limits: { fileSize: 5 * 1024 * 1024, files: 1, fields: 2 },
    }),
  )
  evidence(
    @Req() req: DemoRequest,
    @Param("id") id: string,
    @Body() body: unknown,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    return addManualEvidence(
      requireCapability(req, "regulatory:manage"),
      id,
      body,
      file,
    );
  }
}
