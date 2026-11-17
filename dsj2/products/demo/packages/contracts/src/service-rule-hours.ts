import type { Assignment, Draft } from "./index";
import { BIOT_CATEGORIES } from "./biot";
import { ruleVersionSchema } from "./operator-value";

export type ProgrammeHoursRule = {
  id: string;
  status: string;
  checkedOn?: string | null;
  checkedBy?: string | null;
  source: string;
  effectiveFrom?: string | null;
  effectiveTo?: string | null;
  definition: unknown;
};

export type RuleApplicability = {
  templateIds: string[];
  category?: string;
  employeeCategory?: string;
  basisDate: string;
};
export function serviceRuleCategories(
  member: Pick<Assignment, "biotCategory" | "templateId">,
  item: Pick<Draft["items"][number], "employeeCategory">,
) {
  const category = member.templateId.startsWith("biot-")
    ? member.biotCategory
    : undefined;
  return {
    category,
    employeeCategory:
      item.employeeCategory ||
      (category ? BIOT_CATEGORIES[category].form : undefined),
  };
}
export type RuleApplicabilityIssue = {
  code: string;
  path: string;
  message: string;
};
export function ruleApplicabilityIssues(
  rule: Omit<ProgrammeHoursRule, "id">,
  input: RuleApplicability,
): RuleApplicabilityIssue[] {
  const issues: RuleApplicabilityIssue[] = [];
  const add = (code: string, message: string) =>
    issues.push({ code, path: "serviceRuleVersionId", message });
  if (
    rule.status !== "APPROVED" ||
    !rule.checkedOn ||
    !rule.checkedBy ||
    !rule.source.trim()
  )
    add(
      "SERVICE_RULE_NOT_APPROVED",
      "Паспорт услуги требует подтверждённого источника и проверки уполномоченным сотрудником",
    );
  const definition = ruleVersionSchema.shape.definition.safeParse(
    rule.definition,
  );
  if (!definition.success) {
    add(
      "SERVICE_RULE_INVALID",
      "Версия паспорта не соответствует поддерживаемому контракту",
    );
    return issues;
  }
  for (const templateId of input.templateIds)
    if (!definition.data.compatibleTemplateIds.includes(templateId))
      add(
        "SERVICE_RULE_FORM_MISMATCH",
        `Форма ${templateId} не входит в утверждённый паспорт услуги`,
      );
  const category = definition.data.category;
  const actualCategory =
    category === "WORKER" || category === "ITR"
      ? input.employeeCategory || input.category
      : input.category;
  if (category && category !== actualCategory)
    add(
      "SERVICE_RULE_CATEGORY_MISMATCH",
      "Категория получателя не совпадает с применимостью паспорта услуги",
    );
  if ((rule.effectiveFrom || rule.effectiveTo) && !input.basisDate)
    add(
      "SERVICE_RULE_DATE_REQUIRED",
      "Укажите фактическую дату проверки для периода применимости паспорта",
    );
  if (
    input.basisDate &&
    ((rule.effectiveFrom && input.basisDate < rule.effectiveFrom) ||
      (rule.effectiveTo && input.basisDate > rule.effectiveTo))
  )
    add(
      "SERVICE_RULE_OUTSIDE_PERIOD",
      "Дата проверки выходит за подтверждённый период применимости паспорта",
    );
  return issues;
}

/** Evaluate the pinned version separately for each event, including individual protocols. */
export function programmeApplicability(
  draft: Draft,
  rules: readonly ProgrammeHoursRule[],
) {
  const hours = new Map<string, string>();
  const issues: (RuleApplicabilityIssue & {
    eventId: string;
    rowId?: string;
    assignmentId?: string;
  })[] = [];
  if (!rules.length) return { hours, issues };
  const byId = new Map(rules.map((rule) => [rule.id, rule]));
  const assignments = new Map<
    string,
    { member: Assignment; row: Draft["items"][number] }[]
  >();
  for (const item of draft.items) {
    for (const assignment of item.assignments) {
      if (!assignment.eventId) continue;
      const list = assignments.get(assignment.eventId);
      if (list) list.push({ member: assignment, row: item });
      else
        assignments.set(assignment.eventId, [
          { member: assignment, row: item },
        ]);
    }
  }
  for (const event of draft.events || []) {
    if (!event.serviceRuleVersionId) continue;
    const rule = byId.get(event.serviceRuleVersionId);
    if (!rule) continue;
    const definition = ruleVersionSchema.shape.definition.safeParse(
      rule.definition,
    );
    const members = assignments.get(event.id) || [];
    const checks: (RuleApplicability & {
      rowId?: string;
      assignmentId?: string;
    })[] = members.map(({ member, row }) => ({
      templateIds:
        member.protocolMode === "GROUP"
          ? [member.templateId, event.protocolTemplateId]
          : [member.templateId],
      ...serviceRuleCategories(member, row),
      rowId: row.id,
      assignmentId: member.id,
      basisDate:
        (member.protocolMode === "GROUP" && event.commonFields.protocolDate) ||
        member.protocolDate ||
        member.trainingEnd ||
        "",
    }));
    if (!checks.length) {
      const category =
        event.commonFields.biotCategory || draft.commonFields?.biotCategory;
      checks.push({
        templateIds: [event.protocolTemplateId],
        category,
        employeeCategory: category && BIOT_CATEGORIES[category].form,
        basisDate:
          event.commonFields.protocolDate ||
          draft.commonFields?.protocolDate ||
          event.commonFields.trainingEnd ||
          draft.commonFields?.trainingEnd ||
          "",
      });
    }
    let eligible = true;
    for (const check of checks) {
      const errors = ruleApplicabilityIssues(rule, check);
      if (errors.length) eligible = false;
      if (check.rowId) {
        issues.push(
          ...errors.map((error) => ({
            ...error,
            eventId: event.id,
            rowId: check.rowId,
            assignmentId: check.assignmentId,
            path: `events.${event.id}.serviceRuleVersionId`,
          })),
        );
      }
    }
    if (eligible && definition.success && definition.data.hours !== undefined)
      hours.set(event.id, String(definition.data.hours));
  }
  return { hours, issues };
}

export function applicableProgrammeHours(
  draft: Draft,
  rules: readonly ProgrammeHoursRule[],
) {
  return programmeApplicability(draft, rules).hours;
}
