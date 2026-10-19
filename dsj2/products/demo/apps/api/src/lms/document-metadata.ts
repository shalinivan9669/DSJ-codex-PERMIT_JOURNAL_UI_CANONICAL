import type { Prisma, VerifiedExamResult } from "@demo/database";
import {
  regulatoryProfileSchema,
  itemSchema,
  resolveRecipientText,
  today,
  type Assignment,
  type Draft,
  type LmsQuestion,
  type LearningAnswers,
} from "@demo/contracts";
import { fail, hash, json, type Context } from "../core";
import { gradeLearningAnswers } from "./assessment-grading";
import { protocolQuestion } from "./document-protocol";
import { assertEligibleResult } from "./result-finalization";
import { assertLmsDeploymentAllowed } from "./deployment-gate";

export const lmsTemplateTypes = {
  "lms-protocol": "PROTOCOL",
  "lms-certificate": "CERTIFICATE",
  "lms-credential": "CREDENTIAL",
} as const;

/** Old results are immutable too. New documents for a historical result may
 * recover their appendix only from its finished, immutable attempt snapshot. */
export async function resultWithDocumentProtocol(
  tx: Prisma.TransactionClient,
  result: VerifiedExamResult,
): Promise<VerifiedExamResult> {
  const snapshot = result.snapshot as Record<string, unknown>;
  if (snapshot.protocol || result.assessmentKind !== "CENTER_EXAM")
    return result;
  const attempt = await tx.examAttempt.findFirst({
    where: {
      tenantId: result.tenantId,
      id: result.attemptId || "missing",
      state: "FINISHED",
      enrollmentId: result.enrollmentId,
    },
  });
  if (!attempt?.finishedAt)
    fail(
      409,
      "ATTEMPT_NOT_FINAL",
      "Для протокола нужна сохранённая завершённая попытка",
    );
  const frozen = attempt.snapshot as unknown as {
    questions: LmsQuestion[];
    policy: { thresholdPercent: number; comparison: "GT" | "GTE" };
  };
  const review = await tx.lmsReviewDecision.findFirst({
    where: {
      tenantId: result.tenantId,
      attemptId: attempt.id,
      decision: "GRADE",
    },
  });
  const grades = gradeLearningAnswers(
    frozen.questions,
    attempt.answers as LearningAnswers,
    frozen.policy,
    (review?.questionScores || {}) as Record<string, 0 | 1>,
  );
  if (
    grades.score !== result.score ||
    grades.maxScore !== result.maximum ||
    grades.verdict !== result.verdict
  )
    fail(
      409,
      "RESULT_SCORE_MISMATCH",
      "Оценка не соответствует сохранённым ответам",
    );
  const history = await tx.examAttempt.findMany({
    where: {
      tenantId: result.tenantId,
      enrollmentId: result.enrollmentId,
      purpose: "FINAL",
      assessmentId: "FINAL",
      ordinal: { lte: attempt.ordinal },
    },
    orderBy: { ordinal: "asc" },
    select: {
      ordinal: true,
      state: true,
      score: true,
      maximum: true,
      verdict: true,
      finishedAt: true,
    },
  });
  const profile = regulatoryProfileSchema.parse(snapshot.profile);
  return {
    ...result,
    snapshot: json({
      ...snapshot,
      protocol: {
        version: 1,
        attemptId: attempt.id,
        ordinal: attempt.ordinal,
        finishedAt: attempt.finishedAt.toISOString(),
        thresholdPercent: frozen.policy.thresholdPercent,
        comparison: frozen.policy.comparison,
        percent: grades.percent,
        questions: frozen.questions.map((q) =>
          protocolQuestion(
            q,
            (attempt.answers as LearningAnswers)[q.id],
            grades.questionScores[q.id] ?? null,
          ),
        ),
        history: history.map((item) => ({
          ...item,
          finishedAt: item.finishedAt?.toISOString() || null,
        })),
        commission: profile.commission,
      },
    }) as Prisma.JsonObject,
  };
}
/** Resolve display spellings only from the immutable result, using DEMO's
 * existing same-text RU/KZ fallback. Never read the current person directory. */
export function documentRecipient(result: VerifiedExamResult) {
  const snapshot = result.snapshot as Record<string, unknown>;
  const learner = snapshot.learner as Record<string, string>;
  const employer = snapshot.employer as {
    id?: string;
    nameRu?: string;
    nameKz?: string;
  } | null;
  return resolveRecipientText(
    itemSchema.parse({
      id: result.recipientId,
      recipientId: result.recipientId,
      fullNameRu: learner.fullNameRu,
      fullNameKz: learner.fullNameKz,
      positionRu: learner.positionRu,
      positionKz: learner.positionKz,
      ...(employer?.id ? { employerId: employer.id } : {}),
      workplaceRu: employer?.nameRu || "",
      workplaceKz: employer?.nameKz || "",
    }),
  );
}
export function documentMetadata(
  result: VerifiedExamResult,
  verificationUrl?: string | null,
): NonNullable<Assignment["lms"]> {
  if (!result.examAt)
    fail(
      409,
      "EXAM_DATE_REQUIRED",
      "Укажите подтверждённую дату экзамена в отдельной редакции основания",
    );
  const snapshot = result.snapshot as Record<string, unknown>;
  const profile = regulatoryProfileSchema.parse(snapshot.profile);
  const source = snapshot.source as Record<string, unknown>;
  const course = snapshot.course as {
    titleRu: string;
    titleKz: string;
    hours: number;
  };
  const originalReference =
    result.assessmentKind === "EXTERNAL_AUTHORIZED" && source.documentNumber
      ? `${String(source.issuer)} · ${String(source.documentNumber)} · ${String(source.documentDate)}`
      : null;
  if (profile.legalForm === "COPY_OF_ORIGINAL" && !originalReference)
    fail(409, "ORIGINAL_REQUIRED", "Копия требует проверенного оригинала");
  return {
    ...(verificationUrl ? { verification: { url: verificationUrl } } : {}),
    ...(snapshot.protocol
      ? {
          protocol: snapshot.protocol as NonNullable<
            Assignment["lms"]
          >["protocol"],
        }
      : {}),
    resultId: result.id,
    resultRevision: result.revision,
    profileVersionId: result.regulatoryProfileVersionId,
    assessmentKind: result.assessmentKind as
      | "CENTER_EXAM"
      | "EXTERNAL_AUTHORIZED",
    legalForm: profile.legalForm,
    eligible: true,
    course: {
      titleRu: course.titleRu,
      titleKz: course.titleKz,
      hours: course.hours,
    },
    issuer: profile.issuer,
    examiner: profile.examiner,
    examAt: result.examAt?.toISOString() || null,
    examDate: result.examAt ? today(profile.timezone, result.examAt) : null,
    verdict: "PASSED",
    score: result.score,
    maximum: result.maximum,
    source: verificationUrl
      ? { ...source, regulatorySources: profile.sources }
      : source,
    requiredSignatures: profile.requiredSignatures,
    signatureState: "PREPARED",
    synthetic: profile.synthetic,
    originalReference,
  };
}
/** Protect every legacy preview/approval/finalize entry point against fabricated LMS provenance. */
export async function validateLmsReferences(
  tx: Prisma.TransactionClient,
  c: Context,
  draft: Draft,
  requestId?: string,
) {
  if (
    draft.items.some((item) =>
      item.assignments.some(
        (assignment) =>
          assignment.lms || assignment.templateId in lmsTemplateTypes,
      ),
    )
  ) {
    await assertLmsDeploymentAllowed(
      await tx.tenant.findUniqueOrThrow({ where: { id: c.tenantId } }),
    );
  }
  for (const item of draft.items)
    for (const assignment of item.assignments) {
      const type =
        lmsTemplateTypes[
          assignment.templateId as keyof typeof lmsTemplateTypes
        ];
      if (!type) {
        if (assignment.lms)
          fail(
            422,
            "LMS_TEMPLATE_REQUIRED",
            "Результат обучения требует соответствующую форму",
          );
        continue;
      }
      if (!assignment.lms)
        fail(422, "LMS_RESULT_REQUIRED", "Требуется подтверждённый результат");
      const result = await assertEligibleResult(tx, c, assignment.lms.resultId);
      const boundLink = await tx.lmsDocumentLink.findFirst({
        where: {
          tenantId: c.tenantId,
          ...(requestId ? { requestId } : {}),
          resultId: result.id,
          documentType: type,
        },
      });
      if (requestId && !boundLink) {
        fail(
          409,
          "LMS_REQUEST_BINDING_REQUIRED",
          "Подготовьте документ из сохранённого результата обучения; повторный выпуск оформляется отдельной редакцией",
        );
      }
      const documentResult = boundLink?.verificationUrl
        ? await resultWithDocumentProtocol(tx, result)
        : result;
      const snapshot = result.snapshot as Record<string, unknown>;
      const profile = regulatoryProfileSchema.parse(snapshot.profile);
      const recipient = documentRecipient(result);
      if (
        !profile.documentTypes.includes(type) ||
        (profile.templateIds[type] &&
          profile.templateIds[type] !== assignment.templateId) ||
        result.recipientId !== item.recipientId ||
        assignment.id !== `${result.id}-${type}` ||
        hash(assignment.lms) !==
          hash(documentMetadata(documentResult, boundLink?.verificationUrl)) ||
        item.fullNameRu !== recipient.fullNameRu ||
        item.fullNameKz !== recipient.fullNameKz ||
        item.positionRu !== recipient.positionRu ||
        item.positionKz !== recipient.positionKz ||
        (item.employerId || null) !== (recipient.employerId || null) ||
        (item.workplaceRu || "") !== recipient.workplaceRu ||
        (item.workplaceKz || "") !== recipient.workplaceKz ||
        assignment.outcome?.status !== "PASSED" ||
        assignment.result !== "Сдал" ||
        assignment.trainingSubject !== assignment.lms.course.titleRu ||
        assignment.trainingSubjectKz !== assignment.lms.course.titleKz ||
        assignment.hours !== String(assignment.lms.course.hours)
      )
        fail(
          409,
          "LMS_SNAPSHOT_MISMATCH",
          "Документ должен использовать сохранённый результат. Исправление оформляется отдельной редакцией",
        );
    }
}
