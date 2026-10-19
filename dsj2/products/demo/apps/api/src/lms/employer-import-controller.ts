import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Put,
  Query,
  Req,
  UploadedFile,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import type { DemoRequest } from "../core";
import { lmsContext } from "./scope";
import * as imports from "./employer-import";
@Controller()
export class LmsEmployerImportController {
  @Get("lms/employer-import/selection") selection(
    @Req() req: DemoRequest,
    @Query() query: unknown,
  ) {
    return imports.assignmentSelection(lmsContext(req), query);
  }
  @Get("lms/employer-import/context") context(
    @Req() req: DemoRequest,
    @Query() query: unknown,
  ) {
    return imports.employerImportContext(lmsContext(req), query);
  }
  @Post("lms/employer-import/file")
  @UseInterceptors(
    FileInterceptor("file", {
      limits: { fileSize: 5 * 1024 * 1024, files: 1, fields: 1 },
    }),
  )
  file(
    @Req() req: DemoRequest,
    @UploadedFile() file: Express.Multer.File,
    @Body("sheet") sheet?: string,
  ) {
    return imports.parseEmployerImportFile(lmsContext(req), file, sheet);
  }
  @Get("lms/employer-import") list(@Req() req: DemoRequest) {
    return imports.listEmployerImports(lmsContext(req));
  }
  @Post("lms/employer-import") create(
    @Req() req: DemoRequest,
    @Body() input: unknown,
  ) {
    return imports.createEmployerImport(lmsContext(req), input);
  }
  @Get("lms/employer-import/:id") detail(
    @Req() req: DemoRequest,
    @Param("id") id: string,
    @Query() query: unknown,
  ) {
    return imports.employerImportDetail(lmsContext(req), id, query);
  }
  @Put("lms/employer-import/:id") update(
    @Req() req: DemoRequest,
    @Param("id") id: string,
    @Body() input: unknown,
  ) {
    return imports.updateEmployerImport(lmsContext(req), id, input);
  }
  @Post("lms/employer-import/:id/confirm") confirm(
    @Req() req: DemoRequest,
    @Param("id") id: string,
    @Body() input: unknown,
  ) {
    return imports.confirmEmployerImport(lmsContext(req), id, input);
  }
  @Post("lms/employer-import/:id/action") action(
    @Req() req: DemoRequest,
    @Param("id") id: string,
    @Body() input: unknown,
  ) {
    return imports.importAction(lmsContext(req), id, input);
  }
}
