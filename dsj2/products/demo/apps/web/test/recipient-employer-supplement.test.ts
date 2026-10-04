import assert from "node:assert/strict";
import test from "node:test";
import {
  supplementRecipientEmployer,
  effectiveRecipientEmployer,
} from "../lib/recipient-employer";
import { newRecipient, type Customer } from "../lib/types";

const company: Customer = {
  id: "known-company",
  nameRu: "ТОО «Север»",
  nameKz: "«Солтүстік» ЖШС",
  bin: "123456789012",
  addressRu: "Алматы",
  addressKz: "Алматы",
  archived: false,
};
test("effective employer never inherits requisites from an unrelated customer", () => {
  const addressOnly = effectiveRecipientEmployer(
    { ...newRecipient(), employerAddressRu: "Неизвестный филиал" },
    company,
  );
  assert.equal(addressOnly.workplaceRu, "");
  assert.equal(addressOnly.employerBin, "");
  assert.equal(addressOnly.employerAddressRu, "Неизвестный филиал");
  const other = { ...newRecipient(), workplaceRu: "Другая компания" };
  assert.equal(effectiveRecipientEmployer(other, company).employerBin, "");
  assert.equal(
    effectiveRecipientEmployer(other, company).employerAddressRu,
    "",
  );
  assert.equal(
    effectiveRecipientEmployer({ ...other, employerId: company.id }, company)
      .employerBin,
    company.bin,
  );
  assert.equal(
    effectiveRecipientEmployer(
      { ...other, employerId: company.id, employerBin: "999999999999" },
      company,
    ).employerAddressRu,
    "",
  );
});
test("a known company name allows supplementing missing BIN and address without replacing a local address", () => {
  const row = {
    ...newRecipient(),
    workplaceRu: company.nameRu,
    employerAddressRu: "Филиал",
  };
  const next = supplementRecipientEmployer(row, company);
  assert.equal(next.employerBin, company.bin);
  assert.equal(next.workplaceKz, company.nameKz);
  assert.equal(next.employerAddressRu, "Филиал");
  assert.equal(next.assignments, row.assignments);
  assert.equal(row.employerBin, undefined);
});
test("different identity, conflicting BIN, another translated company or ambiguous address never mixes employers", () => {
  for (const patch of [
    { employerId: "another-company" },
    { workplaceRu: "Другая компания" },
    { workplaceRu: company.nameRu, workplaceKz: "Басқа компания" },
    { workplaceRu: company.nameRu, employerBin: "999999999999" },
    { employerAddressRu: "Только адрес" },
  ]) {
    const row = { ...newRecipient(), ...patch };
    assert.equal(supplementRecipientEmployer(row, company), row);
  }
});
test("empty employer and known identity are filled, while repeated application is a no-op", () => {
  const row = supplementRecipientEmployer(newRecipient(), company);
  assert.equal(row.employerId, company.id);
  assert.equal(supplementRecipientEmployer(row, company), row);
  const local = {
    ...newRecipient(),
    employerId: company.id,
    workplaceRu: "Местное написание",
  };
  assert.equal(
    supplementRecipientEmployer(local, company).workplaceRu,
    local.workplaceRu,
  );
});
