import test from "node:test";
import assert from "node:assert/strict";
import {
  userRoleForEditor,
  userRoleOptions,
  userRoleUpdate,
  workspaceStartPath,
} from "../lib/user-roles";

test("new accounts offer only manager and director", () => {
  assert.deepEqual(userRoleOptions(), ["OPERATOR", "DIRECTOR"]);
  assert.equal(userRoleForEditor(), "OPERATOR");
  assert.deepEqual(userRoleUpdate(undefined, "DIRECTOR"), { role: "DIRECTOR" });
});

test("editing legacy admin keeps its stored role when its visible director role is unchanged", () => {
  assert.equal(userRoleForEditor("ADMIN"), "DIRECTOR");
  assert.deepEqual(userRoleOptions("ADMIN"), ["OPERATOR", "DIRECTOR"]);
  assert.deepEqual(userRoleUpdate("ADMIN", "DIRECTOR"), {});
  assert.deepEqual(userRoleUpdate("ADMIN", "OPERATOR"), { role: "OPERATOR" });
});

test("legacy restricted accounts are never promoted just by opening and saving their form", () => {
  for (const role of ["VIEWER", "EMPLOYER"] as const) {
    assert.equal(userRoleForEditor(role), role);
    assert.deepEqual(userRoleOptions(role), ["OPERATOR", "DIRECTOR", role]);
    assert.deepEqual(userRoleUpdate(role, role), {});
    assert.deepEqual(userRoleUpdate(role, "DIRECTOR"), { role: "DIRECTOR" });
  }
});

test("new director registration opens setup; returning directors including legacy admin open approvals", () => {
  for (const role of ["DIRECTOR", "ADMIN"] as const) {
    assert.equal(workspaceStartPath(role, true), "/onboarding");
    assert.equal(workspaceStartPath(role), "/approvals");
  }
  assert.equal(workspaceStartPath("OPERATOR"), "/requests");
  assert.equal(workspaceStartPath("VIEWER", true), "/requests");
  assert.equal(workspaceStartPath("EMPLOYER", true), "/portal");
});
