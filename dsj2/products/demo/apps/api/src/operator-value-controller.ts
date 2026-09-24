import {
  Controller,
  Get,
  Post,
  Patch,
  Put,
  Req,
  Res,
  Body,
  Param,
  Query,
} from "@nestjs/common";
import type { Response } from "express";
import { ctx, fail, audit, db, type DemoRequest, type Context } from "./core";
import { openArtifact } from "./storage";
import * as value from "./operator-value";
import { exportTenant } from "./tenant-export";
import { centerDossierReminders, exportCenterDossier } from "./center-dossier";
import { rateLimit } from "./auth";
import { createHash } from "node:crypto";
import { evidenceMatrix, scanRenewals } from "./renewal-matrix";
import {
  addPortalEvidence,
  attachPortalEvidence,
  downloadPortalEvidence,
  portalEvidence,
  portalMatrix,
} from "./portal-evidence";

// Explicit product-policy entries: these are also inspected by route-coverage tests.
export const operatorValueRoutes = [
  ["GET", "/tenant-export"],
  ["GET", "/operator-value/summary"],
  ["GET", "/orders"],
  ["POST", "/orders"],
  ["GET", "/orders/:id"],
  ["PATCH", "/orders/:id"],
  ["POST", "/orders/:id/milestones"],
  ["PATCH", "/orders/:id/milestones/:milestoneId"],
  ["PUT", "/orders/:id/commercial"],
  ["GET", "/orders/:id/commercial-export"],
  ["POST", "/orders/:id/payments"],
  ["POST", "/orders/:id/financial-documents"],
  ["GET", "/orders/:id/dossier"],
  ["GET", "/orders/:id/dossier/export"],
  ["GET", "/renewals"],
  ["POST", "/renewals"],
  ["POST", "/renewals/scan"],
  ["PATCH", "/renewals/:id"],
  ["POST", "/renewals/:id/contacts"],
  ["POST", "/renewals/:id/repeat"],
  ["GET", "/evidence"],
  ["POST", "/evidence"],
  ["POST", "/evidence/matrix"],
  ["POST", "/evidence/:id/verify"],
  ["GET", "/service-rules"],
  ["POST", "/service-rules"],
  ["GET", "/dossier"],
  ["GET", "/dossier/reminders"],
  ["POST", "/dossier/export"],
  ["POST", "/dossier"],
  ["POST", "/value-attachments"],
  ["GET", "/value-attachments/:id"],
  ["GET", "/employer-memberships"],
  ["POST", "/employer-memberships"],
  ["POST", "/employer-memberships/:id/revoke"],
  ["GET", "/portal"],
  ["GET", "/portal/evidence"],
  ["POST", "/portal/evidence"],
  ["GET", "/portal/matrix"],
  ["POST", "/portal/evidence/:id/attachments"],
  ["GET", "/portal/evidence-attachments/:id"],
  ["GET", "/portal/artifacts/:id"],
  ["POST", "/portal/orders/:id/proposals"],
  ["POST", "/orders/:id/proposals/:proposalId/resolve"],
] as const;

function employerContext(req: DemoRequest): Context {
  if (!req.context) fail(401, "SESSION_REQUIRED", "Войдите в кабинет");
  if (req.context.role !== "EMPLOYER")
    fail(
      403,
      "EMPLOYER_ONLY",
      "Используйте отдельный доступ представителя работодателя",
    );
  return req.context;
}
function fileHeaders(
  res: Response,
  file: { mimeType: string; fileName: string; size: number; sha256: string },
) {
  res.setHeader("Content-Type", file.mimeType);
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="${file.fileName.replace(/[^a-zA-Z0-9._-]/g, "_")}"; filename*=UTF-8''${encodeURIComponent(file.fileName)}`,
  );
  res.setHeader("Content-Length", file.size);
  res.setHeader("Cache-Control", "private, no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Content-Security-Policy", "default-src 'none'; sandbox");
  res.setHeader("X-Content-SHA256", file.sha256);
}

@Controller()
export class OperatorValueController {
  @Get("tenant-export") async tenantExport(
    @Req() req: DemoRequest,
    @Res() res: Response,
  ) {
    const c = ctx(req, false, true);
    rateLimit(`tenant-export:${c.userId}`, 3, 300000);
    const result = await exportTenant(c);
    fileHeaders(res, { ...result, size: result.buffer.length });
    res.send(result.buffer);
  }
  @Get("operator-value/summary") summary(@Req() req: DemoRequest) {
    return value.operatorValueSummary(ctx(req));
  }
  @Get("orders") orders(
    @Req() req: DemoRequest,
    @Query("search") search?: string,
  ) {
    return value.listServiceOrders(ctx(req), search);
  }
  @Post("orders") createOrder(@Req() req: DemoRequest, @Body() body: unknown) {
    return value.createServiceOrder(ctx(req, true), body);
  }
  @Get("orders/:id") order(@Req() req: DemoRequest, @Param("id") id: string) {
    return value.serviceOrderDetail(ctx(req), id);
  }
  @Patch("orders/:id") patchOrder(
    @Req() req: DemoRequest,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    return value.patchServiceOrder(ctx(req, true), id, body);
  }
  @Post("orders/:id/milestones") milestone(
    @Req() req: DemoRequest,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    return value.createOrderMilestone(ctx(req, true), id, body);
  }
  @Patch("orders/:id/milestones/:milestoneId") patchMilestone(
    @Req() req: DemoRequest,
    @Param("id") id: string,
    @Param("milestoneId") milestoneId: string,
    @Body() body: unknown,
  ) {
    return value.patchOrderMilestone(ctx(req, true), id, milestoneId, body);
  }
  @Put("orders/:id/commercial") commercial(
    @Req() req: DemoRequest,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    return value.saveCommercial(ctx(req, true), id, body);
  }
  @Get("orders/:id/commercial-export") commercialExport(
    @Req() req: DemoRequest,
    @Param("id") id: string,
  ) {
    return value.commercialExchange(ctx(req), id);
  }
  @Post("orders/:id/payments") payment(
    @Req() req: DemoRequest,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    return value.recordPayment(ctx(req, true, true), id, body);
  }
  @Post("orders/:id/financial-documents") financeDocument(
    @Req() req: DemoRequest,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    return value.recordFinancialDocument(ctx(req, true), id, body);
  }
  @Get("orders/:id/dossier") orderDossier(
    @Req() req: DemoRequest,
    @Param("id") id: string,
  ) {
    return value.assembleOrderDossier(ctx(req), id);
  }
  @Get("orders/:id/dossier/export") async exportDossier(
    @Req() req: DemoRequest,
    @Param("id") id: string,
    @Res() res: Response,
  ) {
    const result = await value.exportOrderDossier(ctx(req), id);
    fileHeaders(res, {
      ...result,
      size: result.buffer.length,
      sha256: createHash("sha256").update(result.buffer).digest("hex"),
    });
    res.send(result.buffer);
  }
  @Get("renewals") renewals(@Req() req: DemoRequest) {
    return value.listRenewals(ctx(req));
  }
  @Post("renewals/scan") scan(@Req() req: DemoRequest, @Body() body: unknown) {
    return scanRenewals(ctx(req, true, true), body);
  }
  @Post("evidence/matrix") matrix(
    @Req() req: DemoRequest,
    @Body() body: unknown,
  ) {
    return evidenceMatrix(ctx(req), body);
  }
  @Post("renewals") createRenewal(
    @Req() req: DemoRequest,
    @Body() body: unknown,
  ) {
    return value.createRenewalNeed(ctx(req, true), body);
  }
  @Patch("renewals/:id") renewal(
    @Req() req: DemoRequest,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    return value.updateRenewal(ctx(req, true), id, body);
  }
  @Post("renewals/:id/contacts") contact(
    @Req() req: DemoRequest,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    return value.recordRenewalContact(ctx(req, true), id, body);
  }
  @Post("renewals/:id/repeat") repeat(
    @Req() req: DemoRequest,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    return value.repeatFromRenewal(ctx(req, true), id, body);
  }
  @Get("evidence") evidence(
    @Req() req: DemoRequest,
    @Query("customerId") customerId?: string,
  ) {
    return value.listExternalEvidence(ctx(req), customerId);
  }
  @Post("evidence") createEvidence(
    @Req() req: DemoRequest,
    @Body() body: unknown,
  ) {
    return value.createExternalEvidence(ctx(req, true), body);
  }
  @Post("evidence/:id/verify") verify(
    @Req() req: DemoRequest,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    return value.verifyExternalEvidence(ctx(req, true), id, body);
  }
  @Get("service-rules") rules(@Req() req: DemoRequest) {
    return value.listServiceRules(ctx(req));
  }
  @Post("service-rules") createRule(
    @Req() req: DemoRequest,
    @Body() body: unknown,
  ) {
    return value.createServiceRule(ctx(req, true, true), body);
  }
  @Get("dossier") dossier(@Req() req: DemoRequest) {
    return value.listDossier(ctx(req));
  }
  @Get("dossier/reminders") dossierReminders(
    @Req() req: DemoRequest,
    @Query() query: Record<string, unknown>,
  ) {
    return centerDossierReminders(ctx(req), query);
  }
  @Post("dossier/export") async dossierExport(
    @Req() req: DemoRequest,
    @Body() body: unknown,
    @Res() res: Response,
  ) {
    const result = await exportCenterDossier(ctx(req), body);
    fileHeaders(res, {
      ...result,
      size: result.buffer.length,
      sha256: createHash("sha256").update(result.buffer).digest("hex"),
    });
    res.send(result.buffer);
  }
  @Post("dossier") createDossier(
    @Req() req: DemoRequest,
    @Body() body: unknown,
  ) {
    return value.createDossierRecord(ctx(req, true), body);
  }
  @Post("value-attachments") attachment(
    @Req() req: DemoRequest,
    @Body() body: unknown,
  ) {
    return value.addValueAttachment(ctx(req, true), body);
  }
  @Get("value-attachments/:id") async downloadAttachment(
    @Req() req: DemoRequest,
    @Param("id") id: string,
    @Res() res: Response,
  ) {
    const { attachment, bytes } = await value.readValueAttachment(ctx(req), id);
    fileHeaders(res, attachment);
    res.send(bytes);
  }
  @Get("employer-memberships") memberships(@Req() req: DemoRequest) {
    return value.listEmployerMemberships(ctx(req, false, true));
  }
  @Post("employer-memberships") membership(
    @Req() req: DemoRequest,
    @Body() body: unknown,
  ) {
    return value.createEmployerMembership(ctx(req, true, true), body);
  }
  @Post("employer-memberships/:id/revoke") revoke(
    @Req() req: DemoRequest,
    @Param("id") id: string,
  ) {
    return value.revokeEmployerMembership(ctx(req, true, true), id);
  }
  @Get("portal") portal(@Req() req: DemoRequest) {
    return value.employerPortal(employerContext(req));
  }
  @Get("portal/evidence") evidenceForEmployer(
    @Req() req: DemoRequest,
    @Query("customerId") customerId: string,
  ) {
    return portalEvidence(employerContext(req), customerId);
  }
  @Get("portal/matrix") matrixForEmployer(
    @Req() req: DemoRequest,
    @Query("customerId") customerId: string,
  ) {
    return portalMatrix(employerContext(req), customerId);
  }
  @Post("portal/evidence") createEmployerEvidence(
    @Req() req: DemoRequest,
    @Body() body: unknown,
  ) {
    return addPortalEvidence(employerContext(req), body);
  }
  @Post("portal/evidence/:id/attachments") uploadEmployerEvidence(
    @Req() req: DemoRequest,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    return attachPortalEvidence(employerContext(req), id, body);
  }
  @Get("portal/evidence-attachments/:id") async employerEvidenceFile(
    @Req() req: DemoRequest,
    @Param("id") id: string,
    @Res() res: Response,
  ) {
    const { attachment, bytes } = await downloadPortalEvidence(
      employerContext(req),
      id,
    );
    fileHeaders(res, attachment);
    res.send(bytes);
  }
  @Get("portal/artifacts/:id") async portalFile(
    @Req() req: DemoRequest,
    @Param("id") id: string,
    @Res() res: Response,
  ) {
    const c = employerContext(req);
    await value.employerArtifactAccess(c, id);
    const { artifact, stream } = await openArtifact(c, id);
    fileHeaders(res, artifact);
    try {
      await audit(db, c, "EMPLOYER_ARTIFACT_DOWNLOADED", id);
    } catch (error) {
      stream.destroy();
      throw error;
    }
    stream.on("error", () => res.destroy());
    res.on("close", () => stream.destroy());
    stream.pipe(res);
  }
  @Post("portal/orders/:id/proposals") proposal(
    @Req() req: DemoRequest,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    return value.submitEmployerProposal(employerContext(req), id, body);
  }
  @Post("orders/:id/proposals/:proposalId/resolve") resolve(
    @Req() req: DemoRequest,
    @Param("id") id: string,
    @Param("proposalId") proposalId: string,
    @Body() body: unknown,
  ) {
    return value.resolveEmployerProposal(ctx(req, true), id, proposalId, body);
  }
}
