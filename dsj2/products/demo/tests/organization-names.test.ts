import test from "node:test";
import assert from "node:assert/strict";
import {
  customerSchema,
  formatOrganizationNames,
  itemSchema,
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
