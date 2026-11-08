import assert from "node:assert/strict";
import test from "node:test";
import {
  applyRecipientOrganization,
  detachRecipientEmployer,
  editRecipientOrganization,
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

test("explicit bilingual form survives a draft round trip without inferring forms from literal text", () => {
  const person = {
    ...newRecipient(),
    employerId: "known",
    employerBin: "123",
    workplaceEn: "existing English",
  };
  const next = applyRecipientOrganization(person, {
    legalForm: "IP",
    ownNameRu: "«Север»",
    ownNameKz: "«Солтүстік»",
    nameRu: "",
    nameKz: "",
  });
  const restored = recipientOrganizationDraft(JSON.parse(JSON.stringify(next)));
  assert.equal(restored.legalForm, "IP");
  assert.equal(restored.ownNameRu, "«Север»");
  assert.equal(restored.ownNameKz, "«Солтүстік»");
  assert.equal(next.employerId, "known");
  assert.equal(next.employerBin, "123");
  assert.equal(next.workplaceEn, person.workplaceEn);
  assert.doesNotThrow(() => applyRecipientOrganization(next, restored));
});

test("stale formatting hints cannot overwrite independent manual RU or KZ edits", () => {
  const next = applyRecipientOrganization(newRecipient(), {
    legalForm: "TOO",
    ownNameRu: "Север",
    ownNameKz: "Солтүстік",
    nameRu: "",
    nameKz: "",
  });
  for (const patch of [
    { workplaceRu: "Своя строка" },
    { workplaceKz: "Өз атауы" },
  ]) {
    const edited = { ...next, ...patch };
    const display = recipientOrganizationDraft(edited);
    assert.equal(display.legalForm, null);
    assert.equal(display.nameRu, edited.workplaceRu);
    assert.equal(display.nameKz, edited.workplaceKz);
  }
});

test("a blank inline name retains an explicit form choice without creating an organization", () => {
  const empty = editRecipientOrganization(newRecipient(), {
    legalForm: "IP",
    ownNameRu: "",
    ownNameKz: "",
    nameRu: "",
    nameKz: "",
  });
  assert.equal(empty.employerId, undefined);
  assert.equal(recipientOrganizationDraft(empty).legalForm, "IP");
  assert.equal(empty.workplaceRu, "");
  assert.equal(empty.workplaceKz, "");
});

test("unlinking the directory preserves document names, formatting choice and local requisites", () => {
  const linked = applyRecipientOrganization(
    {
      ...newRecipient(),
      employerId: "old",
      employerBin: "123",
      employerAddressRu: "Адрес",
      departmentRu: "Цех",
    },
    {
      legalForm: "IP",
      ownNameRu: "Север",
      ownNameKz: "",
      nameRu: "",
      nameKz: "",
    },
  );
  const unlinked = detachRecipientEmployer(linked);
  assert.equal(unlinked.employerId, undefined);
  assert.equal(unlinked.workplaceRu, linked.workplaceRu);
  assert.equal(unlinked.workplaceKz, linked.workplaceKz);
  assert.deepEqual(unlinked.workplaceNaming, linked.workplaceNaming);
  assert.equal(unlinked.employerBin, "123");
  assert.equal(unlinked.employerAddressRu, "Адрес");
  assert.equal(unlinked.departmentRu, "Цех");
  assert.equal(linked.employerId, "old");
});
