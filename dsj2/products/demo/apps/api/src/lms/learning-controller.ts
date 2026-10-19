import { pipePrivateResponse } from "./private-stream-response";
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
  UseGuards,
  UseInterceptors,
  type CanActivate,
  type ExecutionContext,
} from "@nestjs/common";
import { unlink } from "node:fs/promises";
import type { Response } from "express";
import { type DemoRequest } from "../core";
import { lmsContext } from "./scope";
import { listAssessments, startAssessment } from "./assessments";
import {
  submissionView,
  saveSubmission,
  submitSubmission,
  uploadSubmissionAttachment,
  authorizedSubmissionAttachment,
  assignmentContext,
} from "./submissions";
import { listReviews, reviewDetail, decideReview } from "./manual-review";
import { openPrivateStream } from "./materials";
import { privateUpload } from "./uploads";

class SubmissionUploadGuard implements CanActivate {
  async canActivate(context: ExecutionContext) {
    const req = context.switchToHttp().getRequest<DemoRequest>();
    await assignmentContext(
      lmsContext(req),
      String(req.params.id),
      String(req.params.lessonId),
      undefined,
      true,
    );
    return true;
  }
}
const attachmentUpload = privateUpload(20 * 1024 * 1024);
export const learningRoutes = [
  ["GET", "/lms/enrollments/:id/assessments"],
  ["POST", "/lms/enrollments/:id/assessments/:lessonId/attempts"],
  ["GET", "/lms/enrollments/:id/assignments/:lessonId/submission"],
  ["PUT", "/lms/enrollments/:id/assignments/:lessonId/submission"],
  ["POST", "/lms/enrollments/:id/assignments/:lessonId/submission/submit"],
  ["POST", "/lms/enrollments/:id/assignments/:lessonId/attachments"],
  ["GET", "/lms/submission-attachments/:id/download"],
  ["GET", "/lms/reviews"],
  ["GET", "/lms/reviews/:type/:id"],
  ["POST", "/lms/reviews/:type/:id/decision"],
] as const;

@Controller()
export class LearningController {
  @Get("lms/enrollments/:id/assessments") assessments(
    @Req() req: DemoRequest,
    @Param("id") id: string,
  ) {
    return listAssessments(lmsContext(req), id);
  }
  @Post("lms/enrollments/:id/assessments/:lessonId/attempts") start(
    @Req() req: DemoRequest,
    @Param("id") id: string,
    @Param("lessonId") lessonId: string,
  ) {
    return startAssessment(lmsContext(req), id, lessonId);
  }
  @Get("lms/enrollments/:id/assignments/:lessonId/submission") submission(
    @Req() req: DemoRequest,
    @Param("id") id: string,
    @Param("lessonId") lessonId: string,
  ) {
    return submissionView(lmsContext(req), id, lessonId);
  }
  @Put("lms/enrollments/:id/assignments/:lessonId/submission") save(
    @Req() req: DemoRequest,
    @Param("id") id: string,
    @Param("lessonId") lessonId: string,
    @Body() body: unknown,
  ) {
    return saveSubmission(lmsContext(req), id, lessonId, body);
  }
  @Post("lms/enrollments/:id/assignments/:lessonId/submission/submit") submit(
    @Req() req: DemoRequest,
    @Param("id") id: string,
    @Param("lessonId") lessonId: string,
    @Body() body: unknown,
  ) {
    return submitSubmission(lmsContext(req), id, lessonId, body);
  }
  @Post("lms/enrollments/:id/assignments/:lessonId/attachments")
  @UseGuards(SubmissionUploadGuard)
  @UseInterceptors(attachmentUpload)
  async upload(
    @Req() req: DemoRequest,
    @Param("id") id: string,
    @Param("lessonId") lessonId: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    try {
      return await uploadSubmissionAttachment(
        lmsContext(req),
        id,
        lessonId,
        file,
      );
    } finally {
      if (file?.path) await unlink(file.path).catch(() => {});
    }
  }
  @Get("lms/submission-attachments/:id/download")
  async download(
    @Req() req: DemoRequest,
    @Param("id") id: string,
    @Res() res: Response,
  ) {
    const file = await authorizedSubmissionAttachment(lmsContext(req), id);
    const opened = await openPrivateStream(file, req.headers.range);
    if (opened.invalid) {
      res.setHeader("Content-Range", `bytes */${opened.size}`);
      res.status(416).end();
      return;
    }
    pipePrivateResponse(res, opened.stream, () => {
      res.setHeader("Accept-Ranges", "bytes");
      res.setHeader("Cache-Control", "private, no-store");
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.setHeader("Content-Security-Policy", "sandbox");

      res.setHeader("Content-Type", file.mimeType);
      res.setHeader(
        "Content-Disposition",
        `attachment; filename*=UTF-8''${encodeURIComponent(file.originalName)}`,
      );
      res.setHeader("Content-Length", opened.end - opened.start + 1);
      if (opened.partial) {
        res.status(206);
        res.setHeader(
          "Content-Range",
          `bytes ${opened.start}-${opened.end}/${opened.size}`,
        );
      }
    });
  }
  @Get("lms/reviews") reviews(
    @Req() req: DemoRequest,
    @Query() query: Record<string, string>,
  ) {
    return listReviews(lmsContext(req), query);
  }
  @Get("lms/reviews/:type/:id") review(
    @Req() req: DemoRequest,
    @Param("type") type: string,
    @Param("id") id: string,
  ) {
    return reviewDetail(lmsContext(req), type, id);
  }
  @Post("lms/reviews/:type/:id/decision") decide(
    @Req() req: DemoRequest,
    @Param("type") type: string,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    return decideReview(lmsContext(req), type, id, body);
  }
}
