import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
} from "@nestjs/common";
import type { DemoRequest } from "../core";
import { rateLimit } from "../auth";
import { lmsContext } from "./scope";
import { createOperatorApplication } from "./operator-applications";
import { createOperatorRecipient } from "./operator-people";
import {
  actOnApplication,
  applicationDefaults,
  coursePublicity,
  listApplications,
  publicCatalogue,
  submitApplication,
} from "./applications";
import {
  applicationOrderSummary,
  closeApplicationOrder,
  recordApplicationStage,
} from "./application-workflow";

@Controller()
export class LmsApplicationsController {
  @Post("lms/operator/recipients") operatorRecipient(
    @Req() req: DemoRequest,
    @Body() body: unknown,
  ) {
    return createOperatorRecipient(lmsContext(req), body);
  }
  @Post("lms/applications/operator") operatorApply(
    @Req() req: DemoRequest,
    @Body() body: unknown,
  ) {
    return createOperatorApplication(lmsContext(req), body);
  }
  @Get("lms/catalogue") authenticatedCatalogue(
    @Req() req: DemoRequest,
    @Query() query: Record<string, unknown>,
  ) {
    return publicCatalogue(query, lmsContext(req));
  }
  @Get("learn/catalogue") catalogue(
    @Req() req: DemoRequest,
    @Query() query: Record<string, unknown>,
  ) {
    rateLimit(`catalogue:${req.ip}`, 120);
    return publicCatalogue(query, req.context);
  }
  @Post("learn/catalogue/applications") publicApply(
    @Req() req: DemoRequest,
    @Body() body: unknown,
  ) {
    return submitApplication(req, body);
  }
  @Get("lms/applications/defaults") defaults(@Req() req: DemoRequest) {
    return applicationDefaults(lmsContext(req));
  }
  @Get("lms/applications") list(
    @Req() req: DemoRequest,
    @Query() query: Record<string, unknown>,
  ) {
    return listApplications(lmsContext(req), query);
  }
  @Post("lms/applications") apply(
    @Req() req: DemoRequest,
    @Body() body: unknown,
  ) {
    return submitApplication(req, body, lmsContext(req));
  }
  @Post("lms/applications/:id/action") action(
    @Req() req: DemoRequest,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    return actOnApplication(lmsContext(req), id, body);
  }
  @Get("lms/applications/:id/order") order(
    @Req() req: DemoRequest,
    @Param("id") id: string,
  ) {
    return applicationOrderSummary(lmsContext(req), id);
  }
  @Post("lms/applications/:id/stages") stage(
    @Req() req: DemoRequest,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    return recordApplicationStage(lmsContext(req), id, body);
  }
  @Post("lms/applications/:id/close") close(
    @Req() req: DemoRequest,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    return closeApplicationOrder(lmsContext(req), id, body);
  }
  @Get("lms/courses/:id/catalogue") publicity(
    @Req() req: DemoRequest,
    @Param("id") id: string,
  ) {
    return coursePublicity(lmsContext(req), id);
  }
  @Patch("lms/courses/:id/catalogue") setPublicity(
    @Req() req: DemoRequest,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    return coursePublicity(lmsContext(req), id, body);
  }
}
