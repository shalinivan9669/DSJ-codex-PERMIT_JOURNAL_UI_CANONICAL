import type { Prisma, VerifiedExamResult } from "@demo/database";
import {
  courseContentSchema,
  regulatoryProfileSchema,
  today,
  type AssessmentKind,
  type RegulatoryProfile,
  type LmsQuestion,
  type LearningAnswers,
} from "@demo/contracts";
import { audit, fail, hash, json, type Context } from "../core";
import { gradeLearningAnswers } from "./assessment-grading";
import { evaluateLearningEligibility } from "./learning-eligibility";
import { evaluatePracticeRequirement } from "./practice-requirement";
import { protocolQuestion, type FrozenProtocol } from "./document-protocol";
import { proctorApproval } from "./proctoring";

export function routeEligible(
  profile: RegulatoryProfile,
  kind: string,
  verdict: string,
  at: Date | null,
  syntheticAllowed: boolean,
  practiceSatisfied = false,
  proctoringSatisfied = false,
): boolean {
  let day: string | undefined;
  try {
    new Intl.DateTimeFormat("en", { timeZone: profile.timezone });
    day = at ? today(profile.timezone, at) : undefined;
  } catch {
    return false;
  }
  return (
    verdict === "PASSED" &&
    kind !== "PRACTICE" &&
    profile.assessmentKind === kind &&
    profile.status === "CONFIRMED" &&
    !!profile.issuer &&
    !!profile.examiner &&
    !!profile.reviewReference &&
    profile.sources.length > 0 &&
    (!profile.synthetic || syntheticAllowed) &&
    // A reviewed external source may lack the exam date. Preserve that absence
    // for immediate INTERNAL preparation; documents and delivery remain gated.
    !!profile.effectiveFrom &&
    (day
      ? day >= profile.effectiveFrom &&
        (!profile.effectiveUntil || day <= profile.effectiveUntil)
      : kind === "EXTERNAL_AUTHORIZED") &&
    (!profile.requiresProctoring || (profile.proctoringMode === "LOCAL_SUPERVISED" && proctoringSatisfied)) &&
    (!profile.requiresPractice || practiceSatisfied) &&
    !(profile.competency === "GENERAL" && kind === "CENTER_EXAM") &&
    (profile.commissionKind === "NONE" || profile.commission.length > 0)
  );
}

/** Only called inside the attempt/evidence transaction. Result and outbox cannot diverge. */
export async function finalizeLmsResult(
  tx: Prisma.TransactionClient,
  c: Context,
  input: {
    enrollmentId: string;
    attemptId?: string;
    externalEvidenceId?: string;
    assessmentKind: AssessmentKind;
    verdict: "PASSED" | "FAILED";
    score: number | null;
    maximum: number | null;
    examAt: Date | null;
    supersedesResultId?: string;
    correctionReason?: string;
  },
): Promise<VerifiedExamResult> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${c.tenantId + ":lms-result:" + input.enrollmentId},0))`;
  const prior = await tx.verifiedExamResult.findFirst({
    where: {
      tenantId: c.tenantId,
      supersedesResultId: input.supersedesResultId || null,
      ...(input.attemptId
        ? { attemptId: input.attemptId }
        : { externalEvidenceId: input.externalEvidenceId || "missing" }),
    },
  });
  if (prior) return prior;
  const enrollment = await tx.enrollment.findFirst({
    where: { id: input.enrollmentId, tenantId: c.tenantId },
  });
  if (!enrollment) fail(404, "NOT_FOUND", "Назначение не найдено");
  if (input.supersedesResultId) {
    const old = await tx.verifiedExamResult.findFirst({
      where: {
        id: input.supersedesResultId,
        tenantId: c.tenantId,
        enrollmentId: enrollment.id,
        assessmentKind: "EXTERNAL_AUTHORIZED",
        examAt: null,
      },
    });
    if (
      !old ||
      input.assessmentKind !== "EXTERNAL_AUTHORIZED" ||
      !input.examAt ||
      !input.correctionReason
    )
      fail(
        409,
        "RESULT_REVISION_CONFLICT",
        "Уточнение не соответствует исходному результату",
      );
  }
  const version = await tx.courseVersion.findFirstOrThrow({
    where: {
      id: enrollment.courseVersionId,
      tenantId: c.tenantId,
      status: "PUBLISHED",
    },
  });
  const policyVersion = await tx.regulatoryProfileVersion.findFirstOrThrow({
    where: { id: version.regulatoryProfileVersionId, tenantId: c.tenantId },
  });
  const profile = regulatoryProfileSchema.parse(policyVersion.definition);
  const content = courseContentSchema.parse(version.content);
  const tenant = await tx.tenant.findUniqueOrThrow({
    where: { id: c.tenantId },
  });
  let source: Record<string, unknown>;
  let proctoringSatisfied = false;
  let protocol: FrozenProtocol | undefined;
  if (input.assessmentKind === "EXTERNAL_AUTHORIZED") {
    if (input.attemptId || !input.externalEvidenceId)
      fail(422, "RESULT_SOURCE", "Требуется внешнее основание");
    const evidence = await tx.lmsExternalEvidence.findFirst({
      where: {
        id: input.externalEvidenceId,
        tenantId: c.tenantId,
        enrollmentId: enrollment.id,
      },
    });
    if (
      !evidence ||
      !evidence.reviewedBy ||
      !evidence.reviewedAt ||
      (evidence.status !== "MACHINE_VERIFIED" &&
        !(
          profile.externalEvidenceLevel === "DOCUMENT_REVIEWED" &&
          evidence.status === "DOCUMENT_REVIEWED"
        ))
    )
      fail(409, "EXTERNAL_NOT_VERIFIED", "Внешний результат ожидает проверки");
    if (
      evidence.issuer !== profile.issuer ||
      evidence.examAt?.getTime() !== input.examAt?.getTime() ||
      input.score !== null ||
      input.maximum !== null
    )
      fail(
        409,
        "EXTERNAL_SOURCE_MISMATCH",
        "Основание не соответствует программе",
      );
    const sourceAudit = await tx.auditEvent.findFirst({
      where: {
        tenantId: c.tenantId,
        entityId: evidence.id,
        action: "LMS_EXTERNAL_EVIDENCE_ADDED",
      },
    });
    const dateMetadata = sourceAudit?.metadata as
      | {
          datePrecision?: string;
          examDate?: string;
          timezone?: string;
          derivedFromEvidenceId?: string;
        }
      | undefined;
    source = {
      externalEvidenceId: evidence.id,
      issuer: evidence.issuer,
      system: evidence.sourceSystem,
      documentNumber: evidence.documentNumber,
      documentDate: evidence.documentDate,
      sha256: evidence.sha256,
      verification: evidence.status,
      reviewedBy: evidence.reviewedBy,
      reviewedAt: evidence.reviewedAt,
      ...(dateMetadata?.datePrecision === "DATE"
        ? {
            datePrecision: "DATE",
            examDate: dateMetadata.examDate,
            timezone: dateMetadata.timezone,
            derivedFromEvidenceId: dateMetadata.derivedFromEvidenceId || null,
          }
        : {}),
    };
  } else {
    if (!input.attemptId || input.externalEvidenceId)
      fail(422, "RESULT_SOURCE", "Требуется завершённая попытка");
    const attempt = await tx.examAttempt.findFirst({
      where: {
        id: input.attemptId,
        tenantId: c.tenantId,
        enrollmentId: enrollment.id,
        courseVersionId: version.id,
        regulatoryProfileVersionId: policyVersion.id,
        assessmentKind: input.assessmentKind,
        purpose: "FINAL",
        assessmentId: "FINAL",
        state: "FINISHED",
      },
    });
    if (
      !attempt ||
      attempt.score !== input.score ||
      attempt.maximum !== input.maximum ||
      attempt.verdict !== input.verdict ||
      attempt.finishedAt?.getTime() !== input.examAt?.getTime()
    )
      fail(409, "ATTEMPT_NOT_FINAL", "Попытка ещё не завершена");
    if (profile.requiresProctoring) {
      const supervision = profile.proctoringMode === "LOCAL_SUPERVISED" && await proctorApproval(tx, c.tenantId, attempt);
      if (!supervision) fail(409, "PROCTORING_REVIEW_REQUIRED", "Для результата требуется решение наблюдателя по этой попытке");
      proctoringSatisfied = true;
    }
    const frozen = attempt.snapshot as unknown as {
      questions: LmsQuestion[];
      policy: { thresholdPercent: number; comparison: "GT" | "GTE" };
    };
    const review = await tx.lmsReviewDecision.findFirst({
      where: { tenantId: c.tenantId, attemptId: attempt.id, decision: "GRADE" },
    });
    if (
      review &&
      review.contentHash !==
        hash({
          snapshot: attempt.snapshot,
          answers: attempt.answers,
          submittedAt: attempt.submittedAt,
        })
    )
      fail(409, "REVIEW_CONFLICT", "Решение не соответствует исходным ответам");
    const calculated = gradeLearningAnswers(
      frozen.questions,
      attempt.answers as LearningAnswers,
      frozen.policy,
      (review?.questionScores || {}) as Record<string, 0 | 1>,
    );
    if (
      calculated.score !== input.score ||
      calculated.maxScore !== input.maximum ||
      calculated.verdict !== input.verdict
    )
      fail(
        409,
        "RESULT_SCORE_MISMATCH",
        "Оценка не соответствует сохранённым ответам",
      );
    const history = await tx.examAttempt.findMany({
      where: {
        tenantId: c.tenantId,
        enrollmentId: enrollment.id,
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
    protocol = {
      version: 1,
      attemptId: attempt.id,
      ordinal: attempt.ordinal,
      finishedAt: attempt.finishedAt!.toISOString(),
      thresholdPercent: frozen.policy.thresholdPercent,
      comparison: frozen.policy.comparison,
      percent: calculated.maxScore
        ? (calculated.score * 100) / calculated.maxScore
        : 0,
      questions: frozen.questions.map((question) =>
        protocolQuestion(
          question,
          (attempt.answers as LearningAnswers)[question.id],
          calculated.questionScores[question.id] ?? null,
        ),
      ),
      history: history.map((item) => ({
        ...item,
        finishedAt: item.finishedAt?.toISOString() || null,
      })),
      commission: profile.commission,
    };
    source = {
      attemptId: attempt.id,
      ordinal: attempt.ordinal,
      startedAt: attempt.startedAt,
      deadlineAt: attempt.deadlineAt,
      finishedAt: attempt.finishedAt,
      ...(review
        ? {
            reviewDecisionId: review.id,
            submittedAt: attempt.submittedAt,
            gradedAt: attempt.gradedAt,
          }
        : {}),
    };
  }
  const practiceRequirement = await evaluatePracticeRequirement(
    tx,
    c,
    enrollment,
    content,
    profile,
  );
  let eligible = routeEligible(
    profile,
    input.assessmentKind,
    input.verdict,
    input.examAt,
    tenant.demoOnly &&
      process.env.DEMO_LMS_TEST_RUNTIME === "1" &&
      process.env.NODE_ENV !== "production",
    practiceRequirement.satisfied,
    proctoringSatisfied,
  );
  const eligibility = await evaluateLearningEligibility(
    tx,
    c,
    enrollment,
    content,
  );
  const required = content.modules
    .flatMap((module) => module.lessons)
    .filter((lesson) => lesson.required);
  if (
    enrollment.status === "CANCELLED" ||
    !eligibility.prerequisitesSatisfied ||
    !required.every((lesson) =>
      eligibility.lessons.some(
        (item) => item.id === lesson.id && item.complete,
      ),
    )
  )
    eligible = false;
  if (
    profile.sanitary &&
    input.assessmentKind === "CENTER_EXAM" &&
    !(
      input.score !== null &&
      input.maximum !== null &&
      input.maximum > 0 &&
      input.score * 100 > input.maximum * 80
    )
  )
    eligible = false;
  const recipient = await tx.recipient.findFirstOrThrow({
    where: { id: enrollment.recipientId, tenantId: c.tenantId },
  });
  const customer = enrollment.customerId
    ? await tx.customerOrganization.findFirst({
        where: { id: enrollment.customerId, tenantId: c.tenantId },
      })
    : null;
  const person = recipient.data as Record<string, unknown>;
  const previous = await tx.verifiedExamResult.findFirst({
    where: { tenantId: c.tenantId, enrollmentId: enrollment.id },
    orderBy: { revision: "desc" },
  });
  const snapshot = {
    version: 1,
    ...(protocol ? { protocol } : {}),
    course: {
      id: version.courseId,
      versionId: version.id,
      version: version.version,
      titleRu: content.titleRu,
      titleKz: content.titleKz,
      hours: content.hours,
      category: content.category,
    },
    profile,
    regulatoryProfileVersionId: policyVersion.id,
    practiceRequirement,
    learner: {
      recipientId: recipient.id,
      fullNameRu: person.fullNameRu || "",
      fullNameKz: person.fullNameKz || "",
      positionRu: person.positionRu || "",
      positionKz: person.positionKz || "",
    },
    employer: customer
      ? {
          id: customer.id,
          nameRu: customer.nameRu,
          nameKz: customer.nameKz,
          addressRu: customer.addressRu,
          addressKz: customer.addressKz,
        }
      : null,
    assignedAt: enrollment.assignedAt,
    source,
    assessmentKind: input.assessmentKind,
    score: input.score,
    maximum: input.maximum,
    comparison: content.exam.comparison,
    thresholdPercent: content.exam.thresholdPercent,
    verdict: input.verdict,
    eligible,
    examAt: input.examAt,
  };
  const reviewReasons =
    input.assessmentKind === "EXTERNAL_AUTHORIZED" && input.examAt === null
      ? ["EXAM_DATE_UNKNOWN"]
      : [];
  const normalizedSnapshot = json({
    ...snapshot,
    ...(input.supersedesResultId
      ? {
          correction: {
            supersedesResultId: input.supersedesResultId,
            reason: input.correctionReason,
            actorId: c.userId,
          },
        }
      : {}),
    reviewReasons,
    documentEligible: eligible && !reviewReasons.length,
  });
  const result = await tx.verifiedExamResult.create({
    data: {
      tenantId: c.tenantId,
      enrollmentId: enrollment.id,
      revision: (previous?.revision || 0) + 1,
      supersedesResultId: input.supersedesResultId,
      attemptId: input.attemptId,
      externalEvidenceId: input.externalEvidenceId,
      assessmentKind: input.assessmentKind,
      regulatoryProfileVersionId: policyVersion.id,
      courseVersionId: version.id,
      recipientId: recipient.id,
      verdict: input.verdict,
      score: input.score,
      maximum: input.maximum,
      eligible,
      examAt: input.examAt,
      snapshot: normalizedSnapshot,
      snapshotHash: hash(normalizedSnapshot),
      createdBy: c.userId,
    },
  });
  if (input.verdict === "PASSED")
    await tx.enrollment.update({
      where: { id: enrollment.id },
      data: { completedAt: new Date() },
    });
  if (eligible && profile.sanitary)
    await tx.regulatoryOutbox.create({
      data: { tenantId: c.tenantId, resultId: result.id },
    });
  await audit(tx, c, "LMS_RESULT_FINALIZED", result.id, {
    revision: result.revision,
    assessmentKind: result.assessmentKind,
    eligible,
    sourceId: input.attemptId || input.externalEvidenceId,
  });
  return result;
}

export async function assertEligibleResult(
  tx: Prisma.TransactionClient,
  c: Context,
  resultId: string,
) {
  const result = await tx.verifiedExamResult.findFirst({
    where: { id: resultId, tenantId: c.tenantId },
  });
  if (!result) fail(404, "NOT_FOUND", "Результат не найден");
  if (
    !result.eligible ||
    result.verdict !== "PASSED" ||
    result.assessmentKind === "PRACTICE" ||
    (await tx.lmsResultEvent.findFirst({
      where: {
        tenantId: c.tenantId,
        resultId,
        kind: { in: ["VOIDED", "SUPERSEDED"] },
      },
    }))
  )
    fail(
      409,
      "RESULT_INELIGIBLE",
      "Этот результат не допускает подготовку документов",
    );
  return result;
}
