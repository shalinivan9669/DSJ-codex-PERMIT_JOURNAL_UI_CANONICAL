import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Req,
  Res,
} from "@nestjs/common";
import type { Response } from "express";
import { randomUUID } from "node:crypto";
import {
  draftSchema,
  regulatoryProfileSchema,
  today,
  z,
  type Draft,
} from "@demo/contracts";
import { buildZip, BUNDLE_PART_BYTES } from "@demo/printing";
import {
  audit,
  db,
  fail,
  hash,
  json,
  parse,
  transaction,
  requireCapability,
  type Context,
  type DemoRequest,
} from "../core";
import {
  createProposedContainer,
  submitApproval,
  workingRequest,
} from "../approvals";
import { finalize } from "../requests";
import { openArtifact } from "../storage";
import { signingState } from "../signing";
import { assertLmsDeploymentAllowed } from "./deployment-gate";
import { effectiveResult } from "./enrollments";
import { assertEligibleResult } from "./result-finalization";
import {
  documentMetadata,
  documentRecipient,
  lmsTemplateTypes,
} from "./document-metadata";
import {
  assertLmsStaff,
  enrollmentFilter,
  lmsContext,
  scopedEnrollment,
} from "./scope";

export async function prepareResultDocuments(c: Context, input: unknown) {
  assertLmsStaff(c);
  await assertLmsDeploymentAllowed(
    await db.tenant.findUniqueOrThrow({ where: { id: c.tenantId } }),
  );
  const { resultIds } = parse(
    z
      .object({ resultIds: z.array(z.string().uuid()).min(1).max(250) })
      .strict(),
    input,
  );
  const items: Array<Awaited<ReturnType<typeof documentView>>> = [];
  const errors: { resultId: string; message: string }[] = [];
  for (const resultId of [...new Set(resultIds)]) {
    try {
      const links = await transaction(async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${c.tenantId + ":lms-documents:" + resultId},0))`;
        const result = await assertEligibleResult(tx, c, resultId);
        const existing = await tx.lmsDocumentLink.findMany({
          where: { tenantId: c.tenantId, resultId },
        });
        if (existing.length) return existing;
        const snapshot = result.snapshot as Record<string, unknown>;
        const profile = regulatoryProfileSchema.parse(snapshot.profile);
        if (!profile.documentTypes.length)
          fail(409, "NO_DOCUMENT_ROUTE", "Для программы не заданы документы");
        const metadata = documentMetadata(result);
        const recipient = documentRecipient(result);
        const tenant = await tx.tenant.findUniqueOrThrow({
          where: { id: c.tenantId },
        });
        const issuer = await tx.issuerProfileVersion.findFirst({
          where: { tenantId: c.tenantId },
          orderBy: { version: "desc" },
        });
        if (!issuer)
          fail(409, "ISSUER_NOT_CONFIGURED", "Заполните реквизиты центра");
        const date = today(tenant.timezone, result.confirmedAt);
        const draft: Draft = draftSchema.parse({
          kind: recipient.employerId ? "COMPANY" : "PERSON",
          customerId: recipient.employerId || null,
          title: metadata.course.titleRu,
          schemaVersion: 2,
          profileVersionId: issuer.id,
          demoMode: tenant.demoOnly,
          commonFields: { documentDate: date },
          items: [
            {
              ...recipient,
              assignments: [...new Set(profile.documentTypes)].map((type) => {
                const templateId = Object.entries(lmsTemplateTypes).find(
                  ([, value]) => value === type,
                )![0];
                if (
                  profile.templateIds[type] &&
                  profile.templateIds[type] !== templateId
                )
                  fail(
                    409,
                    "TEMPLATE_ROUTE_UNAVAILABLE",
                    "Проверьте шаблон программы",
                  );
                return {
                  id: `${result.id}-${type}`,
                  templateId,
                  documentDate: date,
                  protocolDate: date,
                  trainingStart: "",
                  trainingEnd: "",
                  validUntil: "",
                  trainingSubject: metadata.course.titleRu,
                  trainingSubjectKz: metadata.course.titleKz,
                  hours: String(metadata.course.hours),
                  result: "Сдал",
                  resultKz: "Тапсырды",
                  reason: "",
                  education: "",
                  outcome: {
                    status: "PASSED",
                    source: `LMS:${result.id}:${result.revision}`,
                    confirmedBy: result.createdBy,
                    confirmedAt: result.confirmedAt.toISOString(),
                  },
                  fieldOrigins: Object.fromEntries(
                    [
                      "documentDate",
                      "protocolDate",
                      "trainingSubject",
                      "trainingSubjectKz",
                      "hours",
                      "result",
                      "resultKz",
                      "outcome",
                    ].map((key) => [key, "IMPORTED"]),
                  ),
                  lms: metadata,
                };
              }),
            },
          ],
        });
        const request = await createProposedContainer(tx, c, draft);
        const created = [];
        for (const documentType of [...new Set(profile.documentTypes)])
          created.push(
            await tx.lmsDocumentLink.create({
              data: {
                tenantId: c.tenantId,
                resultId,
                documentType,
                legalForm: profile.legalForm,
                requestId: request.id,
                originalReference: metadata.originalReference,
              },
            }),
          );
        await audit(tx, c, "LMS_DOCUMENTS_PREPARED", resultId, {
          requestId: request.id,
          documentTypes: profile.documentTypes,
        });
        return created;
      });
      const record = await workingRequest(c, links[0].requestId);
      if (record.status === "DRAFT")
        await submitApproval(c, record.id, {
          expectedRevision: record.revision,
        });
      for (const link of links) items.push(await documentView(c, link.id));
    } catch (error) {
      const e = error as {
        getResponse?: () => {
          code?: string;
          message?: string;
          details?: Array<{ code?: string }>;
        };
      };
      const response = e.getResponse?.();
      const unapprovedForms =
        response?.code === "APPROVAL_DATA_INCOMPLETE" &&
        Array.isArray(response.details) &&
        response.details.length > 0 &&
        response.details.every(
          (issue) => issue.code === "TEMPLATE_NOT_APPROVED",
        );
      errors.push({
        resultId,
        message: unapprovedForms
          ? "Подтвердите формы документов в настройках центра"
          : response?.message ||
            "Не удалось подготовить комплект. Проверьте программу и реквизиты центра",
      });
    }
  }
  return {
    items: items.map(({ link, artifacts, status, reason }) => ({
      ...link,
      artifacts,
      status,
      reason,
    })),
    errors,
  };
}

// These cursors only schedule bounded work; approval and eligibility remain database facts.
// Restarting a worker restarts the sweep without changing any document state.
const documentSweepCursor: Record<"release" | "render", string | null> = {
  release: null,
  render: null,
};
async function nextDocumentSweep(stage: "release" | "render", limit: number) {
  type Link = Awaited<ReturnType<typeof db.lmsDocumentLink.findMany>>[number];
  const page = (after: string | null) =>
    stage === "release"
      ? db.$queryRaw<Link[]>`
          SELECT DISTINCT ON (l."requestId") l.* FROM "LmsDocumentLink" l
          WHERE l.status='PREPARED' AND l."issuanceId" IS NULL
            AND (${after}::text IS NULL OR l."requestId">${after})
            AND EXISTS (SELECT 1 FROM "RequestProposal" p
              WHERE p."tenantId"=l."tenantId" AND p."requestId"=l."requestId"
                AND p.operation='SAVE' AND p.status='APPROVED')
          ORDER BY l."requestId", l.id LIMIT ${limit}`
      : db.$queryRaw<Link[]>`
          SELECT DISTINCT ON (l."requestId") l.* FROM "LmsDocumentLink" l
          WHERE l.status='PREPARED' AND l."issuanceId" IS NOT NULL
            AND (${after}::text IS NULL OR l."requestId">${after})
          ORDER BY l."requestId", l.id LIMIT ${limit}`;
  let rows = await page(documentSweepCursor[stage]);
  if (!rows.length && documentSweepCursor[stage] !== null)
    rows = await page(null);
  documentSweepCursor[stage] = rows.at(-1)?.requestId ?? null;
  return rows;
}

/** Approval remains an explicit director decision. Only the following mechanical release is automatic. */
export async function advanceLmsDocuments(limit = 30) {
  const batchSize = Number.isFinite(limit)
    ? Math.min(100, Math.max(1, Math.floor(limit)))
    : 30;
  const pending = await nextDocumentSweep("release", batchSize);
  let advanced = 0;
  for (const link of pending) {
    const approved = await db.requestProposal.findFirst({
      where: {
        tenantId: link.tenantId,
        requestId: link.requestId,
        operation: "SAVE",
        status: "APPROVED",
      },
      orderBy: { revision: "desc" },
    });
    if (!approved) continue;
    const request = await db.printRequest.findFirst({
      where: { tenantId: link.tenantId, id: link.requestId },
    });
    if (!request) continue;
    const actor = await db.user.findFirst({
      where: { tenantId: link.tenantId, id: request.createdBy, active: true },
    });
    if (!actor || !["ADMIN", "DIRECTOR", "OPERATOR"].includes(actor.role))
      continue;
    const c: Context = {
      tenantId: link.tenantId,
      userId: actor.id,
      role: actor.role,
      sessionId: "",
      csrfHash: "",
      correlationId: `lms-release-${approved.id}`,
    };
    try {
      await assertLmsDeploymentAllowed(
        await db.tenant.findUniqueOrThrow({ where: { id: c.tenantId } }),
      );
      await assertEligibleResult(db, c, link.resultId);
      let issuance = await db.issuance.findFirst({
        where: { tenantId: c.tenantId, requestId: request.id },
        orderBy: { createdAt: "desc" },
      });
      if (!issuance) {
        const current = await workingRequest(c, request.id);
        await finalize(
          c,
          request.id,
          { expectedRevision: current.revision },
          hash({ requestId: request.id, proposalId: approved.id }),
        );
        issuance = await db.issuance.findFirstOrThrow({
          where: { tenantId: c.tenantId, requestId: request.id },
          orderBy: { createdAt: "desc" },
        });
      }
      await db.lmsDocumentLink.updateMany({
        where: { tenantId: c.tenantId, requestId: request.id },
        data: { issuanceId: issuance.id },
      });
      await audit(db, c, "LMS_APPROVED_DOCUMENTS_RELEASED", request.id, {
        issuanceId: issuance.id,
        approvedProposalId: approved.id,
      });
      advanced++;
    } catch {
      // A repairable approval/layout/signing issue stays visible in the ordinary DEMO request.
      await audit(db, c, "LMS_DOCUMENT_RELEASE_DEFERRED", request.id, {
        proposalId: approved.id,
      });
    }
  }
  const rendering = await nextDocumentSweep("render", batchSize);
  for (const link of rendering) {
    const request = await db.printRequest.findFirst({
      where: { id: link.requestId, tenantId: link.tenantId },
    });
    if (!request) continue;
    const actor = await db.user.findFirst({
      where: { id: request.createdBy, tenantId: link.tenantId, active: true },
    });
    if (!actor || !["ADMIN", "DIRECTOR", "OPERATOR"].includes(actor.role))
      continue;
    const c: Context = {
      tenantId: link.tenantId,
      userId: actor.id,
      role: actor.role,
      sessionId: "",
      csrfHash: "",
      correlationId: `lms-render-${link.id}`,
    };
    try {
      await assertLmsDeploymentAllowed(
        await db.tenant.findUniqueOrThrow({ where: { id: c.tenantId } }),
      );
      const state = await signingState(c, request.id);
      if (state.status === "ISSUED")
        await db.lmsDocumentLink.updateMany({
          where: {
            tenantId: c.tenantId,
            requestId: request.id,
            status: "PREPARED",
          },
          data: { status: "ISSUED" },
        });
    } catch {
      continue;
    }
  }
  return advanced;
}

export async function documentView(c: Context, id: string) {
  const link = await db.lmsDocumentLink.findFirst({
    where: { id, tenantId: c.tenantId },
  });
  if (!link) fail(404, "NOT_FOUND", "Документ не найден");
  const result = await db.verifiedExamResult.findFirstOrThrow({
    where: { id: link.resultId, tenantId: c.tenantId },
  });
  await scopedEnrollment(c, result.enrollmentId);
  const event = await db.lmsResultEvent.findFirst({
    where: {
      tenantId: c.tenantId,
      resultId: result.id,
      kind: { in: ["VOIDED", "SUPERSEDED"] },
    },
    orderBy: { createdAt: "desc" },
  });
  const templateId = Object.entries(lmsTemplateTypes).find(
    ([, value]) => value === link.documentType,
  )![0];
  const document = link.issuanceId
    ? await db.issuedDocument.findFirst({
        where: {
          tenantId: c.tenantId,
          issuanceId: link.issuanceId,
          templateId,
          rowId: result.recipientId,
          assignmentId: `${result.id}-${link.documentType}`,
        },
      })
    : null;
  const artifacts = document
    ? await db.artifact.findMany({
        where: {
          tenantId: c.tenantId,
          documentId: document.id,
          format: { in: ["PDF", "DOCX"] },
        },
        orderBy: { createdAt: "desc" },
      })
    : [];
  const workflow = link.issuanceId
    ? await db.issuanceWorkflow.findFirst({
        where: { tenantId: c.tenantId, issuanceId: link.issuanceId },
      })
    : null;
  const proposal = !link.issuanceId
    ? await db.requestProposal.findFirst({
        where: { tenantId: c.tenantId, requestId: link.requestId },
        orderBy: { revision: "desc" },
      })
    : null;
  const status =
    event?.kind ||
    workflow?.status ||
    (proposal?.status === "REJECTED"
      ? "REJECTED"
      : proposal?.status === "APPROVED"
        ? "PREPARING"
        : "AWAITING_APPROVAL");
  return {
    link: { ...link, number: document?.number || null },
    status,
    reason: event?.reason || null,
    artifacts: artifacts
      .filter(
        (artifact, index, all) =>
          all.findIndex((other) => other.format === artifact.format) === index,
      )
      .map(({ id, format, fileName, mimeType }) => ({
        id,
        kind: format,
        fileName,
        mimeType,
      })),
  };
}

export async function changeResult(
  c: Context,
  id: string,
  input: unknown,
  correct: boolean,
) {
  if (!["DIRECTOR", "ADMIN"].includes(c.role))
    fail(403, "ROLE_DENIED", "Требуется решение директора");
  const { reason } = parse(
    z.object({ reason: z.string().trim().min(3).max(2000) }).strict(),
    input,
  );
  return transaction(async (tx) => {
    await tx.$executeRaw`SELECT id FROM "VerifiedExamResult" WHERE id=${id} AND "tenantId"=${c.tenantId} FOR UPDATE`;
    const prior = await tx.lmsResultEvent.findFirst({
      where: {
        tenantId: c.tenantId,
        resultId: id,
        kind: { in: ["VOIDED", "SUPERSEDED"] },
      },
      orderBy: { createdAt: "desc" },
    });
    if (prior) {
      if (
        prior.kind !== (correct ? "SUPERSEDED" : "VOIDED") ||
        prior.reason !== reason
      )
        fail(
          409,
          "RESULT_REVISION_CONFLICT",
          "Результат уже изменён другим решением",
        );
      const replacement = correct
        ? await tx.verifiedExamResult.findFirst({
            where: { tenantId: c.tenantId, supersedesResultId: id },
          })
        : null;
      return {
        id,
        state: prior.kind,
        replacementResultId: replacement?.id || null,
      };
    }
    const old = await assertEligibleResult(tx, c, id);
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${c.tenantId + ":lms-result:" + old.enrollmentId},0))`;
    let revised = null;
    if (correct) {
      const person = await tx.recipient.findFirstOrThrow({
        where: { tenantId: c.tenantId, id: old.recipientId },
      });
      const data = person.data as Record<string, string>;
      const snapshot = old.snapshot as Record<string, unknown>;
      const nextSnapshot = json({
        ...snapshot,
        learner: {
          recipientId: person.id,
          fullNameRu: data.fullNameRu || "",
          fullNameKz: data.fullNameKz || "",
          positionRu: data.positionRu || "",
          positionKz: data.positionKz || "",
        },
        correction: { supersedesResultId: old.id, reason, actorId: c.userId },
      });
      const last = await tx.verifiedExamResult.findFirstOrThrow({
        where: { tenantId: c.tenantId, enrollmentId: old.enrollmentId },
        orderBy: { revision: "desc" },
      });
      const copy = { ...old };
      revised = await tx.verifiedExamResult.create({
        data: {
          ...copy,
          id: randomUUID(),
          confirmedAt: new Date(),
          revision: last.revision + 1,
          supersedesResultId: old.id,
          snapshot: nextSnapshot,
          snapshotHash: hash(nextSnapshot),
          createdBy: c.userId,
        },
      });
      if (regulatoryProfileSchema.parse(snapshot.profile).sanitary)
        await tx.regulatoryOutbox.create({
          data: { tenantId: c.tenantId, resultId: revised.id },
        });
    }
    const kind = correct ? "SUPERSEDED" : "VOIDED";
    await tx.lmsResultEvent.create({
      data: {
        tenantId: c.tenantId,
        resultId: id,
        kind,
        reason,
        actorId: c.userId,
        correlationId: c.correlationId,
      },
    });
    await tx.integrationDelivery.updateMany({
      where: { tenantId: c.tenantId, resultId: id },
      data: {
        state: "SUPERSEDED",
        lockedUntil: null,
        leaseToken: { increment: 1 },
        lastError: correct
          ? "CORRECTION_REQUIRES_PROVIDER_CAPABILITY"
          : "REVOCATION_REQUIRES_PROVIDER_CAPABILITY",
      },
    });
    const links = await tx.lmsDocumentLink.findMany({
      where: { tenantId: c.tenantId, resultId: id },
    });
    await tx.lmsDocumentLink.updateMany({
      where: { tenantId: c.tenantId, resultId: id },
      data: { status: kind },
    });
    for (const issuanceId of new Set(
      links.flatMap((link) => (link.issuanceId ? [link.issuanceId] : [])),
    )) {
      await tx.issuanceEvent.create({
        data: {
          tenantId: c.tenantId,
          issuanceId,
          kind: correct ? "REPLACED" : "CANCELLED",
          reason,
          actorId: c.userId,
        },
      });
    }
    await audit(
      tx,
      c,
      correct ? "LMS_RESULT_CORRECTED" : "LMS_RESULT_VOIDED",
      id,
      { reason, replacementResultId: revised?.id || null },
    );
    return { id, state: kind, replacementResultId: revised?.id || null };
  });
}

export async function artifactAccess(c: Context, id: string) {
  const artifact = await db.artifact.findFirst({
    where: { id, tenantId: c.tenantId },
  });
  if (!artifact?.documentId || !["PDF", "DOCX"].includes(artifact.format))
    fail(404, "NOT_FOUND", "Файл не найден");
  const document = await db.issuedDocument.findFirstOrThrow({
    where: { id: artifact.documentId, tenantId: c.tenantId },
  });
  const type =
    lmsTemplateTypes[document.templateId as keyof typeof lmsTemplateTypes];
  const candidates = await db.lmsDocumentLink.findMany({
    where: {
      tenantId: c.tenantId,
      requestId: artifact.requestId,
      issuanceId: artifact.issuanceId,
      documentType: type || "NONE",
    },
  });
  const link = candidates.find(
    (candidate) =>
      document.assignmentId ===
      `${candidate.resultId}-${candidate.documentType}`,
  );
  if (!link) fail(404, "NOT_FOUND", "Файл не найден");
  const view = await documentView(c, link.id);
  if (!view.artifacts.some((item) => item.id === artifact.id))
    fail(404, "NOT_FOUND", "Файл не найден");
  return artifact;
}

@Controller()
export class LmsDocumentsController {
  @Get("lms/results") async results(
    @Req() req: DemoRequest,
    @Query() query: Record<string, unknown>,
  ) {
    const c = requireCapability(req, "lms:manage");
    const q = parse(
      z.object({
        page: z.coerce.number().int().min(1).default(1),
        pageSize: z.coerce.number().int().min(1).max(250).default(30),
      }),
      query,
    );
    const enrollmentIds = (
      await db.enrollment.findMany({
        where: await enrollmentFilter(c),
        select: { id: true },
      })
    ).map((e) => e.id);
    const where = { tenantId: c.tenantId, enrollmentId: { in: enrollmentIds } };
    const [results, total] = await Promise.all([
      db.verifiedExamResult.findMany({
        where,
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
        orderBy: { confirmedAt: "desc" },
      }),
      db.verifiedExamResult.count({ where }),
    ]);
    const items = await Promise.all(
      results.map(async (result) => {
        const event = await db.lmsResultEvent.findFirst({
          where: {
            tenantId: c.tenantId,
            resultId: result.id,
            kind: { in: ["VOIDED", "SUPERSEDED"] },
          },
          orderBy: { createdAt: "desc" },
        });
        const links = await db.lmsDocumentLink.findMany({
          where: { tenantId: c.tenantId, resultId: result.id },
        });
        return {
          ...effectiveResult(result, event ? [event] : []),
          documents: await Promise.all(
            links.map(async (link) => {
              const view = await documentView(c, link.id);
              return {
                ...view.link,
                status: view.status,
                reason: view.reason,
                artifacts: view.artifacts,
              };
            }),
          ),
        };
      }),
    );
    return { items, total, ...q };
  }
  @Post("lms/results/documents") prepare(
    @Req() req: DemoRequest,
    @Body() body: unknown,
  ) {
    return prepareResultDocuments(requireCapability(req, "lms:manage"), body);
  }
  @Post("lms/results/:id/revoke") revoke(
    @Req() req: DemoRequest,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    return changeResult(
      requireCapability(req, "center:manage"),
      id,
      body,
      false,
    );
  }
  @Post("lms/results/:id/correct") correct(
    @Req() req: DemoRequest,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    return changeResult(
      requireCapability(req, "center:manage"),
      id,
      body,
      true,
    );
  }
  @Get(["learn/documents/:id", "lms/documents/:id"]) document(
    @Req() req: DemoRequest,
    @Param("id") id: string,
  ) {
    return documentView(lmsContext(req), id);
  }
  @Get(["learn/artifacts/:id", "lms/artifacts/:id"]) async artifact(
    @Req() req: DemoRequest,
    @Param("id") id: string,
    @Res() res: Response,
  ) {
    const c = lmsContext(req);
    await artifactAccess(c, id);
    const { artifact, stream } = await openArtifact(c, id);
    res.setHeader("Content-Type", artifact.mimeType);
    res.setHeader("Content-Length", artifact.size);
    res.setHeader(
      "Content-Disposition",
      `${req.query.inline === "1" ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(artifact.fileName)}`,
    );
    res.once("close", () => stream.destroy());
    stream.once("error", () => res.destroy());
    stream.pipe(res);
    await audit(db, c, "LMS_DOCUMENT_DOWNLOADED", id);
  }
  @Post(["lms/documents/bundle", "learn/documents/bundle"]) async bundle(
    @Req() req: DemoRequest,
    @Body() body: unknown,
    @Res() res: Response,
  ) {
    const c = lmsContext(req);
    const data = parse(
      z
        .object({
          documentIds: z.array(z.string().uuid()).min(1).max(750),
          format: z.enum(["PDF", "DOCX"]).default("PDF"),
        })
        .strict(),
      body,
    );
    const files = [];
    for (const id of [...new Set(data.documentIds)]) {
      const view = await documentView(c, id);
      if (["VOIDED", "SUPERSEDED"].includes(view.status))
        fail(409, "RESULT_INELIGIBLE", "Выберите действующие документы");
      const selected = view.artifacts.find((a) => a.kind === data.format);
      if (!selected)
        fail(
          409,
          "DOCUMENT_NOT_READY",
          "Дождитесь формирования всех выбранных файлов",
        );
      files.push(await artifactAccess(c, selected.id));
    }
    if (files.reduce((sum, file) => sum + file.size, 0) > BUNDLE_PART_BYTES)
      fail(413, "BUNDLE_LIMIT", "Выберите меньшую часть комплекта");
    const rendered = await buildZip(
      files,
      `lms-${randomUUID()}`,
      files.length,
      [],
      {
        includeInventory: true,
        coverText:
          "Подготовленные документы центра. Подписи и правовая форма указаны в каждом файле; этот архив не подтверждает получение ЭЛМК.",
      },
    );
    res
      .type("application/zip")
      .setHeader(
        "Content-Disposition",
        "attachment; filename=LMS-documents.zip",
      );
    res.send(rendered.buffer);
    await audit(db, c, "LMS_DOCUMENT_BUNDLE_DOWNLOADED", "LMS_BUNDLE", {
      documentIds: data.documentIds,
      format: data.format,
    });
  }
}
