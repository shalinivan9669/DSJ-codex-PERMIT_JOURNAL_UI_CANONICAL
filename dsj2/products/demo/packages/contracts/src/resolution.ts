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
  businessValidUntil,
  employeeCategoryFor,
  trainingDirection,
} from "./business-rules";
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
] as const;
export type FieldSource =
  | "CENTER"
  | "PRESET"
  | "REQUEST"
  | "EVENT"
  | "MANUAL"
  | "IMPORTED"
  | "AUTO"
  | "CLEARED";

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
      if (
        layer[key] === undefined &&
        layer.dateOrigins?.[
          key as keyof NonNullable<CommonFields["dateOrigins"]>
        ] !== "AUTO"
      )
        continue;
      (fields as Record<string, unknown>)[key] = layer[key];
      origins[key] =
        layer.dateOrigins?.[
          key as keyof NonNullable<CommonFields["dateOrigins"]>
        ] || source;
    }
  }
  return { fields, origins };
}

export function resolveCommonDates(
  fields: CommonFields,
  center: CommonFields = {},
  preset: CommonFields = {},
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
  );
  return result.fields;
}

function applyDateCalculation(
  values: CommonFields,
  origins: Record<string, FieldSource>,
  rule?: TrainingDateRule | null,
  eventDocumentDate?: string,
) {
  const calculation = calculateDates(
    eventDocumentDate ? { ...values, documentDate: eventDocumentDate } : values,
    rule,
  );
  for (const key of calculatedDateKeys) {
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
          (!explicit && !!own);
        if (
          event &&
          assignment.protocolMode === "GROUP" &&
          key !== "documentDate" &&
          key !== "validUntil" &&
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
          assignment.protocolMode !== "GROUP" &&
          calculatedDateKeys.includes(
            key as (typeof calculatedDateKeys)[number],
          )
        ) {
          source = "AUTO";
        } else if (value === undefined && own) {
          value = own;
          source = explicit === "AUTO" ? "PRESET" : source;
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
      if (
        event &&
        assignment.protocolMode === "GROUP" &&
        assignment.outcome?.status !== "PASSED" &&
        !assignment.result
      )
        assignment.result = {
          FAILED: "Не сдал",
          ABSENT: "Не явился",
          UNKNOWN: "Не подтверждено",
          PASSED: "",
        }[assignment.outcome?.status || "UNKNOWN"];
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
        const unlimited = trainingDirection(assignment.templateId) === "PS";
        assignment.validityMode = unlimited ? "UNLIMITED" : "FIXED";
        assignment.validUntil = unlimited
          ? ""
          : businessValidUntil(
              assignment.documentDate,
              employeeCategoryFor(item),
            );
        origins.validUntil = "AUTO";
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
          (a.protocolMode !== "GROUP" && !a.outcome) ||
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
