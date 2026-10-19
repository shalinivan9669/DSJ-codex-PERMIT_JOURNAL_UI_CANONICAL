import { Body, Controller, Get, Post, Req, Res } from "@nestjs/common";
import type { Response } from "express";
import { requireCapability, type DemoRequest } from "./core";
import {
  completeMfaChallenge,
  mfaStatus,
  mfaReauthenticate,
  mfaSetup,
  mfaConfirm,
  mfaManage,
  mfaPolicy,
} from "./mfa";
import { cookies } from "./auth";
@Controller("auth/mfa")
export class MfaController {
  @Post("challenge") challenge(
    @Req() req: DemoRequest,
    @Res({ passthrough: true }) res: Response,
    @Body() body: unknown,
  ) {
    return completeMfaChallenge(req, res, body);
  }
  @Get("status") async status(@Req() req: DemoRequest) {
    return {
      ...(await mfaStatus(requireCapability(req, "session"))),
      csrfToken: cookies(req).demo_csrf || "",
    };
  }
  @Post("reauth") reauth(@Req() req: DemoRequest, @Body() body: unknown) {
    return mfaReauthenticate(requireCapability(req, "session"), body);
  }
  @Post("setup") setup(@Req() req: DemoRequest, @Body() body: unknown) {
    return mfaSetup(requireCapability(req, "session"), body);
  }
  @Post("confirm") confirm(@Req() req: DemoRequest, @Body() body: unknown) {
    return mfaConfirm(requireCapability(req, "session"), body);
  }
  @Post("manage") manage(@Req() req: DemoRequest, @Body() body: unknown) {
    return mfaManage(requireCapability(req, "session"), body);
  }
  @Post("policy") policy(@Req() req: DemoRequest, @Body() body: unknown) {
    return mfaPolicy(requireCapability(req, "session"), body);
  }
}
