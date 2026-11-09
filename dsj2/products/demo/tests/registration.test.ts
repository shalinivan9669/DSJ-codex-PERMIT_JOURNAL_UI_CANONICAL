import test from "node:test";
import assert from "node:assert/strict";
import { profileSchema, registrationSchema } from "../packages/contracts/src";

const registration = {
  legalForm: "TOO",
  ownNameRu: "Учебный центр",
  ownNameKz: "",
  displayName: "Администратор",
  email: "ADMIN@EXAMPLE.TEST",
  password: "Synthetic-password-123",
};
const profile = {
  nameRu: "Старое название ТОО",
  nameKz: "ЖШС Бұрынғы атау",
  addressRu: "",
  addressKz: "",
  cityRu: "",
  cityKz: "",
  approvalBasis: "",
  commission: [{ name: "Председатель", position: "Председатель" }],
  approved: false,
};
test("registration is strict, normalizes email and rejects authority injection or weak credentials", () => {
  assert.equal(
    registrationSchema.parse(registration).email,
    "admin@example.test",
  );
  for (const extra of [
    { tenantId: "other" },
    { role: "ADMIN" },
    { approved: true },
    { demoOnly: false },
  ])
    assert.equal(
      registrationSchema.safeParse({ ...registration, ...extra }).success,
      false,
    );
  for (const extra of [
    { password: "short" },
    { email: "invalid" },
    { ownNameRu: " " },
    { displayName: " " },
  ])
    assert.equal(
      registrationSchema.safeParse({ ...registration, ...extra }).success,
      false,
    );
});
test("profile preserves legacy names and optional people and common fields through repeat validation", () => {
  const input = {
    ...profile,
    people: [{ name: "Преподаватель", position: "Инженер", role: "TEACHER" }],
    commonFields: {
      documentDate: "2026-09-29",
      hours: "40",
      trainingDateRule: {
        hoursPerDay: 8,
        hoursSource: "THEORY",
        calendar: "WEEKDAYS",
        anchor: "DOCUMENT_AFTER_TRAINING",
        protocolDate: "DOCUMENT_DATE",
        source: "Утверждено центром",
      },
    },
  };
  const saved = profileSchema.parse(input);
  assert.deepEqual(saved, input);
  assert.deepEqual(profileSchema.parse(saved), input);
  assert.equal(saved.nameRu, profile.nameRu);
  assert.equal(saved.nameKz, profile.nameKz);
  assert.equal(
    profileSchema.safeParse({
      ...input,
      people: [{ name: "User", role: "ADMIN" }],
    }).success,
    false,
  );
});
test("explicit legal form produces shared center name with RU/KZ abbreviations without approving incomplete setup", () => {
  const parsed = profileSchema.parse({
    ...profile,
    legalForm: "TOO",
    ownNameRu: "Центр",
    ownNameKz: "",
    commission: [],
  });
  assert.equal(parsed.nameRu, "ТОО Центр");
  assert.equal(parsed.nameKz, "Центр ЖШС");
  assert.equal(parsed.approved, false);
  assert.deepEqual(parsed.commission, []);
});

test("optional bank requisites normalize codes, preserve leading zero and survive repeat parsing", () => {
  const parsed = profileSchema.parse({
    ...profile,
    bankName: " АО Тестовый банк ",
    iban: "kz77 0000 0000 0000 0001",
    bik: "testkzkx",
    postalCode: "050038",
  });
  assert.equal(parsed.bankName, "АО Тестовый банк");
  assert.equal(parsed.iban, "KZ770000000000000001");
  assert.equal(parsed.bik, "TESTKZKX");
  assert.equal(parsed.postalCode, "050038");
  assert.deepEqual(
    profileSchema.parse(JSON.parse(JSON.stringify(parsed))),
    parsed,
  );
  assert.deepEqual(parsed.commission, profile.commission);
  assert.equal(parsed.approved, false);

  const legacy = profileSchema.parse(profile);
  for (const field of ["bankName", "iban", "bik", "postalCode"] as const) {
    assert.equal(Object.hasOwn(legacy, field), false);
    assert.equal(profileSchema.parse({ ...profile, [field]: "" })[field], "");
  }
});

test("bank requisite validation reports the exact field and rejects invalid formats or checksums", () => {
  for (const [field, value] of [
    ["bankName", "Банк\nДругая строка"],
    ["bankName", "Б".repeat(256)],
    ["iban", "KZ770000000000000002"],
    ["iban", "KZ95-invalid-account"],
    ["iban", "1".repeat(65)],
    ["bik", "TESTKZ"],
    ["bik", "1ESTKZKX"],
    ["bik", "TESTKZKX1234"],
    ["postalCode", 50038],
    ["postalCode", "050/038"],
    ["postalCode", "0".repeat(21)],
  ] as const) {
    const parsed = profileSchema.safeParse({ ...profile, [field]: value });
    assert.equal(parsed.success, false, field);
    if (!parsed.success) assert.equal(parsed.error.issues[0].path[0], field);
  }
  assert.equal(
    profileSchema.parse({ ...profile, bik: "TESTKZKXXXX" }).bik,
    "TESTKZKXXXX",
  );
  assert.equal(
    profileSchema.parse({ ...profile, postalCode: "a15t6b7" }).postalCode,
    "A15T6B7",
  );
});
