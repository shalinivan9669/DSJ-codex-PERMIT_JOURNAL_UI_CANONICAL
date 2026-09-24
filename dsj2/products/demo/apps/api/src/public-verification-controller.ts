import { Controller, Get, Post, Req, Res, Body, Param } from "@nestjs/common";
import type { Response } from "express";
import { ctx, type DemoRequest } from "./core";
import { rateLimit } from "./auth";
import * as verification from "./public-verification";

export const publicVerificationRoutes = [
  ["GET", "/verification/:token"],
  ["POST", "/verification/:token/corrections"],
  ["GET", "/verification-links"],
  ["POST", "/verification-links"],
  ["POST", "/verification-links/:id/revoke"],
  ["GET", "/document-corrections"],
  ["POST", "/document-corrections/:id/resolve"],
] as const;
function privacy(res: Response) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("X-Robots-Tag", "noindex, nofollow, noarchive");
}
@Controller()
export class PublicVerificationController {
  @Get("verification/:token") record(
    @Req() req: DemoRequest,
    @Res({ passthrough: true }) res: Response,
    @Param("token") token: string,
  ) {
    privacy(res);
    rateLimit(`verification-read:${req.ip}`, 60);
    return verification.publicVerificationRecord(token);
  }
  @Post("verification/:token/corrections") correction(
    @Req() req: DemoRequest,
    @Res({ passthrough: true }) res: Response,
    @Param("token") token: string,
    @Body() body: unknown,
  ) {
    privacy(res);
    rateLimit(`verification-correction:${req.ip}`, 10, 60 * 60 * 1000);
    return verification.submitPublicCorrection(token, body);
  }
  @Get("verification-links") links(@Req() req: DemoRequest) {
    return verification.listVerificationLinks(ctx(req));
  }
  @Post("verification-links") create(
    @Req() req: DemoRequest,
    @Body() body: unknown,
  ) {
    return verification.createVerificationLink(ctx(req, true), body);
  }
  @Post("verification-links/:id/revoke") revoke(
    @Req() req: DemoRequest,
    @Param("id") id: string,
  ) {
    return verification.revokeVerificationLink(ctx(req, true), id);
  }
  @Get("document-corrections") requests(@Req() req: DemoRequest) {
    return verification.listDocumentCorrections(ctx(req));
  }
  @Post("document-corrections/:id/resolve") resolve(
    @Req() req: DemoRequest,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    return verification.resolveDocumentCorrection(ctx(req, true), id, body);
  }
}
