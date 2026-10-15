import {
  Body,
  Controller,
  Get,
  Post,
  Put,
  Param,
  Query,
  Req,
  Res,
  UploadedFile,
  UseInterceptors,
  UseGuards,
  type CanActivate,
  type ExecutionContext,
} from "@nestjs/common";
import { unlink } from "node:fs/promises";
import type { Response } from "express";
import { db, fail, type DemoRequest } from "../core";
import { assertLmsStaff, lmsContext, scopedEnrollment } from "./scope";
import * as courses from "./courses";
import * as enrollments from "./enrollments";
import * as learning from "./learning";
import * as exams from "./exams";
import * as external from "./external";
import {
  lmsMaterialMaxBytes,
  uploadMaterial,
  authorizedMaterial,
  openPrivateStream,
} from "./materials";
import { privateUpload } from "./uploads";

class LmsStaffUploadGuard implements CanActivate {
  async canActivate(context: ExecutionContext) {
    const req = context.switchToHttp().getRequest<DemoRequest>();
    const c = lmsContext(req);
    assertLmsStaff(c);
    const id = String(req.params.id);
    if (req.path.endsWith("/materials")) {
      if (
        !(await db.course.findFirst({
          where: { id, tenantId: c.tenantId },
          select: { id: true },
        }))
      )
        fail(404, "NOT_FOUND", "Курс не найден");
    } else await scopedEnrollment(c, id);
    return true;
  }
}
const upload = privateUpload(lmsMaterialMaxBytes);
const evidenceUpload = privateUpload(20 * 1024 * 1024);
async function streamFile(
  res: Response,
  record: {
    storageKey: string;
    sha256: string;
    size?: number;
    mimeType: string;
    originalName: string;
  },
  range?: string,
) {
  const opened = await openPrivateStream(record, range);
  res.setHeader("Accept-Ranges", "bytes");
  res.setHeader("Cache-Control", "private, no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Content-Security-Policy", "sandbox");
  if (opened.invalid) {
    res.setHeader("Content-Range", `bytes */${opened.size}`);
    res.status(416).end();
    return;
  }
  res.setHeader("Content-Type", record.mimeType);
  res.setHeader(
    "Content-Disposition",
    `inline; filename*=UTF-8''${encodeURIComponent(record.originalName)}`,
  );
  res.setHeader("Content-Length", opened.end - opened.start + 1);
  if (opened.partial) {
    res.status(206);
    res.setHeader(
      "Content-Range",
      `bytes ${opened.start}-${opened.end}/${opened.size}`,
    );
  }
  opened.stream.on("error", () => res.destroy());
  res.on("close", () => opened.stream.destroy());
  opened.stream.pipe(res);
}

export const lmsRoutes = [
  ["GET", "/lms/courses"],
  ["POST", "/lms/courses"],
  ["GET", "/lms/courses/:id"],
  ["POST", "/lms/courses/:id/versions"],
  ["PUT", "/lms/course-versions/:id"],
  ["POST", "/lms/course-versions/:id/publish"],
  ["POST", "/lms/courses/:id/materials"],
  ["GET", "/lms/materials/:id"],
  ["GET", "/lms/assignment-context"],
  ["GET", "/lms/enrollments"],
  ["POST", "/lms/enrollments"],
  ["POST", "/lms/enrollments/:id/extend"],
  ["GET", "/lms/enrollments/:id"],
  ["GET", "/learn/enrollments"],
  ["GET", "/learn/enrollments/:id"],
  ["POST", "/learn/enrollments/:id/lessons/:lessonId/progress"],
  ["POST", "/learn/enrollments/:id/attempts"],
  ["GET", "/learn/attempts/:id"],
  ["PUT", "/learn/attempts/:id/answers"],
  ["POST", "/learn/attempts/:id/submit"],
  ["GET", "/lms/enrollments/:id/external-evidence"],
  ["POST", "/lms/enrollments/:id/external-evidence"],
  ["POST", "/lms/external-evidence/:id/review"],
  ["GET", "/lms/external-evidence/:id/file"],
] as const;

@Controller()
export class LmsController {
  @Get("lms/courses") list(@Req() req: DemoRequest, @Query() query: unknown) {
    return courses.listCourses(lmsContext(req), query);
  }
  @Post("lms/courses") create(@Req() req: DemoRequest, @Body() body: unknown) {
    return courses.createCourse(lmsContext(req), body);
  }
  @Get("lms/courses/:id") course(
    @Req() req: DemoRequest,
    @Param("id") id: string,
  ) {
    return courses.getCourse(lmsContext(req), id);
  }
  @Post("lms/courses/:id/versions") clone(
    @Req() req: DemoRequest,
    @Param("id") id: string,
  ) {
    return courses.cloneVersion(lmsContext(req), id);
  }
  @Put("lms/course-versions/:id") save(
    @Req() req: DemoRequest,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    return courses.updateVersion(lmsContext(req), id, body);
  }
  @Post("lms/course-versions/:id/publish") publish(
    @Req() req: DemoRequest,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    return courses.publishVersion(lmsContext(req), id, body);
  }
  @Post("lms/courses/:id/materials")
  @UseGuards(LmsStaffUploadGuard)
  @UseInterceptors(upload)
  async upload(
    @Req() req: DemoRequest,
    @Param("id") id: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    try {
      return await uploadMaterial(lmsContext(req), id, file);
    } finally {
      if (file?.path) await unlink(file.path).catch(() => {});
    }
  }
  @Get("lms/materials/:id") async material(
    @Req() req: DemoRequest,
    @Param("id") id: string,
    @Res() res: Response,
  ) {
    return streamFile(
      res,
      await authorizedMaterial(lmsContext(req), id),
      req.headers.range,
    );
  }
  @Get("lms/assignment-context") assignmentContext(
    @Req() req: DemoRequest,
    @Query() query: unknown,
  ) {
    return enrollments.assignmentContext(lmsContext(req), query);
  }
  @Get("lms/enrollments") enrollments(
    @Req() req: DemoRequest,
    @Query() query: unknown,
  ) {
    return enrollments.listEnrollments(lmsContext(req), query);
  }
  @Post("lms/enrollments") assign(
    @Req() req: DemoRequest,
    @Body() body: unknown,
  ) {
    return enrollments.assignEnrollments(lmsContext(req), body);
  }
  @Post("lms/enrollments/:id/extend") extend(
    @Req() req: DemoRequest,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    return enrollments.extendEnrollment(lmsContext(req), id, body);
  }
  @Get("lms/enrollments/:id") enrollment(
    @Req() req: DemoRequest,
    @Param("id") id: string,
  ) {
    return learning.enrollmentDetail(lmsContext(req), id);
  }
  @Get("learn/enrollments") myEnrollments(
    @Req() req: DemoRequest,
    @Query() query: unknown,
  ) {
    return enrollments.listEnrollments(lmsContext(req), query);
  }
  @Get("learn/enrollments/:id") myEnrollment(
    @Req() req: DemoRequest,
    @Param("id") id: string,
  ) {
    return learning.enrollmentDetail(lmsContext(req), id);
  }
  @Post("learn/enrollments/:id/lessons/:lessonId/progress") progress(
    @Req() req: DemoRequest,
    @Param("id") id: string,
    @Param("lessonId") lessonId: string,
    @Body() body: unknown,
  ) {
    return learning.saveLessonProgress(lmsContext(req), id, lessonId, body);
  }
  @Post("learn/enrollments/:id/attempts") start(
    @Req() req: DemoRequest,
    @Param("id") id: string,
  ) {
    return exams.startAttempt(lmsContext(req), id);
  }
  @Get("learn/attempts/:id") attempt(
    @Req() req: DemoRequest,
    @Param("id") id: string,
  ) {
    return exams.getAttempt(lmsContext(req), id);
  }
  @Put("learn/attempts/:id/answers") answers(
    @Req() req: DemoRequest,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    return exams.saveAnswers(lmsContext(req), id, body);
  }
  @Post("learn/attempts/:id/submit") submit(
    @Req() req: DemoRequest,
    @Param("id") id: string,
  ) {
    return exams.submitAttempt(lmsContext(req), id);
  }
  @Get("lms/enrollments/:id/external-evidence") external(
    @Req() req: DemoRequest,
    @Param("id") id: string,
  ) {
    return external.listExternalEvidence(lmsContext(req), id);
  }
  @Post("lms/enrollments/:id/external-evidence")
  @UseGuards(LmsStaffUploadGuard)
  @UseInterceptors(evidenceUpload)
  async addExternal(
    @Req() req: DemoRequest,
    @Param("id") id: string,
    @Body() body: unknown,
    @UploadedFile() file: Express.Multer.File,
  ) {
    try {
      return await external.addExternalEvidence(
        lmsContext(req),
        id,
        body,
        file,
      );
    } finally {
      if (file?.path) await unlink(file.path).catch(() => {});
    }
  }
  @Post("lms/external-evidence/:id/review") reviewExternal(
    @Req() req: DemoRequest,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    return external.reviewExternalEvidence(lmsContext(req), id, body);
  }
  @Get("lms/external-evidence/:id/file") async externalFile(
    @Req() req: DemoRequest,
    @Param("id") id: string,
    @Res() res: Response,
  ) {
    return streamFile(
      res,
      await external.authorizedExternalEvidence(lmsContext(req), id),
      req.headers.range,
    );
  }
  @Post("lms/external-evidence/:id/date") clarifyExternalDate(
    @Req() req: DemoRequest,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    return external.clarifyExternalExamDate(lmsContext(req), id, body);
  }
}
