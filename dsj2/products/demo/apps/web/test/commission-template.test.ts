import assert from "node:assert/strict";
import test from "node:test";
import type { Commission } from "../lib/commission";
import {
  COMMISSION_POSITIONS,
  commissionRoleAsPosition,
  commissionTemplatePositions,
  commissionTemplateRows,
  fillCommissionPositions,
  suggestedCommissionTemplate,
} from "../lib/commission-template";

test("empty composition shows three named job slots without inventing people", () => {
  assert.deepEqual(COMMISSION_POSITIONS, [
    "Начальник УМО",
    "Директор",
    "Преподаватель",
  ]);
  assert.deepEqual(commissionTemplatePositions("director-chair"), [
    "Директор",
    "Начальник УМО",
    "Преподаватель",
  ]);
  for (const template of ["umo-chair", "director-chair"] as const) {
    const empty: Commission = [];
    assert.deepEqual(
      commissionTemplateRows(empty, template),
      commissionTemplatePositions(template).map((position) => ({
        name: "",
        position,
      })),
    );
    assert.deepEqual(empty, []);
  }
  const emptySlots = [
    { name: "", position: "" },
    { name: "", position: "\u200b" },
  ];
  assert.deepEqual(
    commissionTemplateRows(emptySlots, "umo-chair").map((row) => row.position),
    COMMISSION_POSITIONS,
  );
  assert.equal(emptySlots[1].position, "\u200b");
});

test("display preserves partial, translated and additional members without moving anyone into the chair slot", () => {
  const value: Commission = [
    { name: "", position: "" },
    {
      name: "Иванов И. И.",
      position: "Инженер",
      nameEn: "Ivanov",
      positionEn: "Engineer",
    },
    { name: "Петров П. П.", position: "Преподаватель" },
    { name: "Четвёртый участник", position: "Внешний эксперт" },
  ];
  const before = structuredClone(value);
  const rows = commissionTemplateRows(value, "director-chair");
  assert.deepEqual(rows, before);
  assert.equal(rows[0], value[0]);
  assert.equal(rows[3], value[3]);
  assert.deepEqual(value, before);
  const translated: Commission = [
    { name: "", position: "", nameEn: "Saved chair" },
  ];
  assert.deepEqual(commissionTemplateRows(translated, "umo-chair"), [
    translated[0],
    { name: "", position: "" },
    { name: "", position: "" },
  ]);
});

test("explicit fill changes only blank first-three job titles and preserves all other facts", () => {
  const value: Commission = [
    {
      name: "Сохранённый председатель",
      position: "",
      nameEn: "Saved chair",
      positionEn: "Custom English title",
    },
    { name: "Первый член", position: "Председатель правления" },
    { name: "Второй член", position: " \u200b " },
    { name: "Дополнительный член", position: "", positionEn: "Observer" },
  ];
  const before = structuredClone(value);
  const filled = fillCommissionPositions(value, "director-chair");
  assert.deepEqual(filled, [
    { ...value[0], position: "Директор" },
    value[1],
    { ...value[2], position: "Преподаватель" },
    value[3],
  ]);
  assert.deepEqual(value, before);
  assert.deepEqual(fillCommissionPositions(filled, "umo-chair"), filled);
  assert.deepEqual(
    fillCommissionPositions([], "umo-chair"),
    COMMISSION_POSITIONS.map((position) => ({ name: "", position })),
  );
  assert.deepEqual(fillCommissionPositions([value[1]], "director-chair"), [
    value[1],
    { name: "", position: "Начальник УМО" },
    { name: "", position: "Преподаватель" },
  ]);
});

test("template suggestion uses exact job order without inferring people or commission roles", () => {
  const director = commissionTemplatePositions("director-chair").map(
    (position, index) => ({ name: `Человек ${index}`, position }),
  );
  assert.equal(suggestedCommissionTemplate(director), "director-chair");
  assert.equal(
    suggestedCommissionTemplate([
      ...director,
      { name: "Ещё один", position: "Эксперт" },
    ]),
    "director-chair",
  );
  assert.equal(suggestedCommissionTemplate(director.slice(0, 2)), "umo-chair");
  assert.equal(
    suggestedCommissionTemplate([
      { name: "Директор", position: "Председатель комиссии" },
      ...director.slice(1),
    ]),
    "umo-chair",
  );
  assert.equal(
    suggestedCommissionTemplate([
      { ...director[0], position: "Генеральный директор" },
      ...director.slice(1),
    ]),
    "umo-chair",
  );
  assert.equal(suggestedCommissionTemplate([]), "umo-chair");
});

test("commission-role guidance recognizes only complete slot labels, never company job titles", () => {
  for (const value of [
    "Председатель",
    "Председатель комиссии",
    " Член комиссии ",
    "Член комиссии 1",
    "член комиссии 12",
  ])
    assert.equal(commissionRoleAsPosition(value), true, value);
  for (const value of [
    ...COMMISSION_POSITIONS,
    "Председатель правления",
    "Председатель совета директоров",
    "Заместитель председателя комиссии",
    "Член комиссии по безопасности",
    "Член комиссии 1 и преподаватель",
    "",
  ])
    assert.equal(commissionRoleAsPosition(value), false, value);
});
