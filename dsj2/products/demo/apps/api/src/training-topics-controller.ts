import { Controller, Get, Query, Req } from "@nestjs/common";
import { ctx, type DemoRequest } from "./core";
import { trainingTopics } from "./training-topics";

export const trainingTopicRoutes = [["GET", "/training-topics"]] as const;
@Controller()
export class TrainingTopicsController {
  @Get("training-topics")
  topics(@Req() req: DemoRequest, @Query() query: unknown) {
    return trainingTopics(ctx(req), query);
  }
}
