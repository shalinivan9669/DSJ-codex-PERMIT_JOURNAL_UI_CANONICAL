import test from "node:test";
import assert from "node:assert/strict";
import {
  userRoleForEditor,
  userRoleOptions,
  userRoleUpdate,
  workspaceStartPath,
} from "../lib/user-roles";

test("staff account creation offers scoped learning roles without privileged or unlinked external accounts", () => {
  assert.deepEqual(userRoleOptions(), ["OPERATOR", "TEACHER", "METHODIST", "EXPERT", "VIEWER"]);
  assert.deepEqual(userRoleOptions(undefined, "ADMIN"), ["OPERATOR", "TEACHER", "METHODIST", "EXPERT", "VIEWER"]);
  assert.deepEqual(userRoleOptions(undefined, "SUPER_ADMIN"), ["OPERATOR", "TEACHER", "METHODIST", "EXPERT", "VIEWER", "ADMIN", "SUPER_ADMIN", "DIRECTOR"]);
  assert.equal(userRoleForEditor(), "OPERATOR");
  assert.deepEqual(userRoleUpdate(undefined, "DIRECTOR"), { role: "DIRECTOR" });
});

test("ADMIN and DIRECTOR remain distinct roles and an unchanged editor never promotes either", () => {
  assert.equal(userRoleForEditor("ADMIN"), "ADMIN");
  assert.equal(userRoleForEditor("DIRECTOR"), "DIRECTOR");
  assert.deepEqual(userRoleUpdate("ADMIN", "ADMIN"), {});
  assert.deepEqual(userRoleUpdate("DIRECTOR", "DIRECTOR"), {});
  assert.deepEqual(userRoleUpdate("ADMIN", "DIRECTOR"), { role: "DIRECTOR" });
  assert.deepEqual(userRoleUpdate("ADMIN", "OPERATOR"), { role: "OPERATOR" });
});

test("legacy restricted accounts are never promoted just by opening and saving their form", () => {
  for (const role of [
    "VIEWER",
    "EMPLOYER",
    "LEARNER",
    "TEACHER",
    "METHODIST",
    "EXPERT",
  ] as const) {
    assert.equal(userRoleForEditor(role), role);
    assert.ok(userRoleOptions(role).includes(role));
    assert.equal(userRoleOptions(role).filter(candidate => candidate === role).length, 1);
    assert.ok(!userRoleOptions(role).includes("SUPER_ADMIN"));
    assert.ok(!userRoleOptions(role).includes("DIRECTOR"));
    assert.deepEqual(userRoleUpdate(role, role), {});
    assert.deepEqual(userRoleUpdate(role, "DIRECTOR"), { role: "DIRECTOR" });
  }
});

test("teachers and experts start in teaching, while a methodist can create the first programme from the catalogue", () => {
  for (const role of ["TEACHER", "EXPERT"] as const) {
    assert.equal(workspaceStartPath(role), "/lms/teaching");
    assert.equal(workspaceStartPath(role, true), "/lms/teaching");
    assert.deepEqual(userRoleUpdate(role, role), {});
  }
  assert.equal(workspaceStartPath("METHODIST"), "/lms");
  assert.equal(workspaceStartPath("METHODIST", true), "/lms");
  assert.deepEqual(userRoleUpdate("METHODIST", "METHODIST"), {});
  assert.equal(workspaceStartPath("LEARNER"), "/learn");
});

test("first system managers open setup, centre operators open their workplace, and legacy read-only and organisation routes remain available", () => {
  for (const role of ["DIRECTOR", "SUPER_ADMIN"] as const) {
    assert.equal(workspaceStartPath(role, true), "/onboarding");
  }
  assert.equal(workspaceStartPath("DIRECTOR"), "/approvals");
  for (const role of ["ADMIN", "SUPER_ADMIN", "OPERATOR"] as const) assert.equal(workspaceStartPath(role), "/lms/workplace");
  assert.equal(workspaceStartPath("ADMIN", true), "/lms/workplace");
  assert.equal(workspaceStartPath("VIEWER", true), "/requests");
  assert.equal(workspaceStartPath("EMPLOYER", true), "/portal");
});
