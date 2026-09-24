import {
  Body,
  Controller,
  Get,
  Header,
  Param,
  Post,
  Req,
  Res,
} from "@nestjs/common";
import type { Response } from "express";
import { ctx, type DemoRequest } from "./core";
import * as invites from "./employer-invites";
@Controller()
export class EmployerInviteController {
  @Get("employer-invites") list(@Req() req: DemoRequest) {
    return invites.listEmployerInvites(ctx(req, false, true));
  }
  @Post("employer-invites") create(
    @Req() req: DemoRequest,
    @Body() body: unknown,
  ) {
    return invites.createEmployerInvite(ctx(req, true, true), body);
  }
  @Post("employer-invites/:id/revoke") revoke(
    @Req() req: DemoRequest,
    @Param("id") id: string,
  ) {
    return invites.revokeEmployerInvite(ctx(req, true, true), id);
  }
  @Post("auth/employer-invite/inspect")
  @Header("Referrer-Policy", "no-referrer")
  @Header("X-Robots-Tag", "noindex, nofollow")
  inspect(@Req() req: DemoRequest, @Body() body: unknown) {
    return invites.inspectEmployerInvite(req, body);
  }
  @Post("auth/employer-invite/exchange")
  @Header("Referrer-Policy", "no-referrer")
  @Header("X-Robots-Tag", "noindex, nofollow")
  exchange(
    @Req() req: DemoRequest,
    @Res({ passthrough: true }) res: Response,
    @Body() body: unknown,
  ) {
    return invites.exchangeEmployerInvite(req, res, body);
  }
}
