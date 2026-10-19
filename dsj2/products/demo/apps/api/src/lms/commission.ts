import { Body, Controller, Get, Param, Post, Query, Req, Res } from "@nestjs/common";
import type { Response } from "express";
import { Prisma } from "@demo/database";
import { z } from "@demo/contracts";
import { audit, db, fail, hash, parse, transaction, type Context, type DemoRequest } from "../core";
import { startSigning, completeSigning, signingState } from "../signing";
import { openArtifact } from "../storage";
import { lmsContext } from "./scope";
import { assertCommissionAccess, commissionScopeSql } from "./commission-access";

async function commissionDetail(c: Context, id: string) {
  const scope = await assertCommissionAccess(c, id);
  const [state, confirmations, results] = await Promise.all([
    signingState(c, scope.requestId, db, id),
    db.auditEvent.findMany({ where: { tenantId: c.tenantId, entityId: id, actorId: c.userId,
      action: "LMS_PROTOCOL_CONFIRMED" }, orderBy: { createdAt: "desc" }, take: 1 }),
    db.$queryRaw<Array<{ id: string; fullName: string; title: string; verdict: string; score: number | null; maximum: number | null }>>(
      Prisma.sql`SELECT DISTINCT r.id,rec.data->>'fullNameRu' AS "fullName",v.content->>'titleRu' AS title,r.verdict,r.score,r.maximum
        FROM "LmsDocumentLink" l JOIN "VerifiedExamResult" r ON r."tenantId"=l."tenantId" AND r.id=l."resultId"
        JOIN "Enrollment" e ON e."tenantId"=r."tenantId" AND e.id=r."enrollmentId"
        JOIN "Recipient" rec ON rec."tenantId"=e."tenantId" AND rec.id=e."recipientId"
        JOIN "CourseVersion" v ON v."tenantId"=e."tenantId" AND v.id=e."courseVersionId"
        WHERE l."tenantId"=${c.tenantId} AND l."issuanceId"=${id} ORDER BY "fullName",r.id`),
  ]);
  const revision = hash(state.documents.map((d) => ({ id: d.documentId, sha256: d.documentSha256 })).sort((a, b) => a.id.localeCompare(b.id)));
  const confirmed = confirmations.find((entry) => (entry.metadata as { revision?: string })?.revision === revision);
  const invalid = "invalidatedBy" in state && state.invalidatedBy;
  const canConfirm = !invalid && state.documents.some((d) => d.templateId === "lms-protocol") && state.documents.every((d) => !!d.artifactId);
  return { id, requestId: scope.requestId, state, results, revision, canConfirm,
    confirmedAt: confirmed?.createdAt || null };
}

@Controller()
export class LmsCommissionController {
  @Get("lms/commission") async list(@Req() req: DemoRequest, @Query() raw: unknown) {
    const c = lmsContext(req);
    const q = parse(z.object({ page: z.coerce.number().int().positive().default(1) }).strict(), raw);
    const where = commissionScopeSql(c);
    const [items, count] = await Promise.all([
      db.$queryRaw<Array<{ id: string; requestId: string; status: string; createdAt: Date; number: string | null }>>(
        Prisma.sql`SELECT w."issuanceId" AS id,w."requestId",w.status,w."createdAt",
          (SELECT d.number FROM "IssuedDocument" d WHERE d."tenantId"=w."tenantId" AND d."issuanceId"=w."issuanceId"
            AND d."templateId"='lms-protocol' ORDER BY d.id LIMIT 1) AS number
          FROM "IssuanceWorkflow" w WHERE ${where} ORDER BY w."createdAt" DESC,w.id DESC LIMIT 30 OFFSET ${(q.page - 1) * 30}`),
      db.$queryRaw<Array<{ total: bigint }>>(Prisma.sql`SELECT count(*) AS total FROM "IssuanceWorkflow" w WHERE ${where}`),
    ]);
    return { items, page: q.page, pageSize: 30, total: Number(count[0]?.total || 0) };
  }
  @Get("lms/commission/:id") detail(@Req() req: DemoRequest, @Param("id") id: string) {
    return commissionDetail(lmsContext(req), id);
  }
  @Post("lms/commission/:id/confirm") async confirm(@Req() req: DemoRequest, @Param("id") id: string, @Body() raw: unknown) {
    const c = lmsContext(req);
    const input = parse(z.object({ revision: z.string().length(64), confirmed: z.literal(true) }).strict(), raw);
    await transaction(async (tx) => {
      await tx.$executeRaw`SELECT id FROM "IssuanceWorkflow" WHERE "tenantId"=${c.tenantId} AND "issuanceId"=${id} FOR UPDATE`;
      await tx.$executeRaw`SELECT id FROM "LmsTeachingBinding" WHERE "tenantId"=${c.tenantId} AND "userId"=${c.userId} ORDER BY id FOR UPDATE`;
      await assertCommissionAccess(c, id, tx);
      const invalid = await tx.issuanceEvent.findFirst({ where: { tenantId: c.tenantId, issuanceId: id, kind: { in: ["CANCELLED", "REPLACED"] } } });
      const workflow = await tx.issuanceWorkflow.findFirstOrThrow({ where: { tenantId: c.tenantId, issuanceId: id } });
      const request = await tx.printRequest.findFirstOrThrow({ where: { tenantId: c.tenantId, id: workflow.requestId } });
      if (invalid || request.status === "CANCELLED") fail(409, "PROTOCOL_INVALIDATED", "Протокол отменён или заменён");
      const documents = await tx.issuedDocument.findMany({ where: { tenantId: c.tenantId, issuanceId: id } });
      const artifacts = await tx.artifact.findMany({ where: { tenantId: c.tenantId, issuanceId: id, provenance: "ORIGINAL", format: "PDF" } });
      const revision = hash(documents.map((d) => ({ id: d.id, sha256: artifacts.find((a) => a.documentId === d.id)?.sha256 || null })).sort((a, b) => a.id.localeCompare(b.id)));
      if (!documents.some((d) => d.templateId === "lms-protocol") || documents.some((d) => !artifacts.some((a) => a.documentId === d.id)))
        fail(409, "PROTOCOL_NOT_READY", "Дождитесь подготовки всех документов");
      if (revision !== input.revision) fail(409, "REVISION_CONFLICT", "Документы изменились. Откройте актуальный протокол");
      const previous = await tx.auditEvent.findFirst({ where: { tenantId: c.tenantId, actorId: c.userId, entityId: id,
        action: "LMS_PROTOCOL_CONFIRMED", metadata: { path: ["revision"], equals: revision } } });
      if (!previous) await audit(tx, c, "LMS_PROTOCOL_CONFIRMED", id, { revision, documentIds: documents.map((d) => d.id),
        meaning: "COMMISSION_REVIEW", signature: false });
    });
    return commissionDetail(c, id);
  }
  @Get("lms/commission/:id/signing") async signing(@Req() req: DemoRequest, @Param("id") id: string) {
    const c = lmsContext(req), scope = await assertCommissionAccess(c, id);
    return signingState(c, scope.requestId, db, id);
  }
  @Post("lms/commission/:id/signing") async start(@Req() req: DemoRequest, @Param("id") id: string, @Body() raw: unknown) {
    const c = lmsContext(req), scope = await assertCommissionAccess(c, id);
    const data = parse(z.object({ artifactId: z.string().uuid(), provider: z.enum(["EGOV_QR", "NCALAYER"]) }).strict(), raw);
    const artifact = await db.artifact.findFirst({ where: { tenantId: c.tenantId, issuanceId: id, id: data.artifactId } });
    if (!artifact) fail(404, "NOT_FOUND", "Файл протокола не найден");
    return startSigning(c, scope.requestId, data);
  }
  @Post("lms/commission/:id/signatures") async complete(@Req() req: DemoRequest, @Param("id") id: string, @Body() raw: unknown) {
    const c = lmsContext(req);
    await assertCommissionAccess(c, id);
    const data = parse(z.object({ sessionId: z.string().uuid(), signatureBase64: z.string().max(4_000_000).optional() }).strict(), raw);
    const session = await db.signingSession.findFirst({ where: { tenantId: c.tenantId, issuanceId: id, id: data.sessionId, createdBy: c.userId } });
    if (!session) fail(404, "NOT_FOUND", "Сеанс подписи не найден");
    return completeSigning(c, session.id, data.signatureBase64 ? { signatureBase64: data.signatureBase64 } : {});
  }
  @Get("lms/commission/:id/artifacts/:artifactId") async artifact(@Req() req: DemoRequest, @Param("id") id: string,
    @Param("artifactId") artifactId: string, @Res() res: Response) {
    const c = lmsContext(req);
    await assertCommissionAccess(c, id);
    const found = await db.artifact.findFirst({ where: { tenantId: c.tenantId, issuanceId: id, id: artifactId, provenance: "ORIGINAL", format: "PDF" } });
    if (!found) fail(404, "NOT_FOUND", "PDF протокола не найден");
    const { artifact, stream } = await openArtifact(c, artifactId);
    res.setHeader("Content-Type", artifact.mimeType);
    res.setHeader("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(artifact.fileName)}`);
    res.setHeader("Content-Length", artifact.size);
    res.once("close", () => stream.destroy());
    stream.once("error", () => res.destroy());
    stream.pipe(res);
    await audit(db, c, "LMS_COMMISSION_DOCUMENT_DOWNLOADED", artifactId);
  }
}
