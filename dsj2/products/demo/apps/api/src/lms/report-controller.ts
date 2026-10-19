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
import { ctx, type DemoRequest } from "../core";
import { lmsContext } from "./scope";
import { queryReport, reportFilterOptions } from "./report-query";
import {
  createReport,
  listReports,
  reportStatus,
  retryReport,
  cancelReport,
  reportFile,
} from "./reports";

@Controller()
export class LmsReportsController {
  @Post("lms/reports/query") query(
    @Req() req: DemoRequest,
    @Body() body: unknown,
  ) {
    return queryReport(
      req.context?.role === "VIEWER" ? ctx(req) : lmsContext(req),
      body,
    );
  }
  @Get("lms/reports/filters") filters(@Req() req: DemoRequest) {
    return reportFilterOptions(
      req.context?.role === "VIEWER" ? ctx(req) : lmsContext(req),
    );
  }
  @Get("lms/reports") list(@Req() req: DemoRequest) {
    return listReports(lmsContext(req));
  }
  @Post("lms/reports") create(@Req() req: DemoRequest, @Body() body: unknown) {
    return createReport(lmsContext(req), body);
  }
  @Get("lms/reports/:id") status(
    @Req() req: DemoRequest,
    @Param("id") id: string,
    @Query("page") page?: string,
    @Query("pageSize") pageSize?: string,
  ) {
    return reportStatus(
      lmsContext(req),
      id,
      Number(page || 1),
      Number(pageSize || 30),
    );
  }
  @Post("lms/reports/:id/retry") retry(
    @Req() req: DemoRequest,
    @Param("id") id: string,
  ) {
    return retryReport(lmsContext(req), id);
  }
  @Post("lms/reports/:id/cancel") cancel(
    @Req() req: DemoRequest,
    @Param("id") id: string,
  ) {
    return cancelReport(lmsContext(req), id);
  }
  @Get("lms/reports/:id/file") async file(
    @Req() req: DemoRequest,
    @Param("id") id: string,
    @Res() res: Response,
  ) {
    const { opened, mimeType, fileName } = await reportFile(
      lmsContext(req),
      id,
    );
    if (opened.invalid) {
      res.status(416).end();
      return;
    }
    pipePrivateResponse(res, opened.stream, () => {
      res.setHeader("Cache-Control", "private, no-store");
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.setHeader("Content-Security-Policy", "sandbox");
      res.setHeader("Content-Type", mimeType);
      res.setHeader(
        "Content-Disposition",
        `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`,
      );
      res.setHeader("Content-Length", opened.size);
    });
  }
}
import { pipePrivateResponse } from "./private-stream-response";
