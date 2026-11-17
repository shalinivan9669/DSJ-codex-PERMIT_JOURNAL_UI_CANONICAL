import test from "node:test";
import assert from "node:assert/strict";
import { ruleApplicabilityIssues } from "../apps/api/src/service-rule-applicability";
import {
  applicableProgrammeHours,
  draftSchema,
  programmeApplicability,
  resolveDraft,
} from "../packages/contracts/src";

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

test("programme hours follow the applicable version and event, even when two events pin the same passport", () => {
  const definition = {
    hours: 36,
    programVersion: "2026",
    category: "WORKER",
    compatibleTemplateIds: ["ps-card", "ps-witness", "ps-protocol"],
    requirements: [],
  };
  const approved = {
    id: "ps-1",
    status: "APPROVED",
    checkedOn: "2026-08-01",
    checkedBy: "director",
    source: "Утверждённая программа",
    effectiveTo: "2026-12-31",
    definition,
  };
  const dates = ["2026-11-17", "2027-01-04"];
  const draft = draftSchema.parse({
    kind: "COMPANY",
    schemaVersion: 2,
    businessRuleVersion: "LIVE_V1",
    events: dates.map((protocolDate, i) => ({
      id: "event" + i,
      title: "Слесарное дело",
      protocolTemplateId: "ps-protocol",
      serviceRuleVersionId: approved.id,
      commonFields: { protocolDate },
    })),
    items: dates.map((_, i) => ({
      id: "person" + i,
      fullNameRu: "Слушатель",
      employeeCategory: "WORKER",
      assignments: [
        {
          id: "a" + i,
          templateId: "ps-card",
          eventId: "event" + i,
          protocolMode: "GROUP",
        },
      ],
    })),
  });
  const rows = resolveDraft(draft).draft;
  const programme = applicableProgrammeHours(rows, [approved]);
  assert.deepEqual([...programme], [["event0", "36"]]);
  assert.equal(
    resolveDraft(draft, {}, programme).draft.items[0].assignments[0].hours,
    "36",
  );
  for (const rendition of [
    { ...approved, id: "a-newer-unpinned-version" },
    { ...approved, checkedBy: null },
    { ...approved, status: "DRAFT" },
    { ...approved, definition: { ...definition, hours: undefined } },
    { ...approved, definition: { ...definition, hours: -4 } },
    {
      ...approved,
      definition: { ...definition, compatibleTemplateIds: ["ps-card"] },
    },
  ])
    assert.equal(applicableProgrammeHours(rows, [rendition]).size, 0);
  const individual = structuredClone(rows);
  individual.items[0].employeeCategory = "ITR";
  individual.items[0].assignments[0].protocolMode = "INDIVIDUAL";
  const broadItr = {
    ...approved,
    definition: { ...definition, category: "ITR" },
  };
  assert.deepEqual(
    [...applicableProgrammeHours(individual, [broadItr])],
    [["event0", "36"]],
  );
  assert.ok(
    programmeApplicability(individual, [approved]).issues.some(
      (issue) =>
        issue.rowId === "person0" &&
        issue.assignmentId === "a0" &&
        issue.code === "SERVICE_RULE_CATEGORY_MISMATCH",
    ),
  );
  individual.items[0].assignments[0].templateId = "biot-itr-certificate";
  individual.items[0].assignments[0].biotCategory = "OHS_HEAD_GENERAL";
  assert.deepEqual(
    [
      ...applicableProgrammeHours(individual, [
        {
          ...broadItr,
          definition: {
            ...broadItr.definition,
            compatibleTemplateIds: ["biot-itr-certificate"],
          },
        },
      ]),
    ],
    [["event0", "36"]],
  );
});
