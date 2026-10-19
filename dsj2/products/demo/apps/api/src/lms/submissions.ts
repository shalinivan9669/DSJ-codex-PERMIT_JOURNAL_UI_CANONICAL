import { z } from "@demo/contracts";
import { unlink } from "node:fs/promises";
import { courseContentSchema } from "@demo/contracts/src/lms";
import type { Prisma, LmsSubmission } from "@demo/database";
import {
  db,
  parse,
  fail,
  hash,
  json,
  transaction,
  audit,
  type Context,
} from "../core";
import { scopedEnrollment, learnerEnrollment } from "./scope";
import { assertLearningPermission } from "./learning-permissions";
import { evaluateLearningEligibility } from "./learning-eligibility";
import { savePrivateUpload, lmsStore } from "./materials";
import { enqueueReviewNotification } from "./notification-events";

const draftSchema = z
  .object({
    sequence: z.number().int().min(1),
    text: z.string().max(100000),
    attachmentIds: z.array(z.string().uuid()).max(10),
  })
  .strict();
const submitSchema = z.object({ sequence: z.number().int().min(0) }).strict();
type Draft = { text: string; attachmentIds: string[] };
export const attachmentView = (file: { id: string; originalName: string }) => ({
  id: file.id,
  name: file.originalName,
  downloadUrl: `/api/lms/submission-attachments/${file.id}/download`,
});

export async function assignmentContext(
  c: Context,
  enrollmentId: string,
  lessonId: string,
  tx: Prisma.TransactionClient = db,
  mutation = false,
) {
  const enrollment = mutation
    ? await learnerEnrollment(c, enrollmentId, tx)
    : await scopedEnrollment(c, enrollmentId, tx);
  const version = await tx.courseVersion.findFirstOrThrow({
    where: { tenantId: c.tenantId, id: enrollment.courseVersionId },
  });
  const isOwner = !!(await tx.learnerProfile.findFirst({
    where: {
      tenantId: c.tenantId,
      userId: c.userId,
      recipientId: enrollment.recipientId,
    },
    select: { id: true },
  }));
  if (!isOwner)
    await assertLearningPermission(
      c,
      version.courseId,
      enrollment.groupId,
      "REVIEW",
      tx,
    );
  const content = courseContentSchema.parse(version.content);
  const lesson = content.modules
    .flatMap((module) => module.lessons)
    .find((item) => item.id === lessonId);
  if (lesson?.kind !== "ASSIGNMENT" || !lesson.assignment)
    fail(404, "NOT_FOUND", "Задание не найдено");
  const eligibility = await evaluateLearningEligibility(
    tx,
    c,
    enrollment,
    content,
  );
  const available = !!eligibility.lessons.find((item) => item.id === lessonId)
    ?.available;
  const open =
    enrollment.status !== "CANCELLED" &&
    (!enrollment.startsAt || enrollment.startsAt <= new Date()) &&
    (!enrollment.dueAt || enrollment.dueAt > new Date()) &&
    (!lesson.assignment.dueAt ||
      new Date(lesson.assignment.dueAt) > new Date());
  if (mutation && (!available || !open))
    fail(
      409,
      !open ? "ASSIGNMENT_EXPIRED" : "LESSON_UNAVAILABLE",
      !open ? "Срок задания завершён" : "Сначала выполните условия доступа",
    );
  return {
    enrollment,
    version,
    content,
    lesson,
    policy: lesson.assignment,
    isOwner,
    canWrite: isOwner && available && open,
  };
}

async function filesFor(
  c: Context,
  enrollmentId: string,
  elementId: string,
  ids: string[],
  tx: Prisma.TransactionClient,
  uploader?: string,
) {
  if (new Set(ids).size !== ids.length)
    fail(400, "ATTACHMENTS_INVALID", "Файлы повторяются");
  const files = await tx.lmsSubmissionAttachment.findMany({
    where: {
      tenantId: c.tenantId,
      enrollmentId,
      elementId,
      id: { in: ids },
      ...(uploader ? { uploadedBy: uploader } : {}),
    },
  });
  if (files.length !== ids.length)
    fail(400, "ATTACHMENTS_INVALID", "Файл недоступен для этого задания");
  return ids.map((id) => files.find((file) => file.id === id)!);
}

export async function submissionView(
  c: Context,
  enrollmentId: string,
  lessonId: string,
  tx: Prisma.TransactionClient = db,
  row?: LmsSubmission | null,
) {
  const ctx = await assignmentContext(c, enrollmentId, lessonId, tx);
  const submission =
    row === undefined
      ? await tx.lmsSubmission.findFirst({
          where: { tenantId: c.tenantId, enrollmentId, elementId: lessonId },
        })
      : row;
  const revisions = submission
    ? await tx.lmsSubmissionRevision.findMany({
        where: { tenantId: c.tenantId, submissionId: submission.id },
        orderBy: { revision: "desc" },
      })
    : [];
  const decisions = submission
    ? await tx.lmsReviewDecision.findMany({
        where: {
          tenantId: c.tenantId,
          targetType: "SUBMISSION",
          targetId: submission.id,
        },
        orderBy: { revision: "desc" },
      })
    : [];
  const users = await tx.user.findMany({
    where: {
      tenantId: c.tenantId,
      id: { in: decisions.map((decision) => decision.actorId) },
    },
    select: { id: true, displayName: true },
  });
  const draft = (submission?.draft || { text: "", attachmentIds: [] }) as Draft;
  const editable =
    !submission || ["DRAFT", "RETURNED"].includes(submission.state);
  const remaining =
    !submission || submission.currentRevision < ctx.policy.maxSubmissions;
  // Reviewers see submitted versions through the review endpoint, never a learner's unfinished draft.
  const shown = ctx.isOwner
    ? draft
    : ((revisions[0]?.content || { text: "", attachmentIds: [] }) as Draft);
  const history = await Promise.all(
    revisions.map(async (revision) => {
      const content = revision.content as Draft;
      const decision = decisions.find(
        (item) => item.revision === revision.revision,
      );
      return {
        revision: revision.revision,
        text: content.text,
        attachments: (
          await filesFor(c, enrollmentId, lessonId, content.attachmentIds, tx)
        ).map(attachmentView),
        submittedAt: revision.submittedAt,
        decision: decision?.decision || null,
        feedback: decision?.feedback || null,
        reviewedAt: decision?.createdAt || null,
        reviewerName:
          users.find((user) => user.id === decision?.actorId)?.displayName ||
          null,
      };
    }),
  );
  return {
    id: submission?.id || null,
    enrollmentId,
    lessonId,
    revision: submission
      ? submission.currentRevision + (submission.state === "DRAFT" ? 1 : 0)
      : 1,
    sequence: submission?.sequence || 0,
    status: submission?.state || "DRAFT",
    text: shown.text,
    attachments: (
      await filesFor(c, enrollmentId, lessonId, shown.attachmentIds || [], tx)
    ).map(attachmentView),
    feedback: decisions[0]?.feedback || null,
    history,
    canRevise:
      !!submission &&
      submission.state === "RETURNED" &&
      ctx.canWrite &&
      remaining,
    canEdit: ctx.canWrite && editable && remaining,
    canSubmit:
      ctx.canWrite &&
      editable &&
      remaining &&
      (!!draft.text.trim() || draft.attachmentIds.length > 0),
    ...ctx.policy,
  };
}

export async function saveSubmission(
  c: Context,
  enrollmentId: string,
  lessonId: string,
  input: unknown,
) {
  const data = parse(draftSchema, input);
  return transaction(async (tx) => {
    await tx.$executeRaw`SELECT id FROM "Enrollment" WHERE id=${enrollmentId} AND "tenantId"=${c.tenantId} FOR UPDATE`;
    const ctx = await assignmentContext(c, enrollmentId, lessonId, tx, true);
    const prior = await tx.lmsSubmission.findFirst({
      where: { tenantId: c.tenantId, enrollmentId, elementId: lessonId },
    });
    if (
      prior &&
      (!["DRAFT", "RETURNED"].includes(prior.state) ||
        prior.currentRevision >= ctx.policy.maxSubmissions)
    )
      fail(
        409,
        "SUBMISSION_LOCKED",
        "Отправленная работа недоступна для изменений",
      );
    const draft = { text: data.text, attachmentIds: data.attachmentIds };
    if (prior && data.sequence <= prior.sequence) {
      if (data.sequence === prior.sequence && hash(draft) !== hash(prior.draft))
        fail(409, "SUBMISSION_CONFLICT", "Работа изменена в другой вкладке");
      return submissionView(c, enrollmentId, lessonId, tx, prior);
    }
    if (
      (!ctx.policy.allowText && data.text) ||
      (!ctx.policy.allowFiles && data.attachmentIds.length)
    )
      fail(400, "SUBMISSION_FORMAT", "Формат ответа не разрешён для задания");
    await filesFor(c, enrollmentId, lessonId, data.attachmentIds, tx, c.userId);
    const row = prior
      ? await tx.lmsSubmission.update({
          where: { id: prior.id },
          data: { draft: json(draft), sequence: data.sequence, state: "DRAFT" },
        })
      : await tx.lmsSubmission.create({
          data: {
            tenantId: c.tenantId,
            enrollmentId,
            elementId: lessonId,
            draft: json(draft),
            sequence: data.sequence,
          },
        });
    return submissionView(c, enrollmentId, lessonId, tx, row);
  });
}

export async function submitSubmission(
  c: Context,
  enrollmentId: string,
  lessonId: string,
  input: unknown,
) {
  const data = parse(submitSchema, input);
  return transaction(async (tx) => {
    await tx.$executeRaw`SELECT id FROM "Enrollment" WHERE id=${enrollmentId} AND "tenantId"=${c.tenantId} FOR UPDATE`;
    const ctx = await assignmentContext(c, enrollmentId, lessonId, tx, true);
    const row = await tx.lmsSubmission.findFirst({
      where: { tenantId: c.tenantId, enrollmentId, elementId: lessonId },
    });
    if (!row) fail(409, "SUBMISSION_EMPTY", "Добавьте ответ на задание");
    if (data.sequence !== row.sequence)
      fail(
        409,
        "SUBMISSION_CONFLICT",
        "Дождитесь сохранения актуальной версии",
      );
    if (row.state === "SUBMITTED")
      return submissionView(c, enrollmentId, lessonId, tx, row);
    if (
      row.state !== "DRAFT" ||
      row.currentRevision >= ctx.policy.maxSubmissions
    )
      fail(409, "SUBMISSION_LOCKED", "Работа недоступна для отправки");
    const draft = row.draft as Draft;
    if (!draft.text.trim() && !draft.attachmentIds.length)
      fail(409, "SUBMISSION_EMPTY", "Добавьте ответ на задание");
    const files = await filesFor(
      c,
      enrollmentId,
      lessonId,
      draft.attachmentIds,
      tx,
      c.userId,
    );
    const snapshot = {
      courseVersionId: ctx.version.id,
      lesson: ctx.lesson,
      attachments: files.map((file) => ({
        id: file.id,
        sha256: file.sha256,
        size: file.size,
        mimeType: file.mimeType,
        originalName: file.originalName,
      })),
    };
    const revision = await tx.lmsSubmissionRevision.create({
      data: {
        tenantId: c.tenantId,
        submissionId: row.id,
        revision: row.currentRevision + 1,
        content: json(draft),
        snapshot: json(snapshot),
        hash: hash({ content: draft, snapshot }),
      },
    });
    const saved = await tx.lmsSubmission.update({
      where: { id: row.id },
      data: { currentRevision: revision.revision, state: "SUBMITTED" },
    });
    await audit(tx, c, "LMS_SUBMISSION_SUBMITTED", row.id, {
      revision: revision.revision,
      hash: revision.hash,
    });
    await enqueueReviewNotification(tx, ctx.enrollment, { type: "SUBMISSION", id: row.id, revision: revision.revision });
    return submissionView(c, enrollmentId, lessonId, tx, saved);
  });
}

export async function uploadSubmissionAttachment(
  c: Context,
  enrollmentId: string,
  lessonId: string,
  file: Express.Multer.File | undefined,
) {
  if (!file) fail(400, "MATERIAL_REQUIRED", "Выберите файл");
  await assignmentContext(c, enrollmentId, lessonId, db, true);
  const stored = await savePrivateUpload(file, true);
  try {
    return await transaction(async (tx) => {
      await tx.$executeRaw`SELECT id FROM "Enrollment" WHERE id=${enrollmentId} AND "tenantId"=${c.tenantId} FOR UPDATE`;
      const ctx = await assignmentContext(c, enrollmentId, lessonId, tx, true);
      if (!ctx.policy.allowFiles)
        fail(400, "SUBMISSION_FORMAT", "Вложения не предусмотрены для задания");
      const row = await tx.lmsSubmission.findFirst({
        where: { tenantId: c.tenantId, enrollmentId, elementId: lessonId },
      });
      if (
        row &&
        (!["DRAFT", "RETURNED"].includes(row.state) ||
          row.currentRevision >= ctx.policy.maxSubmissions)
      )
        fail(409, "SUBMISSION_LOCKED", "Работа недоступна для изменений");
      return attachmentView(
        await tx.lmsSubmissionAttachment.create({
          data: {
            tenantId: c.tenantId,
            enrollmentId,
            elementId: lessonId,
            uploadedBy: c.userId,
            ...stored,
          },
        }),
      );
    });
  } catch (error) {
    await unlink(lmsStore.path(stored.storageKey)).catch(() => {});
    throw error;
  }
}

export async function authorizedSubmissionAttachment(c: Context, id: string) {
  const file = await db.lmsSubmissionAttachment.findFirst({
    where: { tenantId: c.tenantId, id },
  });
  if (!file) fail(404, "NOT_FOUND", "Файл не найден");
  const ctx = await assignmentContext(c, file.enrollmentId, file.elementId);
  if (ctx.isOwner) {
    if (file.uploadedBy !== c.userId) fail(404, "NOT_FOUND", "Файл не найден");
  } else {
    const submitted = await db.$queryRaw<
      { id: string }[]
    >`SELECT r.id FROM "LmsSubmissionRevision" r JOIN "LmsSubmission" s ON s.id=r."submissionId" AND s."tenantId"=r."tenantId" WHERE r."tenantId"=${c.tenantId} AND s."enrollmentId"=${file.enrollmentId} AND s."elementId"=${file.elementId} AND r.content @> jsonb_build_object('attachmentIds',jsonb_build_array(${id})) LIMIT 1`;
    if (!submitted.length) fail(404, "NOT_FOUND", "Файл не найден");
  }
  return file;
}
