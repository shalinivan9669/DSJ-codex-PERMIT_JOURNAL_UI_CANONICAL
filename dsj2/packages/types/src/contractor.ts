import { z } from "zod";
import { compatibleOffsetDateTime } from "./compat-datetime";
import { scopeTypeSchema } from "./core-identity";

const optionalId = z.string().min(1).nullable().optional();
const isoDateTime = compatibleOffsetDateTime();
const optionalText = z.string().max(8000).nullable().optional();

export const contractorCompanySchema = z.object({
  id: z.string(),
  companyId: z.string(),
  name: z.string().min(2),
  bin: z.string().nullable(),
  contactEmail: z.string().email().nullable(),
  contactPhone: z.string().nullable(),
  notes: z.string().nullable(),
  isActive: z.boolean(),
});

const contractorCompanyInputSchema = z.object({
  companyId: z.string().optional(),
  name: z.string().min(2),
  bin: z.string().nullable().optional(),
  contactEmail: z.string().email().nullable().optional(),
  contactPhone: z.string().nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
});

export const createContractorCompanySchema = contractorCompanyInputSchema;

export const updateContractorCompanySchema = contractorCompanyInputSchema.extend({
  isActive: z.boolean().optional(),
});

export type ContractorCompany = z.infer<typeof contractorCompanySchema>;
export type CreateContractorCompanyInput = z.infer<typeof createContractorCompanySchema>;
export type UpdateContractorCompanyInput = z.infer<typeof updateContractorCompanySchema>;

export const contractorAccessActStatusSchema = z.enum([
  "DRAFT",
  "ACTIVE",
  "CLOSED",
  "CANCELLED",
  "ARCHIVED",
]);

export const contractorAccessActSummarySchema = z.object({
  id: z.string(),
  actNumber: z.string(),
  status: contractorAccessActStatusSchema,
  validFrom: isoDateTime,
  validTo: isoDateTime,
  workArea: z.string(),
  contractorOrganizationId: z.string(),
  contractorRepresentativeId: z.string().nullable(),
});

export const contractorAccessActSchema = z.object({
  id: z.string(),
  organizationId: z.string(),
  actNumber: z.string(),
  status: contractorAccessActStatusSchema,
  scopeType: scopeTypeSchema,
  branchId: z.string().nullable(),
  departmentId: z.string().nullable(),
  workSiteId: z.string().nullable(),
  contractorOrganizationId: z.string(),
  contractorRepresentativeId: z.string().nullable(),
  hostRepresentativeEmployeeId: z.string().nullable(),
  hostUnitChiefEmployeeId: z.string().nullable(),
  workName: z.string(),
  workDescription: z.string().nullable(),
  workArea: z.string(),
  workAreaBoundaries: z.string().nullable(),
  workAreaCoordinates: z.unknown().nullable(),
  validFrom: isoDateTime,
  validTo: isoDateTime,
  safetyMeasures: z.array(z.string()),
  specialConditions: z.string().nullable(),
  legalBasis: z.string(),
  legalBasisVersion: z.string(),
  legalBasisEffectiveDate: z.string(),
  documentEnvelopeId: z.string().nullable(),
  currentVersionId: z.string().nullable(),
  signedAt: isoDateTime.nullable(),
  closedAt: isoDateTime.nullable(),
  cancelledAt: isoDateTime.nullable(),
  cancellationReason: z.string().nullable().optional(),
  archivedAt: isoDateTime.nullable(),
  archiveRecordId: z.string().nullable(),
  retentionPolicyId: z.string().nullable(),
  createdByUserId: z.string().nullable(),
  updatedByUserId: z.string().nullable(),
  createdAt: isoDateTime,
  updatedAt: isoDateTime,
});

const contractorAccessActInputSchema = z.object({
  organizationId: z.string().optional(),
  actNumber: z.string().min(1).max(64),
  scopeType: scopeTypeSchema,
  branchId: optionalId,
  departmentId: optionalId,
  workSiteId: optionalId,
  contractorOrganizationId: z.string().min(1),
  contractorRepresentativeId: optionalId,
  hostRepresentativeEmployeeId: optionalId,
  hostUnitChiefEmployeeId: optionalId,
  workName: z.string().min(2).max(1000),
  workDescription: optionalText,
  workArea: z.string().min(2).max(4000),
  workAreaBoundaries: optionalText,
  workAreaCoordinates: z.unknown().nullable().optional(),
  validFrom: isoDateTime,
  validTo: isoDateTime,
  safetyMeasures: z.array(z.string().min(1).max(2000)).min(1),
  specialConditions: optionalText,
});

export const createContractorAccessActSchema =
  contractorAccessActInputSchema.strict();

export const updateContractorAccessActSchema = contractorAccessActInputSchema
  .omit({ organizationId: true })
  .partial()
  .strict()
  .refine(
    (input) => Object.keys(input).length > 0,
    "At least one field is required.",
  );

export const contractorAccessActListFilterSchema = z.object({
  organizationId: z.string().optional(),
  companyId: z.string().optional(),
  status: contractorAccessActStatusSchema.optional(),
  contractorOrganizationId: z.string().optional(),
  workSiteId: z.string().optional(),
  dateFrom: z.string().optional(),
  dateTo: z.string().optional(),
  activeOnly: z.coerce.boolean().optional(),
  archivedOnly: z.coerce.boolean().optional(),
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});

export const contractorAccessActWorkflowSchema = z.object({
  comment: z.string().max(2000).nullable().optional(),
});

export const contractorAccessActReasonSchema = z.object({
  reason: z.string().min(3).max(2000),
});

export type ContractorAccessActStatus = z.infer<
  typeof contractorAccessActStatusSchema
>;
export type ContractorAccessActSummary = z.infer<
  typeof contractorAccessActSummarySchema
>;
export type ContractorAccessAct = z.infer<typeof contractorAccessActSchema>;
export type CreateContractorAccessActInput = z.infer<
  typeof createContractorAccessActSchema
>;
export type UpdateContractorAccessActInput = z.infer<
  typeof updateContractorAccessActSchema
>;
export type ContractorAccessActListFilter = z.infer<
  typeof contractorAccessActListFilterSchema
>;
export type ContractorAccessActWorkflowInput = z.infer<
  typeof contractorAccessActWorkflowSchema
>;
export type ContractorAccessActReasonInput = z.infer<
  typeof contractorAccessActReasonSchema
>;
