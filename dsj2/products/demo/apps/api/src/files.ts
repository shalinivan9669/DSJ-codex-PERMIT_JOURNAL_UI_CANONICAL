import sharp, { type Metadata } from "sharp";
import { extname } from "node:path";
import {
  ArtifactStore,
  parseImport,
  exportRegistry,
  MIME,
  RENDERER_VERSION,
  buildZip,
  selectBundleJobs,
} from "@demo/printing";
import { LIMITS, itemSchema, draftSchema, z } from "@demo/contracts";
import {
  db,
  fail,
  parse,
  audit,
  transaction,
  hash,
  json,
  scopedRequest,
  type Context,
} from "./core";
import { patchRequest, requestFilter } from "./requests";
export const store = new ArtifactStore();
export async function uploadPhoto(
  c: Context,
  file: Express.Multer.File | undefined,
  input: Record<string, unknown>,
) {
  if (!file) fail(400, "FILE_REQUIRED", "Выберите PNG или JPEG");
  if (file.size > LIMITS.photoBytes)
    fail(413, "PHOTO_TOO_LARGE", "Фото больше 5 МиБ");
  // Select the raster decoder before metadata(): otherwise SVG/XML is parsed
  // by libvips even when its detected format is rejected afterwards.
  const isPng = file.buffer
    .subarray(0, 8)
    .equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  const isJpeg =
    file.buffer[0] === 0xff &&
    file.buffer[1] === 0xd8 &&
    file.buffer[2] === 0xff;
  if (!isPng && !isJpeg)
    fail(400, "PHOTO_TYPE", "Используйте обычное PNG или JPEG");
  const rotation = parse(
    z.coerce.number().refine((v) => [0, 90, 180, 270].includes(v)),
    input.rotation || 0,
  );
  let crop: { x: number; y: number; width: number; height: number } | undefined;
  if (input.crop) {
    try {
      crop = parse(
        z
          .object({
            x: z.number().int().nonnegative(),
            y: z.number().int().nonnegative(),
            width: z.number().int().positive(),
            height: z.number().int().positive(),
          })
          .strict(),
        typeof input.crop === "string" ? JSON.parse(input.crop) : input.crop,
      );
    } catch {
      fail(400, "CROP_INVALID", "Проверьте границы обрезки");
    }
  }
  let metadata: Metadata;
  let normalized: Buffer;
  try {
    const original = sharp(file.buffer, {
      limitInputPixels: LIMITS.imagePixels,
      failOn: "warning",
    });
    metadata = await original.metadata();
    if (
      !["png", "jpeg"].includes(metadata.format || "") ||
      !metadata.width ||
      !metadata.height ||
      (metadata.pages || 1) > 1
    )
      fail(400, "PHOTO_TYPE", "Используйте обычное PNG или JPEG");
    let pipeline = original.autoOrient().rotate(rotation);
    if (crop)
      pipeline = pipeline.extract({
        left: crop.x,
        top: crop.y,
        width: crop.width,
        height: crop.height,
      });
    normalized = await pipeline
      .resize({
        width: 1200,
        height: 1600,
        fit: "inside",
        withoutEnlargement: true,
      })
      .png()
      .toBuffer();
  } catch (e) {
    if (e && typeof e === "object" && "getStatus" in e) throw e;
    fail(
      400,
      "PHOTO_DECODE",
      "Изображение повреждено или превышает предел 20 Мп",
    );
  }
  const dimensions = await sharp(normalized).metadata();
  const original = await store.put(
    file.buffer,
    metadata.format === "jpeg" ? "jpg" : "png",
  );
  const asset = await store.put(normalized, "png");
  const photo = await db.photoAsset.create({
    data: {
      tenantId: c.tenantId,
      ownerId: c.userId,
      ...asset,
      originalStorageKey: original.storageKey,
      width: dimensions.width!,
      height: dimensions.height!,
      mimeType: "image/png",
    },
  });
  await audit(db, c, "PHOTO_UPLOADED", photo.id, {
    width: photo.width,
    height: photo.height,
    size: photo.size,
  });
  return {
    assetId: photo.id,
    id: photo.id,
    width: photo.width,
    height: photo.height,
    url: `/api/photos/${photo.id}`,
    warnings:
      photo.width < 354 || photo.height < 472
        ? ["Для печати 3×4 см желательно не менее 354×472 пикселей"]
        : [],
  };
}
export async function readPhoto(c: Context, id: string) {
  const photo = await db.photoAsset.findFirst({
    where: { id, tenantId: c.tenantId },
  });
  if (!photo) fail(404, "NOT_FOUND", "Фото не найдено");
  try {
    return {
      buffer: await store.read(photo.storageKey, photo.sha256),
      mimeType: photo.mimeType,
      fileName: `photo-${photo.id}.png`,
    };
  } catch {
    fail(503, "PHOTO_UNAVAILABLE", "Файл фото недоступен");
  }
}
export async function readArtifact(c: Context, id: string) {
  const artifact = await db.artifact.findFirst({
    where: { id, tenantId: c.tenantId },
  });
  if (!artifact) fail(404, "NOT_FOUND", "Файл не найден");
  try {
    const buffer = await store.read(artifact.storageKey, artifact.sha256);
    if (buffer.length !== artifact.size) throw new Error("SIZE");
    return { ...artifact, buffer };
  } catch {
    await audit(db, c, "ARTIFACT_STORAGE_FAILURE", artifact.id);
    fail(
      503,
      "ARTIFACT_UNAVAILABLE",
      "Сохранённый файл отсутствует или повреждён. Требуется восстановление, оригинал не подменён",
    );
  }
}
export async function restoreArtifact(c: Context, id: string, input: unknown) {
  const { reason } = parse(
    z.object({ reason: z.string().trim().min(3).max(1000) }).strict(),
    input,
  );
  return transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${c.tenantId + ":restore:" + id},0))`;
    const original = await tx.artifact.findFirst({
      where: { id, tenantId: c.tenantId },
    });
    if (!original) fail(404, "NOT_FOUND", "Файл не найден");
    // Reconstruction is explicit and retains the original record even when its bytes have been lost.
    const prior = await tx.generationJob.findMany({
      where: {
        tenantId: c.tenantId,
        logicalKey: { startsWith: `restore:${id}:` },
      },
    });
    if (prior.length) return { jobs: prior, restoreOfArtifactId: id };
    const originalJob = await tx.generationJob.findFirstOrThrow({
      where: { id: original.jobId, tenantId: c.tenantId },
    });
    const snapshot = await tx.renderInputSnapshot.findFirstOrThrow({
      where: { id: originalJob.snapshotId, tenantId: c.tenantId },
    });
    const renderInput = {
      ...(snapshot.input as Record<string, unknown>),
      provenance: "RECONSTRUCTED",
      restoreOfArtifactId: id,
      originalSha256: original.sha256,
    };
    const replacement = await tx.renderInputSnapshot.create({
      data: {
        tenantId: c.tenantId,
        requestId: snapshot.requestId,
        revision: snapshot.revision,
        issuanceId: snapshot.issuanceId,
        templateVersionId: snapshot.templateVersionId,
        profileVersionId: snapshot.profileVersionId,
        input: json(renderInput),
        inputHash: hash(renderInput),
      },
    });
    const jobs = [];
    for (const kind of original.format === "PDF"
      ? ["DOCX", "PDF"]
      : [original.format]) {
      jobs.push(
        await tx.generationJob.create({
          data: {
            tenantId: c.tenantId,
            requestId: original.requestId,
            issuanceId: original.issuanceId,
            documentId: original.documentId,
            snapshotId: replacement.id,
            kind,
            logicalKey: `restore:${id}:${kind}`,
          },
        }),
      );
    }
    await audit(tx, c, "ARTIFACT_RECONSTRUCTION_REQUESTED", id, {
      reason,
      originalSha256: original.sha256,
      jobIds: jobs.map((j) => j.id),
    });
    return { jobs, restoreOfArtifactId: id };
  });
}
export async function importPreview(
  c: Context,
  file: Express.Multer.File | undefined,
  sheet?: string,
) {
  if (!file) fail(400, "FILE_REQUIRED", "Выберите файл");
  if (file.size > LIMITS.importBytes)
    fail(413, "IMPORT_TOO_LARGE", "Файл больше 5 МиБ");
  const format = extname(file.originalname).slice(1).toLowerCase();
  if (!["xlsx", "csv", "tsv"].includes(format))
    fail(400, "IMPORT_FORMAT", "Поддерживаются XLSX, CSV и TSV без макросов");
  let parsed: Record<string, unknown>;
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
      "Не удалось прочитать файл: проверьте формат, формулы, внешние ссылки и ограничения размера",
    );
  }
  const columns = (parsed.headers || []) as string[];
  const source = (parsed.rawRows || parsed.rows || []) as Array<{
    rowNumber: number;
    values: Record<string, string> | string[];
    errors: string[];
    sourceId?: string;
  }>;
  const seen = new Set<string>();
  const rows = source.map((row) => {
    const values = Array.isArray(row.values)
      ? row.values
      : columns.map((h) => (row.values as Record<string, string>)[h] || "");
    const digest = hash(values);
    const duplicate = seen.has(digest);
    seen.add(digest);
    return {
      sourceRow: row.rowNumber,
      values,
      errors: row.errors || [],
      duplicate,
    };
  });
  const checksum = hash(
    file.buffer.toString("base64") + "|" + String(parsed.sheet || ""),
  );
  // Prisma may emulate an empty-update upsert with read/create. Retry the
  // unique-constraint race so concurrent uploads return the same durable batch.
  const record = await transaction((tx) =>
    tx.importBatch.upsert({
      where: { tenantId_checksum: { tenantId: c.tenantId, checksum } },
      create: {
        tenantId: c.tenantId,
        checksum,
        rows: json({ columns, rows, errors: parsed.errors || [] }),
      },
      update: {},
    }),
  );
  return {
    importId: record.id,
    sheets: parsed.sheets || [],
    sheet: parsed.sheet || "",
    columns,
    rows,
    total: rows.length,
    checksum: record.checksum,
    errors: parsed.errors || [],
    canApply:
      rows.length <= LIMITS.rows &&
      !((parsed.errors as unknown[]) || []).length &&
      !rows.some((row) => row.errors.length),
  };
}
export async function applyImport(c: Context, id: string, input: unknown) {
  const data = parse(
    z
      .object({
        expectedRevision: z.number().int(),
        importId: z.string(),
        rows: z.array(itemSchema).max(LIMITS.rows),
      })
      .strict(),
    input,
  );
  const batch = await db.importBatch.findFirst({
    where: { id: data.importId, tenantId: c.tenantId },
  });
  if (!batch) fail(404, "IMPORT_NOT_FOUND", "Импорт не найден");
  const record = await scopedRequest(c, id);
  const draft = draftSchema.parse(record.draft);
  const previous = draft.items.filter((i) => i.importId === data.importId);
  if (previous.length)
    return {
      id,
      status: record.status,
      revision: record.revision,
      ...draft,
      importResult: { applied: previous.length, repeated: true },
    };
  const source = (batch.rows as { rows: Array<{ sourceRow: number }> }).rows;
  const sourceRows = new Set(source.map((r) => r.sourceRow));
  if (
    data.rows.some(
      (r) =>
        r.importId !== batch.id ||
        r.sourceRow === undefined ||
        !sourceRows.has(r.sourceRow),
    )
  )
    fail(400, "IMPORT_SOURCE", "Неверная ссылка на исходную строку");
  if (new Set(data.rows.map((r) => r.sourceRow)).size !== data.rows.length)
    fail(400, "IMPORT_DUPLICATE", "Исходная строка выбрана дважды");
  if (draft.items.length + data.rows.length > LIMITS.rows)
    fail(422, "ROW_LIMIT", "Максимум 100 получателей; строки не обрезаны");
  const result = await patchRequest(c, id, {
    expectedRevision: data.expectedRevision,
    draft: { ...draft, items: [...draft.items, ...data.rows] },
  });
  await audit(db, c, "IMPORT_APPLIED", id, {
    importId: batch.id,
    source: source.length,
    applied: data.rows.length,
    excluded: source.length - data.rows.length,
  });
  return {
    ...result,
    importResult: {
      source: source.length,
      applied: data.rows.length,
      excluded: source.length - data.rows.length,
      repeated: false,
    },
  };
}
export async function retryJob(c: Context, id: string) {
  return transaction(async (tx) => {
    const job = await tx.generationJob.findFirst({
      where: { id, tenantId: c.tenantId },
    });
    if (!job) fail(404, "NOT_FOUND", "Задание не найдено");
    if (job.status !== "FAILED")
      fail(
        409,
        "RETRY_NOT_FAILED",
        "Повтор доступен только для неудачной генерации",
      );
    await tx.generationJob.updateMany({
      where: { id, tenantId: c.tenantId, status: "FAILED" },
      data: {
        status: "PENDING",
        attempts: 0,
        runAfter: new Date(),
        leaseUntil: null,
        leaseOwner: null,
        errorCode: null,
        errorMessage: null,
      },
    });
    await audit(tx, c, "GENERATION_RETRY", id, {
      fencingToken: job.fencingToken,
    });
    return { ok: true };
  });
}
export async function registryExport(c: Context, input: unknown, id?: string) {
  const query = parse(
    z
      .object({
        search: z.string().max(255).default(""),
        status: z.enum(["DRAFT", "FINALIZED", "CANCELLED"]).optional(),
        kind: z.enum(["PERSON", "COMPANY"]).optional(),
        customerId: z.string().optional(),
        history: z.boolean().default(false),
        allowPartial: z.boolean().default(false),
        format: z.enum(["XLSX", "ZIP"]).default("XLSX"),
      })
      .strict(),
    input || {},
  );
  if (id) await scopedRequest(c, id);
  if (query.format === "ZIP") {
    if (!id) fail(400, "REQUEST_REQUIRED", "Выберите заявку для комплекта");
    const jobs = selectBundleJobs(
      await db.generationJob.findMany({
        where: {
          tenantId: c.tenantId,
          requestId: id,
          issuanceId: { not: null },
          kind: { not: "ZIP" },
        },
      }),
    );
    const artifacts = await db.artifact.findMany({
      where: {
        tenantId: c.tenantId,
        requestId: id,
        id: {
          in: jobs.flatMap((j) =>
            j.status === "SUCCEEDED" && j.artifactId ? [j.artifactId] : [],
          ),
        },
      },
    });
    if (!query.allowPartial && artifacts.length < jobs.length)
      fail(
        409,
        "PARTIAL_BUNDLE",
        "Комплект неполный. Подтвердите скачивание готовой части",
        { ready: artifacts.length, total: jobs.length },
      );
    const out = await buildZip(
      artifacts,
      jobs[0]?.issuanceId || id,
      jobs.length,
      jobs
        .filter((job) => !artifacts.some((a) => a.id === job.artifactId))
        .map((job) => ({
          jobId: job.id,
          documentId: job.documentId,
          format: job.kind,
          reason:
            job.errorCode ||
            (job.status === "SUCCEEDED" ? "ARTIFACT_MISSING" : job.status),
        })),
    );
    // Metadata rows may still exist when their immutable bytes were lost or
    // corrupted. The verified archive manifest is the authority on completeness.
    const complete = out.metadata.complete === true;
    const ready = Array.isArray(out.metadata.files)
      ? out.metadata.files.length
      : 0;
    if (!query.allowPartial && !complete)
      fail(
        409,
        "PARTIAL_BUNDLE",
        "Некоторые сохранённые файлы недоступны. Подтвердите скачивание готовой части или восстановите файлы",
        { ready, total: jobs.length },
      );
    await audit(db, c, "BUNDLE_EXPORTED", id, {
      ready,
      total: jobs.length,
      complete,
    });
    return {
      buffer: out.buffer,
      mimeType: MIME.ZIP,
      fileName: complete ? "DEMO-complete.zip" : "DEMO-PARTIAL.zip",
    };
  }
  const records = await db.printRequest.findMany({
    where: {
      ...(await requestFilter(c, query)),
      ...(id ? { id } : {}),
    },
    orderBy: { createdAt: "asc" },
  });
  const ids = records.map((r) => r.id);
  const [documents, issuances] = await Promise.all([
    db.issuedDocument.findMany({
      where: { tenantId: c.tenantId, requestId: { in: ids } },
    }),
    db.issuance.findMany({
      where: { tenantId: c.tenantId, requestId: { in: ids } },
    }),
  ]);
  const rows = [];
  for (const record of records) {
    const issuance = issuances.find((i) => i.requestId === record.id);
    const draft = draftSchema.parse(
      issuance ? (issuance.snapshot as { draft: unknown }).draft : record.draft,
    );
    for (const item of draft.items) {
      if (!item.assignments.length)
        rows.push({
          ...item,
          requestId: record.id,
          status: record.status,
          revision: record.revision,
        });
      for (const assignment of item.assignments) {
        const document = documents.find(
          (d) =>
            d.requestId === record.id &&
            d.rowId === item.id &&
            d.assignmentId === assignment.id,
        );
        rows.push({
          ...item,
          assignment,
          number: document?.number || "",
          registrationNumber: document?.registrationNumber || "",
          protocolNumber:
            assignment.protocolMode === "EXTERNAL_REFERENCE"
              ? assignment.externalBasisNumber
              : documents.find(
                  (d) =>
                    d.requestId === record.id &&
                    d.rowId === item.id &&
                    d.templateId ===
                      `${assignment.templateId.split("-")[0]}-protocol`,
                )?.number || assignment.externalBasisNumber,
          requestId: record.id,
          status: record.status,
          revision: record.revision,
          createdAt: record.createdAt.toISOString(),
        });
      }
    }
  }
  const output = await exportRegistry(rows);
  await audit(db, c, "REGISTRY_EXPORTED", id || c.tenantId, {
    rows: rows.length,
    requests: records.length,
    rendererVersion: RENDERER_VERSION,
  });
  return {
    buffer: output.buffer,
    mimeType: MIME.XLSX,
    fileName: "DEMO-registry.xlsx",
  };
}
