import test from "node:test";
import assert from "node:assert/strict";
import { previewBulk } from "../lib/bulk-edit";
import { newAssignment, newRecipient, draftPayload } from "../lib/types";
import { updateAssignment } from "../lib/assignment-presets";
import { inferMapping, mapImportRow } from "../lib/imports";
import { kztToMinor, minorToKzt } from "../lib/money";
import { resolveDraft } from "@demo/contracts";
import { parseClipboardRange, previewGridPaste } from "../lib/grid-paste";
import { textQualityHints } from "../lib/text-quality";

test("text quality identifies mixed-script tokens and hidden marks without rewriting valid Kazakh or foreign names", () => {
  assert.equal(
    textQualityHints("Ә Ғ Қ Ң Ө Ұ Ү Һ І Иванов John Smith").length,
    0,
  );
  assert.equal(textQualityHints("Ивaнов").length, 1);
  const hidden = "Әли\u200B Қасымұлы";
  assert.equal(textQualityHints(hidden).length, 1);
  assert.equal(hidden, "Әли\u200B Қасымұлы");
});

test("inherited bulk mask preserves manual, imported, cleared and unselected values; empty mode uses effective values", () => {
  const assignments = (
    ["INHERITED", "MANUAL", "IMPORTED", "CLEARED"] as const
  ).map((source, index) => ({
    ...newAssignment("pb-card"),
    id: `origin-${index}`,
    trainingSubject: source === "CLEARED" ? "" : "Same text",
    fieldOrigins: { trainingSubject: source },
  }));
  const person = { ...newRecipient(), id: "one", assignments };
  const other = {
    ...newRecipient(),
    id: "two",
    assignments: [{ ...assignments[0], id: "other" }],
  };
  const preview = previewBulk(
    [person, other],
    ["one"],
    "pb",
    { trainingSubject: "New inherited subset" },
    "INHERITED",
  );
  assert.equal(preview.changes.length, 1);
  assert.equal(
    preview.items[0].assignments[0].trainingSubject,
    "New inherited subset",
  );
  assert.deepEqual(preview.items[0].assignments.slice(1), assignments.slice(1));
  assert.deepEqual(preview.items[1], other);
  const raw = {
    ...person,
    assignments: [{ ...assignments[0], trainingSubject: "" }],
  };
  const effective = {
    ...person,
    assignments: [{ ...assignments[0], trainingSubject: "Shared source" }],
  };
  assert.equal(
    previewBulk(
      [raw],
      ["one"],
      "pb",
      { trainingSubject: "Must not replace" },
      "EMPTY",
      [effective],
    ).changes.length,
    0,
  );
});

test("bulk preview limits explicit recipient and direction, preserves filled values and all outcomes", () => {
  const first = {
    ...newRecipient(),
    id: "first",
    fullNameRu: "Первый",
    assignments: [
      {
        ...newAssignment("pb-card"),
        id: "pb-1",
        result: "Подтверждён отдельно",
      },
      { ...newAssignment("ptm-card"), id: "ptm-1" },
    ],
  };
  const second = {
    ...newRecipient(),
    id: "second",
    assignments: [
      { ...newAssignment("pb-card"), id: "pb-2", documentDate: "2026-01-01" },
    ],
  };
  const outside = {
    ...newRecipient(),
    id: "outside",
    assignments: [{ ...newAssignment("pb-card"), id: "pb-3" }],
  };
  const result = previewBulk(
    [first, second, outside],
    ["first", "second"],
    "pb",
    { documentDate: "2026-09-24" },
    "EMPTY",
  );
  assert.equal(result.people, 1);
  assert.equal(result.assignments, 1);
  assert.equal(result.skipped, 1);
  assert.equal(result.items[0].assignments[0].documentDate, "2026-09-24");
  assert.equal(result.items[0].assignments[0].result, "Подтверждён отдельно");
  assert.equal(result.items[0].assignments[1].documentDate, "");
  assert.equal(result.items[1].assignments[0].documentDate, "2026-01-01");
  assert.equal(result.items[2].assignments[0].documentDate, "");
  assert.equal(first.assignments[0].documentDate, "");
});
test("explicit blank is recorded as cleared and does not restore an inherited value", () => {
  const assignment = updateAssignment(newAssignment("pb-card"), {
    documentDate: "",
  });
  assert.equal(assignment.fieldOrigins?.documentDate, "CLEARED");
  const draft = {
    kind: "PERSON" as const,
    title: "Clear",
    customerId: null,
    demoMode: false,
    commonFields: { documentDate: "2026-09-24" },
    items: [{ ...newRecipient(), assignments: [assignment] }],
  };
  assert.equal(
    resolveDraft(draft).draft.items[0].assignments[0].documentDate,
    "",
  );
  const restored = {
    ...assignment,
    fieldOrigins: { documentDate: "INHERITED" as const },
  };
  assert.equal(
    resolveDraft({
      ...draft,
      items: [{ ...draft.items[0], assignments: [restored] }],
    }).draft.items[0].assignments[0].documentDate,
    "2026-09-24",
  );
});
test("typing a value equal to the default remains manual after common values change", () => {
  const assignment = updateAssignment(newAssignment("pb-card"), {
    documentDate: "2026-09-24",
  });
  const draft = {
    kind: "PERSON" as const,
    title: "Manual",
    customerId: null,
    demoMode: false,
    commonFields: { documentDate: "2026-09-25" },
    items: [{ ...newRecipient(), assignments: [assignment] }],
  };
  assert.equal(
    resolveDraft(draft).draft.items[0].assignments[0].documentDate,
    "2026-09-24",
  );
});
test("autosave draft payload retains versioned event and inherited context", () => {
  const value = {
    id: "r",
    revision: 3,
    status: "DRAFT",
    kind: "PERSON" as const,
    title: "Context",
    customerId: null,
    demoMode: false,
    items: [],
    schemaVersion: 2 as const,
    profileVersionId: "profile",
    commonFields: { documentDate: "2026-09-24" },
    events: [
      {
        id: "event",
        title: "PB",
        protocolTemplateId: "pb-protocol" as const,
        revision: 2,
        commonFields: { trainingSubject: "Фактическая программа" },
      },
    ],
  };
  assert.deepEqual(draftPayload(value).events, value.events);
  assert.equal(draftPayload(value).profileVersionId, "profile");
});
test("revised fixture stable external identity and personnel leading zeros survive column mapping", () => {
  const columns = ["externalPersonKey", "Табельный номер", "ФИО RU"];
  const mapping = inferMapping(columns);
  assert.deepEqual(mapping, ["externalId", "personnelNumber", "fullNameRu"]);
  const row = mapImportRow(
    { importId: "batch", columns, rows: [], total: 1 },
    { sourceRow: 2, values: ["person-001", "000007", "Синтетический"] },
    mapping,
    "pb-card",
  );
  assert.equal(row.externalId, "person-001");
  assert.equal(row.personnelNumber, "000007");
});
test("money conversion preserves decimal minor units and rejects sub-tiyn precision", () => {
  assert.equal(kztToMinor("12 345,67"), "1234567");
  assert.equal(kztToMinor("0.01"), "1");
  assert.equal(minorToKzt("1234567"), "12345,67");
  assert.throws(() => kztToMinor("1.999"));
  assert.throws(() => kztToMinor("1e3"));
});
test("rectangular clipboard handles quoted tabs, multiline values, Unicode and textual IDs", () => {
  assert.deepEqual(
    parseClipboardRange(
      '"О\'Коннор\tӘ"\t"Строка 1\nСтрока 2"\r\nИванов\t00007\r\n',
    ),
    [
      ["О'Коннор\tӘ", "Строка 1\nСтрока 2"],
      ["Иванов", "00007"],
    ],
  );
  const first = { ...newRecipient(), fullNameRu: "Сохранённое имя" };
  const p = previewGridPaste(
    [first],
    0,
    "fullNameRu",
    "Новая строка\tҚазақша\nВторая строка\tЕкінші",
    "EMPTY",
  );
  assert.equal(p.items[0].fullNameRu, "Сохранённое имя");
  assert.equal(p.items[0].fullNameKz, "Қазақша");
  assert.equal(p.added, 1);
  assert.equal(p.items[1].fullNameRu, "Вторая строка");
  assert.equal(first.fullNameKz, "");
  assert.throws(() => parseClipboardRange("a\tb\nc"), /количество ячеек/);
  assert.throws(
    () => previewGridPaste([], 99, "fullNameRu", "a\nb", "EMPTY"),
    /предел/,
  );
});
