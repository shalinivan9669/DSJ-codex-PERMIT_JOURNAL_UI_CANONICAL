import { Body, Controller, Get, Param, Post, Query, Req } from "@nestjs/common";
import type { DemoRequest } from "../core";
import { lmsContext } from "./scope";
import {
  listSourceLibrary,
  saveSourceRevision,
  sourceTasks,
  resolveSourceTask,
} from "./regulatory-sources";
export const regulatorySourceRoutes = [
  ["GET", "/lms/regulatory-sources"],
  ["POST", "/lms/regulatory-sources"],
  ["POST", "/lms/regulatory-sources/:id/revisions"],
  ["GET", "/lms/regulatory-tasks"],
  ["POST", "/lms/regulatory-tasks/:id"],
] as const;
@Controller()
export class RegulatorySourcesController {
  @Get("lms/regulatory-sources") list(
    @Req() req: DemoRequest,
    @Query() query: unknown,
  ) {
    return listSourceLibrary(lmsContext(req), query);
  }
  @Post("lms/regulatory-sources") create(
    @Req() req: DemoRequest,
    @Body() body: unknown,
  ) {
    return saveSourceRevision(lmsContext(req), body);
  }
  @Post("lms/regulatory-sources/:id/revisions") revise(
    @Req() req: DemoRequest,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    return saveSourceRevision(lmsContext(req), body, id);
  }
  @Get("lms/regulatory-tasks") tasks(
    @Req() req: DemoRequest,
    @Query() query: unknown,
  ) {
    return sourceTasks(lmsContext(req), query);
  }
  @Post("lms/regulatory-tasks/:id") decide(
    @Req() req: DemoRequest,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    return resolveSourceTask(lmsContext(req), id, body);
  }
}
