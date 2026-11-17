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
  normalizeNewDraftLanguages,
  withoutEnglishProvenance,
} from "./document-languages";
import {
  courseProgramDefaults,
  courseResultText,
  isProtectedField,
  nonPassedResultKz,
  positiveResultKz,
  factualAssessmentText,
} from "./course-defaults";
import { applyBusinessValidity, employeeCategoryFor } from "./business-rules";
import { trainingHoursPrograms, trainingHoursRule } from "./training-hours";
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
  "hoursProgram",
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
  | "SERVICE_RULE"
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
  templateId?: string,
) {
  const fields: CommonFields = {};
  const origins: Record<string, FieldSource> = {};
  for (const [layer, source] of layers) {
    if (!layer) continue;
    if (layer.trainingDateRule !== undefined)
      fields.trainingDateRule = layer.trainingDateRule;
    for (const key of commonFieldKeys) {
      const declaredOrigin = layer.fieldOrigins?.[key];
      if (
        templateId &&
        source === "EVENT" &&
        declaredOrigin === "INHERITED" &&
        (key === "hours" || key === "productionHours" || key === "hoursProgram")
      )
        continue;
      if (
        key === "hoursProgram" &&
        templateId &&
        layer.hoursProgram &&
        !trainingHoursPrograms(templateId).some(
          (option) => option.id === layer.hoursProgram,
        )
      )
        continue;
      // A cached estimate on the group must not displace configured program hours.
      if (
        templateId &&
        (key === "hours" || key === "productionHours") &&
        declaredOrigin === "AUTO" &&
        origins[key] &&
        origins[key] !== "AUTO"
      )
        continue;
      const dateOrigin =
        layer.dateOrigins?.[
          key as keyof NonNullable<CommonFields["dateOrigins"]>
        ];
      // A technical blank is no instruction to erase an earlier source. This
      // applies equally to programs, dates, hours and shared profession data.
      // Explicit clears and requests to recalculate a date remain meaningful.
      if (
        isBlankText(layer[key]) &&
        !isProtectedField(declaredOrigin) &&
        !isProtectedField(dateOrigin) &&
        dateOrigin !== "AUTO"
      )
        continue;
      // Previously resolved automatic text must never outrank a newly selected
      // centre/profile or a manual event exception.
      if (declaredOrigin === "COURSE" && origins[key]) continue;
      if (
        layer[key] === undefined &&
        declaredOrigin !== "CLEARED" &&
        dateOrigin !== "CLEARED" &&
        dateOrigin !== "AUTO"
      )
        continue;
      (fields as Record<string, unknown>)[key] =
        declaredOrigin === "CLEARED" || dateOrigin === "CLEARED"
          ? key === "hoursProgram"
            ? undefined
            : ""
          : layer[key];
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

function resolveTrainingHours(
  fields: CommonFields,
  origins: Record<string, FieldSource>,
  templateId: string,
  category: "WORKER" | "ITR" | undefined,
) {
  const rule = trainingHoursRule(templateId, category, fields);
  for (const key of ["hours", "productionHours"] as const) {
    if (origins[key] && origins[key] !== "AUTO" && origins[key] !== "COURSE")
      continue;
    if (rule[key] !== undefined) {
      fields[key] = rule[key];
      origins[key] = "AUTO";
    } else if (origins[key] === "AUTO" || origins[key] === "COURSE") {
      delete fields[key];
      delete origins[key];
    }
  }
}

function inheritCompanionHours(item: RequestItemInput) {
  const courseKey = (a: Assignment) =>
    a.eventId || protocolTemplateFor(a.templateId);
  const primaries = new Map(
    item.assignments
      .filter(
        (a) =>
          !a.templateId.startsWith("lms-") &&
          !a.templateId.endsWith("-protocol") &&
          a.templateId !== "ps-witness",
      )
      .map((a) => [courseKey(a), a]),
  );
  for (const a of item.assignments) {
    const primary = primaries.get(courseKey(a));
    if (a.templateId.startsWith("lms-") || !primary || a === primary) continue;
    for (const key of ["hours", "productionHours", "hoursProgram"] as const) {
      if (a.fieldOrigins?.[key] !== "INHERITED") continue;
      const origin = primary.fieldOrigins?.[key];
      const manualFlag =
        key !== "hoursProgram" && primary.biotManualFields?.includes(key);
      if (isProtectedField(origin) || manualFlag || (!origin && primary[key])) {
        Object.assign(a, { [key]: primary[key] });
        (a.fieldOrigins ??= {})[key] = isProtectedField(origin)
          ? origin!
          : "MANUAL";
      }
    }
  }
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
export function resolveDraft(
  input: Draft,
  center: CommonFields = {},
  programmeHours: ReadonlyMap<string, string> = new Map(),
) {
  if (input.frozenResolution)
    return {
      draft: structuredClone(input.frozenResolution.draft),
      provenance: structuredClone(input.frozenResolution.provenance),
      issues: [] as ValidationIssue[],
    };
  const draft: Draft = structuredClone(input);
  draft.items = draft.items.map(resolveRecipientText);
  const provenance: Record<string, Record<string, FieldSource>> = {};
  const issues: ValidationIssue[] = [];
  const liveHours = draft.businessRuleVersion === "LIVE_V1";
  const eventCategories = new Map<string, Set<"WORKER" | "ITR">>();
  const eventMembers = new Map<string, Assignment[]>();
  for (const item of draft.items) {
    if (liveHours) inheritCompanionHours(item);
    for (const a of item.assignments) {
      const { eventId } = a;
      if (!eventId || a.templateId.startsWith("lms-")) continue;
      const categories =
        eventCategories.get(eventId) || new Set<"WORKER" | "ITR">();
      categories.add(employeeCategoryFor(item));
      eventCategories.set(eventId, categories);
      if (
        !a.templateId.endsWith("-protocol") &&
        a.templateId !== "ps-witness"
      ) {
        const members = eventMembers.get(eventId) || [];
        members.push(a);
        eventMembers.set(eventId, members);
      }
    }
  }
  const eventContexts = new Map(
    (draft.events || []).map((event) => {
      const courseHours =
        liveHours && !event.protocolTemplateId.startsWith("lms-");
      const selectedHours =
        courseHours && event.serviceRuleVersionId
          ? programmeHours.get(event.id)
          : undefined;
      const context = commonContext(
        [
          [courseProgramDefaults(event.protocolTemplateId), "COURSE"],
          [center, "CENTER"],
          [draft.presetFields, "PRESET"],
          [draft.commonFields, "REQUEST"],
          [
            selectedHours ? { hours: selectedHours } : undefined,
            "SERVICE_RULE",
          ],
          [event.commonFields, "EVENT"],
        ],
        courseHours ? event.protocolTemplateId : undefined,
      );
      if (courseHours) {
        const categories = eventCategories.get(event.id);
        const category =
          categories?.size === 1 ? [...categories][0] : undefined;
        resolveTrainingHours(
          context.fields,
          context.origins,
          event.protocolTemplateId,
          category,
        );
        for (const key of ["hours", "productionHours"] as const) {
          if (context.origins[key] === "AUTO")
            (context.fields.fieldOrigins ??= {})[key] = "AUTO";
          else if (
            selectedHours &&
            key === "hours" &&
            context.origins[key] === "SERVICE_RULE"
          )
            (context.fields.fieldOrigins ??= {})[key] = "INHERITED";
          else if (!context.origins[key])
            delete context.fields.fieldOrigins?.[key];
        }
      }
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
      const courseHours =
        liveHours && !assignment.templateId.startsWith("lms-");
      const context =
        eventContexts.get(assignment.eventId || "") ||
        commonContext(
          [
            [courseProgramDefaults(assignment.templateId), "COURSE"],
            [center, "CENTER"],
            [draft.presetFields, "PRESET"],
            [draft.commonFields, "REQUEST"],
          ],
          courseHours ? assignment.templateId : undefined,
        );
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
          !(
            courseHours &&
            (key === "hours" ||
              key === "productionHours" ||
              key === "hoursProgram") &&
            source === "AUTO"
          ) &&
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
          value =
            explicit === "CLEARED"
              ? key === "hoursProgram"
                ? undefined
                : ""
              : own;
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
        } else if (
          value === undefined &&
          own &&
          !(
            courseHours &&
            (key === "hours" || key === "productionHours") &&
            (explicit === "AUTO" ||
              explicit === "INHERITED" ||
              explicit === "COURSE")
          )
        ) {
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
        else if (
          courseHours &&
          (key === "hours" ||
            key === "productionHours" ||
            key === "hoursProgram")
        ) {
          if (key === "hours") assignment.hours = "";
          else delete assignment[key];
        }
        if (source) origins[key] = source;
      }
      if (courseHours) {
        resolveTrainingHours(
          assignment,
          origins,
          assignment.templateId,
          employeeCategoryFor(item),
        );
        assignment.hours ??= "";
        for (const key of [
          "hours",
          "productionHours",
          "hoursProgram",
        ] as const) {
          if (assignment[key] === undefined || !origins[key]) continue;
          if (
            assignment.fieldOrigins?.[key] === "INHERITED" ||
            isProtectedField(assignment.fieldOrigins?.[key])
          )
            continue;
          if (origins[key] === "AUTO")
            (assignment.fieldOrigins ??= {})[key] = "AUTO";
          else if (
            context.origins[key] &&
            !input.items[row].assignments[column][key]
          )
            (assignment.fieldOrigins ??= {})[key] = "INHERITED";
        }
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
        for (const [key, actual, fallback] of [
          [
            "result",
            actualResult,
            courseResultText(assignment.templateId, assignment.outcome.status),
          ],
          [
            "resultKz",
            actualResultKz,
            nonPassedResultKz(assignment.outcome.status),
          ],
        ] as const) {
          const origin = assignment.fieldOrigins?.[key];
          if (
            origin === "CLEARED" ||
            (isProtectedField(origin) && isBlankText(assignment[key]))
          ) {
            assignment[key] = "";
            origins[key] = origin as FieldSource;
          } else {
            assignment[key] = actual || fallback;
            origins[key] = actual
              ? origin === "IMPORTED"
                ? "IMPORTED"
                : "MANUAL"
              : "COURSE";
          }
        }
        if (!isProtectedField(assignment.fieldOrigins?.resultEn))
          assignment.resultEn = "";
      } else if (assignment.outcome?.status === "PASSED") {
        for (const [key, value] of [
          ["result", courseResultText(assignment.templateId, "PASSED")],
          ["resultKz", positiveResultKz(assignment.templateId)],
        ] as const) {
          const origin = assignment.fieldOrigins?.[key];
          if (
            (!assignment[key]?.trim() || origin === "COURSE") &&
            !isProtectedField(origin)
          ) {
            assignment[key] = value;
            origins[key] = "COURSE";
          } else if (isProtectedField(origin)) {
            if (origin === "CLEARED") assignment[key] = "";
            origins[key] = origin as FieldSource;
          }
        }
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
    if (liveHours && !event.protocolTemplateId.startsWith("lms-")) {
      const members = eventMembers.get(event.id) || [];
      for (const key of ["hours", "productionHours"] as const) {
        if (
          !members.length ||
          (context.origins[key] && context.origins[key] !== "AUTO")
        )
          continue;
        const values = new Set(members.map((a) => a[key] || ""));
        const value = values.size === 1 ? members[0][key] : undefined;
        if (value) {
          context.fields[key] = value;
          (context.fields.fieldOrigins ??= {})[key] = "AUTO";
        } else {
          delete context.fields[key];
          delete context.fields.fieldOrigins?.[key];
        }
      }
      if (draft.schemaVersion === 2)
        applyDateCalculation(
          context.fields,
          context.origins,
          context.fields.trainingDateRule,
          undefined,
          false,
        );
    }
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
    draft:
      draft.languagePolicy === "RU_KZ"
        ? normalizeNewDraftLanguages(draft)
        : draft,
    provenance:
      draft.languagePolicy === "RU_KZ"
        ? withoutEnglishProvenance(provenance)
        : provenance,
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
