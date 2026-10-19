import { Body, Controller, Get, Param, Post, Query, Req } from "@nestjs/common";
import type { DemoRequest } from "../core";
import { lmsContext } from "./scope";
import {
  proctoringDetail,
  proctoringQueue,
  recordProctoring,
} from "./proctoring";
export const proctoringRoutes = [
  ["GET", "/lms/proctoring"],
  ["GET", "/lms/enrollments/:id/proctoring"],
  ["POST", "/lms/enrollments/:id/proctoring"],
] as const;
@Controller()
export class LmsProctoringController {
  @Get("lms/proctoring") list(
    @Req() req: DemoRequest,
    @Query() query: unknown,
  ) {
    return proctoringQueue(lmsContext(req), query);
  }
  @Get("lms/enrollments/:id/proctoring") detail(
    @Req() req: DemoRequest,
    @Param("id") id: string,
  ) {
    return proctoringDetail(lmsContext(req), id);
  }
  @Post("lms/enrollments/:id/proctoring") decide(
    @Req() req: DemoRequest,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    return recordProctoring(lmsContext(req), id, body);
  }
}
