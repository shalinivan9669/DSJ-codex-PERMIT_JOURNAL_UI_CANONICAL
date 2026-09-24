import type { Assignment, CommonFields, Draft, ValidationIssue } from "./index";
import { protocolTemplateFor, validDate, biotValidUntil } from "./index";

export const commonFieldKeys = [
  "documentDate",
  "trainingStart",
  "trainingEnd",
  "protocolDate",
  "validUntil",
  "trainingSubject",
  "reason",
  "education",
  "externalBasisNumber",
  "hours",
  "productionHours",
  "biotCategory",
  "biotCheckType",
  "biotIndustryRu",
  "biotIndustryKz",
] as const;
export type FieldSource =
  | "CENTER"
  | "PRESET"
  | "REQUEST"
  | "EVENT"
  | "MANUAL"
  | "IMPORTED"
  | "CLEARED";

/** Resolves once on the server. Result/identity/number can never be inherited. */
export function resolveDraft(input: Draft, center: CommonFields = {}) {
  const draft: Draft = structuredClone(input);
  const provenance: Record<string, Record<string, FieldSource>> = {};
  const issues: ValidationIssue[] = [];
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
      const origins: Record<string, FieldSource> = {};
      provenance[`${item.id}:${assignment.id}`] = origins;
      const event = draft.events?.find((e) => e.id === assignment.eventId);
      if (
        assignment.protocolMode === "GROUP" &&
        (!event ||
          event.protocolTemplateId !==
            protocolTemplateFor(assignment.templateId) ||
          assignment.templateId.endsWith("-protocol"))
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
        let value: string | undefined;
        let source: FieldSource | undefined;
        for (const [layer, name] of [
          [center, "CENTER"],
          [draft.presetFields, "PRESET"],
          [draft.commonFields, "REQUEST"],
          [event?.commonFields, "EVENT"],
        ] as const) {
          if (layer?.[key] !== undefined) {
            value = layer[key];
            source = name;
          }
        }
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
          event.commonFields[key] !== undefined &&
          manual &&
          (explicit === "CLEARED" ? "" : own) !== event.commonFields[key]
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
        }
        if (value !== undefined)
          (assignment as unknown as Record<string, unknown>)[key] = value;
        if (source) origins[key] = source;
      }
      // Reuse the existing explicit BIOT category policy after date inheritance.
      // A saved/imported/cleared expiry always wins; legacy drafts retain their
      // former validation. This proposes no training date or successful result.
      if (
        draft.schemaVersion === 2 &&
        assignment.templateId.startsWith("biot-") &&
        !assignment.templateId.endsWith("-protocol") &&
        assignment.biotCategory &&
        validDate(assignment.documentDate) &&
        !assignment.validUntil &&
        !origins.validUntil
      ) {
        const until = biotValidUntil(
          assignment.documentDate,
          assignment.biotCategory,
        );
        if (until) {
          assignment.validUntil = until;
          origins.validUntil = "PRESET";
        }
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
    }
  return { draft, provenance, issues };
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
): Assignment {
  return {
    ...member,
    ...event.commonFields,
    id: event.id,
    templateId: event.protocolTemplateId,
    protocolMode: "INDIVIDUAL",
    eventId: event.id,
  };
}
