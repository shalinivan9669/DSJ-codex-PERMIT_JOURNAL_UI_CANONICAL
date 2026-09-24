import { z } from "zod";

const id = z.string().min(1).max(80);
const text = z.string().trim().min(1).max(2000);
const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const parsed = new Date(`${value}T12:00:00Z`);
    return (
      !isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
    );
  }, "Укажите существующую календарную дату");
export const serviceOrderSchema = z
  .object({
    title: z.string().trim().min(1).max(255),
    customerId: id.nullable().default(null),
    payerId: id.nullable().default(null),
    contact: z.string().max(500).default(""),
    ownerId: id.nullable().default(null),
    dueDate: date.nullable().default(null),
    requestIds: z.array(id).max(100).default([]),
  })
  .strict();
export const orderPatchSchema = z
  .object({
    expectedRevision: z.number().int().nonnegative(),
    title: z.string().trim().min(1).max(255).optional(),
    contact: z.string().max(500).optional(),
    ownerId: id.nullable().optional(),
    dueDate: date.nullable().optional(),
    status: z.enum(["OPEN", "CANCELLED", "COMPLETED"]).optional(),
    reason: z.string().max(2000).optional(),
    requestIds: z.array(id).max(100).optional(),
  })
  .strict();
export const milestoneSchema = z
  .object({
    label: z.string().trim().min(1).max(255),
    category: z.enum([
      "DATA",
      "RESULTS",
      "DOCUMENTS",
      "TRANSFER",
      "SETTLEMENT",
      "EVIDENCE",
    ]),
    source: z.enum(["NORMATIVE", "CONTRACT", "RECOMMENDATION"]),
    sourceReference: text,
    ownerId: id.nullable().default(null),
    dueDate: date.nullable().default(null),
  })
  .strict();
export const milestonePatchSchema = z
  .object({
    status: z.enum(["PENDING", "DONE", "WAIVED"]),
    evidence: z.string().max(2000).default(""),
    reason: z.string().max(2000).default(""),
  })
  .strict();
export const renewalSchema = z
  .object({
    customerId: id.nullable().default(null),
    recipientId: id.nullable().default(null),
    sourceRequestId: id,
    sourceRowId: id,
    assignmentId: id,
    policySource: text,
    policyVersion: z.string().trim().min(1).max(100),
    basisDate: date,
    documentValidUntil: date.nullable().default(null),
    nextCheckDate: date.nullable().default(null),
    contactAfter: date.nullable().default(null),
    confirmed: z.boolean().default(false),
    ownerId: id.nullable().default(null),
  })
  .strict();
export const renewalPatchSchema = z
  .object({
    state: z.enum([
      "NEEDS_REVIEW",
      "CONFIRMED",
      "CONTACTED",
      "IRRELEVANT",
      "DEFERRED",
    ]),
    reason: z.string().max(2000).default(""),
    contactAfter: date.nullable().optional(),
    ownerId: id.nullable().optional(),
  })
  .strict();
export const renewalScanSchema = z
  .object({
    ruleVersionId: id,
    contactLeadDays: z.number().int().min(0).max(365),
    confirmedPolicy: z.literal(true),
    afterRequestId: id.optional(),
  })
  .strict();
export const evidenceMatrixSchema = z
  .object({
    customerId: id,
    ruleVersionIds: z.array(id).min(1).max(30),
  })
  .strict();
export const contactSchema = z
  .object({
    occurredOn: date,
    channel: z.enum(["PHONE", "EMAIL", "MESSENGER", "MANUAL"]),
    outcome: z.enum(["CONTACTED", "CONFIRMED", "DEFERRED", "IRRELEVANT"]),
    note: text,
    nextContactDate: date.nullable().default(null),
  })
  .strict();
export const evidenceSchema = z
  .object({
    customerId: id,
    recipientId: id,
    program: z.string().trim().min(1).max(500),
    issuer: z.string().trim().min(1).max(500),
    originalNumber: z.string().trim().min(1).max(255),
    documentDate: date,
    validUntil: date.nullable().default(null),
    source: text,
  })
  .strict();
export const evidenceVerificationSchema = z
  .object({
    status: z.enum(["VERIFIED", "UNVERIFIED", "SUPERSEDED"]),
    verificationNote: text,
  })
  .strict();
export const ruleVersionSchema = z
  .object({
    serviceKey: z.string().regex(/^[A-Za-z0-9_-]{1,80}$/),
    title: z.string().trim().min(1).max(255),
    status: z.enum(["DRAFT", "APPROVED", "RETIRED"]),
    source: text,
    applicability: text,
    checkedOn: date.nullable().default(null),
    effectiveFrom: date.nullable().default(null),
    effectiveTo: date.nullable().default(null),
    definition: z
      .object({
        programVersion: z.string().max(100),
        category: z.string().max(100),
        compatibleTemplateIds: z.array(id).max(30),
        requirements: z
          .array(
            z
              .object({
                key: id,
                label: z.string().min(1).max(255),
                source: z.enum(["NORMATIVE", "CONTRACT", "RECOMMENDATION"]),
                stage: z.enum([
                  "DATA",
                  "RESULTS",
                  "DOCUMENTS",
                  "TRANSFER",
                  "SETTLEMENT",
                  "EVIDENCE",
                ]),
              })
              .strict(),
          )
          .max(50),
        limitation: z.string().max(2000).default(""),
      })
      .strict(),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.status === "APPROVED" && !v.checkedOn)
      ctx.addIssue({
        code: "custom",
        path: ["checkedOn"],
        message: "Для утверждения укажите дату проверки источника",
      });
    if (v.effectiveFrom && v.effectiveTo && v.effectiveFrom > v.effectiveTo)
      ctx.addIssue({
        code: "custom",
        path: ["effectiveTo"],
        message: "Конец периода раньше начала",
      });
  });
export const dossierSchema = z
  .object({
    title: z.string().trim().min(1).max(255),
    category: z.enum([
      "AUTHORIZATION",
      "PROGRAM",
      "QUALIFICATION",
      "FACILITY",
      "INTERNAL_CONTROL",
    ]),
    version: z.string().trim().min(1).max(100),
    source: text,
    applicability: text,
    validUntil: date.nullable().default(null),
    ownerId: id,
    customerVisible: z.boolean().default(false),
  })
  .strict();
export const membershipSchema = z
  .object({
    customerId: id,
    userId: id,
    permissions: z
      .array(z.enum(["READ", "PROPOSE", "APPROVE_DATA", "DOWNLOAD"]))
      .min(1)
      .max(4),
    recipientIds: z.array(id).max(1000).default([]),
    expiresAt: z.iso.datetime().nullable().default(null),
  })
  .strict();
export const proposalSchema = z
  .object({
    requestId: id,
    requestRevision: z.number().int().nonnegative(),
    kind: z.enum([
      "UPDATE_LIST",
      "CONFIRM_LIST",
      "CLARIFICATION",
      "REPEAT_REQUEST",
    ]),
    message: z.string().max(2000).default(""),
    changes: z
      .array(
        z
          .object({
            rowId: id,
            fullNameRu: z.string().max(500).optional(),
            fullNameKz: z.string().max(500).optional(),
            positionRu: z.string().max(500).optional(),
            positionKz: z.string().max(500).optional(),
            employmentStatus: z
              .enum(["CURRENT", "LEFT", "TRAINED_ELSEWHERE"])
              .optional(),
            note: z.string().max(1000).optional(),
          })
          .strict(),
      )
      .max(100)
      .default([]),
  })
  .strict();
export const commercialSchema = z
  .object({
    expectedRevision: z.number().int().nonnegative(),
    taxBasis: z.string().max(1000).default(""),
    taxRateBasisPoints: z
      .number()
      .int()
      .min(0)
      .max(10000)
      .nullable()
      .default(null),
    lines: z
      .array(
        z
          .object({
            label: z.string().trim().min(1).max(255),
            serviceVersion: z.string().max(100).default(""),
            unit: z.enum(["PERSON_SERVICE", "GROUP", "FIXED"]),
            quantity: z.number().int().min(1).max(100000),
            unitPriceMinor: z.string().regex(/^(0|[1-9]\d{0,13})$/),
            discountMinor: z
              .string()
              .regex(/^(0|[1-9]\d{0,13})$/)
              .default("0"),
            discountReason: z.string().max(500).default(""),
          })
          .strict(),
      )
      .max(100),
  })
  .strict();
export type CommercialInput = z.infer<typeof commercialSchema>;
/** All monetary operations use integer minor KZT units. A missing tax setting stays unknown. */
export function calculateCommercial(input: CommercialInput) {
  const lines = input.lines.map((line) => {
    const gross = BigInt(line.unitPriceMinor) * BigInt(line.quantity);
    const discount = BigInt(line.discountMinor);
    if (discount > gross) throw new Error("DISCOUNT_EXCEEDS_LINE");
    if (discount > 0n && !line.discountReason.trim())
      throw new Error("DISCOUNT_REASON_REQUIRED");
    return { ...line, totalMinor: (gross - discount).toString() };
  });
  const subtotal = lines.reduce(
    (sum, line) => sum + BigInt(line.totalMinor),
    0n,
  );
  if (input.taxRateBasisPoints !== null && !input.taxBasis.trim())
    throw new Error("TAX_BASIS_REQUIRED");
  const tax =
    input.taxRateBasisPoints === null
      ? null
      : (subtotal * BigInt(input.taxRateBasisPoints) + 5000n) / 10000n;
  return {
    currency: "KZT" as const,
    lines,
    subtotalMinor: subtotal.toString(),
    taxMinor: tax?.toString() ?? null,
    totalMinor: tax === null ? null : (subtotal + tax).toString(),
    taxBasis: input.taxBasis,
    taxRateBasisPoints: input.taxRateBasisPoints,
  };
}
export const paymentSchema = z
  .object({
    amountMinor: z
      .string()
      .regex(/^-?(0|[1-9]\d{0,15})$/)
      .refine((v) => BigInt(v) !== 0n),
    occurredOn: date,
    source: text,
    reconciliationRequired: z.boolean().default(false),
  })
  .strict();
export const financialDocumentSchema = z
  .object({
    type: z.enum(["CONTRACT", "INVOICE", "ACT"]),
    number: z.string().trim().min(1).max(255),
    documentDate: date,
    source: text,
  })
  .strict();
export const valueAttachmentSchema = z
  .object({
    orderId: id.optional(),
    eventId: id.optional(),
    evidenceId: id.optional(),
    dossierId: id.optional(),
    financialDocumentId: id.optional(),
    category: z.enum([
      "SOURCE",
      "SIGNED_SCAN",
      "MANUAL_RESULT",
      "MATERIAL",
      "HANDOVER",
      "FINANCIAL",
    ]),
    source: text,
    fileName: z.string().min(1).max(200),
    contentBase64: z.string().min(1).max(1400000),
    customerVisible: z.boolean().default(false),
  })
  .strict()
  .refine(
    (v) =>
      [v.orderId, v.evidenceId, v.dossierId, v.financialDocumentId].filter(
        Boolean,
      ).length === 1,
    "Выберите ровно одного владельца вложения",
  )
  .refine(
    (v) => !v.eventId || !!v.orderId,
    "Событие можно указать только для вложения заказа",
  );
export function evidenceState(
  record: { status: string; validUntil: string | null } | null,
  asOf: string,
) {
  if (!record) return "UNKNOWN";
  if (record.status === "SUPERSEDED") return "SUPERSEDED";
  if (record.status !== "VERIFIED") return "UNVERIFIED";
  if (!record.validUntil) return "VERIFIED_NO_EXPIRY";
  if (record.validUntil < asOf) return "REVIEW_DATE_PASSED";
  const horizon = new Date(`${asOf}T12:00:00Z`);
  horizon.setUTCDate(horizon.getUTCDate() + 60);
  return record.validUntil <= horizon.toISOString().slice(0, 10)
    ? "APPROACHING"
    : "VERIFIED";
}
