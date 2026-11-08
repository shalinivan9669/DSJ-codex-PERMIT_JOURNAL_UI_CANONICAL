import assert from "node:assert/strict";
import { test } from "node:test";
import { customerSchema } from "@demo/contracts";
import { initialCustomerDraft } from "../lib/customer-draft";

test("a new organization starts with the unchanged no-form empty fields", () => {
  const value = initialCustomerDraft({});
  assert.equal(value.legalForm, "NONE");
  assert.equal(value.ownNameRu, "");
  assert.equal(value.ownNameKz, "");
  assert.equal(customerSchema.safeParse(value).success, false);
});

test("creating a directory card from request names preserves both complete names without guessing a legal form", () => {
  const source = {
    nameRu: " ИП «Север» ",
    nameKz: " «Солтүстік» ЖК ",
    bin: "123456789012",
  };
  const value = initialCustomerDraft(source);
  assert.equal(value.legalForm, null);
  assert.equal(value.ownNameRu, null);
  assert.equal(value.ownNameKz, null);
  const saved = customerSchema.parse(value);
  assert.equal(saved.nameRu, source.nameRu);
  assert.equal(saved.nameKz, source.nameKz);
  assert.equal(saved.bin, source.bin);
  assert.deepEqual(source, {
    nameRu: " ИП «Север» ",
    nameKz: " «Солтүстік» ЖК ",
    bin: "123456789012",
  });
});

test("legacy stored names remain unstructured and a missing translated name is not invented", () => {
  const value = initialCustomerDraft({
    id: "legacy",
    nameRu: "ТОО Север",
    nameKz: "",
    archived: true,
  });
  assert.equal(value.legalForm, null);
  assert.equal(value.nameRu, "ТОО Север");
  assert.equal(value.nameKz, "");
  assert.equal(value.archived, true);
});

test("explicit structured metadata keeps a manual KZ name and formats legal designations exactly once", () => {
  const value = initialCustomerDraft({
    legalForm: "TOO",
    ownNameRu: "ТОО «Север»",
    ownNameKz: "«Солтүстік» ЖШС",
    nameRu: "ТОО «Север»",
    nameKz: "«Солтүстік» ЖШС",
  });
  const saved = customerSchema.parse(value);
  assert.equal(saved.nameRu, "ТОО «Север»");
  assert.equal(saved.nameKz, "«Солтүстік» ЖШС");
  assert.equal(saved.ownNameRu, "«Север»");
  assert.equal(saved.ownNameKz, "«Солтүстік»");
  assert.equal(value.ownNameKz, "«Солтүстік» ЖШС");
});

test("an explicitly selected form with full prefilled names does not lose its own-name inputs", () => {
  const saved = customerSchema.parse(
    initialCustomerDraft({
      legalForm: "IP",
      nameRu: "ИП Асан",
      nameKz: "Асан ЖК",
    }),
  );
  assert.equal(saved.nameRu, "ИП Асан");
  assert.equal(saved.nameKz, "Асан ЖК");
  assert.equal(saved.ownNameRu, "Асан");
});
