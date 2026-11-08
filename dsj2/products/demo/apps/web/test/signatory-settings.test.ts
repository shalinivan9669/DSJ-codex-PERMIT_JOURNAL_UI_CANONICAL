import assert from "node:assert/strict";
import { test } from "node:test";
import {
  eligibleSignatory,
  matchingSignatory,
  mergeSavedSignatory,
  signatoryReturnPath,
  signatoryRole,
  signatoryRevocationPayload,
  type Signatory,
} from "../lib/signatory-settings";

const director: Signatory = {
  id: "director-v1",
  userId: "person-1",
  displayName: "Иванов Иван Иванович",
  role: "DIRECTOR",
  iin: "123456789012",
  bin: null,
  active: true,
};

test("explicit revocation preserves identity and targets only the selected binding", () => {
  assert.deepEqual(signatoryRevocationPayload(director), {
    bindingId: director.id,
    userId: director.userId,
    displayName: director.displayName,
    role: director.role,
    iin: director.iin,
    active: false,
  });
  assert.equal(
    signatoryRevocationPayload({ ...director, active: false }),
    undefined,
  );
  assert.equal(
    signatoryRevocationPayload({ ...director, bin: "123456789012" })?.bin,
    "123456789012",
  );
  const newerDirector = { ...director, id: "director-v2" };
  const chair = { ...director, id: "chair-v1", role: "CHAIR" as const };
  const revoked = { ...director, active: false };
  const result = mergeSavedSignatory([director, newerDirector, chair], revoked);
  assert.equal(result.find((entry) => entry.id === director.id)?.active, false);
  assert.equal(
    result.find((entry) => entry.id === newerDirector.id)?.active,
    true,
  );
  assert.equal(result.find((entry) => entry.id === chair.id)?.active, true);
  assert.equal(result.filter((entry) => entry.id === director.id).length, 1);
});

test("one account can hold several signing roles without revoking other roles or people", () => {
  const chair = { ...director, id: "chair-v1", role: "CHAIR" as const };
  const anotherChair = { ...chair, id: "another-chair", userId: "person-2" };
  const saved = { ...chair, id: "chair-v2", displayName: "Иванов И. И." };
  const result = mergeSavedSignatory([director, chair, anotherChair], saved);
  assert.equal(result[0], saved);
  assert.equal(result.find((entry) => entry.id === chair.id)?.active, false);
  assert.equal(result.find((entry) => entry.id === director.id)?.active, true);
  assert.equal(
    result.find((entry) => entry.id === anotherChair.id)?.active,
    true,
  );
  assert.equal(chair.active, true);
  assert.equal(
    mergeSavedSignatory(result, saved).filter((entry) => entry.id === saved.id)
      .length,
    1,
  );
});

test("unchanged active binding avoids creating a new version, but changed identity and role do not", () => {
  assert.equal(
    matchingSignatory([director], {
      ...director,
      displayName: ` ${director.displayName} `,
      bin: "",
    }),
    director,
  );
  assert.equal(
    matchingSignatory([{ ...director, active: false }], director),
    undefined,
  );
  for (const change of [
    { role: "CHAIR" as const },
    { iin: "999456789012" },
    { userId: "person-2" },
    { bin: "123456789012" },
    { displayName: "Другой человек" },
  ]) {
    assert.equal(
      matchingSignatory([director], { ...director, ...change }),
      undefined,
    );
  }
});

test("account choices follow server restrictions and exclude disabled staff", () => {
  const user = { id: "person-1", displayName: "Сотрудник", role: "OPERATOR" };
  assert.equal(eligibleSignatory(user, "DIRECTOR"), false);
  assert.equal(eligibleSignatory(user, "CHAIR"), true);
  assert.equal(eligibleSignatory(user, "TEACHER"), true);
  assert.equal(
    eligibleSignatory({ ...user, role: "EXPERT" }, "TEACHER"),
    false,
  );
  for (const role of ["DIRECTOR", "ADMIN", "SUPER_ADMIN"]) {
    assert.equal(eligibleSignatory({ ...user, role }, "DIRECTOR"), true);
  }
  for (const role of [
    "TEACHER",
    "METHODIST",
    "EMPLOYER",
    "LEARNER",
    "VIEWER",
  ]) {
    assert.equal(eligibleSignatory({ ...user, role }, "CHAIR"), false);
  }
  assert.equal(eligibleSignatory({ ...user, active: false }, "CHAIR"), false);
  assert.equal(eligibleSignatory({ ...user, disabled: true }, "CHAIR"), false);
});

test("setup return is restricted to request pages and the signing anchor", () => {
  assert.equal(
    signatoryReturnPath("/requests/request_1-2#signing"),
    "/requests/request_1-2#signing",
  );
  assert.equal(
    signatoryReturnPath("/requests/request_1-2"),
    "/requests/request_1-2",
  );
  for (const value of [
    "//example.com",
    "https://example.com/requests/1",
    "/requests/1?returnTo=//example.com",
    "/requests/../settings",
    "/requests/1#other",
    "/requests/1/",
    "/requests/%31",
    "/requests/1\\example.com",
  ]) {
    assert.equal(signatoryReturnPath(value), undefined);
  }
  assert.equal(signatoryRole("CHAIR"), "CHAIR");
  assert.equal(signatoryRole("TEACHER"), "TEACHER");
  assert.equal(signatoryRole("ADMIN"), "DIRECTOR");
});
