import { randomUUID } from "node:crypto";
import {
  ArtifactStore,
  MIME,
  runRender,
  RENDERER_VERSION,
} from "@demo/printing";
import { z, TEMPLATE_LABELS, type Draft } from "@demo/contracts";
import {
  db,
  scopedRequest,
  parse,
  fail,
  hash,
  audit,
  json,
  transaction,
  type Context,
} from "./core";
import { assertArtifactDownloadAllowed } from "./artifact-access";
import { registryExport } from "./files";
import { assertStaff } from "./approvals";

export const PRINT_SET_PART_BYTES = 64 * 1024 * 1024;
const selectionSchema = z
  .object({
    issuanceId: z.string().max(80).optional(),
    artifactIds: z.array(z.string().max(80)).optional(),
    format: z.enum(["PDF", "DOCX", "ZIP"]).default("PDF"),
  })
  .strict();
const store = new ArtifactStore();

/** Partition by bytes, never by a fixed number of people or business stages. */
export function printSetParts<T extends { id: string; size: number }>(
  files: T[],
) {
  const parts: T[][] = [];
  for (const file of files) {
    if (file.size > PRINT_SET_PART_BYTES)
      fail(
        422,
        "PRINT_SET_SINGLE_FILE_LIMIT",
        "Один оригинал превышает размер части комплекта; он доступен отдельным скачиванием",
        { artifactId: file.id, limitBytes: PRINT_SET_PART_BYTES },
      );
    const last = parts.at(-1);
    if (
      !last ||
      last.reduce((sum, entry) => sum + entry.size, 0) + file.size >
        PRINT_SET_PART_BYTES
    )
      parts.push([file]);
    else last.push(file);
  }
  return parts;
}

async function selectedFiles(c: Context, id: string, input: unknown) {
  assertStaff(c);
  await scopedRequest(c, id);
  const selection = parse(selectionSchema, input || {});
  const issuances = await db.issuance.findMany({
    where: { tenantId: c.tenantId, requestId: id },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
  });
  const issuanceId =
    selection.issuanceId ||
    (!selection.artifactIds ? issuances[0]?.id : undefined);
  if (issuanceId && !issuances.some((item) => item.id === issuanceId))
    fail(404, "ISSUANCE_NOT_FOUND", "Выпуск не найден в этой заявке");
  const ids = selection.artifactIds && [...new Set(selection.artifactIds)];
  if (ids && !ids.length)
    fail(422, "EMPTY_PRINT_SET", "Выберите сохранённые документы");
  const artifacts = await db.artifact.findMany({
    where: {
      tenantId: c.tenantId,
      requestId: id,
      provenance: { not: "PRINT_SET_DERIVATIVE" },
      issuanceId: issuanceId || { not: null },
      ...(ids ? { id: { in: ids } } : {}),
      ...(selection.format === "ZIP"
        ? { format: { in: ["DOCX", "PDF"] } }
        : { format: selection.format }),
    },
  });
  if (ids && artifacts.length !== ids.length)
    fail(
      404,
      "PRINT_SET_SELECTION",
      "Выбранный оригинал не найден в этой заявке или не соответствует формату",
    );
  const documents = await db.issuedDocument.findMany({
    where: {
      tenantId: c.tenantId,
      requestId: id,
      id: {
        in: artifacts.flatMap((item) =>
          item.documentId ? [item.documentId] : [],
        ),
      },
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
  const order = new Map(
    documents.map((document, index) => [document.id, index]),
  );
  const originals = artifacts.filter(
    (item) => item.documentId && order.has(item.documentId),
  );
  const current = ids
    ? originals
    : [
        ...new Map(
          originals
            .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
            .map((file) => [file.documentId + ":" + file.format, file]),
        ).values(),
      ];
  const files = current.sort(
    (a, b) =>
      order.get(a.documentId!)! - order.get(b.documentId!)! ||
      a.format.localeCompare(b.format),
  );
  if (!files.length)
    fail(
      409,
      "EMPTY_PRINT_SET",
      "Оригиналы этого выпуска ещё не готовы. Дождитесь генерации или восстановите файлы",
    );
  if (!ids) {
    const jobs = await db.generationJob.findMany({
      where: {
        tenantId: c.tenantId,
        requestId: id,
        issuanceId,
        kind:
          selection.format === "ZIP"
            ? { in: ["DOCX", "PDF"] }
            : selection.format,
      },
    });
    const expected = new Set(
      jobs.flatMap((job) =>
        job.documentId ? [job.documentId + ":" + job.kind] : [],
      ),
    );
    if (
      [...expected].some(
        (key) =>
          !files.some((file) => file.documentId + ":" + file.format === key),
      )
    )
      fail(
        409,
        "PRINT_SET_NOT_READY",
        "Комплект выбранного выпуска формируется или содержит ошибку. Готовые оригиналы доступны отдельно",
      );
  }
  for (const artifact of files)
    await assertArtifactDownloadAllowed(c, artifact);
  if (selection.format === "ZIP") {
    const workflows = await db.issuanceWorkflow.findMany({
      where: {
        tenantId: c.tenantId,
        issuanceId: { in: [...new Set(files.map((file) => file.issuanceId!))] },
      },
    });
    if (workflows.some((workflow) => workflow.status !== "ISSUED"))
      fail(
        409,
        "ISSUANCE_NOT_COMPLETE",
        "Оригиналы ZIP доступны после обязательных подписей; единый PDF доступен для проверки и печати",
      );
  }
  for (const artifact of files) {
    try {
      await store.read(artifact.storageKey, artifact.sha256);
    } catch {
      fail(
        409,
        "PRINT_SET_ORIGINAL_MISSING",
        "Оригинал недоступен или повреждён. Восстановите его перед объединением",
        { artifactId: artifact.id },
      );
    }
  }
  if (
    selection.format === "DOCX" &&
    new Set(
      files.map(
        (file) =>
          documents.find((document) => document.id === file.documentId)
            ?.templateId +
          ":" +
          file.templateVersion,
      ),
    ).size > 1
  )
    fail(
      422,
      "DOCX_MIXED_FORMS",
      "Общий DOCX доступен для одной формы и версии макета. Для разных форм выберите единый PDF; оригинальные DOCX доступны в ZIP",
    );
  const selectedIssuances = [...new Set(files.map((file) => file.issuanceId))];
  return {
    selection,
    issuanceId:
      issuanceId ||
      (selectedIssuances.length === 1 ? selectedIssuances[0]! : undefined),
    issuances,
    files,
    documents,
  };
}

export async function printSetPlan(c: Context, id: string, input: unknown) {
  const data = await selectedFiles(c, id, input);
  return {
    issuanceId: data.issuanceId,
    format: data.selection.format,
    limitBytes: PRINT_SET_PART_BYTES,
    parts: printSetParts(data.files).map((files, index) => ({
      index,
      artifactIds: files.map((file) => file.id),
      bytes: files.reduce((sum, file) => sum + file.size, 0),
      fileCount: files.length,
    })),
    files: data.files.map((file) => {
      const document = data.documents.find(
        (document) => document.id === file.documentId,
      );
      const frozen = (
        data.issuances.find((issuance) => issuance.id === file.issuanceId)
          ?.snapshot as unknown as { draft?: Draft }
      )?.draft;
      const members = document?.rowId
        ? frozen?.items.filter((row) => row.id === document.rowId)
        : frozen?.items.filter((row) =>
            row.assignments.some(
              (assignment) => assignment.eventId === document?.groupEventId,
            ),
          );
      return {
        id: file.id,
        format: file.format,
        size: file.size,
        sha256: file.sha256,
        document,
        personIds: members?.map((row) => row.id) || [],
        personNames:
          members?.map((row) => row.fullNameRu || row.fullNameKz) || [],
        documentTitle: document
          ? TEMPLATE_LABELS[
              document.templateId as keyof typeof TEMPLATE_LABELS
            ] || document.templateId
          : "",
        courseTitle: frozen?.events?.find(
          (event) => event.id === document?.groupEventId,
        )?.title,
      };
    }),
    originalScale: 1,
    notice:
      "Производная копия сохранённых оригиналов для печати. Подписи оригиналов сохраняются отдельно.",
  };
}

export async function buildPrintSet(c: Context, id: string, input: unknown) {
  const request = parse(
    selectionSchema.extend({ part: z.number().int().nonnegative().default(0) }),
    input || {},
  );
  const { part, ...selection } = request;
  const data = await selectedFiles(c, id, selection);
  const parts = printSetParts(data.files);
  const files = parts[part];
  if (!files)
    fail(422, "PRINT_SET_PART", "Выбранная часть комплекта не существует");
  const sources = files.map((file) => ({
    ...file,
    templateId: data.documents.find(
      (document) => document.id === file.documentId,
    )?.templateId,
  }));
  const out =
    selection.format === "ZIP"
      ? {
          ...(await registryExport(
            c,
            { format: "ZIP", artifactIds: files.map((file) => file.id) },
            id,
          )),
          metadata: {} as Record<string, unknown>,
        }
      : await runRender(
          selection.format === "PDF" ? "merge-pdf" : "merge-docx",
          {
            artifacts: sources,
            artifactRoot: store.root,
            issuanceId: data.issuanceId,
            expectedCount: files.length,
          },
        );
  const format = selection.format;
  const saved = await store.put(out.buffer, format.toLowerCase());
  const sourceJob = await db.generationJob.findFirstOrThrow({
    where: { tenantId: c.tenantId, id: files[0].jobId },
  });
  const sourceSnapshot = await db.renderInputSnapshot.findFirstOrThrow({
    where: { tenantId: c.tenantId, id: sourceJob.snapshotId },
  });
  const derivativeInput = {
    provenance: "PRINT_SET_DERIVATIVE",
    format,
    issuanceId: data.issuanceId,
    sourceArtifactIds: files.map((file) => file.id),
    sources: sources.map((file) => ({
      id: file.id,
      sha256: file.sha256,
      size: file.size,
      storageKey: file.storageKey,
      templateId: file.templateId,
      templateVersion: file.templateVersion,
    })),
    part,
    partCount: parts.length,
  };
  const artifact = await transaction(async (tx) => {
    const inputHash = hash(derivativeInput);
    const snapshot = await tx.renderInputSnapshot.create({
      data: {
        tenantId: c.tenantId,
        requestId: id,
        revision: sourceSnapshot.revision,
        profileVersionId: sourceSnapshot.profileVersionId,
        input: json(derivativeInput),
        inputHash,
      },
    });
    // A synchronous derivative has its own completed generation record. It is
    // outside the issuance job set and never replaces an original's pointer.
    const job = await tx.generationJob.create({
      data: {
        tenantId: c.tenantId,
        requestId: id,
        snapshotId: snapshot.id,
        kind: format,
        logicalKey: `print-set:${randomUUID()}`,
        status: "SUCCEEDED",
        progress: 100,
      },
    });
    const artifact = await tx.artifact.create({
      data: {
        ...saved,
        tenantId: c.tenantId,
        requestId: id,
        issuanceId: data.issuanceId || null,
        jobId: job.id,
        format,
        mimeType: MIME[format],
        fileName: `DEMO — выпуск ${data.issuanceId?.slice(0, 8) || "выбранный состав"} — часть ${part + 1} из ${parts.length}.${format.toLowerCase()}`,
        rendererVersion: RENDERER_VERSION,
        inputHash,
        provenance: "PRINT_SET_DERIVATIVE",
      },
    });
    await tx.generationJob.update({
      where: { id: job.id },
      data: { artifactId: artifact.id },
    });
    await audit(tx, c, "PRINT_SET_CREATED", id, {
      artifactId: artifact.id,
      sourceArtifactIds: derivativeInput.sourceArtifactIds,
      sourceHashes: files.map((file) => file.sha256),
      format,
      part,
      parts: parts.length,
    });
    return artifact;
  });
  return {
    artifact,
    pages: out.metadata.pages,
    sourceArtifactIds: files.map((file) => file.id),
    part,
    partCount: parts.length,
  };
}
