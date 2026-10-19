import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
  Req,
} from "@nestjs/common";
import type { DemoRequest } from "../core";
import { lmsContext } from "./scope";
import { listGroups } from "./groups";
import {
  createTeachingBinding,
  listTeachingBindings,
  revokeTeachingBinding,
  teachingContext,
} from "./teaching-bindings";
import { archiveLearningCourse, reviewCourseVersion } from "./course-review";
import {
  bindMaterial,
  deleteUnusedMaterial,
  listMaterialLibrary,
  setMaterialState,
} from "./material-library";

export const learningAdminRoutes = [
  ["GET", "/lms/groups"],
  ["GET", "/lms/teaching-context"],
  ["GET", "/lms/learning-bindings"],
  ["POST", "/lms/learning-bindings"],
  ["POST", "/lms/learning-bindings/:id/revoke"],
  ["POST", "/lms/course-versions/:id/review"],
  ["POST", "/lms/courses/:id/archive"],
  ["GET", "/lms/material-library"],
  ["POST", "/lms/materials/:id/bind"],
  ["POST", "/lms/materials/:id/state"],
  ["DELETE", "/lms/materials/:id"],
] as const;
@Controller()
export class LmsLearningAdminController {
  @Get("lms/groups") groups(@Req() r: DemoRequest, @Query() q: unknown) {
    return listGroups(lmsContext(r), q);
  }
  @Get("lms/teaching-context") teachingContext(
    @Req() r: DemoRequest,
    @Query() q: unknown,
  ) {
    return teachingContext(lmsContext(r), q);
  }
  @Get("lms/learning-bindings") bindings(
    @Req() r: DemoRequest,
    @Query() q: unknown,
  ) {
    return listTeachingBindings(lmsContext(r), q);
  }
  @Post("lms/learning-bindings") createBinding(
    @Req() r: DemoRequest,
    @Body() b: unknown,
  ) {
    return createTeachingBinding(lmsContext(r), b);
  }
  @Post("lms/learning-bindings/:id/revoke") revoke(
    @Req() r: DemoRequest,
    @Param("id") id: string,
    @Body() b: unknown,
  ) {
    return revokeTeachingBinding(lmsContext(r), id, b);
  }
  @Post("lms/course-versions/:id/review") review(
    @Req() r: DemoRequest,
    @Param("id") id: string,
    @Body() b: unknown,
  ) {
    return reviewCourseVersion(lmsContext(r), id, b);
  }
  @Post("lms/courses/:id/archive") archive(
    @Req() r: DemoRequest,
    @Param("id") id: string,
    @Body() b: unknown,
  ) {
    return archiveLearningCourse(lmsContext(r), id, b);
  }
  @Get("lms/material-library") library(
    @Req() r: DemoRequest,
    @Query() q: unknown,
  ) {
    return listMaterialLibrary(lmsContext(r), q);
  }
  @Post("lms/materials/:id/bind") bind(
    @Req() r: DemoRequest,
    @Param("id") id: string,
    @Body() b: unknown,
  ) {
    return bindMaterial(lmsContext(r), id, b);
  }
  @Post("lms/materials/:id/state") state(
    @Req() r: DemoRequest,
    @Param("id") id: string,
    @Body() b: unknown,
  ) {
    return setMaterialState(lmsContext(r), id, b);
  }
  @Delete("lms/materials/:id") delete(
    @Req() r: DemoRequest,
    @Param("id") id: string,
  ) {
    return deleteUnusedMaterial(lmsContext(r), id);
  }
}
