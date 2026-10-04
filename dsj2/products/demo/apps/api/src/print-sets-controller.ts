import { Body, Controller, Param, Post, Req } from "@nestjs/common";
import { ctx, type DemoRequest } from "./core";
import { buildPrintSet, printSetPlan } from "./print-sets";

@Controller("print-requests/:id")
export class PrintSetsController {
  @Post("print-set/plan") plan(
    @Req() req: DemoRequest,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    return printSetPlan(ctx(req), id, body);
  }
  @Post("print-set") build(
    @Req() req: DemoRequest,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    return buildPrintSet(ctx(req), id, body);
  }
}
