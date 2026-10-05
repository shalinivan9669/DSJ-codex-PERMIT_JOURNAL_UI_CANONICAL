import assert from "node:assert/strict";
import test from "node:test";
import { hasRecipientEmployerException } from "../lib/recipient-employer-exception";
import { newRecipient } from "../lib/types";

const company = {
  id: "company",
  nameRu: "ТОО Тест",
  nameKz: "Тест ЖШС",
  bin: "123456789012",
  addressRu: "Тестовый адрес",
  addressKz: "Тест мекенжайы",
};

test("ordinary company rows inherit without a repeated employer block", () => {
  assert.equal(hasRecipientEmployerException(newRecipient(), company), false);
  assert.equal(
    hasRecipientEmployerException(
      {
        ...newRecipient(),
        employerId: company.id,
        workplaceRu: company.nameRu,
        workplaceKz: company.nameKz,
        employerBin: company.bin,
        employerAddressRu: company.addressRu,
      },
      company,
    ),
    false,
  );
});

test("old employer identity, spelling and requisites exceptions remain discoverable", () => {
  const person = newRecipient();
  for (const patch of [
    { employerId: "other" },
    { workplaceRu: "Другая компания" },
    { workplaceKz: "Сохранённый особый вариант" },
    { employerBin: "999999999999" },
    { employerAddressRu: "Иной адрес" },
  ])
    assert.equal(
      hasRecipientEmployerException({ ...person, ...patch }, company),
      true,
    );
  assert.equal(
    hasRecipientEmployerException(
      { ...person, workplaceRu: "  ТОО   Тест  " },
      company,
    ),
    false,
  );
  assert.deepEqual(
    person,
    newRecipientWithIdentity(person.id, person.assignments),
  );
});

function newRecipientWithIdentity(
  id: string,
  assignments: ReturnType<typeof newRecipient>["assignments"],
) {
  return { ...newRecipient(), id, assignments };
}
