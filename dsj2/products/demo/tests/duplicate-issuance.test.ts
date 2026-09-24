import test from "node:test";
import assert from "node:assert/strict";
import {
  draftSchema,
  assignmentSchema,
  itemSchema,
} from "../packages/contracts/src";
import {
  findDuplicateIssuances,
  sameHistoricalTraining,
} from "../apps/api/src/duplicate-issuance";

test("duplicate warning requires persistent identity, actual date and program; same name is never enough", () => {
  const assignment = assignmentSchema.parse({
    id: "a",
    templateId: "biot-worker-card",
    trainingSubject: "Проверенная программа",
    protocolDate: "2026-09-22",
    biotCategory: "WORKER",
  });
  const source = draftSchema.parse({
    kind: "PERSON",
    items: [
      itemSchema.parse({
        id: "row",
        fullNameRu: "Одинаковая Фамилия",
        recipientId: "person-1",
        assignments: [assignment],
      }),
    ],
  });
  const doc = {
    id: "doc",
    requestId: "old-request",
    issuanceId: "issuance",
    rowId: "row",
    assignmentId: "a",
    templateId: "biot-worker-card",
    number: "BIOT-001",
    documentDate: "2026-09-22",
    groupEventId: null,
  };
  const history = [
    {
      id: "issuance",
      requestId: "old-request",
      snapshot: { draft: source },
      events: [],
    },
  ];
  const current = draftSchema.parse({
    ...source,
    items: [
      {
        ...source.items[0],
        id: "new-row",
        assignments: [{ ...assignment, id: "new-a" }],
      },
    ],
  });
  const warnings = findDuplicateIssuances(current, history, [doc]);
  assert.equal(warnings.length, 1);
  assert.equal(warnings[0].rowId, "new-row");
  assert.equal(warnings[0].candidates[0].number, "BIOT-001");
  assert.equal(warnings[0].candidates[0].historyPath, "/requests/old-request");
  assert.deepEqual(
    findDuplicateIssuances(
      { ...current, items: [{ ...current.items[0], recipientId: "person-2" }] },
      history,
      [doc],
    ),
    [],
  );
  assert.deepEqual(
    findDuplicateIssuances(
      { ...current, items: [{ ...current.items[0], recipientId: undefined }] },
      history,
      [doc],
    ),
    [],
  );
  assert.equal(
    sameHistoricalTraining(assignment, {
      ...assignment,
      protocolDate: "2026-10-01",
    }),
    false,
  );
  assert.equal(
    sameHistoricalTraining(
      { ...assignment, protocolDate: "" },
      { ...assignment, protocolDate: "" },
    ),
    false,
  );
  assert.equal(
    sameHistoricalTraining(assignment, {
      ...assignment,
      trainingSubject: "Другая программа",
    }),
    false,
  );
  assert.equal(
    findDuplicateIssuances(
      current,
      [{ ...history[0], events: ["CANCELLED"] }],
      [doc],
    )[0].candidates[0].status,
    "CANCELLED",
  );
});
