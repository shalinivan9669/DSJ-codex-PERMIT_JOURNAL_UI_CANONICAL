import type { Prisma, VerifiedExamResult } from "@demo/database";
import {
  regulatoryProfileSchema,
  itemSchema,
  resolveRecipientText,
  today,
  type Assignment,
  type Draft,
} from "@demo/contracts";
import { fail, hash, type Context } from "../core";
import { assertEligibleResult } from "./result-finalization";
import { assertLmsDeploymentAllowed } from "./deployment-gate";

export const lmsTemplateTypes = {
  "lms-protocol": "PROTOCOL",
  "lms-certificate": "CERTIFICATE",
  "lms-credential": "CREDENTIAL",
} as const;
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
    source,
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
      if (
        requestId &&
        !(await tx.lmsDocumentLink.findFirst({
          where: {
            tenantId: c.tenantId,
            requestId,
            resultId: result.id,
            documentType: type,
          },
        }))
      ) {
        fail(
          409,
          "LMS_REQUEST_BINDING_REQUIRED",
          "Подготовьте документ из сохранённого результата обучения; повторный выпуск оформляется отдельной редакцией",
        );
      }
      const snapshot = result.snapshot as Record<string, unknown>;
      const profile = regulatoryProfileSchema.parse(snapshot.profile);
      const recipient = documentRecipient(result);
      if (
        !profile.documentTypes.includes(type) ||
        (profile.templateIds[type] &&
          profile.templateIds[type] !== assignment.templateId) ||
        result.recipientId !== item.recipientId ||
        assignment.id !== `${result.id}-${type}` ||
        hash(assignment.lms) !== hash(documentMetadata(result)) ||
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
