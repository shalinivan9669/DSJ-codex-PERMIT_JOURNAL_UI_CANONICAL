import test from "node:test";
import assert from "node:assert/strict";
import { ruleApplicabilityIssues } from "../apps/api/src/service-rule-applicability";

test("pinned service rule requires approved evidence, compatible form/category and actual date in applicability period", () => {
  const rule = {
    status: "APPROVED",
    checkedOn: "2026-09-01",
    checkedBy: "authorized-user",
    source: "Проверенный источник",
    effectiveFrom: "2026-09-01",
    effectiveTo: "2026-12-31",
    definition: {
      programVersion: "1",
      category: "WORKER",
      compatibleTemplateIds: ["biot-worker-card", "biot-protocol"],
      requirements: [],
    },
  };
  const input = {
    templateIds: ["biot-worker-card", "biot-protocol"],
    category: "WORKER",
    basisDate: "2026-09-24",
  };
  assert.deepEqual(ruleApplicabilityIssues(rule, input), []);
  assert.ok(
    ruleApplicabilityIssues({ ...rule, status: "DRAFT" }, input).some(
      (issue) => issue.code === "SERVICE_RULE_NOT_APPROVED",
    ),
  );
  assert.ok(
    ruleApplicabilityIssues(rule, { ...input, templateIds: ["ps-card"] }).some(
      (issue) => issue.code === "SERVICE_RULE_FORM_MISMATCH",
    ),
  );
  assert.ok(
    ruleApplicabilityIssues(rule, { ...input, category: "ITR" }).some(
      (issue) => issue.code === "SERVICE_RULE_CATEGORY_MISMATCH",
    ),
  );
  assert.ok(
    ruleApplicabilityIssues(rule, { ...input, basisDate: "" }).some(
      (issue) => issue.code === "SERVICE_RULE_DATE_REQUIRED",
    ),
  );
  assert.ok(
    ruleApplicabilityIssues(rule, { ...input, basisDate: "2027-01-01" }).some(
      (issue) => issue.code === "SERVICE_RULE_OUTSIDE_PERIOD",
    ),
  );
});
