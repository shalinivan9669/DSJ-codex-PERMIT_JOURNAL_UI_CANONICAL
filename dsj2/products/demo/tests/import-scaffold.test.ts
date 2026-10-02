import test from "node:test";
import assert from "node:assert/strict";
import {
  draftSchema,
  initialImportScaffoldId,
  itemSchema,
} from "../packages/contracts/src";

const starter = itemSchema.parse({ id: "starter", employeeCategory: "WORKER" });
const draft = {
  ...draftSchema.parse({
    kind: "COMPANY",
    schemaVersion: 2,
    businessRuleVersion: "LIVE_V1",
    items: [starter],
  }),
  approvedRevision: 0,
};

test("only the sole empty starter of a never-approved live draft can be replaced", () => {
  assert.equal(initialImportScaffoldId(draft), "starter");
  for (const change of [
    { approvedRevision: 1 },
    { approvedRevision: undefined },
    { schemaVersion: undefined },
    { businessRuleVersion: undefined },
    { items: [] },
    { items: [starter, { ...starter, id: "second" }] },
  ])
    assert.equal(initialImportScaffoldId({ ...draft, ...change }), undefined);
});

test("personal data, exceptions, import provenance, assignments and explicit extra fields are retained", () => {
  for (const change of [
    { fullNameRu: " " },
    { fullNameKz: "Аты" },
    { positionRu: "Инженер" },
    { workplaceKz: "Ұйым" },
    { employeeCategory: "ITR" as const },
    { photoAssetId: "photo" },
    { fullNameEn: "" },
    { employerBin: "" },
    { personnelNumber: "000001" },
    { importId: "batch" },
    { sourceRow: 2 },
    { externalId: "external" },
    { recipientId: "recipient" },
    { employerId: "employer" },
    { employmentPeriod: "" },
    { sourceOrder: 0 },
    { departmentRu: "" },
    { assignments: [{ id: "assignment", templateId: "ptm-card" as const }] },
  ]) {
    const item = itemSchema.parse({ ...starter, ...change });
    assert.equal(
      initialImportScaffoldId({ ...draft, items: [item] }),
      undefined,
      JSON.stringify(change),
    );
  }
  const withEvent = draftSchema.parse({
    kind: "COMPANY",
    schemaVersion: 2,
    businessRuleVersion: "LIVE_V1",
    items: [starter],
    events: [
      {
        id: "event",
        title: "Группа",
        protocolTemplateId: "ptm-protocol",
        commonFields: {},
      },
    ],
  });
  assert.equal(
    initialImportScaffoldId({ ...withEvent, approvedRevision: 0 }),
    undefined,
  );
});
