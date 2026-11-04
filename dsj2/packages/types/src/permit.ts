import { z } from "zod";
import { compatibleOffsetDateTime } from "./compat-datetime";
import { contractorAccessActSummarySchema } from "./contractor";
import { scopeTypeSchema } from "./core-identity";

const optionalId = z.string().min(1).nullable().optional();
const isoDateTime = compatibleOffsetDateTime();
const optionalLongText = z.string().max(8000).nullable().optional();
const optionalMediumText = z.string().max(4000).nullable().optional();

export const permitTypeSchema = z.enum([
  "HIGH_RISK_WORK",
  "CONTRACTOR_ACCESS",
  "SELF_WORK_ADMISSION",
  "AFTER_BRIEFING_ADMISSION",
  "AFTER_TRAINING_ADMISSION",
  "MEDICAL_BASED_ADMISSION",
  "PPE_BASED_ADMISSION",
]);

export const permitWorkTypeSchema = z.enum([
  "GENERAL_HIGH_RISK",
  "HEIGHT_WORK",
  "HOT_WORK",
  "GAS_HAZARDOUS_WORK",
  "ELECTRICAL_WORK",
  "EARTH_WORK",
  "CONFINED_SPACE",
  "LIFTING_WORK",
  "CONTRACTOR_SITE_ACCESS",
]);

export const mvpPermitWorkTypeSchema = z.enum([
  "GENERAL_HIGH_RISK",
  "HEIGHT_WORK",
  "CONTRACTOR_SITE_ACCESS",
]);

export const permitStatusSchema = z.enum([
  "draft",
  "pending_precheck",
  "missing_documents",
  "pending_approval",
  "approved",
  "signing_ready",
  "signed",
  "active",
  "suspended",
  "extended",
  "closed",
  "rejected",
  "cancelled",
  "expired",
  "archived",
]);

export const permitSubjectSchema = z.object({
  employeeId: optionalId,
  contractorWorkerId: optionalId,
  roleCode: z.string().min(1).max(120),
});

export const permitCrewInstructionAcknowledgementSchema = z.object({
  employeeId: optionalId,
  contractorWorkerId: optionalId,
  status: z.enum(["pending", "acknowledged"]),
  acknowledgedAt: isoDateTime.nullable().optional(),
});

export const permitSnapshotEvidenceSchema = z.object({
  id: z.string(),
  sourceType: z.string(),
  sourceStatus: z.string(),
  sourceHash: z.string(),
  issuedAt: z.string().nullable().optional(),
  validUntil: z.string().nullable().optional(),
  verifiedAt: z.string().nullable().optional(),
  subjectId: z.string().nullable().optional(),
  documentNumber: z.string().nullable().optional(),
});

export const permitPrecheckSubjectTypeSchema = z.enum([
  "EMPLOYEE",
  "CONTRACTOR_WORKER",
  "CONTRACTOR_ACCESS_ACT",
  "WORKPLACE",
  "DOCUMENT",
  "PPE",
]);

export const permitSnapshotSchema = z.object({
  checkedAt: isoDateTime,
  result: z.enum(["PASS", "FAIL"]),
  evidence: z.array(permitSnapshotEvidenceSchema),
});

export const permitPrecheckCheckSchema = z.object({
  code: z.string(),
  label: z.string(),
  result: z.enum(["PASS", "FAIL"]),
  severity: z.enum(["BLOCKER", "WARNING"]),
  message: z.string(),
  subjectType: permitPrecheckSubjectTypeSchema.nullable(),
  subjectId: z.string().nullable(),
  evidenceIds: z.array(z.string()),
  checkedAt: isoDateTime,
  expiresAt: isoDateTime.nullable(),
  sourceType: z.string().nullable(),
  sourceStatus: z.string().nullable(),
});

export const permitClosureSchema = z.object({
  result: z.string().min(1),
  inspection: z.string().min(1),
  closedAt: isoDateTime.optional(),
  notes: z.string().max(4000).nullable().optional(),
});

export const permitJournalPartySchema = z.object({
  id: z.string(),
  displayName: z.string(),
  sublabel: z.string().nullable().optional(),
});

export const permitJournalRowSchema = z.object({
  journalRegistrationNumber: z.string(),
  permitNumber: z.string(),
  initialAdmissionAt: isoDateTime.nullable(),
  repeatedAdmissionAt: isoDateTime.nullable(),
  issuer: permitJournalPartySchema.nullable(),
  workDescription: z.string(),
  workplace: z.string(),
  workType: permitWorkTypeSchema,
  status: permitStatusSchema,
  startAt: isoDateTime.nullable(),
  endAt: isoDateTime.nullable(),
  validUntil: isoDateTime.nullable(),
  contractor: permitJournalPartySchema.nullable(),
  closedAt: isoDateTime.nullable(),
  archivedAt: isoDateTime.nullable(),
  retentionUntil: isoDateTime.nullable(),
  archiveStatus: z.string().nullable(),
});

export const permitEntrySchema = z.object({
  id: z.string().optional(),
  companyId: optionalId,
  journalId: optionalId,
  permitNumber: z.string().min(2).max(64),
  journalRegistrationNumber: z.string().min(2).max(64),
  permitType: permitTypeSchema,
  workType: permitWorkTypeSchema,
  status: permitStatusSchema,
  workDescription: z.string().min(2).max(4000),
  workplace: z.string().min(2).max(1000),
  equipmentOrObject: z.string().max(1000).nullable().optional(),
  workZoneId: optionalId,
  departmentId: optionalId,
  startAt: isoDateTime,
  endAt: isoDateTime,
  validUntil: compatibleOffsetDateTime().nullable().optional(),
  contractorId: optionalId,
  contractorRepresentativeId: optionalId,
  contractorAccessActId: optionalId,
  contractorAccessAct: contractorAccessActSummarySchema.nullable().optional(),
  issuerId: optionalId,
  responsibleManagerId: optionalId,
  workProducerId: optionalId,
  admitterId: optionalId,
  observerId: optionalId,
  crew: z.array(permitSubjectSchema).default([]),
  crewMemberIds: z.array(z.string()).default([]),
  hazardFactors: z.array(z.string().min(1)).min(1),
  safetyMeasures: z.string().min(2).max(8000),
  workplacePreparationMeasures: optionalLongText,
  safetyMeasureExecutors: optionalMediumText,
  airAnalysisRequired: z.boolean().default(false),
  airAnalysisResult: optionalMediumText,
  airAnalysisAt: isoDateTime.nullable().optional(),
  airAnalysisBy: z.string().max(255).nullable().optional(),
  isolationLockoutMeasures: optionalLongText,
  fencingAndSignsMeasures: optionalLongText,
  fireSafetyMeasures: optionalLongText,
  communicationOrAdjacentAreaApprovals: optionalLongText,
  targetBriefingText: optionalLongText,
  targetBriefingAt: isoDateTime.nullable().optional(),
  targetBriefingInstructorId: optionalId,
  crewInstructionAcknowledgements: z
    .array(permitCrewInstructionAcknowledgementSchema)
    .default([]),
  admissionAt: isoDateTime.nullable().optional(),
  admittedById: optionalId,
  acceptedByWorkProducerAt: isoDateTime.nullable().optional(),
  ppeRequirements: optionalMediumText,
  ppeIssueRecordIds: z.array(z.string()).default([]),
  legalBasis: z.array(z.string()).min(1),
  legalBasisVersion: z.string().nullable().optional(),
  legalBasisEffectiveDate: z.string().nullable().optional(),
  trainingEvidenceIds: z.array(z.string()).default([]),
  briefingEvidenceIds: z.array(z.string()).default([]),
  certificateEvidenceIds: z.array(z.string()).default([]),
  medicalEvidenceIds: z.array(z.string()).default([]),
  requiredDocumentIds: z.array(z.string()).default([]),
  precheckSummary: z
    .object({
      result: z.enum(["PASS", "FAIL"]),
      checkedAt: isoDateTime,
      failedRules: z.array(z.string()),
      blockerCount: z.number().int().min(0).optional(),
      warningCount: z.number().int().min(0).optional(),
      payloadHash: z.string().optional(),
    })
    .nullable()
    .optional(),
  precheckChecks: z.array(permitPrecheckCheckSchema).optional(),
  trainingCheckSnapshot: permitSnapshotSchema.optional(),
  briefingCheckSnapshot: permitSnapshotSchema.optional(),
  certificateCheckSnapshot: permitSnapshotSchema.optional(),
  medicalCheckSnapshot: permitSnapshotSchema
    .extend({ containsDiagnosis: z.literal(false) })
    .optional(),
  ppeIssuedSnapshot: permitSnapshotSchema.optional(),
  requiredDocumentSnapshot: permitSnapshotSchema.optional(),
  contractorAccessActSnapshot: permitSnapshotSchema.optional(),
  approvalStatus: z.string().nullable().optional(),
  signatureStatus: z.string().nullable().optional(),
  suspensionReason: z.string().nullable().optional(),
  cancellationReason: z.string().nullable().optional(),
  rejectionReason: z.string().nullable().optional(),
  closure: permitClosureSchema.nullable().optional(),
  signedPayloadHash: z.string().nullable().optional(),
  documentVersionHash: z.string().nullable().optional(),
  archivedAt: z.string().nullable().optional(),
  retentionUntil: z.string().nullable().optional(),
  createdAt: z.string().optional(),
  updatedAt: z.string().optional(),
});

const permitCrewInputSchema = z.object({
  employeeIds: z.array(z.string()).default([]),
  contractorWorkerIds: z.array(z.string()).default([]),
});

export const createPermitSchema = z
  .object({
    organizationId: z.string().optional(),
    permitNumber: z.string().min(2).max(64),
    journalRegistrationNumber: z.string().min(2).max(64),
    permitType: permitTypeSchema,
    workType: mvpPermitWorkTypeSchema,
    workDescription: z.string().min(2).max(4000),
    workplace: z.string().min(2).max(1000),
    equipmentOrObject: z.string().max(1000).nullable().optional(),
    scopeType: scopeTypeSchema,
    branchId: optionalId,
    departmentId: optionalId,
    workSiteId: optionalId,
    startAt: isoDateTime,
    endAt: isoDateTime,
    contractorId: optionalId,
    contractorRepresentativeId: optionalId,
    contractorAccessActId: optionalId,
    issuerId: optionalId,
    responsibleManagerId: optionalId,
    workProducerId: optionalId,
    admitterId: optionalId,
    observerId: optionalId,
    crew: permitCrewInputSchema.default({
      employeeIds: [],
      contractorWorkerIds: [],
    }),
    hazardFactors: z.array(z.string().min(1)).min(1),
    safetyMeasures: z.string().min(2).max(8000),
    workplacePreparationMeasures: optionalLongText,
    safetyMeasureExecutors: optionalMediumText,
    airAnalysisRequired: z.boolean().optional(),
    airAnalysisResult: optionalMediumText,
    airAnalysisAt: isoDateTime.nullable().optional(),
    airAnalysisBy: z.string().max(255).nullable().optional(),
    isolationLockoutMeasures: optionalLongText,
    fencingAndSignsMeasures: optionalLongText,
    fireSafetyMeasures: optionalLongText,
    communicationOrAdjacentAreaApprovals: optionalLongText,
    targetBriefingText: optionalLongText,
    targetBriefingAt: isoDateTime.nullable().optional(),
    targetBriefingInstructorId: optionalId,
    crewAcknowledgementsComplete: z.boolean().optional(),
    admissionAt: isoDateTime.nullable().optional(),
    admittedById: optionalId,
    acceptedByWorkProducerAt: isoDateTime.nullable().optional(),
    ppeRequirements: optionalMediumText,
    ppeIssueRecordIds: z.array(z.string()).default([]),
    legalBasis: z.array(z.string()).min(1),
    trainingEvidenceIds: z.array(z.string()).default([]),
    briefingEvidenceIds: z.array(z.string()).default([]),
    certificateEvidenceIds: z.array(z.string()).default([]),
    medicalEvidenceIds: z.array(z.string()).default([]),
    requiredDocumentIds: z.array(z.string()).default([]),
  })
  .strict();

export const updatePermitSchema = createPermitSchema
  .omit({ organizationId: true })
  .partial()
  .refine(
    (input) => Object.keys(input).length > 0,
    "At least one field is required.",
  );

export const permitListFilterSchema = z.object({
  organizationId: z.string().optional(),
  permitType: permitTypeSchema.optional(),
  workType: permitWorkTypeSchema.optional(),
  status: permitStatusSchema.optional(),
  departmentId: z.string().optional(),
  contractorId: z.string().optional(),
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
  missingOnly: z.coerce.boolean().optional(),
  activeOnly: z.coerce.boolean().optional(),
  archivedOnly: z.coerce.boolean().optional(),
  sortBy: z
    .enum(["createdAt", "startAt", "endAt", "permitNumber"])
    .default("createdAt"),
  sortOrder: z.enum(["asc", "desc"]).default("desc"),
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

export const permitWorkflowSchema = z.object({
  comment: z.string().max(2000).nullable().optional(),
});

export const permitReasonSchema = z.object({
  reason: z.string().min(3).max(2000),
});

export const closePermitSchema = z.object({
  comment: z.string().max(2000).nullable().optional(),
  closure: permitClosureSchema,
});

export const preparePermitSignSchema = z.object({
  comment: z.string().max(2000).nullable().optional(),
});

export const createPpeIssueRecordSchema = z
  .object({
    organizationId: z.string().optional(),
    employeeId: optionalId,
    contractorWorkerId: optionalId,
    itemCode: z.string().min(1).max(120),
    itemName: z.string().min(2).max(255),
    issuedAt: isoDateTime,
    validUntil: compatibleOffsetDateTime().nullable().optional(),
    sourceDocumentId: optionalId,
  })
  .refine(
    (input) => Boolean(input.employeeId) !== Boolean(input.contractorWorkerId),
    "Exactly one PPE recipient is required.",
  );

export type PermitType = z.infer<typeof permitTypeSchema>;
export type PermitWorkType = z.infer<typeof permitWorkTypeSchema>;
export type MvpPermitWorkType = z.infer<typeof mvpPermitWorkTypeSchema>;
export type PermitStatus = z.infer<typeof permitStatusSchema>;
export type PermitEntry = z.infer<typeof permitEntrySchema>;
export type PermitJournalParty = z.infer<typeof permitJournalPartySchema>;
export type PermitJournalRow = z.infer<typeof permitJournalRowSchema>;
export type PermitSnapshot = z.infer<typeof permitSnapshotSchema>;
export type PermitPrecheckCheck = z.infer<typeof permitPrecheckCheckSchema>;
export type CreatePermitInput = z.infer<typeof createPermitSchema>;
export type UpdatePermitInput = z.infer<typeof updatePermitSchema>;
export type PermitListFilter = z.infer<typeof permitListFilterSchema>;
export type PermitWorkflowInput = z.infer<typeof permitWorkflowSchema>;
export type PermitReasonInput = z.infer<typeof permitReasonSchema>;
export type ClosePermitInput = z.infer<typeof closePermitSchema>;
export type PreparePermitSignInput = z.infer<typeof preparePermitSignSchema>;
export type CreatePpeIssueRecordInput = z.infer<
  typeof createPpeIssueRecordSchema
>;
