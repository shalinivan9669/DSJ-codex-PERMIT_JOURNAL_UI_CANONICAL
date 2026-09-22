import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Req,
  Res,
  Body,
  Param,
  Query,
  UploadedFile,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import type { Response } from "express";
import { z, LIMITS, itemSchema, templateIds } from "@demo/contracts";
import { db, ctx, fail, parse, audit, json, type DemoRequest } from "./core";
import { login, logout, changePassword, cookies } from "./auth";
import {
  context,
  getProfile,
  saveProfile,
  saveCustomer,
  saveUser,
  updateNumbering,
} from "./settings";
import * as requests from "./requests";
import * as files from "./files";
import { openArtifact } from "./storage";
import { RENDERER_VERSION } from "@demo/printing";
import { randomUUID } from "node:crypto";
import { mkdir, open, unlink } from "node:fs/promises";
function sendFile(
  res: Response,
  result: {
    buffer: Buffer;
    mimeType: string;
    fileName: string;
    sha256?: string;
  },
  inline = false,
) {
  res.setHeader("Content-Type", result.mimeType);
  res.setHeader(
    "Content-Disposition",
    `${inline ? "inline" : "attachment"}; filename="${result.fileName.replace(/[^a-zA-Z0-9._-]/g, "_")}"; filename*=UTF-8''${encodeURIComponent(result.fileName)}`,
  );
  res.setHeader("Content-Length", result.buffer.length);
  res.setHeader("Cache-Control", "private, no-store");
  if (result.sha256) res.setHeader("X-Content-SHA256", result.sha256);
  res.send(result.buffer);
}
@Controller()
export class DemoController {
  @Get("health") health() {
    return { status: "ok", product: "DEMO", version: "2.0.0" };
  }
  @Get("ready") async ready(@Req() req: DemoRequest) {
    ctx(req, false, true);
    await db.$queryRaw`SELECT 1`;
    const beat = await db.workerHeartbeat.findFirst({
      where: { version: RENDERER_VERSION },
      orderBy: { seenAt: "desc" },
    });
    const templates = await db.templateVersion.findMany({
      where: {
        tenantId: ctx(req).tenantId,
        templateId: { in: [...templateIds] },
      },
      orderBy: { version: "desc" },
      distinct: ["templateId"],
    });
    if (
      !beat ||
      Date.now() - beat.seenAt.getTime() > 90_000 ||
      templates.length !== templateIds.length
    )
      fail(503, "NOT_READY", "Проверьте worker и установку шаблонов");
    const probePath = files.store.path(`health-${randomUUID()}`);
    try {
      await Promise.all(
        templates.map((template) =>
          files.store.read(template.storageKey, template.checksum),
        ),
      );
      await mkdir(files.store.root, { recursive: true, mode: 0o700 });
      const probe = await open(probePath, "wx+", 0o600);
      try {
        await probe.writeFile("DEMO");
        await probe.sync();
        const result = Buffer.alloc(4);
        await probe.read(result, 0, 4, 0);
        if (result.toString() !== "DEMO")
          throw new Error("STORAGE_PROBE_FAILED");
      } finally {
        await probe.close();
      }
    } catch {
      fail(
        503,
        "STORAGE_NOT_READY",
        "Проверьте доступность хранилища и контрольные суммы шаблонов",
      );
    } finally {
      await unlink(probePath).catch(() => undefined);
    }
    return {
      status: "ready",
      workerSeenAt: beat.seenAt,
      templates: templates.length,
      rendererVersion: beat.version,
      storage: "ok",
    };
  }
  @Post("auth/login") login(
    @Req() req: DemoRequest,
    @Res({ passthrough: true }) res: Response,
    @Body() body: unknown,
  ) {
    return login(req, res, body);
  }
  @Post("auth/logout") logout(
    @Req() req: DemoRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    return logout(ctx(req), res);
  }
  @Post("auth/password") password(
    @Req() req: DemoRequest,
    @Body() body: unknown,
  ) {
    // Changing one's own credential is available to every authenticated role.
    return changePassword(ctx(req), body);
  }
  @Get("auth/session") session(@Req() req: DemoRequest) {
    return context(ctx(req), cookies(req).demo_csrf || "");
  }
  @Get("context") context(@Req() req: DemoRequest) {
    return context(ctx(req), cookies(req).demo_csrf || "");
  }
  @Get("customers") async customers(
    @Req() req: DemoRequest,
    @Query() query: Record<string, unknown>,
  ) {
    const c = ctx(req);
    const { search, page, pageSize } = parse(
      z.object({
        search: z.string().max(255).default(""),
        page: z.coerce.number().int().min(1).default(1),
        pageSize: z.coerce.number().int().min(1).max(100).default(100),
      }),
      query,
    );
    const where = {
      tenantId: c.tenantId,
      ...(search
        ? {
            OR: [
              { nameRu: { contains: search, mode: "insensitive" as const } },
              { nameKz: { contains: search, mode: "insensitive" as const } },
              { bin: { contains: search } },
            ],
          }
        : {}),
    };
    const [items, total] = await db.$transaction([
      db.customerOrganization.findMany({
        where,
        orderBy: { nameRu: "asc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      db.customerOrganization.count({ where }),
    ]);
    return { items, total, page, pageSize };
  }
  @Post("customers") createCustomer(
    @Req() req: DemoRequest,
    @Body() body: unknown,
  ) {
    return saveCustomer(ctx(req, true), body);
  }
  @Patch("customers/:id") updateCustomer(
    @Req() req: DemoRequest,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    return saveCustomer(ctx(req, true), body, id);
  }
  @Get("recipients") async recipients(@Req() req: DemoRequest) {
    const items = await db.recipient.findMany({
      where: { tenantId: ctx(req).tenantId, archived: false },
      take: 100,
    });
    return { items, total: items.length };
  }
  @Post("recipients") async recipient(
    @Req() req: DemoRequest,
    @Body() body: unknown,
  ) {
    const c = ctx(req, true);
    const data = parse(itemSchema, body);
    return db.recipient.create({
      data: { tenantId: c.tenantId, data: json(data) },
    });
  }
  @Patch("recipients/:id") async updateRecipient(
    @Req() req: DemoRequest,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    const c = ctx(req, true);
    if (
      !(await db.recipient.findFirst({ where: { id, tenantId: c.tenantId } }))
    )
      fail(404, "NOT_FOUND", "Получатель не найден");
    const data = parse(itemSchema, body);
    return db.recipient.update({ where: { id }, data: { data: json(data) } });
  }
  @Get("print-requests") requests(
    @Req() req: DemoRequest,
    @Query() query: Record<string, unknown>,
  ) {
    return requests.listRequests(ctx(req), query);
  }
  @Post("print-requests") createRequest(
    @Req() req: DemoRequest,
    @Body() body: unknown,
  ) {
    return requests.createRequest(ctx(req, true), body);
  }
  @Get("print-requests/:id") request(
    @Req() req: DemoRequest,
    @Param("id") id: string,
  ) {
    return requests.requestDetail(ctx(req), id);
  }
  @Patch("print-requests/:id") patch(
    @Req() req: DemoRequest,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    return requests.patchRequest(ctx(req, true), id, body);
  }
  @Delete("print-requests/:id") delete(
    @Req() req: DemoRequest,
    @Param("id") id: string,
  ) {
    return requests.deleteDraft(ctx(req, true), id);
  }
  @Post("print-requests/:id/validate") validate(
    @Req() req: DemoRequest,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    return requests.validateRequest(ctx(req), id, body);
  }
  @Post("print-requests/:id/preview") preview(
    @Req() req: DemoRequest,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    return requests.preview(ctx(req, true), id, body);
  }
  @Post("print-requests/:id/finalize") finalize(
    @Req() req: DemoRequest,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    return requests.finalize(
      ctx(req, true),
      id,
      body,
      req.headers["idempotency-key"],
    );
  }
  @Post("print-requests/:id/correct") correct(
    @Req() req: DemoRequest,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    return requests.correction(ctx(req, true), id, body);
  }
  @Post("print-requests/:id/cancel") cancel(
    @Req() req: DemoRequest,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    return requests.cancelRequest(ctx(req, true), id, body);
  }
  @Post("print-requests/:id/import") import(
    @Req() req: DemoRequest,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    return files.applyImport(ctx(req, true), id, body);
  }
  @Post("print-requests/:id/export") async export(
    @Req() req: DemoRequest,
    @Param("id") id: string,
    @Body() body: unknown,
    @Res() res: Response,
  ) {
    sendFile(res, await files.registryExport(ctx(req), body, id));
  }
  @Post("print-requests/export") async exportAll(
    @Req() req: DemoRequest,
    @Body() body: unknown,
    @Res() res: Response,
  ) {
    sendFile(res, await files.registryExport(ctx(req), body));
  }
  @Get("jobs") async jobs(
    @Req() req: DemoRequest,
    @Query("requestId") requestId?: string,
  ) {
    const c = ctx(req);
    const items = await db.generationJob.findMany({
      where: { tenantId: c.tenantId, requestId },
      orderBy: { createdAt: "desc" },
      // Up to 1000 issued documents produce 2002 jobs in one valid request.
      take: requestId ? undefined : 1000,
    });
    const artifacts = await db.artifact.findMany({
      where: {
        tenantId: c.tenantId,
        id: { in: items.flatMap((j) => (j.artifactId ? [j.artifactId] : [])) },
      },
      select: {
        id: true,
        tenantId: true,
        format: true,
        mimeType: true,
        fileName: true,
        size: true,
        sha256: true,
        provenance: true,
        createdAt: true,
      },
    });
    const snapshots = await db.renderInputSnapshot.findMany({
      where: {
        tenantId: c.tenantId,
        id: { in: items.map((j) => j.snapshotId) },
      },
      select: { id: true, revision: true },
    });
    return {
      items: items.map((j) => ({
        ...j,
        sourceRevision: snapshots.find((s) => s.id === j.snapshotId)?.revision,
        artifact: artifacts.find((a) => a.id === j.artifactId),
      })),
      total: requestId
        ? items.length
        : await db.generationJob.count({ where: { tenantId: c.tenantId } }),
    };
  }
  @Post("jobs/:id/retry") retry(
    @Req() req: DemoRequest,
    @Param("id") id: string,
  ) {
    return files.retryJob(ctx(req, true), id);
  }
  @Get("artifacts/:id") async download(
    @Req() req: DemoRequest,
    @Param("id") id: string,
    @Res() res: Response,
  ) {
    const { artifact, stream } = await openArtifact(ctx(req), id);
    res.setHeader("Content-Type", artifact.mimeType);
    res.setHeader(
      "Content-Disposition",
      `${req.query.inline === "1" ? "inline" : "attachment"}; filename="${artifact.fileName.replace(/[^a-zA-Z0-9._-]/g, "_")}"; filename*=UTF-8''${encodeURIComponent(artifact.fileName)}`,
    );
    res.setHeader("Content-Length", artifact.size);
    res.setHeader("X-Content-SHA256", artifact.sha256);
    res.once("close", () => stream.destroy());
    stream.once("error", () => res.destroy());
    stream.pipe(res);
  }
  @Post("artifacts/:id/restore") restore(
    @Req() req: DemoRequest,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    return files.restoreArtifact(ctx(req, true), id, body);
  }
  @Post("photos")
  @UseInterceptors(
    FileInterceptor("file", {
      limits: {
        fileSize: LIMITS.photoBytes,
        files: 1,
        fields: 3,
        fieldSize: 2048,
      },
    }),
  )
  photo(
    @Req() req: DemoRequest,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body() body: Record<string, unknown>,
  ) {
    return files.uploadPhoto(ctx(req, true), file, body);
  }
  @Get("photos/:id") async readPhoto(
    @Req() req: DemoRequest,
    @Param("id") id: string,
    @Res() res: Response,
  ) {
    sendFile(res, await files.readPhoto(ctx(req), id), true);
  }
  @Post("imports/preview")
  @UseInterceptors(
    FileInterceptor("file", {
      limits: {
        fileSize: LIMITS.importBytes,
        files: 1,
        fields: 2,
        fieldSize: 2048,
      },
    }),
  )
  importPreview(
    @Req() req: DemoRequest,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body("sheet") sheet?: string,
  ) {
    return files.importPreview(ctx(req, true), file, sheet);
  }
  @Get("imports/mappings") async importMappings(@Req() req: DemoRequest) {
    return {
      items: await db.importMapping.findMany({
        where: { tenantId: ctx(req).tenantId },
        orderBy: { name: "asc" },
      }),
    };
  }
  @Post("imports/mappings") async saveMapping(
    @Req() req: DemoRequest,
    @Body() body: unknown,
  ) {
    const c = ctx(req, true);
    const data = parse(
      z
        .object({
          name: z.string().trim().min(1).max(100),
          columns: z.array(z.string().max(500)).max(100),
          mapping: z.record(
            z.string().max(500),
            z.enum([
              "",
              "fullNameRu",
              "fullNameKz",
              "positionRu",
              "positionKz",
              "workplaceRu",
              "workplaceKz",
              "templateId",
              "documentDate",
              "protocolDate",
              "trainingStart",
              "trainingEnd",
              "trainingSubject",
              "result",
              "reason",
              "education",
              "hours",
              "validUntil",
              "externalBasisNumber",
            ]),
          ),
        })
        .strict(),
      body,
    );
    return db.$transaction(async (tx) => {
      const result = await tx.importMapping.upsert({
        where: { tenantId_name: { tenantId: c.tenantId, name: data.name } },
        create: { tenantId: c.tenantId, ...data, createdBy: c.userId },
        update: { columns: data.columns, mapping: data.mapping },
      });
      await audit(tx, c, "IMPORT_MAPPING_SAVED", result.id);
      return result;
    });
  }
  @Get("imports/template") importTemplate(
    @Req() req: DemoRequest,
    @Res() res: Response,
  ) {
    ctx(req);
    sendFile(res, {
      buffer: Buffer.from(
        "\uFEFFФИО RU,ФИО KZ,Должность RU,Должность KZ,Место работы RU,Место работы KZ\r\n",
        "utf8",
      ),
      mimeType: "text/csv; charset=utf-8",
      fileName: "DEMO-import.csv",
    });
  }
  @Get("settings/profile") async profile(@Req() req: DemoRequest) {
    const profile = await getProfile(ctx(req));
    return profile
      ? {
          ...(profile.profile as object),
          id: profile.id,
          version: profile.version,
        }
      : null;
  }
  @Post("settings/profile") saveProfile(
    @Req() req: DemoRequest,
    @Body() body: unknown,
  ) {
    return saveProfile(ctx(req, true, true), body);
  }
  @Get("settings/templates") async templates(@Req() req: DemoRequest) {
    return {
      items: await db.templateVersion.findMany({
        where: { tenantId: ctx(req).tenantId },
        orderBy: { templateId: "asc" },
      }),
    };
  }
  @Post("settings/templates/:id/approve") async approveTemplate(
    @Req() req: DemoRequest,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    const c = ctx(req, true, true);
    const data = parse(z.object({ approved: z.boolean() }).strict(), body);
    const template = await db.templateVersion.findFirst({
      where: { id, tenantId: c.tenantId },
    });
    if (!template) fail(404, "NOT_FOUND", "Шаблон не найден");
    if (data.approved) {
      if (
        !templateIds.includes(
          template.templateId as (typeof templateIds)[number],
        )
      )
        fail(
          422,
          "TEMPLATE_UNSUPPORTED",
          "Историческую неизвестную форму нельзя активировать для новых документов",
        );
      try {
        await files.store.read(template.storageKey, template.checksum);
      } catch {
        fail(
          422,
          "TEMPLATE_UNAVAILABLE",
          "Байты шаблона отсутствуют или повреждены: подтверждение невозможно",
        );
      }
    }
    return db.$transaction(async (tx) => {
      const result = await tx.templateVersion.update({ where: { id }, data });
      await audit(tx, c, "TEMPLATE_APPROVAL", id, { approved: data.approved });
      return result;
    });
  }
  @Get("settings/numbering") async numbering(@Req() req: DemoRequest) {
    const items = await db.numberSequence.findMany({
      where: { tenantId: ctx(req).tenantId },
      orderBy: { namespace: "asc" },
    });
    return { items: items.map((i) => ({ ...i, nextValue: i.value + 1 })) };
  }
  @Patch("settings/numbering") updateNumbering(
    @Req() req: DemoRequest,
    @Body() body: unknown,
  ) {
    return updateNumbering(ctx(req, true, true), body);
  }
  @Get("users") async users(@Req() req: DemoRequest) {
    const items = await db.user.findMany({
      where: { tenantId: ctx(req, false, true).tenantId },
      select: {
        id: true,
        email: true,
        displayName: true,
        role: true,
        active: true,
      },
      orderBy: { displayName: "asc" },
    });
    return { items: items.map((u) => ({ ...u, disabled: !u.active })) };
  }
  @Post("users") createUser(@Req() req: DemoRequest, @Body() body: unknown) {
    return saveUser(ctx(req, true, true), body);
  }
  @Patch("users/:id") updateUser(
    @Req() req: DemoRequest,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    return saveUser(ctx(req, true, true), body, id);
  }
  @Get("audit") async audit(
    @Req() req: DemoRequest,
    @Query("page") page = "1",
  ) {
    const c = ctx(req, false, true);
    const number = parse(z.coerce.number().int().positive(), page);
    const [items, total] = await db.$transaction([
      db.auditEvent.findMany({
        where: { tenantId: c.tenantId },
        orderBy: { createdAt: "desc" },
        skip: (number - 1) * 50,
        take: 50,
      }),
      db.auditEvent.count({ where: { tenantId: c.tenantId } }),
    ]);
    return { items, total, page: number, pageSize: 50 };
  }
}
