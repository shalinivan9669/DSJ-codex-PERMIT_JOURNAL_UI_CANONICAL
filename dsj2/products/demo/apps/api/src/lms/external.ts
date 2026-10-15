import { z, today } from "@demo/contracts";
import type { Prisma } from "@demo/database";
import { regulatoryProfileSchema } from "@demo/contracts/src/lms";
import { db, parse, transaction, audit, fail, type Context } from "../core";
import { assertLmsStaff, scopedEnrollment } from "./scope";
import { savePrivateUpload } from "./materials";
import { finalizeLmsResult } from "./result-finalization";

const externalSchema = z
  .object({
    issuer: z.string().trim().min(1).max(500),
    sourceSystem: z.string().trim().min(1).max(500),
    documentNumber: z.string().trim().min(1).max(200),
    documentDate: z.string().date(),
    examAt: z.string().datetime().optional(),
    examDate: z.string().date().optional(),
  })
  .strict()
  .refine(
    (value) => !(value.examAt && value.examDate),
    "Укажите дату или точное время экзамена",
  );

async function evidenceProfile(
  tx: Prisma.TransactionClient,
  tenantId: string,
  enrollmentId: string,
) {
  const enrollment = await tx.enrollment.findFirstOrThrow({
    where: { id: enrollmentId, tenantId },
  });
  const version = await tx.courseVersion.findFirstOrThrow({
    where: { id: enrollment.courseVersionId, tenantId },
  });
  const policy = await tx.regulatoryProfileVersion.findFirstOrThrow({
    where: { id: version.regulatoryProfileVersionId, tenantId },
  });
  return regulatoryProfileSchema.parse(policy.definition);
}

/** Noon is only a storage anchor for a confirmed calendar date, never an inferred exam time. */
export function externalDateAnchor(day: string, timezone: string) {
  const wall = new Date(`${day}T12:00:00Z`);
  let anchor = wall;
  try {
    const formatter = new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    });
    for (let i = 0; i < 3; i++) {
      const parts = formatter.formatToParts(anchor);
      const value = (name: string) =>
        parts.find((part) => part.type === name)!.value;
      const represented = new Date(
        `${value("year")}-${value("month")}-${value("day")}T${value("hour")}:${value("minute")}:${value("second")}Z`,
      );
      anchor = new Date(
        anchor.getTime() + wall.getTime() - represented.getTime(),
      );
    }
    if (today(timezone, anchor) !== day || day > today(timezone))
      throw new Error("INVALID_EXAM_DATE");
  } catch {
    fail(
      422,
      "EXAM_DATE_INVALID",
      "Проверьте дату экзамена и часовой пояс программы",
    );
  }
  return anchor;
}
export async function addExternalEvidence(
  c: Context,
  enrollmentId: string,
  input: unknown,
  file: Express.Multer.File | undefined,
) {
  assertLmsStaff(c);
  const { examDate, ...data } = parse(externalSchema, input);
  const enrollment = await scopedEnrollment(c, enrollmentId);
  const version = await db.courseVersion.findFirstOrThrow({
    where: { id: enrollment.courseVersionId, tenantId: c.tenantId },
  });
  const profile = await db.regulatoryProfileVersion.findFirstOrThrow({
    where: { id: version.regulatoryProfileVersionId, tenantId: c.tenantId },
  });
  const policy = regulatoryProfileSchema.parse(profile.definition);
  if (policy.assessmentKind !== "EXTERNAL_AUTHORIZED")
    fail(
      409,
      "EXTERNAL_ROUTE_REQUIRED",
      "Для курса выбран другой маршрут оценки",
    );
  const examAt = examDate
    ? externalDateAnchor(examDate, policy.timezone)
    : data.examAt
      ? new Date(data.examAt)
      : null;
  if (examAt && today(policy.timezone, examAt) > today(policy.timezone))
    fail(
      422,
      "EXAM_DATE_INVALID",
      "Проверьте дату экзамена и часовой пояс программы",
    );
  const { size: _size, ...stored } = await savePrivateUpload(file, true);
  const evidence = await transaction(async (tx) => {
    const saved = await tx.lmsExternalEvidence.create({
      data: {
        tenantId: c.tenantId,
        enrollmentId,
        ...data,
        examAt,
        ...stored,
        createdBy: c.userId,
      },
    });
    await audit(tx, c, "LMS_EXTERNAL_EVIDENCE_ADDED", saved.id, {
      enrollmentId,
      ...(examDate
        ? { examDate, datePrecision: "DATE", timezone: policy.timezone }
        : {}),
    });
    return saved;
  });
  return externalView(evidence, policy.timezone);
}

export function externalView(
  evidence: Awaited<ReturnType<typeof db.lmsExternalEvidence.findFirstOrThrow>>,
  timezone: string,
  supersededByEvidenceId: string | null = null,
) {
  const { storageKey: _storageKey, ...view } = evidence;
  return {
    ...view,
    examDate: evidence.examAt ? today(timezone, evidence.examAt) : null,
    supersededByEvidenceId,
  };
}
export async function listExternalEvidence(c: Context, enrollmentId: string) {
  await scopedEnrollment(c, enrollmentId);
  const profile = await evidenceProfile(db, c.tenantId, enrollmentId);
  const items = await db.lmsExternalEvidence.findMany({
    where: { tenantId: c.tenantId, enrollmentId },
    orderBy: { createdAt: "desc" },
  });
  const changes = await db.auditEvent.findMany({
    where: {
      tenantId: c.tenantId,
      action: "LMS_EXTERNAL_DATE_CLARIFIED",
      entityId: { in: items.map((item) => item.id) },
    },
    select: { entityId: true, metadata: true },
  });
  const replacements = new Map(
    changes.map((change) => [
      change.entityId,
      (change.metadata as { replacementEvidenceId: string })
        .replacementEvidenceId,
    ]),
  );
  return {
    items: items.map((evidence) =>
      externalView(
        evidence,
        profile.timezone,
        replacements.get(evidence.id) || null,
      ),
    ),
  };
}
export async function reviewExternalEvidence(
  c: Context,
  id: string,
  input: unknown,
) {
  if (!["ADMIN", "DIRECTOR"].includes(c.role))
    fail(403, "REVIEWER_REQUIRED", "Проверка доступна руководителю центра");
  const data = parse(
    z
      .object({
        status: z.enum(["DOCUMENT_REVIEWED", "REJECTED"]),
        reviewMethod: z.string().trim().min(3).max(2000),
        verdict: z.enum(["PASSED", "FAILED"]).default("PASSED"),
      })
      .strict(),
    input,
  );
  return transaction(async (tx) => {
    const candidate = await tx.lmsExternalEvidence.findFirst({
      where: { id, tenantId: c.tenantId },
    });
    if (!candidate) fail(404, "NOT_FOUND", "Основание не найдено");
    await tx.$executeRaw`SELECT id FROM "Enrollment" WHERE id=${candidate.enrollmentId} AND "tenantId"=${c.tenantId} FOR UPDATE`;
    const evidence = await tx.lmsExternalEvidence.findFirstOrThrow({
      where: { id, tenantId: c.tenantId },
    });
    const profile = await evidenceProfile(
      tx,
      c.tenantId,
      evidence.enrollmentId,
    );
    if (evidence.status !== "UNVERIFIED")
      return externalView(evidence, profile.timezone);
    const saved = await tx.lmsExternalEvidence.update({
      where: { id },
      data: {
        status: data.status,
        reviewMethod: data.reviewMethod,
        reviewedBy: c.userId,
        reviewedAt: new Date(),
      },
    });
    if (data.status === "DOCUMENT_REVIEWED") {
      if (profile.externalEvidenceLevel === "DOCUMENT_REVIEWED")
        await finalizeLmsResult(tx, c, {
          enrollmentId: evidence.enrollmentId,
          externalEvidenceId: id,
          assessmentKind: "EXTERNAL_AUTHORIZED",
          verdict: data.verdict,
          score: null,
          maximum: null,
          examAt: evidence.examAt,
        });
    }
    await audit(tx, c, "LMS_EXTERNAL_EVIDENCE_REVIEWED", id, {
      status: data.status,
    });
    return externalView(saved, profile.timezone);
  });
}

/** A director clarifies an absent date using the retained source, without re-entering its known fields. */
export async function clarifyExternalExamDate(
  c: Context,
  id: string,
  input: unknown,
) {
  if (!["ADMIN", "DIRECTOR"].includes(c.role))
    fail(403, "REVIEWER_REQUIRED", "Проверка доступна руководителю центра");
  const data = parse(
    z
      .object({
        examDate: z.string().date(),
        reviewMethod: z.string().trim().min(3).max(2000),
      })
      .strict(),
    input,
  );
  return transaction(async (tx) => {
    const candidate = await tx.lmsExternalEvidence.findFirst({
      where: { id, tenantId: c.tenantId },
    });
    if (!candidate) fail(404, "NOT_FOUND", "Основание не найдено");
    await tx.$executeRaw`SELECT id FROM "Enrollment" WHERE id=${candidate.enrollmentId} AND "tenantId"=${c.tenantId} FOR UPDATE`;
    const profile = await evidenceProfile(
      tx,
      c.tenantId,
      candidate.enrollmentId,
    );
    const previousChange = await tx.auditEvent.findFirst({
      where: {
        tenantId: c.tenantId,
        entityId: id,
        action: "LMS_EXTERNAL_DATE_CLARIFIED",
      },
    });
    if (previousChange) {
      const prior = previousChange.metadata as {
        examDate: string;
        reviewMethod: string;
        replacementEvidenceId: string;
      };
      if (
        prior.examDate !== data.examDate ||
        prior.reviewMethod !== data.reviewMethod
      )
        fail(
          409,
          "EXTERNAL_DATE_CONFLICT",
          "Дата уже уточнена другим решением",
        );
      return externalView(
        await tx.lmsExternalEvidence.findFirstOrThrow({
          where: { tenantId: c.tenantId, id: prior.replacementEvidenceId },
        }),
        profile.timezone,
      );
    }
    if (candidate.examAt)
      fail(409, "EXAM_DATE_ALREADY_KNOWN", "Дата уже указана в основании");
    if (
      candidate.status !== "DOCUMENT_REVIEWED" ||
      profile.externalEvidenceLevel !== "DOCUMENT_REVIEWED"
    )
      fail(
        409,
        "SOURCE_REVIEW_REQUIRED",
        "Сначала подтвердите документальное основание",
      );
    const old = await tx.verifiedExamResult.findFirst({
      where: { tenantId: c.tenantId, externalEvidenceId: id },
      orderBy: { revision: "desc" },
    });
    if (!old)
      fail(
        409,
        "SOURCE_REVIEW_REQUIRED",
        "Сначала подтвердите документальное основание",
      );
    await tx.$executeRaw`SELECT id FROM "VerifiedExamResult" WHERE id=${old.id} AND "tenantId"=${c.tenantId} FOR UPDATE`;
    if (
      await tx.lmsResultEvent.findFirst({
        where: {
          tenantId: c.tenantId,
          resultId: old.id,
          kind: { in: ["VOIDED", "SUPERSEDED"] },
        },
      })
    )
      fail(
        409,
        "RESULT_REVISION_CONFLICT",
        "Результат уже изменён другим решением",
      );
    const examAt = externalDateAnchor(data.examDate, profile.timezone);
    const { id: _id, createdAt: _createdAt, ...source } = candidate;
    const saved = await tx.lmsExternalEvidence.create({
      data: {
        ...source,
        examAt,
        createdBy: c.userId,
        reviewedBy: c.userId,
        reviewedAt: new Date(),
        reviewMethod: data.reviewMethod,
      },
    });
    await audit(tx, c, "LMS_EXTERNAL_EVIDENCE_ADDED", saved.id, {
      enrollmentId: candidate.enrollmentId,
      examDate: data.examDate,
      datePrecision: "DATE",
      timezone: profile.timezone,
      derivedFromEvidenceId: id,
    });
    const result = await finalizeLmsResult(tx, c, {
      enrollmentId: candidate.enrollmentId,
      externalEvidenceId: saved.id,
      assessmentKind: "EXTERNAL_AUTHORIZED",
      verdict: old.verdict as "PASSED" | "FAILED",
      score: null,
      maximum: null,
      examAt,
      supersedesResultId: old.id,
      correctionReason: data.reviewMethod,
    });
    await tx.lmsResultEvent.create({
      data: {
        tenantId: c.tenantId,
        resultId: old.id,
        kind: "SUPERSEDED",
        reason: data.reviewMethod,
        actorId: c.userId,
        correlationId: c.correlationId,
      },
    });
    await tx.integrationDelivery.updateMany({
      where: { tenantId: c.tenantId, resultId: old.id },
      data: {
        state: "SUPERSEDED",
        lockedUntil: null,
        leaseToken: { increment: 1 },
        lastError: "EXAM_DATE_CLARIFIED",
      },
    });
    await audit(tx, c, "LMS_EXTERNAL_DATE_CLARIFIED", id, {
      ...data,
      replacementEvidenceId: saved.id,
      replacementResultId: result.id,
      supersededResultId: old.id,
    });
    return externalView(saved, profile.timezone);
  });
}
export async function authorizedExternalEvidence(c: Context, id: string) {
  const evidence = await db.lmsExternalEvidence.findFirst({
    where: { id, tenantId: c.tenantId },
  });
  if (!evidence) fail(404, "NOT_FOUND", "Основание не найдено");
  await scopedEnrollment(c, evidence.enrollmentId);
  await audit(db, c, "LMS_EXTERNAL_EVIDENCE_OPENED", evidence.id);
  return evidence;
}
