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
import { eligibleForEvent, joinEventAssignment } from "../lib/event-assignment";
import { newRequestBundle, recipientForRequest } from "../lib/request-bundles";

test("joining an explicitly selected existing form preserves imported/manual/cleared exceptions and rejects existing events or outcomes", () => {
  const imported = {
    ...newAssignment("pb-card"),
    hours: "16",
    trainingSubject: "Manual",
    documentDate: "",
    fieldOrigins: {
      hours: "IMPORTED" as const,
      trainingSubject: "MANUAL" as const,
      documentDate: "CLEARED" as const,
    },
  };
  assert.equal(eligibleForEvent(imported, "pb-card"), true);
  const joined = joinEventAssignment(imported, "event-1");
  assert.equal(joined.id, imported.id);
  assert.equal(joined.hours, "16");
  assert.equal(joined.fieldOrigins?.hours, "IMPORTED");
  assert.equal(joined.fieldOrigins?.documentDate, "CLEARED");
  assert.equal(joined.fieldOrigins?.trainingSubject, "MANUAL");
  assert.equal(joined.fieldOrigins?.trainingStart, "INHERITED");
  assert.equal(eligibleForEvent(joined, "pb-card"), false);
  assert.equal(
    eligibleForEvent({ ...imported, result: "Сдал" }, "pb-card"),
    false,
  );
  assert.equal(
    eligibleForEvent(
      { ...imported, outcome: { status: "FAILED", source: "known" } },
      "pb-card",
    ),
    false,
  );
  assert.equal(
    eligibleForEvent({ ...imported, externalBasisNumber: "OLD-01" }, "pb-card"),
    false,
  );
  assert.equal(eligibleForEvent(imported, "ptm-card"), false);
});

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
  assert.deepEqual(p.items[1].assignments, []);
  assert.equal(p.items[0].assignments, first.assignments);
  assert.equal(first.fullNameKz, "");
  assert.throws(() => parseClipboardRange("a\tb\nc"), /количество ячеек/);
  assert.throws(
    () => previewGridPaste([], 249, "fullNameRu", "a\nb", "EMPTY"),
    /предел/,
  );
});

test("paste preserves all 250 bilingual rows and textual IDs; row 251 is rejected without mutation", () => {
  const rows = Array.from({ length: 250 }, (_, index) =>
    [
      `Слушатель ${index + 1}`,
      `Қатысушы ${index + 1}`,
      "Инженер",
      "Инженер",
      "ТОО Образец",
      "Үлгі ЖШС",
      String(index + 1).padStart(6, "0"),
      `external-${index + 1}`,
    ].join("\t"),
  );
  const first = { ...newRecipient(), fullNameRu: "Сохранённое имя" };
  const result = previewGridPaste(
    [first],
    0,
    "fullNameRu",
    rows.join("\n"),
    "EMPTY",
  );
  assert.equal(result.items.length, 250);
  assert.equal(result.added, 249);
  assert.equal(result.items[0].id, first.id);
  assert.equal(result.items[0].fullNameRu, "Сохранённое имя");
  assert.equal(result.items[249].fullNameKz, "Қатысушы 250");
  assert.equal(result.items[249].personnelNumber, "000250");
  assert.equal(new Set(result.items.map((item) => item.id)).size, 250);
  assert.ok(
    result.items.slice(1).every((item) => item.assignments.length === 0),
  );
  assert.equal(result.items[0].assignments, first.assignments);
  assert.throws(
    () =>
      previewGridPaste(
        [first],
        0,
        "fullNameRu",
        [...rows, rows[0]].join("\n"),
        "EMPTY",
      ),
    /250/,
  );
  assert.equal(first.fullNameRu, "Сохранённое имя");
  assert.equal(first.fullNameKz, "");
});

test("paste follows visible RU-only columns without overwriting hidden KZ fields", () => {
  const person = {
    ...newRecipient(),
    fullNameKz: "Қатысушы",
    positionKz: "Маман",
    workplaceKz: "Үлгі ЖШС",
  };
  const result = previewGridPaste(
    [person],
    0,
    "fullNameRu",
    "Иванов Иван\tИнженер\tТОО Образец",
    "REPLACE",
    ["fullNameRu", "positionRu", "workplaceRu"],
  );
  assert.equal(result.items[0].fullNameRu, "Иванов Иван");
  assert.equal(result.items[0].positionRu, "Инженер");
  assert.equal(result.items[0].workplaceRu, "ТОО Образец");
  assert.equal(result.items[0].fullNameKz, person.fullNameKz);
  assert.equal(result.items[0].positionKz, person.positionKz);
  assert.equal(result.items[0].workplaceKz, person.workplaceKz);
  assert.deepEqual(
    result.changes.map((change) => change.field),
    ["fullNameRu", "positionRu", "workplaceRu"],
  );
  const paired = previewGridPaste(
    [],
    0,
    "fullNameRu",
    "Иванов Иван\tҚатысушы\tИнженер\tМаман",
    "EMPTY",
    ["fullNameRu", "fullNameKz", "positionRu", "positionKz"],
  );
  assert.equal(paired.items[0].fullNameKz, "Қатысушы");
  assert.equal(paired.items[0].positionRu, "Инженер");
  assert.equal(paired.items[0].positionKz, "Маман");
});

test("pasted rows choose no document implicitly, while an explicit bundle can join only the new rows", () => {
  const bundle = newRequestBundle("ITR");
  const original = {
    ...newRecipient(),
    assignments: [
      {
        ...newAssignment("pb-card"),
        documentDate: "2026-08-14",
        hours: "32",
        fieldOrigins: {
          documentDate: "MANUAL" as const,
          hours: "IMPORTED" as const,
        },
      },
    ],
  };
  const result = previewGridPaste(
    [original],
    0,
    "fullNameRu",
    "Существующий\nНовый",
    "REPLACE",
    ["fullNameRu"],
  );
  assert.equal(result.items[0].assignments, original.assignments);
  assert.equal(result.items[0].assignments[0].documentDate, "2026-08-14");
  assert.equal(result.items[0].assignments[0].hours, "32");
  assert.deepEqual(result.items[1].assignments, []);
  const joined = recipientForRequest(bundle, result.items[1]);
  assert.equal(joined.fullNameRu, "Новый");
  assert.equal(joined.assignments.length, 1);
  assert.equal(joined.assignments[0].templateId, "biot-itr-certificate");
  assert.equal(joined.assignments[0].eventId, bundle.events[0].id);
  assert.equal(joined.assignments[0].outcome?.status, "UNKNOWN");
  assert.deepEqual(result.items[1].assignments, []);
});
