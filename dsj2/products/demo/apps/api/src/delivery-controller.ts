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
import { ctx, type DemoRequest } from "./core";
import {
  clarificationRequest,
  confirmControlSheet,
  controlSheet,
  exportControlSheet,
  listTransfers,
  recordTransfer,
} from "./delivery-approval";

@Controller("print-requests/:id")
export class DeliveryController {
  @Get("control-sheet") sheet(
    @Req() req: DemoRequest,
    @Param("id") id: string,
  ) {
    return controlSheet(ctx(req), id);
  }
  @Post("control-sheet/confirm") confirm(
    @Req() req: DemoRequest,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    return confirmControlSheet(ctx(req, true), id, body);
  }
  @Post("control-sheet/export") async export(
    @Req() req: DemoRequest,
    @Param("id") id: string,
    @Body() body: unknown,
    @Res() res: Response,
  ) {
    const file = await exportControlSheet(ctx(req), id, body);
    res.setHeader("Content-Type", file.mimeType);
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="control-sheet"; filename*=UTF-8''${encodeURIComponent(file.fileName)}`,
    );
    res.setHeader("Cache-Control", "private, no-store");
    res.send(file.buffer);
  }
  @Get("clarification") clarification(
    @Req() req: DemoRequest,
    @Param("id") id: string,
    @Query("customerId") customerId?: string,
  ) {
    return clarificationRequest(ctx(req), id, customerId);
  }
  @Get("transfers") transfers(
    @Req() req: DemoRequest,
    @Param("id") id: string,
  ) {
    return listTransfers(ctx(req), id);
  }
  @Post("transfers") transfer(
    @Req() req: DemoRequest,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    return recordTransfer(ctx(req, true), id, body);
  }
}
