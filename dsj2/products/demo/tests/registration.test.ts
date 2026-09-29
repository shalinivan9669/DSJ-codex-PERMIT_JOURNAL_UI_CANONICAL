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
