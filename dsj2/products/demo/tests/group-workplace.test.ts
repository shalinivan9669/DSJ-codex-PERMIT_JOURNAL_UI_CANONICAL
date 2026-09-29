import test from "node:test";
import assert from "node:assert/strict";
import { groupHeaderWorkplace } from "../apps/api/src/group-workplace";

test("group header pins unique supplied names independently, preserving order and legal forms", () => {
  const items = [
    { workplaceRu: "ТОО «Первый»", workplaceKz: "«Бірінші» ЖШС" },
    { workplaceRu: "ИП Второй", workplaceKz: "" },
    { workplaceRu: "ТОО «Первый»", workplaceKz: "«Бірінші» ЖШС" },
    { workplaceRu: "Без указанной формы", workplaceKz: "Атауы" },
  ];
  const expected = {
    version: 1,
    workplaceRu: "ТОО «Первый»; ИП Второй; Без указанной формы",
    workplaceKz: "«Бірінші» ЖШС; Атауы",
  };
  for (const template of ["biot-protocol", "biot-itr-protocol", "pb-protocol"])
    assert.deepEqual(groupHeaderWorkplace(template, items), expected);
  for (const template of ["ptm-protocol", "ps-protocol", "biot-worker-card"])
    assert.equal(groupHeaderWorkplace(template, items), undefined);
  const captured = groupHeaderWorkplace("biot-protocol", items);
  items[0].workplaceRu = "Изменённое справочное имя";
  assert.deepEqual(captured, expected);
});
