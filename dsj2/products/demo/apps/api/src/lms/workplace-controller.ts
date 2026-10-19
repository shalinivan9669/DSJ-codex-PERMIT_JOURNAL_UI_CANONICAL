import { Body, Controller, Get, Put, Req } from "@nestjs/common";
import { requireCapability, type DemoRequest } from "../core";
import { lmsContext } from "./scope";
import { lmsWorkplace, ownLmsProfile, saveOwnLmsProfile } from "./workplace";
@Controller()
export class LmsWorkplaceController {
  @Get("lms/workplace") workplace(@Req() req: DemoRequest) {
    return lmsWorkplace(lmsContext(req));
  }
  @Get("lms/profile") profile(@Req() req: DemoRequest) {
    return ownLmsProfile(requireCapability(req, "session"));
  }
  @Put("lms/profile") save(@Req() req: DemoRequest, @Body() body: unknown) {
    return saveOwnLmsProfile(requireCapability(req, "session"), body);
  }
}
