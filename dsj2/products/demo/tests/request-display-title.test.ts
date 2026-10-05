import test from "node:test";
import assert from "node:assert/strict";
import {
  proposalDisplayTitle,
  requestDisplayTitle,
} from "../apps/api/src/request-customer";

const company = {
  title: "Новая заявка организации",
  kind: "COMPANY",
  customerId: "customer",
  organizationSnapshots: [
    { id: "unrelated", nameRu: "Чужая организация" },
    {
      id: "customer",
      nameRu: "ТОО Зафиксированная компания",
      nameKz: "Бекітілген компания ЖШС",
    },
  ],
};

test("request list display extraction preserves the existing four generic titles and fallback semantics", () => {
  for (const title of [
    "",
    "Новая заявка",
    "Новая заявка на человека",
    "Новая заявка организации",
    "  Новая заявка организации  ",
    "Новая заявка физлица",
    "Новая заявка организации № 12",
    "  Историческое название\n",
  ]) {
    for (const name of [null, "", "Имя заказчика", "  Имя заказчика  "]) {
      const previous = [
        "",
        "Новая заявка",
        "Новая заявка на человека",
        "Новая заявка организации",
      ].includes(title.trim())
        ? name || title
        : title;
      assert.equal(requestDisplayTitle(title, name), previous);
    }
  }
});

test("SAVE display uses only the matching frozen organization and never the current request fallback or before", () => {
  const proposal = {
    operation: "SAVE",
    payload: structuredClone(company),
    before: { ...company, title: "Предыдущая редакция" },
  };
  const original = structuredClone(proposal);
  assert.equal(
    proposalDisplayTitle(proposal, "Изменённая текущая заявка"),
    "ТОО Зафиксированная компания",
  );
  assert.deepEqual(proposal, original);
});

test("custom historical titles remain byte exact for both request kinds and all operations", () => {
  const title = "  Историческое название № 7\n";
  for (const operation of ["SAVE", "ARCHIVE", "CANCEL"]) {
    for (const kind of ["PERSON", "COMPANY"]) {
      const draft = { ...company, title, kind };
      assert.equal(
        proposalDisplayTitle(
          { operation, payload: draft, before: draft },
          "Текущее другое название",
        ),
        title,
      );
    }
  }
});

test("ARCHIVE and CANCEL display the frozen before identity, not action payload title or live request title", () => {
  for (const operation of ["ARCHIVE", "CANCEL"]) {
    assert.equal(
      proposalDisplayTitle(
        {
          operation,
          before: company,
          payload: { operation, title: "Не является заголовком редакции" },
        },
        "Изменённая текущая заявка",
      ),
      "ТОО Зафиксированная компания",
    );
  }
});

test("a frozen PERSON title uses the first supplied RU or KZ name, never its legacy employer", () => {
  const payload = {
    ...company,
    kind: "PERSON",
    title: "Новая заявка на человека",
    items: [
      { fullNameRu: " ", fullNameKz: "" },
      { fullNameRu: "", fullNameKz: "  Синтетикалық Алушы  " },
      { fullNameRu: "Другой получатель", fullNameKz: "" },
    ],
  };
  assert.equal(
    proposalDisplayTitle({ operation: "SAVE", payload }, "Новая заявка"),
    "Синтетикалық Алушы",
  );
  payload.items[1].fullNameRu = "  Синтетический Получатель  ";
  assert.equal(
    proposalDisplayTitle({ operation: "SAVE", payload }, "Новая заявка"),
    "Синтетический Получатель",
  );
});

test("a KZ-only company snapshot is displayed without inventing or overwriting a translation", () => {
  const payload = structuredClone(company);
  payload.organizationSnapshots[1].nameRu = " ";
  const original = structuredClone(payload);
  assert.equal(
    proposalDisplayTitle({ operation: "SAVE", payload }, "Новая заявка"),
    "Бекітілген компания ЖШС",
  );
  assert.deepEqual(payload, original);
});

test("incomplete historical records keep safe title fallbacks and never use an unrelated company", () => {
  for (const payload of [null, [], "old payload", 12, { title: 12 }]) {
    assert.equal(
      proposalDisplayTitle({ operation: "SAVE", payload }, "Старое название"),
      "Старое название",
    );
  }
  for (const payload of [
    { ...company, customerId: "missing" },
    { ...company, customerId: null },
    { ...company, organizationSnapshots: [null, 12, "bad", {}] },
    { ...company, organizationSnapshots: [{ id: "customer", nameRu: 42 }] },
  ]) {
    assert.equal(
      proposalDisplayTitle({ operation: "SAVE", payload }, "Новая заявка"),
      company.title,
    );
  }
  assert.equal(
    proposalDisplayTitle({ operation: "SAVE", payload: { title: "" } }, ""),
    "Новая заявка",
  );
});
