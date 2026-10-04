import type {
  Assignment,
  CommonFields,
  Draft,
  RequestItemInput,
  ValidationIssue,
} from "./index";
import { protocolTemplateFor, stableValidationIssue } from "./index";
import { isBlankText } from "./blank-text";
import {
  courseProgramDefaults,
  courseProgramKeys,
  courseResultText,
  isProtectedField,
  nonPassedResultKz,
  factualAssessmentText,
} from "./course-defaults";
import { applyBusinessValidity, employeeCategoryFor } from "./business-rules";
import {
  calculateDates,
  calculatedDateKeys,
  trainingBeforeIssueProblems,
  type TrainingDateRule,
} from "./date-calculation";

export const commonFieldKeys = [
  "documentDate",
  "trainingStart",
  "trainingEnd",
  "protocolDate",
  "validUntil",
  "trainingSubject",
  "trainingSubjectKz",
  "psGeneralSubjectRu",
  "psGeneralSubjectKz",
  "psSpecialSubjectRu",
  "psSpecialSubjectKz",
  "trainingSubjectEn",
  "reason",
  "reasonEn",
  "education",
  "educationEn",
  "externalBasisNumber",
  "hours",
  "productionHours",
  "biotCategory",
  "biotCheckType",
  "biotIndustryRu",
  "biotIndustryKz",
  "biotIndustryEn",
  "biotKnowledgeResult",
  "biotKnowledgeResultEn",
  "biotProctoringResult",
  "biotProctoringResultEn",
  "professionRu",
  "professionKz",
  "psQualificationRu",
  "psQualificationKz",
] as const;
export type FieldSource =
  | "COURSE"
  | "CENTER"
  | "PRESET"
  | "REQUEST"
  | "EVENT"
  | "MANUAL"
  | "IMPORTED"
  | "AUTO"
  | "CLEARED";

// Shared entry is a convenience for individual protocol columns. A person's
// factual grade or awarded qualification may differ from the course default.
const individualCommonFields = new Set<string>([
  "biotKnowledgeResult",
  "biotKnowledgeResultEn",
  "biotProctoringResult",
  "biotProctoringResultEn",
  "professionRu",
  "professionKz",
  "psQualificationRu",
  "psQualificationKz",
]);
const assessmentCommonFields = new Set<string>([
  "biotKnowledgeResult",
  "biotKnowledgeResultEn",
  "biotProctoringResult",
  "biotProctoringResultEn",
]);

function commonContext(
  layers: readonly (readonly [CommonFields | undefined, FieldSource])[],
) {
  const fields: CommonFields = {};
  const origins: Record<string, FieldSource> = {};
  for (const [layer, source] of layers) {
    if (!layer) continue;
    if (layer.trainingDateRule !== undefined)
      fields.trainingDateRule = layer.trainingDateRule;
    for (const key of commonFieldKeys) {
      const declaredOrigin = layer.fieldOrigins?.[key];
      const programField = courseProgramKeys.some(
        (programKey) => programKey === key,
      );
      if (programField && layer[key] === "" && !declaredOrigin) continue;
      if (
        individualCommonFields.has(key) &&
        isBlankText(layer[key]) &&
        !declaredOrigin
      )
        continue;
      // Empty profile/request/event placeholders are not an instruction to
      // erase the category's training hours. Explicit source/clear metadata
      // still takes precedence over the built-in assignment values.
      if (
        (key === "hours" || key === "productionHours") &&
        isBlankText(layer[key]) &&
        !isProtectedField(declaredOrigin)
      )
        continue;
      // Previously resolved automatic text must never outrank a newly selected
      // centre/profile or a manual event exception.
      if (declaredOrigin === "COURSE" && origins[key]) continue;
      if (
        layer[key] === undefined &&
        layer.dateOrigins?.[
          key as keyof NonNullable<CommonFields["dateOrigins"]>
        ] !== "AUTO"
      )
        continue;
      (fields as Record<string, unknown>)[key] =
        declaredOrigin === "CLEARED" ? "" : layer[key];
      origins[key] =
        layer.dateOrigins?.[
          key as keyof NonNullable<CommonFields["dateOrigins"]>
        ] ||
        (declaredOrigin && declaredOrigin !== "INHERITED"
          ? declaredOrigin
          : source);
    }
  }
  const preservedOrigins = Object.fromEntries(
    Object.entries(origins).filter(([, origin]) =>
      ["COURSE", "MANUAL", "IMPORTED", "CLEARED", "AUTO"].includes(origin),
    ),
  ) as NonNullable<CommonFields["fieldOrigins"]>;
  if (Object.keys(preservedOrigins).length)
    fields.fieldOrigins = preservedOrigins;
  return { fields, origins };
}

export function resolveCommonDates(
  fields: CommonFields,
  center: CommonFields = {},
  preset: CommonFields = {},
  liveRules = false,
): CommonFields {
  const result = commonContext([
    [center, "CENTER"],
    [preset, "PRESET"],
    [fields, "REQUEST"],
  ]);
  applyDateCalculation(
    result.fields,
    result.origins,
    result.fields.trainingDateRule,
    undefined,
    !liveRules,
  );
  return result.fields;
}

function applyDateCalculation(
  values: CommonFields,
  origins: Record<string, FieldSource>,
  rule?: TrainingDateRule | null,
  eventDocumentDate?: string,
  calculateValidity = true,
) {
  const calculation = calculateDates(
    eventDocumentDate ? { ...values, documentDate: eventDocumentDate } : values,
    rule,
  );
  for (const key of calculatedDateKeys) {
    if (key === "validUntil" && !calculateValidity) continue;
    if (origins[key] === "AUTO" || (!origins[key] && !values[key])) {
      if (calculation.proposed[key] !== undefined || origins[key] === "AUTO") {
        values[key] = calculation.proposed[key] || "";
        origins[key] = key === "validUntil" ? "PRESET" : "AUTO";
        values.dateOrigins = { ...values.dateOrigins, [key]: "AUTO" };
      }
    }
  }
  return calculation;
}

/** Reuse the entered text when a separate language spelling was not supplied.
 * This does not translate or transliterate, and never overwrites an explicit spelling.
 */
export function resolveRecipientText<T extends RequestItemInput>(item: T): T {
  const result = { ...item };
  for (const [ru, kz] of [
    ["fullNameRu", "fullNameKz"],
    ["positionRu", "positionKz"],
    ["workplaceRu", "workplaceKz"],
  ] as const) {
    if (isBlankText(result[ru])) result[ru] = result[kz];
    if (isBlankText(result[kz])) result[kz] = result[ru];
  }
  return result;
}

/** Resolves once on the server. Result/number can never be inherited. */
export function resolveDraft(input: Draft, center: CommonFields = {}) {
  const draft: Draft = structuredClone(input);
  draft.items = draft.items.map(resolveRecipientText);
  const provenance: Record<string, Record<string, FieldSource>> = {};
  const issues: ValidationIssue[] = [];
  const eventContexts = new Map(
    (draft.events || []).map((event) => {
      const context = commonContext([
        [courseProgramDefaults(event.protocolTemplateId), "COURSE"],
        [center, "CENTER"],
        [draft.presetFields, "PRESET"],
        [draft.commonFields, "REQUEST"],
        [event.commonFields, "EVENT"],
      ]);
      if (draft.schemaVersion === 2)
        applyDateCalculation(
          context.fields,
          context.origins,
          context.fields.trainingDateRule,
          undefined,
          draft.businessRuleVersion !== "LIVE_V1",
        );
      return [event.id, context] as const;
    }),
  );
  for (const item of draft.items) {
    const seen = new Set<string>();
    for (const a of item.assignments.filter(
      (a) => a.protocolMode === "GROUP",
    )) {
      const key = `${a.eventId}:${a.templateId}`;
      if (seen.has(key))
        issues.push({
          code: "DUPLICATE_EVENT_ASSIGNMENT",
          path: "items",
          rowId: item.id,
          message: "Набор уже назначен участнику этого события",
        });
      seen.add(key);
    }
  }
  for (const [row, item] of draft.items.entries())
    for (const [column, assignment] of item.assignments.entries()) {
      const path = `items.${row}.assignments.${column}`;
      const context =
        eventContexts.get(assignment.eventId || "") ||
        commonContext([
          [courseProgramDefaults(assignment.templateId), "COURSE"],
          [center, "CENTER"],
          [draft.presetFields, "PRESET"],
          [draft.commonFields, "REQUEST"],
        ]);
      const origins: Record<string, FieldSource> = { ...context.origins };
      provenance[`${item.id}:${assignment.id}`] = origins;
      const event = draft.events?.find((e) => e.id === assignment.eventId);
      if (
        (assignment.protocolMode === "GROUP" ||
          (draft.businessRuleVersion === "LIVE_V1" && assignment.eventId)) &&
        (!event ||
          event.protocolTemplateId !==
            protocolTemplateFor(assignment.templateId) ||
          (assignment.protocolMode === "GROUP" &&
            assignment.templateId.endsWith("-protocol")))
      )
        issues.push({
          code: "EVENT_INCOMPATIBLE",
          path,
          rowId: item.id,
          message:
            "Выберите совместимое событие для удостоверения. Групповой протокол создаётся один раз для события",
        });
      if (assignment.protocolMode === "GROUP" && !assignment.outcome)
        issues.push({
          code: "OUTCOME_REQUIRED",
          path: `${path}.outcome`,
          rowId: item.id,
          message: "Подтвердите индивидуальный исход и источник ведомости",
        });
      if (
        assignment.protocolMode === "GROUP" &&
        assignment.outcome?.status !== "UNKNOWN" &&
        !assignment.outcome?.source.trim()
      )
        issues.push({
          code: "OUTCOME_SOURCE_REQUIRED",
          path: `${path}.outcome.source`,
          rowId: item.id,
          message: "Укажите источник подтверждённого результата",
        });
      for (const key of commonFieldKeys) {
        let value = context.fields[key];
        let source = origins[key];
        const explicit = assignment.fieldOrigins?.[key];
        const own = assignment[key];
        const manual =
          explicit === "MANUAL" ||
          explicit === "IMPORTED" ||
          explicit === "CLEARED" ||
          ((key === "hours" ||
            key === "productionHours" ||
            key === "validUntil") &&
            assignment.biotManualFields?.includes(key)) ||
          (!explicit && !!own);
        if (
          event &&
          assignment.protocolMode === "GROUP" &&
          key !== "documentDate" &&
          key !== "validUntil" &&
          !individualCommonFields.has(key) &&
          context.fields[key] !== undefined &&
          manual &&
          (explicit === "CLEARED" ? "" : own) !== context.fields[key]
        )
          issues.push({
            code: "GROUP_COMMON_OVERRIDE",
            path: `${path}.${key}`,
            rowId: item.id,
            message: "Общее поле протокола отличается: выделите другое событие",
          });
        if (manual) {
          value = explicit === "CLEARED" ? "" : own;
          source =
            explicit === "IMPORTED"
              ? "IMPORTED"
              : explicit === "CLEARED"
                ? "CLEARED"
                : "MANUAL";
        } else if (
          explicit === "AUTO" &&
          !isProtectedField(source) &&
          assignment.protocolMode !== "GROUP" &&
          calculatedDateKeys.includes(
            key as (typeof calculatedDateKeys)[number],
          )
        ) {
          source = "AUTO";
        } else if (value === undefined && own) {
          value = own;
          source =
            explicit === "COURSE"
              ? "COURSE"
              : explicit === "AUTO"
                ? key === "validUntil"
                  ? "AUTO"
                  : "PRESET"
                : source;
        }
        if (
          assessmentCommonFields.has(key) &&
          assignment.outcome &&
          assignment.outcome.status !== "PASSED" &&
          !manual
        ) {
          // A shared positive-course statement cannot establish this person's
          // assessment after an explicit failure, absence or pending retake.
          value = "";
          source = "COURSE";
        }
        if (value !== undefined)
          (assignment as unknown as Record<string, unknown>)[key] = value;
        if (source) origins[key] = source;
      }
      if (draft.schemaVersion === 2) {
        const rule =
          assignment.trainingDateRule !== undefined
            ? assignment.trainingDateRule
            : context.fields.trainingDateRule;
        if (
          assignment.protocolMode === "GROUP" &&
          assignment.trainingDateRule !== undefined &&
          JSON.stringify(assignment.trainingDateRule) !==
            JSON.stringify(context.fields.trainingDateRule)
        )
          issues.push({
            code: "GROUP_DATE_RULE_OVERRIDE",
            path: `${path}.trainingDateRule`,
            rowId: item.id,
            message:
              "График участника отличается от общего события. Измените график события или выделите другое событие.",
          });
        const calculation = applyDateCalculation(
          assignment,
          origins,
          rule,
          draft.businessRuleVersion === "LIVE_V1" &&
            event &&
            assignment.protocolMode === "GROUP"
            ? context.fields.documentDate
            : undefined,
          draft.businessRuleVersion !== "LIVE_V1",
        );
        // Metadata is exposed through provenance; keep assignment schema clean.
        delete (assignment as Assignment & { dateOrigins?: unknown })
          .dateOrigins;
        if (rule !== undefined) assignment.trainingDateRule = rule;
        for (const problem of calculation.problemDetails)
          issues.push({
            code: problem.code,
            path: `${path}.${problem.field}`,
            rowId: item.id,
            eventId: assignment.eventId,
            assignmentId: assignment.id,
            field: problem.field,
            message: problem.message,
          });
        for (const problem of trainingBeforeIssueProblems(assignment, rule))
          issues.push({
            code: "TRAINING_BEFORE_DOCUMENT",
            path: `${path}.${problem.field}`,
            rowId: item.id,
            message: problem.message,
          });
      }
      if (assignment.outcome && assignment.outcome.status !== "PASSED") {
        // A saved positive phrase cannot override a later factual failed,
        // absent or unconfirmed state. Do not preserve template sample grades.
        const actualResult = factualAssessmentText(
          assignment.result,
          assignment.fieldOrigins?.result,
        );
        const actualResultKz = factualAssessmentText(
          assignment.resultKz,
          assignment.fieldOrigins?.resultKz,
        );
        assignment.result =
          actualResult ||
          courseResultText(assignment.templateId, assignment.outcome.status);
        assignment.resultKz =
          actualResultKz || nonPassedResultKz(assignment.outcome.status);
        assignment.resultEn = "";
        origins.result = actualResult ? "MANUAL" : "COURSE";
      } else if (
        assignment.outcome?.status === "PASSED" &&
        (!assignment.result.trim() ||
          assignment.fieldOrigins?.result === "COURSE") &&
        !isProtectedField(assignment.fieldOrigins?.result)
      ) {
        assignment.result = courseResultText(assignment.templateId, "PASSED");
        origins.result = "COURSE";
      }
      if (draft.businessRuleVersion === "LIVE_V1") {
        // A simple kit has one issue date until a separate protocol date or
        // schedule is supplied. Resolve it before freezing the print snapshot;
        // the renderer must never reinterpret already issued history.
        if (
          !assignment.protocolDate &&
          !["MANUAL", "IMPORTED", "CLEARED"].includes(
            origins.protocolDate || "",
          )
        ) {
          assignment.protocolDate =
            event && assignment.protocolMode === "GROUP"
              ? context.fields.documentDate || assignment.documentDate
              : assignment.documentDate;
          if (assignment.protocolDate) origins.protocolDate = "AUTO";
        }
        if (!assignment.protocolDate && assignment.documentDate)
          issues.push({
            code: "PROTOCOL_DATE_REQUIRED",
            path: `${path}.protocolDate`,
            rowId: item.id,
            message:
              "Укажите дату протокола или восстановите наследование даты документа",
          });
        if (
          assignment.templateId.endsWith("-protocol") &&
          assignment.protocolDate
        )
          assignment.documentDate = assignment.protocolDate;
        origins.validUntil = applyBusinessValidity(
          assignment,
          employeeCategoryFor(item),
          origins.validUntil,
        ) as FieldSource;
      }
    }
  for (const event of draft.events || []) {
    const context = eventContexts.get(event.id)!;
    if (
      draft.businessRuleVersion === "LIVE_V1" &&
      !context.fields.protocolDate &&
      context.fields.documentDate &&
      !["MANUAL", "IMPORTED", "CLEARED"].includes(
        context.origins.protocolDate || "",
      )
    )
      context.fields.protocolDate = context.fields.documentDate;
    event.commonFields = context.fields;
  }
  return {
    draft,
    provenance,
    issues: issues.map((issue) => stableValidationIssue(draft, issue)),
  };
}

export function documentPlan(draft: Draft) {
  const individuals = draft.items.flatMap((item) =>
    item.assignments
      .filter(
        (a) =>
          a.templateId.endsWith("-protocol") ||
          (draft.businessRuleVersion !== "LIVE_V1" &&
            a.protocolMode !== "GROUP" &&
            !a.outcome) ||
          a.outcome?.status === "PASSED",
      )
      .map((assignment) => ({ item, assignment })),
  );
  const groups = (draft.events || [])
    .map((event) => ({
      event,
      members: draft.items.flatMap((item) =>
        item.assignments
          .filter((a) => a.protocolMode === "GROUP" && a.eventId === event.id)
          .filter(
            (_, index) =>
              draft.businessRuleVersion !== "LIVE_V1" || index === 0,
          )
          .map((assignment) => ({ item, assignment })),
      ),
    }))
    .filter((g) => g.members.length);
  return {
    individuals,
    groups,
    documentCount: individuals.length + groups.length,
  };
}

export function eventProtocolAssignment(
  event: NonNullable<Draft["events"]>[number],
  member: Assignment,
  liveRules = false,
): Assignment {
  // Common context contains calculation metadata that is not an Assignment
  // field. Keep generated protocol payloads compatible with the strict schema.
  const fields = Object.fromEntries(
    commonFieldKeys
      .filter((key) => event.commonFields[key] !== undefined)
      .map((key) => [key, event.commonFields[key]]),
  );
  // LIVE_V1 validity was already resolved from the employee category. A legacy
  // preset in the common event must not overwrite it in the generated form.
  if (liveRules) delete fields.validUntil;
  // These are individual columns in the shared protocol, not its header.
  // The member has already resolved shared defaults and factual exceptions.
  for (const key of individualCommonFields) delete fields[key];
  return {
    ...member,
    ...fields,
    ...(event.commonFields.protocolDate
      ? { documentDate: event.commonFields.protocolDate }
      : {}),
    ...(event.commonFields.trainingDateRule !== undefined
      ? { trainingDateRule: event.commonFields.trainingDateRule }
      : {}),
    id: event.id,
    templateId: event.protocolTemplateId,
    protocolMode: "INDIVIDUAL",
    eventId: event.id,
  };
}
