import test from "node:test";
import assert from "node:assert/strict";
import {
  draftSchema,
  itemSchema,
  assignmentSchema,
  selectAssignmentScope,
  isTechnicalBlankRecipient,
  approvalScopeValue,
} from "../packages/contracts/src";
function fixture() {
  return draftSchema.parse({
    kind: "PERSON",
    schemaVersion: 2,
    events: [
      {
        id: "pb",
        title: "ПБ",
        protocolTemplateId: "pb-protocol",
        commonFields: {},
      },
      {
        id: "ptm",
        title: "ПТМ",
        protocolTemplateId: "ptm-protocol",
        commonFields: {},
      },
    ],
    items: Array.from({ length: 3 }, (_, i) => ({
      id: `r${i}`,
      fullNameRu: `Человек ${i}`,
      assignments: [
        {
          id: "pb-card",
          templateId: "pb-card",
          eventId: "pb",
          protocolMode: "GROUP",
          outcome: { status: "PASSED", source: "Ведомость" },
        },
        {
          id: "ptm-card",
          templateId: "ptm-card",
          eventId: "ptm",
          protocolMode: "GROUP",
          outcome: { status: "UNKNOWN", source: "" },
        },
      ],
    })),
  });
}
test("batch scope selects actual person/course without waiting people's unrelated data", () => {
  const draft = fixture();
  const selected = selectAssignmentScope(draft, [
    { rowId: "r1", assignmentId: "pb-card" },
  ]);
  assert.equal(selected.draft.items.length, 1);
  assert.deepEqual(
    selected.draft.items[0].assignments.map((a) => a.templateId),
    ["pb-card"],
  );
  assert.deepEqual(
    selected.draft.events?.map((e) => e.id),
    ["pb"],
  );
  assert.throws(
    () =>
      selectAssignmentScope(
        draft,
        [{ rowId: "r1", assignmentId: "pb-card" }],
        selected.assignments,
      ),
    /ALREADY_ISSUED/,
  );
  assert.throws(
    () =>
      selectAssignmentScope(draft, [{ rowId: "r1", assignmentId: "other" }]),
    /SELECTION_INVALID/,
  );
});
test("linked individual forms expand within the same course and not another course", () => {
  const draft = draftSchema.parse({
    kind: "PERSON",
    items: [
      {
        id: "r",
        fullNameRu: "Получатель",
        assignments: [
          { id: "card", templateId: "ptm-card" },
          { id: "protocol", templateId: "ptm-protocol" },
          { id: "pb", templateId: "pb-card" },
        ],
      },
    ],
  });
  assert.deepEqual(
    selectAssignmentScope(draft, [
      { rowId: "r", assignmentId: "card" },
    ]).assignments.map((a) => a.assignmentId),
    ["card", "protocol"],
  );
});
test("scope approval survives reorder/unselected changes and invalidates selected print changes", () => {
  const draft = fixture(),
    keys = [{ rowId: "r1", assignmentId: "pb-card" }];
  const initial = approvalScopeValue(draft, keys);
  draft.items[0].positionRu = "Изменилось ожидание";
  draft.items.reverse();
  draft.title = "Другое название";
  assert.deepEqual(approvalScopeValue(draft, keys), initial);
  draft.items.find((i) => i.id === "r1")!.positionRu = "Новая должность";
  assert.notDeepEqual(approvalScopeValue(draft, keys), initial);
});
test("technical reserve row ignores automatic course kit but retains facts, photo and saved people", () => {
  const blank = itemSchema.parse({
    id: "blank",
    assignments: [
      assignmentSchema.parse({
        id: "card",
        templateId: "ptm-card",
        trainingSubject: "Стандартная программа",
        hours: "16",
        documentDate: "2026-10-04",
        fieldOrigins: { trainingSubject: "COURSE", documentDate: "INHERITED" },
      }),
    ],
  });
  assert.equal(isTechnicalBlankRecipient(blank), true);
  for (const variant of [
    { ...blank, fullNameRu: "А" },
    { ...blank, photoAssetId: "photo" },
    { ...blank, recipientId: "saved" },
    {
      ...blank,
      assignments: [{ ...blank.assignments[0], resultKz: "Нақты нәтиже" }],
    },
    {
      ...blank,
      assignments: [
        {
          ...blank.assignments[0],
          fieldOrigins: { protocolDate: "MANUAL" as const },
        },
      ],
    },
    {
      ...blank,
      assignments: [
        {
          ...blank.assignments[0],
          outcome: { status: "FAILED" as const, source: "Ведомость" },
        },
      ],
    },
  ])
    assert.equal(isTechnicalBlankRecipient(variant), false);
});
