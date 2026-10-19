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
import type { DemoRequest } from "../core";
import { lmsContext } from "./scope";
import * as teaching from "./teaching-events";
import { learningCalendar } from "./calendar";
import { listGroupRecordings, uploadGroupRecording } from "./teaching-recordings";
import { privateUpload } from "./uploads";
import { lmsMaterialMaxBytes } from "./materials";
import { practiceRoster, recordPractice } from "./practice";
import {
  listLearningNotifications,
  readLearningNotification,
  readAllLearningNotifications,
} from "./notifications";

export const teachingRoutes = [
  ["GET", "/lms/groups/:id/recordings"],
  ["POST", "/lms/groups/:id/recordings"],
  ["GET", "/lms/teaching-events/:id/practice"],
  ["POST", "/lms/teaching-events/:id/practice"],
  ["GET", "/lms/teaching-events"],
  ["POST", "/lms/teaching-events"],
  ["GET", "/lms/teaching-events/:id"],
  ["PUT", "/lms/teaching-events/:id"],
  ["POST", "/lms/teaching-events/:id/cancel"],
  ["GET", "/lms/teaching-events/:id/attendance"],
  ["POST", "/lms/teaching-events/:id/attendance"],
  ["GET", "/lms/calendar"],
  ["GET", "/lms/notifications"],
  ["POST", "/lms/notifications/read-all"],
  ["POST", "/lms/notifications/:id/read"],
] as const;
@Controller()
export class LmsTeachingController {
  @Get("lms/teaching-events/:id/practice") practice(@Req() req: DemoRequest, @Param("id") id: string, @Query() query: unknown) {
    return practiceRoster(lmsContext(req), id, query);
  }
  @Post("lms/teaching-events/:id/practice") reviewPractice(@Req() req: DemoRequest, @Param("id") id: string, @Body() body: unknown) {
    return recordPractice(lmsContext(req), id, body);
  }
  @Get("lms/groups/:id/recordings") recordings(@Req() req: DemoRequest, @Param("id") id: string) {
    return listGroupRecordings(lmsContext(req), id);
  }
  @Post("lms/groups/:id/recordings")
  @UseInterceptors(privateUpload(lmsMaterialMaxBytes))
  uploadRecording(@Req() req: DemoRequest, @Param("id") id: string, @UploadedFile() file: Express.Multer.File | undefined) {
    return uploadGroupRecording(lmsContext(req), id, file);
  }
  @Get("lms/teaching-events") list(
    @Req() req: DemoRequest,
    @Query() query: unknown,
  ) {
    return teaching.listTeachingEvents(lmsContext(req), query);
  }
  @Post("lms/teaching-events") create(
    @Req() req: DemoRequest,
    @Body() body: unknown,
  ) {
    return teaching.createTeachingEvent(lmsContext(req), body);
  }
  @Get("lms/teaching-events/:id") detail(
    @Req() req: DemoRequest,
    @Param("id") id: string,
  ) {
    return teaching.teachingEventDetail(lmsContext(req), id);
  }
  @Put("lms/teaching-events/:id") update(
    @Req() req: DemoRequest,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    return teaching.updateTeachingEvent(lmsContext(req), id, body);
  }
  @Post("lms/teaching-events/:id/cancel") cancel(
    @Req() req: DemoRequest,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    return teaching.updateTeachingEvent(lmsContext(req), id, body, true);
  }
  @Get("lms/teaching-events/:id/attendance") attendance(
    @Req() req: DemoRequest,
    @Param("id") id: string,
    @Query() query: unknown,
  ) {
    return teaching.teachingAttendance(lmsContext(req), id, query);
  }
  @Post("lms/teaching-events/:id/attendance") record(
    @Req() req: DemoRequest,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    return teaching.recordTeachingAttendance(lmsContext(req), id, body);
  }
  @Get("lms/calendar") calendar(
    @Req() req: DemoRequest,
    @Query() query: unknown,
  ) {
    return learningCalendar(lmsContext(req), query);
  }
  @Get("lms/notifications") notifications(
    @Req() req: DemoRequest,
    @Query() query: unknown,
  ) {
    return listLearningNotifications(lmsContext(req), query);
  }
  @Post("lms/notifications/:id/read") read(
    @Req() req: DemoRequest,
    @Param("id") id: string,
  ) {
    return readLearningNotification(lmsContext(req), id);
  }
  @Post("lms/notifications/read-all") readAll(@Req() req: DemoRequest) {
    return readAllLearningNotifications(lmsContext(req));
  }
}
