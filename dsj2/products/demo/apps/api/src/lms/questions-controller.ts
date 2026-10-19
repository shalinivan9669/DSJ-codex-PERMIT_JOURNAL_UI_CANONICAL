import { Body, Controller, Get, Param, Post, Query, Req } from "@nestjs/common";
import type { DemoRequest } from "../core";
import { lmsContext } from "./scope";
import { listQuestions, questionRevisions, saveQuestion } from "./questions";
import { importQuestions } from "./question-import";

export const lmsQuestionRoutes = [
  ["GET", "/lms/questions"],
  ["POST", "/lms/questions"],
  ["POST", "/lms/questions/import"],
  ["GET", "/lms/questions/:id/revisions"],
  ["POST", "/lms/questions/:id/revisions"],
] as const;
@Controller()
export class LmsQuestionsController {
  @Post("lms/questions/import") import(@Req() req: DemoRequest, @Body() input: unknown) { return importQuestions(lmsContext(req), input); }
  @Get("lms/questions") list(@Req() req: DemoRequest, @Query() query: unknown) {
    return listQuestions(lmsContext(req), query);
  }
  @Post("lms/questions") create(
    @Req() req: DemoRequest,
    @Body() input: unknown,
  ) {
    return saveQuestion(lmsContext(req), input);
  }
  @Get("lms/questions/:id/revisions") revisions(
    @Req() req: DemoRequest,
    @Param("id") id: string,
  ) {
    return questionRevisions(lmsContext(req), id);
  }
  @Post("lms/questions/:id/revisions") revise(
    @Req() req: DemoRequest,
    @Param("id") id: string,
    @Body() input: unknown,
  ) {
    return saveQuestion(lmsContext(req), input, id);
  }
}
