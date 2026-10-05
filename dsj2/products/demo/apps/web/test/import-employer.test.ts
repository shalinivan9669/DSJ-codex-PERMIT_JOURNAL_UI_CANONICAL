import test from "node:test";
import assert from "node:assert/strict";
import {
  importEmployerConflict,
  inheritImportEmployer,
} from "../lib/import-employer";
import { newRecipient } from "../lib/types";
const company = {
  id: "company",
  nameRu: "ТОО «Центр»",
  nameKz: "ЖШС «Орталық»",
  bin: "123456789012",
  addressRu: "Адрес",
  addressKz: "Мекенжай",
};
test("company import distinguishes inherited, matching bilingual and conflicting employers", () => {
  const row = newRecipient();
  assert.equal(importEmployerConflict(row, company), false);
  assert.equal(
    importEmployerConflict(
      { ...row, workplaceRu: company.nameRu, workplaceKz: company.nameKz },
      company,
    ),
    false,
  );
  assert.equal(
    importEmployerConflict(
      { ...row, employerId: company.id, employerBin: "999999999999" },
      company,
    ),
    true,
  );
  assert.equal(
    importEmployerConflict(
      { ...row, workplaceRu: "Другой работодатель" },
      company,
    ),
    true,
  );
  assert.equal(
    importEmployerConflict(
      { ...row, employerAddressRu: "Неустановленный адрес" },
      company,
    ),
    true,
  );
});
test("explicit employer alignment keeps person, languages, course outcomes and identities", () => {
  const row = {
    ...newRecipient(),
    fullNameRu: "Синтетический Человек",
    fullNameKz: "Бөлек Аты",
    positionRu: "Мастер",
    positionKz: "Шебер",
    workplaceRu: "Другая компания",
    employerId: "other",
    employerBin: "999999999999",
  };
  const next = inheritImportEmployer(row);
  assert.equal(row.employerId, "other");
  assert.equal(next.employerId, undefined);
  assert.equal(next.workplaceRu, "");
  assert.equal(next.id, row.id);
  assert.equal(next.fullNameKz, row.fullNameKz);
  assert.equal(next.positionKz, row.positionKz);
  assert.deepEqual(next.assignments, row.assignments);
});
