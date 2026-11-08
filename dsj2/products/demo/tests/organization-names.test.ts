import test from "node:test";
import assert from "node:assert/strict";
import {
  customerSchema,
  formatOrganizationNames,
  itemSchema,
  draftSchema,
  organizationOwnName,
} from "../packages/contracts/src";

test("explicit DSJ organization forms use RU prefixes and KZ suffixes without translating proper names", () => {
  for (const [legalForm, ru, kz] of [
    ["TOO", "ТОО", "ЖШС"],
    ["IP", "ИП", "ЖК"],
    ["AO", "АО", "АҚ"],
  ] as const) {
    const saved = customerSchema.parse({
      legalForm,
      ownNameRu: "«Әділ Құрылыс»",
    });
    assert.equal(saved.nameRu, `${ru} «Әділ Құрылыс»`);
    assert.equal(saved.nameKz, `«Әділ Құрылыс» ${kz}`);
    assert.equal(saved.ownNameKz, "");
    assert.deepEqual(customerSchema.parse(saved), saved);
  }
});

test("separate KZ proper name overrides only the shared name and server ignores fabricated generated labels", () => {
  const saved = customerSchema.parse({
    legalForm: "TOO",
    ownNameRu: "«Северный центр»",
    ownNameKz: "«Солтүстік орталығы»",
    nameRu: "Несогласованная строка",
    nameKz: "ТОО-ЖШС неправильная строка",
  });
  assert.equal(saved.nameRu, "ТОО «Северный центр»");
  assert.equal(saved.nameKz, "«Солтүстік орталығы» ЖШС");
});

test("a selected form recognizes only its own separate edge designation and never doubles it", () => {
  for (const source of [
    "ТОО «Алма»",
    "«Алма» ЖШС",
    "ТОО «Алма» ЖШС",
    "ТОО\u00a0«Алма»",
    "тоо «Алма»",
  ]) {
    const saved = customerSchema.parse({ legalForm: "TOO", ownNameRu: source });
    assert.equal(saved.nameRu, "ТОО «Алма»");
    assert.equal(saved.nameKz, "«Алма» ЖШС");
    assert.equal(saved.ownNameRu, "«Алма»");
  }
});

test("no legal form is inferred from legacy names, importer strings or the no-form option", () => {
  for (const nameRu of [
    "ТОО Север",
    "ИП Асан",
    "ТОО-ЖШС Север",
    "ТОО ТОО Север",
    "АО 'ИП и сыновья'",
  ]) {
    const legacy = customerSchema.parse({
      nameRu,
      nameKz: "  Исходная строка  ",
    });
    assert.equal(legacy.nameRu, nameRu);
    assert.equal(legacy.nameKz, "  Исходная строка  ");
    assert.equal(legacy.legalForm, undefined);
    const explicit = customerSchema.parse({
      legalForm: "NONE",
      ownNameRu: nameRu,
    });
    assert.equal(explicit.nameRu, nameRu);
    assert.equal(explicit.nameKz, nameRu);
    const imported = itemSchema.parse({
      id: "source-row",
      workplaceRu: nameRu,
      workplaceKz: "Бастапқы жол",
    });
    assert.equal(imported.workplaceRu, nameRu);
    assert.equal(imported.workplaceKz, "Бастапқы жол");
  }
});

test("conflicting, combined and repeated edge forms require clarification and do not silently erase the source", () => {
  for (const source of [
    "ИП Север",
    "ТОО-ЖШС Север",
    "ТОО / ЖШС Север",
    "ТОО ТОО Север",
    "ТОО",
    "Север АҚ",
  ]) {
    const name = organizationOwnName(source, "TOO");
    assert.equal(name.value, source);
    assert.ok(name.issue);
    assert.equal(
      customerSchema.safeParse({ legalForm: "TOO", ownNameRu: source }).success,
      false,
    );
    assert.equal(customerSchema.parse({ nameRu: source }).nameRu, source);
  }
});

test("legal-form-looking fragments inside the proper name remain intact", () => {
  for (const ownNameRu of [
    "ТОО-сервис",
    "ИПотека",
    "«ИП Асан»",
    "Центр ТОО Север",
    "ЖШСервис",
    "Құрылыс ӘҒҚҢӨҰҮҺІ",
  ]) {
    const saved = customerSchema.parse({ legalForm: "TOO", ownNameRu });
    assert.equal(saved.ownNameRu, ownNameRu);
    assert.equal(saved.nameRu, `ТОО ${ownNameRu}`);
    assert.equal(saved.nameKz, `${ownNameRu} ЖШС`);
  }
});

test("name contract rejects unknown forms, unnamed organizations and overflow after formatting", () => {
  for (const input of [
    { legalForm: "LLC", ownNameRu: "Center" },
    { legalForm: "TOO", ownNameRu: " " },
    { legalForm: "TOO", ownNameRu: "А".repeat(500) },
    { ownNameRu: "Имя без выбранной формы" },
    { nameRu: "   " },
  ])
    assert.equal(customerSchema.safeParse(input).success, false);
  assert.equal(formatOrganizationNames("TOO", "").nameRu, "");
  assert.equal(formatOrganizationNames("TOO", "").nameKz, "");
});

test("optional workplace naming survives draft JSON without changing full names or legacy rows", () => {
  const legacy = itemSchema.parse({
    id: "legacy",
    workplaceRu: "ИП/ЖК как импортировано",
    workplaceKz: "  Бастапқы жол  ",
  });
  const hint = {
    version: 1,
    legalForm: "IP",
    ownNameRu: "Северный сервис",
    ownNameKz: "Солтүстік қызмет",
  };
  const item = itemSchema.parse({
    id: "person",
    workplaceRu: "ИП Северный сервис",
    workplaceKz: "Солтүстік қызмет ЖК",
    workplaceEn: "Independent workplace wording",
    employerId: "same-employer",
    employerBin: "000000000099",
    workplaceNaming: hint,
  });
  const draft = draftSchema.parse({ kind: "PERSON", items: [legacy, item] });
  assert.deepEqual(draftSchema.parse(JSON.parse(JSON.stringify(draft))), draft);
  assert.equal("workplaceNaming" in draft.items[0], false);
  assert.deepEqual(draft.items[0], legacy);
  assert.deepEqual(draft.items[1].workplaceNaming, hint);
  const manual = itemSchema.parse({
    ...item,
    workplaceRu: "Ручная строка",
    workplaceKz: "",
  });
  assert.equal(manual.workplaceRu, "Ручная строка");
  assert.equal(manual.workplaceKz, "");
  assert.equal(manual.workplaceEn, item.workplaceEn);
  assert.equal(manual.employerId, item.employerId);
  assert.equal(manual.employerBin, item.employerBin);
  assert.deepEqual(
    manual.workplaceNaming,
    hint,
    "stale editor metadata never rewrites authoritative manual names",
  );
});

test("workplace naming is a bounded explicit hint, not an inferred legal identity", () => {
  const valid = { version: 1, legalForm: "TOO", ownNameRu: "", ownNameKz: "" };
  assert.equal(
    itemSchema.safeParse({ id: "draft", workplaceNaming: valid }).success,
    true,
  );
  for (const workplaceNaming of [
    { ...valid, version: 2 },
    { ...valid, legalForm: "LLC" },
    { ...valid, legalForm: null },
    { ...valid, ownNameRu: "x".repeat(501) },
    { ...valid, ownNameKz: "x".repeat(501) },
    { ...valid, userId: "not-a-workplace-field" },
    { legalForm: "TOO", ownNameRu: "", ownNameKz: "" },
  ])
    assert.equal(
      itemSchema.safeParse({ id: "draft", workplaceNaming }).success,
      false,
    );
});
