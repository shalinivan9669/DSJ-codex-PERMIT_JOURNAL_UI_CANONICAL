import assert from "node:assert/strict";
import test from "node:test";
import {
  applyRecipientOrganization,
  patchRecipientEmployer,
  recipientOrganizationDraft,
} from "../lib/recipient-employer";
import { newRecipient, type Customer } from "../lib/types";

test("manual employer naming keeps imported wording until an explicit form choice", () => {
  const recipient = {
    ...newRecipient(),
    workplaceRu: "ТОО «North»",
    workplaceKz: "«Солтүстік» ЖШС",
  };
  const editor = recipientOrganizationDraft(recipient);
  assert.equal(editor.legalForm, null);
  assert.equal(editor.nameRu, recipient.workplaceRu);
  assert.equal(editor.nameKz, recipient.workplaceKz);
  assert.equal(
    applyRecipientOrganization(recipient, editor).workplaceKz,
    recipient.workplaceKz,
  );
});

test("explicit form uses one proper name and preserves employer identity and recipient fields", () => {
  const recipient = {
    ...newRecipient(),
    employerId: "employer-old",
    recipientId: "person-old",
    positionRu: "Сварщик",
    workplaceRu: "Старое название",
    workplaceKz: "Бұрынғы атау",
  };
  for (const [legalForm, ru, kz] of [
    ["TOO", "ТОО «North»", "«North» ЖШС"],
    ["IP", "ИП «North»", "«North» ЖК"],
    ["AO", "АО «North»", "«North» АҚ"],
  ] as const) {
    const result = applyRecipientOrganization(recipient, {
      legalForm,
      ownNameRu: "«North»",
      ownNameKz: "",
      nameRu: "",
      nameKz: "",
    });
    assert.equal(result.workplaceRu, ru);
    assert.equal(result.workplaceKz, kz);
    assert.equal(result.employerId, recipient.employerId);
    assert.equal(result.recipientId, recipient.recipientId);
    assert.equal(result.positionRu, recipient.positionRu);
    assert.equal(result.assignments, recipient.assignments);
  }
  assert.equal(recipient.workplaceRu, "Старое название");
});

test("selecting a new employer replaces only employer fields and keeps other application data", () => {
  const recipient = {
    ...newRecipient(),
    fullNameRu: "Тестовый человек",
    recipientId: "person-old",
    employerId: "employer-old",
    departmentRu: "Цех 1",
    employerBin: "old-bin",
  };
  const employer: Customer = {
    id: "employer-new",
    nameRu: "ТОО «Новая»",
    nameKz: "«Новая» ЖШС",
    bin: "new-bin",
    addressRu: "Новый адрес",
    addressKz: "Жаңа мекенжай",
    archived: false,
  };
  const updated = patchRecipientEmployer(recipient, employer);
  assert.deepEqual(
    {
      id: updated.employerId,
      ru: updated.workplaceRu,
      kz: updated.workplaceKz,
      bin: updated.employerBin,
      addressRu: updated.employerAddressRu,
      addressKz: updated.employerAddressKz,
    },
    {
      id: employer.id,
      ru: employer.nameRu,
      kz: employer.nameKz,
      bin: employer.bin,
      addressRu: employer.addressRu,
      addressKz: employer.addressKz,
    },
  );
  assert.equal(updated.fullNameRu, recipient.fullNameRu);
  assert.equal(updated.recipientId, recipient.recipientId);
  assert.equal(updated.departmentRu, recipient.departmentRu);
  assert.equal(updated.assignments, recipient.assignments);
  assert.equal(recipient.employerId, "employer-old");
});

test("conflicting legal forms cannot silently rewrite employer names", () => {
  const recipient = newRecipient();
  assert.throws(() =>
    applyRecipientOrganization(recipient, {
      legalForm: "TOO",
      ownNameRu: "ИП Другая",
      ownNameKz: "",
      nameRu: "",
      nameKz: "",
    }),
  );
  assert.equal(recipient.workplaceRu, "");
});
