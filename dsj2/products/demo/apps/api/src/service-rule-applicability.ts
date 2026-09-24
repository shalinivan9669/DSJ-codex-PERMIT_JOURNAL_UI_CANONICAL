import { Prisma, type ServiceRuleVersion } from "@demo/database";
import { ruleVersionSchema } from "../../../packages/contracts/src/operator-value";
import { db, type Context } from "./core";

export type RuleApplicability = {
  templateIds: string[];
  category?: string;
  basisDate: string;
};
export type RuleApplicabilityIssue = {
  code: string;
  path: string;
  message: string;
};
export function ruleApplicabilityIssues(
  rule: Pick<
    ServiceRuleVersion,
    | "status"
    | "checkedOn"
    | "checkedBy"
    | "source"
    | "effectiveFrom"
    | "effectiveTo"
    | "definition"
  >,
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
  if (definition.data.category && definition.data.category !== input.category)
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
export async function validatePinnedServiceRule(
  c: Context,
  id: string,
  input: RuleApplicability,
  tx: Prisma.TransactionClient = db,
) {
  const rule = await tx.serviceRuleVersion.findFirst({
    where: { tenantId: c.tenantId, id },
  });
  if (!rule)
    return {
      rule: null,
      issues: [
        {
          code: "SERVICE_RULE_NOT_FOUND",
          path: "serviceRuleVersionId",
          message: "Версия паспорта услуги не найдена в этом центре",
        },
      ],
    };
  return { rule, issues: ruleApplicabilityIssues(rule, input) };
}
