import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Put,
  Query,
  Req,
} from "@nestjs/common";
import type { DemoRequest } from "../core";
import { lmsContext } from "./scope";
import * as groups from "./groups";
import { setCoursePause, setRegulatoryReview } from "./courses";

@Controller()
export class LmsScalingController {
  @Get("lms/groups/:id") detail(
    @Req() req: DemoRequest,
    @Param("id") id: string,
    @Query() query: unknown,
  ) {
    return groups.groupDetail(lmsContext(req), id, query);
  }
  @Put("lms/groups/:id") update(
    @Req() req: DemoRequest,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    return groups.updateGroup(lmsContext(req), id, body);
  }
  @Post("lms/groups/:id/members") add(
    @Req() req: DemoRequest,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    return groups.addGroupMembers(lmsContext(req), id, body);
  }
  @Post("lms/groups/:id/members/:enrollmentId/exclude") exclude(
    @Req() req: DemoRequest,
    @Param("id") id: string,
    @Param("enrollmentId") enrollmentId: string,
  ) {
    return groups.excludeGroupMember(lmsContext(req), id, enrollmentId);
  }
  @Get("lms/orders/:id") order(
    @Req() req: DemoRequest,
    @Param("id") id: string,
  ) {
    return groups.orderTraining(lmsContext(req), id);
  }
  @Post("lms/courses/:id/pause") pause(
    @Req() req: DemoRequest,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    return setCoursePause(lmsContext(req), id, body);
  }
  @Post("lms/courses/:id/regulatory-review") review(
    @Req() req: DemoRequest,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    return setRegulatoryReview(lmsContext(req), id, body);
  }
}
