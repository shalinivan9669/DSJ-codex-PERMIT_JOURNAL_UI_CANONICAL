import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Req,
  Res,
  UploadedFile,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import type { Response } from "express";
import { z } from "@demo/contracts";
import {
  ArtifactStore,
  MIME,
  PRODUCT_ROOT,
  runRender,
  templateManifest,
} from "@demo/printing";
import {
  audit,
  db,
  fail,
  json,
  parse,
  requireCapability,
  transaction,
  type Context,
  type DemoRequest,
} from "./core";

const store = new ArtifactStore();
const originalArchivePolicy = "ORIGINAL_ARCHIVE_20261117";
const originalArchiveCards = new Map<string, [string, string]>([
  ["biot-worker-card", ["Охрана труда", "Еңбек қорғау"]],
  ["pb-card", ["Промбезопасность", "Өнеркәсіптік қауіпсіздік"]],
  ["ptm-card", ["Пожарный минимум", "Өрт-техникалық минимум"]],
  ["ps-card", ["Мастер", "Шебер"]],
]);

/** The Python registry decides which exact source is allowed for a card.
 * Supply the candidate digest only in that card's bundled individual scope. */
export function archiveCardCandidateChecksum(
  base: Record<string, unknown>,
  upload: Buffer,
) {
  if (
    !originalArchiveCards.has(String(base.id)) ||
    base.program ||
    (base.ownerKind && base.ownerKind !== "INDIVIDUAL") ||
    base.renderPolicy !== "USER_ARCHIVE_20261109_V1"
  )
    return undefined;
  return createHash("sha256").update(upload).digest("hex");
}

const originalInspection = z.object({
  validated: z.literal(true),
  templateId: z.string(),
  renderPolicy: z.literal(originalArchivePolicy),
  originalSourceSha256: z.string().regex(/^[0-9a-f]{64}$/),
  fields: z
    .array(z.string().regex(/^[A-Z][A-Z0-9_]{0,63}$/))
    .min(1)
    .max(256),
  photo: z.boolean(),
  sections: z.array(z.record(z.string(), z.string())).min(1).max(100),
});
export const templateManagementRoutes = [
  ["POST", "/settings/templates/register-bundled"],
  ["POST", "/settings/templates/upload"],
  ["GET", "/settings/templates/:id/source"],
  ["GET", "/settings/templates/:id/sample"],
] as const;

async function bundledForms() {
  const manifest = await templateManifest();
  return [
    ...manifest.templates,
    ...(manifest.groupTemplates || []),
    ...(manifest.specialTemplates || []),
  ];
}

/** A print preview is deliberately outside enrollments, numbering and issuance. */
export function sampleSnapshot(template: {
  templateId: string;
  version: string;
  storageKey: string;
  checksum: string;
  contract: unknown;
}) {
  const contract = template.contract as Record<string, unknown>;
  const originalCard =
    contract.renderPolicy === originalArchivePolicy
      ? originalArchiveCards.get(template.templateId)
      : undefined;
  const sample = originalCard ? "ТОО «Үлгі»" : "ОБРАЗЕЦ ФОРМЫ / НЫСАН ҮЛГІСІ";
  const sampleNumber = originalCard ? "001" : "ОБРАЗЕЦ";
  const assignment: Record<string, unknown> = {
    id: "sample-assignment",
    templateId: template.templateId,
    documentDate: "2026-01-01",
    protocolDate: "2026-01-01",
    trainingStart: "2026-01-01",
    trainingEnd: "2026-01-01",
    trainingSubject: "Учебная программа — образец / Оқу бағдарламасы — үлгі",
    trainingSubjectRu: "Учебная программа — образец",
    trainingSubjectKz: "Оқу бағдарламасы — үлгі",
    result: "Образец результата / Нәтиже үлгісі",
    reason: "Образец",
    hours: 8,
    validUntil: "2027-01-01",
    externalBasisNumber: "ОБРАЗЕЦ",
    protocolMode: "individual",
    biotCategory: template.templateId.startsWith("biot-itr-")
      ? "OHS_SPECIALIST_SPECIAL"
      : "WORKER",
    productionHours: "8",
    biotIndustryRu: "учебной",
    biotIndustryKz: "оқу",
    biotCheckType: "PERIODIC",
    biotKnowledgeResult: "Образец",
    biotProctoringResult: "Образец",
  };
  if (originalCard) {
    const [ru, kz] = originalCard;
    Object.assign(assignment, {
      trainingSubject: `${ru} / ${kz}`,
      trainingSubjectRu: ru,
      trainingSubjectKz: kz,
      outcome: { status: "PASSED", source: "SYNTHETIC_FORM_PREVIEW_ONLY" },
      result: "Сдал / Тапсырды",
      resultRu: "Сдал",
      resultKz: "Тапсырды",
      externalBasisNumber: sampleNumber,
    });
  }
  if (contract.ownerKind === "GROUP") assignment.eventId = "sample-group";
  if (template.templateId.startsWith("lms-"))
    assignment.lms = {
      resultId: "FORM-PREVIEW-NOT-AN-EXAM",
      resultRevision: 1,
      profileVersionId: "FORM-PREVIEW",
      assessmentKind: "CENTER_EXAM",
      legalForm: "INFORMATION_CARD",
      signatureState: "PREPARED",
      eligible: true,
      synthetic: true,
      verdict: "PASSED",
      score: 8,
      maximum: 10,
      course: {
        titleRu: "Образец программы",
        titleKz: "Бағдарлама үлгісі",
        hours: 8,
      },
      issuer: sample,
      examiner: "Образец комиссии / Комиссия үлгісі",
      examAt: "2026-01-01T09:00:00Z",
      source: {},
      requiredSignatures: [],
    };
  return {
    mode: "issued-document",
    demoMode: true,
    templateId: template.templateId,
    templateVersion: template.version,
    templateStorageKey: template.storageKey,
    templateChecksum: template.checksum,
    issuer: {
      nameRu: sample,
      nameKz: originalCard ? "«Үлгі» ЖШС" : "Нысан үлгісі",
      cityRu: "Астана",
      cityKz: "Астана",
      approvalBasis: "Образец для проверки формы",
      bin: "000000000000",
      headName: "Образец А. Б.",
      commission: [
        { name: "Образец А. Б.", position: "Председатель" },
        { name: "Үлгі Ә. Б.", position: "Член комиссии" },
        { name: "Образец В. Г.", position: "Член комиссии" },
      ],
    },
    items: [
      {
        id: "sample-recipient",
        fullNameRu: originalCard ? "Үлгі А. Б." : "Образец имени получателя",
        fullNameKz: originalCard ? "Үлгі А. Б." : "Алушы атының үлгісі",
        positionRu: originalCard ? "Мастер" : "Специалист",
        positionKz: "Маман",
        workplaceRu: originalCard ? sample : "Организация — образец",
        workplaceKz: originalCard ? "«Үлгі» ЖШС" : "Ұйым — үлгі",
        departmentRu: "Учебный участок",
        departmentKz: "Оқу учаскесі",
        employerBin: "000000000000",
        employerAddressRu: "Адрес — образец",
        employerAddressKz: "Мекенжай — үлгі",
        number: sampleNumber,
        protocolNumber: sampleNumber,
        registrationNumber: sampleNumber,
        credentialNumber: sampleNumber,
        assignment,
      },
    ],
    ...(contract.ownerKind === "GROUP"
      ? {
          groupEvent: {
            id: "sample-group",
            contractVersion: 1,
            title: sample,
            protocolNumber: "ОБРАЗЕЦ",
            protocolDate: "2026-01-01",
          },
        }
      : {}),
    photos: {},
  };
}

export async function registerBundledForms(c: Context) {
  const forms = await bundledForms();
  const validated = await Promise.all(
    forms.map(async (form) => {
      if (!/^[a-z0-9][a-z0-9.-]*\.docx$/.test(String(form.file)))
        fail(422, "TEMPLATE_SOURCE_INVALID", "Исходная форма недоступна");
      const bytes = await readFile(
        join(PRODUCT_ROOT, "assets/templates", String(form.file)),
      );
      if (createHash("sha256").update(bytes).digest("hex") !== form.sha256)
        fail(
          422,
          "TEMPLATE_SOURCE_INVALID",
          "Контрольная сумма исходной формы не совпадает",
        );
      return { form, bytes };
    }),
  );
  return transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${c.tenantId + ":register-forms"}, 0))`;
    let created = 0;
    for (const { form, bytes } of validated) {
      const existing = await tx.templateVersion.findUnique({
        where: {
          tenantId_templateId_version: {
            tenantId: c.tenantId,
            templateId: String(form.id),
            version: String(form.version),
          },
        },
      });
      if (existing) {
        if (existing.checksum !== form.sha256)
          fail(
            409,
            "IMMUTABLE_TEMPLATE_CONFLICT",
            "Версия формы уже существует с другим содержимым",
          );
        continue;
      }
      const asset = await store.put(bytes, "docx");
      await tx.templateVersion.create({
        data: {
          tenantId: c.tenantId,
          templateId: String(form.id),
          version: String(form.version),
          checksum: asset.sha256,
          storageKey: asset.storageKey,
          contract: json(form),
          approved: false,
        },
      });
      created++;
    }
    await audit(tx, c, "TEMPLATE_BUNDLED_REGISTERED", c.tenantId, { created });
    return { created };
  });
}

export async function uploadTemplate(
  c: Context,
  body: unknown,
  file?: Express.Multer.File,
) {
  const data = parse(
    z
      .object({
        sourceVersionId: z.string().uuid(),
        version: z
          .string()
          .trim()
          .regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,49}$/),
      })
      .strict(),
    body,
  );
  if (!file || file.size > 10 * 1024 * 1024)
    fail(422, "TEMPLATE_DOCX_REQUIRED", "Выберите форму DOCX до 10 МБ");
  const source = await db.templateVersion.findFirst({
    where: { tenantId: c.tenantId, id: data.sourceVersionId },
  });
  if (!source) fail(404, "NOT_FOUND", "Исходная форма не найдена");
  const sourceContract = source.contract as Record<string, unknown>;
  const forms = await bundledForms();
  const base = forms.find(
    (form) =>
      form.id === source.templateId &&
      (form.program || null) === (sourceContract.program || null) &&
      (form.ownerKind || null) === (sourceContract.ownerKind || null),
  );
  if (!base)
    fail(
      422,
      "TEMPLATE_UNSUPPORTED",
      "Для этой исторической формы выберите актуальный образец",
    );
  const originalSourceSha256 = archiveCardCandidateChecksum(base, file.buffer);
  let inspected: Awaited<ReturnType<typeof runRender>>;
  let versionContract: Record<string, unknown> = base;
  try {
    inspected = await runRender(
      "template-validate",
      {
        templateId: source.templateId,
        sourceFile: base.file,
        sourceChecksum: base.sha256,
        ...(originalSourceSha256 ? { originalSourceSha256 } : {}),
      },
      { inputBytes: file.buffer, inputExtension: "docx" },
    );
    if (inspected.metadata.renderPolicy === originalArchivePolicy) {
      const result = originalInspection.parse(inspected.metadata);
      if (
        !originalSourceSha256 ||
        result.originalSourceSha256 !== originalSourceSha256 ||
        result.templateId !== source.templateId ||
        !inspected.buffer.equals(file.buffer)
      )
        throw new Error("ARCHIVE_ORIGINAL_MISMATCH");
      // Only normalized field names leave the renderer. The private source can
      // contain example recipients and local mail-merge paths.
      inspected.metadata = result;
      versionContract = {
        ...base,
        file: `${source.templateId}-${data.version}.docx`,
        formRevision: originalArchivePolicy,
        renderPolicy: originalArchivePolicy,
        sourceSha256: originalSourceSha256,
        previousTemplateSha256: source.checksum,
        fields: result.fields,
        photo: result.photo,
        sections: result.sections,
        sourceIdentityPolicy:
          "PRIVATE_ARCHIVE_SOURCE_WITH_FROZEN_RENDER_VALUES",
        verificationStatus: "UPLOAD_VALIDATED_SAMPLE_RENDERED",
      };
    }
  } catch {
    fail(
      422,
      "TEMPLATE_VALIDATION_FAILED",
      "Форма не прошла проверку. Используйте исходный DOCX, сохраните поля и структуру, удалите внешние связи и активное содержимое",
    );
  }
  const asset = await store.put(inspected.buffer, "docx");
  let docx: Awaited<ReturnType<typeof store.put>>,
    pdf: Awaited<ReturnType<typeof store.put>>;
  try {
    const rendered = await runRender(
      "docx",
      sampleSnapshot({
        templateId: source.templateId,
        storageKey: asset.storageKey,
        checksum: asset.sha256,
        version: data.version,
        contract: versionContract,
      }),
    );
    if (
      versionContract.renderPolicy === originalArchivePolicy &&
      (rendered.metadata.renderPolicy !== originalArchivePolicy ||
        rendered.buffer.equals(inspected.buffer))
    )
      throw new Error("ORIGINAL_SAMPLE_NOT_RENDERED");
    const converted = await runRender(
      "pdf",
      {},
      { inputBytes: rendered.buffer, inputExtension: "docx" },
    );
    docx = await store.put(rendered.buffer, "docx");
    pdf = await store.put(converted.buffer, "pdf");
  } catch {
    // Content-addressed bytes may already belong to an immutable historical
    // version. Failed preview must never remove a shared artifact.
    fail(
      422,
      "TEMPLATE_RENDER_FAILED",
      "Пробное заполнение формы не выполнено. Проверьте размещение полей и размер страницы",
    );
  }
  return transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${c.tenantId + ":forms:" + source.templateId}, 0))`;
    const old = await tx.templateVersion.findUnique({
      where: {
        tenantId_templateId_version: {
          tenantId: c.tenantId,
          templateId: source.templateId,
          version: data.version,
        },
      },
    });
    if (old) {
      if (old.checksum === asset.sha256) return old;
      fail(
        409,
        "IMMUTABLE_TEMPLATE_CONFLICT",
        "Эта версия уже существует. Укажите новый номер версии",
      );
    }
    const record = await tx.templateVersion.create({
      data: {
        tenantId: c.tenantId,
        templateId: source.templateId,
        version: data.version,
        checksum: asset.sha256,
        storageKey: asset.storageKey,
        approved: false,
        contract: json({
          ...versionContract,
          version: data.version,
          sha256: asset.sha256,
          sourceVersionId: source.id,
          validation: inspected.metadata,
          preview: {
            docx,
            pdf,
            createdAt: new Date().toISOString(),
            sampleOnly: true,
          },
          uploadedBy: c.userId,
        }),
      },
    });
    await audit(tx, c, "TEMPLATE_VERSION_UPLOADED", record.id, {
      sourceVersionId: source.id,
      checksum: asset.sha256,
      validationPassed: true,
      previewPassed: true,
    });
    return record;
  });
}

@Controller()
export class TemplateManagementController {
  @Post("settings/templates/register-bundled") bundled(
    @Req() req: DemoRequest,
  ) {
    return registerBundledForms(requireCapability(req, "center:manage"));
  }
  @Post("settings/templates/upload")
  @UseInterceptors(
    FileInterceptor("file", {
      limits: { fileSize: 10 * 1024 * 1024, files: 1, fields: 2 },
    }),
  )
  upload(
    @Req() req: DemoRequest,
    @Body() body: unknown,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    return uploadTemplate(requireCapability(req, "center:manage"), body, file);
  }
  @Get("settings/templates/:id/source") source(
    @Req() req: DemoRequest,
    @Param("id") id: string,
    @Res() res: Response,
  ) {
    return this.download(req, id, "SOURCE", res);
  }
  @Get("settings/templates/:id/sample") sample(
    @Req() req: DemoRequest,
    @Param("id") id: string,
    @Query() query: unknown,
    @Res() res: Response,
  ) {
    const { format } = parse(
      z.object({ format: z.enum(["DOCX", "PDF"]).default("PDF") }).strict(),
      query,
    );
    return this.download(req, id, format, res);
  }
  private async download(
    req: DemoRequest,
    id: string,
    format: string,
    res: Response,
  ) {
    const c = requireCapability(req, "center:manage");
    const form = await db.templateVersion.findFirst({
      where: { tenantId: c.tenantId, id },
    });
    if (!form) fail(404, "NOT_FOUND", "Форма не найдена");
    let bytes = await store.read(form.storageKey, form.checksum);
    if (format !== "SOURCE") {
      const preview = (
        form.contract as {
          preview?: Record<string, { storageKey: string; sha256: string }>;
        }
      ).preview?.[format.toLowerCase()];
      if (preview) bytes = await store.read(preview.storageKey, preview.sha256);
      else {
        bytes = (await runRender("docx", sampleSnapshot(form))).buffer;
        if (format === "PDF")
          bytes = (
            await runRender(
              "pdf",
              {},
              { inputBytes: bytes, inputExtension: "docx" },
            )
          ).buffer;
      }
    }
    const ext = format === "PDF" ? "pdf" : "docx";
    res.setHeader("Content-Type", MIME[ext.toUpperCase()]);
    res.setHeader("Cache-Control", "private, no-store");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${form.templateId}-${form.version}-${format.toLowerCase()}.${ext}"`,
    );
    res.send(bytes);
    await audit(db, c, "TEMPLATE_SAMPLE_DOWNLOADED", form.id, { format });
  }
}
