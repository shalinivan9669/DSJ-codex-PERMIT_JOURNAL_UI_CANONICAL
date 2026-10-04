import assert from "node:assert/strict";
import test from "node:test";
import {
  resolveDraft,
  draftSchema,
  isTechnicalBlankRecipient,
  LIMITS,
} from "@demo/contracts";
import { newAssignment, newRecipient } from "../lib/types";
import { quickGridPaste } from "../lib/grid-paste";
import {
  recipientCourses,
  recipientPositionLabel,
} from "../lib/recipient-course-context";
import {
  editTrainingAssignment,
  restoreTrainingAssignmentField,
} from "../lib/training-assignment-edit";
import { translationReviewIsCurrent } from "../lib/translation-review";
import {
  parseOrganizationPreparation,
  organizationPreparationKey,
} from "../lib/organization-preparation";
import { draftReadiness, trainingOutcomeSummary } from "../lib/draft-readiness";
import { trainingRemovalTarget } from "../lib/training-removal";

const columns = ["fullNameRu", "positionRu", "positionKz"] as const;
test("quick paste accepts only exact empty effective target cells and retains original recipient identities", () => {
  const first = { ...newRecipient(), id: "target" };
  const items = [first];
  const before = structuredClone(items);
  const range = {
    startRow: 0,
    startField: "fullNameRu" as const,
    text: "Тест Вставки\tСлесарь\tСлесарь\nВторой Тест\tМастер\tШебер",
    columns,
  };
  const result = quickGridPaste(items, items, range);
  if (!result.eligible) throw new Error(result.reason);
  assert.equal(result.eligible, true);
  assert.equal(result.preview.items[0].id, "target");
  assert.equal(result.preview.items[1].positionKz, "Шебер");
  assert.equal(result.preview.added, 1);
  assert.deepEqual(items, before);
  assert.equal(
    quickGridPaste(
      items,
      [{ ...first, positionRu: "Подставленная должность" }],
      range,
    ).eligible,
    false,
  );
  assert.equal(
    quickGridPaste([{ ...first, fullNameRu: "Заполненный" }], items, range)
      .eligible,
    false,
  );
  assert.equal(quickGridPaste(items, items, range, true).eligible, false);
  assert.equal(
    quickGridPaste(items, items, { ...range, columns: undefined }).eligible,
    false,
  );
});
test("quick paste requires explicit blank-row decisions and rejects resource overflow without truncation", () => {
  const item = newRecipient();
  assert.equal(
    quickGridPaste([item], [item], {
      startRow: 0,
      startField: "fullNameRu",
      text: "Первый\tПрофессия\n\t\nТретий\tПрофессия",
      columns,
    }).eligible,
    false,
  );
  const rows = Array.from(
    { length: 250 },
    (_, index) => `Получатель ${index}\tРабочий`,
  );
  const allowed = quickGridPaste([], [], {
    startRow: 0,
    startField: "fullNameRu",
    text: rows.join("\n"),
    columns,
  });
  assert.equal(allowed.eligible, true);
  if (allowed.eligible) assert.equal(allowed.preview.items.length, 250);
  assert.throws(
    () =>
      quickGridPaste([], [], {
        startRow: LIMITS.rows - 250,
        startField: "fullNameRu",
        text: [...rows, "Лишний\tРабочий"].join("\n"),
        columns,
      }),
    new RegExp(String(LIMITS.rows)),
  );
  assert.throws(
    () =>
      quickGridPaste([], [], {
        startRow: 0,
        startField: "fullNameRu",
        text: "Первый\tМастер\nВторой",
        columns,
      }),
    /разное количество/,
  );
  assert.throws(
    () =>
      quickGridPaste([], [], {
        startRow: 0,
        startField: "fullNameRu",
        text: `Первый\t${"x".repeat(501)}`,
        columns,
      }),
    /500/,
  );
});
test("course date editors deduplicate the print kit and keep independent course exceptions and outcomes", () => {
  const item = {
    ...newRecipient(),
    fullNameRu: "Два Курса",
    assignments: [
      {
        ...newAssignment("ptm-card"),
        id: "ptm-card",
        eventId: "ptm",
        documentDate: "2026-10-04",
        protocolDate: "2026-10-03",
        fieldOrigins: { protocolDate: "IMPORTED" as const },
        outcome: { status: "PASSED" as const, source: "Ведомость" },
      },
      {
        ...newAssignment("ptm-protocol"),
        id: "ptm-protocol",
        eventId: "ptm",
        protocolDate: "2026-10-03",
        fieldOrigins: { protocolDate: "IMPORTED" as const },
      },
      {
        ...newAssignment("pb-card"),
        id: "pb-card",
        eventId: "pb",
        documentDate: "2026-10-05",
      },
    ],
  };
  assert.equal(recipientCourses(item).length, 2);
  const protocolOnly = recipientCourses({
    ...item,
    assignments: [item.assignments[1]],
  });
  assert.equal(protocolOnly.length, 1);
  assert.equal(protocolOnly[0].protocolOnly, true);
  const next = editTrainingAssignment(
    item,
    "ptm-card",
    { documentDate: "2026-10-06" },
    true,
  );
  assert.equal(next.assignments[0].documentDate, "2026-10-06");
  assert.equal(next.assignments[0].protocolDate, "2026-10-03");
  assert.deepEqual(next.assignments[0].outcome, item.assignments[0].outcome);
  assert.equal(next.assignments[2].documentDate, "2026-10-05");
  const returned = restoreTrainingAssignmentField(
    next,
    "ptm-card",
    "protocolDate",
    true,
  );
  assert.equal(returned.assignments[0].fieldOrigins?.protocolDate, "INHERITED");
  assert.equal(returned.assignments[1].fieldOrigins?.protocolDate, "INHERITED");
  assert.equal(returned.assignments[2].documentDate, "2026-10-05");
});
test("profession and qualification labels follow forms while mixed kits name the shared meaning", () => {
  const item = newRecipient();
  item.assignments = [newAssignment("pb-card")];
  assert.equal(recipientPositionLabel(item), "Должность");
  item.assignments = [newAssignment("ps-card")];
  assert.equal(recipientPositionLabel(item), "Профессия");
  item.assignments.push(newAssignment("ps-witness"));
  assert.equal(recipientPositionLabel(item), "Профессия / квалификация");
  item.assignments.push(newAssignment("ptm-card"));
  assert.equal(
    recipientPositionLabel(item),
    "Должность / профессия / квалификация",
  );
  item.assignments = [newAssignment("ps-protocol")];
  assert.equal(recipientPositionLabel(item), "Профессия / квалификация");
});
test("translation review is invalidated by a newer RU source or manually edited destination", () => {
  const review = { source: "Мастер", destination: "Мой перевод" };
  assert.equal(
    translationReviewIsCurrent(review, "Мастер", "Мой перевод"),
    true,
  );
  assert.equal(
    translationReviewIsCurrent(review, "Инженер", "Мой перевод"),
    false,
  );
  assert.equal(
    translationReviewIsCurrent(review, "Мастер", "Новый ручной перевод"),
    false,
  );
  assert.equal(translationReviewIsCurrent(null, "Мастер", ""), false);
});
test("incomplete company preparation reloads without directory creation and is scoped to tenant, user and request", () => {
  const record = {
    version: 1,
    operationKey: "company-creation-operation",
    names: {
      legalForm: "TOO",
      ownNameRu: "Незавершённая",
      ownNameKz: "",
      nameRu: "ТОО Незавершённая",
      nameKz: "",
    },
  };
  assert.deepEqual(
    parseOrganizationPreparation(JSON.stringify(record)),
    record,
  );
  assert.equal(parseOrganizationPreparation(null), null);
  assert.throws(
    () => parseOrganizationPreparation('{"version":1}'),
    /повреждён/,
  );
  assert.notEqual(
    organizationPreparationKey("tenant-a", "user", "request"),
    organizationPreparationKey("tenant-b", "user", "request"),
  );
  assert.notEqual(
    organizationPreparationKey("tenant", "user-a", "request"),
    organizationPreparationKey("tenant", "user-b", "request"),
  );
});
test("technical spare rows do not produce readiness hints or result reminders but partial rows remain visible", () => {
  const blank = {
    ...newRecipient(),
    assignments: [
      {
        ...newAssignment("pb-card"),
        eventId: "pb",
        outcome: { status: "UNKNOWN" as const, source: "" },
      },
    ],
  };
  assert.equal(isTechnicalBlankRecipient(blank), true);
  const draft = draftSchema.parse({
    kind: "PERSON",
    items: [
      blank,
      {
        ...newRecipient(),
        fullNameRu: "Частичный Получатель",
        assignments: [newAssignment("ptm-card")],
      },
    ],
  });
  const hints = draftReadiness(draft, null, resolveDraft(draft)).fieldHints;
  assert.ok(!Object.keys(hints).some((key) => key.startsWith("items.0.")));
  assert.ok(Object.keys(hints).some((key) => key.startsWith("items.1.")));
  assert.deepEqual(trainingOutcomeSummary({ items: [blank] }), {
    recipients: 0,
    trainings: 0,
  });
  assert.equal(
    isTechnicalBlankRecipient({ ...blank, positionRu: "Частичная профессия" }),
    false,
  );
  assert.equal(
    isTechnicalBlankRecipient({
      ...blank,
      assignments: [
        { ...blank.assignments[0], fieldOrigins: { documentDate: "CLEARED" } },
      ],
    }),
    false,
  );
});
test("automatic course program is removable without warning while manual text and confirmed results stay protected", () => {
  const row = {
    ...newRecipient(),
    fullNameRu: "Тест",
    assignments: [{ ...newAssignment("ptm-card"), eventId: "ptm" }],
  };
  const draft = {
    ...draftSchema.parse({ kind: "PERSON", items: [row] }),
    id: "request",
    revision: 0,
    status: "DRAFT",
  };
  assert.equal(
    trainingRemovalTarget(draft, "PTM", [row.id], false).protected,
    false,
  );
  draft.items[0].assignments[0].fieldOrigins = {
    ...draft.items[0].assignments[0].fieldOrigins,
    trainingSubject: "MANUAL",
  };
  assert.equal(
    trainingRemovalTarget(draft, "PTM", [row.id], false).protected,
    true,
  );
});
